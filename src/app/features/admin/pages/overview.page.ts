import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../../core/api/admin-api.service';
import {
  AdminOverviewDto,
  AdminUserRowDto,
  AuditEntryDto,
  TimeseriesMetric,
  TimeseriesPointDto,
} from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import {
  RelativeTimePipe,
  UiButtonDirective,
  UiIconComponent,
  UiSegmentBarComponent,
  UiSkeletonComponent,
  UiStatTileComponent,
  UiTrendChartComponent,
  compact,
  formatFileSize,
  type UiSegment,
} from '../../../shared/ui';

type Range = 7 | 30 | 90;
type Series = Record<TimeseriesMetric, TimeseriesPointDto[]>;

const METRICS: { key: TimeseriesMetric; label: string; noun: string }[] = [
  { key: 'signups', label: 'Sign-ups', noun: 'new accounts' },
  { key: 'active', label: 'Active users', noun: 'active users' },
  { key: 'drawings', label: 'Drawings', noun: 'drawings created' },
  { key: 'feedback', label: 'Feedback', noun: 'reports' },
];

/**
 * The portal's front page: what happened, and what needs attention.
 *
 * Ordered by what a person on duty actually looks for. The four headline
 * tiles each carry a change against the previous seven days, because a number
 * with no comparison is a fact without a story. Below them, one chart with a
 * metric and range switch rather than four small ones — a reader compares
 * periods far more often than metrics — and beside it the list of things that
 * want a human, sorted so anything non-zero sits at the top in a colour that
 * says so.
 *
 * Every series is fetched at twice the range so the "vs previous period"
 * comparison never needs a second request when the range changes.
 */
