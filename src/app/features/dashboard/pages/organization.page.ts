import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AssignableOrgRole, OrgDetailDto, OrgInviteDto, OrgMemberDto, OrgRole } from '../../../core/api/api.models';
import type { DeleteOrganizationDialogData } from '../components/organization-dialogs.component';
import type { UiIconName } from '../../../shared/ui/icon.component';
import { MeService } from '../../../core/api/me.service';
import { OrganizationsApiService } from '../../../core/api/organizations-api.service';
import { WorkspaceService } from '../../../core/api/workspace.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiCardComponent } from '../../../shared/ui/card.component';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { UiEmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import type { UiMenuItem } from '../../../shared/ui/menu/ui-menu.component';
import { UiMenuTriggerDirective } from '../../../shared/ui/menu/ui-menu-trigger.directive';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { DatePipe } from '@angular/common';
import { RelativeTimePipe } from '../../../shared/ui/pipes/relative-time.pipe';
import { messageOf } from '../data/drawings-list.store';

/** Longest name the server accepts (`MAX_ORG_NAME_LENGTH`). */
const MAX_ORG_NAME = 80;

/** The roles an owner can move somebody to, in rank order. */
const ROLE_CHOICES: readonly { id: OrgRole; label: string; icon: UiIconName }[] = [
  { id: 'viewer', label: 'Make viewer', icon: 'user' },
  { id: 'member', label: 'Make member', icon: 'user' },
  { id: 'admin', label: 'Make admin', icon: 'shield' },
  { id: 'owner', label: 'Make owner', icon: 'star' },
];

/** "an admin" / "a member" — for the confirmation toast. */
function article(role: OrgRole): string {
  return role === 'admin' || role === 'owner' ? 'an' : 'a';
}

/**
 * `/dashboard/organization` — the active organization's settings, members,
 * invites and join code.
 *
 * Design decisions:
 *
 * - **It follows the workspace switcher rather than taking an `:id`.** There is
 *   exactly one "current" organization in the UI, and giving this page its own
 *   id would let the two disagree — a members list for one org while the
 *   drawings list shows another. In the personal workspace it explains itself
 *   instead of 404ing.
 *
 * - **Every control is gated on the caller's own role**, which arrives with the
 *   org summary. The server is the authority (403 `ORG_FORBIDDEN`), so this is
 *   about not offering an action that would be refused.
 *
 * - **Leaving is a confirmation, not a menu item.** It changes which drawings
 *   the user can see, so it goes through `UiDialogService.confirm` with the
 *   danger styling that focuses Cancel.
 */
