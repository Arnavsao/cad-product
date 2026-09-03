import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import type { AccessLevel } from '../../common/access';
import type { DrawingSummaryDto } from '../../drawings/dto/drawing.dto';

/**
 * Wire shapes for sharing. Outbound DTOs are plain interfaces; inbound ones are
 * classes so the global `ValidationPipe({ whitelist, forbidNonWhitelisted })`
 * can police them (see `drawing.dto.ts` for the same split).
 */

/** `SharePermission` on the wire (the Prisma enum is upper-case). */
export const SHARE_PERMISSIONS = ['view', 'edit'] as const;
export type SharePermissionWire = (typeof SHARE_PERMISSIONS)[number];

/** Expiries a link may be created with; `null`/omitted never expires. */
export const LINK_EXPIRY_DAYS = [7, 30, 90] as const;

/** The organization a share points at. */
export interface ShareTargetOrgDto {
  id: string;
  name: string;
}

/**
 * The person a share points at, when an account with that address exists.
 *
 * `null` for a share created for someone who has not signed up: the grant is
 * stored against the address and starts working the moment they do, so the
 * dialog shows the raw email until then.
 */
export interface ShareTargetUserDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

/** One durable grant on a drawing or folder. */
export interface ShareDto {
  id: string;
  /** Lowercased address, or `null` for an organization share. */
  targetEmail: string | null;
  targetOrganization: ShareTargetOrgDto | null;
  /** Resolved from `targetEmail` when an account exists. */
  targetUser: ShareTargetUserDto | null;
  permission: SharePermissionWire;
  expiresAt: string | null;
  createdAt: string;
}

/**
 * One share link. The URL is deliberately absent: the client builds
 * `${location.origin}/shared/${token}` itself, so the API never has to be told
 * (or guess) which front-end origin a caller is on.
 */
export interface ShareLinkDto {
  id: string;
  token: string;
  permission: SharePermissionWire;
  expiresAt: string | null;
  createdAt: string;
}

/** `GET /drawings/:id/shares` and `GET /folders/:id/shares`. */
export interface SharesDto {
  /** The caller's own level, so the dialog can render its header chip. */
  access: AccessLevel;
  shares: ShareDto[];
  /** Always empty for a folder — links are drawings only. */
  links: ShareLinkDto[];
}

/** `GET /shared/:token` — what the recipient sees before accepting. */
export interface SharedLinkDto {
  drawing: DrawingSummaryDto;
  permission: SharePermissionWire;
  /** Who created the link. */
  owner: ShareTargetUserDto | null;
  /** True when the link has lapsed; it can then be read but not accepted. */
  expired: boolean;
}

/** `POST /shared/:token/accept`. */
export interface AcceptedShareDto {
  drawingId: string;
  access: AccessLevel;
}

/** `DELETE …/shares/:shareId` and `DELETE …/links/:linkId`. */
export interface RemovedShareDto {
  id: string;
}

/**
 * Body of `PUT /drawings/:id/shares` and `PUT /folders/:id/shares`.
 *
 * Exactly one target. `PUT` rather than `POST` because it is an upsert on
 * (resource, target): re-sharing with the same person changes their permission
 * instead of stacking a second grant.
 */
export class UpsertShareDto {
  @IsOptional()
  @IsEmail()
  @Length(3, 320)
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string;

  @IsIn(SHARE_PERMISSIONS)
  permission: SharePermissionWire;

  /** ISO timestamp, or `null` to clear an existing expiry. */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}

/** Most addresses one `POST …/links/:linkId/email` call may name. */
export const MAX_LINK_EMAIL_RECIPIENTS = 10;

/** Longest note the sender may attach to an emailed link. */
export const MAX_LINK_EMAIL_MESSAGE = 500;

/**
 * Body of `POST /drawings/:id/links/:linkId/email`.
 *
 * The recipient cap is a validation rule rather than a silent truncation: a
 * caller who pasted twenty addresses should be told that only ten went, not
 * left guessing which. See `SharingService.emailLink` for the rest of the
 * anti-relay reasoning.
 */
export class EmailShareLinkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINK_EMAIL_RECIPIENTS)
  @IsEmail({}, { each: true })
  @Length(3, 320, { each: true })
  emails: string[];

  /** Optional note from the sender, shown above the link. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_LINK_EMAIL_MESSAGE)
  message?: string;
}

/** `POST /drawings/:id/links/:linkId/email` — how many messages went out. */
export interface EmailedShareLinkDto {
  sent: number;
}

/** Body of `POST /drawings/:id/links`. */
export class CreateShareLinkDto {
  @IsIn(SHARE_PERMISSIONS)
  permission: SharePermissionWire;

  /** `7`, `30`, `90`, or omitted/`null` for a link that never expires. */
  @IsOptional()
  @IsInt()
  @IsIn(LINK_EXPIRY_DAYS)
  expiresInDays?: number | null;
}
