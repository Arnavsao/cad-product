import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from '../../notifications/notifications.service';
import { ApiException } from '../../common/errors/api-error';
import { clampPage, type Page } from '../../common/utils/pagination';
import { BillingPlan, PlatformRole, Prisma, type User } from '../../generated/prisma/client';
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
          }
        : null,
      feedbackCount: user._count.feedback,
    };
  }

  /** The row as the audit trail should remember it, before a change. */
  async snapshot(userId: string): Promise<Record<string, unknown> | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, platformRole: true, suspendedAt: true, suspendedReason: true, deletedAt: true },
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
    user: User & { subscription?: { plan: BillingPlan } | null },
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
      plan: (user.subscription?.plan ?? BillingPlan.FREE).toLowerCase(),
      onboarded: user.onboardedAt !== null,
      drawingCount: usage?.drawingCount ?? 0,
      bytesUsed: usage?.bytesUsed ?? 0,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

/** Deleted outranks suspended: an account can be both, and deleted is the end state. */
function statusOf(user: Pick<User, 'deletedAt' | 'suspendedAt'>): AccountStatus {
  if (user.deletedAt) {
    return 'deleted';
  }
  return user.suspendedAt ? 'suspended' : 'active';
}
