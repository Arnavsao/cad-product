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
  imports: [RouterLink, UiButtonDirective, UiBadgeComponent, UiSkeletonComponent],
  template: `
    <div class="staff">
      <p class="staff__lede">
        Staff are ordinary accounts with a tier. To add someone, have them sign up first, then promote
        them here.
      </p>

      <ul class="staff__tiers">
        @for (tier of tiers; track tier.role) {
          <li><strong>{{ tier.label }}</strong> — {{ tier.blurb }}</li>
        }
      </ul>

      @if (loading()) {
        <ui-skeleton height="44px" [lines]="4" />
      } @else {
        <div class="staff__table">
          @for (person of staff(); track person.id) {
            <div class="staff__row">
              <a class="staff__person" [routerLink]="['/admin/users', person.id]">
                <span class="staff__name">{{ name(person) }}</span>
                <span class="staff__email">{{ person.email }}</span>
              </a>
              <ui-badge tone="info">{{ person.platformRole }}</ui-badge>
              @if (canManage() && person.id !== myId()) {
                <div class="staff__actions">
                  @for (tier of tiers; track tier.role) {
                    @if (tier.role !== person.platformRole) {
                      <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="setRole(person, tier.role)">
                        Make {{ tier.label }}
                      </button>
                    }
                  }
                  <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="demote(person)">Remove</button>
                </div>
              } @else if (person.id === myId()) {
                <span class="staff__you">You</span>
              }
            </div>
          }
        </div>

        @if (canManage()) {
          <button uiButton variant="secondary" [disabled]="busy()" (click)="promote()">Promote by user id</button>
        } @else {
          <p class="staff__lede">Only an owner can change staff tiers.</p>
        }
      }
    </div>
  `,
  styles: [
    `
      .staff {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 900px;
      }
      .staff__lede {
        margin: 0;
        color: var(--ui-text-dim);
        font-size: var(--ui-text-sm);
      }
      .staff__tiers {
        margin: 0;
        padding: var(--ui-space-3) var(--ui-space-4) var(--ui-space-3) 30px;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
        font-size: var(--ui-text-sm);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .staff__table {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
        overflow: hidden;
      }
      .staff__row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--ui-space-3);
        padding: var(--ui-space-3) var(--ui-space-4);
        border-bottom: 1px solid var(--ui-border);
      }
      .staff__row:last-child {
        border-bottom: 0;
      }
      .staff__person {
        display: flex;
        flex-direction: column;
        flex: 1 1 220px;
        min-width: 0;
        color: inherit;
        text-decoration: none;
      }
      .staff__name {
        font-weight: 600;
        font-size: var(--ui-text-sm);
      }
      .staff__email,
      .staff__you {
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
      }
      .staff__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--ui-space-1);
        margin-left: auto;
      }
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