@Component({
  selector: 'app-admin-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    RouterLink,
    UiButtonDirective,
    UiIconComponent,
    UiStatTileComponent,
    UiTrendChartComponent,
    UiSegmentBarComponent,
    UiSkeletonComponent,
    RelativeTimePipe,
  ],
  template: `
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Overview</h1>
        <p class="adm-lede">What happened, and what needs attention. Figures refresh every minute.</p>
      </div>
      <div class="adm-actions">
        <button uiButton variant="ghost" size="sm" [loading]="loading()" (click)="reload()">
          <ui-icon name="refresh" [size]="16" /> Refresh
        </button>
      </div>
    </div>

    @if (error(); as e) {
      <div class="adm-note adm-note--danger" role="alert">
        <ui-icon name="alert" [size]="18" />
        <div>
          <p class="adm-note__title">The overview could not be loaded.</p>
          <p class="adm-note__msg">{{ e }}</p>
        </div>
      </div>
    }

    @if (loading() && !data()) {
      <div class="adm-grid-kpi">
        @for (i of [1, 2, 3, 4]; track i) {
          <ui-skeleton height="118px" radius="var(--ui-radius-lg)" />
        }
      </div>
      <ui-skeleton height="300px" radius="var(--ui-radius-lg)" />
    } @else if (data(); as d) {
      <!-- headline -->
      <div class="adm-grid-kpi">
        <ui-stat-tile
          label="Total users"
          [value]="d.users.total"
          [hint]="d.users.new7d + ' joined this week'"
          [change]="weekChange('signups')"
          [points]="sparkline('signups')"
        />
        <ui-stat-tile
          label="Active today"
          [value]="d.active.daily"
          [hint]="d.active.weekly + ' this week · ' + d.active.monthly + ' this month'"
          [change]="weekChange('active')"
          [points]="sparkline('active')"
        />
        <ui-stat-tile
          label="Drawings"
          [value]="d.drawings.total"
          [hint]="d.drawings.new7d + ' created this week'"
          [change]="weekChange('drawings')"
          [points]="sparkline('drawings')"
        />
        <ui-stat-tile
          label="Open feedback"
          [value]="d.feedback.open"
          [hint]="d.feedback.new7d + ' new this week'"
          [change]="weekChange('feedback')"
          [upIsGood]="false"
          [points]="sparkline('feedback')"
        />
      </div>

      <!-- trend + attention -->
      <div class="adm-grid-2">
        <section class="adm-card">
          <div class="adm-card__head">
            <div class="adm-stack" style="gap: 2px">
              <p class="adm-kicker">Trend</p>
              <h2 class="ov__chart-title">{{ metricLabel() }} per day</h2>
              <p class="adm-muted">
                <strong class="ov__strong">{{ rangeTotal() | number }}</strong> {{ metricNoun() }} in the last
                {{ range() }} days{{ rangeDeltaText() }}
              </p>
            </div>
            <div class="adm-actions">
              <div class="adm-chips" role="group" aria-label="Metric">
                @for (m of metrics; track m.key) {
                  <button type="button" class="adm-chip" [class.adm-chip--on]="metric() === m.key" (click)="metric.set(m.key)">
                    {{ m.label }}
                  </button>
                }
              </div>
              <div class="adm-chips" role="group" aria-label="Range">
                @for (r of ranges; track r) {
                  <button type="button" class="adm-chip" [class.adm-chip--on]="range() === r" (click)="setRange(r)">
                    {{ r }}d
                  </button>
                }
              </div>
            </div>
          </div>
          <ui-trend-chart [points]="chartPoints()" [label]="metricLabel() + ' per day'" [height]="220" />
        </section>

        <section class="adm-card adm-card--flush">
          <div class="adm-card__bar"><p class="adm-kicker">Needs attention</p></div>
          <ul class="ov__att">
            @for (row of attention(); track row.label) {
              <li>
                <a class="ov__att-row" [class]="'ov__att-row ov__att-row--' + row.tone" [routerLink]="row.link" [queryParams]="row.query">
                  <span class="ov__att-dot" aria-hidden="true"></span>
                  <span class="ov__att-count">{{ row.count }}</span>
                  <span class="ov__att-label">{{ row.label }}</span>
                  <ui-icon name="chevron-right" [size]="14" />
                </a>
              </li>
            }
          </ul>
          <div class="adm-card__foot">
            Database answered in {{ d.health.dbLatencyMs }} ms · {{ d.users.staff }} staff · {{ d.users.deleted }} deleted accounts
          </div>
        </section>
      </div>

      <!-- breakdowns -->
      <div class="adm-grid-halves">
        <section class="adm-card">
          <div class="adm-card__head">
            <p class="adm-kicker">Feedback by status</p>
            <a class="adm-link adm-muted" routerLink="/admin/feedback">Open the queue</a>
          </div>
          <ui-segment-bar [segments]="feedbackSegments()" label="Feedback by status" />
        </section>

        <section class="adm-card">
          <div class="adm-card__head">
            <p class="adm-kicker">Plans</p>
            <a class="adm-link adm-muted" routerLink="/admin/billing">Billing</a>
          </div>
          <ui-segment-bar [segments]="planSegments()" label="Accounts by plan" />
          <p class="adm-muted">
            {{ d.billing.active }} paying · {{ d.billing.pastDue }} past due
            @if (grants() > 0) {
              · {{ grants() }} complimentary
            }
          </p>
        </section>

        <section class="adm-card">
          <div class="adm-card__head">
            <p class="adm-kicker">Storage</p>
            <a class="adm-link adm-muted" routerLink="/admin/drawings">Drawings</a>
          </div>
          <span class="ov__big">{{ storage() }}</span>
          <dl class="adm-facts">
            <div><dt>Live drawings</dt><dd>{{ d.drawings.total | number }}</dd></div>
            <div><dt>In trash</dt><dd>{{ d.drawings.trashed | number }}</dd></div>
            <div><dt>Per drawing</dt><dd>{{ perDrawing() }}</dd></div>
          </dl>
        </section>

        <section class="adm-card adm-card--flush">
          <div class="adm-card__bar">
            <p class="adm-kicker">Latest sign-ups</p>
            <a class="adm-link adm-muted" routerLink="/admin/users">All users</a>
          </div>
          <div class="adm-list">
            @for (u of latestUsers(); track u.id) {
              <a class="adm-list__row adm-link--quiet" [routerLink]="['/admin/users', u.id]" style="text-decoration: none">
                <span class="adm-two adm-grow">
                  <span>{{ name(u) }}</span>
                  <span>{{ u.email }}</span>
                </span>
                <span class="adm-muted">{{ u.createdAt | relativeTime }}</span>
              </a>
            } @empty {
              <p class="adm-muted" style="padding: var(--ui-space-4)">Nobody has signed up yet.</p>
            }
          </div>
        </section>

        @if (canSeeAudit()) {
          <section class="adm-card adm-card--flush">
            <div class="adm-card__bar">
              <p class="adm-kicker">Recent staff activity</p>
              <a class="adm-link adm-muted" routerLink="/admin/audit">Audit log</a>
            </div>
            <div class="adm-list">
              @for (e of recentAudit(); track e.id) {
                <div class="adm-list__row">
                  <span class="adm-mono">{{ e.action }}</span>
                  <span class="adm-muted adm-grow adm-truncate">{{ e.actorEmail }}</span>
                  <span class="adm-muted">{{ e.createdAt | relativeTime }}</span>
                </div>
              } @empty {
                <p class="adm-muted" style="padding: var(--ui-space-4)">No staff actions recorded yet.</p>
              }
            </div>
          </section>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .ov__chart-title { margin: 0; font-size: var(--ui-text-lg); font-weight: 600; color: var(--ui-text-strong); }
      .ov__strong { color: var(--ui-text); font-weight: 600; font-variant-numeric: tabular-nums; }
      .ov__big {
        font-size: var(--ui-text-3xl); font-weight: 650; letter-spacing: -.02em; line-height: 1;
        color: var(--ui-text-strong); font-variant-numeric: tabular-nums;
      }
      .ov__att { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .ov__att-row {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 10px var(--ui-space-4); border-bottom: 1px solid var(--ui-border);
        color: var(--ui-text-dim); text-decoration: none; font-size: var(--ui-text-md);
        transition: background var(--ui-dur-fast);
      }
      .ov__att li:last-child .ov__att-row { border-bottom: 0; }
      .ov__att-row:hover { background: var(--ui-hover); color: var(--ui-text); }
      .ov__att-row > ui-icon { margin-left: auto; opacity: .6; }
      .ov__att-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ui-border-strong); flex: 0 0 auto; }
      .ov__att-count { min-width: 2.2em; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--ui-text-strong); }
      .ov__att-row--warn .ov__att-dot { background: var(--ui-warning); }
      .ov__att-row--warn { color: var(--ui-text); }
      .ov__att-row--danger .ov__att-dot { background: var(--ui-danger); }
      .ov__att-row--danger { color: var(--ui-text); }
      .ov__att-row--danger .ov__att-count { color: var(--ui-danger); }
      .ov__att-row--quiet .ov__att-count { color: var(--ui-text-dim); font-weight: 500; }
    `,
  ],
})
export class AdminOverviewPage {
  private readonly api = inject(AdminApiService);
  private readonly me = inject(MeService);

