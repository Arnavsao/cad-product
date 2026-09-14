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
  UiIconComponent,
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
    UiIconComponent,
    UiBadgeComponent,
    UiSkeletonComponent,
    FileSizePipe,
    RelativeTimePipe,
  ],
  template: `
    <a class="adm-back" routerLink="/admin/users"><ui-icon name="back" [size]="14" /> All users</a>

    @if (error(); as e) {
      <div class="adm-note adm-note--danger" role="alert">
        <ui-icon name="alert" [size]="18" />
        <div><p class="adm-note__title">This account could not be loaded.</p><p class="adm-note__msg">{{ e }}</p></div>
      </div>
    }

    @if (loading()) {
      <ui-skeleton height="28px" [lines]="6" />
    } @else if (user(); as u) {
      <section class="adm-card adm-card--hero ud__hero">
        <div class="ud__identity">
          <div class="ud__avatar" aria-hidden="true">{{ initials() }}</div>
          <div class="adm-stack" style="gap: 2px">
            <h1 class="adm-title">{{ fullName() }}</h1>
            <span class="adm-row">
              <span class="adm-muted">{{ u.email }}</span>
              <ui-badge [tone]="statusTone()">{{ u.status }}</ui-badge>
              @if (u.platformRole !== 'user') { <ui-badge tone="info">{{ u.platformRole }}</ui-badge> }
              <ui-badge>{{ u.plan }}</ui-badge>
            </span>
          </div>
        </div>
        <div class="adm-actions">
          @if (u.status === 'active') {
            <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="suspend()">Suspend</button>
          } @else if (u.status === 'suspended') {
            <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="unsuspend()">Lift suspension</button>
          }
          <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="message()">Send message</button>
          @if (canGrant()) {
            @if (u.billing?.overridePlan) {
              <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="revokePlan()">Revoke granted plan</button>
            } @else {
              <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="grantPlan()">Grant a plan</button>
            }
            <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="exportData()"><ui-icon name="download" [size]="16" /> Export data</button>
          }
          @if (u.status !== 'deleted') {
            <button uiButton variant="ghost" size="sm" class="adm-danger-text" [disabled]="busy()" (click)="remove()">Delete account</button>
          }
        </div>
      </section>

      @if (isSelf()) {
        <p class="adm-muted">This is your own account, so the actions above will be refused.</p>
      }

      @if (u.suspendedReason && u.status === 'suspended') {
        <div class="adm-note adm-note--warn">
          <ui-icon name="alert" [size]="18" />
          <div><p class="adm-note__title">Suspended {{ u.suspendedAt | relativeTime }}</p><p class="adm-note__msg">{{ u.suspendedReason }}</p></div>
        </div>
      }
      @if (u.billing?.overridePlan; as granted) {
        <div class="adm-note adm-note--accent">
          <ui-icon name="star" [size]="18" />
          <div>
            <p class="adm-note__title">Complimentary {{ granted }}{{ u.billing?.overrideUntil ? ' until ' + (u.billing?.overrideUntil | date) : ', no expiry' }}</p>
            <p class="adm-note__msg">{{ u.billing?.overrideReason }}</p>
          </div>
        </div>
      }

      <div class="adm-grid-halves">
        <section class="adm-card">
          <p class="adm-kicker">Account</p>
          <dl class="adm-facts">
            <div><dt>Joined</dt><dd>{{ u.createdAt | relativeTime }}</dd></div>
            <div><dt>Last seen</dt><dd>{{ u.lastSeenAt ? (u.lastSeenAt | relativeTime) : 'never' }}</dd></div>
            <div><dt>Onboarded</dt><dd>{{ u.onboarded ? 'yes' : 'no' }}</dd></div>
            @if (u.preferences; as p) {
              <div><dt>Language</dt><dd>{{ p.locale }}</dd></div>
              <div><dt>Units</dt><dd>{{ p.units }}</dd></div>
              <div><dt>Profession</dt><dd>{{ p.role ?? '—' }}</dd></div>
            }
          </dl>
        </section>

        <section class="adm-card">
          <p class="adm-kicker">Usage</p>
          <dl class="adm-facts">
            <div><dt>Drawings</dt><dd>{{ u.drawingCount }}</dd></div>
            <div><dt>Storage</dt><dd>{{ u.bytesUsed | fileSize }}</dd></div>
            <div><dt>Feedback</dt><dd><a class="adm-link" routerLink="/admin/feedback" [queryParams]="{ q: u.email }">{{ u.feedbackCount }} {{ u.feedbackCount === 1 ? 'report' : 'reports' }}</a></dd></div>
            @if (u.billing; as b) {
              <div><dt>Subscription</dt><dd>{{ b.plan }} · {{ b.status }}</dd></div>
            }
          </dl>
        </section>

        @if (u.organizations.length) {
          <section class="adm-card">
            <p class="adm-kicker">Organizations</p>
            <ul class="ud__orgs">
              @for (org of u.organizations; track org.id) {
                <li class="adm-row"><span class="adm-cell--strong">{{ org.name }}</span> <ui-badge>{{ org.role }}</ui-badge></li>
              }
            </ul>
          </section>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .ud__hero { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4); flex-wrap: wrap; }
      .ud__identity { display: flex; align-items: center; gap: var(--ui-space-4); min-width: 0; }
      .ud__avatar {
        display: grid; place-items: center; flex: 0 0 auto; width: 52px; height: 52px;
        border-radius: var(--ui-radius-full); background: var(--ui-accent); color: #fff;
        font-size: var(--ui-text-lg); font-weight: 700; letter-spacing: .02em;
      }
      .ud__orgs { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ui-space-2); font-size: var(--ui-text-md); }
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

  protected readonly initials = computed(() => {
    const u = this.user();
    const letters = `${u?.firstName?.charAt(0) ?? ''}${u?.lastName?.charAt(0) ?? ''}`.trim();
    return (letters || u?.email.charAt(0) || '?').toUpperCase();
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

  /**
   * Downloads everything we hold about the account, for a data-subject request.
   *
   * Built as a blob and clicked rather than opened as a link: the endpoint needs
   * the bearer token, which a plain `<a href>` would not send.
   */
  protected async exportData(): Promise<void> {
    this.busy.set(true);
    try {
      const data = await this.api.exportUserData(this.id());
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `cado-account-${this.user()?.email ?? this.id()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.notify.success('Export downloaded');
    } catch {
      this.notify.error('Could not build that export.');
    } finally {
      this.busy.set(false);
    }
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
