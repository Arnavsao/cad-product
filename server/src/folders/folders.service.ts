import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api-error';
import { isCuid } from '../common/pipes/parse-cuid.pipe';
import type { Folder } from '../generated/prisma/client';
import { isPrismaKnownError, PRISMA_ERROR, PrismaService } from '../prisma/prisma.service';
import {
  MAX_FOLDER_DEPTH,
  type CreateFolderDto,
  type DeleteFolderResultDto,
  type FolderDto,
  type FolderPathEntryDto,
  type FolderWithPathDto,
  type UpdateFolderDto,
} from './dto/folder.dto';

/**
 * Folder tree for one user (adjacency list, `parentId` self-relation).
 *
 * Design decisions:
 *
 * - **Root uniqueness is enforced here, not by the database.** The schema has
 *   `@@unique([ownerId, parentId, name])`, but SQL treats every NULL as
 *   distinct, so that index silently permits any number of root folders called
 *   "Site plans". Every write therefore pre-checks with an explicit
 *   `parentId: null` lookup, and still catches P2002 for the nested case (and
 *   for a root race we lose) so both paths answer the same 409 `NAME_TAKEN`.
 *
 * - **Ownership violations are 404, never 403.** A folder belonging to someone
 *   else must be indistinguishable from one that does not exist, so every query
 *   is scoped by `ownerId` and a miss is `FOLDER_NOT_FOUND`.
 *
 * - **Every `parentId` walk is depth-bounded** (`MAX_FOLDER_DEPTH`). Cycle
 *   detection prevents new cycles, but a pre-existing one (bad migration,
 *   manual SQL) must not turn a breadcrumb request into an infinite loop; we
 *   answer 422 `FOLDER_CYCLE` instead.
 *
 * - **Delete is 409 unless `?force=true`.** Losing a folder silently loses the
 *   drawings inside it; `force` makes the destructive intent explicit and
 *   moves those drawings to trash (recoverable) rather than deleting them.
 */
