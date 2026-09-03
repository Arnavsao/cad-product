import { Injectable } from '@nestjs/common';
import {
  assertLevel,
  liveShare,
  mergeListedAccess,
  permissionLevel,
  requireWorkspaceEdit,
  resolveFolderAccess,
  shareTargets,
  workspaceAccess,
  type Access,
  type AccessLevel,
  type Actor,
} from '../common/access';
import { ApiException } from '../common/errors/api-error';
import { isCuid } from '../common/pipes/parse-cuid.pipe';
import {
  drawingScope,
  folderScope,
  reachableFolder,
  sharedFolderScope,
  type Workspace,
} from '../common/workspace';
import type { Folder, Prisma } from '../generated/prisma/client';
import { OrganizationsService } from '../organizations/organizations.service';
import { isPrismaKnownError, PRISMA_ERROR, PrismaService } from '../prisma/prisma.service';
import {
  MAX_FOLDER_DEPTH,
  type CreateFolderDto,
  type DeleteFolderResultDto,
  type FolderDto,
  type FolderPathEntryDto,
  type FolderWithPathDto,
  type ListFoldersDto,
  type MoveFolderDto,
  type UpdateFolderDto,
} from './dto/folder.dto';

/**
 * A folder row, optionally with the relations a shared folder tile needs, plus
 * what the caller may do with it.
 *
 * The relations are optional for the same reason as `DrawingRow`'s: write paths
 * that update a row and map it straight back would otherwise each have to
 * re-fetch them, and the DTO reports `owner: null` in that case.
 */
export type FolderWithRelations = Folder & {
  owner?: { id: string; firstName: string | null; lastName: string | null; imageUrl: string | null } | null;
  organization?: { id: string; name: string } | null;
};

export type FolderRow = FolderWithRelations & { access: Access };

/**
 * `include` for the two relations above. Columns are selected explicitly — a
 * bare `include: { owner: true }` would ship the whole user row (auth id,
 * email, timestamps) to every client for every tile.
 */
export const FOLDER_RELATIONS = {
  owner: { select: { id: true, firstName: true, lastName: true, imageUrl: true } },
  organization: { select: { id: true, name: true } },
} as const;

/**
 * Folder tree for one workspace (adjacency list, `parentId` self-relation).
 *
 * Design decisions:
 *
 * - **Name uniqueness is pre-checked here and backed by the database.** The
 *   `organizations_and_drawing_names` migration adds two partial unique indexes
 *   over `(owner_id | organization_id, COALESCE(parent_id, ''), name)`; the
 *   `COALESCE` is what makes root-level siblings actually constrained, because
 *   SQL treats every NULL parent as distinct. The pre-check still runs so the
 *   answer is a friendly 409 `NAME_TAKEN` rather than a driver error, and P2002
 *   is caught as the backstop for a race we lose.
 *
 * - **A workspace scopes listings; `common/access.ts` decides single rows.**
 *   Personal folders are matched by owner, org folders by membership, and
 *   `?scope=shared` lists what other people shared with the caller. A single
 *   folder is fetched by id and its level resolved in code, because a share on
 *   an ancestor grants access to a row no workspace fragment would match.
 *
 * - **Ownership violations are 404, never 403.** A folder the caller cannot see
 *   at all must be indistinguishable from one that does not exist
 *   (`FOLDER_NOT_FOUND`). Once they *can* see it, being too junior for the
 *   operation is an honest 403 `FORBIDDEN`.
 *
 * - **`PATCH` stays inside one workspace; `POST /move` crosses.** Re-parenting
 *   under a folder in another workspace via `PATCH` is still 422
 *   `CROSS_WORKSPACE_MOVE`, because that request never named a workspace and
 *   silently re-tagging a whole subtree is not what it asked for. The explicit
 *   move route does exactly that, needs `manage`, and re-tags every descendant
 *   folder and drawing in one transaction.
 *
 * - **Every `parentId` walk is depth-bounded** (`MAX_FOLDER_DEPTH`). Cycle
 *   detection prevents new cycles, but a pre-existing one (bad migration,
 *   manual SQL) must not turn a breadcrumb request into an infinite loop; we
 *   answer 422 `FOLDER_CYCLE` instead.
 *
 * - **Delete is 409 unless `?force=true`.** Losing a folder silently loses the
 *   drawings inside it; `force` makes the destructive intent explicit and moves
 *   those drawings to trash (recoverable) rather than deleting them. Both paths
 *   need `edit` — see `remove` for why not `manage`.
 */
