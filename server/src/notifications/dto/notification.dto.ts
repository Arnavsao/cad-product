import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Wire values for `NotificationKind` (lowercase; the mapper owns the casing). */
export const NOTIFICATION_KINDS = ['system', 'drawing', 'storage', 'account'] as const;
export type NotificationKindWire = (typeof NOTIFICATION_KINDS)[number];

/** One inbox entry. */
export interface NotificationDto {
  id: string;
  kind: NotificationKindWire;
  title: string;
  body: string | null;
  /** In-app route to open, e.g. `/dashboard/drawings`. Null when nothing to open. */
  linkUrl: string | null;
  /** ISO timestamp, or null while unread. */
  readAt: string | null;
  createdAt: string;
}

/**
 * `GET /notifications`. Carries `unreadCount` alongside the page so the header
 * badge and the list come from one request — the badge must stay correct even
 * when the caller is looking at page 3.
 */
export interface NotificationPageDto {
  items: NotificationDto[];
  nextCursor: string | null;
  unreadCount: number;
}

/** Result of marking everything read. */
export interface MarkAllReadDto {
  updated: number;
}

/** Query for `GET /notifications`. */
export class ListNotificationsDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /**
   * `enableImplicitConversion` turns `?unreadOnly=true` into a boolean, but not
   * `?unreadOnly=1` or a bare `?unreadOnly`; normalise all three so the filter
   * cannot silently no-op.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1' || value === '')
  @IsBoolean()
  unreadOnly?: boolean;
}
