import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ApiException } from '../common/errors/api-error';
import { isCuid } from '../common/pipes/parse-cuid.pipe';
import { HEAD_BYTES, TAIL_BYTES, looksLikeDxf, looksLikeDxfRanges } from '../common/utils/dxf-sniff';
import { clampLimit, decodeCursor, encodeCursor, type Page } from '../common/utils/pagination';
import type { Env } from '../config/env.schema';
import { FoldersService } from '../folders/folders.service';
import type { Drawing } from '../generated/prisma/client';
import { DrawingFormat, Prisma, Units } from '../generated/prisma/client';
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
  type PresignDto,
  type SaveResultDto,
  type ThumbnailResultDto,
  type TrashedDrawingDto,
} from './dto/drawing.dto';
import type { CompleteContentDto, CreateDrawingDto, DuplicateDrawingDto, PresignContentDto, UpdateDrawingDto } from './dto/create-drawing.dto';
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
import { copyName, formatFromExtension, toDrawingDto, toDrawingSummaryDto } from './drawings.mapper';
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

/** Raised inside the reservation transaction to force a rollback on a lost race. */
class ReservationLost extends Error {}

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
 * - **Ownership violations are 404, never 403.** Every query is scoped by
 *   `ownerId` and a miss is `DRAWING_NOT_FOUND`, so a probe cannot learn that
 *   an id exists. Soft-deleted rows are excluded everywhere except `trash`,
 *   `restore` and `permanentDelete`.
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
   * `GET /drawings` — keyset page of the user's live drawings.
   *
   * Every sort ends in an id tie-breaker so the ordering is total and Prisma's
   * `cursor`/`skip: 1` seek is unambiguous; `take: limit + 1` tells us whether a
   * next page exists without a second COUNT.
   */
  async list(userId: string, query: ListDrawingsDto): Promise<Page<DrawingSummaryDto>> {
    const limit = clampLimit(query.limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const sort: DrawingSort = query.sort ?? 'updated';
    const cursor = decodeCursor(query.cursor);

    const where: Prisma.DrawingWhereInput = {
      ownerId: userId,
      deletedAt: null,
      folderId: folderFilter(query.folderId),
      ...(query.q ? { name: { contains: query.q, mode: Prisma.QueryMode.insensitive } } : {}),
    };

    const rows = await this.prisma.drawing.findMany({
      where,
      orderBy: orderByFor(sort),
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    });

    return this.toPage(rows, limit, sort);
  }

  /** `GET /drawings/recent` — most recently opened first, never paginated. */
  async recent(userId: string, limit?: number): Promise<DrawingSummaryDto[]> {
    const take = clampLimit(limit, 12, MAX_RECENT_LIMIT);
    const rows = await this.prisma.drawing.findMany({
      where: { ownerId: userId, deletedAt: null, lastOpenedAt: { not: null } },
      orderBy: orderByFor('opened'),
      take,
    });
    const thumbs = await this.signThumbnails(rows);
    return rows.map((row) => toDrawingSummaryDto(row, thumbs.get(row.id) ?? null));
  }

  /** `GET /drawings/trash` — the only listing that shows soft-deleted rows. */
  async trash(userId: string, query: ListTrashDto): Promise<Page<DrawingSummaryDto>> {
    const limit = clampLimit(query.limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.drawing.findMany({
      where: { ownerId: userId, deletedAt: { not: null } },
      orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const kept = hasMore ? rows.slice(0, limit) : rows;
    const thumbs = await this.signThumbnails(kept);
    const last = kept[kept.length - 1];
    return {
      items: kept.map((row) => toDrawingSummaryDto(row, thumbs.get(row.id) ?? null)),
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
    userId: string,
    id: string,
    options: { touch?: boolean; download?: boolean } = {},
  ): Promise<DrawingDto> {
    const row = await this.requireDrawing(userId, id);

    if (options.touch !== false) {
      const now = new Date();
      await this.prisma
        .$executeRaw`UPDATE "drawings" SET "last_opened_at" = ${now} WHERE "id" = ${id} AND "owner_id" = ${userId} AND "deleted_at" IS NULL`;
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

    return toDrawingDto(row, thumbs.get(row.id) ?? null, download);
  }

  // ---------------------------------------------------------------------------
  // Create / duplicate / import
  // ---------------------------------------------------------------------------

  /** `POST /drawings` → 201. Without `initialDxf` the blank template is stored. */
  async create(userId: string, dto: CreateDrawingDto): Promise<DrawingDto> {
    const folderId = await this.resolveFolderId(userId, dto.folderId ?? null);
    const dxf = dto.initialDxf ?? (await this.blankTemplateFor(userId));

    const byteSize = Buffer.byteLength(dxf, 'utf8');
    this.assertInlineSize(byteSize);
    if (!looksLikeDxf(dxf)) {
      throw ApiException.unprocessable('INVALID_DXF', 'Payload does not look like a DXF file');
    }

    const row = await this.createDrawingRow({
      userId,
      name: dto.name.trim(),
      folderId,
      format: DrawingFormat.DXF,
      byteSize,
      write: (key) => this.storage.putObject(key, dxf, DXF_CONTENT_TYPE).then(() => undefined),
    });

    const download = await this.storage.presignGet(row.storageKey, this.downloadTtlSec, {
      responseContentType: DXF_CONTENT_TYPE,
    });
    return toDrawingDto(row, null, download);
  }

  /** `POST /drawings/:id/duplicate` → 201. Server-side copy; no bytes transit the API. */
  async duplicate(userId: string, id: string, dto: DuplicateDrawingDto): Promise<DrawingSummaryDto> {
    const source = await this.requireDrawing(userId, id);
    const name = (dto.name ?? copyName(source.name, MAX_NAME_LENGTH)).trim();

    const row = await this.createDrawingRow({
      userId,
      name,
      folderId: source.folderId,
      format: source.format,
      byteSize: source.byteSize,
      write: (key) => this.storage.copyObject(source.storageKey, key, DXF_CONTENT_TYPE),
    });

    // Thumbnail is a nicety: a failed copy must not fail the duplicate.
    let thumbnailUrl: string | null = null;
    if (source.thumbnailKey) {
      const destination = thumbnailKey(userId, row.id, Date.now());
      try {
        await this.storage.copyObject(source.thumbnailKey, destination, PNG_CONTENT_TYPE);
        row.thumbnailKey = destination;
        await this.prisma.drawing.update({ where: { id: row.id }, data: { thumbnailKey: destination } });
        thumbnailUrl = (await this.signThumbnails([row])).get(row.id) ?? null;
      } catch (error) {
        this.logger.warn(`duplicate(${id}): thumbnail copy failed: ${(error as Error).message}`);
      }
    }
    return toDrawingSummaryDto(row, thumbnailUrl);
  }

  /**
   * `POST /drawings/import` → 201. Adopts an object the browser already PUT to
   * its own upload prefix; the key is checked by string prefix (no DB lookup),
   * then HEADed and sniffed before any row is written.
   */
  async importUpload(userId: string, dto: ImportDrawingDto): Promise<DrawingSummaryDto> {
    if (!isOwnedUploadKey(dto.key, userId)) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN_KEY', 'That key does not belong to your uploads');
    }
    const folderId = await this.resolveFolderId(userId, dto.folderId ?? null);

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
      userId,
      name: (dto.name ?? stemOf(fileName)).trim().slice(0, MAX_NAME_LENGTH),
      folderId,
      format,
      byteSize: head.size,
      write: (key) => this.storage.copyObject(dto.key, key, DXF_CONTENT_TYPE),
    });

    // The staged upload is now redundant; failing to reap it is not fatal.
    void this.storage
      .deleteObject(dto.key)
      .catch((error: unknown) => this.logger.warn(`import: staging cleanup failed: ${(error as Error).message}`));

    return toDrawingSummaryDto(row, null);
  }

  // ---------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------

  /**
   * `PUT /drawings/:id/content` — inline save. `expectedVersion` is the parsed
   * `If-Match`; `null` means the client chose to force-overwrite.
   */
  async saveContent(userId: string, id: string, dxf: string, expectedVersion: number | null): Promise<SaveResultDto> {
    const byteSize = Buffer.byteLength(dxf, 'utf8');
    this.assertInlineSize(byteSize);
    if (!looksLikeDxf(dxf)) {
      throw ApiException.unprocessable('INVALID_DXF', 'Payload does not look like a DXF file');
    }

    const drawing = await this.requireDrawing(userId, id);
    assertVersionMatches(drawing, expectedVersion);
    return this.commitVersion(userId, drawing, byteSize, (key) =>
      this.storage.putObject(key, dxf, DXF_CONTENT_TYPE).then(() => undefined),
    );
  }

  /**
   * `POST /drawings/:id/content/presign` — a staging key the browser can PUT to
   * directly, so a 5 MB DXF never passes through this process.
   */
  async presignContent(userId: string, id: string, dto: PresignContentDto): Promise<PresignDto> {
    this.assertInlineSize(dto.byteSize);
    await this.requireDrawing(userId, id);
    const key = stagingKey(userId, id, randomUUID());
    const presigned = await this.storage.presignPut(key, DXF_CONTENT_TYPE, dto.byteSize, PRESIGN_PUT_TTL_SECONDS);
    return { uploadUrl: presigned.url, key, expiresAt: presigned.expiresAt };
  }

  /** `POST /drawings/:id/content/complete` — promotes a staged object to a version. */
  async completeContent(
    userId: string,
    id: string,
    dto: CompleteContentDto,
    expectedVersion: number | null,
  ): Promise<SaveResultDto> {
    this.assertInlineSize(dto.byteSize);
    const drawing = await this.requireDrawing(userId, id);

    // The key must be a staging key of THIS drawing, owned by THIS user.
    if (!dto.key.startsWith(`${drawingPrefix(userId, id)}staging/`) || dto.key.includes('..')) {
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
    const result = await this.commitVersion(userId, drawing, head.size, (key) =>
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
    userId: string,
    drawing: Drawing,
    byteSize: number,
    writeObject: (destinationKey: string) => Promise<void>,
  ): Promise<SaveResultDto> {
    const expected = drawing.currentVersion;
    const next = expected + 1;
    const newKey = drawingVersionKey(userId, drawing.id, next);

    // 1 — reserve the version. Either both statements commit or neither does.
    let reserved: Drawing;
    try {
      reserved = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.drawing.updateMany({
          where: { id: drawing.id, ownerId: userId, deletedAt: null, currentVersion: expected },
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
        throw await this.versionConflict(userId, drawing.id, next);
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
  // Metadata / lifecycle
  // ---------------------------------------------------------------------------

  /** `PATCH /drawings/:id` — rename and/or move. */
  async update(userId: string, id: string, dto: UpdateDrawingDto): Promise<DrawingSummaryDto> {
    const drawing = await this.requireDrawing(userId, id);
    const data: Prisma.DrawingUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.folderId !== undefined) {
      const folderId = await this.resolveFolderId(userId, dto.folderId);
      data.folder = folderId ? { connect: { id: folderId } } : { disconnect: true };
    }
    if (Object.keys(data).length === 0) {
      return toDrawingSummaryDto(drawing, (await this.signThumbnails([drawing])).get(drawing.id) ?? null);
    }
    const row = await this.prisma.drawing.update({ where: { id: drawing.id }, data });
    return toDrawingSummaryDto(row, (await this.signThumbnails([row])).get(row.id) ?? null);
  }

  /** `DELETE /drawings/:id` — soft delete (trash). Objects are kept. */
  async trashDrawing(userId: string, id: string): Promise<TrashedDrawingDto> {
    const deletedAt = new Date();
    const res = await this.prisma.drawing.updateMany({
      where: { id, ownerId: userId, deletedAt: null },
      data: { deletedAt },
    });
    if (res.count === 0) {
      throw notFound();
    }
    return { id, deletedAt: deletedAt.toISOString() };
  }

  /** `POST /drawings/:id/restore` — clears `deletedAt`. */
  async restore(userId: string, id: string): Promise<DrawingSummaryDto> {
    const res = await this.prisma.drawing.updateMany({
      where: { id, ownerId: userId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (res.count === 0) {
      throw notFound();
    }
    const row = await this.prisma.drawing.findFirstOrThrow({ where: { id, ownerId: userId } });
    return toDrawingSummaryDto(row, (await this.signThumbnails([row])).get(row.id) ?? null);
  }

  /**
   * `DELETE /drawings/:id/permanent` — removes the row (cascading versions and
   * share links) and every object under the drawing's prefix. The row goes
   * first: an orphaned object is garbage we can sweep, an orphaned row is a
   * broken drawing in the user's list.
   */
  async permanentDelete(userId: string, id: string): Promise<DeletedDrawingDto> {
    const res = await this.prisma.drawing.deleteMany({ where: { id, ownerId: userId } });
    if (res.count === 0) {
      throw notFound();
    }
    try {
      await this.storage.deletePrefix(drawingPrefix(userId, id));
    } catch (error) {
      this.logger.warn(`permanentDelete(${id}): object cleanup failed: ${(error as Error).message}`);
    }
    return { id };
  }

  // ---------------------------------------------------------------------------
  // Thumbnails & uploads
  // ---------------------------------------------------------------------------

  /**
   * `PUT /drawings/:id/thumbnail` — stores a PNG rendered by the editor. Each
   * render gets a NEW key so the presigned URL changes only when the image
   * does, which keeps the hour-stable URLs cacheable without going stale.
   */
  async setThumbnail(userId: string, id: string, png: Buffer): Promise<ThumbnailResultDto> {
    if (!Buffer.isBuffer(png) || png.length === 0) {
      throw ApiException.unsupportedMediaType('NOT_PNG', 'Body must be a PNG image');
    }
    if (png.length > this.maxThumbnailBytes) {
      throw ApiException.payloadTooLarge(this.maxThumbnailBytes, 'Thumbnail too large');
    }
    if (png.length < PNG_MAGIC.length || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      throw ApiException.unsupportedMediaType('NOT_PNG', 'Body must be a PNG image');
    }

    const drawing = await this.requireDrawing(userId, id);
    const key = thumbnailKey(userId, id, Date.now());
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
  async presignUpload(userId: string, dto: PresignUploadDto): Promise<PresignDto> {
    const safeName = sanitizeFileName(dto.fileName);
    const extension = fileExtension(safeName);
    if (!ALLOWED_UPLOAD_EXTENSIONS.includes(extension as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number])) {
      throw ApiException.unsupportedMediaType('UNSUPPORTED_FILE_TYPE', 'Only .dxf and .dwg files can be uploaded');
    }
    if (dto.byteSize > this.maxUploadBytes) {
      throw ApiException.payloadTooLarge(this.maxUploadBytes, 'File is too large to upload');
    }

    const key = uploadKey(userId, randomUUID(), safeName);
    const contentType = dto.contentType?.trim() || 'application/octet-stream';
    const presigned = await this.storage.presignPut(key, contentType, dto.byteSize, PRESIGN_PUT_TTL_SECONDS);
    return { uploadUrl: presigned.url, key, expiresAt: presigned.expiresAt };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Owner-scoped, non-deleted fetch. A miss is 404 — never 403. */
  async requireDrawing(userId: string, id: string): Promise<Drawing> {
    const row = isCuid(id)
      ? await this.prisma.drawing.findFirst({ where: { id, ownerId: userId, deletedAt: null } })
      : null;
    if (!row) {
      throw notFound();
    }
    return row;
  }

  /**
   * Creates the row and its version-1 record in one transaction, then writes
   * the object; a failed write removes the row so no drawing ever appears in a
   * listing without a payload behind it. The storage key embeds the row's cuid,
   * which is why the object cannot be written first.
   */
  private async createDrawingRow(params: {
    userId: string;
    name: string;
    folderId: string | null;
    format: DrawingFormat;
    byteSize: number;
    write: (key: string) => Promise<void>;
  }): Promise<Drawing> {
    const { userId, name, folderId, format, byteSize } = params;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.drawing.create({
        data: { ownerId: userId, folderId, name, format, storageKey: '', byteSize, currentVersion: 1 },
      });
      const key = drawingVersionKey(userId, created.id, 1);
      await tx.drawingVersion.create({ data: { drawingId: created.id, version: 1, storageKey: key, byteSize } });
      return tx.drawing.update({ where: { id: created.id }, data: { storageKey: key } });
    });

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

  /** Re-reads the live version so the 409 body tells the client where to resync. */
  private async versionConflict(userId: string, id: string, fallback: number): Promise<ApiException> {
    const fresh = await this.prisma.drawing.findFirst({
      where: { id, ownerId: userId, deletedAt: null },
      select: { currentVersion: true },
    });
    return ApiException.conflict('VERSION_CONFLICT', 'This drawing was modified elsewhere', {
      currentVersion: fresh?.currentVersion ?? fallback,
    });
  }

  /** `null`/`undefined` → root; anything else must be one of the user's folders. */
  private async resolveFolderId(userId: string, folderId: string | null | undefined): Promise<string | null> {
    if (folderId === null || folderId === undefined || folderId === '' || folderId === ROOT_FOLDER) {
      return null;
    }
    const folder = await this.folders.requireFolder(userId, folderId);
    return folder.id;
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

  /** Shared tail of `list`: sign thumbnails, then build the keyset page. */
  private async toPage(rows: Drawing[], limit: number, sort: DrawingSort): Promise<Page<DrawingSummaryDto>> {
    const hasMore = rows.length > limit;
    const kept = hasMore ? rows.slice(0, limit) : rows;
    const thumbs = await this.signThumbnails(kept);
    const last = kept[kept.length - 1];
    return {
      items: kept.map((row) => toDrawingSummaryDto(row, thumbs.get(row.id) ?? null)),
      nextCursor: hasMore && last ? encodeCursor({ k: cursorKeyFor(last, sort), id: last.id }) : null,
    };
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function notFound(): ApiException {
  return ApiException.notFound('DRAWING_NOT_FOUND', 'Drawing not found');
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

/** `Site plan` → `site-plan.dxf` for `?download=1`. */
function downloadFileName(row: Drawing): string {
  const extension = row.format === DrawingFormat.DWG ? 'dwg' : 'dxf';
  const stem = sanitizeFileName(row.name).replace(/\.(dxf|dwg)$/i, '') || 'drawing';
  return `${stem}.${extension}`;
}

/** File name without its extension. */
function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem || 'Drawing';
}
