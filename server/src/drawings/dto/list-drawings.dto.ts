import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { LIST_SCOPES, type ListScope } from '../../folders/dto/folder.dto';

/** `?sort=` values for `GET /drawings`. */
export const DRAWING_SORTS = ['updated', 'name', 'opened'] as const;
export type DrawingSort = (typeof DRAWING_SORTS)[number];

/**
 * Sentinel `?folderId=` value meaning "the root of My Drawings". The wire needs
 * one because an omitted parameter and an explicit "no folder" must both map to
 * `folderId IS NULL`, and a query string cannot carry `null`.
 */
export const ROOT_FOLDER = 'root';

/** Page size defaults (`clampLimit` enforces the bounds again server-side). */
export const DEFAULT_PAGE_LIMIT = 30;
export const MAX_PAGE_LIMIT = 100;
export const MAX_RECENT_LIMIT = 50;

/**
 * Upper bound on `?page=`. Offset paging makes the database walk every skipped
 * row, so an unbounded page number is a cheap way to make it do a lot of work;
 * 10 000 pages is far past anything a person scrolls to.
 */
export const MAX_PAGE_NUMBER = 10_000;

/**
 * Query of `GET /drawings`.
 *
 * Paging accepts either mode, never both meaningfully: send `cursor` to walk
 * forward through a feed, or `page` to address a numbered page and get a
 * `total` back. `page` wins if both arrive — see `DrawingsService.list`.
 */
export class ListDrawingsDto {
  /** A folder cuid, or `root`/omitted for the top level. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  folderId?: string;

  /** Omit for the caller's personal drawings; an org id for that org's. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string;

  /**
   * `shared` lists drawings others shared with the caller directly, wherever
   * they live, instead of one workspace's own rows. Ignored when `folderId` is
   * given — the folder already decides both the workspace and the scope.
   */
  @IsOptional()
  @IsIn(LIST_SCOPES)
  scope?: ListScope;

  /** Case-insensitive substring match on `name`. */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @IsOptional()
  @IsIn(DRAWING_SORTS)
  sort?: DrawingSort;

  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;

  /** 1-based page number; switches the response to offset mode. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_NUMBER)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}

/** Query of `GET /drawings/trash`. */
export class ListTrashDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_NUMBER)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}

/** Query of `GET /drawings/recent`. */
export class RecentDrawingsDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RECENT_LIMIT)
  limit?: number;
}

/** Query of `GET /drawings/:id`. */
export class GetDrawingDto {
  /** `0` skips the `lastOpenedAt` touch (prefetch / thumbnail refresh). */
  @IsOptional()
  @IsString()
  @Length(1, 8)
  touch?: string;

  /** `1` adds `Content-Disposition: attachment` to the presigned URL. */
  @IsOptional()
  @IsString()
  @Length(1, 8)
  download?: string;
}

/** `?flag=1|true|yes` → true. Anything else (including absent) → false. */
export function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

/** `?flag=0|false|no` → false. Absent or anything else → true. */
export function isNotFalsyFlag(value: string | undefined): boolean {
  return !(value === '0' || value === 'false' || value === 'no');
}
