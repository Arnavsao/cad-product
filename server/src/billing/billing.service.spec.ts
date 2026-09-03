import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BillingPlan, SubscriptionStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingCatalog } from './billing.catalog';
import { DODO_CLIENT } from './billing.constants';
import { BillingService } from './billing.service';
import type { DodoClient } from './dodo.client';

const PRO_ANNUAL = 'pdt_pro_a';
const TEAM_ANNUAL = 'pdt_team_a';

/** Prisma stub — only the calls this service makes. */
function prismaStub() {
  return {
    subscription: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
}

function dodoStub(): DodoClient {
  return {
    checkoutSessions: { create: jest.fn().mockResolvedValue({ session_id: 'cks_1', checkout_url: 'https://checkout/x' }) },
    customers: {
      create: jest.fn().mockResolvedValue({ customer_id: 'cus_new' }),
      customerPortal: { create: jest.fn().mockResolvedValue({ link: 'https://portal/x' }) },
    },
    subscriptions: { retrieve: jest.fn().mockResolvedValue({ subscription_id: 'sub_1' }) },
    webhooks: { unwrap: jest.fn() },
  } as unknown as DodoClient;
}

async function build(opts: { dodo?: DodoClient | null; products?: Record<string, string> } = {}) {
  const prisma = prismaStub();
  const values: Record<string, unknown> = {
    CORS_ORIGIN: ['http://localhost:4200'],
    DODO_PRODUCT_PRO_ANNUAL: PRO_ANNUAL,
    DODO_PRODUCT_TEAM_ANNUAL: TEAM_ANNUAL,
    ...opts.products,
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      BillingService,
      BillingCatalog,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: { get: (k: string) => values[k] } },
      { provide: DODO_CLIENT, useValue: opts.dodo === undefined ? dodoStub() : opts.dodo },
    ],
  }).compile();
  return { service: moduleRef.get(BillingService), prisma, dodo: moduleRef.get<DodoClient | null>(DODO_CLIENT) };
}

