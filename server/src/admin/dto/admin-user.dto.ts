import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { PlatformRoleWire } from '../platform-role';
import { PLATFORM_ROLES } from '../platform-role';

/** Account status as the portal filters and displays it. */
export const ACCOUNT_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** A user as one row of the admin list. */
export interface AdminUserRowDto {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  platformRole: PlatformRoleWire;
  status: AccountStatus;
  plan: string;
  onboarded: boolean;
  drawingCount: number;
  bytesUsed: number;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Everything the user detail page shows. */
export interface AdminUserDetailDto extends AdminUserRowDto {
  authId: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  deletedAt: string | null;
  updatedAt: string;
  preferences: { units: string; theme: string; locale: string; role: string | null } | null;
  organizations: { id: string; name: string; slug: string; role: string }[];
  billing: {
    plan: string;
    status: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    /** Staff grant, if one is active. The reason is staff-only, hence here and not in `/me`. */
    overridePlan: string | null;
    overrideUntil: string | null;
    overrideReason: string | null;
  } | null;
  feedbackCount: number;
}

/** Query string of `GET /admin/users`. */
export class ListUsersQueryDto {
  /** Matches email, first or last name, case-insensitively. */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatus;

  @IsOptional()
  @IsIn(PLATFORM_ROLES)
  role?: PlatformRoleWire;

  @IsOptional()
  @IsIn(['free', 'pro', 'team'])
  plan?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/**
 * Suspension and deletion both demand a reason.
 *
 * Not politeness: the reason is copied into the audit trail and, for a
 * suspension, shown to the person locked out. An endpoint that let staff skip
 * it would produce a log nobody can act on six weeks later.
 */
export class SuspendUserDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class DeleteUserDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** `POST /admin/users/:id/notify` — an in-app message from staff. */
export class NotifyUserDto {
  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  body?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  linkUrl?: string;
}

/**
 * `POST /admin/users/:id/plan-override` — grant a plan without a payment.
 *
 * The beta's main use: giving a tester Pro so they can exercise the features
 * we want feedback on. `days` rather than an absolute date because the question
 * staff actually answer is "how long for", and a date picker invites a timezone
 * mistake in the one field that decides when something stops working.
 */
export class PlanOverrideDto {
  @IsIn(['free', 'pro', 'team'])
  plan!: 'free' | 'pro' | 'team';

  /** Omitted means the grant does not expire on its own. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** `PUT /admin/staff/:userId` — set somebody's staff tier. */
export class SetStaffRoleDto {
  @IsIn(PLATFORM_ROLES)
  role!: PlatformRoleWire;
}
