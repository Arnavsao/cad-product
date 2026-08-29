/**
 * DTOs of the CADOnline API (`/api/v1`). These mirror the server's contract
 * name-for-name — see the "API contract" section of the project plan. Times
 * are ISO-8601 strings; ids are cuids.
 */

export type Units = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type UserRole = 'architect' | 'engineer' | 'student' | 'other';
export type DrawingFormat = 'dxf' | 'dwg';

// ── Drawings ──────────────────────────────────────────────────────────────

export interface DrawingSummaryDto {
  id: string;
  name: string;
  format: DrawingFormat;
  folderId: string | null;
  byteSize: number;
  currentVersion: number;
  /** Presigned, hour-stable GET URL of the PNG thumbnail; null until one is rendered. */
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  /** Only present on trash listings. */
  deletedAt?: string | null;
}

export interface DrawingDto extends DrawingSummaryDto {
  /** Presigned GET URL for the DXF payload (valid ~10 minutes). */
  downloadUrl: string;
  downloadUrlExpiresAt: string;
}

export interface SaveResultDto {
  version: number;
  byteSize: number;
  updatedAt: string;
}

/** `DELETE /drawings/:id` (move to trash). */
export interface TrashedDto {
  id: string;
  deletedAt: string;
}

/** `DELETE /drawings/:id/permanent`. */
export interface DeletedDto {
  id: string;
}

/** `PUT /drawings/:id/thumbnail`. */
export interface ThumbnailDto {
  thumbnailUrl: string;
}

// ── Folders ───────────────────────────────────────────────────────────────

export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderPathEntry {
  id: string;
  name: string;
}

/** `GET /folders/:id` — the folder plus its ancestry (root first) for breadcrumbs. */
export interface FolderDetailDto extends FolderDto {
  path: FolderPathEntry[];
}

/** `DELETE /folders/:id`. */
export interface DeleteFolderResultDto {
  id: string;
  trashedDrawings: number;
}

// ── Me ────────────────────────────────────────────────────────────────────

export interface PreferencesDto {
  units: Units;
  /** Theme id from the editor's theme registry (e.g. `cad-dark`). */
  theme: string;
  role: UserRole | null;
  defaultTemplate: string;
  autosaveIntervalSec: number;
  /** Free-form UI state persisted for the user (view mode, collapsed panels …). */
  uiState: Record<string, unknown> | null;
}

export interface MeUserDto {
  id: string;
  clerkId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  createdAt: string;
}

export interface MeDto {
  user: MeUserDto;
  preferences: PreferencesDto;
  onboarded: boolean;
  usage: { bytesUsed: number; drawingCount: number };
}

// ── Generic ───────────────────────────────────────────────────────────────

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PresignDto {
  uploadUrl: string;
  key: string;
  expiresAt: string;
}

// ── Requests ──────────────────────────────────────────────────────────────

export interface CreateDrawingRequest {
  name: string;
  folderId?: string | null;
  /** Omit to let the server create a blank template (units from preferences). Max 5 MB. */
  initialDxf?: string;
}

export type DrawingSort = 'updated' | 'name' | 'opened';

export interface ListDrawingsQuery {
  /** A folder id, or `'root'` for drawings outside any folder. Omit for all. */
  folderId?: string | 'root';
  q?: string;
  sort?: DrawingSort;
  cursor?: string;
  /** 1..100 */
  limit?: number;
}

export interface UpdateDrawingRequest {
  name?: string;
  /** `null` moves the drawing to the root. */
  folderId?: string | null;
}

export interface PresignUploadRequest {
  fileName: string;
  contentType: string;
  /** ≤ 50 MB */
  byteSize: number;
}

export interface ImportDrawingRequest {
  /** Staging key returned by `POST /uploads/presign`. */
  key: string;
  name?: string;
  folderId?: string | null;
}

export interface CompleteOnboardingRequest {
  role: UserRole;
  units: Units;
  defaultTemplate?: string;
}

export interface CreateFolderRequest {
  name: string;
  parentId?: string | null;
}

export interface UpdateFolderRequest {
  name?: string;
  /** `null` moves the folder to the root. */
  parentId?: string | null;
}
