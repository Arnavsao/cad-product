import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { AccessLevel } from '../../common/access';

/** Longest accepted folder name. */
export const MAX_FOLDER_NAME_LENGTH = 120;

/**
 * Hard cap on tree depth. Everything that walks `parentId` (cycle detection,
 * breadcrumb building, force-delete) is bounded by it, so a cycle introduced by
 * a bug or a manual SQL edit can never spin a request forever.
 */
export const MAX_FOLDER_DEPTH = 20;

/**
 * Who created a folder — enough to label a shared folder tile with its real
 * owner, without a request per tile. Mirrors `DrawingOwnerDto`.
 */
export interface FolderOwnerDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

/** `FolderDto` exactly as in plan §1, plus the workspace it belongs to. */
export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  /** `null` for a personal folder; an org id for a shared one. */
  organizationId: string | null;
  /** Display name of `organizationId`, for a shared folder's label. */
  organizationName: string | null;
  /**
   * The creator. `null` only on responses built from a row that was not
   * fetched with its relations.
   */
  owner: FolderOwnerDto | null;
  /** What the caller may do with this folder (`common/access.ts`). */
  access: AccessLevel;
  /** True when a share is the only thing granting that access. */
  viaShare: boolean;
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

/** `?scope=` values for the folder and drawing listings. */
export const LIST_SCOPES = ['workspace', 'shared'] as const;
export type ListScope = (typeof LIST_SCOPES)[number];

/** Query of `GET /folders`; omit `parentId` for the root level. */
export class ListFoldersDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  parentId?: string;

  /** Omit for the caller's personal tree; an org id for that org's tree. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string;

  /**
   * `shared` lists folders others shared with the caller (or with an org they
   * are in) instead of a workspace's own tree; `parentId` and `organizationId`
   * are then ignored, because those folders live in other people's workspaces.
   */
  @IsOptional()
  @IsIn(LIST_SCOPES)
  scope?: ListScope;
}

/**
 * Body of `POST /folders`. `organizationId` is ignored when `parentId` is given
 * — the parent's workspace wins, so a subtree cannot straddle two workspaces.
 */
export class CreateFolderDto {
  @IsString()
  @Length(1, MAX_FOLDER_NAME_LENGTH)
  name: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string | null;
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

/**
 * Body of `POST /folders/:id/move` — the explicit cross-workspace move.
 *
 * Separate from `PATCH` because the two answer different questions: `PATCH`
 * re-parents inside one workspace (and still refuses 422 `CROSS_WORKSPACE_MOVE`
 * if the parent is elsewhere), while this route names the workspace, re-tags
 * the whole subtree, and needs `manage` on the folder.
 */
export class MoveFolderDto {
  /** Target workspace: `null` (or omitted) for the caller's personal tree. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string | null;

  /** Target parent inside that workspace; `null`/omitted for its root. */
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
