import { IsIn, IsOptional } from 'class-validator';
import { BILLING_INTERVALS, PURCHASABLE_PLANS, type BillingInterval, type PurchasablePlan } from '../billing.constants';

/** Wire form of the plans, lower-case like every other enum in this API. */
export type PlanWire = 'free' | 'pro' | 'team';
export type SubscriptionStatusWire = 'active' | 'trialing' | 'past_due' | 'cancelled' | 'incomplete';

/**
 * Billing state as `/me` reports it.
 *
 * `plan` is the *effective* plan — what the account is entitled to now — not
 * the row's stored plan. A cancelled Pro subscription reports `free` here while
 * the database still records that Pro was what they bought.
 */
export interface BillingStateDto {
  plan: PlanWire;
  /** Null when nothing has ever been purchased. */
  status: SubscriptionStatusWire | null;
  /** ISO 8601. What the UI shows as "renews on", or "access until" when cancelling. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  /** True when a customer-portal link can be created on this deployment. */
  manageable: boolean;
}

/** Body of `POST /billing/checkout`. */
export class CreateCheckoutDto {
  @IsIn(PURCHASABLE_PLANS)
  plan!: PurchasablePlan;

  /**
   * Defaults to annual, matching the pricing page's default toggle. Anything
   * outside the two known values is rejected rather than silently coerced —
   * a typo'd interval must not quietly charge the monthly price.
   */
  @IsOptional()
  @IsIn(BILLING_INTERVALS)
  interval?: BillingInterval;
}

export interface CheckoutResponseDto {
  /** Absolute Dodo-hosted URL. Single-use; expires in 24 hours. */
  checkoutUrl: string;
}

export interface PortalResponseDto {
  portalUrl: string;
}
