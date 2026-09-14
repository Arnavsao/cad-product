import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { MeService } from '../../core/api/me.service';
import { PlatformRole } from '../../core/api/api.models';
import {
  AccountButtonComponent,
  UiButtonDirective,
  UiIconComponent,
  UiLogoComponent,
  type UiIconName,
} from '../../shared/ui';
import { environment } from '../../../environments/environment';

/** One entry in the portal's left rail. */
interface AdminNavItem {
  path: string;
  label: string;
  icon: UiIconName;
  /** Lowest staff tier that can use the page; the rail hides the rest. */
  minRole: PlatformRole;
  /** Matches only the exact path, for the index route. */
  exact?: boolean;
}

/** Links grouped the way the work is grouped, with a small label over each. */
interface AdminNavGroup {
  label: string | null;
  items: readonly AdminNavItem[];
}

/**
 * Ranks, mirroring `PLATFORM_RANK` on the server. Duplicated rather than
 * shared because the two live in different build graphs; the server's copy is
 * the one that decides anything, this one only hides links.
 */
const RANK: Record<PlatformRole, number> = { user: 0, support: 1, admin: 2, owner: 3 };

const NAV: readonly AdminNavGroup[] = [
  {
    label: null,
    items: [{ path: '/admin', label: 'Overview', icon: 'home', minRole: 'support', exact: true }],
  },
  {
    label: 'People',
    items: [
      { path: '/admin/users', label: 'Users', icon: 'users', minRole: 'support' },
      { path: '/admin/organizations', label: 'Organizations', icon: 'building', minRole: 'support' },
      { path: '/admin/feedback', label: 'Feedback', icon: 'message', minRole: 'support' },
    ],
  },
  {
    label: 'Content',
    items: [
      { path: '/admin/drawings', label: 'Drawings', icon: 'file', minRole: 'support' },
      { path: '/admin/announcements', label: 'Announcements', icon: 'bell', minRole: 'support' },
      { path: '/admin/campaigns', label: 'Campaigns', icon: 'mail', minRole: 'admin' },
    ],
  },
  {
    label: 'Money',
    items: [{ path: '/admin/billing', label: 'Billing', icon: 'tag', minRole: 'support' }],
  },
  {
    label: 'Operate',
    items: [
      { path: '/admin/jobs', label: 'Scheduled jobs', icon: 'clock', minRole: 'support' },
      { path: '/admin/flags', label: 'Feature flags', icon: 'settings', minRole: 'support' },
      { path: '/admin/staff', label: 'Staff', icon: 'shield', minRole: 'admin' },
      { path: '/admin/audit', label: 'Audit log', icon: 'history', minRole: 'admin' },
      { path: '/admin/system', label: 'System', icon: 'wrench', minRole: 'support' },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

/**
 * The admin portal's chrome.
 *
 * Built to the dashboard shell's measurements — the same 290px rail, 48px
 * header row, content padding and link styling — because a staff member moves
 * between the two all day and a second visual language would only slow that
 * down. Fifteen pages are more than a flat list carries well, so the rail
 * groups them by the kind of work, the way the dashboard separates its create
 * actions from its navigation.
 *
 * What differs is deliberate and small: an "Admin" mark beside the brand, so a
 * screenshot of the portal is never mistaken for the product, and a role pill
 * in the header. The rail hides what the signed-in tier cannot use; that is a
 * convenience, not a control — the API refuses anything above the caller's
 * tier regardless of what is rendered here.
 */
@Component({
  selector: 'app-admin-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet, AccountButtonComponent, UiButtonDirective, UiIconComponent, UiLogoComponent],
  template: `
    <div class="adm">
      <div class="adm__brand">
        <a class="brand" routerLink="/admin" aria-label="CADO admin">
          <span class="brand__mark" aria-hidden="true"><ui-logo [size]="16" /></span>
          <span class="brand__name">{{ appName }}</span>
          <span class="brand__badge">Admin</span>
        </a>
      </div>

      <header class="adm__top">
        <h1 class="adm__section">{{ sectionLabel() }}</h1>
        <div class="adm__actions">
          <span class="adm__role" title="Your staff tier">{{ role() }}</span>
          <a uiButton variant="ghost" size="sm" routerLink="/dashboard" class="adm__back">
            <ui-icon name="back" [size]="16" />
            <span class="adm__back-label">Back to app</span>
          </a>
          <app-account-button />
        </div>
      </header>

      <nav class="adm__nav" aria-label="Admin sections">
        @for (group of visibleNav(); track group.label) {
          <div class="adm__group">
            @if (group.label) {
              <p class="adm__group-label">{{ group.label }}</p>
            }
            <ul class="adm__links">
              @for (item of group.items; track item.path) {
                <li>
                  <a
                    class="adm__link"
                    [class.adm__link--on]="isActive(item)"
                    [routerLink]="item.path"
                    [attr.aria-current]="isActive(item) ? 'page' : null"
                    [title]="item.label"
                  >
                    <ui-icon [name]="item.icon" [size]="16" />
                    <span class="adm__link-label">{{ item.label }}</span>
                  </a>
                </li>
              }
            </ul>
          </div>
        }
      </nav>

      <main class="adm__content">
        <div class="ui-page adm-page">
          <router-outlet />
        </div>
      </main>
    </div>
  `,
  styleUrl: './admin-shell.component.scss',
})
export class AdminShellComponent {
  private readonly router = inject(Router);
  private readonly me = inject(MeService);

  protected readonly appName = environment.appName;

  /** Current URL, refreshed on every completed navigation. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly role = computed<PlatformRole>(() => this.me.me()?.user.platformRole ?? 'user');

  protected readonly visibleNav = computed<AdminNavGroup[]>(() => {
    const rank = RANK[this.role()];
    return NAV.map((g) => ({ ...g, items: g.items.filter((item) => rank >= RANK[item.minRole]) })).filter(
      (g) => g.items.length > 0,
    );
  });

  protected readonly sectionLabel = computed(() => {
    const current = this.url().split('?')[0];
    const match = [...ALL_ITEMS]
      .sort((a, b) => b.path.length - a.path.length)
      .find((item) => (item.exact ? current === item.path : current.startsWith(item.path)));
    return match?.label ?? 'Admin';
  });

  protected isActive(item: AdminNavItem): boolean {
    const current = this.url().split('?')[0];
    return item.exact ? current === item.path : current.startsWith(item.path);
  }
}
