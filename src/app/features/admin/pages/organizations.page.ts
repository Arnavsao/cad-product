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
  UiIconComponent,
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
    UiIconComponent,
    UiInputDirective,
    UiButtonDirective,
    UiBadgeComponent,
    UiEmptyStateComponent,
    UiSkeletonComponent,
    FileSizePipe,
    RelativeTimePipe,
  ],
  template: `
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Organizations</h1>
        <p class="adm-lede">Shared workspaces, and the two things their own members cannot fix: a name, and an ownership with nowhere to go.</p>
      </div>
    </div>

    <div class="adm-toolbar">
      <div class="adm-search">
        <ui-icon class="adm-search__icon" name="search" [size]="16" />
        <input uiInput id="admin-org-search" type="search" class="adm-search__input" placeholder="Search by name or slug" (input)="onSearch($event)" />
      </div>
    </div>

    <div class="adm-table og__table" role="table" aria-label="Organizations">
      <div class="adm-th" role="row">
        <span role="columnheader">Organization</span>
        <span role="columnheader" class="adm-cell--right adm-hide-sm">Members</span>
        <span role="columnheader" class="adm-cell--right adm-hide-md">Drawings</span>
        <span role="columnheader" class="adm-cell--right adm-hide-md">Storage</span>
        <span role="columnheader" class="adm-hide-lg">Owner</span>
      </div>
      @if (loading()) {
        @for (i of [1, 2, 3, 4]; track i) {
          <div class="adm-tr adm-tr--static" role="row" aria-hidden="true">
            <span><ui-skeleton width="50%" height="14px" /></span>
            <span class="adm-hide-sm"><ui-skeleton width="24px" height="14px" /></span>
            <span class="adm-hide-md"><ui-skeleton width="24px" height="14px" /></span>
            <span class="adm-hide-md"><ui-skeleton width="44px" height="14px" /></span>
            <span class="adm-hide-lg"><ui-skeleton width="70%" height="14px" /></span>
          </div>
        }
      } @else if (rows().length === 0) {
        <ui-empty-state icon="building" heading="No organizations" description="Nobody has created a shared workspace yet." />
      } @else {
        @for (row of rows(); track row.id) {
          <button type="button" class="adm-tr" [class.adm-tr--open]="openId() === row.id" role="row" [attr.aria-expanded]="openId() === row.id" (click)="toggle(row)">
            <span class="adm-two" role="cell">
              <span>{{ row.name }}</span>
              <span class="adm-mono">{{ row.slug }}</span>
            </span>
            <span class="adm-cell--right adm-cell--dim adm-hide-sm" role="cell">{{ row.memberCount }}</span>
            <span class="adm-cell--right adm-cell--dim adm-hide-md" role="cell">{{ row.drawingCount }}</span>
            <span class="adm-cell--right adm-cell--dim adm-hide-md" role="cell">{{ row.bytesUsed | fileSize }}</span>
            <span class="adm-cell--dim adm-truncate adm-hide-lg" role="cell">{{ row.ownerEmail ?? 'no owner' }}</span>
          </button>

          @if (openId() === row.id) {
            <div class="adm-detail">
              @if (detail(); as d) {
                <div class="adm-row adm-row--between">
                  <dl class="adm-facts og__facts">
                    <div><dt>Join code</dt><dd class="adm-mono">{{ d.joinCode }}</dd></div>
                    <div><dt>Created</dt><dd>{{ d.createdAt | relativeTime }}</dd></div>
                  </dl>
                  @if (canManage()) {
                    <div class="adm-actions">
                      <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="rename(d)">Rename</button>
                      <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="transfer(d)">Transfer ownership</button>
                      <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="rotate(d)">Rotate join code</button>
                    </div>
                  } @else {
                    <span class="adm-muted">Changing an organization needs the admin tier.</span>
                  }
                </div>

                <div class="adm-grid-halves">
                  <div class="adm-stack">
                    <p class="adm-kicker">Members</p>
                    <div class="adm-table adm-card--flush">
                      @for (member of d.members; track member.userId) {
                        <a class="adm-list__row adm-link--quiet" [routerLink]="['/admin/users', member.userId]" style="text-decoration:none">
                          <span class="adm-two adm-grow"><span>{{ member.name || member.email }}</span><span>{{ member.email }}</span></span>
                          <ui-badge [tone]="member.role === 'owner' ? 'info' : 'neutral'">{{ member.role }}</ui-badge>
                          <span class="adm-muted">joined {{ member.joinedAt | relativeTime }}</span>
                        </a>
                      }
                    </div>
                  </div>
                  @if (d.invites.length) {
                    <div class="adm-stack">
                      <p class="adm-kicker">Pending invites</p>
                      <div class="adm-table adm-card--flush">
                        @for (invite of d.invites; track invite.id) {
                          <div class="adm-list__row">
                            <span class="adm-grow adm-truncate">{{ invite.email }}</span>
                            <ui-badge>{{ invite.role }}</ui-badge>
                            <span class="adm-muted">expires {{ invite.expiresAt | relativeTime }}</span>
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <ui-skeleton height="18px" [lines]="3" />
              }
            </div>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      :host { display: contents; }
      .og__table { --adm-cols: minmax(220px, 2fr) 90px 90px 100px 220px; }
      @media (max-width: 1100px) { .og__table { --adm-cols: minmax(220px, 2fr) 90px 90px 100px; } }
      @media (max-width: 900px) { .og__table { --adm-cols: minmax(180px, 2fr) 90px; } }
      @media (max-width: 720px) { .og__table { --adm-cols: minmax(0, 1fr); } }
      .og__facts { grid-template-columns: repeat(2, max-content); gap: var(--ui-space-2) var(--ui-space-8); }
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