describe('BillingService', () => {
  describe('effectivePlan — what the account is actually entitled to', () => {
    it('grants the plan while ACTIVE or TRIALING', async () => {
      const { service } = await build();
      expect(service.effectivePlan({ plan: BillingPlan.PRO, status: SubscriptionStatus.ACTIVE })).toBe(BillingPlan.PRO);
      expect(service.effectivePlan({ plan: BillingPlan.TEAM, status: SubscriptionStatus.TRIALING })).toBe(BillingPlan.TEAM);
    });

    it('KEEPS access while PAST_DUE', async () => {
      // Dodo retries a failed charge over several days. Cutting access on the
      // first failure punishes an expired card; the grace period is their
      // retry schedule, after which the status becomes CANCELLED.
      const { service } = await build();
      expect(service.effectivePlan({ plan: BillingPlan.PRO, status: SubscriptionStatus.PAST_DUE })).toBe(BillingPlan.PRO);
    });

    it('revokes access when CANCELLED or INCOMPLETE, without forgetting what was bought', async () => {
      const { service } = await build();
      expect(service.effectivePlan({ plan: BillingPlan.PRO, status: SubscriptionStatus.CANCELLED })).toBe(BillingPlan.FREE);
      expect(service.effectivePlan({ plan: BillingPlan.TEAM, status: SubscriptionStatus.INCOMPLETE })).toBe(BillingPlan.FREE);
    });

    it('treats no subscription row as Free', async () => {
      // Every account that predates billing has no row and must still work.
      const { service } = await build();
      expect(service.effectivePlan(null)).toBe(BillingPlan.FREE);
    });
  });

  describe('when billing is not configured', () => {
    it('still reports Free state for /me', async () => {
      const { service } = await build({ dodo: null });
      await expect(service.stateFor('u1')).resolves.toEqual({
        plan: 'free',
        status: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
        manageable: false,
      });
    });

    it('refuses checkout with BILLING_NOT_CONFIGURED, not a crash', async () => {
      const { service } = await build({ dodo: null });
      await expect(service.createCheckout('u1', 'pro', 'annual')).rejects.toThrow();
      try {
        await service.createCheckout('u1', 'pro', 'annual');
      } catch (e) {
        expect((e as { code: string }).code).toBe('BILLING_NOT_CONFIGURED');
      }
    });

    it('reports enabled=false', async () => {
      const { service } = await build({ dodo: null });
      expect(service.enabled).toBe(false);
    });
  });

  describe('createCheckout', () => {
    it('rejects a plan with no configured product id', async () => {
      const { service } = await build({ products: { DODO_PRODUCT_PRO_ANNUAL: undefined as unknown as string } });
      try {
        await service.createCheckout('u1', 'pro', 'annual');
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as { code: string }).code).toBe('PLAN_UNAVAILABLE');
      }
    });

    it('reuses an existing Dodo customer instead of creating a second one', async () => {
      const { service, prisma, dodo } = await build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.c',
        firstName: 'A',
        lastName: 'B',
        subscription: { dodoCustomerId: 'cus_existing' },
      });

      const out = await service.createCheckout('u1', 'pro', 'annual');

      expect(out.checkoutUrl).toBe('https://checkout/x');
      expect(dodo!.customers.create).not.toHaveBeenCalled();
      const body = (dodo!.checkoutSessions.create as jest.Mock).mock.calls.at(-1)![0];
      expect(body.customer).toEqual({ customer_id: 'cus_existing' });
      expect(body.product_cart).toEqual([{ product_id: PRO_ANNUAL, quantity: 1 }]);
    });

    it('puts our userId in metadata so a webhook can be attributed', async () => {
      const { service, prisma, dodo } = await build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'u42', email: 'a@b.c', firstName: null, lastName: null,
        subscription: { dodoCustomerId: 'cus_1' },
      });
      await service.createCheckout('u42', 'team', 'annual');
      const body = (dodo!.checkoutSessions.create as jest.Mock).mock.calls.at(-1)![0];
      expect(body.metadata).toEqual({ userId: 'u42', plan: 'team', interval: 'annual' });
    });

    it('creates a customer on first purchase and persists it before checkout completes', async () => {
      // So an abandoned checkout leaves one reusable customer rather than
      // creating a fresh one on the next attempt.
      const { service, prisma, dodo } = await build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'a@b.c', firstName: 'A', lastName: 'B', subscription: null,
      });
      await service.createCheckout('u1', 'pro', 'annual');
      expect(dodo!.customers.create).toHaveBeenCalledWith({ email: 'a@b.c', name: 'A B' });
      expect(prisma.subscription.upsert).toHaveBeenCalled();
    });
  });

  describe('createPortalSession', () => {
    it('is a conflict, not a 404, when nothing has ever been bought', async () => {
      const { service } = await build();
      try {
        await service.createPortalSession('u1');
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as { code: string }).code).toBe('NO_BILLING_ACCOUNT');
      }
    });

    it('returns the Dodo portal link for a known customer', async () => {
      const { service, prisma } = await build();
      prisma.subscription.findUnique.mockResolvedValue({ userId: 'u1', dodoCustomerId: 'cus_1' });
      await expect(service.createPortalSession('u1')).resolves.toEqual({ portalUrl: 'https://portal/x' });
    });
  });

  describe('applySubscriptionEvent', () => {
    const base = {
      subscription_id: 'sub_1',
      customer: { customer_id: 'cus_1' },
      product_id: PRO_ANNUAL,
      next_billing_date: '2026-12-01T00:00:00.000Z',
      metadata: { userId: 'u1' },
    };

    it('grants the plan an active subscription paid for', async () => {
      const { service, prisma } = await build();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await expect(service.applySubscriptionEvent({ ...base, status: 'active' })).resolves.toEqual('applied');
      const args = prisma.subscription.upsert.mock.calls.at(-1)![0];
      expect(args.update.plan).toBe(BillingPlan.PRO);
      expect(args.update.status).toBe(SubscriptionStatus.ACTIVE);
    });

    it('maps an UNKNOWN upstream status to INCOMPLETE, granting nothing', async () => {
      // Failing closed: a status Dodo adds later must never accidentally hand
      // out a paid plan.
      const { service, prisma } = await build();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await service.applySubscriptionEvent({ ...base, status: 'some_future_status' });
      expect(prisma.subscription.upsert.mock.calls.at(-1)![0].update.status).toBe(SubscriptionStatus.INCOMPLETE);
    });

    it('leaves the plan FREE for a product id that is not configured', async () => {
      const { service, prisma } = await build();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await service.applySubscriptionEvent({ ...base, product_id: 'pdt_unknown', status: 'active' });
      expect(prisma.subscription.upsert.mock.calls.at(-1)![0].update.plan).toBe(BillingPlan.FREE);
    });

    it('skips, rather than guesses, when the event cannot be attributed to a user', async () => {
      const { service, prisma } = await build();
      prisma.user.findUnique.mockResolvedValue(null);   // metadata userId matches nothing
      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.subscription.findUnique.mockResolvedValue(null);
      await expect(service.applySubscriptionEvent({ ...base, status: 'active' })).resolves.toEqual('skipped');
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('falls back to the customer id when metadata is absent', async () => {
      const { service, prisma } = await build();
      prisma.subscription.findFirst.mockResolvedValue({ userId: 'u9' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u9' });
      const { metadata, ...noMeta } = base;
      await expect(service.applySubscriptionEvent({ ...noMeta, status: 'active' })).resolves.toEqual('applied');
      expect(prisma.subscription.upsert.mock.calls.at(-1)![0].where).toEqual({ userId: 'u9' });
    });

    it('records cancel-at-period-end without revoking access yet', async () => {
      const { service, prisma } = await build();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await service.applySubscriptionEvent({ ...base, status: 'active', cancel_at_next_billing_date: true });
      const update = prisma.subscription.upsert.mock.calls.at(-1)![0].update;
      expect(update.cancelAtPeriodEnd).toBe(true);
      expect(update.status).toBe(SubscriptionStatus.ACTIVE);
    });
  });
});
