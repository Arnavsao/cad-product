import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from '../../notifications/notifications.service';
import { ApiException } from '../../common/errors/api-error';
import { clampPage, type Page } from '../../common/utils/pagination';
import { BillingPlan, PlatformRole, Prisma, SubscriptionStatus, type User } from '../../generated/prisma/client';
import type { PlanWire as BillingPlanWire } from '../../billing/dto/billing.dto';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AccountStatus,
  AdminUserDetailDto,
  AdminUserRowDto,
  ListUsersQueryDto,
} from '../dto/admin-user.dto';
import { platformRoleFromWire, platformRoleToWire } from '../platform-role';
import type { PlatformRoleWire } from '../platform-role';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const DAY_MS = 86_400_000;

/**
 * Staff-facing account operations.
 *
 * Everything here is deliberately *narrow*: staff may change an account's
 * status and its staff tier, and nothing else about it. There is no "edit any
 * field" endpoint, because the portal exists to run the service, not to let
 * operators rewrite people's data.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Offset paging, not the keyset cursor used elsewhere: this list is a search
   * result staff jump around in ("page 4", "312 accounts"), which a cursor
   * cannot express. The row count is bounded by `MAX_PAGE_SIZE`.
   */
  async list(query: ListUsersQueryDto): Promise<Page<AdminUserRowDto>> {
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const where = this.whereFor(query);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { subscription: true },
      }),
    ]);

    // Usage in one grouped query rather than N per-row aggregates: the list is
    // 25 accounts, and 25 round trips to render one page is how a portal
    // becomes unusable at a few thousand users.
    const usage = await this.usageFor(rows.map((row) => row.id));

    return {
      items: rows.map((row) => this.toRow(row, usage.get(row.id))),
      nextCursor: null,
      total,
      page,
      pageSize,
    };
  }

  async get(userId: string): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: true,
        preferences: true,
        memberships: { include: { organization: true } },
        _count: { select: { feedback: true } },
      },
    });
    if (!user) {
      throw ApiException.notFound('USER_NOT_FOUND', 'No such user');
    }

    const usage = (await this.usageFor([user.id])).get(user.id);
    return {
      ...this.toRow(user, usage),
      authId: user.authId,
      suspendedAt: user.suspendedAt?.toISOString() ?? null,
      suspendedReason: user.suspendedReason,
      deletedAt: user.deletedAt?.toISOString() ?? null,
      updatedAt: user.updatedAt.toISOString(),
      preferences: user.preferences
        ? {
            units: user.preferences.units.toLowerCase(),
            theme: user.preferences.theme,
            locale: user.preferences.locale,
            role: user.preferences.role?.toLowerCase() ?? null,
          }
        : null,
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role.toLowerCase(),
      })),
      billing: user.subscription
        ? {
            plan: user.subscription.plan.toLowerCase(),
            status: user.subscription.status.toLowerCase(),
            currentPeriodEnd: user.subscription.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
            overridePlan: user.subscription.overridePlan?.toLowerCase() ?? null,
            overrideUntil: user.subscription.overrideUntil?.toISOString() ?? null,
            overrideReason: user.subscription.overrideReason,
          }
        : null,
      feedbackCount: user._count.feedback,
    };
  }

  /** The row as the audit trail should remember it, before a change. */
  async snapshot(userId: string): Promise<Record<string, unknown> | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        platformRole: true,
        suspendedAt: true,
        suspendedReason: true,
        deletedAt: true,
        // The grant rides along so a plan change's audit entry shows what it
        // replaced, not just what it became.
        subscription: { select: { overridePlan: true, overrideUntil: true, overrideReason: true } },
      },
    });
    return user ? { ...user, platformRole: platformRoleToWire(user.platformRole) } : undefined;
  }

  // ---------------------------------------------------------------------------
  // Account status
  // ---------------------------------------------------------------------------

  /**
   * Suspends an account. The auth guard turns this into 403 `USER_SUSPENDED` on
   * the next request, so there is no session to revoke separately.
   *
   * Staff cannot suspend themselves or anyone at or above their own tier: the
   * first would lock the operator out mid-action, and the second would let an
   * ADMIN disable an OWNER, which inverts the hierarchy.
   */
  async suspend(actor: User, userId: string, reason: string): Promise<AdminUserDetailDto> {
    const target = await this.requireMutableTarget(actor, userId, 'suspend');
    if (target.suspendedAt) {
      throw ApiException.conflict('ALREADY_SUSPENDED', 'This account is already suspended');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: new Date(), suspendedReason: reason },
    });
    this.logger.log(`${actor.email} suspended ${target.email}: ${reason}`);
    return this.get(userId);
  }

  async unsuspend(actor: User, userId: string): Promise<AdminUserDetailDto> {
    const target = await this.requireMutableTarget(actor, userId, 'unsuspend');
    await this.prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: null, suspendedReason: null },
    });
    this.logger.log(`${actor.email} lifted the suspension on ${target.email}`);
    return this.get(userId);
  }

  /**
   * Soft-deletes an account: `deletedAt` is set, the guard answers 403
   * `USER_DELETED`, and the rows stay put.
   *
   * Nothing is erased here. Object storage and the drawing rows survive so the
   * deletion is reversible while the beta is running; a real erasure job is
   * Phase 3's, and it should be a separate, deliberate action rather than a
   * side effect of a button in a list.
   */
  async softDelete(actor: User, userId: string, reason: string): Promise<AdminUserDetailDto> {
    const target = await this.requireMutableTarget(actor, userId, 'delete');
    if (target.deletedAt) {
      throw ApiException.conflict('ALREADY_DELETED', 'This account is already deleted');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), suspendedReason: reason },
    });
    this.logger.log(`${actor.email} deleted ${target.email}: ${reason}`);
    return this.get(userId);
  }

  // ---------------------------------------------------------------------------
  // Plan grants
  // ---------------------------------------------------------------------------

  /**
   * Grants a plan without a payment.
   *
   * Written to the `override*` columns, never to `plan`: that column is Dodo's
   * projection, so writing it would make the next webhook silently revoke the
   * grant. `BillingService.effectivePlan` takes the better of the two.
   *
   * The row is created if the account has never been through checkout, which is
   * the normal case for a beta tester — `dodoCustomerId` is left blank, and the
   * billing endpoints already treat a customerless row as "nothing to manage".
   */
  async setPlanOverride(
    actor: User,
    userId: string,
    input: { plan: BillingPlanWire; days?: number; reason: string },
  ): Promise<AdminUserDetailDto> {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!target) {
      throw ApiException.notFound('USER_NOT_FOUND', 'No such user');
    }

    const plan = input.plan.toUpperCase() as BillingPlan;
    const until = input.days ? new Date(Date.now() + input.days * DAY_MS) : null;

    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        // No Dodo customer: this account has never bought anything, and a grant
        // does not create one. An empty string rather than null because the
        // column is required — see the note on `Subscription.dodoCustomerId`.
        dodoCustomerId: '',
        overridePlan: plan,
        overrideUntil: until,
        overrideReason: input.reason,
      },
      update: { overridePlan: plan, overrideUntil: until, overrideReason: input.reason },
    });

    this.logger.log(
      `${actor.email} granted ${input.plan} to ${target.email}` +
        `${until ? ` until ${until.toISOString().slice(0, 10)}` : ' indefinitely'}: ${input.reason}`,
    );
    return this.get(userId);
  }

  /**
   * Removes a grant. The bought plan, if any, is untouched — the columns are
   * separate precisely so revoking a complimentary upgrade cannot cancel a real
   * subscription.
   */
  async clearPlanOverride(actor: User, userId: string): Promise<AdminUserDetailDto> {
    const updated = await this.prisma.subscription.updateMany({
      where: { userId },
      data: { overridePlan: null, overrideUntil: null, overrideReason: null },
    });
    if (updated.count === 0) {
      // Nothing to clear is not an error: the end state the caller asked for
      // is the state we are in.
      this.logger.debug(`No plan grant to clear for ${userId}`);
    } else {
      this.logger.log(`${actor.email} cleared the plan grant on ${userId}`);
    }
    return this.get(userId);
  }

  /**
   * Everything we hold about one account, as JSON.
   *
   * For data-subject requests, where the obligation is to hand over the
   * personal data and the thing that makes it awkward is that it lives in nine
   * tables. Drawing CONTENT is deliberately excluded: it is the user's own file
   * and they already have it, and streaming megabytes of DXF through a support
   * endpoint would turn a records request into a data-exfiltration path.
   *
   * Staff-only fields are excluded for the same reason they are excluded from
   * `/me`: this is the user's data, not our notes about them.
   */
  async exportData(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        preferences: true,
        subscription: true,
        memberships: { include: { organization: { select: { id: true, name: true, slug: true } } } },
      },
    });
    if (!user) {
      throw ApiException.notFound('USER_NOT_FOUND', 'No such user');
    }

    const [drawings, folders, feedback, notifications] = await Promise.all([
      this.prisma.drawing.findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          name: true,
          format: true,
          byteSize: true,
          currentVersion: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.folder.findMany({
        where: { ownerId: userId },
        select: { id: true, name: true, parentId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.feedback.findMany({
        where: { userId },
        // Not `internalNote`, `assigneeId` or `status`: those are our notes
        // about the report, not the user's data.
        select: { id: true, kind: true, rating: true, message: true, createdAt: true, repliedAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.notification.findMany({
        where: { userId },
        select: { id: true, kind: true, title: true, body: true, readAt: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        imageUrl: user.imageUrl,
        createdAt: user.createdAt.toISOString(),
        onboardedAt: user.onboardedAt?.toISOString() ?? null,
      },
      preferences: user.preferences,
      subscription: user.subscription
        ? {
            plan: user.subscription.plan.toLowerCase(),
            status: user.subscription.status.toLowerCase(),
            currentPeriodEnd: user.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
          }
        : null,
      organizations: user.memberships.map((m) => ({ ...m.organization, role: m.role.toLowerCase() })),
      drawings,
      folders,
      feedback,
      notifications,
    };
  }

  /** Sends one in-app notification from staff. */
  async notify(userId: string, input: { title: string; body?: string; linkUrl?: string }): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) {
      throw ApiException.notFound('USER_NOT_FOUND', 'No such user');
    }
    await this.notifications.publish(userId, {
      kind: 'account',
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
    });
  }

  // ---------------------------------------------------------------------------
  // Staff tiers
  // ---------------------------------------------------------------------------

  async listStaff(): Promise<AdminUserRowDto[]> {
    const rows = await this.prisma.user.findMany({
      where: { platformRole: { not: PlatformRole.USER } },
      orderBy: [{ platformRole: 'desc' }, { email: 'asc' }],
      include: { subscription: true },
    });
    const usage = await this.usageFor(rows.map((r) => r.id));
    return rows.map((row) => this.toRow(row, usage.get(row.id)));
  }

  /**
   * Sets somebody's staff tier.
   *
   * Two rules, both about not stranding the organisation:
   * - nobody changes their own role, so an owner cannot demote themselves out
   *   of the portal by mistake;
   * - the last owner cannot be demoted, because an install with no owner has no
   *   way back in short of the environment variable.
   */
  async setStaffRole(actor: User, userId: string, wire: PlatformRoleWire): Promise<AdminUserRowDto> {
    if (userId === actor.id) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'CANNOT_CHANGE_OWN_ROLE',
        'You cannot change your own staff role',
      );
    }
    const role = platformRoleFromWire(wire);
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      throw ApiException.notFound('USER_NOT_FOUND', 'No such user');
    }
    if (target.platformRole === PlatformRole.OWNER && role !== PlatformRole.OWNER) {
      const owners = await this.prisma.user.count({
        where: { platformRole: PlatformRole.OWNER, deletedAt: null },
      });
      if (owners <= 1) {
        throw ApiException.conflict('LAST_OWNER', 'The last owner cannot be demoted');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { platformRole: role },
      include: { subscription: true },
    });
    this.logger.log(`${actor.email} set ${target.email} to platform ${wire}`);
    const usage = (await this.usageFor([userId])).get(userId);
    return this.toRow(updated, usage);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Loads a target and refuses the action when it would break the hierarchy.
   * Shared by suspend/unsuspend/delete so the rule cannot differ between them.
   */
  private async requireMutableTarget(actor: User, userId: string, action: string): Promise<User> {
    if (userId === actor.id) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'CANNOT_TARGET_SELF', `You cannot ${action} your own account`);
    }
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      throw ApiException.notFound('USER_NOT_FOUND', 'No such user');
    }
    if (target.platformRole !== PlatformRole.USER) {
      // Staff accounts are managed from the Staff page, where the tier rules
      // live. Letting the user list suspend an owner would route around them.
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'TARGET_IS_STAFF',
        'Remove this account from staff before changing its status',
      );
    }
    return target;
  }

  private whereFor(query: ListUsersQueryDto): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};

    if (query.q) {
      const contains = query.q.trim();
      where.OR = [
        { email: { contains, mode: 'insensitive' } },
        { firstName: { contains, mode: 'insensitive' } },
        { lastName: { contains, mode: 'insensitive' } },
      ];
    }
    if (query.status === 'active') {
      where.deletedAt = null;
      where.suspendedAt = null;
    } else if (query.status === 'suspended') {
      where.deletedAt = null;
      where.suspendedAt = { not: null };
    } else if (query.status === 'deleted') {
      where.deletedAt = { not: null };
    }
    if (query.role) {
      where.platformRole = platformRoleFromWire(query.role);
    }
    if (query.plan) {
      const plan = query.plan.toUpperCase() as BillingPlan;
      where.subscription = plan === BillingPlan.FREE ? { is: null } : { plan };
    }
    return where;
  }

  /** `drawingCount` and `bytesUsed` for many users in one grouped query. */
  private async usageFor(userIds: string[]): Promise<Map<string, { bytesUsed: number; drawingCount: number }>> {
    const out = new Map<string, { bytesUsed: number; drawingCount: number }>();
    if (userIds.length === 0) {
      return out;
    }
    const grouped = await this.prisma.drawing.groupBy({
      by: ['ownerId'],
      where: { ownerId: { in: userIds }, deletedAt: null },
      _sum: { byteSize: true },
      _count: { _all: true },
    });
    for (const row of grouped) {
      out.set(row.ownerId, { bytesUsed: row._sum.byteSize ?? 0, drawingCount: row._count._all });
    }
    return out;
  }

  private toRow(
    user: User & { subscription?: SubscriptionPlanColumns | null },
    usage: { bytesUsed: number; drawingCount: number } | undefined,
  ): AdminUserRowDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
      platformRole: platformRoleToWire(user.platformRole),
      status: statusOf(user),
      // What the account is ENTITLED to, not what the `plan` column holds — a
      // staff grant is exactly as real to the user as a purchase, and a list
      // that showed "free" beside a working Pro account would send staff
      // looking for a bug that is not there.
      plan: effectivePlanOf(user.subscription).toLowerCase(),
      onboarded: user.onboardedAt !== null,
      drawingCount: usage?.drawingCount ?? 0,
      bytesUsed: usage?.bytesUsed ?? 0,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