@Component({
  selector: 'app-organization-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UiButtonDirective,
    UiCardComponent,
    UiEmptyStateComponent,
    UiIconComponent,
    UiInputDirective,
    UiMenuTriggerDirective,
    UiSkeletonComponent,
    RelativeTimePipe,
    // `relativeTime` only formats past timestamps, so an invite expiry — which is
    // always in the future — needs a plain date.
    DatePipe,
  ],
  template: `
    <header class="pg__head">
      <h1 class="pg__title">{{ org()?.name ?? 'Organization' }}</h1>
      @if (org(); as o) {
        <p class="pg__sub">{{ o.memberCount }} {{ o.memberCount === 1 ? 'member' : 'members' }} · {{ o.drawingCount }} drawings</p>
      }
    </header>

    @if (!workspace.isOrg()) {
      <ui-empty-state
        icon="building"
        heading="You're in your personal workspace"
        description="Switch to an organization — or create one — to manage its members."
      />
    } @else if (loading()) {
      <ui-skeleton [lines]="4" height="60px" radius="var(--ui-radius-lg)" />
    } @else if (error(); as message) {
      <div class="pg__error" role="alert">
        <ui-icon name="alert" [size]="18" />
        <div>
          <p class="pg__error-title">This organization could not be loaded.</p>
          <p class="pg__error-msg">{{ message }}</p>
        </div>
        <button type="button" uiButton (click)="reload()"><ui-icon name="refresh" [size]="14" /> Retry</button>
      </div>
    } @else {
      <!-- ── settings ────────────────────────────────────────────────────── -->
      @if (canAdmin()) {
        <ui-card class="og__card">
          <header class="og__card-head">
            <h2 class="og__h2">Organization settings</h2>
          </header>

          <form class="og__invite-form" (submit)="saveName($event)">
            <input
              uiInput
              class="og__invite-input"
              type="text"
              aria-label="Organization name"
              [attr.maxlength]="maxName"
              [value]="name()"
              [disabled]="busy() === 'name'"
              (input)="onName($event)"
            />
            <button
              type="submit"
              uiButton
              variant="primary"
              [loading]="busy() === 'name'"
              [disabled]="!nameChanged() || busy() === 'name'"
            >
              Save name
            </button>
          </form>

          @if (isOwner()) {
            <p class="og__muted">
              Deleting the organization removes its drawings and folders for every member. This cannot be undone.
            </p>
            <button type="button" uiButton variant="danger" [disabled]="busy() === 'delete'" (click)="deleteOrg()">
              <ui-icon name="trash" [size]="14" />
              Delete organization
            </button>
          }
        </ui-card>
      }

      <!-- ── members ─────────────────────────────────────────────────────── -->
      <ui-card class="og__card">
        <header class="og__card-head">
          <h2 class="og__h2">Members</h2>
        </header>

        <ul class="og__members">
          @for (member of members(); track member.userId) {
            <li class="og__member">
              <span class="og__avatar" aria-hidden="true">
                @if (member.imageUrl) {
                  <img [src]="member.imageUrl" alt="" loading="lazy" decoding="async" />
                } @else {
                  {{ initials(member) }}
                }
              </span>
              <span class="og__member-text">
                <span class="og__member-name">
                  {{ displayName(member) }}
                  @if (member.userId === myUserId()) {
                    <span class="og__you">You</span>
                  }
                </span>
                <span class="og__member-mail">{{ member.email }}</span>
              </span>
              <span
                class="og__role"
                [class.og__role--owner]="member.role === 'owner'"
                [class.og__role--viewer]="member.role === 'viewer'"
              >
                {{ member.role }}
              </span>
              <span class="og__joined">Joined {{ member.joinedAt | relativeTime }}</span>

              @if (menuFor(member).length) {
                <button
                  type="button"
                  uiButton
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label="Member actions"
                  [disabled]="busy() === member.userId"
                  [uiMenuTrigger]="menuFor(member)"
                  menuAlign="end"
                  (uiMenuSelect)="onMemberAction($event.id, member)"
                >
                  <ui-icon name="more" [size]="16" />
                </button>
              } @else {
                <span class="og__no-menu"></span>
              }
            </li>
          }
        </ul>
      </ui-card>

      <!-- ── invites ─────────────────────────────────────────────────────── -->
      @if (canAdmin()) {
        <ui-card class="og__card">
          <header class="og__card-head">
            <h2 class="og__h2">Invite people</h2>
          </header>

          <form class="og__invite-form" (submit)="invite($event)">
            <input
              uiInput
              type="email"
              class="og__invite-input"
              placeholder="name@company.com"
              autocomplete="off"
              aria-label="Email address to invite"
              [value]="inviteEmail()"
              [disabled]="busy() === 'invite'"
              (input)="onInviteEmail($event)"
            />
            <select
              uiInput
              class="og__invite-role"
              aria-label="Role"
              [value]="inviteRole()"
              [disabled]="busy() === 'invite'"
              (change)="onInviteRole($event)"
            >
              <option value="viewer">Viewer</option>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              uiButton
              variant="primary"
              [loading]="busy() === 'invite'"
              [disabled]="!inviteValid() || busy() === 'invite'"
            >
              <ui-icon name="user-plus" [size]="14" />
              Send invite
            </button>
          </form>

          @if (!invites().length) {
            <p class="og__muted og__muted--tight">No invitations are waiting to be accepted.</p>
          } @else {
            <ul class="og__invites">
              @for (item of invites(); track item.id) {
                <li class="og__invite">
                  <ui-icon name="message" [size]="15" />
                  <span class="og__invite-mail">{{ item.email }}</span>
                  <span class="og__role" [class.og__role--viewer]="item.role === 'viewer'">{{ item.role }}</span>
                  <span class="og__joined">Expires {{ item.expiresAt | date: 'mediumDate' }}</span>
                  @if (item.token) {
                    <button type="button" uiButton variant="ghost" size="sm" (click)="copyInviteLink(item)">
                      <ui-icon name="link" [size]="14" />
                      Copy invite link
                    </button>
                  }
                  <button
                    type="button"
                    uiButton
                    variant="ghost"
                    size="sm"
                    [disabled]="busy() === item.id"
                    (click)="revoke(item)"
                  >
                    Revoke
                  </button>
                </li>
              }
            </ul>
          }
        </ui-card>
      }

      <!-- ── join code ───────────────────────────────────────────────────── -->
      @if (org()?.joinCode; as code) {
        <ui-card class="og__card">
          <header class="og__card-head">
            <h2 class="og__h2">Join code</h2>
          </header>
          <p class="og__muted">
            Anyone with this code can join as a member. Rotate it if it has been shared too widely.
          </p>
          <div class="og__code-row">
            <input uiInput class="og__code" type="text" readonly [value]="code" aria-label="Join code" />
            <button type="button" uiButton variant="secondary" (click)="copyCode(code)">
              <ui-icon name="copy" [size]="14" />
              Copy
            </button>
            <button type="button" uiButton variant="secondary" [disabled]="busy() === 'code'" (click)="rotateCode()">
              <ui-icon name="refresh" [size]="14" />
              Rotate
            </button>
          </div>
        </ui-card>
      }

      <!-- ── danger zone ─────────────────────────────────────────────────── -->
      <ui-card class="og__card">
        <header class="og__card-head">
          <h2 class="og__h2">Leave organization</h2>
        </header>
        <p class="og__muted">
          You will lose access to this organization's drawings. Anything you created stays with the organization.
        </p>
        <button type="button" uiButton variant="danger" [disabled]="busy() === 'leave'" (click)="leave()">
          <ui-icon name="log-out" [size]="14" />
          Leave {{ org()?.name }}
        </button>
      </ui-card>
    }
  `,
  styles: [
    `
      :host { display: block; }

      .pg__head { margin-bottom: var(--ui-space-5); }
      .pg__title { margin: 0; font-size: var(--ui-text-xl); font-weight: 600; letter-spacing: -.01em; color: var(--ui-text-strong); }
      .pg__sub { margin: 4px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .pg__error {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 14px 16px; border: 1px solid var(--ui-danger); border-radius: var(--ui-radius-lg);
        background: var(--ui-danger-tint);
      }
      .pg__error > ui-icon { color: var(--ui-danger); flex: 0 0 auto; }
      .pg__error > div { flex: 1; min-width: 0; }
      .pg__error-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .pg__error-msg { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .og__card { display: block; margin-bottom: var(--ui-space-4); }
      .og__card-head {
        display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-3);
        margin-bottom: var(--ui-space-3);
      }
      .og__h2 { margin: 0; font-size: var(--ui-text-base); font-weight: 600; color: var(--ui-text-strong); }
      .og__muted { margin: 0 0 var(--ui-space-3); font-size: var(--ui-text-sm); color: var(--ui-text-dim); line-height: var(--ui-leading); }

      .og__members, .og__invites { list-style: none; margin: 0; padding: 0; }

      /*
       * One grid for both lists so the role and date columns line up between
       * the Members and Pending-invites cards.
       */
      .og__member, .og__invite {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) 84px 150px 36px;
        align-items: center;
        gap: var(--ui-space-3);
        padding: 10px 0;
        border-bottom: 1px solid var(--ui-border);
      }
      .og__member:last-child, .og__invite:last-child { border-bottom: 0; }
      /* One more trailing column than a member row: Copy invite link, then Revoke. */
      .og__invite { grid-template-columns: auto minmax(0, 1fr) 84px 150px auto auto; }
      .og__invite > ui-icon { color: var(--ui-text-dim); }
      .og__invite-mail { min-width: 0; font-size: var(--ui-text-md); color: var(--ui-text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .og__avatar {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 32px; height: 32px; overflow: hidden;
        border-radius: var(--ui-radius-full);
        background: var(--ui-accent-tint); color: var(--ui-accent);
        font-size: var(--ui-text-sm); font-weight: 700;
      }
      .og__avatar img { width: 100%; height: 100%; object-fit: cover; }

      .og__member-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .og__member-name {
        display: flex; align-items: center; gap: var(--ui-space-2);
        font-size: var(--ui-text-md); font-weight: 500; color: var(--ui-text-strong);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .og__member-mail { font-size: var(--ui-text-sm); color: var(--ui-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .og__you {
        flex: 0 0 auto; padding: 1px 6px;
        font-size: var(--ui-text-xs); font-weight: 600;
        color: var(--ui-accent); background: var(--ui-accent-tint);
        border-radius: var(--ui-radius-full);
      }

      .og__role {
        justify-self: start;
        padding: 2px 8px;
        font-size: var(--ui-text-xs); font-weight: 600; text-transform: capitalize;
        color: var(--ui-text); background: var(--ui-surface);
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-full);
      }
      .og__role--owner { color: var(--ui-accent); border-color: var(--ui-accent); background: var(--ui-accent-tint); }
      /* A viewer is the *absence* of write access, so the chip recedes. */
      .og__role--viewer { color: var(--ui-text-dim); background: transparent; }
      .og__joined { font-size: var(--ui-text-sm); color: var(--ui-text-dim); white-space: nowrap; }
      .og__no-menu { display: block; }

      .og__invite-form {
        display: flex; align-items: center; gap: var(--ui-space-2);
        margin-bottom: var(--ui-space-4); flex-wrap: wrap;
      }
      .og__invite-input { flex: 1 1 240px; min-width: 0; width: auto; }
      .og__invite-role { flex: 0 0 auto; width: auto; min-width: 110px; }
      .og__muted--tight { margin-bottom: 0; }

      .og__code-row { display: flex; align-items: center; gap: var(--ui-space-2); flex-wrap: wrap; }
      .og__code {
        width: auto; min-width: 160px; max-width: 220px;
        font-family: var(--ui-font-mono); letter-spacing: .16em; text-align: center;
      }

      /* The two metadata columns are the first to go on a narrow window. */
      @media (max-width: 860px) {
        .og__member, .og__invite { grid-template-columns: auto minmax(0, 1fr) auto; }
        .og__joined { display: none; }
      }
      @media (max-width: 620px) {
        .og__member, .og__invite { grid-template-columns: auto minmax(0, 1fr) auto; }
        .og__role { display: none; }
      }
    `,
  ],
})
export class OrganizationPage {
  protected readonly workspace = inject(WorkspaceService);
  private readonly api = inject(OrganizationsApiService);
  private readonly me = inject(MeService);
  private readonly dialog = inject(UiDialogService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly org = signal<OrgDetailDto | null>(null);
  protected readonly members = signal<OrgMemberDto[]>([]);
  protected readonly invites = signal<OrgInviteDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Id (user, invite, or a command name) with a request in flight. */
  protected readonly busy = signal<string | null>(null);

  protected readonly inviteEmail = signal('');
  protected readonly inviteRole = signal<AssignableOrgRole>('member');
  /** Deliberately loose: the server is the authority on address validity. */
  protected readonly inviteValid = computed(() => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.inviteEmail().trim()));

