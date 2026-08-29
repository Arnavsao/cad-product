import { IsOptional, IsString, Length } from 'class-validator';

/** Longest accepted folder name. */
export const MAX_FOLDER_NAME_LENGTH = 120;

/**
 * Hard cap on tree depth. Everything that walks `parentId` (cycle detection,
 * breadcrumb building, force-delete) is bounded by it, so a cycle introduced by
 * a bug or a manual SQL edit can never spin a request forever.
 */
export const MAX_FOLDER_DEPTH = 20;

/** `FolderDto` exactly as in plan §1. */
export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One breadcrumb step (root-most first, the folder itself last). */
export interface FolderPathEntryDto {
  id: string;
  name: string;
}

/** `GET /folders/:id` — the folder plus its breadcrumb trail. */
export interface FolderWithPathDto extends FolderDto {
  path: FolderPathEntryDto[];
}

/** `DELETE /folders/:id`. */
export interface DeleteFolderResultDto {
  id: string;
  /** How many drawings in the deleted subtree were moved to trash. */
  trashedDrawings: number;
}

/** Query of `GET /folders`; omit `parentId` for the root level. */
export class ListFoldersDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  parentId?: string;
}

/** Body of `POST /folders`. */
export class CreateFolderDto {
  @IsString()
  @Length(1, MAX_FOLDER_NAME_LENGTH)
  name: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  parentId?: string | null;
}

/** Body of `PATCH /folders/:id`; `parentId: null` moves the folder to the root. */
export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @Length(1, MAX_FOLDER_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  parentId?: string | null;
}

/** Query of `DELETE /folders/:id`. */
export class DeleteFolderDto {
  /** `true` trashes the drawings inside instead of answering 409. */
  @IsOptional()
  @IsString()
  @Length(1, 8)
  force?: string;
}
