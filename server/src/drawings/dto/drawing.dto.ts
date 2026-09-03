/**
 * Wire shapes for the drawings domain — these mirror plan §1 exactly and are
 * duplicated verbatim by the Angular client in `core/api/api.models.ts`.
 *
 * Design: DTOs that only travel OUT are plain interfaces (no class-validator
 * decorators, nothing to instantiate); DTOs that come IN are classes so the
 * global `ValidationPipe({ whitelist, forbidNonWhitelisted })` can police them.
 */

import type { AccessLevel } from '../../common/access';

/** `DrawingFormat` on the wire (the Prisma enum is upper-case). */
export const DRAWING_FORMATS = ['dxf', 'dwg'] as const;
export type DrawingFormatWire = (typeof DRAWING_FORMATS)[number];

/** Longest accepted drawing/folder display name. */
export const MAX_NAME_LENGTH = 200;

/**
 * Who created a drawing — enough to render the dashboard's "Owner" column
 * without a second request per row.
 */
export interface DrawingOwnerDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

/** Row shape returned by list endpoints. */
export interface DrawingSummaryDto {
  id: string;
  name: string;
  format: DrawingFormatWire;
  folderId: string | null;
  /** `null` for a personal drawing; an org id for a shared one. */
  organizationId: string | null;
  /** Display name of `organizationId`, for the "Shared" column. */
  organizationName: string | null;
  /**
   * The creator. Absent (`null`) only on responses built from a row that was
   * not fetched with its relations — list endpoints always populate it.
   */
  owner: DrawingOwnerDto | null;
  /**
   * What the caller may do with this drawing (`common/access.ts`). The menus
   * are built from it, and the editor uses `view` to go read-only.
   */
  access: AccessLevel;
  /**
   * True when a share is the only thing granting that access — i.e. the
   * drawing lives in somebody else's workspace. Drives the "Shared with me"
   * column.
   */
  viaShare: boolean;
  /**
   * Live shares plus unrevoked links on this drawing, for the row's share
   * badge. `0` on responses built from a row that was not fetched with its
   * relations.
   */
  shareCount: number;
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

/**
 * One entry of `GET /drawings/:id/versions`, newest first.
 *
 * Only the newest `MAX_VERSIONS_PER_DRAWING` are kept (older rows and their
 * objects are pruned after each save), so this list is bounded and every entry
 * in it is guaranteed to still have bytes behind it.
 */
export interface VersionDto {
  version: number;
  byteSize: number;
  createdAt: string;
  /** True for the version `storageKey` currently points at. */
  isCurrent: boolean;
}

/** `GET /drawings/:id/versions/:version` — a short-lived presigned GET. */
export interface VersionDownloadDto {
  downloadUrl: string;
  expiresAt: string;
}

/** `DELETE /drawings/trash` — how many rows were permanently removed. */
export interface EmptyTrashResultDto {
  deleted: number;
}