  protected readonly maxName = MAX_ORG_NAME;
  /** Edited copy of the org name, so Save is enabled only by a real change. */
  protected readonly name = signal('');
  protected readonly nameChanged = computed(() => {
    const next = this.name().trim();
    return next.length > 0 && next !== this.org()?.name;
  });

  protected readonly myUserId = computed(() => this.me.me()?.user.id ?? null);
  protected readonly canAdmin = computed(() => {
    const role = this.org()?.role;
    return role === 'admin' || role === 'owner';
  });
  protected readonly isOwner = computed(() => this.org()?.role === 'owner');

  private generation = 0;

  constructor() {
    // Reloads whenever the switcher changes workspace, so this page can never
    // show one organization's members while the rest of the shell shows another.
    effect(() => {
      const orgId = this.workspace.activeOrgId();
      untracked(() => {
        if (orgId) void this.reload();
        else this.clear();
      });
    });
  }

  protected async reload(): Promise<void> {
    const orgId = this.workspace.activeOrgId();
    if (!orgId) return;

    const gen = ++this.generation;
    this.loading.set(true);
    this.error.set(null);
    try {
      const [org, members] = await Promise.all([this.api.get(orgId), this.api.members(orgId)]);
      if (gen !== this.generation) return;
      this.org.set(org);
      this.name.set(org.name);
      this.members.set(members);
      // Invites are admin-only; asking as a plain member would be a certain 403.
      this.invites.set(
        org.role === 'admin' || org.role === 'owner' ? await this.api.invites(orgId).catch(() => []) : [],
      );
    } catch (e) {
      if (gen !== this.generation) return;
      this.clear();
      this.error.set(messageOf(e));
    } finally {
      if (gen === this.generation) this.loading.set(false);
    }
  }

