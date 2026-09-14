import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminUserRowDto } from '../../../core/api/admin.models';
import { PlatformRole } from '../../../core/api/api.models';
import { MeService } from '../../../core/api/me.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  UiBadgeComponent,
  UiButtonDirective,
  UiDialogService,
  UiEmptyStateComponent,
  UiIconComponent,
  UiSkeletonComponent,
} from '../../../shared/ui';

/** Tiers an owner can hand out, with what each one means in one line. */
const TIERS: { role: PlatformRole; label: string; blurb: string }[] = [
  { role: 'support', label: 'Support', blurb: 'Reads the portal and triages feedback.' },
  { role: 'admin', label: 'Admin', blurb: 'Suspends accounts, flips flags, grants plans.' },
  { role: 'owner', label: 'Owner', blurb: 'Everything, plus staff and billing configuration.' },
];

/**
 * Who can operate CADO.
 *
 * Promotion is by email: staff are ordinary accounts that have been given a
 * tier, so there is no separate staff directory to keep in step. Only an owner
 * can change a tier, nobody can change their own, and the last owner cannot be
 * demoted — the server enforces all three, this page just explains them.
 */
@Component({
  selector: 'app-admin-staff',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButtonDirective, UiBadgeComponent, UiEmptyStateComponent, UiIconComponent, UiSkeletonComponent],
  template: `
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Staff</h1>
        <p class="adm-lede">Who can operate CADO. Staff are ordinary accounts with a tier: have someone sign up first, then promote them.</p>
      </div>
      <div class="adm-actions">
        @if (canManage()) {
          <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="promote()"><ui-icon name="user-plus" [size]="16" /> Promote by user id</button>
        } @else {
          <span class="adm-muted">Only an owner can change staff tiers.</span>
        }
      </div>
    </div>

    <div class="adm-grid-kpi st__tiers">
      @for (tier of tiers; track tier.role) {
        <div class="adm-card st__tier">
          <ui-badge tone="info">{{ tier.label }}</ui-badge>
          <p class="adm-muted">{{ tier.blurb }}</p>
        </div>
      }
    </div>

    <div class="adm-table" role="table" aria-label="Staff">
      <div class="adm-th st__head" role="row">
        <span role="columnheader">Person</span>
        <span role="columnheader">Tier</span>
        <span role="columnheader" class="adm-cell--right"></span>
      </div>
      @if (loading()) {
        <ui-skeleton height="44px" [lines]="3" />
      } @else {
        @for (person of staff(); track person.id) {
          <div class="adm-tr adm-tr--static st__row" role="row">
            <a class="adm-two adm-link--quiet" role="cell" [routerLink]="['/admin/users', person.id]" style="text-decoration:none">
              <span>{{ name(person) }}</span>
              <span>{{ person.email }}</span>
            </a>
            <span role="cell"><ui-badge tone="info">{{ person.platformRole }}</ui-badge></span>
            <span class="st__actions" role="cell">
              @if (canManage() && person.id !== myId()) {
                @for (tier of tiers; track tier.role) {
                  @if (tier.role !== person.platformRole) {
                    <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="setRole(person, tier.role)">Make {{ tier.label }}</button>
                  }
                }
                <button uiButton variant="ghost" size="sm" class="adm-danger-text" [disabled]="busy()" (click)="demote(person)">Remove</button>
              } @else if (person.id === myId()) {
                <span class="adm-muted">You</span>
              }
            </span>
          </div>
        } @empty {
          <ui-empty-state icon="shield" heading="No staff yet" description="Set ADMIN_BOOTSTRAP_EMAILS to create the first owner." />
        }
      }
    </div>
  `,
  styles: [
    `
      :host { display: contents; }
      .st__tiers { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
      .st__tier { gap: var(--ui-space-2); justify-items: start; }
      .st__head, .st__row { --adm-cols: minmax(200px, 1fr) 110px auto; }
      .st__actions { display: flex; justify-content: flex-end; gap: 2px; flex-wrap: wrap; }
    `,
  ],
})
export class AdminStaffPage {
  private readonly api = inject(AdminApiService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(UiDialogService);
  private readonly me = inject(MeService);

  protected readonly tiers = TIERS;
  protected readonly staff = signal<AdminUserRowDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);

  protected readonly myId = computed(() => this.me.me()?.user.id ?? null);
  protected readonly canManage = computed(() => this.me.me()?.user.platformRole === 'owner');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.staff.set(await this.api.listStaff());
    } catch (error) {
      this.notify.error((error as { message?: string })?.message ?? 'Could not load the staff list.');
    } finally {
      this.loading.set(false);
    }
  }

  protected name(person: AdminUserRowDto): string {
    return [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Unnamed account';
  }

  protected async setRole(person: AdminUserRowDto, role: PlatformRole): Promise<void> {
    await this.run(() => this.api.setStaffRole(person.id, role), `${person.email} is now ${role}`);
  }

  protected async demote(person: AdminUserRowDto): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Remove staff access',
      message: `${person.email} keeps their account but loses the portal.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await this.run(() => this.api.removeStaff(person.id), `${person.email} is no longer staff`);
  }

  /**
   * Promotion takes a user id rather than an email: the id is what the Users
   * page links to, and two accounts can share an address (the column is not
   * unique), so an email would be ambiguous exactly where certainty matters.
   */
  protected async promote(): Promise<void> {
    const id = globalThis.prompt('Promote to support\n\nPaste the user id from their Users page.')?.trim();
    if (!id) return;
    await this.run(() => this.api.setStaffRole(id, 'support'), 'Promoted to support');
  }

  private async run(action: () => Promise<AdminUserRowDto>, success: string): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.load();
      this.notify.success(success);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      this.notify.error(
        code === 'LAST_OWNER'
          ? 'The last owner cannot be demoted.'
          : code === 'CANNOT_CHANGE_OWN_ROLE'
            ? 'You cannot change your own tier.'
            : ((error as { message?: string })?.message ?? 'That did not work.'),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
