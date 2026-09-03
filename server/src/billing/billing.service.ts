import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingPlan, SubscriptionStatus, type Subscription } from '../generated/prisma/client';
import { ApiException } from '../common/errors/api-error';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { BillingCatalog } from './billing.catalog';
import { DODO_CLIENT, ENTITLING_STATUSES, type BillingInterval, type PurchasablePlan } from './billing.constants';
import type { DodoClient, DodoSubscription } from './dodo.client';
import type { BillingStateDto } from './dto/billing.dto';

/** Free-plan state for an account that has never bought anything. */
const FREE_STATE: BillingStateDto = {
  plan: 'free',
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEndsAt: null,
  manageable: false,
};

/**
 * Subscriptions and checkout, backed by Dodo Payments.
 *
 * Design decisions:
 *
 * - **Dodo is the source of truth; the `subscriptions` table is a projection.**
 *   Nothing here decides that someone is paid up — it records what Dodo told
 *   us. That is why there is no local cancel path that flips a flag: a
 *   cancellation happens in Dodo (via the customer portal) and arrives as a
 *   webhook. Any other design has two authorities that can disagree, and the
 *   one the customer's card follows is theirs.
 *
 * - **A missing row means Free, not an error.** `stateFor` returns
 *   {@link FREE_STATE} when there is no subscription, so `/me` works for every
 *   account that existed before billing shipped with no backfill migration.
 *
 * - **Not configured is a 503, not a crash.** With no `DODO_API_KEY` the client
 *   is absent and the checkout endpoints answer `BILLING_NOT_CONFIGURED`. Local
 *   development and the e2e suite have no Dodo account, and the alternative —
 *   refusing to boot — makes every other feature undemonstrable. This mirrors
 *   `MailModule`'s rule exactly.
 *
 * - **Entitlement is derived, never stored twice.** `plan` records what was
 *   bought and `status` whether it is current; the *effective* plan is computed
 *   from both by {@link effectivePlan}. Storing an "isPro" boolean alongside
 *   them would be a third fact that can contradict the other two.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  /** Origin used to build `return_url`. Falls back to the first CORS origin. */
  private readonly appBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: BillingCatalog,
    private readonly config: ConfigService<Env, true>,
    @Optional() @Inject(DODO_CLIENT) private readonly dodo: DodoClient | null,
  ) {
    const configured = this.config.get('APP_BASE_URL', { infer: true });
    const corsOrigins = this.config.get('CORS_ORIGIN', { infer: true }) as unknown as string[];
    this.appBaseUrl = (configured ?? corsOrigins?.[0] ?? 'http://localhost:4200').replace(/\/+$/, '');
  }

  /** True when checkout can actually be started. */
  get enabled(): boolean {
    return this.dodo !== null && !this.catalog.isEmpty;
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Billing state for `/me`. Never throws and never calls Dodo — this is on the
   * hot path for every dashboard load, so it is one indexed primary-key read.
   */
  async stateFor(userId: string): Promise<BillingStateDto> {
    const row = await this.prisma.subscription.findUnique({ where: { userId } });
    return this.toDto(row);
  }

  /**
   * The plan the account is actually entitled to right now.
   *
   * Separate from the stored `plan` because a cancelled Pro subscription still
   * has `plan = PRO` on the row (that is the historical fact of what they
   * bought) while entitling them to nothing. Feature checks must use this.
   */
  effectivePlan(row: Pick<Subscription, 'plan' | 'status'> | null): BillingPlan {
    if (!row) return BillingPlan.FREE;
    return (ENTITLING_STATUSES as readonly string[]).includes(row.status) ? row.plan : BillingPlan.FREE;
  }

  // ─── Checkout ────────────────────────────────────────────────────────────

  /**
   * Start a hosted checkout and return the URL to redirect the browser to.
   *
   * The Dodo customer record is created on first purchase and then reused, so a
   * returning customer keeps one identity (and one saved card) across plan
   * changes rather than accumulating a customer per checkout.
   */
  async createCheckout(
    userId: string,
    plan: PurchasablePlan,
    interval: BillingInterval,
  ): Promise<{ checkoutUrl: string }> {
    const dodo = this.requireClient();

    const productId = this.catalog.productIdFor(plan, interval);
    if (!productId) {
      throw ApiException.unprocessable(
        'PLAN_UNAVAILABLE',
        `The ${plan} plan is not available ${interval === 'annual' ? 'annually' : 'monthly'}`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, lastName: true, subscription: true },
    });
    if (!user) throw ApiException.notFound('USER_NOT_FOUND', 'Account not found');

    const customerId = user.subscription?.dodoCustomerId ?? (await this.ensureCustomer(user));

    const session = await dodo.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { customer_id: customerId },
      return_url: `${this.appBaseUrl}/dashboard/settings/billing`,
      // Echoed back on every webhook for this subscription. It is what lets a
      // webhook be attributed to an account without trusting the customer id
      // lookup alone.
      metadata: { userId, plan, interval },
    });

    if (!session.checkout_url) {
      // Only happens when a session is confirmed server-side, which we never
      // do. Treat it as an upstream contract break rather than redirecting to
      // `undefined`.
      this.logger.error(`Dodo returned no checkout_url for session ${session.session_id}`);
      throw new ApiException(HttpStatus.BAD_GATEWAY, 'CHECKOUT_FAILED', 'Could not start checkout');
    }

    this.logger.log(`Checkout ${session.session_id} started for user ${userId} (${plan}/${interval})`);
    return { checkoutUrl: session.checkout_url };
  }

  /**
   * A link to Dodo's hosted customer portal, where the customer changes card,
   * views invoices and cancels.
   *
   * Not reimplemented locally on purpose: cancellation, proration and dunning
   * are Dodo's to own, and a local mirror would be a second authority that can
   * drift. The trade-off is a redirect off-site, which is the same trade every
   * Stripe-portal integration makes.
   */
  async createPortalSession(userId: string): Promise<{ portalUrl: string }> {
    const dodo = this.requireClient();

    const row = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!row) {
      // Nothing has ever been bought, so Dodo has no customer to show a portal
      // for. 409 rather than 404: the account exists, the precondition does not.
      throw ApiException.conflict('NO_BILLING_ACCOUNT', 'There is no billing account to manage yet');
    }

    const { link } = await dodo.customers.customerPortal.create(row.dodoCustomerId);
    return { portalUrl: link };
  }

  // ─── Webhook application ─────────────────────────────────────────────────

  /**
   * Apply a verified subscription webhook payload.
   *
   * Attribution order matters: `metadata.userId` is what *we* put on the
   * checkout, so it is trusted first; the customer id is the fallback for
   * events on subscriptions created outside our checkout (a dashboard-created
   * comp account, say). Failing both, the event is recorded and skipped rather
   * than guessed at.
   */
  async applySubscriptionEvent(payload: DodoSubscription): Promise<'applied' | 'skipped'> {
    const subscriptionId = payload.subscription_id;
    const customerId = payload.customer?.customer_id ?? null;

    const userId = await this.resolveUserId(payload.metadata?.userId, customerId, subscriptionId);
    if (!userId) {
      this.logger.warn(
        `Subscription ${subscriptionId} could not be attributed to a user (customer=${customerId ?? 'none'}); skipping`,
      );
      return 'skipped';
    }

    const status = this.mapStatus(payload.status);
    const plan = this.planOf(payload.product_id, status);

    // `currentPeriodEnd` is what the UI shows as "renews on" / "access until".
    const periodEnd = this.parseDate(payload.next_billing_date);
    const trialEndsAt = this.trialEnd(payload);

    if (!customerId) {
      // Cannot create a row without the customer id (it is NOT NULL and is what
      // the portal link needs), so only update what already exists.
      const existing = await this.prisma.subscription.findUnique({ where: { userId } });
      if (!existing) {
        this.logger.warn(`Subscription ${subscriptionId} has no customer id and no existing row; skipping`);
        return 'skipped';
      }
    }

    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        dodoCustomerId: customerId!,
        dodoSubscriptionId: subscriptionId,
        dodoProductId: payload.product_id ?? null,
        plan,
        status,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: payload.cancel_at_next_billing_date ?? false,
        trialEndsAt,
      },
      update: {
        // The customer id is only ever written, never cleared: it outlives the
        // subscription and is what a future purchase and the portal need.
        ...(customerId ? { dodoCustomerId: customerId } : {}),
        dodoSubscriptionId: subscriptionId,
        dodoProductId: payload.product_id ?? null,
        plan,
        status,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: payload.cancel_at_next_billing_date ?? false,
        trialEndsAt,
      },
    });

    this.logger.log(`User ${userId}: plan=${plan} status=${status} (subscription ${subscriptionId})`);
    return 'applied';
  }

  /**
   * Re-read a subscription from Dodo and apply it.
   *
   * The recovery path for a webhook that was missed entirely — all 8 delivery
   * attempts exhausted, or the endpoint misconfigured for a while. Without it
   * the only fix is a manual database edit.
   */
  async reconcile(userId: string): Promise<BillingStateDto> {
    const dodo = this.requireClient();
    const row = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!row?.dodoSubscriptionId) return this.toDto(row);

    const fresh = await dodo.subscriptions.retrieve(row.dodoSubscriptionId);
    await this.applySubscriptionEvent(fresh);
    return this.stateFor(userId);
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private requireClient(): DodoClient {
    if (!this.dodo) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'BILLING_NOT_CONFIGURED',
        'Billing is not configured on this deployment',
      );
    }
    return this.dodo;
  }

  /** Create the Dodo customer and persist the id against a Free-plan row. */
  private async ensureCustomer(user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }): Promise<string> {
    const dodo = this.requireClient();
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;

    const { customer_id } = await dodo.customers.create({ email: user.email, name });

    // Written now, before checkout completes, so an abandoned checkout still
    // leaves one reusable customer instead of creating a new one next attempt.
    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, dodoCustomerId: customer_id, plan: BillingPlan.FREE, status: SubscriptionStatus.INCOMPLETE },
      update: { dodoCustomerId: customer_id },
    });

    this.logger.log(`Created Dodo customer ${customer_id} for user ${user.id}`);
    return customer_id;
  }

  private async resolveUserId(
    metadataUserId: string | undefined,
    customerId: string | null,
    subscriptionId: string,
  ): Promise<string | null> {
    if (metadataUserId) {
      const exists = await this.prisma.user.findUnique({ where: { id: metadataUserId }, select: { id: true } });
      if (exists) return exists.id;
      this.logger.warn(`metadata.userId ${metadataUserId} on subscription ${subscriptionId} matches no account`);
    }
    if (customerId) {
      const byCustomer = await this.prisma.subscription.findFirst({
        where: { dodoCustomerId: customerId },
        select: { userId: true },
      });
      if (byCustomer) return byCustomer.userId;
    }
    const bySubscription = await this.prisma.subscription.findUnique({
      where: { dodoSubscriptionId: subscriptionId },
      select: { userId: true },
    });
    return bySubscription?.userId ?? null;
  }

  /**
   * Dodo's status vocabulary → ours.
   *
   * Anything unrecognised becomes `INCOMPLETE`, which grants nothing. Failing
   * closed is the only safe direction: a new upstream status we have not seen
   * must not accidentally hand out a paid plan.
   */
  private mapStatus(status: string | null | undefined): SubscriptionStatus {
    switch ((status ?? '').toLowerCase()) {
      case 'active':
        return SubscriptionStatus.ACTIVE;
      case 'trialing':
      case 'on_trial':
        return SubscriptionStatus.TRIALING;
      case 'past_due':
      case 'failed':
        return SubscriptionStatus.PAST_DUE;
      case 'cancelled':
      case 'canceled':
      case 'expired':
        return SubscriptionStatus.CANCELLED;
      case 'pending':
      case 'on_hold':
      case 'paused':
        return SubscriptionStatus.INCOMPLETE;
      default:
        if (status) this.logger.warn(`Unrecognised Dodo subscription status '${status}' → INCOMPLETE`);
        return SubscriptionStatus.INCOMPLETE;
    }
  }

  /**
   * Plan for a product id.
   *
   * A cancelled subscription keeps the plan it was for — that is the record of
   * what they bought, and `effectivePlan` is what decides entitlement. An
   * unrecognised product id keeps FREE rather than guessing.
   */
  private planOf(productId: string | null | undefined, status: SubscriptionStatus): BillingPlan {
    if (!productId) return BillingPlan.FREE;
    const plan = this.catalog.planFor(productId);
    if (!plan) {
      this.logger.warn(`Product ${productId} is not in DODO_PRODUCT_* — leaving plan as FREE (status ${status})`);
      return BillingPlan.FREE;
    }
    return plan === 'team' ? BillingPlan.TEAM : BillingPlan.PRO;
  }

  private trialEnd(payload: DodoSubscription): Date | null {
    if (!payload.trial_period_days) return null;
    const start = this.parseDate(payload.previous_billing_date);
    if (!start) return null;
    return new Date(start.getTime() + payload.trial_period_days * 86_400_000);
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private toDto(row: Subscription | null): BillingStateDto {
    if (!row) return FREE_STATE;
    return {
      plan: this.effectivePlan(row).toLowerCase() as BillingStateDto['plan'],
      status: row.status.toLowerCase() as BillingStateDto['status'],
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      // The portal needs a Dodo customer, which only exists once something has
      // been bought (or at least attempted).
      manageable: this.enabled,
    };
  }
}
