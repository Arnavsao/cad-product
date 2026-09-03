import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { OrgSummaryDto } from '../../../core/api/api.models';
import { WorkspaceService } from '../../../core/api/workspace.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import type { UiMenuItem } from '../../../shared/ui/menu/ui-menu.component';
import { UiMenuTriggerDirective } from '../../../shared/ui/menu/ui-menu-trigger.directive';
import { DashboardEventsService } from '../data/dashboard-events.service';

/** Menu ids that are commands rather than a workspace to switch to. */
const CREATE = '__create';
const JOIN = '__join';
/** Prefix distinguishing an org id from the commands above. */
const ORG = 'org:';
/** The personal workspace. */
const PERSONAL = 'personal';

/**
 * Workspace picker at the top of the dashboard nav: Personal, then each
 * organization, then "Create" / "Join".
 *
 * Design decisions:
 *
 * - **Switching navigates to the workspace root.** Folder ids belong to one
 *   workspace, so staying on `/dashboard/folders/:id` after a switch would
 *   leave the page asking for a folder the new workspace does not contain (a
 *   404 the user did nothing to deserve). Going to My Drawings is the only
 *   destination that is always valid.
 *
 * - **It bumps `DashboardEventsService` as well as navigating.** A switch made
 *   while already on My Drawings does not change the URL, so the page would
 *   never re-run its load effect without the revision bump.
 *
 * - **Dialogs are lazy.** Create and Join are rare; loading them on demand
 *   keeps them out of the dashboard's initial chunk.
 */
@Component({
  selector: 'app-workspace-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIconComponent, UiMenuTriggerDirective],
  template: `
    <button
      type="button"
      class="ws"
      [uiMenuTrigger]="items()"
      menuAlign="start"
      aria-label="Switch workspace"
      (uiMenuSelect)="onSelect($event.id)"
    >
      <span class="ws__mark" aria-hidden="true">
        <ui-icon [name]="workspace.isOrg() ? 'building' : 'user'" [size]="14" />
      </span>
      <span class="ws__text">
        <span class="ws__line">
          <span class="ws__name">{{ workspace.activeName() }}</span>
          @if (workspace.activeRole(); as role) {
            <span class="ws__role" [class.ws__role--viewer]="role === 'viewer'">{{ role }}</span>
          }
        </span>
        <span class="ws__sub">{{ subtitle() }}</span>
      </span>
      <ui-icon class="ws__chev" name="chevron-up-down" [size]="14" />
    </button>
  `,
  styles: [
    `
      :host { display: block; }

      .ws {
        display: flex; align-items: center; gap: var(--ui-space-2);
        width: 100%; padding: 8px 10px;
        font: inherit; text-align: left;
        color: var(--ui-text);
        background: var(--ui-surface);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        cursor: pointer;
        transition: background var(--ui-dur-fast), border-color var(--ui-dur-fast);
      }
      .ws:hover { background: var(--ui-hover); border-color: var(--ui-border-strong); }
      .ws:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }

      .ws__mark {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 26px; height: 26px;
        border-radius: var(--ui-radius-sm);
        background: var(--ui-accent-tint); color: var(--ui-accent);
      }
      .ws__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .ws__line { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .ws__name {
        min-width: 0;
        font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      /*
       * The role decides what the rest of the dashboard will let you do, so it
       * belongs next to the name rather than only in the subtitle. A viewer's
       * chip is muted: it marks an absence of write access, not a rank.
       */
      .ws__role {
        flex: 0 0 auto; padding: 0 6px;
        font-size: var(--ui-text-xs); font-weight: 600; text-transform: capitalize;
        color: var(--ui-accent); background: var(--ui-accent-tint);
        border-radius: var(--ui-radius-full);
      }
      .ws__role--viewer { color: var(--ui-text-dim); background: var(--ui-hover); }
      .ws__sub {
        font-size: var(--ui-text-xs); color: var(--ui-text-dim);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ws__chev { flex: 0 0 auto; color: var(--ui-text-dim); }

      /* Collapsed rail: the label and chevron go, the mark stays as the target. */
      @media (max-width: 860px) {
        .ws { justify-content: center; padding: 8px; }
        .ws__text, .ws__chev { display: none; }
      }
    `,
  ],
})
export class WorkspaceSwitcherComponent {
  protected readonly workspace = inject(WorkspaceService);
  private readonly router = inject(Router);
  private readonly dialog = inject(UiDialogService);
  private readonly notify = inject(NotificationService);
  private readonly events = inject(DashboardEventsService);

  /** "Personal workspace", or "N members · your role". */
  protected readonly subtitle = computed(() => {
    const org = this.workspace.activeOrg();
    if (!org) return 'Personal workspace';
    const members = `${org.memberCount} ${org.memberCount === 1 ? 'member' : 'members'}`;
    return `${members} · ${org.role}`;
  });

  protected readonly items = computed<UiMenuItem[]>(() => {
    const activeId = this.workspace.activeOrgId();
    const orgs = this.workspace.organizations();

    const items: UiMenuItem[] = [
      {
        id: PERSONAL,
        label: 'Personal',
        icon: activeId === null ? 'check' : 'user',
      },
    ];

    if (orgs.length) {
      items.push({ id: 'sep-orgs', label: '', separator: true });
      for (const org of orgs) {
        items.push({
          id: ORG + org.id,
          label: org.name,
          // A tick marks the active workspace; the rest carry the org glyph.
          icon: org.id === activeId ? 'check' : 'building',
        });
      }
    }

    items.push(
      { id: 'sep-actions', label: '', separator: true },
      { id: CREATE, label: 'Create organization…', icon: 'plus' },
      { id: JOIN, label: 'Join with a code…', icon: 'link' },
    );
    return items;
  });

  protected onSelect(id: string): void {
    if (id === CREATE) {
      void this.createOrganization();
      return;
    }
    if (id === JOIN) {
      void this.joinOrganization();
      return;
    }
    if (id === PERSONAL) {
      this.switchTo(null);
      return;
    }
    if (id.startsWith(ORG)) {
      this.switchTo(id.slice(ORG.length));
    }
  }

  private switchTo(orgId: string | null): void {
    if (orgId === this.workspace.activeOrgId()) return;
    this.workspace.setActive(orgId);
    this.afterSwitch();
  }

  private async createOrganization(): Promise<void> {
    const { CreateOrganizationDialogComponent } = await import('./organization-dialogs.component');
    const org = await this.dialog.open<OrgSummaryDto>(CreateOrganizationDialogComponent, undefined, {
      width: '440px',
    }).afterClosed;
    if (!org) return;
    this.workspace.adopt(org);
    this.notify.success(`"${org.name}" created. You are now in that workspace.`);
    this.afterSwitch();
  }

  private async joinOrganization(): Promise<void> {
    const { JoinOrganizationDialogComponent } = await import('./organization-dialogs.component');
    const org = await this.dialog.open<OrgSummaryDto>(JoinOrganizationDialogComponent, undefined, {
      width: '440px',
    }).afterClosed;
    if (!org) return;
    this.workspace.adopt(org);
    this.notify.success(`You joined "${org.name}".`);
    this.afterSwitch();
  }

  /** Land on a route that exists in the new workspace, and force a reload. */
  private afterSwitch(): void {
    void this.router.navigateByUrl('/dashboard/drawings').then(() => this.events.bump());
  }
}
