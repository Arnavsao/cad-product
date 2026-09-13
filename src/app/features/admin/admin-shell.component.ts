import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { MeService } from '../../core/api/me.service';
import { PlatformRole } from '../../core/api/api.models';
import { AccountButtonComponent, UiIconComponent, UiLogoComponent, type UiIconName } from '../../shared/ui';
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

/**
 * Ranks, mirroring `PLATFORM_RANK` on the server. Duplicated rather than
 * shared because the two live in different build graphs; the server's copy is
 * the one that decides anything, this one only hides links.
 */
const RANK: Record<PlatformRole, number> = { user: 0, support: 1, admin: 2, owner: 3 };

const NAV: readonly AdminNavItem[] = [
  { path: '/admin', label: 'Overview', icon: 'home', minRole: 'support', exact: true },
  { path: '/admin/users', label: 'Users', icon: 'users', minRole: 'support' },
  { path: '/admin/feedback', label: 'Feedback', icon: 'message', minRole: 'support' },
  { path: '/admin/flags', label: 'Feature flags', icon: 'settings', minRole: 'support' },
  { path: '/admin/staff', label: 'Staff', icon: 'shield', minRole: 'admin' },
  { path: '/admin/audit', label: 'Audit log', icon: 'history', minRole: 'admin' },
  { path: '/admin/system', label: 'System', icon: 'wrench', minRole: 'support' },
];

/**
 * The admin portal's chrome.
 *
 * Structurally the dashboard shell — same 48px header row, same rail width,
 * same tokens — because a staff member moves between the two all day and a
 * second visual language would only slow that down. What differs is deliberate:
 * an accent-tinted brand bar, so nobody mistakes a screenshot of the portal for
 * the product, and a rail that hides what the signed-in tier cannot use.
 *
 * The rail is a *convenience*, not a control: the API refuses anything above
 * the caller's tier regardless of what is rendered here.
 */
@Component({
  selector: 'app-admin-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet, AccountButtonComponent, UiIconComponent, UiLogoComponent],
  template: `
    <div class="adm">
      <div class="adm__brand">
        <a class="adm__brandLink" routerLink="/admin" aria-label="CADO admin">
          <ui-logo [size]="22" />
          <span class="adm__brandName">{{ appName }}</span>
          <span class="adm__badge">Admin</span>
        </a>
      </div>

      <header class="adm__top">
        <span class="adm__section">{{ sectionLabel() }}</span>
        <div class="adm__actions">
          <span class="adm__role" [title]="'Your staff tier'">{{ role() }}</span>
          <a class="adm__action" routerLink="/dashboard" title="Back to the app">
            <ui-icon name="back" [size]="16" />
            <span>App</span>
          </a>
          <app-account-button />
        </div>
      </header>

      <nav class="adm__nav" aria-label="Admin sections">
        @for (item of visibleNav(); track item.path) {
          <a
            class="adm__navItem"
            [class.adm__navItem--active]="isActive(item)"
            [routerLink]="item.path"
            [attr.aria-current]="isActive(item) ? 'page' : null"
          >
            <ui-icon [name]="item.icon" [size]="16" />
            <span>{{ item.label }}</span>
          </a>
        }
      </nav>

      <main class="adm__content">
        <router-outlet />
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

  protected readonly visibleNav = computed(() => {
    const rank = RANK[this.role()];
    return NAV.filter((item) => rank >= RANK[item.minRole]);
  });

  protected readonly sectionLabel = computed(() => {
    const current = this.url().split('?')[0];
    const match = [...NAV]
      .sort((a, b) => b.path.length - a.path.length)
      .find((item) => (item.exact ? current === item.path : current.startsWith(item.path)));
    return match?.label ?? 'Admin';
  });

  protected isActive(item: AdminNavItem): boolean {
    const current = this.url().split('?')[0];
    return item.exact ? current === item.path : current.startsWith(item.path);
  }
}
