import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminUserDetailDto } from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  FileSizePipe,
  RelativeTimePipe,
  UiBadgeComponent,
  UiButtonDirective,
  UiDialogService,
  UiSkeletonComponent,
  type UiBadgeTone,
} from '../../../shared/ui';

/**
 * One account, and the small set of things staff may do to it.
 *
 * The actions are intentionally few: suspend, lift a suspension, delete, and
 * send a message. There is no field editing here — the portal runs the service,
 * it does not rewrite people's data — and every destructive action prompts for
 * a reason, which is stored in the audit trail and shown to the user.
 */
@Component({
  selector: 'app-admin-user-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    UiButtonDirective,
    UiBadgeComponent,
    UiSkeletonComponent,
    FileSizePipe,
    RelativeTimePipe,
  ],
  template: `
    <div class="detail">
      <a class="detail__back" routerLink="/admin/users">← All users</a>

      @if (error()) {
        <p class="detail__error">{{ error() }}</p>
      }

      @if (loading()) {
        <ui-skeleton height="28px" [lines]="6" />
      } @else if (user(); as u) {
        <header class="detail__header">
          <div>
            <h1 class="detail__name">{{ fullName() }}</h1>
            <p class="detail__email">{{ u.email }}</p>
          </div>
          <div class="detail__badges">
            <ui-badge [tone]="statusTone()">{{ u.status }}</ui-badge>
            @if (u.platformRole !== 'user') {
              <ui-badge tone="info">{{ u.platformRole }}</ui-badge>
            }
            <ui-badge>{{ u.plan }}</ui-badge>
          </div>
        </header>

        @if (u.suspendedReason && u.status === 'suspended') {
          <p class="detail__notice">Suspended: {{ u.suspendedReason }}</p>
        }
        @if (u.billing?.overridePlan; as granted) {
          <p class="detail__notice">
            Complimentary {{ granted }}{{ u.billing?.overrideUntil ? ' until ' + (u.billing?.overrideUntil | date) : ', no expiry' }}.
            {{ u.billing?.overrideReason }}
          </p>
        }

        <div class="detail__actions">
          @if (u.status === 'active') {
            <button uiButton variant="secondary" [disabled]="busy()" (click)="suspend()">Suspend</button>
          } @else if (u.status === 'suspended') {
            <button uiButton variant="secondary" [disabled]="busy()" (click)="unsuspend()">Lift suspension</button>
          }
          <button uiButton variant="secondary" [disabled]="busy()" (click)="message()">Send message</button>
          @if (canGrant()) {
            @if (u.billing?.overridePlan) {
              <button uiButton variant="secondary" [disabled]="busy()" (click)="revokePlan()">Revoke granted plan</button>
            } @else {
              <button uiButton variant="secondary" [disabled]="busy()" (click)="grantPlan()">Grant a plan</button>
            }
          }
          @if (u.status !== 'deleted') {
            <button uiButton variant="danger" [disabled]="busy()" (click)="remove()">Delete account</button>
          }
        </div>
        @if (isSelf()) {
          <p class="detail__hint">This is your own account, so the actions above will be refused.</p>
        }

        <dl class="detail__facts">
          <div><dt>Joined</dt><dd>{{ u.createdAt | relativeTime }}</dd></div>
          <div><dt>Last seen</dt><dd>{{ u.lastSeenAt ? (u.lastSeenAt | relativeTime) : 'never' }}</dd></div>
          <div><dt>Onboarded</dt><dd>{{ u.onboarded ? 'yes' : 'no' }}</dd></div>
          <div><dt>Drawings</dt><dd>{{ u.drawingCount }}</dd></div>
          <div><dt>Storage</dt><dd>{{ u.bytesUsed | fileSize }}</dd></div>
          @if (u.preferences; as p) {
            <div><dt>Language</dt><dd>{{ p.locale }}</dd></div>
            <div><dt>Units</dt><dd>{{ p.units }}</dd></div>
            <div><dt>Profession</dt><dd>{{ p.role ?? '—' }}</dd></div>
          }
          @if (u.billing; as b) {
            <div><dt>Subscription</dt><dd>{{ b.plan }} · {{ b.status }}</dd></div>
          }
          <div><dt>Feedback</dt><dd><a [routerLink]="['/admin/feedback']" [queryParams]="{ q: u.email }">{{ u.feedbackCount }} {{ u.feedbackCount === 1 ? 'report' : 'reports' }}</a></dd></div>
        </dl>

        @if (u.organizations.length) {
          <section class="detail__section">
            <h2 class="detail__heading">Organizations</h2>
            <ul class="detail__list">
              @for (org of u.organizations; track org.id) {
                <li>{{ org.name }} <ui-badge>{{ org.role }}</ui-badge></li>
              }
            </ul>
          </section>
        }
      }
    </div>
  `,
  styles: [
    `
      .detail {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 820px;
      }
      .detail__back {
        color: var(--ui-text-dim);
        text-decoration: none;
        font-size: var(--ui-text-sm);
        width: fit-content;
      }
      .detail__back:hover {
        color: var(--ui-text);
      }
      .detail__header {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--ui-space-3);
      }
      .detail__name {
        margin: 0;
        font-size: 22px;
      }
      .detail__email {
        margin: 2px 0 0;
        color: var(--ui-text-dim);
        font-size: var(--ui-text-sm);
      }
      .detail__badges {
        display: flex;
        gap: var(--ui-space-1);
        flex-wrap: wrap;
      }
      .detail__notice {
        margin: 0;
        padding: var(--ui-space-3);
        border-left: 3px solid var(--ui-warning, #d29922);
        background: var(--ui-surface);
        font-size: var(--ui-text-sm);
      }
      .detail__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--ui-space-2);
      }
      .detail__hint,
      .detail__error {
        margin: 0;
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
      }
      .detail__error {
        color: var(--ui-danger, #f85149);
      }
      .detail__facts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: var(--ui-space-3);
        margin: 0;
        padding: var(--ui-space-4);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
      }
      .detail__facts dt {
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .detail__facts dd {
        margin: 2px 0 0;
        font-size: var(--ui-text-sm);
      }
      .detail__section {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-2);
      }
      .detail__heading {
        margin: 0;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .detail__list {
        margin: 0;
        padding-left: 18px;
        font-size: var(--ui-text-sm);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
    `,
  ],
})
export class AdminUserDetailPage {
  /** Bound from the route parameter by `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  private readonly api = inject(AdminApiService);
  private readonly dialog = inject(UiDialogService);
  private readonly notify = inject(NotificationService);
  private readonly me = inject(MeService);
  private readonly router = inject(Router);

  protected readonly user = signal<AdminUserDetailDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly isSelf = computed(() => this.user()?.id === this.me.me()?.user.id);

  /** Granting a plan is ADMIN; SUPPORT sees the state but no button. */
  protected readonly canGrant = computed(() => {
    const role = this.me.me()?.user.platformRole;
    return role === 'admin' || role === 'owner';
  });

