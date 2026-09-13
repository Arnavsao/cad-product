import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminOrgDetailDto, AdminOrgRowDto } from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  FileSizePipe,
  RelativeTimePipe,
  UiBadgeComponent,
  UiButtonDirective,
  UiDialogService,
  UiEmptyStateComponent,
  UiInputDirective,
  UiSkeletonComponent,
} from '../../../shared/ui';

/**
 * Organizations, and the two things their own members sometimes cannot do:
 * change a name, and move an ownership that has nowhere to go because the only
 * owner has left.
 *
 * The detail opens inline rather than on its own route. An organization has a
 * short, bounded amount to show — members, invites, a join code — and a second
 * page for it would be two navigations to answer one question.
 */
@Component({
  selector: 'app-admin-organizations',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiInputDirective,
    UiButtonDirective,
    UiBadgeComponent,
    UiEmptyStateComponent,
    UiSkeletonComponent,
    FileSizePipe,
    RelativeTimePipe,
  ],
  template: `
    <div class="orgs">
      <input
        uiInput
        id="admin-org-search"
        type="search"
        class="orgs__search"
        placeholder="Search name or slug"
        (input)="onSearch($event)"
      />

      @if (loading()) {
        <ui-skeleton height="44px" [lines]="6" />
      } @else if (rows().length === 0) {
        <ui-empty-state heading="No organizations" description="Nobody has created a shared workspace yet." />
      } @else {
        <div class="orgs__list">
          @for (row of rows(); track row.id) {
            <div class="orgs__row" [class.orgs__row--open]="openId() === row.id">
              <button type="button" class="orgs__summary" (click)="toggle(row)">
                <span class="orgs__name">
                  {{ row.name }}
                  <span class="orgs__slug">{{ row.slug }}</span>
                </span>
                <span class="orgs__stat">{{ row.memberCount }} {{ row.memberCount === 1 ? 'member' : 'members' }}</span>
                <span class="orgs__stat">
                  {{ row.drawingCount }} {{ row.drawingCount === 1 ? 'drawing' : 'drawings' }}
                </span>
                <span class="orgs__stat">{{ row.bytesUsed | fileSize }}</span>
                <span class="orgs__owner">{{ row.ownerEmail ?? 'no owner' }}</span>
              </button>

              @if (openId() === row.id) {
                @if (detail(); as d) {
                  <div class="orgs__detail">
                    <div class="orgs__actions">
                      @if (canManage()) {
                        <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="rename(d)">
                          Rename
                        </button>
                        <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="transfer(d)">
                          Transfer ownership
                        </button>
                        <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="rotate(d)">
                          Rotate join code
                        </button>
                      } @else {
                        <span class="orgs__hint">Changing an organization needs the admin tier.</span>
                      }
                    </div>

                    <h3 class="orgs__heading">Members</h3>
                    <ul class="orgs__members">
                      @for (member of d.members; track member.userId) {
                        <li>
                          <a [routerLink]="['/admin/users', member.userId]">{{ member.name || member.email }}</a>
                          <ui-badge [tone]="member.role === 'owner' ? 'info' : 'neutral'">{{ member.role }}</ui-badge>
                          <span class="orgs__joined">joined {{ member.joinedAt | relativeTime }}</span>
                        </li>
                      }
                    </ul>

                    @if (d.invites.length) {
                      <h3 class="orgs__heading">Pending invites</h3>
                      <ul class="orgs__members">
                        @for (invite of d.invites; track invite.id) {
                          <li>
                            {{ invite.email }}
                            <ui-badge>{{ invite.role }}</ui-badge>
                            <span class="orgs__joined">expires {{ invite.expiresAt | relativeTime }}</span>
                          </li>
                        }
                      </ul>
                    }
                  </div>
                } @else {
                  <ui-skeleton height="24px" [lines]="3" />
                }
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .orgs {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 1100px;
      }
      .orgs__search {
        max-width: 320px;
      }
      .orgs__list {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
        overflow: hidden;
      }
      .orgs__row {
        border-bottom: 1px solid var(--ui-border);
      }
      .orgs__row:last-child {
        border-bottom: 0;
      }
      .orgs__summary {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 110px 110px 90px 200px;
        gap: var(--ui-space-3);
        align-items: center;
        width: 100%;
        padding: 10px var(--ui-space-4);
        background: none;
        border: 0;
        color: inherit;
        font: inherit;
        font-size: var(--ui-text-sm);
        text-align: left;
        cursor: pointer;
      }
      .orgs__summary:hover {
        background: var(--ui-surface-2);
      }
      .orgs__row--open .orgs__summary {
        background: var(--ui-surface-2);
      }
      .orgs__name {
        display: flex;
        flex-direction: column;
        min-width: 0;
        font-weight: 600;
      }
      .orgs__slug,
      .orgs__stat,
      .orgs__owner,
      .orgs__joined,
      .orgs__hint {
        color: var(--ui-text-dim);
        font-weight: 400;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .orgs__detail {
        padding: 0 var(--ui-space-4) var(--ui-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-2);
      }
      .orgs__actions {
        display: flex;
        gap: var(--ui-space-2);
        flex-wrap: wrap;
        align-items: center;
      }
      .orgs__heading {
        margin: var(--ui-space-2) 0 0;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .orgs__members {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: var(--ui-text-sm);
      }
      .orgs__members li {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        flex-wrap: wrap;
      }
      .orgs__members a {
        color: inherit;
      }
      @media (max-width: 900px) {
        .orgs__summary {
          grid-template-columns: minmax(0, 1fr) 110px;
        }
        .orgs__summary .orgs__stat:nth-of-type(n + 2),
        .orgs__owner {
          display: none;
        }
      }
    `,
  ],
})
export class AdminOrganizationsPage {
  private readonly api = inject(AdminApiService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(UiDialogService);
  private readonly me = inject(MeService);

  protected readonly rows = signal<AdminOrgRowDto[]>([]);
  protected readonly detail = signal<AdminOrgDetailDto | null>(null);
  protected readonly openId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);

