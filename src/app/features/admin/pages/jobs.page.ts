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
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Scheduled jobs</h1>
        <p class="adm-lede">Housekeeping that runs on a cron outside the app. The times shown are suggestions for that scheduler, not something this page enforces.</p>
      </div>
      @if (!isOwner()) {
        <span class="adm-muted">Running a job by hand needs the owner tier.</span>
      }
    </div>

    @if (loading()) {
      <ui-skeleton height="64px" [lines]="5" />
    } @else {
      <div class="adm-table jb__table" role="table" aria-label="Scheduled jobs">
        <div class="adm-th" role="row">
          <span role="columnheader">Job</span>
          <span role="columnheader">Last run</span>
          <span role="columnheader" class="adm-hide-md">Result</span>
          <span role="columnheader" class="adm-cell--right adm-hide-sm">Schedule</span>
          @if (isOwner()) { <span role="columnheader"></span> }
        </div>
        @for (job of jobs(); track job.name) {
          <div class="adm-tr adm-tr--static" role="row" [class.jb__stuck]="job.lastRun?.stuck">
            <span class="adm-two" role="cell">
              <span class="adm-row"><span class="adm-mono">{{ job.name }}</span>@if (job.destructive) { <ui-badge tone="warning">deletes data</ui-badge> }</span>
              <span class="jb__desc">{{ job.description }}</span>
            </span>
            <span class="adm-cell--wrap" role="cell">
              @if (job.lastRun; as run) {
                @if (run.stuck) { <ui-badge tone="danger">stuck</ui-badge> } @else { <ui-badge [tone]="tone(run.status)">{{ run.status }}</ui-badge> }
                <span class="adm-muted">{{ run.startedAt | relativeTime }}</span>
              } @else {
                <ui-badge>never run</ui-badge>
              }
            </span>
            <span class="adm-cell--dim adm-truncate adm-hide-md" role="cell" [title]="job.lastRun?.error ?? summarise(job.lastRun?.summary)">
              @if (job.lastRun; as run) {
                @if (run.stuck) { <span class="adm-danger-text">Never finished — the process probably died mid-run.</span> }
                @else if (run.error) { <span class="adm-danger-text">{{ run.error }}</span> }
                @else { {{ summarise(run.summary) || '—' }} }
              } @else { — }
            </span>
            <span class="adm-cell--right adm-mono adm-cell--dim adm-hide-sm" role="cell">{{ job.suggestedCron }}</span>
            @if (isOwner()) {
              <span class="jb__actions" role="cell">
                <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="run(job)">Run now</button>
              </span>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .jb__table { --adm-cols: minmax(260px, 2fr) 170px minmax(160px, 1.4fr) 120px auto; }
      @media (max-width: 900px) { .jb__table { --adm-cols: minmax(220px, 2fr) 170px 120px auto; } }
      @media (max-width: 720px) { .jb__table { --adm-cols: minmax(0, 1fr) 150px auto; } }
      .jb__desc { white-space: normal; }
      .jb__actions { display: flex; justify-content: flex-end; }
      .jb__stuck { background: var(--ui-danger-tint); }
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