@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** `GET /folders?parentId=` — direct children of `parentId` (root when absent). */
  async list(userId: string, parentId?: string | null): Promise<FolderDto[]> {
    const parent = normaliseParentId(parentId);
    if (parent !== null) {
      await this.requireFolder(userId, parent);
    }
    const rows = await this.prisma.folder.findMany({
      where: { ownerId: userId, parentId: parent },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toFolderDto);
  }

  /** `GET /folders/:id` — the folder plus its root-most-first breadcrumb trail. */
  async get(userId: string, id: string): Promise<FolderWithPathDto> {
    const folder = await this.requireFolder(userId, id);
    return { ...toFolderDto(folder), path: await this.pathOf(userId, folder) };
  }

  /**
   * Breadcrumbs for `folder`, root-most first and including the folder itself.
   * One query per level — trees here are a handful deep and each hop is a
   * primary-key lookup, so a recursive CTE would cost more than it saves.
   */
  async pathOf(userId: string, folder: Folder): Promise<FolderPathEntryDto[]> {
    const path: FolderPathEntryDto[] = [{ id: folder.id, name: folder.name }];
    let parentId = folder.parentId;
    for (let depth = 0; parentId !== null; depth++) {
      if (depth >= MAX_FOLDER_DEPTH) {
        throw ApiException.unprocessable('FOLDER_CYCLE', 'Folder hierarchy is too deep or contains a cycle');
      }
      const parent: Folder | null = await this.prisma.folder.findFirst({
        where: { id: parentId, ownerId: userId },
      });
      if (!parent) {
        break;
      }
      path.unshift({ id: parent.id, name: parent.name });
      parentId = parent.parentId;
    }
    return path;
  }

  /** Owner-scoped fetch; a miss (or someone else's folder) is 404. */
  async requireFolder(userId: string, id: string): Promise<Folder> {
    const folder = isCuid(id) ? await this.prisma.folder.findFirst({ where: { id, ownerId: userId } }) : null;
    if (!folder) {
      throw ApiException.notFound('FOLDER_NOT_FOUND', 'Folder not found');
    }
    return folder;
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /** `POST /folders` → 201. 409 `NAME_TAKEN` when a sibling already has the name. */
  async create(userId: string, dto: CreateFolderDto): Promise<FolderDto> {
    const parentId = normaliseParentId(dto.parentId);
    const name = dto.name.trim();
    if (parentId !== null) {
      await this.requireFolder(userId, parentId);
    }
    await this.assertNameFree(userId, parentId, name);

    try {
      const created = await this.prisma.folder.create({ data: { ownerId: userId, parentId, name } });
      return toFolderDto(created);
    } catch (error) {
      throw this.asNameTaken(error, name);
    }
  }

  /** `PATCH /folders/:id` — rename and/or move. */
  async update(userId: string, id: string, dto: UpdateFolderDto): Promise<FolderDto> {
    const folder = await this.requireFolder(userId, id);
    const name = dto.name === undefined ? folder.name : dto.name.trim();
    const parentId = dto.parentId === undefined ? folder.parentId : normaliseParentId(dto.parentId);

    if (parentId !== folder.parentId && parentId !== null) {
      await this.requireFolder(userId, parentId);
      await this.assertNoCycle(userId, id, parentId);
    }
    if (parentId !== folder.parentId || name !== folder.name) {
      await this.assertNameFree(userId, parentId, name, id);
    }

    try {
      const updated = await this.prisma.folder.update({ where: { id: folder.id }, data: { name, parentId } });
      return toFolderDto(updated);
    } catch (error) {
      throw this.asNameTaken(error, name);
    }
  }

  /**
   * `DELETE /folders/:id`.
   *
   * Empty → deleted. Non-empty → 409 `FOLDER_NOT_EMPTY` unless `force`, in
   * which case every drawing in the subtree is moved to trash first and the
   * subfolders go with the row (`onDelete: Cascade` on the self-relation).
   * Drawings are only soft-deleted, so a mis-click stays recoverable; their
   * `folderId` becomes NULL via `onDelete: SetNull` and they resurface at the
   * root when restored.
   */
  async remove(userId: string, id: string, force: boolean): Promise<DeleteFolderResultDto> {
    const folder = await this.requireFolder(userId, id);
    const subtree = await this.subtreeIds(userId, folder.id);

    const [childFolders, liveDrawings] = await Promise.all([
      this.prisma.folder.count({ where: { ownerId: userId, parentId: folder.id } }),
      this.prisma.drawing.count({ where: { ownerId: userId, folderId: { in: subtree }, deletedAt: null } }),
    ]);

    if (!force && (childFolders > 0 || liveDrawings > 0)) {
      throw ApiException.conflict('FOLDER_NOT_EMPTY', 'Folder is not empty', {
        folders: childFolders,
        drawings: liveDrawings,
      });
    }

    const trashedDrawings = await this.prisma.$transaction(async (tx) => {
      const trashed = await tx.drawing.updateMany({
        where: { ownerId: userId, folderId: { in: subtree }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.folder.delete({ where: { id: folder.id } });
      return trashed.count;
    });

    return { id: folder.id, trashedDrawings };
  }

  // ---------------------------------------------------------------------------
  // Invariants
  // ---------------------------------------------------------------------------

  /**
   * Rejects a move that would make `folderId` its own ancestor. Walks up from
   * the proposed parent; hitting `folderId` (or the depth cap) is 422
   * `FOLDER_CYCLE`.
   */
  async assertNoCycle(userId: string, folderId: string, newParentId: string): Promise<void> {
    let cursor: string | null = newParentId;
    for (let depth = 0; cursor !== null; depth++) {
      if (cursor === folderId || depth >= MAX_FOLDER_DEPTH) {
        throw ApiException.unprocessable('FOLDER_CYCLE', 'A folder cannot be moved inside itself');
      }
      const parent: { parentId: string | null } | null = await this.prisma.folder.findFirst({
        where: { id: cursor, ownerId: userId },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  /**
   * 409 `NAME_TAKEN` when a sibling already uses `name`. Needed for the root
   * level because `@@unique([ownerId, parentId, name])` does not constrain rows
   * whose `parentId` is NULL; run for nested levels too so the message is the
   * same and we do not depend on catching a driver error.
   */
  private async assertNameFree(
    userId: string,
    parentId: string | null,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.folder.findFirst({
      where: { ownerId: userId, parentId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw ApiException.conflict('NAME_TAKEN', `A folder named "${name}" already exists here`);
    }
  }

  /** Collects `folderId` and every descendant (depth-bounded BFS). */
  private async subtreeIds(userId: string, folderId: string): Promise<string[]> {
    const ids = [folderId];
    let frontier = [folderId];
    for (let depth = 0; frontier.length > 0 && depth < MAX_FOLDER_DEPTH; depth++) {
      const children = await this.prisma.folder.findMany({
        where: { ownerId: userId, parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
      ids.push(...frontier);
    }
    return ids;
  }

  /** Turns a unique-violation into the domain 409; anything else propagates. */
  private asNameTaken(error: unknown, name: string): unknown {
    if (isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
      return ApiException.conflict('NAME_TAKEN', `A folder named "${name}" already exists here`);
    }
    if (isPrismaKnownError(error, PRISMA_ERROR.NOT_FOUND)) {
      return ApiException.notFound('FOLDER_NOT_FOUND', 'Folder not found');
    }
    return error;
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** `undefined`/`null`/`''` → root (`null`). */
function normaliseParentId(parentId: string | null | undefined): string | null {
  return parentId === undefined || parentId === null || parentId === '' ? null : parentId;
}

function toFolderDto(row: Folder): FolderDto {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
