import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService } from '../../billing/billing.service';
import { ApiException } from '../../common/errors/api-error';
import type { Env } from '../../config/env.schema';
import { JobStatus, PlatformRole, Prisma, type JobRun } from '../../generated/prisma/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { drawingPrefix, uploadPrefix } from '../../storage/storage-keys';
import { StorageService } from '../../storage/storage.service';
import { AdminDrawingsService } from '../drawings/admin-drawings.service';
import { JOB_REGISTRY, jobDefinition, type JobName, type JobSummary } from './job-registry';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** How long a drawing sits in the trash before the purge job takes it. */
const TRASH_RETENTION_DAYS = 30;
/** How long an un-imported upload survives. Long enough for a slow import to finish. */
const STAGING_RETENTION_HOURS = 24;

/** Thresholds the alert job checks. Deliberately conservative: a noisy alert is ignored. */
const ALERT_WEBHOOK_FAILURES = 5;
const ALERT_STORAGE_BYTES = 50 * 1024 * 1024 * 1024;
const ALERT_SIGNUP_SPIKE_PER_HOUR = 50;

/**
 * Scheduled housekeeping.
 *
 * Every job is idempotent and bounded. That is not a nicety: the runner is a
 * cron hitting an HTTP endpoint, so a job can be triggered twice (a retried
 * request, an impatient operator, an overlapping schedule), and one that is not
 * safe to run twice would eventually corrupt something at 3am with nobody
 * watching.
 *
 * Runs are recorded when they START. A row still marked `RUNNING` past its
 * timeout is how a stuck job becomes visible at all — nothing here kills one,
 * because interrupting a job mid-write is worse than letting it finish.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  /** Guards against two runs of the same job overlapping IN THIS PROCESS. */
  private readonly running = new Set<JobName>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly billing: BillingService,
    private readonly mail: MailService,
    private readonly drawings: AdminDrawingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async history(name?: JobName, limit = 50): Promise<JobRun[]> {
    return this.prisma.jobRun.findMany({
      where: name ? { name } : {},
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  /** The most recent run of each job, for the status list. */
  async latest(): Promise<Record<string, JobRun | null>> {
    const out: Record<string, JobRun | null> = {};
    for (const name of Object.keys(JOB_REGISTRY) as JobName[]) {
      out[name] = await this.prisma.jobRun.findFirst({ where: { name }, orderBy: { startedAt: 'desc' } });
    }
    return out;
  }

  /**
   * Runs one job, recording the attempt either way.
   *
   * The in-process lock is not distributed — two replicas can still overlap —
   * which is exactly why every job below is written to be safe when they do.
   * The lock only stops the cheap, common case of one replica being triggered
   * twice in quick succession.
   */
  async run(name: JobName, triggeredById: string | null): Promise<JobRun> {
    if (this.running.has(name)) {
      throw ApiException.conflict('JOB_ALREADY_RUNNING', `${name} is already running`);
    }
    this.running.add(name);

    const run = await this.prisma.jobRun.create({
      data: { name, status: JobStatus.RUNNING, triggeredById },
    });

    try {
      const summary = await this.execute(name);
      const finished = await this.prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: JobStatus.SUCCEEDED,
          summary: summary as Prisma.InputJsonObject,
          finishedAt: new Date(),
        },
      });
      this.logger.log(`${name} finished: ${JSON.stringify(summary)}`);
      return finished;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`${name} failed: ${message}`);
      return this.prisma.jobRun.update({
        where: { id: run.id },
        data: { status: JobStatus.FAILED, error: message.slice(0, 1000), finishedAt: new Date() },
      });
    } finally {
      this.running.delete(name);
    }
  }

  private execute(name: JobName): Promise<JobSummary> {
    switch (name) {
      case 'trash.purge':
        return this.purgeTrash();
      case 'uploads.purgeStaging':
        return this.purgeStagedUploads();
      case 'versions.enforceCap':
        return this.enforceVersionCap();
      case 'storage.sweepOrphans':
        return this.sweepOrphans();
      case 'webhooks.replayFailed':
        return this.replayWebhooks();
      case 'alerts.check':
        return this.checkAlerts();
      default: {
        // Exhaustiveness: a registry entry with no implementation is a
        // programming error, not a silently successful no-op run.
        const never: never = name;
        throw new Error(`Job ${String(never)} has no implementation`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The jobs
  // ---------------------------------------------------------------------------

  /**
   * Permanently deletes drawings trashed more than 30 days ago.
   *
   * Rows first, objects after, per drawing — the same ordering the interactive
   * delete uses, and for the same reason: an orphaned object is garbage the
   * sweep can find, an orphaned row is a broken drawing in somebody's list.
   */
  private async purgeTrash(): Promise<JobSummary> {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * DAY_MS);
    const rows = await this.prisma.drawing.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true, ownerId: true, byteSize: true },
      take: 500,
    });
    if (rows.length === 0) {
      return { deleted: 0, bytesFreed: 0 };
    }

    const { count } = await this.prisma.drawing.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    let bytesFreed = 0;
    for (const row of rows) {
      try {
        await this.storage.deletePrefix(drawingPrefix(row.ownerId, row.id));
        bytesFreed += row.byteSize;
      } catch (error) {
        // One failed prefix must not abandon the rest of the batch; the object
        // is now an orphan, which the sweep job is for.
        this.logger.warn(`trash.purge: could not clear objects for ${row.id}: ${(error as Error).message}`);
      }
    }
    return { deleted: count, bytesFreed };
  }

  /**
   * Deletes staged uploads that never became a drawing.
   *
   * These accumulate whenever somebody picks a file and then closes the tab.
   * Nothing else ever removes them, so without this job they are a slow leak
   * that only ever grows.
   */
  private async purgeStagedUploads(): Promise<JobSummary> {
    const cutoff = Date.now() - STAGING_RETENTION_HOURS * HOUR_MS;
    const users = await this.prisma.user.findMany({ select: { id: true }, take: 1000 });

    let deleted = 0;
    let scanned = 0;
    for (const user of users) {
      const stale: string[] = [];
      for await (const key of this.storage.listKeys(uploadPrefix(user.id))) {
        scanned++;
        const head = await this.storage.headObject(key).catch(() => null);
        if (head?.lastModified && head.lastModified.getTime() < cutoff) {
          stale.push(key);
        }
      }
      if (stale.length > 0) {
        deleted += await this.storage.deleteObjects(stale);
      }
    }
    return { deleted, scanned };
  }

  /**
   * Trims version history beyond the configured cap.
   *
   * The interactive save path already enforces this, so this job is a backstop
   * for rows written before the cap existed or by a save that died between
   * committing a version and trimming the old ones.
   */
  private async enforceVersionCap(): Promise<JobSummary> {
    const cap = this.config.get('MAX_VERSIONS_PER_DRAWING', { infer: true });
    const over = await this.prisma.drawing.findMany({
      where: { currentVersion: { gt: cap } },
      select: { id: true, ownerId: true, currentVersion: true },
      take: 200,
    });

    let trimmed = 0;
    for (const drawing of over) {
      const keep = drawing.currentVersion - cap;
      const old = await this.prisma.drawingVersion.findMany({
        where: { drawingId: drawing.id, version: { lte: keep } },
        select: { id: true, storageKey: true },
      });
      if (old.length === 0) {
        continue;
      }
      await this.prisma.drawingVersion.deleteMany({ where: { id: { in: old.map((v) => v.id) } } });
      await this.storage.deleteObjects(old.map((v) => v.storageKey)).catch(() => 0);
      trimmed += old.length;
    }
    return { drawingsChecked: over.length, versionsTrimmed: trimmed };
  }

  /** Reuses the interactive sweep, so there is one definition of "orphan". */
  private async sweepOrphans(): Promise<JobSummary> {
    const report = await this.drawings.orphans();
    if (report.orphanedObjects.length === 0) {
      return { deleted: 0, bytesFreed: 0, scanned: report.scannedObjects };
    }
    const deleted = await this.storage.deleteObjects(report.orphanedObjects.map((o) => o.key));
    return { deleted, bytesFreed: report.reclaimableBytes, scanned: report.scannedObjects };
  }

  /**
   * Re-applies webhook deliveries that were recorded but never processed.
   *
   * The signature was already verified when the row was written, so this does
   * not re-verify: it re-runs the handler against the stored payload. A
   * delivery that fails again keeps its error and is picked up next time, which
   * is the correct behaviour for a transient outage and harmless for a
   * permanently broken payload.
   */
  private async replayWebhooks(): Promise<JobSummary> {
    const stuck = await this.prisma.webhookEvent.findMany({
      where: { processedAt: null },
      orderBy: { receivedAt: 'asc' },
      take: 50,
    });

    let replayed = 0;
    let stillFailing = 0;
    for (const event of stuck) {
      try {
        const payload = extractSubscription(event.payload);
        if (!payload) {
          // Not a subscription event: nothing to apply, so stop re-reading it
          // on every run.
          await this.prisma.webhookEvent.update({
            where: { id: event.id },
            data: { processedAt: new Date(), error: null },
          });
          continue;
        }
        await this.billing.applySubscriptionEvent(payload);
        await this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), error: null },
        });
        replayed++;
      } catch (error) {
        stillFailing++;
        await this.prisma.webhookEvent
          .update({ where: { id: event.id }, data: { error: (error as Error).message.slice(0, 1000) } })
          .catch(() => undefined);
      }
    }
    return { replayed, stillFailing, pending: stuck.length };
  }

  /**
   * Emails owners when something crosses a threshold.
   *
   * Only sends when there is something to say, and each condition is checked
   * independently so one noisy signal does not mask another. There is no
   * "resolved" mail: an alert that arrives hourly until fixed is clearer than
   * one that announces its own recovery.
   */
  private async checkAlerts(): Promise<JobSummary> {
    const hourAgo = new Date(Date.now() - HOUR_MS);
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);

    const [webhookFailures, storage, signups] = await Promise.all([
      this.prisma.webhookEvent.count({ where: { processedAt: null, receivedAt: { gte: weekAgo } } }),
      this.prisma.drawing.aggregate({ where: { deletedAt: null }, _sum: { byteSize: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: hourAgo } } }),
    ]);

    const problems: string[] = [];
    if (webhookFailures >= ALERT_WEBHOOK_FAILURES) {
      problems.push(
        `${webhookFailures} Dodo webhook deliveries in the last 7 days were never processed. ` +
          `Customers may have paid without receiving their plan.`,
      );
    }
    const bytes = storage._sum.byteSize ?? 0;
    if (bytes >= ALERT_STORAGE_BYTES) {
      problems.push(`Stored drawings now total ${Math.round(bytes / 1024 / 1024 / 1024)} GB.`);
    }
    if (signups >= ALERT_SIGNUP_SPIKE_PER_HOUR) {
      problems.push(`${signups} accounts were created in the last hour, which is unusual enough to look at.`);
    }

    if (problems.length === 0) {
      return { alerts: 0, notified: 0 };
    }

    const owners = await this.prisma.user.findMany({
      where: { platformRole: PlatformRole.OWNER, deletedAt: null },
      select: { email: true },
    });
    let notified = 0;
    for (const owner of owners) {
      const sent = await this.mail.send({
        to: owner.email,
        category: 'support',
        subject: `CADO: ${problems.length} thing${problems.length === 1 ? '' : 's'} to look at`,
        text: [...problems, '', `Admin portal: ${this.mail.link('/admin')}`].join('\n\n'),
        html: problems.map((p) => `<p>${escapeHtml(p)}</p>`).join('') +
          `<p><a href="${this.mail.link('/admin')}">Open the admin portal</a></p>`,
      });
      if (sent) notified++;
    }
    return { alerts: problems.length, notified };
  }
}

/** `{ data: {...} }` or a bare subscription payload → the subscription, or null. */
function extractSubscription(payload: unknown): never | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const body = payload as { data?: unknown };
  const data = body.data ?? payload;
  if (!data || typeof data !== 'object') {
    return null;
  }
  const candidate = data as { subscription_id?: unknown; product_id?: unknown };
  return candidate.subscription_id || candidate.product_id ? (data as never) : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