  protected readonly canManage = computed(() => {
    const role = this.me.me()?.user.platformRole;
    return role === 'admin' || role === 'owner';
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.load();
  }

  private async load(q?: string): Promise<void> {
    this.loading.set(true);
    try {
      const page = await this.api.listOrgs({ q: q || undefined, pageSize: 50 });
      this.rows.set(page.items);
    } catch {
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(value), 250);
  }

  protected async toggle(row: AdminOrgRowDto): Promise<void> {
    if (this.openId() === row.id) {
      this.openId.set(null);
      this.detail.set(null);
      return;
    }
    this.openId.set(row.id);
    this.detail.set(null);
    try {
      this.detail.set(await this.api.getOrg(row.id));
    } catch {
      this.notify.error('Could not load that organization.');
      this.openId.set(null);
    }
  }

  protected async rename(org: AdminOrgDetailDto): Promise<void> {
    const name = globalThis.prompt('Rename organization', org.name)?.trim();
    if (!name || name === org.name) return;
    const reason = globalThis.prompt('Reason (stored in the audit log)')?.trim();
    if (!reason || reason.length < 3) return;
    await this.run(() => this.api.renameOrg(org.id, name, reason), 'Renamed');
  }

  protected async transfer(org: AdminOrgDetailDto): Promise<void> {
    const userId = globalThis
      .prompt('Transfer ownership\n\nPaste the user id of a current member. The previous owner becomes an admin.')
      ?.trim();
    if (!userId) return;
    const reason = globalThis.prompt('Reason (stored in the audit log)')?.trim();
    if (!reason || reason.length < 3) return;
    await this.run(() => this.api.transferOrgOwnership(org.id, userId, reason), 'Ownership transferred');
  }

  protected async rotate(org: AdminOrgDetailDto): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Rotate the join code',
      message: 'Anyone holding the old code can no longer use it. Existing members are unaffected.',
      confirmLabel: 'Rotate',
    });
    if (!ok) return;
    await this.run(() => this.api.regenerateOrgJoinCode(org.id), 'Join code rotated');
  }

  private async run(action: () => Promise<AdminOrgDetailDto>, success: string): Promise<void> {
    this.busy.set(true);
    try {
      const updated = await action();
      this.detail.set(updated);
      this.rows.update((list) => list.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
      this.notify.success(success);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      this.notify.error(
        code === 'NOT_A_MEMBER'
          ? 'That person is not in this organization. Have them join first.'
          : code === 'ALREADY_OWNER'
            ? 'They already own it.'
            : code === 'FORBIDDEN'
              ? 'Your staff tier cannot do this.'
              : 'That did not work.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
