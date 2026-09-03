import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  assertLevel,
  liveShare,
  mergeListedAccess,
  permissionLevel,
  requireWorkspaceEdit,
  resolveDrawingAccess,
  shareTargets,
  workspaceAccess,
  type Access,
  type AccessLevel,
  type Actor,
} from '../common/access';
import { ApiException } from '../common/errors/api-error';
import { isCuid } from '../common/pipes/parse-cuid.pipe';
import { HEAD_BYTES, TAIL_BYTES, looksLikeDxf, looksLikeDxfRanges } from '../common/utils/dxf-sniff';
import { clampLimit, clampPage, decodeCursor, encodeCursor, type Page } from '../common/utils/pagination';
import { drawingScope, sharedDrawingScope, type Workspace } from '../common/workspace';
import type { Env } from '../config/env.schema';
import { FoldersService } from '../folders/folders.service';
import type { Drawing } from '../generated/prisma/client';
import { DrawingFormat, OrgRole, Prisma, Units } from '../generated/prisma/client';
import { OrganizationsService } from '../organizations/organizations.service';
import { isPrismaKnownError, PRISMA_ERROR, PrismaService } from '../prisma/prisma.service';
import {
  drawingPrefix,
  drawingVersionKey,
  fileExtension,
  isOwnedUploadKey,
  sanitizeFileName,
  stagingKey,
  thumbnailKey,
  uploadKey,
} from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import {
  MAX_NAME_LENGTH,
  type DeletedDrawingDto,
  type DrawingDto,
  type DrawingSummaryDto,
  type EmptyTrashResultDto,
  type PresignDto,
  type SaveResultDto,
  type ThumbnailResultDto,
  type TrashedDrawingDto,
  type VersionDownloadDto,
  type VersionDto,
} from './dto/drawing.dto';
import type {
  CompleteContentDto,
  CopyDrawingDto,
  CreateDrawingDto,
  DuplicateDrawingDto,
  MoveDrawingDto,
  PresignContentDto,
  UpdateDrawingDto,
} from './dto/create-drawing.dto';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  MAX_RECENT_LIMIT,
  ROOT_FOLDER,
  type DrawingSort,
  type ListDrawingsDto,
  type ListTrashDto,
} from './dto/list-drawings.dto';
import { ALLOWED_UPLOAD_EXTENSIONS, type ImportDrawingDto, type PresignUploadDto } from './dto/upload.dto';
import {
  copyName,
  drawingRelations,
  formatFromExtension,
  toDrawingDto,
  toDrawingSummaryDto,
  type DrawingRow,
} from './drawings.mapper';
import { blankDxf, insunitsForUnit } from './templates/blank-dxf';

/** Content type every DXF payload is stored and served with. */
const DXF_CONTENT_TYPE = 'text/plain; charset=utf-8';
const PNG_CONTENT_TYPE = 'image/png';

/** PNG signature — the first eight bytes of every valid PNG file. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Lifetime of a presigned PUT (upload or staging save). */
const PRESIGN_PUT_TTL_SECONDS = 900;

/** One hour in milliseconds — the granularity thumbnail URLs are signed at. */
const HOUR_MS = 3_600_000;

/** Object-prefix deletions in flight while emptying a trash. */
const DELETE_CONCURRENCY = 8;

/** Raised inside the reservation transaction to force a rollback on a lost race. */
class ReservationLost extends Error {}

/** A drawing row plus what the caller may do with it. */
export type DrawingWithAccess = DrawingRow & { access: Access };

/** Which lifecycle state `requireDrawing` will accept. */
type Lifecycle = 'live' | 'trashed' | 'any';

/**
 * Drawings: metadata in Postgres, DXF payloads and thumbnails in object storage.
 *
 * ## Why the ordering in `commitVersion` is what it is
 *
 * A save has to do two writes that cannot share a transaction — a row update
 * and an object PUT — so one of them must go first, and the choice decides
 * which failure mode is possible.
 *
 * We **reserve in the database first, then write the object.** The reservation
 * is a single `updateMany` guarded by `currentVersion: expected`, followed by an
 * insert into `drawing_versions`, whose `@@unique([drawingId, version])` index
 * is the actual lock: two concurrent saves both compute `next = current + 1`, so
 * at most one can insert that row and the loser is rolled back and told 409.
 * Because the winning transaction commits before any bytes move, **two racing
 * saves can never be handed the same storage key**, and an immutable
 * `v{n}.dxf` key is never overwritten — which is what makes the version history
 * trustworthy.
 *
 * The cost is a window in which the row points at an object that does not exist
 * yet. We close it two ways: a failed PUT triggers a **compensating
 * transaction** that restores `currentVersion`/`storageKey`/`byteSize` and
 * deletes the version row (so a storage outage leaves the drawing exactly as it
 * was, and the client gets 502 `STORAGE_WRITE_FAILED` and can retry); and a
 * process crash inside the window leaves a dangling pointer that the plan
 * accepts as a known risk (phase 2 adds a `readyAt` column).
 *
 * The inverse order — write the object, then update the row — has no such
 * recovery: the key must be chosen before the version is reserved, so two
 * racers pick the same `v{n}.dxf` and one silently overwrites the other's
 * bytes while both rows claim version *n*. Losing a save is worse than a
 * retryable 502.
 *
 * ## Other decisions
 *
 * - **Access is a resolved level, never `ownerId`.** Every single-row path goes
 *   through `requireDrawing(actor, id, minLevel)`, which reads the row by id
 *   and asks `common/access.ts` what the caller may do with it: own personal
 *   row, org role, or a live share on the drawing or any ancestor folder. A row
 *   the caller cannot see at all is 404 `DRAWING_NOT_FOUND`, never 403, so a
 *   probe cannot learn that an id exists; a row they can see but may not change
 *   is an honest 403 `FORBIDDEN` carrying `{ required, actual }`.
 *
 * - **Version history is append-only, including on restore.** Restoring v3 of a
 *   drawing at v7 copies v3's bytes to a fresh v8 rather than rewinding the
 *   counter, so nothing anyone saved is ever destroyed by a restore and the
 *   `@@unique([drawingId, version])` lock keeps meaning what it means.
 *
 * - **Storage keys are rooted at the drawing's `ownerId`, not the caller's.**
 *   Every key is `users/{ownerId}/drawings/{id}/…` and stays there for the life
 *   of the drawing — a move between workspaces does not touch a single object.
 *   When a teammate saves an org drawing, the new version lands under the
 *   *creator's* prefix, so a drawing's objects are never split across two
 *   prefixes and the staging-key check in `completeContent` still matches. A
 *   **copy**, by contrast, is a new drawing owned by the caller, so it gets its
 *   own prefix.
 *
 * - **Sibling names are unique per workspace + folder.** Create, duplicate,
 *   import, copy and restore auto-suffix (`"Plan" → "Plan (2)"`) because none
 *   of them is a moment to interrupt someone with a dialog; an explicit rename
 *   or move answers 409 `NAME_TAKEN` instead, because there the typed name (or
 *   the chosen destination) *is* the request. Partial unique indexes enforce it
 *   underneath (see the migration).
 * - **Thumbnail URLs are signed at an hour-floored `signingDate`** so the same
 *   thumbnail yields a byte-identical URL for up to an hour and the browser can
 *   cache it; a whole page's thumbnails are signed in one `Promise.all`
 *   (signing is CPU-only, no network).
 * - **Nothing is public-read.** R2 has no object ACLs and a public bucket would
 *   expose DXF payloads, so every read goes through a short-lived presigned GET.
 * - **New rows are created inside a transaction that also inserts version 1**,
 *   then the object is written; a failed write deletes the row. The storage key
 *   embeds the drawing's cuid, which only exists once the row does.
 */