@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * `GET /folders?parentId=&organizationId=&scope=` — one level of the tree.
   *
   * With `scope=shared` the listing leaves the caller's own workspaces
   * entirely: it returns the folders other people shared with them, wherever
   * those live. Browsing *into* one uses the ordinary `parentId` path, since a
   * folder share covers its subtree.
   */
  async list(actor: Actor, query: ListFoldersDto = {}): Promise<FolderDto[]> {
    if (query.scope === 'shared') {
      const rows = await this.prisma.folder.findMany({
        where: sharedFolderScope(actor),
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: FOLDER_RELATIONS,
      });
      return this.withAccess(actor, rows, null);
    }

    const parent = normaliseParentId(query.parentId);
    if (parent !== null) {
      // The parent decides the workspace, so a shared folder's children list
      // without the caller belonging to the workspace they sit in.
      const folder = await this.requireFolder(actor, parent, 'view');
      const rows = await this.prisma.folder.findMany({
        where: { parentId: folder.id },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: FOLDER_RELATIONS,
      });
      return this.withAccess(actor, rows, folder.access);
    }

    const workspace = await this.organizations.resolveWorkspace(actor.userId, query.organizationId);
    const rows = await this.prisma.folder.findMany({
      where: { ...folderScope(workspace), parentId: null },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: FOLDER_RELATIONS,
    });
    return this.withAccess(actor, rows, await workspaceAccess(this.prisma, actor, workspace.organizationId));
  }

  /** `GET /folders/:id` — the folder plus its root-most-first breadcrumb trail. */
  async get(actor: Actor, id: string): Promise<FolderWithPathDto> {
    const folder = await this.requireFolder(actor, id, 'view');
    return { ...toFolderDto(folder, folder.access), path: await this.pathOf(actor, folder) };
  }

  /**
   * Breadcrumbs for `folder`, root-most first and including the folder itself.
   * One query per level — trees here are a handful deep and each hop is a
   * primary-key lookup, so a recursive CTE would cost more than it saves.
   *
   * The walk stops at the first ancestor the caller cannot reach, so someone
   * browsing a folder that was shared with them gets a trail back up to the
   * shared folder — and no further, which would expose the names of its owner's
   * private parents. Shared folder ids are collected in one query up front
   * rather than resolved per level.
   */
  async pathOf(actor: Actor, folder: Folder): Promise<FolderPathEntryDto[]> {
    const path: FolderPathEntryDto[] = [{ id: folder.id, name: folder.name }];
    const sharedIds = await this.sharedFolderIds(actor);
    const visible: Prisma.FolderWhereInput = {
      OR: [reachableFolder(actor.userId), ...(sharedIds.length ? [{ id: { in: sharedIds } }] : [])],
    };

    let parentId = folder.parentId;
    for (let depth = 0; parentId !== null; depth++) {
      if (depth >= MAX_FOLDER_DEPTH) {
        throw ApiException.unprocessable('FOLDER_CYCLE', 'Folder hierarchy is too deep or contains a cycle');
      }
      const parent: Folder | null = await this.prisma.folder.findFirst({
        where: { id: parentId, ...visible },
      });
      if (!parent) {
        break;
      }
      path.unshift({ id: parent.id, name: parent.name });
      parentId = parent.parentId;
    }
    return path;
  }

  /**
   * Fetches one folder and resolves what the caller may do with it, refusing
   * anything below `minLevel`.
   *
   * The row is read by id *without* a scope predicate and judged afterwards
   * (`resolveFolderAccess`), because a share — on this folder or on an ancestor
   * — grants access that no workspace `WHERE` fragment can express. Nothing at
   * all is 404 `FOLDER_NOT_FOUND`; too little is 403 `FORBIDDEN`.
   */
  async requireFolder(actor: Actor, id: string, minLevel: AccessLevel = 'view'): Promise<FolderRow> {
    const folder = isCuid(id)
      ? await this.prisma.folder.findFirst({ where: { id }, include: FOLDER_RELATIONS })
      : null;
    const access = folder ? await resolveFolderAccess(this.prisma, actor, folder) : null;
    if (!folder || !access) {
      throw notFound();
    }
    assertLevel(access, minLevel);
    return { ...folder, access };
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * `POST /folders` → 201. 409 `NAME_TAKEN` when a sibling already has the name.
   *
   * A `parentId` fixes the workspace: nesting under an org folder makes the new
   * folder an org folder, whatever `organizationId` the body claimed. That
   * keeps a subtree from straddling two workspaces.
   */
  async create(actor: Actor, dto: CreateFolderDto): Promise<FolderDto> {
    const parentId = normaliseParentId(dto.parentId);
    const name = dto.name.trim();

    let workspace: Workspace;
    if (parentId !== null) {
      const parent = await this.requireFolder(actor, parentId, 'edit');
      workspace = { userId: actor.userId, organizationId: parent.organizationId };
    } else {
      workspace = await this.organizations.resolveWorkspace(actor.userId, dto.organizationId);
      // A viewer belongs to the org but may not add to it.
      await requireWorkspaceEdit(this.prisma, actor, workspace.organizationId);
    }
    await this.assertNameFree(workspace, parentId, name);

    try {
      const created = await this.prisma.folder.create({
        data: { ownerId: actor.userId, organizationId: workspace.organizationId, parentId, name },
        include: FOLDER_RELATIONS,
      });
      return toFolderDto(created, { level: 'manage', viaShare: false });
    } catch (error) {
      throw this.asNameTaken(error, name);
    }
  }

  /** `PATCH /folders/:id` — rename and/or move within the same workspace. */
  async update(actor: Actor, id: string, dto: UpdateFolderDto): Promise<FolderDto> {
    const folder = await this.requireFolder(actor, id, 'edit');
    const workspace: Workspace = { userId: actor.userId, organizationId: folder.organizationId };
    const name = dto.name === undefined ? folder.name : dto.name.trim();
    const parentId = dto.parentId === undefined ? folder.parentId : normaliseParentId(dto.parentId);

    if (parentId !== folder.parentId && parentId !== null) {
      const parent = await this.requireFolder(actor, parentId, 'edit');
      // Re-parenting across workspaces would un-share (or silently share) the
      // whole subtree, so it is refused rather than quietly reinterpreted;
      // `POST /folders/:id/move` is the request that means to do it.
      if (parent.organizationId !== folder.organizationId) {
        throw crossWorkspace();
      }
      await this.assertNoCycle(actor, id, parentId);
    }
    if (parentId !== folder.parentId || name !== folder.name) {
      await this.assertNameFree(workspace, parentId, name, id);
    }

    try {
      const updated = await this.prisma.folder.update({
        where: { id: folder.id },
        data: { name, parentId },
        include: FOLDER_RELATIONS,
      });
      return toFolderDto(updated, folder.access);
    } catch (error) {
      throw this.asNameTaken(error, name);
    }
  }

  /**
   * `POST /folders/:id/move` — move a folder to another workspace, another
   * parent, or both.
   *
   * Design decisions:
   *
   * - **The whole subtree is re-tagged in one transaction**, descendant folders
   *   and every drawing inside them, trashed rows included. Leaving a
   *   descendant behind would strand it in a workspace whose members can no
   *   longer see its parent, and skipping trashed rows would resurrect them in
   *   the old workspace on restore.
   *
   * - **`manage` on the folder, `edit` at the destination.** Moving a subtree
   *   out of an org takes it away from everyone in that org, which is the same
   *   weight of decision as deleting it — so it needs the level share
   *   recipients never get. The destination is a separate question: you must be
   *   able to write where you are putting it.
   *
   * - **Storage keys never move.** Objects stay under `users/{creator}/…`
   *   (see `DrawingsService`), so a move is metadata only however large the
   *   subtree is.
   */
  async move(actor: Actor, id: string, dto: MoveFolderDto): Promise<FolderDto> {
    const folder = await this.requireFolder(actor, id, 'edit');
    const target = dto.organizationId ?? null;
    const changesWorkspace = target !== folder.organizationId;
    if (changesWorkspace) {
      assertLevel(folder.access, 'manage');
      await requireWorkspaceEdit(this.prisma, actor, target);
    }

    const parentId = normaliseParentId(dto.parentId);
    if (parentId !== null) {
      const parent = await this.requireFolder(actor, parentId, 'edit');
      if (parent.organizationId !== target) {
        throw crossWorkspace();
      }
      await this.assertNoCycle(actor, id, parentId);
    }

    const destination: Workspace = { userId: actor.userId, organizationId: target };
    await this.assertNameFree(destination, parentId, folder.name, folder.id);

    // The subtree is collected in the SOURCE workspace, before anything moves.
    const subtree = await this.subtreeIds({ userId: actor.userId, organizationId: folder.organizationId }, folder.id);

    try {
      const moved = await this.prisma.$transaction(async (tx) => {
        if (changesWorkspace) {
          await tx.folder.updateMany({ where: { id: { in: subtree } }, data: { organizationId: target } });
          await tx.drawing.updateMany({ where: { folderId: { in: subtree } }, data: { organizationId: target } });
        }
        return tx.folder.update({ where: { id: folder.id }, data: { parentId }, include: FOLDER_RELATIONS });
      });
      return toFolderDto(moved, changesWorkspace ? { level: 'manage', viaShare: false } : folder.access);
    } catch (error) {
      throw this.asNameTaken(error, folder.name);
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
   *
   * BOTH paths need only `edit`, `force` included. `manage` was considered and
   * rejected: it would take folder deletion away from ordinary org members, who
   * can delete folders today, to guard an action that only ever *trashes* the
   * drawings inside — recoverable, unlike `DELETE /drawings/:id/permanent`,
   * which does need `manage`. The 409 without `force` is what makes the intent
   * explicit; the level is not carrying that weight.
   */
  async remove(actor: Actor, id: string, force: boolean): Promise<DeleteFolderResultDto> {
    const folder = await this.requireFolder(actor, id, 'edit');
    // Counts and the trash sweep are scoped to the folder's workspace, not to
    // the caller: an org folder holds drawings created by other members, and
    // counting only the caller's would report "empty" and then bin a teammate's
    // work without warning.
    const workspace: Workspace = { userId: actor.userId, organizationId: folder.organizationId };
    const subtree = await this.subtreeIds(workspace, folder.id);

    const [childFolders, liveDrawings] = await Promise.all([
      this.prisma.folder.count({ where: { ...folderScope(workspace), parentId: folder.id } }),
      this.prisma.drawing.count({
        where: { ...drawingScope(workspace), folderId: { in: subtree }, deletedAt: null },
      }),
    ]);

    if (!force && (childFolders > 0 || liveDrawings > 0)) {
      throw ApiException.conflict('FOLDER_NOT_EMPTY', 'Folder is not empty', {
        folders: childFolders,
        drawings: liveDrawings,
      });
    }

    const trashedDrawings = await this.prisma.$transaction(async (tx) => {
      const trashed = await tx.drawing.updateMany({
        where: { ...drawingScope(workspace), folderId: { in: subtree }, deletedAt: null },
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
  async assertNoCycle(actor: Actor, folderId: string, newParentId: string): Promise<void> {
    let cursor: string | null = newParentId;
    for (let depth = 0; cursor !== null; depth++) {
      if (cursor === folderId || depth >= MAX_FOLDER_DEPTH) {
        throw ApiException.unprocessable('FOLDER_CYCLE', 'A folder cannot be moved inside itself');
      }
      const parent: { parentId: string | null } | null = await this.prisma.folder.findFirst({
        where: { id: cursor, ...reachableFolder(actor.userId) },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  /**
   * 409 `NAME_TAKEN` when a sibling in the same workspace already uses `name`.
   *
   * The database enforces this too (partial unique indexes, see the class
   * JSDoc), but the pre-check is what turns it into a message a user can act
   * on; the P2002 catch covers the race between the two.
   */
  private async assertNameFree(
    workspace: Workspace,
    parentId: string | null,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.folder.findFirst({
      where: {
        ...folderScope(workspace),
        parentId,
        name,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw ApiException.conflict('NAME_TAKEN', `A folder named "${name}" already exists here`);
    }
  }

  /**
   * Every folder id with a live share reaching the caller. Small by nature (one
   * row per folder somebody shared with them), so it is cheaper to fetch once
   * than to resolve access per breadcrumb level.
   */
  private async sharedFolderIds(actor: Actor): Promise<string[]> {
    const rows = await this.prisma.share.findMany({
      where: { folderId: { not: null }, AND: [liveShare(), shareTargets(actor)] },
      select: { folderId: true },
    });
    return rows.map((row) => row.folderId).filter((id): id is string => id !== null);
  }

  /** Collects `folderId` and every descendant in the workspace (depth-bounded BFS). */
  private async subtreeIds(workspace: Workspace, folderId: string): Promise<string[]> {
    const ids = [folderId];
    let frontier = [folderId];
    for (let depth = 0; frontier.length > 0 && depth < MAX_FOLDER_DEPTH; depth++) {
      const children = await this.prisma.folder.findMany({
        where: { ...folderScope(workspace), parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
      ids.push(...frontier);
    }
    return ids;
  }

  /**
   * Access for a page of listed folders: one shares query for the whole page,
   * merged with the level the page's context already established (see
   * `mergeListedAccess`). Resolving each row from scratch would cost a
   * membership read and an ancestor walk per row.
   */
  private async withAccess(actor: Actor, rows: FolderWithRelations[], base: Access | null): Promise<FolderDto[]> {
    if (rows.length === 0) {
      return [];
    }
    const shares = await this.prisma.share.findMany({
      where: {
        folderId: { in: rows.map((row) => row.id) },
        AND: [liveShare(), shareTargets(actor)],
      },
      select: { folderId: true, permission: true },
    });

    const byFolder = new Map<string, AccessLevel>();
    for (const share of shares) {
      if (!share.folderId) {
        continue;
      }
      const level = permissionLevel(share.permission);
      const seen = byFolder.get(share.folderId);
      if (seen !== 'edit') {
        byFolder.set(share.folderId, level);
      }
    }
    return rows.map((row) => toFolderDto(row, mergeListedAccess(base, byFolder.get(row.id) ?? null)));
  }

  /** Turns a unique-violation into the domain 409; anything else propagates. */
  private asNameTaken(error: unknown, name: string): unknown {
    if (isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
      return ApiException.conflict('NAME_TAKEN', `A folder named "${name}" already exists here`);
    }
    if (isPrismaKnownError(error, PRISMA_ERROR.NOT_FOUND)) {
      return notFound();
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

function notFound(): ApiException {
  return ApiException.notFound('FOLDER_NOT_FOUND', 'Folder not found');
}

function crossWorkspace(): ApiException {
  return ApiException.unprocessable(
    'CROSS_WORKSPACE_MOVE',
    'A folder cannot be moved between your personal drawings and an organization',
  );
}

function toFolderDto(row: FolderWithRelations, access: Access): FolderDto {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    organizationId: row.organizationId,
    organizationName: row.organization?.name ?? null,
    owner: row.owner
      ? {
          id: row.owner.id,
          firstName: row.owner.firstName,
          lastName: row.owner.lastName,
          imageUrl: row.owner.imageUrl,
        }
      : null,
    access: access.level,
    viaShare: access.viaShare,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
