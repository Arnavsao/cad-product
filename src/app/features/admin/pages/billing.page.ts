import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../../core/api/admin-api.service';
import {
  AdminSubscriptionRowDto,
  AdminWebhookRowDto,
  BillingSummaryDto,
} from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import {
  RelativeTimePipe,
  UiBadgeComponent,
  UiEmptyStateComponent,
  UiIconComponent,
  UiSkeletonComponent,
  UiStatTileComponent,
  type UiBadgeTone,
} from '../../../shared/ui';

/**
 * The billing console.
 *
 * Read-only, because everything that changes what somebody pays belongs in
 * Dodo, where their card actually lives. What this adds is the two questions
 * Dodo cannot answer: which of *our* accounts is on what, and which deliveries
 * never landed — each unprocessed webhook potentially being a customer who paid
 * and got nothing.
 */
@Component({
  selector: 'app-admin-billing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiBadgeComponent,
    UiIconComponent,
    UiEmptyStateComponent,
    UiSkeletonComponent,
    UiStatTileComponent,
    RelativeTimePipe,
  ],
  template: `
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Billing</h1>
        <p class="adm-lede">Who is on what, and which payments never turned into a plan. Read-only: changing what somebody pays happens in Dodo.</p>
      </div>
    </div>

    @if (loading()) {
      <div class="adm-grid-kpi">
        @for (i of [1, 2, 3, 4]; track i) { <ui-skeleton height="118px" radius="var(--ui-radius-lg)" /> }
      </div>
    } @else if (summary(); as s) {
      @if (s.catalog.mode === 'off') {
        <div class="adm-note">
          <ui-icon name="alert" [size]="18" />
          <div>
            <p class="adm-note__title">Billing is not configured on this deployment.</p>
            <p class="adm-note__msg">Nothing can be sold. The figures below describe whatever rows already exist.</p>
          </div>
        </div>
      } @else if (!s.catalog.webhookConfigured) {
        <div class="adm-note adm-note--danger" role="alert">
          <ui-icon name="alert" [size]="18" />
          <div>
            <p class="adm-note__title">Billing is live but no webhook signing key is set.</p>
            <p class="adm-note__msg">Checkout will succeed and no plan will ever be granted. Set DODO_WEBHOOK_KEY.</p>
          </div>
        </div>
      }

      <div class="adm-grid-kpi">
        <ui-stat-tile label="Approximate MRR" [value]="s.currency + ' ' + s.approximateMrr.toLocaleString()" hint="from display prices, not from Dodo" />
        <ui-stat-tile label="Paying" [value]="s.paying" [hint]="s.trialing + ' trialing'" />
        <ui-stat-tile label="Past due" [value]="s.pastDue" hint="in dunning; access retained" />
        <ui-stat-tile label="Complimentary" [value]="s.grants" hint="granted by staff" />
      </div>

      @if (s.unprocessedWebhooks > 0) {
        <div class="adm-note adm-note--warn">
          <ui-icon name="alert" [size]="18" />
          <div>
            <p class="adm-note__title">
              {{ s.unprocessedWebhooks }} webhook {{ s.unprocessedWebhooks === 1 ? 'delivery has' : 'deliveries have' }} never been applied.
            </p>
            <p class="adm-note__msg">Each may be a customer who paid and got nothing. The <a class="adm-link" routerLink="/admin/jobs">replay job</a> retries them every half hour.</p>
          </div>
        </div>
      }

      <div class="adm-grid-halves">
        <section class="adm-card">
          <p class="adm-kicker">Catalog</p>
          <dl class="adm-facts">
            <div><dt>Mode</dt><dd><ui-badge [tone]="s.catalog.mode === 'live' ? 'success' : s.catalog.mode === 'test' ? 'warning' : 'neutral'">{{ s.catalog.mode }}</ui-badge></dd></div>
            <div><dt>Webhook key</dt><dd>{{ s.catalog.webhookConfigured ? 'set' : 'missing' }}</dd></div>
            <div><dt>Sellable</dt><dd>{{ s.catalog.sellable.length ? s.catalog.sellable.join(', ') : 'nothing' }}</dd></div>
          </dl>
        </section>
        <section class="adm-card">
          <p class="adm-kicker">Subscription states</p>
          <dl class="adm-facts">
            <div><dt>Active</dt><dd>{{ s.paying }}</dd></div>
            <div><dt>Trialing</dt><dd>{{ s.trialing }}</dd></div>
            <div><dt>Past due</dt><dd>{{ s.pastDue }}</dd></div>
            <div><dt>Cancelled</dt><dd>{{ s.cancelled }}</dd></div>
          </dl>
        </section>
      </div>

      <section class="adm-section">
        <h2 class="adm-section-title">Subscriptions</h2>
        <div class="adm-table bl__subs" role="table" aria-label="Subscriptions">
          <div class="adm-th" role="row">
            <span role="columnheader">Account</span>
            <span role="columnheader">Plan</span>
            <span role="columnheader" class="adm-hide-sm">Status</span>
            <span role="columnheader" class="adm-hide-md">Granted</span>
            <span role="columnheader" class="adm-cell--right adm-hide-md">Period ends</span>
          </div>
          @if (subscriptions().length === 0) {
            <ui-empty-state icon="tag" heading="Nothing sold yet" description="Paid subscriptions and staff grants appear here." />
          } @else {
            @for (row of subscriptions(); track row.userId) {
              <a class="adm-tr" role="row" [routerLink]="['/admin/users', row.userId]">
                <span class="adm-truncate adm-cell--strong" role="cell">{{ row.email }}</span>
                <span role="cell"><ui-badge>{{ row.plan }}</ui-badge></span>
                <span class="adm-hide-sm" role="cell"><ui-badge [tone]="statusTone(row.status)">{{ row.status }}</ui-badge></span>
                <span class="adm-hide-md" role="cell">
                  @if (row.overridePlan) { <ui-badge tone="info">{{ row.overridePlan }}</ui-badge> } @else { <span class="adm-cell--dim">—</span> }
                </span>
                <span class="adm-cell--right adm-cell--dim adm-hide-md" role="cell">{{ row.currentPeriodEnd ? (row.currentPeriodEnd | relativeTime) : '—' }}</span>
              </a>
            }
          }
        </div>
      </section>

      @if (canSeeWebhooks()) {
        <section class="adm-section">
          <h2 class="adm-section-title">Recent webhook deliveries</h2>
          <div class="adm-table bl__hooks" role="table" aria-label="Webhook deliveries">
            <div class="adm-th" role="row">
              <span role="columnheader">Event</span>
              <span role="columnheader">State</span>
              <span role="columnheader" class="adm-hide-sm">Error</span>
              <span role="columnheader" class="adm-cell--right">Received</span>
            </div>
            @if (webhooks().length === 0) {
              <ui-empty-state icon="cloud" heading="No deliveries" description="Dodo has not sent anything yet." />
            } @else {
              @for (row of webhooks(); track row.id) {
                <div class="adm-tr adm-tr--static" role="row">
                  <span class="adm-mono adm-truncate" role="cell">{{ row.type }}</span>
                  <span role="cell"><ui-badge [tone]="row.processedAt ? 'success' : 'warning'">{{ row.processedAt ? 'applied' : 'pending' }}</ui-badge></span>
                  <span class="adm-truncate adm-danger-text adm-hide-sm" role="cell" [title]="row.error ?? ''">{{ row.error ?? '' }}</span>
                  <span class="adm-cell--right adm-cell--dim" role="cell">{{ row.receivedAt | relativeTime }}</span>
                </div>
              }
            }
          </div>
        </section>
      }
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .bl__subs { --adm-cols: minmax(200px, 2fr) 80px 110px 110px 130px; }
      .bl__hooks { --adm-cols: minmax(200px, 1.4fr) 100px minmax(160px, 2fr) 120px; }
      @media (max-width: 900px) {
        .bl__subs { --adm-cols: minmax(160px, 2fr) 80px 110px; }
      }
      @media (max-width: 720px) {
        .bl__subs { --adm-cols: minmax(0, 1fr) 80px; }
        .bl__hooks { --adm-cols: minmax(0, 1fr) 100px 110px; }
      }
    `,
  ],
})
export class AdminBillingPage {
  private readonly api = inject(AdminApiService);
  private readonly me = inject(MeService);

  protected readonly summary = signal<BillingSummaryDto | null>(null);
  protected readonly subscriptions = signal<AdminSubscriptionRowDto[]>([]);
  protected readonly webhooks = signal<AdminWebhookRowDto[]>([]);
  protected readonly loading = signal(true);

  /** Delivery errors can name a customer, so SUPPORT does not see them. */
  protected readonly canSeeWebhooks = computed(() => {
    const role = this.me.me()?.user.platformRole;
    return role === 'admin' || role === 'owner';
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [summary, subs] = await Promise.all([this.api.billingSummary(), this.api.subscriptions()]);
      this.summary.set(summary);
      this.subscriptions.set(subs.items);
      if (this.canSeeWebhooks()) {
        // Separate, because a SUPPORT caller would get a 403 that would
        // otherwise fail the whole page.
        this.webhooks.set((await this.api.webhooks()).items);
      }
    } catch {
      /* The shell surfaces a 403; nothing useful to add here. */
    } finally {
      this.loading.set(false);
    }
  }

  protected statusTone(status: string): UiBadgeTone {
    if (status === 'active' || status === 'trialing') return 'success';
    if (status === 'past_due') return 'warning';
    return status === 'cancelled' ? 'danger' : 'neutral';
  }
}
