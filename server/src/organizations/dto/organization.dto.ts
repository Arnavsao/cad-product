import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { OrgRole } from '../../generated/prisma/client';

/** Longest accepted organization name. */
export const MAX_ORG_NAME_LENGTH = 80;

/** How long a fresh invite stays acceptable. */
export const INVITE_TTL_DAYS = 14;

/**
 * Roles as they travel on the wire — lowercase, matching the enum's `@map`
 * values, so a client never has to know about Prisma's SCREAMING_CASE.
 */
export const ORG_ROLES = ['viewer', 'member', 'admin', 'owner'] as const;
export type OrgRoleWire = (typeof ORG_ROLES)[number];

/**
 * Roles an owner can assign, including `owner` itself — an org needs a way to
 * hand over ownership without going through raw SQL, and the last-owner
 * invariant already makes the dangerous half (demoting the only owner) safe.
 */
export const ASSIGNABLE_ROLES = ['viewer', 'member', 'admin', 'owner'] as const;

/**
 * Roles an invitation may carry. `owner` is excluded deliberately: ownership is
 * transferred to someone already in the org, in a step the current owner
 * confirms, not handed to whoever happens to redeem a link.
 */
export const INVITABLE_ROLES = ['viewer', 'member', 'admin'] as const;

/** One organization the caller belongs to. */
export interface OrgSummaryDto {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  /** The caller's own role in this organization. */
  role: OrgRoleWire;
  memberCount: number;
  createdAt: string;
}

/** `GET /organizations/:id` — adds the fields only members need to see. */
export interface OrgDetailDto extends OrgSummaryDto {
  /** Only disclosed to `admin`/`owner`; `null` for a plain member. */
  joinCode: string | null;
  drawingCount: number;
  /** Live shares from elsewhere pointed at this org ("shared with us"). */
  sharedInCount: number;
}

/** A row of the members table. */
export interface OrgMemberDto {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  role: OrgRoleWire;
  joinedAt: string;
}

/**
 * An outstanding invitation, as the inviting org's admins see it.
 *
 * `token` is included because the list is admin-only anyway and the client
 * needs it to offer "Copy invite link" — there is no email delivery, so a
 * copyable link is the only way an invitation reaches anyone.
 */
export interface OrgInviteDto {
  id: string;
  email: string;
  role: OrgRoleWire;
  token: string;
  organizationId: string;
  organizationName: string;
  expiresAt: string;
  createdAt: string;
}

/** Who sent an invitation, for the invitee's banner. */
export interface OrgInviterDto {
  firstName: string | null;
  lastName: string | null;
  email: string;
}

/**
 * `GET /organizations/invitations` — an invitation addressed to the CALLER.
 *
 * The in-app equivalent of the email we do not send: without it an invitee has
 * no way to discover that they were invited, since they cannot list an org they
 * are not in yet.
 */
export interface OrgInvitationDto {
  id: string;
  organizationId: string;
  organizationName: string;
  role: OrgRoleWire;
  invitedBy: OrgInviterDto | null;
  expiresAt: string;
  token: string;
}

/** `POST /organizations`. */
export class CreateOrganizationDto {
  @IsString()
  @Length(1, MAX_ORG_NAME_LENGTH)
  name: string;
}

/** `PATCH /organizations/:id`. */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @Length(1, MAX_ORG_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2048)
  imageUrl?: string | null;
}

/** `POST /organizations/:id/invites`. */
export class CreateInviteDto {
  @IsEmail()
  @Length(3, 320)
  email: string;

  @IsOptional()
  @IsIn(INVITABLE_ROLES)
  role?: (typeof INVITABLE_ROLES)[number];
}

/** `PATCH /organizations/:id/members/:userId`. */
export class UpdateMemberDto {
  @IsIn(ASSIGNABLE_ROLES)
  role: (typeof ASSIGNABLE_ROLES)[number];
}

/**
 * `POST /organizations/join` — either a short join code typed by hand or the
 * opaque token from an emailed invite link.
 */
export class JoinOrganizationDto {
  @IsOptional()
  @IsString()
  @Length(4, 32)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  token?: string;
}

/** Wire value for a Prisma role. */
export function toRoleWire(role: OrgRole): OrgRoleWire {
  return role.toLowerCase() as OrgRoleWire;
}

/** Prisma enum for a wire value. */
export function toRoleEnum(role: OrgRoleWire): OrgRole {
  return role.toUpperCase() as OrgRole;
}
