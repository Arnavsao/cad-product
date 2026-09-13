import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, Length } from 'class-validator';

export const ANNOUNCEMENT_KINDS = ['system', 'drawing', 'storage', 'account'] as const;
export type AnnouncementKindWire = (typeof ANNOUNCEMENT_KINDS)[number];

export interface AdminAnnouncementDto {
  id: string;
  title: string;
  body: string;
  kind: AnnouncementKindWire;
  linkUrl: string | null;
  startsAt: string;
  endsAt: string | null;
  pushToInbox: boolean;
  publishedAt: string | null;
  /** Derived: published, inside its window, and not yet ended. */
  live: boolean;
  createdByEmail: string | null;
  createdAt: string;
}

/** What a signed-in user is shown. Deliberately smaller than the staff view. */
export interface PublicAnnouncementDto {
  id: string;
  title: string;
  body: string;
  kind: AnnouncementKindWire;
  linkUrl: string | null;
}

export class CreateAnnouncementDto {
  @IsString()
  @Length(3, 120)
  title!: string;

  @IsString()
  @Length(3, 2000)
  body!: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_KINDS)
  kind?: AnnouncementKindWire;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  linkUrl?: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  /**
   * Also insert a notification per user when this is published.
   *
   * Off by default: a banner costs nothing, whereas a row in everyone's inbox
   * is a permanent artefact of a temporary message and cannot be taken back.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  pushToInbox?: boolean;
}

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @Length(3, 120)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(3, 2000)
  body?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_KINDS)
  kind?: AnnouncementKindWire;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  linkUrl?: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  pushToInbox?: boolean;
}