@Injectable()
export class DrawingsService {
  private readonly logger = new Logger(DrawingsService.name);
  private readonly maxInlineBytes: number;
  private readonly maxUploadBytes: number;
  private readonly maxThumbnailBytes: number;
  private readonly maxVersions: number;
  private readonly downloadTtlSec: number;
  private readonly thumbnailTtlSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly folders: FoldersService,
    private readonly organizations: OrganizationsService,
    config: ConfigService<Env, true>,
  ) {
    this.maxInlineBytes = config.get('MAX_INLINE_CONTENT_BYTES', { infer: true });
    this.maxUploadBytes = config.get('MAX_UPLOAD_BYTES', { infer: true });
    this.maxThumbnailBytes = config.get('MAX_THUMBNAIL_BYTES', { infer: true });
    this.maxVersions = config.get('MAX_VERSIONS_PER_DRAWING', { infer: true });
    this.downloadTtlSec = config.get('DOWNLOAD_URL_TTL_SECONDS', { infer: true });
    this.thumbnailTtlSec = config.get('THUMBNAIL_URL_TTL_SECONDS', { infer: true });
  }

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------

  /**
   * `GET /drawings` — a page of live drawings.
   *
   * Three scopes share this endpoint, resolved by `listContext`:
   *
   * - `?folderId=` — the contents of one folder. The **folder decides the
   *   workspace**, so `organizationId` is ignored and browsing into a folder
   *   somebody shared with you needs no special case.
   * - `?scope=shared` — "Shared with me": drawings others shared with the
   *   caller directly, wherever they live.
   * - otherwise — the root of one workspace, as before.
   *
   * Two paging modes also share it (see `Page<T>`):
   *
   * - **Keyset** (`?cursor=`) is the default. Every sort ends in an id
   *   tie-breaker so the ordering is total and Prisma's `cursor`/`skip: 1` seek
   *   is unambiguous; `take: limit + 1` reveals whether a next page exists
   *   without a second COUNT.
   * - **Offset** (`?page=`) is what the dashboard's numbered pager needs, since
   *   "page 4 of 6" and "1–25 of 137" cannot be derived from a cursor. It costs
   *   the extra COUNT and makes the database walk the skipped rows, which is
   *   why `page` is capped (`MAX_PAGE_NUMBER`) and keyset stays the default for
   *   feed-shaped callers.
   */
  async list(actor: Actor, query: ListDrawingsDto): Promise<Page<DrawingSummaryDto>> {
    const limit = clampLimit(query.limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const sort: DrawingSort = query.sort ?? 'updated';
    const { where, base } = await this.listContext(actor, query);

    if (query.page !== undefined) {
      return this.offsetPage(actor, where, orderByFor(sort), limit, query.page, base);
    }

    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.drawing.findMany({
      where,
      orderBy: orderByFor(sort),
      include: drawingRelations(),
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    });

    return this.toPage(actor, rows, limit, sort, base);
  }

  /** `GET /drawings/recent` — most recently opened first, never paginated. */
  async recent(actor: Actor, limit?: number, organizationId?: string | null): Promise<DrawingSummaryDto[]> {
    const workspace = await this.organizations.resolveWorkspace(actor.userId, organizationId);
    const take = clampLimit(limit, 12, MAX_RECENT_LIMIT);
    const rows = await this.prisma.drawing.findMany({
      where: { ...drawingScope(workspace), deletedAt: null, lastOpenedAt: { not: null } },
      orderBy: orderByFor('opened'),
      include: drawingRelations(),
      take,
    });
    const base = await workspaceAccess(this.prisma, actor, workspace.organizationId);
    const [thumbs, access] = await Promise.all([this.signThumbnails(rows), this.accessFor(actor, rows, base)]);
    return rows.map((row) => toDrawingSummaryDto(row, thumbs.get(row.id) ?? null, access.get(row.id)));
  }

  /** `GET /drawings/trash` — the only listing that shows soft-deleted rows. */
  async trash(actor: Actor, query: ListTrashDto): Promise<Page<DrawingSummaryDto>> {
    const workspace = await this.organizations.resolveWorkspace(actor.userId, query.organizationId);
    const limit = clampLimit(query.limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const where: Prisma.DrawingWhereInput = { ...drawingScope(workspace), deletedAt: { not: null } };
    const orderBy: Prisma.DrawingOrderByWithRelationInput[] = [{ deletedAt: 'desc' }, { id: 'desc' }];
    const base = await workspaceAccess(this.prisma, actor, workspace.organizationId);

    if (query.page !== undefined) {
      return this.offsetPage(actor, where, orderBy, limit, query.page, base);
    }

    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.drawing.findMany({
      where,
      orderBy,
      include: drawingRelations(),
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const kept = hasMore ? rows.slice(0, limit) : rows;
    const [thumbs, access] = await Promise.all([this.signThumbnails(kept), this.accessFor(actor, kept, base)]);
    const last = kept[kept.length - 1];
    return {
      items: kept.map((row) => toDrawingSummaryDto(row, thumbs.get(row.id) ?? null, access.get(row.id))),
      nextCursor: hasMore && last ? encodeCursor({ k: last.deletedAt!.toISOString(), id: last.id }) : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Read one
  // ---------------------------------------------------------------------------

  /**
   * `GET /drawings/:id` — metadata plus a short-lived presigned GET.
   *
   * `touch` bumps `lastOpenedAt` through raw SQL on purpose: Prisma's
   * `@updatedAt` fires on `updateMany` too, so a plain update would make merely
   * OPENING a drawing reshuffle the `sort=updated` list.
   */
  async get(
    actor: Actor,
    id: string,
    options: { touch?: boolean; download?: boolean } = {},
  ): Promise<DrawingDto> {
    const row = await this.requireDrawing(actor, id, 'view');

    if (options.touch !== false) {
      const now = new Date();
      // No owner predicate: `requireDrawing` already established that the
      // caller may touch this row, and an org drawing is legitimately opened by
      // someone who is not its owner.
      await this.prisma
        .$executeRaw`UPDATE "drawings" SET "last_opened_at" = ${now} WHERE "id" = ${id} AND "deleted_at" IS NULL`;
      row.lastOpenedAt = now;
    }

    const [download, thumbs] = await Promise.all([
      this.storage.presignGet(row.storageKey, this.downloadTtlSec, {
        responseContentType: DXF_CONTENT_TYPE,
        ...(options.download
          ? { responseContentDisposition: `attachment; filename="${downloadFileName(row)}"` }
          : {}),
      }),
      this.signThumbnails([row]),
    ]);

    return toDrawingDto(row, thumbs.get(row.id) ?? null, download, row.access);
  }

  // ---------------------------------------------------------------------------
  // Create / duplicate / import / copy
  // ---------------------------------------------------------------------------

  /** `POST /drawings` → 201. Without `initialDxf` the blank template is stored. */
  async create(actor: Actor, dto: CreateDrawingDto): Promise<DrawingDto> {
    const { folderId, workspace, access } = await this.resolveTarget(actor, dto.folderId ?? null, dto.organizationId);
    const dxf = dto.initialDxf ?? (await this.blankTemplateFor(actor.userId));

    const byteSize = Buffer.byteLength(dxf, 'utf8');
    this.assertInlineSize(byteSize);
    if (!looksLikeDxf(dxf)) {
      throw ApiException.unprocessable('INVALID_DXF', 'Payload does not look like a DXF file');
    }

    const row = await this.createDrawingRow({
      userId: actor.userId,
      workspace,
      name: await this.freeName(workspace, folderId, stripExtension(dto.name.trim())),
      folderId,
      format: DrawingFormat.DXF,
      byteSize,
      write: (key) => this.storage.putObject(key, dxf, DXF_CONTENT_TYPE).then(() => undefined),
    });

    const download = await this.storage.presignGet(row.storageKey, this.downloadTtlSec, {
      responseContentType: DXF_CONTENT_TYPE,
    });
    return toDrawingDto(row, null, download, access);
  }

  /**
   * `POST /drawings/:id/duplicate` → 201. Server-side copy; no bytes transit
   * the API.
   *
   * The copy stays in the source's workspace — duplicating an org drawing gives
   * the org another org drawing — and escalates `(copy)` → `(copy 2)` until the
   * name is free, so duplicating the same drawing repeatedly never fails.
   */
  async duplicate(actor: Actor, id: string, dto: DuplicateDrawingDto): Promise<DrawingSummaryDto> {
    const source = await this.requireDrawing(actor, id, 'edit');
    const workspace: Workspace = { userId: actor.userId, organizationId: source.organizationId };
    const name = dto.name
      ? await this.freeName(workspace, source.folderId, dto.name.trim())
      : await this.freeName(workspace, source.folderId, source.name, copyCandidate);

    return this.copyInto(source, workspace, source.folderId, name, source.access);
  }

  /**
   * `POST /drawings/:id/copy` → 201 — a copy in ANOTHER workspace or folder.
   *
   * `view` on the source is enough (being allowed to read something is being
   * allowed to keep a copy of it), but the destination needs `edit`. The copy
   * is a new drawing owned by the caller, so its objects live under *their*
   * prefix and they can manage it even if the source was read-only to them —
   * which is exactly what "Save a copy to My Drawings" needs.
   */
  async copy(actor: Actor, id: string, dto: CopyDrawingDto): Promise<DrawingSummaryDto> {
    const source = await this.requireDrawing(actor, id, 'view');
    const target = dto.organizationId ?? null;
    const access = await requireWorkspaceEdit(this.prisma, actor, target);
    const folderId = await this.resolveDestinationFolder(actor, dto.folderId, target);

    const workspace: Workspace = { userId: actor.userId, organizationId: target };
    const name = await this.freeName(workspace, folderId, stripExtension((dto.name ?? source.name).trim()));
    return this.copyInto(source, workspace, folderId, name, access);
  }

  /**
   * `POST /drawings/import` → 201. Adopts an object the browser already PUT to
   * its own upload prefix; the key is checked by string prefix (no DB lookup),
   * then HEADed and sniffed before any row is written.
   */
  async importUpload(actor: Actor, dto: ImportDrawingDto): Promise<DrawingSummaryDto> {
    // The upload prefix is always the caller's own, even when the drawing is
    // being imported into an org: they are the one who staged the bytes.
    if (!isOwnedUploadKey(dto.key, actor.userId)) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN_KEY', 'That key does not belong to your uploads');
    }
    const { folderId, workspace, access } = await this.resolveTarget(actor, dto.folderId ?? null, dto.organizationId);

    const head = await this.storage.headObject(dto.key);
    if (!head) {
      throw ApiException.notFound('UPLOAD_NOT_FOUND', 'Uploaded file not found');
    }
    if (head.size === 0) {
      throw ApiException.unprocessable('INVALID_DXF', 'Uploaded file is empty');
    }
    if (head.size > this.maxUploadBytes) {
      throw ApiException.payloadTooLarge(this.maxUploadBytes, 'Uploaded file is too large');
    }
    if (dto.byteSize !== undefined && dto.byteSize !== head.size) {
      throw ApiException.unprocessable('SIZE_MISMATCH', 'Uploaded file size does not match', {
        expected: dto.byteSize,
        actual: head.size,
      });
    }

    const fileName = dto.key.slice(dto.key.lastIndexOf('/') + 1);
    const format = formatFromExtension(fileExtension(fileName));

    // DWG is opaque to us (conversion is phase 2) — only DXF can be sniffed.
    if (format === DrawingFormat.DXF) {
      const [headBytes, tailBytes] = await Promise.all([
        this.storage.getObjectRange(dto.key, 0, Math.min(head.size, HEAD_BYTES) - 1),
        this.storage.getObjectRange(dto.key, Math.max(0, head.size - TAIL_BYTES), head.size - 1),
      ]);
      if (!looksLikeDxfRanges(headBytes, tailBytes)) {
        throw ApiException.unprocessable('INVALID_DXF', 'Uploaded file does not look like a DXF file');
      }
    }

    const row = await this.createDrawingRow({
      userId: actor.userId,
      workspace,
      // Auto-suffixed, not rejected: dropping twenty files at once must not
      // fail halfway through because two of them share a name. The extension
      // is stripped either way — a row reading "plan.dxf" next to a "DXF"
      // file-type chip says the same thing twice.
      name: await this.freeName(
        workspace,
        folderId,
        (dto.name ? stripExtension(dto.name) : stemOf(fileName)).trim().slice(0, MAX_NAME_LENGTH),
      ),
      folderId,
      format,
      byteSize: head.size,
      write: (key) => this.storage.copyObject(dto.key, key, DXF_CONTENT_TYPE),
    });

    // The staged upload is now redundant; failing to reap it is not fatal.
    void this.storage
      .deleteObject(dto.key)
      .catch((error: unknown) => this.logger.warn(`import: staging cleanup failed: ${(error as Error).message}`));

    return toDrawingSummaryDto(row, null, access);
  }

  // ---------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------

  /**
   * `PUT /drawings/:id/content` — inline save. `expectedVersion` is the parsed
   * `If-Match`; `null` means the client chose to force-overwrite.
   */
  async saveContent(actor: Actor, id: string, dxf: string, expectedVersion: number | null): Promise<SaveResultDto> {
    const byteSize = Buffer.byteLength(dxf, 'utf8');
    this.assertInlineSize(byteSize);
    if (!looksLikeDxf(dxf)) {
      throw ApiException.unprocessable('INVALID_DXF', 'Payload does not look like a DXF file');
    }

    const drawing = await this.requireDrawing(actor, id, 'edit');
    assertVersionMatches(drawing, expectedVersion);
    return this.commitVersion(drawing, byteSize, (key) =>
      this.storage.putObject(key, dxf, DXF_CONTENT_TYPE).then(() => undefined),
    );
  }

  /**
   * `POST /drawings/:id/content/presign` — a staging key the browser can PUT to
   * directly, so a 5 MB DXF never passes through this process.
   */
  async presignContent(actor: Actor, id: string, dto: PresignContentDto): Promise<PresignDto> {
    this.assertInlineSize(dto.byteSize);
    const drawing = await this.requireDrawing(actor, id, 'edit');
    // Staged under the drawing's owner, so `completeContent`'s prefix check
    // matches no matter which member of an org is saving.
    const key = stagingKey(drawing.ownerId, id, randomUUID());
    const presigned = await this.storage.presignPut(key, DXF_CONTENT_TYPE, dto.byteSize, PRESIGN_PUT_TTL_SECONDS);
    return { uploadUrl: presigned.url, key, expiresAt: presigned.expiresAt };
  }

  /** `POST /drawings/:id/content/complete` — promotes a staged object to a version. */
  async completeContent(
    actor: Actor,
    id: string,
    dto: CompleteContentDto,
    expectedVersion: number | null,
  ): Promise<SaveResultDto> {
    this.assertInlineSize(dto.byteSize);
    const drawing = await this.requireDrawing(actor, id, 'edit');

    // The key must be a staging key of THIS drawing. It is rooted at the
    // drawing's owner rather than the caller, which is what lets a teammate
    // complete a save on an org drawing they did not create.
    if (!dto.key.startsWith(`${drawingPrefix(drawing.ownerId, id)}staging/`) || dto.key.includes('..')) {
      throw ApiException.notFound('UPLOAD_NOT_FOUND', 'Staged upload not found');
    }
    const head = await this.storage.headObject(dto.key);
    if (!head) {
      throw ApiException.notFound('UPLOAD_NOT_FOUND', 'Staged upload not found');
    }
    if (head.size !== dto.byteSize) {
      throw ApiException.unprocessable('SIZE_MISMATCH', 'Staged upload size does not match', {
        expected: dto.byteSize,
        actual: head.size,
      });
    }
    const [headBytes, tailBytes] = await Promise.all([
      this.storage.getObjectRange(dto.key, 0, Math.min(head.size, HEAD_BYTES) - 1),
      this.storage.getObjectRange(dto.key, Math.max(0, head.size - TAIL_BYTES), head.size - 1),
    ]);
    if (!looksLikeDxfRanges(headBytes, tailBytes)) {
      throw ApiException.unprocessable('INVALID_DXF', 'Staged upload does not look like a DXF file');
    }

    assertVersionMatches(drawing, expectedVersion);
    const result = await this.commitVersion(drawing, head.size, (key) =>
      this.storage.copyObject(dto.key, key, DXF_CONTENT_TYPE),
    );

    void this.storage
      .deleteObject(dto.key)
      .catch((error: unknown) => this.logger.warn(`complete: staging cleanup failed: ${(error as Error).message}`));
    return result;
  }

  /**
   * The concurrency-safe save (plan §2.4). See the class JSDoc for why the
   * database reservation happens before the object write.
   */
  private async commitVersion(
    drawing: Drawing,
    byteSize: number,
    writeObject: (destinationKey: string) => Promise<void>,
  ): Promise<SaveResultDto> {
    const expected = drawing.currentVersion;
    const next = expected + 1;
    // Keyed on the drawing's owner: every version of a drawing has to live
    // under one prefix, whichever member of an org happens to be saving.
    const newKey = drawingVersionKey(drawing.ownerId, drawing.id, next);

    // 1 — reserve the version. Either both statements commit or neither does.
    let reserved: Drawing;
    try {
      reserved = await this.prisma.$transaction(async (tx) => {
        // No owner predicate — the caller was authorized by `requireDrawing`;
        // `currentVersion` is what makes this a compare-and-set.
        const claimed = await tx.drawing.updateMany({
          where: { id: drawing.id, deletedAt: null, currentVersion: expected },
          data: { currentVersion: next, storageKey: newKey, byteSize },
        });
        if (claimed.count === 0) {
          throw new ReservationLost();
        }
        // The unique (drawingId, version) index is the lock: a racer that got
        // past the guarded update above still cannot insert this row.
        await tx.drawingVersion.create({
          data: { drawingId: drawing.id, version: next, storageKey: newKey, byteSize },
        });
        return tx.drawing.findUniqueOrThrow({ where: { id: drawing.id } });
      });
    } catch (error) {
      if (error instanceof ReservationLost || isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        throw await this.versionConflict(drawing.id, next);
      }
      throw error;
    }

    // 2 — write the bytes. The key is ours alone; nothing can overwrite it.
    try {
      await writeObject(newKey);
    } catch (error) {
      await this.compensate(drawing, next, expected);
      this.logger.error(`commitVersion(${drawing.id}) storage write failed: ${(error as Error).message}`);
      throw new ApiException(HttpStatus.BAD_GATEWAY, 'STORAGE_WRITE_FAILED', 'Could not store the drawing; try again');
    }

    // 3 — trim history. Fire-and-forget: a slow prune must not slow a save.
    void this.pruneVersions(drawing.id).catch((error: unknown) =>
      this.logger.warn(`pruneVersions(${drawing.id}) failed: ${(error as Error).message}`),
    );

    return { version: next, byteSize, updatedAt: reserved.updatedAt.toISOString() };
  }

  /**
   * Undoes a reservation whose object write failed, restoring the drawing to
   * the version it had. Best-effort: if compensation itself fails we log loudly
   * rather than mask the original 502.
   */
  private async compensate(drawing: Drawing, next: number, expected: number): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.drawing.updateMany({
          where: { id: drawing.id, currentVersion: next },
          data: { currentVersion: expected, storageKey: drawing.storageKey, byteSize: drawing.byteSize },
        }),
        this.prisma.drawingVersion.deleteMany({ where: { drawingId: drawing.id, version: next } }),
      ]);
    } catch (error) {
      this.logger.error(
        `compensate(${drawing.id}, v${next}) FAILED — row may point at a missing object: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Keeps the newest `MAX_VERSIONS_PER_DRAWING` version rows and deletes both
   * the older rows and their objects. Row first, object second: an orphaned
   * object costs storage, an orphaned row would break version restore.
   */
  async pruneVersions(drawingId: string): Promise<number> {
    const stale = await this.prisma.drawingVersion.findMany({
      where: { drawingId },
      orderBy: { version: 'desc' },
      skip: this.maxVersions,
      select: { id: true, storageKey: true },
    });
    if (stale.length === 0) {
      return 0;
    }
    await this.prisma.drawingVersion.deleteMany({ where: { id: { in: stale.map((v) => v.id) } } });
    await this.storage.deleteObjects(stale.map((v) => v.storageKey));
    return stale.length;
  }

  // ---------------------------------------------------------------------------
  // Version history
  // ---------------------------------------------------------------------------

  /** `GET /drawings/:id/versions` — newest first; `view` is enough. */
  async listVersions(actor: Actor, id: string): Promise<VersionDto[]> {
    const drawing = await this.requireDrawing(actor, id, 'view');
    const rows = await this.prisma.drawingVersion.findMany({
      where: { drawingId: drawing.id },
      orderBy: { version: 'desc' },
      select: { version: true, byteSize: true, createdAt: true },
    });
    return rows.map((row) => ({
      version: row.version,
      byteSize: row.byteSize,
      createdAt: row.createdAt.toISOString(),
      isCurrent: row.version === drawing.currentVersion,
    }));
  }

  /** `GET /drawings/:id/versions/:version` — a presigned GET for old bytes. */
  async versionDownload(actor: Actor, id: string, version: number): Promise<VersionDownloadDto> {
    const drawing = await this.requireDrawing(actor, id, 'view');
    const row = await this.requireVersion(drawing.id, version);
    const signed = await this.storage.presignGet(row.storageKey, this.downloadTtlSec, {
      responseContentType: DXF_CONTENT_TYPE,
      responseContentDisposition: `attachment; filename="${downloadFileName(drawing, version)}"`,
    });
    return { downloadUrl: signed.url, expiresAt: signed.expiresAt };
  }

  /**
   * `POST /drawings/:id/versions/:version/restore` — puts an old version's
   * bytes back as a NEW version.
   *
   * Restoring v3 of a drawing at v7 produces v8 with v3's content: history is
   * append-only, so nothing anyone saved is destroyed by a restore and an
   * accidental restore is itself undoable. Rewinding `currentVersion` instead
   * would strand the objects for v4–v7 and break the `@@unique([drawingId,
   * version])` reservation lock the next save depends on.
   *
   * `If-Match` is honoured for the same reason as a save: if someone else saved
   * while the history dialog was open, the client should be told rather than
   * silently overwrite them.
   */
  async restoreVersion(
    actor: Actor,
    id: string,
    version: number,
    expectedVersion: number | null,
  ): Promise<SaveResultDto> {
    const drawing = await this.requireDrawing(actor, id, 'edit');
    const row = await this.requireVersion(drawing.id, version);
    assertVersionMatches(drawing, expectedVersion);
    return this.commitVersion(drawing, row.byteSize, (key) =>
      this.storage.copyObject(row.storageKey, key, DXF_CONTENT_TYPE),
    );
  }

  // ---------------------------------------------------------------------------
  // Metadata / lifecycle
  // ---------------------------------------------------------------------------

  /**
   * `PATCH /drawings/:id` — rename and/or move within the same workspace.
   *
   * This is the one path that answers 409 `NAME_TAKEN` instead of
   * auto-suffixing: the user typed a specific name, so silently saving a
   * different one would be worse than telling them it is taken.
   */
  async update(actor: Actor, id: string, dto: UpdateDrawingDto): Promise<DrawingSummaryDto> {
    const drawing = await this.requireDrawing(actor, id, 'edit');
    const workspace: Workspace = { userId: actor.userId, organizationId: drawing.organizationId };
    const data: Prisma.DrawingUpdateInput = {};

    const name = dto.name === undefined ? drawing.name : dto.name.trim();
    let folderId = drawing.folderId;
    if (dto.folderId !== undefined) {
      folderId = await this.resolveFolderId(actor, dto.folderId, drawing.organizationId);
      data.folder = folderId ? { connect: { id: folderId } } : { disconnect: true };
    }
    if (dto.name !== undefined) {
      data.name = name;
    }

    if (Object.keys(data).length === 0) {
      return toDrawingSummaryDto(drawing, (await this.signThumbnails([drawing])).get(drawing.id) ?? null, drawing.access);
    }
    // Checked whenever the (folder, name) pair moves, since a move can collide
    // just as easily as a rename.
    if (name !== drawing.name || folderId !== drawing.folderId) {
      await this.assertNameFree(workspace, folderId, name, drawing.id);
    }

    try {
      const row = await this.prisma.drawing.update({
        where: { id: drawing.id },
        data,
        include: drawingRelations(),
      });
      return toDrawingSummaryDto(row, (await this.signThumbnails([row])).get(row.id) ?? null, drawing.access);
    } catch (error) {
      // Backstop for the race between the check above and this write.
      if (isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        throw nameTaken(name);
      }
      throw error;
    }
  }

  /**
   * `POST /drawings/:id/move` — move a drawing to another workspace, another
   * folder, or both.
   *
   * Moving OUT of a workspace takes the drawing away from everyone in it, so it
   * needs `manage` on the source — the level a share never grants. A move that
   * stays put needs only `edit`, matching `PATCH`. The destination is a
   * separate question and needs `edit` there.
   *
   * The storage key is deliberately untouched: objects stay under
   * `users/{creator}/…` for the life of the drawing, so this is a metadata-only
   * operation and its version history follows it intact.
   */
  async move(actor: Actor, id: string, dto: MoveDrawingDto): Promise<DrawingSummaryDto> {
    const drawing = await this.requireDrawing(actor, id, 'edit');
    const target = dto.organizationId ?? null;
    const changesWorkspace = target !== drawing.organizationId;

    let access = drawing.access;
    if (changesWorkspace) {
      assertLevel(drawing.access, 'manage');
      access = await requireWorkspaceEdit(this.prisma, actor, target);
    }
    const folderId = await this.resolveDestinationFolder(actor, dto.folderId, target);

    if (changesWorkspace || folderId !== drawing.folderId) {
      await this.assertNameFree(
        { userId: actor.userId, organizationId: target },
        folderId,
        drawing.name,
        drawing.id,
      );
    }

    try {
      const row = await this.prisma.drawing.update({
        where: { id: drawing.id },
        data: { organizationId: target, folderId },
        include: drawingRelations(),
      });
      return toDrawingSummaryDto(row, (await this.signThumbnails([row])).get(row.id) ?? null, access);
    } catch (error) {
      if (isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        throw nameTaken(drawing.name);
      }
      throw error;
    }
  }

  /** `DELETE /drawings/:id` — soft delete (trash). Objects are kept. */
  async trashDrawing(actor: Actor, id: string): Promise<TrashedDrawingDto> {
    const drawing = await this.requireDrawing(actor, id, 'edit');
    const deletedAt = new Date();
    await this.prisma.drawing.update({ where: { id: drawing.id }, data: { deletedAt } });
    return { id: drawing.id, deletedAt: deletedAt.toISOString() };
  }

  /**
   * `POST /drawings/:id/restore` — clears `deletedAt`.
   *
   * The name is re-checked on the way out: names are only unique among live
   * rows, so anything could have taken this one while the drawing sat in the
   * trash. Restoring auto-suffixes rather than failing — refusing to give
   * something back because of a name would be a strange way to lose work.
   */
  async restore(actor: Actor, id: string): Promise<DrawingSummaryDto> {
    const trashed = await this.requireDrawing(actor, id, 'edit', 'trashed');
    const workspace: Workspace = { userId: actor.userId, organizationId: trashed.organizationId };
    const name = await this.freeName(workspace, trashed.folderId, trashed.name);

    const row = await this.prisma.drawing.update({
      where: { id: trashed.id },
      data: { deletedAt: null, ...(name === trashed.name ? {} : { name }) },
      include: drawingRelations(),
    });
    return toDrawingSummaryDto(row, (await this.signThumbnails([row])).get(row.id) ?? null, trashed.access);
  }

  /**
   * `DELETE /drawings/:id/permanent` — removes the row (cascading versions,
   * shares and share links) and every object under the drawing's prefix. The
   * row goes first: an orphaned object is garbage we can sweep, an orphaned row
   * is a broken drawing in the user's list.
   */
  async permanentDelete(actor: Actor, id: string): Promise<DeletedDrawingDto> {
    // `manage`, not `edit`: this is the one deletion nobody can undo, so it is
    // limited to the workspace's own admins/owner — a share never grants it.
    // The row's `ownerId` matters as much as its id: the objects live under the
    // creator's prefix, which is not the caller's when a teammate deletes an
    // org drawing, and deleting `users/{caller}/…` would silently leave the
    // real objects behind forever.
    const drawing = await this.requireDrawing(actor, id, 'manage', 'any');
    await this.prisma.drawing.delete({ where: { id: drawing.id } });
    try {
      await this.storage.deletePrefix(drawingPrefix(drawing.ownerId, drawing.id));
    } catch (error) {
      this.logger.warn(`permanentDelete(${id}): object cleanup failed: ${(error as Error).message}`);
    }
    return { id: drawing.id };
  }

  /**
   * `DELETE /drawings/trash?organizationId=` — permanently deletes every
   * trashed row in one workspace.
   *
   * Design decisions:
   *
   * - **An org's trash needs `admin`.** It holds work created by other members,
   *   and "empty trash" is not recoverable; a plain member can still bin and
   *   permanently delete their own rows one at a time.
   * - **Rows first, objects after.** The same reasoning as
   *   `permanentDelete`: an orphaned object is sweepable garbage, an orphaned
   *   row is a broken drawing. Prefix deletions then run in a bounded pool
   *   (`DELETE_CONCURRENCY`) so emptying a 500-drawing trash neither serialises
   *   into minutes nor opens 500 sockets, and a failure only costs storage.
   */
  async emptyTrash(actor: Actor, organizationId?: string | null): Promise<EmptyTrashResultDto> {
    const workspace = await this.organizations.resolveWorkspace(actor.userId, organizationId);
    if (workspace.organizationId !== null) {
      await this.organizations.requireMembership(actor.userId, workspace.organizationId, OrgRole.ADMIN);
    }

    const rows = await this.prisma.drawing.findMany({
      where: { ...drawingScope(workspace), deletedAt: { not: null } },
      select: { id: true, ownerId: true },
    });
    if (rows.length === 0) {
      return { deleted: 0 };
    }

    const { count } = await this.prisma.drawing.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });

    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(DELETE_CONCURRENCY, rows.length) }, async () => {
        for (let i = next++; i < rows.length; i = next++) {
          const row = rows[i];
          await this.storage
            .deletePrefix(drawingPrefix(row.ownerId, row.id))
            .catch((error: unknown) =>
              this.logger.warn(`emptyTrash(${row.id}): object cleanup failed: ${(error as Error).message}`),
            );
        }
      }),
    );
    return { deleted: count };
  }

  // ---------------------------------------------------------------------------
  // Thumbnails & uploads
  // ---------------------------------------------------------------------------

  /**
   * `PUT /drawings/:id/thumbnail` — stores a PNG rendered by the editor. Each
   * render gets a NEW key so the presigned URL changes only when the image
   * does, which keeps the hour-stable URLs cacheable without going stale.
   */
  async setThumbnail(actor: Actor, id: string, png: Buffer): Promise<ThumbnailResultDto> {
    if (!Buffer.isBuffer(png) || png.length === 0) {
      throw ApiException.unsupportedMediaType('NOT_PNG', 'Body must be a PNG image');
    }
    if (png.length > this.maxThumbnailBytes) {
      throw ApiException.payloadTooLarge(this.maxThumbnailBytes, 'Thumbnail too large');
    }
    if (png.length < PNG_MAGIC.length || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      throw ApiException.unsupportedMediaType('NOT_PNG', 'Body must be a PNG image');
    }

    const drawing = await this.requireDrawing(actor, id, 'edit');
    const key = thumbnailKey(drawing.ownerId, id, Date.now());
    await this.storage.putObject(key, png, PNG_CONTENT_TYPE, 'public, max-age=3600');

    const previous = drawing.thumbnailKey;
    await this.prisma.drawing.update({ where: { id: drawing.id }, data: { thumbnailKey: key } });
    if (previous && previous !== key) {
      void this.storage
        .deleteObject(previous)
        .catch((error: unknown) => this.logger.warn(`thumbnail cleanup failed: ${(error as Error).message}`));
    }

    const signed = await this.storage.presignGet(key, this.thumbnailTtlSec, {
      responseContentType: PNG_CONTENT_TYPE,
      signingDate: hourFloor(),
    });
    return { thumbnailUrl: signed.url };
  }

  /**
   * `POST /uploads/presign` — a browser-direct PUT into the user's upload
   * prefix. Content type and length are baked into the signature, so the
   * browser cannot exceed the size it declared here.
   */
  async presignUpload(actor: Actor, dto: PresignUploadDto): Promise<PresignDto> {
    const safeName = sanitizeFileName(dto.fileName);
    const extension = fileExtension(safeName);
    if (!ALLOWED_UPLOAD_EXTENSIONS.includes(extension as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number])) {
      throw ApiException.unsupportedMediaType('UNSUPPORTED_FILE_TYPE', 'Only .dxf and .dwg files can be uploaded');
    }
    if (dto.byteSize > this.maxUploadBytes) {
      throw ApiException.payloadTooLarge(this.maxUploadBytes, 'File is too large to upload');
    }

    const key = uploadKey(actor.userId, randomUUID(), safeName);
    const contentType = dto.contentType?.trim() || 'application/octet-stream';
    const presigned = await this.storage.presignPut(key, contentType, dto.byteSize, PRESIGN_PUT_TTL_SECONDS);
    return { uploadUrl: presigned.url, key, expiresAt: presigned.expiresAt };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Fetches one drawing and resolves what the caller may do with it, refusing
   * anything below `minLevel`.
   *
   * The row is read by id *without* a scope predicate and judged afterwards
   * (`resolveDrawingAccess`), because a share — on the drawing or on any
   * ancestor folder — grants access that no workspace `WHERE` fragment can
   * express. Nothing at all is 404 `DRAWING_NOT_FOUND` (never 403, so a probe
   * cannot learn that an id exists); seeing it but not being allowed the
   * operation is 403 `FORBIDDEN`.
   *
   * `lifecycle` decides which rows count: `live` everywhere, `trashed` for
   * restore, `any` for permanent deletion.
   */
  async requireDrawing(
    actor: Actor,
    id: string,
    minLevel: AccessLevel = 'view',
    lifecycle: Lifecycle = 'live',
  ): Promise<DrawingWithAccess> {
    const row = isCuid(id)
      ? await this.prisma.drawing.findFirst({
          where: { id, ...deletedFilter(lifecycle) },
          include: drawingRelations(),
        })
      : null;
    const access = row ? await resolveDrawingAccess(this.prisma, actor, row) : null;
    if (!row || !access) {
      throw notFound();
    }
    assertLevel(access, minLevel);
    return { ...row, access };
  }

  /** 404 `VERSION_NOT_FOUND` for a version that never existed or was pruned. */
  private async requireVersion(
    drawingId: string,
    version: number,
  ): Promise<{ storageKey: string; byteSize: number }> {
    const row = Number.isInteger(version) && version >= 1
      ? await this.prisma.drawingVersion.findUnique({
          where: { drawingId_version: { drawingId, version } },
          select: { storageKey: true, byteSize: true },
        })
      : null;
    if (!row) {
      throw ApiException.notFound('VERSION_NOT_FOUND', 'That version is no longer available');
    }
    return row;
  }

  /**
   * The `WHERE` and the page-wide base access for one `GET /drawings` request.
   * See `list` for the three scopes.
   */
  private async listContext(
    actor: Actor,
    query: ListDrawingsDto,
  ): Promise<{ where: Prisma.DrawingWhereInput; base: Access | null }> {
    const nameFilter = query.q ? { name: { contains: query.q, mode: Prisma.QueryMode.insensitive } } : {};
    const folderId = folderFilter(query.folderId);

    if (folderId !== null) {
      // The folder is authorized once and decides the workspace, so browsing a
      // folder somebody shared with you is the same code path as your own.
      const folder = await this.folders.requireFolder(actor, folderId, 'view');
      return { where: { folderId: folder.id, deletedAt: null, ...nameFilter }, base: folder.access };
    }

    if (query.scope === 'shared') {
      return { where: { ...sharedDrawingScope(actor), deletedAt: null, ...nameFilter }, base: null };
    }

    const workspace = await this.organizations.resolveWorkspace(actor.userId, query.organizationId);
    return {
      where: { ...drawingScope(workspace), deletedAt: null, folderId: null, ...nameFilter },
      base: await workspaceAccess(this.prisma, actor, workspace.organizationId),
    };
  }

  /**
   * Per-row access for a page: one shares query for the whole page, merged with
   * the level its context already established (`mergeListedAccess`). Resolving
   * each row from scratch would cost a membership read and an ancestor walk per
   * row.
   */
  private async accessFor(actor: Actor, rows: Drawing[], base: Access | null): Promise<Map<string, Access>> {
    const map = new Map<string, Access>();
    if (rows.length === 0) {
      return map;
    }
    const shares = await this.prisma.share.findMany({
      where: {
        drawingId: { in: rows.map((row) => row.id) },
        AND: [liveShare(), shareTargets(actor)],
      },
      select: { drawingId: true, permission: true },
    });

    const byDrawing = new Map<string, AccessLevel>();
    for (const share of shares) {
      if (!share.drawingId) {
        continue;
      }
      if (byDrawing.get(share.drawingId) !== 'edit') {
        byDrawing.set(share.drawingId, permissionLevel(share.permission));
      }
    }
    for (const row of rows) {
      map.set(row.id, mergeListedAccess(base, byDrawing.get(row.id) ?? null));
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Name uniqueness
  // ---------------------------------------------------------------------------

  /**
   * A free sibling name derived from `desired`.
   *
   * One query fetches the names already taken in this folder that could
   * possibly collide (`startsWith` the stem), then candidates are tried in
   * memory — so adding the 50th "Untitled" costs the same single round-trip as
   * the first. `candidates` decides the shape of the escalation: plain numeric
   * suffixes for a new drawing, `(copy)` / `(copy 2)` for a duplicate.
   */
  private async freeName(
    workspace: Workspace,
    folderId: string | null,
    desired: string,
    candidates: (base: string, attempt: number) => string = numberedCandidate,
  ): Promise<string> {
    const taken = await this.prisma.drawing.findMany({
      where: {
        ...drawingScope(workspace),
        deletedAt: null,
        folderId,
        name: { startsWith: stemOfName(desired) },
      },
      select: { name: true },
    });
    if (taken.length === 0) {
      return desired;
    }
    const used = new Set(taken.map((row) => row.name));
    for (let attempt = 0; ; attempt++) {
      const candidate = candidates(desired, attempt);
      if (!used.has(candidate)) {
        return candidate;
      }
    }
  }

  /**
   * 409 `NAME_TAKEN` when a sibling already uses `name`. Used only by explicit
   * rename and move: everywhere else auto-suffixes instead (see the class
   * JSDoc).
   */
  private async assertNameFree(
    workspace: Workspace,
    folderId: string | null,
    name: string,
    exceptId: string,
  ): Promise<void> {
    const clash = await this.prisma.drawing.findFirst({
      where: {
        ...drawingScope(workspace),
        deletedAt: null,
        folderId,
        name,
        id: { not: exceptId },
      },
      select: { id: true },
    });
    if (clash) {
      throw nameTaken(name);
    }
  }

  /**
   * Creates the row and its version-1 record in one transaction, then writes
   * the object; a failed write removes the row so no drawing ever appears in a
   * listing without a payload behind it. The storage key embeds the row's cuid,
   * which is why the object cannot be written first.
   */
  private async createDrawingRow(params: {
    userId: string;
    workspace: Workspace;
    name: string;
    folderId: string | null;
    format: DrawingFormat;
    byteSize: number;
    write: (key: string) => Promise<void>;
  }): Promise<DrawingRow> {
    const { userId, workspace, name, folderId, format, byteSize } = params;

    let row: DrawingRow;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.drawing.create({
          data: {
            ownerId: userId,
            organizationId: workspace.organizationId,
            folderId,
            name,
            format,
            storageKey: '',
            byteSize,
            currentVersion: 1,
          },
        });
        const key = drawingVersionKey(userId, created.id, 1);
        await tx.drawingVersion.create({ data: { drawingId: created.id, version: 1, storageKey: key, byteSize } });
        return tx.drawing.update({
          where: { id: created.id },
          data: { storageKey: key },
          include: drawingRelations(),
        });
      });
    } catch (error) {
      // `freeName` picked a name that was free a moment ago and has since been
      // taken. Rare enough to hand back to the caller rather than re-derive.
      if (isPrismaKnownError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        throw nameTaken(name);
      }
      throw error;
    }

    try {
      await params.write(row.storageKey);
    } catch (error) {
      await this.prisma.drawing
        .delete({ where: { id: row.id } })
        .catch((cleanup: unknown) => this.logger.error(`createDrawingRow rollback failed: ${(cleanup as Error).message}`));
      this.logger.error(`createDrawingRow storage write failed: ${(error as Error).message}`);
      throw new ApiException(HttpStatus.BAD_GATEWAY, 'STORAGE_WRITE_FAILED', 'Could not store the drawing; try again');
    }
    return row;
  }

  /**
   * Shared tail of `duplicate` and `copy`: a new row in `workspace` whose
   * payload is a server-side object copy, with the thumbnail carried over
   * best-effort (a failed thumbnail copy must not fail the copy).
   */
  private async copyInto(
    source: DrawingRow,
    workspace: Workspace,
    folderId: string | null,
    name: string,
    access: Access,
  ): Promise<DrawingSummaryDto> {
    const row = await this.createDrawingRow({
      userId: workspace.userId,
      workspace,
      name,
      folderId,
      format: source.format,
      byteSize: source.byteSize,
      write: (key) => this.storage.copyObject(source.storageKey, key, DXF_CONTENT_TYPE),
    });

    let thumbnailUrl: string | null = null;
    if (source.thumbnailKey) {
      const destination = thumbnailKey(row.ownerId, row.id, Date.now());
      try {
        await this.storage.copyObject(source.thumbnailKey, destination, PNG_CONTENT_TYPE);
        row.thumbnailKey = destination;
        await this.prisma.drawing.update({ where: { id: row.id }, data: { thumbnailKey: destination } });
        thumbnailUrl = (await this.signThumbnails([row])).get(row.id) ?? null;
      } catch (error) {
        this.logger.warn(`copy(${source.id}): thumbnail copy failed: ${(error as Error).message}`);
      }
    }
    return toDrawingSummaryDto(row, thumbnailUrl, access);
  }

  /** Re-reads the live version so the 409 body tells the client where to resync. */
  private async versionConflict(id: string, fallback: number): Promise<ApiException> {
    const fresh = await this.prisma.drawing.findFirst({
      where: { id, deletedAt: null },
      select: { currentVersion: true },
    });
    return ApiException.conflict('VERSION_CONFLICT', 'This drawing was modified elsewhere', {
      currentVersion: fresh?.currentVersion ?? fallback,
    });
  }

  /**
   * `null`/`undefined` → root; anything else must be a folder the caller can
   * write to. When `expectOrganizationId` is given the folder must also be in
   * that workspace, which is what stops a `PATCH` from moving a drawing out of
   * an org (and out of its teammates' sight) by pointing it at a personal
   * folder.
   */
  private async resolveFolderId(
    actor: Actor,
    folderId: string | null | undefined,
    expectOrganizationId?: string | null,
  ): Promise<string | null> {
    if (folderId === null || folderId === undefined || folderId === '' || folderId === ROOT_FOLDER) {
      return null;
    }
    const folder = await this.folders.requireFolder(actor, folderId, 'edit');
    if (expectOrganizationId !== undefined && folder.organizationId !== expectOrganizationId) {
      throw crossWorkspace();
    }
    return folder.id;
  }

  /**
   * Destination folder of an explicit move/copy: it must exist, be writable,
   * and actually live in the workspace the request named — otherwise the two
   * halves of the request contradict each other and 422
   * `CROSS_WORKSPACE_MOVE` says so instead of one of them silently winning.
   */
  private resolveDestinationFolder(
    actor: Actor,
    folderId: string | null | undefined,
    organizationId: string | null,
  ): Promise<string | null> {
    return this.resolveFolderId(actor, folderId, organizationId);
  }

  /**
   * Resolves where a new drawing goes: the folder, the workspace that follows
   * from it, and the caller's level there.
   *
   * A `folderId` decides the workspace — the folder's own — and the requested
   * `organizationId` is ignored, so a drawing can never end up in an org folder
   * while claiming to be personal (or vice versa). Only at the root does the
   * request get to choose, and then `edit` in that workspace is verified: a
   * viewer belongs to the org but may not add to it.
   */
  private async resolveTarget(
    actor: Actor,
    folderId: string | null | undefined,
    organizationId: string | null | undefined,
  ): Promise<{ folderId: string | null; workspace: Workspace; access: Access }> {
    const resolved = await this.resolveFolderId(actor, folderId);
    if (resolved === null) {
      const workspace = await this.organizations.resolveWorkspace(actor.userId, organizationId);
      return {
        folderId: null,
        workspace,
        access: await requireWorkspaceEdit(this.prisma, actor, workspace.organizationId),
      };
    }
    const folder = await this.folders.requireFolder(actor, resolved, 'edit');
    return {
      folderId: resolved,
      workspace: { userId: actor.userId, organizationId: folder.organizationId },
      access: folder.access,
    };
  }

  /** Blank template seeded with the user's `$INSUNITS` preference (mm on a miss). */
  private async blankTemplateFor(userId: string): Promise<string> {
    const prefs = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { units: true },
    });
    return blankDxf(insunitsForUnit((prefs?.units ?? Units.MM).toLowerCase()));
  }

  private assertInlineSize(byteSize: number): void {
    if (byteSize > this.maxInlineBytes) {
      throw ApiException.payloadTooLarge(this.maxInlineBytes, 'DXF payload exceeds the inline save limit');
    }
  }

  /**
   * Signs every row's thumbnail in one batch at an hour-floored `signingDate`:
   * the URL is then identical for every request in that hour, so the browser
   * serves the image from cache instead of re-fetching it on each dashboard
   * render. TTL (2 h by default) is comfortably longer than the 1 h window.
   */
  private async signThumbnails(rows: Drawing[]): Promise<Map<string, string>> {
    const withThumb = rows.filter((row): row is Drawing & { thumbnailKey: string } => !!row.thumbnailKey);
    if (withThumb.length === 0) {
      return new Map();
    }
    const signingDate = hourFloor();
    const signed = await Promise.all(
      withThumb.map((row) =>
        this.storage
          .presignGet(row.thumbnailKey, this.thumbnailTtlSec, {
            responseContentType: PNG_CONTENT_TYPE,
            signingDate,
          })
          .then((url) => [row.id, url.url] as const)
          .catch(() => null),
      ),
    );
    return new Map(signed.filter((entry): entry is readonly [string, string] => entry !== null));
  }

  /** Shared tail of `list`: sign thumbnails, resolve access, build the page. */
  private async toPage(
    actor: Actor,
    rows: DrawingRow[],
    limit: number,
    sort: DrawingSort,
    base: Access | null,
  ): Promise<Page<DrawingSummaryDto>> {
    const hasMore = rows.length > limit;
    const kept = hasMore ? rows.slice(0, limit) : rows;
    const [thumbs, access] = await Promise.all([this.signThumbnails(kept), this.accessFor(actor, kept, base)]);
    const last = kept[kept.length - 1];
    return {
      items: kept.map((row) => toDrawingSummaryDto(row, thumbs.get(row.id) ?? null, access.get(row.id))),
      nextCursor: hasMore && last ? encodeCursor({ k: cursorKeyFor(last, sort), id: last.id }) : null,
    };
  }

  /**
   * One numbered page plus the total, for the dashboard's pager.
   *
   * The COUNT runs alongside the page rather than after it, and the requested
   * page is clamped to the last non-empty one so a stale "page 6" link still
   * shows rows after enough drawings have been deleted, instead of an
   * unexplained empty table. `nextCursor` stays `null`: mixing a cursor into an
   * offset response would invite a caller to page by both at once.
   */
  private async offsetPage(
    actor: Actor,
    where: Prisma.DrawingWhereInput,
    orderBy: Prisma.DrawingOrderByWithRelationInput[],
    pageSize: number,
    requestedPage: number,
    base: Access | null,
  ): Promise<Page<DrawingSummaryDto>> {
    const total = await this.prisma.drawing.count({ where });
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(clampPage(requestedPage), lastPage);

    const rows = await this.prisma.drawing.findMany({
      where,
      orderBy,
      include: drawingRelations(),
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const [thumbs, access] = await Promise.all([this.signThumbnails(rows), this.accessFor(actor, rows, base)]);
    return {
      items: rows.map((row) => toDrawingSummaryDto(row, thumbs.get(row.id) ?? null, access.get(row.id))),
      nextCursor: null,
      total,
      page,
      pageSize,
    };
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function notFound(): ApiException {
  return ApiException.notFound('DRAWING_NOT_FOUND', 'Drawing not found');
}

/** Wording deliberately matches `FoldersService` so the client needs one handler. */
function nameTaken(name: string): ApiException {
  return ApiException.conflict('NAME_TAKEN', `A drawing named "${name}" already exists here`);
}

function crossWorkspace(): ApiException {
  return ApiException.unprocessable(
    'CROSS_WORKSPACE_MOVE',
    'A drawing cannot be moved between your personal drawings and an organization',
  );
}

/** Which `deleted_at` state a lookup accepts. */
function deletedFilter(lifecycle: Lifecycle): Prisma.DrawingWhereInput {
  switch (lifecycle) {
    case 'trashed':
      return { deletedAt: { not: null } };
    case 'any':
      return {};
    case 'live':
    default:
      return { deletedAt: null };
  }
}

/**
 * `("Plan", 0) → "Plan"`, then `"Plan (2)"`, `"Plan (3)"`, … Truncates the stem
 * rather than the suffix when the result would exceed `MAX_NAME_LENGTH`, since a
 * name ending in a half-written "(1" reads like corruption.
 */
function numberedCandidate(base: string, attempt: number): string {
  if (attempt === 0) {
    return base;
  }
  const suffix = ` (${attempt + 1})`;
  const room = Math.max(1, MAX_NAME_LENGTH - suffix.length);
  return `${base.slice(0, room)}${suffix}`;
}

/** `("Plan", 0) → "Plan (copy)"`, then `"Plan (copy 2)"`, … */
function copyCandidate(base: string, attempt: number): string {
  let name = copyName(base, MAX_NAME_LENGTH);
  for (let i = 0; i < attempt; i++) {
    name = copyName(name, MAX_NAME_LENGTH);
  }
  return name;
}

/**
 * The part of a name a suffixed variant would share, used to narrow the
 * "already taken" query. `"Plan (2)"` and `"Plan (copy)"` both stem from
 * `"Plan"`, so starting from the stem finds every variant in one go.
 */
function stemOfName(name: string): string {
  return /^(.*?)\s*(?:\((?:copy(?:\s\d+)?|\d+)\))?$/.exec(name)?.[1] || name;
}

/**
 * 409 before we touch anything when the client's `If-Match` is stale. The
 * reservation in `commitVersion` catches the race that opens after this check;
 * this one just gives a cheaper, clearer answer in the common case.
 */
function assertVersionMatches(drawing: Drawing, expected: number | null): void {
  if (expected !== null && expected !== drawing.currentVersion) {
    throw ApiException.conflict('VERSION_CONFLICT', 'This drawing was modified elsewhere', {
      currentVersion: drawing.currentVersion,
    });
  }
}

/** `?folderId=root` or omitted → the root level (`NULL`). */
function folderFilter(folderId: string | undefined): string | null {
  return folderId === undefined || folderId === '' || folderId === ROOT_FOLDER ? null : folderId;
}

/** Total orderings — every sort ends in `id` so the keyset cursor is unambiguous. */
function orderByFor(sort: DrawingSort): Prisma.DrawingOrderByWithRelationInput[] {
  switch (sort) {
    case 'name':
      return [{ name: 'asc' }, { id: 'asc' }];
    case 'opened':
      return [{ lastOpenedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
    case 'updated':
    default:
      return [{ updatedAt: 'desc' }, { id: 'desc' }];
  }
}

/** The sort key stored in the opaque cursor (diagnostic; the seek uses `id`). */
function cursorKeyFor(row: Drawing, sort: DrawingSort): string {
  switch (sort) {
    case 'name':
      return row.name;
    case 'opened':
      return row.lastOpenedAt ? row.lastOpenedAt.toISOString() : '';
    case 'updated':
    default:
      return row.updatedAt.toISOString();
  }
}

/** Now, truncated to the top of the hour (see `signThumbnails`). */
function hourFloor(now: number = Date.now()): Date {
  return new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
}

/**
 * `Site plan` → `site-plan.dxf` for `?download=1`; with a `version` it becomes
 * `site-plan-v3.dxf`, so downloading three versions of one drawing does not
 * produce three files the browser has to number itself.
 */
function downloadFileName(row: Drawing, version?: number): string {
  const extension = row.format === DrawingFormat.DWG ? 'dwg' : 'dxf';
  const stem = sanitizeFileName(row.name).replace(/\.(dxf|dwg)$/i, '') || 'drawing';
  return version === undefined ? `${stem}.${extension}` : `${stem}-v${version}.${extension}`;
}

/** File name without its extension. */
function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem || 'Drawing';
}

/**
 * Strips a trailing `.dxf`/`.dwg` from a *display* name.
 *
 * Narrower than `stemOf` on purpose: that one drops whatever follows the last
 * dot, which is right for a file name but would turn a drawing called
 * "Bridge rev 2.1" into "Bridge rev 2".
 */
function stripExtension(name: string): string {
  return name.replace(/\.(dxf|dwg)$/i, '').trim() || name;
}
