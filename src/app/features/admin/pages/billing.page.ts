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
    UiEmptyStateComponent,
    UiSkeletonComponent,
    UiStatTileComponent,
    RelativeTimePipe,
  ],
  template: `
    <div class="bill">
      @if (loading()) {
        <ui-skeleton height="96px" [lines]="3" />
      } @else if (summary(); as s) {
        @if (s.catalog.mode === 'off') {
          <p class="bill__notice">
            Billing is not configured on this deployment, so nothing can be sold. The figures below
            describe whatever rows already exist.
          </p>
        } @else if (!s.catalog.webhookConfigured) {
          <p class="bill__warn">
            Billing is live but no webhook signing key is set. Checkout will succeed and no plan will
            ever be granted.
          </p>
        }

        <div class="bill__grid">
          <ui-stat-tile
            label="Approximate MRR"
            [value]="s.currency + ' ' + s.approximateMrr.toLocaleString()"
            hint="from display prices, not from Dodo"
          />
          <ui-stat-tile label="Paying" [value]="s.paying" [hint]="s.trialing + ' trialing'" />
          <ui-stat-tile label="Past due" [value]="s.pastDue" hint="in dunning" />
          <ui-stat-tile label="Complimentary" [value]="s.grants" hint="granted by staff" />
        </div>

        @if (s.unprocessedWebhooks > 0) {
          <p class="bill__warn">
            {{ s.unprocessedWebhooks }} webhook
            {{ s.unprocessedWebhooks === 1 ? 'delivery has' : 'deliveries have' }} never been applied.
            The <a routerLink="/admin/system">replay job</a> retries them every half hour.
          </p>
        }

        <section class="bill__section">
          <h2 class="bill__heading">Subscriptions</h2>
          @if (subscriptions().length === 0) {
            <ui-empty-state heading="Nothing sold yet" description="Paid subscriptions appear here." />
          } @else {
            <div class="bill__list">
              @for (row of subscriptions(); track row.userId) {
                <a class="bill__row" [routerLink]="['/admin/users', row.userId]">
                  <span class="bill__email">{{ row.email }}</span>
                  <ui-badge>{{ row.plan }}</ui-badge>
                  <ui-badge [tone]="statusTone(row.status)">{{ row.status }}</ui-badge>
                  @if (row.overridePlan) {
                    <ui-badge tone="info">granted {{ row.overridePlan }}</ui-badge>
                  }
                  <span class="bill__meta">
                    {{ row.currentPeriodEnd ? (row.currentPeriodEnd | relativeTime) : '—' }}
                  </span>
                </a>
              }
            </div>
          }
        </section>

        @if (canSeeWebhooks()) {
          <section class="bill__section">
            <h2 class="bill__heading">Recent webhook deliveries</h2>
            @if (webhooks().length === 0) {
              <ui-empty-state heading="No deliveries" description="Dodo has not sent anything yet." />
            } @else {
              <div class="bill__list">
                @for (row of webhooks(); track row.id) {
                  <div class="bill__row bill__row--static">
                    <span class="bill__email">{{ row.type }}</span>
                    <ui-badge [tone]="row.processedAt ? 'success' : 'warning'">
                      {{ row.processedAt ? 'applied' : 'pending' }}
                    </ui-badge>
                    <span class="bill__meta bill__error">{{ row.error ?? '' }}</span>
                    <span class="bill__meta">{{ row.receivedAt | relativeTime }}</span>
                  </div>
                }
              </div>
            }
          </section>
        }
      }
    </div>
  `,
  styles: [
    `
      .bill {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 1100px;
      }
      .bill__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: var(--ui-space-3);
      }
      .bill__notice,
      .bill__warn {
        margin: 0;
        padding: var(--ui-space-3);
        border-left: 3px solid var(--ui-border);
        background: var(--ui-surface);
        font-size: var(--ui-text-sm);
      }
      .bill__warn {
        border-left-color: var(--ui-warning, #d29922);
      }
      .bill__section {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-2);
      }
      .bill__heading {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .bill__list {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
        overflow: hidden;
      }
      .bill__row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 80px 110px auto 140px;
        gap: var(--ui-space-3);
        align-items: center;
        padding: 9px var(--ui-space-4);
        border-bottom: 1px solid var(--ui-border);
        color: inherit;
        text-decoration: none;
        font-size: var(--ui-text-sm);
      }
      .bill__row:last-child {
        border-bottom: 0;
      }
      .bill__row:not(.bill__row--static):hover {
        background: var(--ui-surface-2);
      }
      .bill__email {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .bill__meta {
        color: var(--ui-text-dim);
        text-align: right;
      }
      .bill__error {
        text-align: left;
        color: var(--ui-danger, #f85149);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (max-width: 900px) {
        .bill__row {
          grid-template-columns: minmax(0, 1fr) 100px;
        }
        .bill__row > :nth-child(n + 3) {
          display: none;
        }
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