  protected readonly metrics = METRICS;
  protected readonly ranges: Range[] = [7, 30, 90];

  protected readonly data = signal<AdminOverviewDto | null>(null);
  protected readonly series = signal<Series>({ signups: [], active: [], drawings: [], feedback: [] });
  protected readonly latestUsers = signal<AdminUserRowDto[]>([]);
  protected readonly recentAudit = signal<AuditEntryDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly metric = signal<TimeseriesMetric>('signups');
  protected readonly range = signal<Range>(30);

  protected readonly canSeeAudit = computed(() => {
    const role = this.me.me()?.user.platformRole;
    return role === 'admin' || role === 'owner';
  });

  protected readonly metricLabel = computed(() => METRICS.find((m) => m.key === this.metric())?.label ?? '');
  protected readonly metricNoun = computed(() => METRICS.find((m) => m.key === this.metric())?.noun ?? '');

  /** The last `range` days of the chosen metric; the fetch holds twice that. */
  protected readonly chartPoints = computed(() => this.series()[this.metric()].slice(-this.range()));
  protected readonly rangeTotal = computed(() => sum(this.chartPoints()));
  protected readonly rangeDeltaText = computed(() => {
    const all = this.series()[this.metric()];
    const n = this.range();
    if (all.length < n * 2) return '';
    const prev = sum(all.slice(-n * 2, -n));
    const d = pctChange(this.rangeTotal(), prev);
    if (d === null) return prev === 0 && this.rangeTotal() > 0 ? ', up from none the period before' : '';
    return `, ${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))}% on the ${n} days before`;
  });

  /** Sparkline data for a tile: the last 14 days. */
  protected sparkline(metric: TimeseriesMetric): number[] {
    return this.series()[metric].slice(-14).map((p) => p.value);
  }
  /** Last 7 days against the 7 before; the tile decides how to phrase it. */
  protected weekChange(metric: TimeseriesMetric): { current: number; previous: number; period: string; noun: string } | null {
    const all = this.series()[metric];
    if (all.length < 14) return null;
    return {
      current: sum(all.slice(-7)),
      previous: sum(all.slice(-14, -7)),
      period: '7d',
      noun: METRICS.find((m) => m.key === metric)?.noun ?? 'events',
    };
  }

