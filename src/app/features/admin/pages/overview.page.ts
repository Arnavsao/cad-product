import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminOverviewDto, TimeseriesPointDto } from '../../../core/api/admin.models';
import { UiSkeletonComponent, UiStatTileComponent } from '../../../shared/ui';
import { formatFileSize } from '../../../shared/ui';

/**
 * The portal's front page: what happened, and what needs attention.
 *
 * Ordered by what a person on duty actually looks for — how many people are
 * here, whether anything is waiting on staff, then the storage and billing
 * numbers that only matter when they move. Every tile that can be a link is
 * one, because the next action after reading a number is always to go look at
 * the rows behind it.
 */
@Component({
  selector: 'app-admin-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiStatTileComponent, UiSkeletonComponent],
  template: `
    <div class="page">
      @if (error()) {
        <p class="page__error">{{ error() }}</p>
      }

      @if (loading()) {
        <div class="page__grid">
          @for (i of [1, 2, 3, 4, 5, 6, 7, 8]; track i) {
            <ui-skeleton height="96px" />
          }
        </div>
      } @else if (data(); as d) {
        <section class="page__section">
          <h2 class="page__heading">People</h2>
          <div class="page__grid">
            <a routerLink="/admin/users" class="page__tileLink">
              <ui-stat-tile
                label="Total users"
                [value]="d.users.total"
                [hint]="'+' + d.users.new7d + ' this week'"
                [points]="signupSeries()"
              />
            </a>
            <ui-stat-tile label="Active today" [value]="d.active.daily" [hint]="'of ' + d.users.total" [points]="activeSeries()" />
            <ui-stat-tile label="Active this week" [value]="d.active.weekly" />
            <ui-stat-tile label="Active this month" [value]="d.active.monthly" />
          </div>
        </section>

        <section class="page__section">
          <h2 class="page__heading">Needs attention</h2>
          <div class="page__grid">
            <ui-stat-tile
              label="Open feedback"
              [value]="d.feedback.open"
              [hint]="d.feedback.new7d + ' new this week'"
              [points]="feedbackSeries()"
            />
            <a routerLink="/admin/users" [queryParams]="{ status: 'suspended' }" class="page__tileLink">
              <ui-stat-tile label="Suspended" [value]="d.users.suspended" />
            </a>
            <ui-stat-tile
              label="Failed webhooks"
              [value]="d.billing.webhookFailures7d"
              hint="unprocessed, last 7 days"
            />
            <ui-stat-tile label="Past due" [value]="d.billing.pastDue" hint="subscriptions in dunning" />
          </div>
        </section>

        <section class="page__section">
          <h2 class="page__heading">Content and plans</h2>
          <div class="page__grid">
            <ui-stat-tile
              label="Drawings"
              [value]="d.drawings.total"
              [hint]="'+' + d.drawings.new7d + ' this week'"
              [points]="drawingSeries()"
            />
            <ui-stat-tile label="Storage used" [value]="storage()" [hint]="d.drawings.trashed + ' in trash'" />
            <ui-stat-tile label="Paid accounts" [value]="paid()" [hint]="d.billing.active + ' active'" />
            <a routerLink="/admin/staff" class="page__tileLink">
              <ui-stat-tile label="Staff" [value]="d.users.staff" />
            </a>
          </div>
        </section>

        <p class="page__meta">
          Database responded in {{ d.health.dbLatencyMs }} ms. Figures cached for up to a minute.
        </p>
      }
    </div>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-6);
        max-width: 1200px;
      }
      .page__section {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-3);
      }
      .page__heading {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .page__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: var(--ui-space-3);
      }
      .page__tileLink {
        text-decoration: none;
        color: inherit;
        border-radius: var(--ui-radius-md);
      }
      .page__tileLink:hover ui-stat-tile {
        display: block;
        filter: brightness(1.06);
      }
      .page__meta,
      .page__error {
        margin: 0;
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
      }
      .page__error {
        color: var(--ui-danger, #f85149);
      }
    `,
  ],
})
export class AdminOverviewPage {
  private readonly api = inject(AdminApiService);

  protected readonly data = signal<AdminOverviewDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  private readonly signups = signal<TimeseriesPointDto[]>([]);
  private readonly actives = signal<TimeseriesPointDto[]>([]);
  private readonly drawings = signal<TimeseriesPointDto[]>([]);
  private readonly feedback = signal<TimeseriesPointDto[]>([]);

  protected readonly signupSeries = computed(() => this.signups().map((p) => p.value));
  protected readonly activeSeries = computed(() => this.actives().map((p) => p.value));
  protected readonly drawingSeries = computed(() => this.drawings().map((p) => p.value));
  protected readonly feedbackSeries = computed(() => this.feedback().map((p) => p.value));

  protected readonly storage = computed(() => formatFileSize(this.data()?.drawings.bytesUsed ?? 0));
  protected readonly paid = computed(() => {
    const plans = this.data()?.billing.byPlan ?? {};
    return (plans['pro'] ?? 0) + (plans['team'] ?? 0);
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      // The four series are independent of the summary and of each other, so
      // one round of five parallel requests rather than a waterfall.
      const [overview, signups, actives, drawings, feedback] = await Promise.all([
        this.api.overview(),
        this.api.timeseries('signups'),
        this.api.timeseries('active'),
        this.api.timeseries('drawings'),
        this.api.timeseries('feedback'),
      ]);
      this.data.set(overview);
      this.signups.set(signups);
      this.actives.set(actives);
      this.drawings.set(drawings);
      this.feedback.set(feedback);
    } catch (error) {
      this.error.set(messageOf(error));
    } finally {
      this.loading.set(false);
    }
  }
}

function messageOf(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'FORBIDDEN') return 'Your staff tier cannot read these figures.';
  return (error as { message?: string })?.message ?? 'Could not load the overview.';
}
