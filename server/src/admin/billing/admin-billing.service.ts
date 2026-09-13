import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingCatalog } from '../../billing/billing.catalog';
import { clampPage, type Page } from '../../common/utils/pagination';
import type { Env } from '../../config/env.schema';
import { BillingPlan, Prisma, SubscriptionStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Display prices, in whole currency units per month.
 *
 * Mirrors `src/app/features/pricing/pricing.data.ts`, and is the reason every
 * revenue figure here is labelled approximate: Dodo charges whatever its
 * product says, and nothing in this codebase can reconcile the two. A number
 * that is roughly right and honestly labelled beats a precise-looking one that
 * silently drifts from what customers were actually billed.
 */
const MONTHLY_PRICE: Record<BillingPlan, number> = {
  [BillingPlan.FREE]: 0,
  [BillingPlan.PRO]: 10,
  [BillingPlan.TEAM]: 24,
};

/** Statuses that mean money is currently expected. */
const PAYING: readonly SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING];

export interface AdminSubscriptionRowDto {
  userId: string;
  email: string;
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  overridePlan: string | null;
  dodoSubscriptionId: string | null;
  createdAt: string;
}

export interface AdminWebhookRowDto {
  id: string;
  type: string;
  processedAt: string | null;
  error: string | null;
  receivedAt: string;
}

export interface BillingSummaryDto {
  /** Approximate monthly recurring revenue; see the note on `MONTHLY_PRICE`. */
  approximateMrr: number;
  currency: string;
  byPlan: Record<string, number>;
  paying: number;
  trialing: number;
  pastDue: number;
  cancelled: number;
  grants: number;
  /** Deliveries recorded but never applied. Each one may be a customer who paid for nothing. */
  unprocessedWebhooks: number;
  catalog: { mode: 'off' | 'test' | 'live'; sellable: string[]; webhookConfigured: boolean };
}

/**
 * The billing console.
 *
 * Read-only over Dodo's data on purpose. Nothing here cancels, refunds or
 * changes a price — those belong in Dodo, where the customer's card actually
 * lives, and a second place that can change what somebody pays is a second
 * place that can disagree with their bank statement. What this adds is the
 * questions Dodo cannot answer: which of OUR accounts is on what, and which
 * deliveries never landed.
 */
@Injectable()
export class AdminBillingService {
  private readonly logger = new Logger(AdminBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: BillingCatalog,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async summary(): Promise<BillingSummaryDto> {
    const [byPlanRows, paying, trialing, pastDue, cancelled, grants, unprocessed] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['plan'],
        where: { status: { in: [...PAYING] } },
        _count: { _all: true },
        orderBy: { plan: 'asc' },
      }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.TRIALING } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.PAST_DUE } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.CANCELLED } }),
      this.prisma.subscription.count({ where: { overridePlan: { not: null } } }),
      this.prisma.webhookEvent.count({ where: { processedAt: null } }),
    ]);

    const byPlan: Record<string, number> = { free: 0, pro: 0, team: 0 };
    let mrr = 0;
    for (const row of byPlanRows) {
      byPlan[row.plan.toLowerCase()] = row._count._all;
      // Trials count toward MRR: they are expected to convert, and excluding
      // them makes the number swing every time a cohort starts.
      mrr += MONTHLY_PRICE[row.plan] * row._count._all;
    }

    const key = this.config.get('DODO_API_KEY', { infer: true });
    return {
      approximateMrr: mrr,
      currency: 'USD',
      byPlan,
      paying,
      trialing,
      pastDue,
      cancelled,
      grants,
      unprocessedWebhooks: unprocessed,
      catalog: {
        mode: !key ? 'off' : key.startsWith('sk_test_') ? 'test' : 'live',
        sellable: this.catalog.list().map((entry) => `${entry.plan}:${entry.interval}`),
        webhookConfigured: Boolean(this.config.get('DODO_WEBHOOK_KEY', { infer: true })),
      },
    };
  }

  async subscriptions(query: {
    plan?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Page<AdminSubscriptionRowDto>> {
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? 25, 100);

    const where: Prisma.SubscriptionWhereInput = {};
    if (query.plan) {
      where.plan = query.plan.toUpperCase() as BillingPlan;
    }
    if (query.status) {
      where.status = query.status.toUpperCase() as SubscriptionStatus;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { email: true } } },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        userId: row.userId,
        email: row.user.email,
        plan: row.plan.toLowerCase(),
        status: row.status.toLowerCase(),
        currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        overridePlan: row.overridePlan?.toLowerCase() ?? null,
        dodoSubscriptionId: row.dodoSubscriptionId,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: null,
      total,
      page,
      pageSize,
    };
  }

  /**
   * Webhook deliveries, newest first, unprocessed ones first when asked.
   *
   * The payload is NOT returned in the list: it contains customer billing
   * details, and a list view is the wrong place to spread those around. The
   * detail endpoint returns it for the one delivery being investigated.
   */
  async webhooks(query: { status?: string; page?: number; pageSize?: number }): Promise<Page<AdminWebhookRowDto>> {
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? 25, 100);

    const where: Prisma.WebhookEventWhereInput = {};
    if (query.status === 'unprocessed') {
      where.processedAt = null;
    } else if (query.status === 'failed') {
      where.error = { not: null };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.webhookEvent.count({ where }),
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, type: true, processedAt: true, error: true, receivedAt: true },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        processedAt: row.processedAt?.toISOString() ?? null,
        error: row.error,
        receivedAt: row.receivedAt.toISOString(),
      })),
      nextCursor: null,
      total,
      page,
      pageSize,
    };
  }
}