  protected readonly attention = computed(() => {
    const d = this.data();
    if (!d) return [];
    const rows: { label: string; count: number; tone: 'danger' | 'warn' | 'quiet'; link: string; query?: Record<string, string> }[] = [
      {
        label: 'webhook deliveries never applied',
        count: d.billing.webhookFailures7d,
        tone: d.billing.webhookFailures7d > 0 ? 'danger' : 'quiet',
        link: '/admin/billing',
      },
      {
        label: 'subscriptions past due',
        count: d.billing.pastDue,
        tone: d.billing.pastDue > 0 ? 'danger' : 'quiet',
        link: '/admin/billing',
      },
      {
        label: 'reports waiting for a reply',
        count: d.feedback.byStatus['new'] ?? 0,
        tone: (d.feedback.byStatus['new'] ?? 0) > 0 ? 'warn' : 'quiet',
        link: '/admin/feedback',
        query: { status: 'new' },
      },
      {
        label: 'suspended accounts',
        count: d.users.suspended,
        tone: d.users.suspended > 0 ? 'warn' : 'quiet',
        link: '/admin/users',
        query: { status: 'suspended' },
      },
    ];
    // Anything that needs a human first; ties keep their order.
    const weight = { danger: 0, warn: 1, quiet: 2 };
    return rows.sort((a, b) => weight[a.tone] - weight[b.tone]);
  });

  protected readonly feedbackSegments = computed<UiSegment[]>(() => {
    const s = this.data()?.feedback.byStatus ?? {};
    return [
      { label: 'New', value: s['new'] ?? 0, tone: 'warning' },
      { label: 'Triaged', value: s['triaged'] ?? 0, tone: 'accent-soft' },
      { label: 'In progress', value: s['in_progress'] ?? 0, tone: 'accent' },
      { label: 'Resolved', value: s['resolved'] ?? 0, tone: 'success' },
      { label: "Won't fix", value: s['wont_fix'] ?? 0, tone: 'neutral' },
    ];
  });

  protected readonly planSegments = computed<UiSegment[]>(() => {
    const p = this.data()?.billing.byPlan ?? {};
    return [
      { label: 'Free', value: Math.max(0, p['free'] ?? 0), tone: 'accent-soft' },
      { label: 'Pro', value: p['pro'] ?? 0, tone: 'accent-mid' },
      { label: 'Team', value: p['team'] ?? 0, tone: 'accent' },
    ];
  });
  /** From the billing summary, which is the one place that counts staff grants. */
  protected readonly grants = signal(0);

  protected readonly storage = computed(() => formatFileSize(this.data()?.drawings.bytesUsed ?? 0));
  protected readonly perDrawing = computed(() => {
    const d = this.data();
    return d && d.drawings.total > 0 ? formatFileSize(Math.round(d.drawings.bytesUsed / d.drawings.total)) : '—';
  });

  constructor() {
    void this.reload();
  }

  protected setRange(r: Range): void {
    this.range.set(r);
    // The comparison needs twice the range; refetch only when the cache is short.
    if (this.series().signups.length < r * 2) void this.loadSeries(r);
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [overview, users, billing] = await Promise.all([
        this.api.overview(),
        this.api.listUsers({ pageSize: 5 }),
        this.api.billingSummary(),
      ]);
      this.data.set(overview);
      this.latestUsers.set(users.items);
      this.grants.set(billing.grants);
      await this.loadSeries(this.range());
      if (this.canSeeAudit()) {
        this.recentAudit.set((await this.api.audit({ pageSize: 5 })).items);
      }
    } catch (error) {
      this.error.set(messageOf(error));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadSeries(range: Range): Promise<void> {
    const days = range * 2;
    const [signups, active, drawings, feedback] = await Promise.all(
      METRICS.map((m) => this.api.timeseries(m.key, days)),
    );
    this.series.set({ signups, active, drawings, feedback });
  }

  protected name(u: AdminUserRowDto): string {
    return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email.split('@')[0];
  }

  protected readonly compact = compact;
}

function sum(points: readonly TimeseriesPointDto[]): number {
  return points.reduce((s, p) => s + p.value, 0);
}
/** Percent change, or null when the previous period was zero (no base to compare against). */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
function messageOf(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'FORBIDDEN') return 'Your staff tier cannot read these figures.';
  return (error as { message?: string })?.message ?? 'Could not reach the API.';
}
