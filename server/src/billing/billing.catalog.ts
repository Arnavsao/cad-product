import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import type { BillingInterval, PurchasablePlan } from './billing.constants';

/** One sellable line: a plan at an interval, backed by a Dodo product id. */
export interface CatalogEntry {
  plan: PurchasablePlan;
  interval: BillingInterval;
  productId: string;
}

/**
 * Maps the pricing page's tiers onto Dodo Payments product ids.
 *
 * Why this exists as its own class rather than a lookup inline in the service:
 *
 * - **Product ids are environment-specific.** Dodo issues different ids in test
 *   and live mode, so they cannot be constants in the source. Resolving them
 *   once here keeps `ConfigService` out of the request path.
 *
 * - **It is the reverse map too.** A webhook tells us a *product id* was
 *   bought; the plan it corresponds to has to be derived from that. Keeping
 *   both directions in one place is what stops them disagreeing — a mismatch
 *   would mean a customer pays for Team and is granted Pro.
 *
 * - **Partial configuration is legitimate.** Someone may launch Pro before Team
 *   exists. Each entry is independently present or absent, and asking for an
 *   unconfigured one is a clean error rather than a checkout against `undefined`.
 */
@Injectable()
export class BillingCatalog {
  private readonly logger = new Logger(BillingCatalog.name);

  /** `plan:interval` -> product id, for starting a checkout. */
  private readonly byPlan = new Map<string, string>();

  /** product id -> plan, for interpreting a webhook. */
  private readonly byProduct = new Map<string, PurchasablePlan>();

  constructor(config: ConfigService<Env, true>) {
    const entries: ReadonlyArray<[PurchasablePlan, BillingInterval, string | undefined]> = [
      ['pro', 'monthly', config.get('DODO_PRODUCT_PRO_MONTHLY', { infer: true })],
      ['pro', 'annual', config.get('DODO_PRODUCT_PRO_ANNUAL', { infer: true })],
      ['team', 'monthly', config.get('DODO_PRODUCT_TEAM_MONTHLY', { infer: true })],
      ['team', 'annual', config.get('DODO_PRODUCT_TEAM_ANNUAL', { infer: true })],
    ];

    for (const [plan, interval, productId] of entries) {
      if (!productId) continue;
      this.byPlan.set(`${plan}:${interval}`, productId);

      // A single product id must not back two plans: that would make the
      // webhook's plan lookup ambiguous and could silently grant the wrong
      // tier. Refuse to register the duplicate and say so loudly.
      const clash = this.byProduct.get(productId);
      if (clash && clash !== plan) {
        this.logger.error(
          `Product ${productId} is configured for both '${clash}' and '${plan}'. ` +
            `Ignoring the '${plan}' mapping — fix DODO_PRODUCT_* so each product backs one plan.`,
        );
        continue;
      }
      this.byProduct.set(productId, plan);
    }

    const configured = [...this.byPlan.keys()].sort();
    if (configured.length === 0) {
      this.logger.log('No DODO_PRODUCT_* ids configured — checkout is unavailable');
    } else {
      this.logger.log(`Billing catalog: ${configured.join(', ')}`);
    }
  }

  /** True when at least one plan can be bought. */
  get isEmpty(): boolean {
    return this.byPlan.size === 0;
  }

  /** Product id for a plan + interval, or null when it is not configured. */
  productIdFor(plan: PurchasablePlan, interval: BillingInterval): string | null {
    return this.byPlan.get(`${plan}:${interval}`) ?? null;
  }

  /**
   * Plan a product id corresponds to, or null when unrecognised.
   *
   * Null is a real case, not a bug: a product created in the Dodo dashboard but
   * not yet added to `DODO_PRODUCT_*` will send webhooks. The caller records the
   * event and leaves the plan alone rather than guessing.
   */
  planFor(productId: string): PurchasablePlan | null {
    return this.byProduct.get(productId) ?? null;
  }

  /** Everything sellable, for the pricing page and for diagnostics. */
  list(): CatalogEntry[] {
    return [...this.byPlan.entries()].map(([key, productId]) => {
      const [plan, interval] = key.split(':') as [PurchasablePlan, BillingInterval];
      return { plan, interval, productId };
    });
  }
}
