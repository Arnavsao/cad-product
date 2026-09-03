/** DI token for the Dodo Payments client seam, so specs can replace it. */
export const DODO_CLIENT = Symbol('DODO_CLIENT');

/**
 * Billing intervals we sell. Dodo models monthly and annual as *separate
 * products*, so this is the axis that picks which product id to charge.
 */
export const BILLING_INTERVALS = ['monthly', 'annual'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/**
 * Paid plans a checkout can be started for.
 *
 * `free` is deliberately absent: there is nothing to buy, and offering it to
 * the checkout endpoint would mean writing a code path that creates a zero-
 * amount Dodo session for a plan the user already has by default.
 */
export const PURCHASABLE_PLANS = ['pro', 'team'] as const;
export type PurchasablePlan = (typeof PURCHASABLE_PLANS)[number];

/**
 * Statuses that entitle the account to its paid plan.
 *
 * `PAST_DUE` is included on purpose. Dodo retries a failed charge over several
 * days (dunning); cutting access off on the first failure punishes someone
 * whose card merely expired, and they typically fix it within that window. The
 * grace period is Dodo's retry schedule, and when it is exhausted the
 * subscription moves to `CANCELLED` and access ends then.
 */
export const ENTITLING_STATUSES = ['ACTIVE', 'TRIALING', 'PAST_DUE'] as const;