  private clear(): void {
    this.org.set(null);
    this.members.set([]);
    this.invites.set([]);
  }

  // ── display helpers ───────────────────────────────────────────────────────

  protected displayName(member: OrgMemberDto): string {
    const full = [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
    return full || member.email;
  }

  protected initials(member: OrgMemberDto): string {
    const from = [member.firstName, member.lastName].filter((p): p is string => !!p);
    if (from.length) {
      return from.map((p) => p[0]!.toUpperCase()).join('');
    }
    return member.email[0]?.toUpperCase() ?? '?';
  }

  /**
   * Actions available on one row. Empty for a row nobody may act on, so the
   * kebab is not rendered at all rather than opening an empty menu.
   *
   * Role changes are owner-only (the server agrees: 403 `ORG_FORBIDDEN`), and
   * the role the member already holds is left out rather than shown ticked —
   * a menu of four items where one is a no-op reads as a choice that failed.
   */
  protected menuFor(member: OrgMemberDto): UiMenuItem[] {
    const items: UiMenuItem[] = [];
    const isSelf = member.userId === this.myUserId();

    if (this.isOwner() && !isSelf) {
      for (const role of ROLE_CHOICES) {
        if (role.id === member.role) continue;
        items.push({ id: `role:${role.id}`, label: role.label, icon: role.icon });
      }
    }
    if (!isSelf && this.canAdmin() && member.role !== 'owner') {
      if (items.length) items.push({ id: 'sep', label: '', separator: true });
      items.push({ id: 'remove', label: 'Remove from organization', icon: 'trash', danger: true });
    }
    return items;
  }

  // ── actions ───────────────────────────────────────────────────────────────

  protected async onMemberAction(action: string, member: OrgMemberDto): Promise<void> {
    const orgId = this.workspace.activeOrgId();
    if (!orgId || this.busy()) return;

    const role = action.startsWith('role:') ? (action.slice(5) as OrgRole) : null;

    if (action === 'remove') {
      const ok = await this.dialog.confirm({
        title: 'Remove member?',
        message: `${this.displayName(member)} will lose access to this organization's drawings.`,
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
    } else if (role === 'owner') {
      // Ownership is the one role that can then delete the organization, so it
      // is the one role change worth a confirmation.
      const ok = await this.dialog.confirm({
        title: `Make ${this.displayName(member)} an owner?`,
        message: 'They will be able to delete the organization and manage every member, including you.',
        confirmLabel: 'Make owner',
      });
      if (!ok) return;
    }

    this.busy.set(member.userId);
    try {
      if (action === 'remove') {
        await this.api.removeMember(orgId, member.userId);
        this.notify.success(`${this.displayName(member)} was removed.`);
      } else if (role) {
        await this.api.setMemberRole(orgId, member.userId, role);
        this.notify.success(`${this.displayName(member)} is now ${article(role)} ${role}.`);
      } else {
        return;
      }
      await this.reload();
      await this.workspace.refresh();
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.busy.set(null);
    }
  }

  // ── settings ──────────────────────────────────────────────────────────────

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected async saveName(event: Event): Promise<void> {
    event.preventDefault();
    const orgId = this.workspace.activeOrgId();
    const next = this.name().trim();
    if (!orgId || !this.nameChanged() || this.busy()) return;

    this.busy.set('name');
    try {
      const updated = await this.api.update(orgId, { name: next });
      this.org.update((o) => (o ? { ...o, name: updated.name } : o));
      this.notify.success('The organization was renamed.');
      // The switcher and every "Shared with" chip show this name.
      await this.workspace.refresh();
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.busy.set(null);
    }
  }

  /** Owner-only, behind a typed confirmation — see `DeleteOrganizationDialogComponent`. */
  protected async deleteOrg(): Promise<void> {
    const org = this.org();
    if (!org || !this.isOwner() || this.busy()) return;

    this.busy.set('delete');
    try {
      const { DeleteOrganizationDialogComponent } = await import('../components/organization-dialogs.component');
      const data: DeleteOrganizationDialogData = { id: org.id, name: org.name, drawingCount: org.drawingCount };
      const deleted = await this.dialog.open<boolean, DeleteOrganizationDialogData>(
        DeleteOrganizationDialogComponent,
        data,
        { width: '460px' },
      ).afterClosed;
      if (!deleted) return;
      this.workspace.forget(org.id);
      this.notify.success(`"${org.name}" was deleted.`);
      await this.router.navigateByUrl('/dashboard/drawings');
    } finally {
      this.busy.set(null);
    }
  }

  /** `${origin}/join/${token}` — the only delivery mechanism there is. */
  protected async copyInviteLink(item: OrgInviteDto): Promise<void> {
    if (!item.token) return;
    const url = `${location.origin}/join/${item.token}`;
    try {
      await navigator.clipboard.writeText(url);
      this.notify.success('Invite link copied — send it to them yourself.');
    } catch {
      this.notify.info(url, 10000);
    }
  }

  protected onInviteEmail(event: Event): void {
    this.inviteEmail.set((event.target as HTMLInputElement).value);
  }

  protected onInviteRole(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.inviteRole.set(value === 'admin' || value === 'viewer' ? value : 'member');
  }

  protected async invite(event: Event): Promise<void> {
    event.preventDefault();
    const orgId = this.workspace.activeOrgId();
    const email = this.inviteEmail().trim();
    if (!orgId || !this.inviteValid() || this.busy()) return;

    this.busy.set('invite');
    try {
      await this.api.invite(orgId, email, this.inviteRole());
      this.inviteEmail.set('');
      this.notify.success(`Invitation created for ${email}.`);
      await this.reload();
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.busy.set(null);
    }
  }

  protected async revoke(item: OrgInviteDto): Promise<void> {
    const orgId = this.workspace.activeOrgId();
    if (!orgId || this.busy()) return;
    this.busy.set(item.id);
    try {
      await this.api.revokeInvite(orgId, item.id);
      this.invites.update((list) => list.filter((i) => i.id !== item.id));
      this.notify.success(`Invitation to ${item.email} was revoked.`);
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.busy.set(null);
    }
  }

  protected async copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.notify.success('Join code copied.');
    } catch {
      // Clipboard access can be denied outright; the field is readable anyway.
      this.notify.info('Select the code and copy it manually.');
    }
  }

  protected async rotateCode(): Promise<void> {
    const orgId = this.workspace.activeOrgId();
    if (!orgId || this.busy()) return;
    const ok = await this.dialog.confirm({
      title: 'Rotate join code?',
      message: 'The current code stops working immediately. Members already in the organization are unaffected.',
      confirmLabel: 'Rotate code',
    });
    if (!ok) return;

    this.busy.set('code');
    try {
      const { joinCode } = await this.api.regenerateJoinCode(orgId);
      this.org.update((o) => (o ? { ...o, joinCode } : o));
      this.notify.success('A new join code was generated.');
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.busy.set(null);
    }
  }

  protected async leave(): Promise<void> {
    const orgId = this.workspace.activeOrgId();
    const userId = this.myUserId();
    if (!orgId || !userId || this.busy()) return;

    const ok = await this.dialog.confirm({
      title: `Leave ${this.org()?.name}?`,
      message: "You will lose access to this organization's drawings. Drawings you created stay with the organization.",
      confirmLabel: 'Leave',
      danger: true,
    });
    if (!ok) return;

    this.busy.set('leave');
    try {
      await this.api.removeMember(orgId, userId);
      this.workspace.forget(orgId);
      this.notify.success('You left the organization.');
      await this.router.navigateByUrl('/dashboard/drawings');
    } catch (e) {
      // The commonest failure is 409 LAST_OWNER, which is worth stating plainly.
      this.notify.error(messageOf(e));
    } finally {
      this.busy.set(null);
    }
  }
}