  protected readonly fullName = computed(() => {
    const u = this.user();
    return [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Unnamed account';
  });

  protected readonly statusTone = computed<UiBadgeTone>(() => {
    const status = this.user()?.status;
    if (status === 'suspended') return 'warning';
    return status === 'deleted' ? 'danger' : 'success';
  });

  constructor() {
    // An effect, NOT a direct call: `id` is a required route input bound by
    // `withComponentInputBinding()`, which happens AFTER the constructor runs.
    // Reading it here directly throws NG0950 before the page ever paints.
    effect(() => {
      const id = this.id();
      void this.load(id);
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      this.user.set(await this.api.getUser(id));
    } catch (error) {
      this.error.set((error as { message?: string })?.message ?? 'Could not load this account.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async suspend(): Promise<void> {
    const reason = await this.askReason(
      'Suspend this account',
      'They are signed out on their next request and shown this reason.',
    );
    if (!reason) return;
    await this.run(() => this.api.suspendUser(this.id(), reason), 'Account suspended');
  }

  protected async unsuspend(): Promise<void> {
    await this.run(() => this.api.unsuspendUser(this.id()), 'Suspension lifted');
  }

  protected async remove(): Promise<void> {
    const reason = await this.askReason(
      'Delete this account',
      'The account is closed. Drawings and files are kept, so this can be undone.',
    );
    if (!reason) return;
    await this.run(() => this.api.deleteUser(this.id(), reason), 'Account deleted');
  }

  /**
   * Grants a plan without a payment — the beta's main use for this page.
   *
   * Collected with native prompts for the same reason the suspend reason is:
   * a bespoke modal with its own validation would be more code than the action
   * it guards, and the server validates all three values anyway.
   */
  protected async grantPlan(): Promise<void> {
    const plan = globalThis.prompt('Grant a plan\n\nWhich plan? pro or team')?.trim().toLowerCase();
    if (plan !== 'pro' && plan !== 'team') {
      if (plan) this.notify.error('Enter either pro or team.');
      return;
    }
    const daysRaw = globalThis.prompt('For how many days?\n\nLeave blank for no expiry.')?.trim();
    const days = daysRaw ? Number(daysRaw) : undefined;
    if (days !== undefined && (!Number.isFinite(days) || days < 1)) {
      this.notify.error('Enter a whole number of days, or leave it blank.');
      return;
    }
    const reason = this.prompt('Grant a plan', 'Reason (stored in the audit log)');
    if (!reason) return;

    await this.run(() => this.api.grantPlan(this.id(), { plan, days, reason }), `Granted ${plan}`);
  }

  protected async revokePlan(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Revoke the granted plan',
      message: 'Any plan they actually bought is unaffected.',
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    await this.run(() => this.api.revokePlan(this.id()), 'Grant revoked');
  }

  protected async message(): Promise<void> {
    const title = await this.prompt('Send a message', 'Shown in their in-app inbox.');
    if (!title) return;
    await this.run(async () => {
      await this.api.notifyUser(this.id(), { title });
      return this.api.getUser(this.id());
    }, 'Message sent');
  }

  /**
   * Reason prompts reuse the shared confirm dialog rather than a bespoke form.
   * `UiDialogService` has no text input, so the reason is collected with a
   * native prompt — deliberate, because a half-built modal with its own
   * validation would be more code than the action it guards.
   */
  private async askReason(title: string, message: string): Promise<string | null> {
    const confirmed = await this.dialog.confirm({ title, message, confirmLabel: 'Continue', danger: true });
    if (!confirmed) return null;
    return this.prompt(title, 'Reason (stored in the audit log and shown to the user)');
  }

  private prompt(title: string, message: string): string | null {
    const value = globalThis.prompt(`${title}\n\n${message}`)?.trim();
    return value && value.length >= 3 ? value : null;
  }

  private async run(action: () => Promise<AdminUserDetailDto>, success: string): Promise<void> {
    this.busy.set(true);
    try {
      this.user.set(await action());
      this.notify.success(success);
    } catch (error) {
      this.notify.error(messageOf(error));
    } finally {
      this.busy.set(false);
    }
  }
}

function messageOf(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'CANNOT_TARGET_SELF':
      return 'You cannot do this to your own account.';
    case 'TARGET_IS_STAFF':
      return 'Remove this account from staff first.';
    case 'ALREADY_SUSPENDED':
      return 'That account is already suspended.';
    case 'FORBIDDEN':
      return 'Your staff tier cannot do this.';
    default:
      return (error as { message?: string })?.message ?? 'That did not work.';
  }
}
