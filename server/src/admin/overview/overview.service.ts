import { Injectable, Logger } from '@nestjs/common';
import { BillingPlan, PlatformRole, Prisma, SubscriptionStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 86_400_000;

/** How long a computed overview is reused. */
export const OVERVIEW_CACHE_TTL_MS = 60_000;

/** Metrics the time-series endpoint can draw. */
export const TIMESERIES_METRICS = ['signups', 'active', 'drawings', 'feedback'] as const;
export type TimeseriesMetric = (typeof TIMESERIES_METRICS)[number];

export interface OverviewDto {
  users: { total: number; new7d: number; new30d: number; suspended: number; deleted: number; staff: number };
  active: { daily: number; weekly: number; monthly: number };
  drawings: { total: number; new7d: number; trashed: number; bytesUsed: number };
  feedback: { open: number; new7d: number; byStatus: Record<string, number> };
  billing: { byPlan: Record<string, number>; active: number; pastDue: number; webhookFailures7d: number };
  health: { dbLatencyMs: number };
  generatedAt: string;
}

export interface TimeseriesPointDto {
  date: string;
  value: number;
}

/**
 * The numbers on the portal's front page.
 *
 * Two design choices worth stating:
 *
 * - **Computed from the existing tables, not from a metrics store.** At beta
 *   scale the counts are indexed aggregates over tens of thousands of rows,
 *   which Postgres answers in milliseconds. Standing up a separate pipeline
 *   before there is traffic to justify it would be work spent on the wrong
 *   problem.
 * - **Cached for a minute.** The page is refreshed by people watching a launch;
 *   without a cache that is a dozen aggregate queries per staff member per
 *   minute, all returning the same thing.
 */
@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);
  private cache: { value: OverviewDto; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<OverviewDto> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    const day = new Date(now - DAY_MS);
    const week = new Date(now - 7 * DAY_MS);
    const month = new Date(now - 30 * DAY_MS);
    const startedAt = Date.now();

    const [
      usersTotal,
      usersNew7d,
      usersNew30d,
      usersSuspended,
      usersDeleted,
      staff,
      activeDaily,
      activeWeekly,
      activeMonthly,
      drawingsTotal,
      drawingsNew7d,
      drawingsTrashed,
      bytes,
      feedbackNew7d,
      subsActive,
      subsPastDue,
      webhookFailures,
    ] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, createdAt: { gte: week } } }),
      this.prisma.user.count({ where: { deletedAt: null, createdAt: { gte: month } } }),
      this.prisma.user.count({ where: { deletedAt: null, suspendedAt: { not: null } } }),
      this.prisma.user.count({ where: { deletedAt: { not: null } } }),
      this.prisma.user.count({ where: { deletedAt: null, platformRole: { not: PlatformRole.USER } } }),
      this.prisma.user.count({ where: { deletedAt: null, lastSeenAt: { gte: day } } }),
      this.prisma.user.count({ where: { deletedAt: null, lastSeenAt: { gte: week } } }),
      this.prisma.user.count({ where: { deletedAt: null, lastSeenAt: { gte: month } } }),
      this.prisma.drawing.count({ where: { deletedAt: null } }),
      this.prisma.drawing.count({ where: { deletedAt: null, createdAt: { gte: week } } }),
      this.prisma.drawing.count({ where: { deletedAt: { not: null } } }),
      this.prisma.drawing.aggregate({ where: { deletedAt: null }, _sum: { byteSize: true } }),
      this.prisma.feedback.count({ where: { createdAt: { gte: week } } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.PAST_DUE } }),
      this.prisma.webhookEvent.count({ where: { receivedAt: { gte: week }, processedAt: null } }),
    ]);

    // The two grouped queries run outside the transaction above: inside a
    // `$transaction` array Prisma widens every result to a union, which loses
    // `_count._all`'s type. They are independent reads, so nothing is gained by
    // keeping them in the same snapshot.
    const [feedbackByStatus, subsByPlan] = await Promise.all([
      this.prisma.feedback.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      this.prisma.subscription.groupBy({ by: ['plan'], _count: { _all: true }, orderBy: { plan: 'asc' } }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of feedbackByStatus) {
      byStatus[row.status.toLowerCase()] = row._count._all;
    }
    const byPlan: Record<string, number> = { free: 0, pro: 0, team: 0 };
    for (const row of subsByPlan) {
      byPlan[row.plan.toLowerCase()] = row._count._all;
    }
    // Everyone without a subscription row is on Free; the table only holds
    // people who have been through checkout.
    byPlan[BillingPlan.FREE.toLowerCase()] = usersTotal - (byPlan.pro + byPlan.team);

    const value: OverviewDto = {
      users: {
        total: usersTotal,
        new7d: usersNew7d,
        new30d: usersNew30d,
        suspended: usersSuspended,
        deleted: usersDeleted,
        staff,
      },
      active: { daily: activeDaily, weekly: activeWeekly, monthly: activeMonthly },
      drawings: {
        total: drawingsTotal,
        new7d: drawingsNew7d,
        trashed: drawingsTrashed,
        bytesUsed: bytes._sum.byteSize ?? 0,
      },
      feedback: {
        open: (byStatus.new ?? 0) + (byStatus.triaged ?? 0) + (byStatus.in_progress ?? 0),
        new7d: feedbackNew7d,
        byStatus,
      },
      billing: {
        byPlan,
        active: subsActive,
        pastDue: subsPastDue,
        webhookFailures7d: webhookFailures,
      },
      health: { dbLatencyMs: Date.now() - startedAt },
      generatedAt: new Date().toISOString(),
    };

    this.cache = { value, expiresAt: now + OVERVIEW_CACHE_TTL_MS };
    return value;
  }

  /**
   * Daily counts for one metric over `days`, oldest first, with zero-filled
   * gaps so a sparkline never implies a missing day was a busy one.
   *
   * Raw SQL because Prisma's `groupBy` cannot group on an expression, and
   * `date_trunc` in the database beats pulling every row into Node to bucket
   * it here. The metric name is matched against a fixed list, never
   * interpolated, so this stays parameterised.
   */
  async timeseries(metric: TimeseriesMetric, days: number): Promise<TimeseriesPointDto[]> {
    const span = Math.min(Math.max(Math.trunc(days), 1), 365);
    const since = new Date(Date.now() - span * DAY_MS);

    const rows = await this.queryFor(metric, since);
    const counts = new Map(rows.map((row) => [isoDay(row.day), Number(row.count)]));

    const out: TimeseriesPointDto[] = [];
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    for (let i = span - 1; i >= 0; i--) {
      const date = isoDay(new Date(startOfToday.getTime() - i * DAY_MS));
      out.push({ date, value: counts.get(date) ?? 0 });
    }
    return out;
  }

  private queryFor(metric: TimeseriesMetric, since: Date): Promise<{ day: Date; count: bigint }[]> {
    switch (metric) {
      case 'signups':
        return this.prisma.$queryRaw`
          SELECT date_trunc('day', "created_at") AS day, COUNT(*)::bigint AS count
          FROM "users" WHERE "created_at" >= ${since} AND "deleted_at" IS NULL
          GROUP BY 1 ORDER BY 1`;
      case 'active':
        return this.prisma.$queryRaw`
          SELECT date_trunc('day', "last_seen_at") AS day, COUNT(*)::bigint AS count
          FROM "users" WHERE "last_seen_at" >= ${since} AND "deleted_at" IS NULL
          GROUP BY 1 ORDER BY 1`;
      case 'drawings':
        return this.prisma.$queryRaw`
          SELECT date_trunc('day', "created_at") AS day, COUNT(*)::bigint AS count
          FROM "drawings" WHERE "created_at" >= ${since}
          GROUP BY 1 ORDER BY 1`;
      case 'feedback':
        return this.prisma.$queryRaw`
          SELECT date_trunc('day', "created_at") AS day, COUNT(*)::bigint AS count
          FROM "feedback" WHERE "created_at" >= ${since}
          GROUP BY 1 ORDER BY 1`;
      default: {
        // Exhaustiveness: a new metric must be given a query, not silently
        // return an empty chart.
        const never: never = metric;
        throw new Error(`Unhandled metric ${String(never)}`);
      }
    }
  }

  invalidate(): void {
    this.cache = null;
  }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Kept for the raw-SQL call sites above to stay readable. */
export type { Prisma };
