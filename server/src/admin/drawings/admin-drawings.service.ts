import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/errors/api-error';
import { clampPage, type Page } from '../../common/utils/pagination';
import { Prisma, type User } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { drawingPrefix } from '../../storage/storage-keys';
import { StorageService } from '../../storage/storage.service';
import type { AdminDrawingRowDto, ListDrawingsQueryDto, StorageOrphansDto } from '../dto/admin-drawing.dto';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * How many objects one orphan scan will look at.
 *
 * A bucket scan is unbounded by nature, and a support tool that can accidentally
 * list a million keys is a support tool that takes the API down. The cap is
 * reported back as `truncated` so the operator knows the answer is partial
 * rather than being told a comforting zero.
 */
const SCAN_LIMIT = 20_000;

/**
 * Drawings and object storage, from the outside.
 *
 * **Metadata only.** Nothing here returns or fetches drawing content: staff can
 * see that a drawing exists, who owns it, how big it is and whether it is in the
 * trash, and can restore or permanently delete it. Reading what a customer drew
 * is behind a separate, owner-only, audited flag that ships off.
 *
 * The orphan report exists because object storage and Postgres can disagree,
 * and until now nothing could tell you they had. Both directions matter and
 * they are not symmetric: an object with no row is garbage costing money, a row
 * with no object is a drawing that will fail to open for its owner.
 */
@Injectable()
export class AdminDrawingsService {
  private readonly logger = new Logger(AdminDrawingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(query: ListDrawingsQueryDto): Promise<Page<AdminDrawingRowDto>> {
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const where: Prisma.DrawingWhereInput = {};
    if (query.q) {
      where.name = { contains: query.q.trim(), mode: 'insensitive' };
    }
    if (query.ownerId) {
      where.ownerId = query.ownerId;
    }
    if (query.organizationId) {
      where.organizationId = query.organizationId;
    }
    if (query.deleted === 'true') {
      where.deletedAt = { not: null };
    } else if (query.deleted === 'false') {
      where.deletedAt = null;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.drawing.count({ where }),
      this.prisma.drawing.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          owner: { select: { email: true } },
          organization: { select: { name: true } },
        },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        format: row.format.toLowerCase(),
        byteSize: row.byteSize,
        currentVersion: row.currentVersion,
        ownerId: row.ownerId,
        ownerEmail: row.owner.email,
        organizationId: row.organizationId,
        organizationName: row.organization?.name ?? null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        lastOpenedAt: row.lastOpenedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: null,
      total,
      page,
      pageSize,
    };
  }

  async snapshot(id: string): Promise<Record<string, unknown> | undefined> {
    const row = await this.prisma.drawing.findUnique({
      where: { id },
      select: { id: true, name: true, ownerId: true, byteSize: true, deletedAt: true },
    });
    return row ?? undefined;
  }

