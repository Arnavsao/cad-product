import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { FlagsService } from '../../admin/flags/flags.service';
import { ApiException } from '../../common/errors/api-error';
import { BillingPlan } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing.service';

/**
 * What each plan allows. Mirrors the pricing page's published limits — the
 * Free tier's "3 drawings, 50 MB" has been advertised since launch and never
 * enforced, which is what this fixes.
 *
 * `Infinity` rather than a large number so an accidental comparison against a
 * cap reads as unlimited instead of as a very generous limit.
 */
export interface PlanLimits {
  drawings: number;
  bytes: number;
}

export const PLAN_LIMITS: Record<BillingPlan, PlanLimits> = {
  [BillingPlan.FREE]: { drawings: 3, bytes: 50 * 1024 * 1024 },
  [BillingPlan.PRO]: { drawings: Infinity, bytes: 5 * 1024 * 1024 * 1024 },
  [BillingPlan.TEAM]: { drawings: Infinity, bytes: 50 * 1024 * 1024 * 1024 },
};

/** What a caller is allowed and how much of it they have used. */
export interface QuotaState {
  plan: BillingPlan;
  limits: PlanLimits;
  drawingCount: number;
  bytesUsed: number;
  enforced: boolean;
}

/**
 * Plan limits, enforced.
 *
 * **Off by default.** The `billing.enforceQuotas` flag gates every check here,
 * because turning enforcement on is a behaviour change for accounts that have
 * been over the advertised limit for months without being told. Whoever decides
 * to enforce should do it deliberately, having looked at how many accounts it
 * affects — the admin portal's flag page is where that decision gets made and
 * recorded.
 *
 * Limits are counted against the drawing's OWNER, not the person acting: in an
 * organization, a member saving into a shared workspace is spending the
 * workspace creator's allowance, which is what `ownerId` has always meant.
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly flags: FlagsService,
  ) {}

  /** Current usage and allowance for one account. */
  async stateFor(userId: string): Promise<QuotaState> {
    const [subscription, usage, enforced] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { userId } }),
      this.prisma.drawing.aggregate({
        where: { ownerId: userId, deletedAt: null },
        _sum: { byteSize: true },
        _count: { _all: true },
      }),
      // The registry's default for this key is OFF, so an unset flag (or an
      // unreadable one) means "do not enforce" without the caller restating it.
      this.flags.enabled('billing.enforceQuotas'),
    ]);

    const plan = this.billing.effectivePlan(subscription);
    return {
      plan,
      limits: PLAN_LIMITS[plan],
      drawingCount: usage._count._all,
      bytesUsed: usage._sum.byteSize ?? 0,
      enforced,
    };
  }

  /**
   * Refuses a new drawing when the owner is at their limit.
   *
   * 402 rather than 403: the caller is not forbidden, they need to pay — and
   * the client branches on that to show an upgrade prompt rather than an error.
   * The response carries the limit and the usage so the message can say which
   * wall was hit without a second request.
   */
  async assertCanCreateDrawing(ownerId: string, incomingBytes: number): Promise<void> {
    const state = await this.stateFor(ownerId);
    if (!state.enforced) {
      return;
    }

    if (state.drawingCount >= state.limits.drawings) {
      throw new ApiException(
        HttpStatus.PAYMENT_REQUIRED,
        'DRAWING_LIMIT_REACHED',
        `The ${state.plan.toLowerCase()} plan includes ${state.limits.drawings} drawings.`,
        { limit: state.limits.drawings, used: state.drawingCount, plan: state.plan.toLowerCase() },
      );
    }

    if (state.bytesUsed + incomingBytes > state.limits.bytes) {
      throw new ApiException(
        HttpStatus.PAYMENT_REQUIRED,
        'STORAGE_LIMIT_REACHED',
        `The ${state.plan.toLowerCase()} plan includes ${Math.round(state.limits.bytes / 1024 / 1024)} MB of storage.`,
        { limit: state.limits.bytes, used: state.bytesUsed, plan: state.plan.toLowerCase() },
      );
    }
  }

  /**
   * Refuses a save that would push an account over its storage limit.
   *
   * Deliberately NOT applied to a save that shrinks or barely grows a drawing:
   * locking somebody out of work they have already done is a worse outcome than
   * a few megabytes over, and the drawing count is the limit that actually
   * bites on the Free tier. Only a materially larger save is refused.
   */
  async assertCanGrow(ownerId: string, deltaBytes: number): Promise<void> {
    if (deltaBytes <= 0) {
      return;
    }
    const state = await this.stateFor(ownerId);
    if (!state.enforced) {
      return;
    }
    if (state.bytesUsed + deltaBytes > state.limits.bytes) {
      throw new ApiException(
        HttpStatus.PAYMENT_REQUIRED,
        'STORAGE_LIMIT_REACHED',
        `The ${state.plan.toLowerCase()} plan includes ${Math.round(state.limits.bytes / 1024 / 1024)} MB of storage.`,
        { limit: state.limits.bytes, used: state.bytesUsed, plan: state.plan.toLowerCase() },
      );
    }
  }
}
