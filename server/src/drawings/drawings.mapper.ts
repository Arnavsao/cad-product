import { liveShare, type Access } from '../common/access';
import type { PresignedUrl } from '../storage/storage.service';
import type { Drawing, Prisma } from '../generated/prisma/client';
import { DrawingFormat } from '../generated/prisma/client';
import type { DrawingDto, DrawingFormatWire, DrawingSummaryDto } from './dto/drawing.dto';

/**
 * A drawing row, optionally fetched with the relations the dashboard's Owner,
 * Shared and share-badge columns need.
 *
 * They are optional rather than required so the many write paths that update a
 * row and map it straight back do not each have to re-fetch the relations; the
 * DTO reports `owner: null` / `shareCount: 0` in that case and the client keeps
 * what it has.
 */
export type DrawingRow = Drawing & {
  owner?: { id: string; firstName: string | null; lastName: string | null; imageUrl: string | null } | null;
  organization?: { id: string; name: string } | null;
  _count?: { shares: number; shareLinks: number };
};

/**
 * `include` for the relations above. Selects columns explicitly — a bare
 * `include: { owner: true }` would ship the whole user row (auth id, email,
 * timestamps) to every client for every row of every page.
 *
 * A function rather than a constant because the share count is filtered on
 * "not expired": a module-level constant would freeze `now` at import time and
 * a long-running process would keep counting shares that lapsed hours ago.
 */
export function drawingRelations(now: Date = new Date()) {
  return {
    owner: { select: { id: true, firstName: true, lastName: true, imageUrl: true } },
    organization: { select: { id: true, name: true } },
    _count: { select: { shares: { where: liveShare(now) }, shareLinks: { where: { revokedAt: null } } } },
  } satisfies Prisma.DrawingInclude;
}

/** Default access reported for a row mapped without a resolved level. */
const UNKNOWN_ACCESS: Access = { level: 'view', viaShare: false };

/**
 * Row → DTO conversion for the drawings domain.
 *
 * Design: mapping lives outside the service (as in `users.mapper.ts`) so the
 * enum casing rule — Prisma members are upper-case, the wire is lower-case —
 * is stated once, and so the presigned URLs a row needs are passed IN rather
 * than fetched here. That keeps the mapper pure and lets the list endpoint sign
 * every thumbnail in ONE `Promise.all` instead of serially per row.
 */

export function formatToWire(format: DrawingFormat): DrawingFormatWire {
  return format.toLowerCase() as DrawingFormatWire;
}

/** `.dxf`/`.dwg` (or anything else) → the stored enum; unknown falls back to DXF. */
export function formatFromExtension(extension: string): DrawingFormat {
  return extension.toLowerCase() === 'dwg' ? DrawingFormat.DWG : DrawingFormat.DXF;
}

export function toDrawingSummaryDto(
  row: DrawingRow,
  thumbnailUrl: string | null = null,
  access: Access = UNKNOWN_ACCESS,
): DrawingSummaryDto {
  return {
    id: row.id,
    name: row.name,
    format: formatToWire(row.format),
    folderId: row.folderId,
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
    shareCount: (row._count?.shares ?? 0) + (row._count?.shareLinks ?? 0),
    byteSize: row.byteSize,
    currentVersion: row.currentVersion,
    thumbnailUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastOpenedAt: row.lastOpenedAt ? row.lastOpenedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export function toDrawingDto(
  row: DrawingRow,
  thumbnailUrl: string | null,
  download: PresignedUrl,
  access: Access = UNKNOWN_ACCESS,
): DrawingDto {
  return {
    ...toDrawingSummaryDto(row, thumbnailUrl, access),
    downloadUrl: download.url,
    downloadUrlExpiresAt: download.expiresAt,
  };
}

/**
 * Name for a duplicate: `Plan` → `Plan (copy)`, `Plan (copy)` → `Plan (copy 2)`.
 * Kept here so the dashboard and the editor's "Save as copy" agree on the shape.
 */
export function copyName(original: string, maxLength: number): string {
  const match = /^(.*)\s\(copy(?:\s(\d+))?\)$/.exec(original);
  const stem = match ? match[1] : original;
  const next = match ? Number(match[2] ?? 1) + 1 : 1;
  const suffix = next === 1 ? ' (copy)' : ` (copy ${next})`;
  const room = Math.max(1, maxLength - suffix.length);
  return `${stem.slice(0, room)}${suffix}`;
}