  /** Lifts a drawing out of the trash, back into its owner's list. */
  async restore(actor: User, id: string): Promise<AdminDrawingRowDto> {
    const row = await this.prisma.drawing.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!row) {
      throw ApiException.notFound('DRAWING_NOT_FOUND', 'No such drawing');
    }
    if (!row.deletedAt) {
      throw ApiException.conflict('NOT_DELETED', 'That drawing is not in the trash');
    }
    await this.prisma.drawing.update({ where: { id }, data: { deletedAt: null } });
    this.logger.log(`${actor.email} restored drawing ${id}`);
    return this.one(id);
  }

  /**
   * Deletes the row and every object under the drawing's prefix.
   *
   * Row first, objects after, exactly as `DrawingsService.permanentDelete`
   * does it: an orphaned object is garbage the scan below can find, an orphaned
   * row is a broken drawing in somebody's list. The prefix is built from the
   * drawing's OWNER, not the acting staff member — objects live under the
   * creator's prefix, and deleting `users/{staff}/…` would quietly leave the
   * real files behind forever.
   */
  async purge(actor: User, id: string, reason: string): Promise<{ id: string; bytesFreed: number }> {
    const row = await this.prisma.drawing.findUnique({
      where: { id },
      select: { id: true, ownerId: true, byteSize: true, name: true },
    });
    if (!row) {
      throw ApiException.notFound('DRAWING_NOT_FOUND', 'No such drawing');
    }

    await this.prisma.drawing.delete({ where: { id } });
    try {
      await this.storage.deletePrefix(drawingPrefix(row.ownerId, row.id));
    } catch (error) {
      this.logger.warn(`purge(${id}): object cleanup failed: ${(error as Error).message}`);
    }
    this.logger.log(`${actor.email} purged drawing ${id} ("${row.name}"): ${reason}`);
    return { id: row.id, bytesFreed: row.byteSize };
  }

  /**
   * Compares the bucket with the database, both ways.
   *
   * The scan walks object keys and resolves each to the drawing id embedded in
   * its prefix, then asks Postgres once which of those ids exist. That is one
   * query rather than one per object, and it is why the cap can be as high as
   * it is.
   */
  async orphans(): Promise<StorageOrphansDto> {
    const byDrawing = new Map<string, { keys: string[]; bytes: number }>();
    let scanned = 0;
    let truncated = false;

    for await (const key of this.storage.listKeys('users/')) {
      scanned++;
      if (scanned > SCAN_LIMIT) {
        truncated = true;
        break;
      }
      const drawingId = drawingIdFromKey(key);
      if (!drawingId) {
        continue;
      }
      const entry = byDrawing.get(drawingId) ?? { keys: [], bytes: 0 };
      entry.keys.push(key);
      byDrawing.set(drawingId, entry);
    }

    const ids = [...byDrawing.keys()];
    const known = new Set(
      (await this.prisma.drawing.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((row) => row.id),
    );

    // Objects whose drawing row is gone. Sizes are fetched only for these,
    // because a HEAD per object across the whole bucket would be the expensive
    // part of an otherwise cheap scan.
    const orphanedObjects: { key: string; bytes: number }[] = [];
    let reclaimable = 0;
    for (const [drawingId, entry] of byDrawing) {
      if (known.has(drawingId)) {
        continue;
      }
      for (const key of entry.keys) {
        const head = await this.storage.headObject(key).catch(() => null);
        const bytes = head?.size ?? 0;
        reclaimable += bytes;
        orphanedObjects.push({ key, bytes });
      }
    }

    // The other direction: rows whose payload is missing. Bounded to the
    // newest rows — a full table scan with a HEAD each is not a thing to do
    // behind a synchronous request.
    const recent = await this.prisma.drawing.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: { id: true, name: true, storageKey: true, owner: { select: { email: true } } },
    });
    const brokenDrawings: StorageOrphansDto['brokenDrawings'] = [];
    for (const row of recent) {
      const head = await this.storage.headObject(row.storageKey).catch(() => null);
      if (!head) {
        brokenDrawings.push({
          id: row.id,
          name: row.name,
          ownerEmail: row.owner.email,
          storageKey: row.storageKey,
        });
      }
    }

    return {
      orphanedObjects: orphanedObjects.slice(0, 500),
      brokenDrawings,
      truncated,
      scannedObjects: scanned,
      reclaimableBytes: reclaimable,
    };
  }

  /**
   * Deletes the orphaned objects the scan found.
   *
   * Re-scans rather than trusting a list the client sends back: a key that
   * became legitimate between the report and the confirmation must not be
   * deleted because a stale page said so.
   */
  async purgeOrphans(actor: User): Promise<{ deleted: number; bytesFreed: number }> {
    const report = await this.orphans();
    if (report.orphanedObjects.length === 0) {
      return { deleted: 0, bytesFreed: 0 };
    }
    const deleted = await this.storage.deleteObjects(report.orphanedObjects.map((o) => o.key));
    this.logger.log(`${actor.email} purged ${deleted} orphaned objects (${report.reclaimableBytes} bytes)`);
    return { deleted, bytesFreed: report.reclaimableBytes };
  }

  private async one(id: string): Promise<AdminDrawingRowDto> {
    const row = await this.prisma.drawing.findUniqueOrThrow({
      where: { id },
      include: { owner: { select: { email: true } }, organization: { select: { name: true } } },
    });
    return {
      id: row.id,
      name: row.name,
      format: row.format.toLowerCase(),
      byteSize: row.byteSize,
      currentVersion: row.currentVersion,
      ownerId: row.ownerId,
      ownerEmail: row.owner.email,
      organizationId: row.organizationId,
      organizationName: row.organization?.name ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      lastOpenedAt: row.lastOpenedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/**
 * `users/{u}/drawings/{d}/…` → `d`, or null for anything else (uploads, and
 * any key shape a future feature adds). Parsing the prefix is what lets one
 * database query settle a whole scan.
 */
function drawingIdFromKey(key: string): string | null {
  const parts = key.split('/');
  return parts.length >= 4 && parts[0] === 'users' && parts[2] === 'drawings' ? parts[3] : null;
}
