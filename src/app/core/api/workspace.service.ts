import { Injectable, computed, inject, signal } from '@angular/core';
import { MeDto, OrgSummaryDto } from './api.models';
import { MeService } from './me.service';
import { OrganizationsApiService } from './organizations-api.service';

/** localStorage key holding the last active workspace (`''` = personal). */
const ACTIVE_KEY = 'cad.dash.workspace';

/**
 * Which workspace the dashboard is looking at, and the list of workspaces
 * available to switch to.
 *
 * Design decisions:
 *
 * - **One id, not a mode flag.** `activeOrgId` is either `null` (personal) or an
 *   org id, which is exactly the shape every API call wants for its
 *   `organizationId` parameter. Callers pass `activeOrgId()` straight through
 *   instead of branching.
 *
 * - **Hydrated from `/me`, not a second request.** `MeDto.organizations` already
 *   arrives with the profile the shell has to load anyway, so the switcher
 *   renders on first paint. `refresh()` re-reads just the org list after a
 *   create/join/leave.
 *
 * - **The stored choice is validated against membership.** A remembered org id
 *   is only restored if it is still in the list — otherwise leaving an org (or
 *   being removed from one) would leave the dashboard pointed at a workspace
 *   that answers 404 for everything, with no obvious way back.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private readonly me = inject(MeService);
  private readonly api = inject(OrganizationsApiService);

  readonly organizations = signal<OrgSummaryDto[]>([]);

  /** `null` = the personal workspace. */
  readonly activeOrgId = signal<string | null>(null);

  /** The active org, or `null` when in the personal workspace. */
  readonly activeOrg = computed<OrgSummaryDto | null>(() => {
    const id = this.activeOrgId();
    return id === null ? null : (this.organizations().find((o) => o.id === id) ?? null);
  });

  /** Label for the switcher button. */
  readonly activeName = computed(() => this.activeOrg()?.name ?? 'Personal');

  /** True while looking at an organization. */
  readonly isOrg = computed(() => this.activeOrgId() !== null);

  /** The caller's role in the active org; `null` when personal. */
  readonly activeRole = computed(() => this.activeOrg()?.role ?? null);

  /** True when the active workspace lets the user manage members and invites. */
  readonly canAdminister = computed(() => {
    const role = this.activeRole();
    return role === 'admin' || role === 'owner';
  });

  /** Seed the list from a `/me` payload and restore the remembered choice. */
  hydrate(me: MeDto): void {
    this.organizations.set(me.organizations ?? []);
    this.restoreActive();
  }

  /** Re-read the org list from the API (after create / join / leave / rename). */
  async refresh(): Promise<void> {
    this.organizations.set(await this.api.list());
    // Also drops the org from the cached `/me`, so a later reload agrees.
    this.me.invalidate();
    this.restoreActive();
  }

  /**
   * Switch workspace. Ignores an org the user is not a member of, so a stale
   * link or a hand-edited storage value cannot strand the dashboard.
   */
  setActive(orgId: string | null): void {
    if (orgId !== null && !this.organizations().some((o) => o.id === orgId)) {
      return;
    }
    this.activeOrgId.set(orgId);
    try {
      localStorage.setItem(ACTIVE_KEY, orgId ?? '');
    } catch {
      /* private mode / storage disabled — the choice just does not persist. */
    }
  }

  /** Adopt a newly created or joined org and switch into it. */
  adopt(org: OrgSummaryDto): void {
    this.organizations.update((list) => [org, ...list.filter((o) => o.id !== org.id)]);
    this.me.invalidate();
    this.setActive(org.id);
  }

  /** Forget an org the user just left, falling back to the personal workspace. */
  forget(orgId: string): void {
    this.organizations.update((list) => list.filter((o) => o.id !== orgId));
    this.me.invalidate();
    if (this.activeOrgId() === orgId) {
      this.setActive(null);
    }
  }

  private restoreActive(): void {
    const stored = readStored();
    // Membership decides: an id we no longer belong to falls back to personal.
    const valid = stored !== null && this.organizations().some((o) => o.id === stored);
    this.activeOrgId.set(valid ? stored : null);
  }
}

/** `null` for personal (or unreadable storage); an org id otherwise. */
function readStored(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}
