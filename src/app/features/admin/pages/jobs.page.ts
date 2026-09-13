import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { JobStatusDto } from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  RelativeTimePipe,
  UiBadgeComponent,
  UiButtonDirective,
  UiDialogService,
  UiSkeletonComponent,
  type UiBadgeTone,
} from '../../../shared/ui';

/**
 * Scheduled housekeeping.
 *
 * The page answers one question — did the thing that should have run last night
 * actually run — which previously required a log search. A job still marked
 * running past its timeout is called out, because that is the failure mode that
 * otherwise looks identical to success: no error, no completion, nothing.
 *
 * Running by hand is owner-only. Most of these delete data, and the scheduler
 * does it unattended on a cron; a person pressing the button should be the
 * exception, deliberately taken.
 */
@Component({
  selector: 'app-admin-jobs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiBadgeComponent, UiSkeletonComponent, RelativeTimePipe],
  template: `
    <div class="jobs">
      <p class="jobs__lede">
        These run on a schedule outside the app. The times below are suggestions for that scheduler,
        not something this page enforces.
      </p>

      @if (loading()) {
        <ui-skeleton height="64px" [lines]="5" />
      } @else {
        <div class="jobs__list">
          @for (job of jobs(); track job.name) {
            <article class="jobs__item">
              <header class="jobs__head">
                <span class="jobs__name">{{ job.name }}</span>
                @if (job.destructive) {
                  <ui-badge tone="warning">deletes data</ui-badge>
                }
                @if (job.lastRun; as run) {
                  @if (run.stuck) {
                    <ui-badge tone="danger">stuck</ui-badge>
                  } @else {
                    <ui-badge [tone]="tone(run.status)">{{ run.status }}</ui-badge>
                  }
                } @else {
                  <ui-badge>never run</ui-badge>
                }
                <code class="jobs__cron">{{ job.suggestedCron }}</code>
              </header>

              <p class="jobs__desc">{{ job.description }}</p>

              @if (job.lastRun; as run) {
                <p class="jobs__meta">
                  Last started {{ run.startedAt | relativeTime }}.
                  @if (run.stuck) {
                    It never finished — the process probably died mid-run.
                  } @else if (run.error) {
                    <span class="jobs__error">{{ run.error }}</span>
                  } @else if (run.summary) {
                    {{ summarise(run.summary) }}
                  }
                </p>
              }

              @if (isOwner()) {
                <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="run(job)">
                  Run now
                </button>
              }
            </article>
          }
        </div>
        @if (!isOwner()) {
          <p class="jobs__lede">Running a job by hand needs the owner tier.</p>
        }
      }
    </div>
  `,
  styles: [
    `
      .jobs {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 860px;
      }
      .jobs__lede,
      .jobs__desc,
      .jobs__meta {
        margin: 0;
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
      }
      .jobs__list {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-3);
      }
      .jobs__item {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--ui-space-2);
        padding: var(--ui-space-4);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
      }
      .jobs__head {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        flex-wrap: wrap;
        width: 100%;
      }
      .jobs__name {
        font-family: var(--ui-font-mono, ui-monospace, monospace);
        font-weight: 600;
        font-size: var(--ui-text-sm);
      }
      .jobs__cron {
        margin-left: auto;
        font-size: 12px;
        color: var(--ui-text-dim);
      }
      .jobs__error {
        color: var(--ui-danger, #f85149);
      }
    `,
  ],
})
export class AdminJobsPage {
  private readonly api = inject(AdminApiService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(UiDialogService);
  private readonly me = inject(MeService);

  protected readonly jobs = signal<JobStatusDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);

  protected readonly isOwner = computed(() => this.me.me()?.user.platformRole === 'owner');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.jobs.set(await this.api.jobs());
    } catch {
      this.jobs.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected async run(job: JobStatusDto): Promise<void> {
    if (job.destructive) {
      const ok = await this.dialog.confirm({
        title: `Run ${job.name} now?`,
        message: `${job.description} This deletes data and cannot be undone.`,
        confirmLabel: 'Run it',
        danger: true,
      });
      if (!ok) return;
    }

    this.busy.set(true);
    try {
      const run = await this.api.runJob(job.name);
      this.notify[run.status === 'succeeded' ? 'success' : 'error'](
        run.status === 'succeeded' ? `${job.name} finished` : `${job.name} failed: ${run.error ?? 'unknown'}`,
      );
      await this.load();
    } catch (error) {
      this.notify.error(
        (error as { code?: string })?.code === 'JOB_ALREADY_RUNNING'
          ? 'That job is already running.'
          : 'Could not start that job.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected tone(status: string): UiBadgeTone {
    if (status === 'succeeded') return 'success';
    if (status === 'running') return 'info';
    return status === 'failed' ? 'danger' : 'neutral';
  }

  /** `{ deleted: 3, bytesFreed: 400 }` → "deleted 3, bytesFreed 400". */
  protected summarise(summary: unknown): string {
    if (!summary || typeof summary !== 'object') return '';
    return Object.entries(summary as Record<string, unknown>)
      .map(([key, value]) => `${key} ${value}`)
      .join(', ');
  }
}
