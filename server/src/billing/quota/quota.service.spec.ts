import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { FlagsService } from '../../admin/flags/flags.service';
import { BillingPlan } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing.service';
import { PLAN_LIMITS, QuotaService } from './quota.service';

describe('QuotaService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let billing: DeepMockProxy<BillingService>;
  let flags: DeepMockProxy<FlagsService>;
  let service: QuotaService;

  /** Usage the aggregate query reports back. */
  function usage(drawings: number, bytes: number): void {
    (prisma.drawing.aggregate as unknown as jest.Mock).mockResolvedValue({
      _sum: { byteSize: bytes },
      _count: { _all: drawings },
    });
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    billing = mockDeep<BillingService>();
    flags = mockDeep<FlagsService>();
    service = new QuotaService(prisma, billing, flags);

    prisma.subscription.findUnique.mockResolvedValue(null);
    billing.effectivePlan.mockReturnValue(BillingPlan.FREE);
  });

  describe('when enforcement is off', () => {
    beforeEach(() => flags.enabled.mockResolvedValue(false));

    it('allows a create far beyond the limit', async () => {
      usage(999, 10 * 1024 * 1024 * 1024);
      // This is the default state of the deployment, and must stay a no-op:
      // accounts have been over the advertised limit for months.
      await expect(service.assertCanCreateDrawing('u1', 1024)).resolves.toBeUndefined();
    });

    it('allows growth beyond the limit', async () => {
      usage(1, 10 * 1024 * 1024 * 1024);
      await expect(service.assertCanGrow('u1', 1024)).resolves.toBeUndefined();
    });
  });

  describe('when enforcement is on', () => {
    beforeEach(() => flags.enabled.mockResolvedValue(true));

    it('allows a free account below its limits', async () => {
      usage(2, 1024);
      await expect(service.assertCanCreateDrawing('u1', 1024)).resolves.toBeUndefined();
    });

    it('refuses the fourth free drawing with 402, not 403', async () => {
      usage(PLAN_LIMITS[BillingPlan.FREE].drawings, 1024);
      try {
        await service.assertCanCreateDrawing('u1', 1024);
        fail('expected a refusal');
      } catch (error) {
        const api = error as { getStatus(): number; code: string; extra: Record<string, unknown> };
        // 402: they are not forbidden, they need to pay — and the client
        // branches on that to show an upgrade prompt.
        expect(api.getStatus()).toBe(402);
        expect(api.code).toBe('DRAWING_LIMIT_REACHED');
        expect(api.extra).toMatchObject({ limit: 3, used: 3, plan: 'free' });
      }
    });

    it('refuses a create that would cross the storage limit', async () => {
      usage(1, PLAN_LIMITS[BillingPlan.FREE].bytes - 100);
      await expect(service.assertCanCreateDrawing('u1', 500)).rejects.toMatchObject({
        code: 'STORAGE_LIMIT_REACHED',
      });
    });

    it('does not count a drawing limit against a paid plan', async () => {
      billing.effectivePlan.mockReturnValue(BillingPlan.PRO);
      usage(500, 1024);
      // Pro is unlimited on count; the storage cap is what applies.
      await expect(service.assertCanCreateDrawing('u1', 1024)).resolves.toBeUndefined();
    });

    it('never blocks a save that shrinks a drawing', async () => {
      usage(1, PLAN_LIMITS[BillingPlan.FREE].bytes * 2);
      // Locking somebody out of work they have already done is worse than
      // being over by a few megabytes.
      await expect(service.assertCanGrow('u1', -500)).resolves.toBeUndefined();
      await expect(service.assertCanGrow('u1', 0)).resolves.toBeUndefined();
    });

    it('blocks a save that would grow past the limit', async () => {
      usage(1, PLAN_LIMITS[BillingPlan.FREE].bytes - 10);
      await expect(service.assertCanGrow('u1', 1000)).rejects.toMatchObject({
        code: 'STORAGE_LIMIT_REACHED',
      });
    });

    it('counts against the OWNER, which is who the caller passes', async () => {
      usage(0, 0);
      await service.assertCanCreateDrawing('owner-1', 10);
      const where = (prisma.drawing.aggregate as unknown as jest.Mock).mock.calls[0][0].where;
      expect(where).toMatchObject({ ownerId: 'owner-1', deletedAt: null });
    });
  });
});