/** The subscription columns an entitlement decision reads. */
type SubscriptionPlanColumns = {
  plan: BillingPlan;
  status?: SubscriptionStatus;
  overridePlan?: BillingPlan | null;
  overrideUntil?: Date | null;
};

/** Plan ordering; mirrors `PLAN_RANK` in `BillingService`. */
const PLAN_ORDER: Record<BillingPlan, number> = {
  [BillingPlan.FREE]: 0,
  [BillingPlan.PRO]: 1,
  [BillingPlan.TEAM]: 2,
};

/** Statuses that entitle; mirrors `ENTITLING_STATUSES`. */
const ENTITLING: readonly SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
];

/**
 * The plan a row actually entitles, grant included.
 *
 * Duplicates `BillingService.effectivePlan`'s rule rather than calling it,
 * because this list reads hundreds of rows and injecting the billing service
 * here would pull its Dodo client and config into a module that has no other
 * use for them. The two must agree; the specs on both sides pin the behaviour.
 */
function effectivePlanOf(row: SubscriptionPlanColumns | null | undefined): BillingPlan {
  if (!row) return BillingPlan.FREE;
  const paid = row.status && ENTITLING.includes(row.status) ? row.plan : BillingPlan.FREE;
  const granted =
    row.overridePlan && (!row.overrideUntil || row.overrideUntil.getTime() > Date.now()) ? row.overridePlan : null;
  if (!granted) return paid;
  return PLAN_ORDER[granted] > PLAN_ORDER[paid] ? granted : paid;
}

/** Deleted outranks suspended: an account can be both, and deleted is the end state. */
function statusOf(user: Pick<User, 'deletedAt' | 'suspendedAt'>): AccountStatus {
  if (user.deletedAt) {
    return 'deleted';
  }
  return user.suspendedAt ? 'suspended' : 'active';
}
