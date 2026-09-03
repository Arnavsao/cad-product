import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { BillingCatalog } from './billing.catalog';

/**
 * Minimal ConfigService over a plain map.
 *
 * Cast rather than a real instance: the catalog only ever calls `get`, and
 * building a genuine ConfigService would drag in module loading for no gain.
 */
const configWith = (values: Record<string, string | undefined>): ConfigService<Env, true> =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService<Env, true>;

/**
 * The catalog is the only thing that knows which Dodo product means which plan.
 * A mistake here bills someone for Team and grants them Pro, so both directions
 * of the mapping are pinned.
 */
describe('BillingCatalog', () => {
  it('maps plan + interval to a product id', () => {
    const catalog = new BillingCatalog(
      configWith({
        DODO_PRODUCT_PRO_MONTHLY: 'pdt_pro_m',
        DODO_PRODUCT_PRO_ANNUAL: 'pdt_pro_a',
        DODO_PRODUCT_TEAM_MONTHLY: 'pdt_team_m',
        DODO_PRODUCT_TEAM_ANNUAL: 'pdt_team_a',
      }),
    );
    expect(catalog.productIdFor('pro', 'monthly')).toBe('pdt_pro_m');
    expect(catalog.productIdFor('pro', 'annual')).toBe('pdt_pro_a');
    expect(catalog.productIdFor('team', 'monthly')).toBe('pdt_team_m');
    expect(catalog.productIdFor('team', 'annual')).toBe('pdt_team_a');
    expect(catalog.isEmpty).toBe(false);
  });

  it('maps a product id back to its plan, both intervals', () => {
    // This is the webhook direction: Dodo tells us a product was bought and the
    // plan has to be derived from it.
    const catalog = new BillingCatalog(
      configWith({ DODO_PRODUCT_TEAM_MONTHLY: 'pdt_team_m', DODO_PRODUCT_TEAM_ANNUAL: 'pdt_team_a' }),
    );
    expect(catalog.planFor('pdt_team_m')).toBe('team');
    expect(catalog.planFor('pdt_team_a')).toBe('team');
  });

  it('returns null for an unconfigured plan rather than a blank id', () => {
    // Launching Pro before Team exists is legitimate; asking for Team must be a
    // clean miss, not a checkout against `undefined`.
    const catalog = new BillingCatalog(configWith({ DODO_PRODUCT_PRO_ANNUAL: 'pdt_pro_a' }));
    expect(catalog.productIdFor('pro', 'annual')).toBe('pdt_pro_a');
    expect(catalog.productIdFor('pro', 'monthly')).toBeNull();
    expect(catalog.productIdFor('team', 'annual')).toBeNull();
  });

  it('returns null for an unknown product id', () => {
    // A product created in the dashboard but not added to DODO_PRODUCT_* will
    // still send webhooks. The handler must be able to tell.
    const catalog = new BillingCatalog(configWith({ DODO_PRODUCT_PRO_ANNUAL: 'pdt_pro_a' }));
    expect(catalog.planFor('pdt_never_heard_of_it')).toBeNull();
  });

  it('is empty, not broken, when nothing is configured', () => {
    const catalog = new BillingCatalog(configWith({}));
    expect(catalog.isEmpty).toBe(true);
    expect(catalog.list()).toEqual([]);
    expect(catalog.productIdFor('pro', 'annual')).toBeNull();
  });

  it('refuses to let one product id back two different plans', () => {
    // Otherwise the reverse lookup is ambiguous and could grant the wrong tier.
    // The first mapping wins and the clash is logged as an error.
    const catalog = new BillingCatalog(
      configWith({ DODO_PRODUCT_PRO_ANNUAL: 'pdt_same', DODO_PRODUCT_TEAM_ANNUAL: 'pdt_same' }),
    );
    expect(catalog.planFor('pdt_same')).toBe('pro');
  });
});
