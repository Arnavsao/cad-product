import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiGridBackdropComponent } from '../../shared/ui/grid-backdrop.component';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiLogoComponent } from '../../shared/ui/logo.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton.component';
import { MotionService } from './motion/motion.service';

interface NavLink {
  path: string;
  label: string;
}

/** Primary navigation, in the order it appears in the header. */
export const SITE_NAV: readonly NavLink[] = [
  { path: '/product', label: 'Product' },
  { path: '/features', label: 'Features' },
  { path: '/use-cases', label: 'Use cases' },
  { path: '/pricing', label: 'Pricing' },
  { path: '/docs', label: 'Docs' },
  { path: '/about', label: 'About' },
];

const DEFAULT_DESCRIPTION =
  'CADO is a browser-based 2D CAD editor: DXF in and out, layouts and plotting, blocks, dimensions, cloud drawings and an AI drafting assistant.';

/**
 * Chrome around every public page: fixed header, footer, drafting-grid backdrop
 * and the router outlet the pages render into.
 *
 * Design decisions:
 *  - **One shell, mounted once.** The public pages are children of this route,
 *    so the header does not re-render between pages, the brand can morph across
 *    view transitions, and the smooth-scroll instance survives navigation.
 *  - **Auth-aware, never auth-blocking.** Header actions render skeletons until
 *    the session is known and then settle; nothing here waits on Supabase.
 *  - **Scroll is reset per page** (the router's own restoration cannot see
 *    Lenis) and every ScrollTrigger is recomputed once the new page has laid out.
 *  - **Meta description follows the route** through `data.description`, so a
 *    shared link to /pricing previews as pricing rather than as the home page.
 */
@Component({
  selector: 'app-site-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    UiButtonDirective,
    UiGridBackdropComponent,
    UiIconComponent,
    UiLogoComponent,
    UiSkeletonComponent,
  ],
  templateUrl: './site-shell.component.html',
  styleUrl: './site-shell.component.scss',
})
export class SiteShellComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(SupabaseAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly meta = inject(Meta);
  private readonly motion = inject(MotionService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly appName = environment.appName;
  protected readonly year = new Date().getFullYear();
  protected readonly nav = SITE_NAV;

  protected readonly scrolled = signal(false);
  protected readonly menuOpen = signal(false);
  /** The landing page draws its own hero over the backdrop; others fade it higher. */
  protected readonly isHome = signal(true);

  protected readonly homeLink = computed(() => (this.auth.isSignedIn() ? '/dashboard' : '/'));

  private stopSmoothScroll: (() => void) | null = null;

  ngOnInit(): void {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => this.onNavigated(e.urlAfterRedirects));
    this.onNavigated(this.router.url);

    void this.motion.startSmoothScroll().then((stop) => {
      // The shell may have been destroyed while the library loaded.
      if (this.destroyed) stop();
      else this.stopSmoothScroll = stop;
    });
  }

  private destroyed = false;
  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopSmoothScroll?.();
    this.stopSmoothScroll = null;
    this.document.body.style.removeProperty('overflow');
  }

  @HostListener('window:scroll')
  protected onScroll(): void {
    const y = window.scrollY || this.document.documentElement.scrollTop;
    const next = y > 8;
    if (next !== this.scrolled()) this.scrolled.set(next);
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    if (this.menuOpen()) this.toggleMenu(false);
  }

  protected toggleMenu(open = !this.menuOpen()): void {
    this.menuOpen.set(open);
    // The drawer is fixed and full-height; the page must not scroll behind it.
    this.document.body.style.overflow = open ? 'hidden' : '';
  }

  private onNavigated(url: string): void {
    const path = url.split('?')[0].split('#')[0];
    this.isHome.set(path === '/' || path === '');
    if (this.menuOpen()) this.toggleMenu(false);

    const fragment = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
    if (fragment) {
      // Give the new page a frame to render, then land on the anchor.
      requestAnimationFrame(() => {
        const target = this.document.getElementById(fragment);
        if (target) this.motion.scrollToElement(target);
      });
    } else {
      this.motion.scrollToTop();
    }
    this.motion.refresh();

    // Deepest child route's data wins.
    let snapshot = this.route.snapshot;
    while (snapshot.firstChild) snapshot = snapshot.firstChild;
    const description = (snapshot.data['description'] as string | undefined) ?? DEFAULT_DESCRIPTION;
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ name: 'twitter:description', content: description });
  }
}
