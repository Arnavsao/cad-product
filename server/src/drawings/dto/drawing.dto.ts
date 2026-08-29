/**
 * Wire shapes for the drawings domain — these mirror plan §1 exactly and are
 * duplicated verbatim by the Angular client in `core/api/api.models.ts`.
 *
 * Design: DTOs that only travel OUT are plain interfaces (no class-validator
 * decorators, nothing to instantiate); DTOs that come IN are classes so the
 * global `ValidationPipe({ whitelist, forbidNonWhitelisted })` can police them.
 */

/** `DrawingFormat` on the wire (the Prisma enum is upper-case). */
export const DRAWING_FORMATS = ['dxf', 'dwg'] as const;
export type DrawingFormatWire = (typeof DRAWING_FORMATS)[number];

/** Longest accepted drawing/folder display name. */
export const MAX_NAME_LENGTH = 200;

/** Row shape returned by list endpoints. */
export interface DrawingSummaryDto {
  id: string;
  name: string;
  format: DrawingFormatWire;
  folderId: string | null;
  byteSize: number;
  currentVersion: number;
  /** Presigned GET for the current thumbnail, or `null` when none was rendered. */
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  deletedAt: string | null;
}

/** `GET /drawings/:id` — adds a short-lived presigned GET for the payload. */
export interface DrawingDto extends DrawingSummaryDto {
  downloadUrl: string;
  downloadUrlExpiresAt: string;
}

/** Result of every write that produces a new version. */
export interface SaveResultDto {
  version: number;
  byteSize: number;
  updatedAt: string;
}

/** A presigned PUT handed to the browser for a direct-to-storage upload. */
export interface PresignDto {
  uploadUrl: string;
  key: string;
  expiresAt: string;
}

/** `DELETE /drawings/:id` (trash). */
export interface TrashedDrawingDto {
  id: string;
  deletedAt: string;
}

/** `DELETE /drawings/:id/permanent`. */
export interface DeletedDrawingDto {
  id: string;
}

/** `PUT /drawings/:id/thumbnail`. */
export interface ThumbnailResultDto {
  thumbnailUrl: string;
}
