import type { PresignedUrl } from '../storage/storage.service';
import type { Drawing } from '../generated/prisma/client';
import { DrawingFormat } from '../generated/prisma/client';
import type { DrawingDto, DrawingFormatWire, DrawingSummaryDto } from './dto/drawing.dto';

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

export function toDrawingSummaryDto(row: Drawing, thumbnailUrl: string | null = null): DrawingSummaryDto {
  return {
    id: row.id,
    name: row.name,
    format: formatToWire(row.format),
    folderId: row.folderId,
    byteSize: row.byteSize,
    currentVersion: row.currentVersion,
    thumbnailUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastOpenedAt: row.lastOpenedAt ? row.lastOpenedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export function toDrawingDto(row: Drawing, thumbnailUrl: string | null, download: PresignedUrl): DrawingDto {
  return {
    ...toDrawingSummaryDto(row, thumbnailUrl),
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
