import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { BillingService } from '../../billing/billing.service';
import { JobStatus } from '../../generated/prisma/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { stubConfig } from '../../../test/support/config';
import { AdminDrawingsService } from '../drawings/admin-drawings.service';
import { JobsService } from './jobs.service';

async function* noKeys(): AsyncGenerator<string> {
  /* empty bucket */
}

describe('JobsService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let storage: DeepMockProxy<StorageService>;
  let billing: DeepMockProxy<BillingService>;
  let mail: DeepMockProxy<MailService>;
  let drawings: DeepMockProxy<AdminDrawingsService>;
  let service: JobsService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    storage = mockDeep<StorageService>();
    billing = mockDeep<BillingService>();
    mail = mockDeep<MailService>();
    drawings = mockDeep<AdminDrawingsService>();
    service = new JobsService(prisma, storage, billing, mail, drawings, stubConfig());

    prisma.jobRun.create.mockResolvedValue({ id: 'run-1' } as never);
    prisma.jobRun.update.mockImplementation(((args: { data: unknown }) =>
      Promise.resolve({ id: 'run-1', ...(args.data as object) })) as never);
  });

  describe('run', () => {
    it('records the attempt before the work starts', async () => {
      prisma.drawing.findMany.mockResolvedValue([] as never);
      await service.run('trash.purge', 'staff-1');

      // The row exists before the job does anything, which is what makes a
      // crashed run visible as a stuck RUNNING row rather than as nothing.
      // Jest has no ordering matcher, so compare invocation order directly.
      const createOrder = prisma.jobRun.create.mock.invocationCallOrder[0];
      const updateOrder = prisma.jobRun.update.mock.invocationCallOrder[0];
      expect(createOrder).toBeLessThan(updateOrder);
      const created = prisma.jobRun.create.mock.calls[0][0].data as { status: JobStatus; triggeredById: string };
      expect(created.status).toBe(JobStatus.RUNNING);
      expect(created.triggeredById).toBe('staff-1');
    });

    it('records a failure rather than throwing at the scheduler', async () => {
      prisma.drawing.findMany.mockRejectedValue(new Error('database is on fire'));

      const run = await service.run('trash.purge', null);

      // The cron gets a 200 and the row carries the failure: a job that throws
      // an HTTP error teaches the scheduler to retry a broken job forever.
      expect((run as { status: JobStatus }).status).toBe(JobStatus.FAILED);
      expect((run as { error: string | null }).error).toContain('database is on fire');
    });

    it('refuses to start a job that is already running in this process', async () => {
      let release: () => void = () => undefined;
      prisma.drawing.findMany.mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve([] as never);
        }) as never,
      );

      const first = service.run('trash.purge', null);
      await expect(service.run('trash.purge', null)).rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
      release();
      await first;
    });

    it('releases the lock after a failure, so the next run can start', async () => {
      prisma.drawing.findMany.mockRejectedValueOnce(new Error('transient')).mockResolvedValue([] as never);
      await service.run('trash.purge', null);
      await expect(service.run('trash.purge', null)).resolves.toBeDefined();
    });
  });

  describe('trash.purge', () => {
    it('only takes drawings trashed before the retention cutoff', async () => {
      prisma.drawing.findMany.mockResolvedValue([] as never);
      await service.run('trash.purge', null);

      const where = prisma.drawing.findMany.mock.calls[0][0]?.where as { deletedAt: { lt: Date } };
      const days = (Date.now() - where.deletedAt.lt.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(30);
    });

    it('deletes rows first, then objects', async () => {
      const order: string[] = [];
      prisma.drawing.findMany.mockResolvedValue([{ id: 'd1', ownerId: 'u1', byteSize: 100 }] as never);
      prisma.drawing.deleteMany.mockImplementation((() => {
        order.push('rows');
        return Promise.resolve({ count: 1 });
      }) as never);
      storage.deletePrefix.mockImplementation(() => {
        order.push('objects');
        return Promise.resolve(1);
      });

      await service.run('trash.purge', null);
      expect(order).toEqual(['rows', 'objects']);
    });

    it('carries on when one prefix fails to clear', async () => {
      prisma.drawing.findMany.mockResolvedValue([
        { id: 'd1', ownerId: 'u1', byteSize: 100 },
        { id: 'd2', ownerId: 'u2', byteSize: 200 },
      ] as never);
      prisma.drawing.deleteMany.mockResolvedValue({ count: 2 });
      storage.deletePrefix.mockRejectedValueOnce(new Error('bucket hiccup')).mockResolvedValue(1);

      const run = await service.run('trash.purge', null);
      // One orphaned prefix must not abandon the rest of the batch; the sweep
      // job exists for exactly that leftover.
      expect((run as { status: JobStatus }).status).toBe(JobStatus.SUCCEEDED);
      expect(summaryOf(run).bytesFreed).toBe(200);
    });
  });

  describe('webhooks.replayFailed', () => {
    it('marks a non-subscription delivery processed so it stops being retried', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([
        { id: 'evt-1', payload: { data: { something_else: true } } },
      ] as never);

      await service.run('webhooks.replayFailed', null);

      expect(billing.applySubscriptionEvent).not.toHaveBeenCalled();
      const update = prisma.webhookEvent.update.mock.calls[0][0].data as { processedAt: Date };
      expect(update.processedAt).toBeInstanceOf(Date);
    });

    it('re-applies a subscription delivery and clears its error', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([
        { id: 'evt-1', payload: { data: { subscription_id: 'sub_1' } } },
      ] as never);
      billing.applySubscriptionEvent.mockResolvedValue('applied');

      const run = await service.run('webhooks.replayFailed', null);

      expect(billing.applySubscriptionEvent).toHaveBeenCalled();
      expect(summaryOf(run).replayed).toBe(1);
    });

    it('leaves a delivery unprocessed when it fails again', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([
        { id: 'evt-1', payload: { data: { subscription_id: 'sub_1' } } },
      ] as never);
      billing.applySubscriptionEvent.mockRejectedValue(new Error('Dodo is down'));
      // The error path records the failure with `.update(...).catch(...)`, so
      // the mock has to return a real promise for that chain to exist.
      prisma.webhookEvent.update.mockResolvedValue({} as never);

      const run = await service.run('webhooks.replayFailed', null);

      expect(summaryOf(run).stillFailing).toBe(1);
      const update = prisma.webhookEvent.update.mock.calls[0][0].data as Record<string, unknown>;
      // Still unprocessed, so the next run picks it up — correct for a
      // transient outage and harmless for a permanently broken payload.
      expect('processedAt' in update).toBe(false);
    });
  });

  describe('alerts.check', () => {
    it('sends nothing when every signal is below its threshold', async () => {
      prisma.webhookEvent.count.mockResolvedValue(0);
      (prisma.drawing.aggregate as unknown as jest.Mock).mockResolvedValue({ _sum: { byteSize: 1024 } });
      prisma.user.count.mockResolvedValue(1);

      const run = await service.run('alerts.check', null);
      expect(summaryOf(run).alerts).toBe(0);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('emails every owner when webhooks are piling up', async () => {
      prisma.webhookEvent.count.mockResolvedValue(9);
      (prisma.drawing.aggregate as unknown as jest.Mock).mockResolvedValue({ _sum: { byteSize: 1024 } });
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([{ email: 'a@x.com' }, { email: 'b@x.com' }] as never);
      mail.send.mockResolvedValue(true);

      const run = await service.run('alerts.check', null);

      expect(summaryOf(run).notified).toBe(2);
      expect(mail.send.mock.calls[0][0].subject).toContain('to look at');
    });
  });

  describe('storage.sweepOrphans', () => {
    it('reuses the interactive scan, so "orphan" has one definition', async () => {
      drawings.orphans.mockResolvedValue({
        orphanedObjects: [{ key: 'users/u1/drawings/gone/v1.dxf', bytes: 10 }],
        brokenDrawings: [],
        truncated: false,
        scannedObjects: 1,
        reclaimableBytes: 10,
      });
      storage.deleteObjects.mockResolvedValue(1);

      const run = await service.run('storage.sweepOrphans', null);

      expect(drawings.orphans).toHaveBeenCalled();
      expect(summaryOf(run).deleted).toBe(1);
    });
  });
});

/** `summary` is a `JsonValue` on the row; these jobs always write an object. */
function summaryOf(run: unknown): Record<string, number> {
  return (run as { summary: unknown }).summary as Record<string, number>;
}
