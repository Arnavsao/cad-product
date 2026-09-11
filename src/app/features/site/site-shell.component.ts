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
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
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
  /** Translation key of the link text. */
  labelKey: string;
}

/** Primary navigation, in the order it appears in the header. */
export const SITE_NAV: readonly NavLink[] = [
  { path: '/product', labelKey: 'site.shell.nav.product' },
  { path: '/features', labelKey: 'site.shell.nav.features' },
  { path: '/use-cases', labelKey: 'site.shell.nav.useCases' },
  { path: '/pricing', labelKey: 'site.shell.nav.pricing' },
  { path: '/docs', labelKey: 'site.shell.nav.docs' },
  { path: '/about', labelKey: 'site.shell.nav.about' },
];

/** Meta description when a child route declares none. */
const DEFAULT_DESCRIPTION_KEY = 'site.shell.meta.defaultDescription';

/**
 * Route data the shell reads from the deepest activated child. Both hold
 * translation keys; the shell resolves them and re-resolves on a language
 * change, so neither the document title nor the meta description is ever
 * stored in English in `app.routes.ts`.
 */
export interface SiteRouteData {
  titleKey?: string;
  descriptionKey?: string;
}

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
 *  - **Title and meta description follow the route** through
 *    `data.titleKey` / `data.descriptionKey`, resolved with Transloco, so a
 *    shared link to /pricing previews as pricing rather than as the home page
 *    and both re-render when the language changes.
 */
@Component({
  selector: 'app-site-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslocoDirective,
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
  private readonly titleService = inject(Title);
  private readonly transloco = inject(TranslocoService);
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
  private metaSub: Subscription | null = null;

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
    this.metaSub?.unsubscribe();
    this.metaSub = null;
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
    const data = snapshot.data as SiteRouteData;
    this.applyRouteMeta(data.titleKey, data.descriptionKey ?? DEFAULT_DESCRIPTION_KEY);
  }

  /**
   * Resolves the route's title and description keys and keeps them current:
   * `selectTranslate` emits again when the language changes, so the tab title
   * and the meta tags follow the language picker without a navigation.
   */
  private applyRouteMeta(titleKey: string | undefined, descriptionKey: string): void {
    this.metaSub?.unsubscribe();
    const keys = titleKey ? [titleKey, descriptionKey] : [descriptionKey];
    this.metaSub = this.transloco.selectTranslate<string[]>(keys).subscribe((values) => {
      const description = values[values.length - 1];
      if (titleKey) this.titleService.setTitle(values[0]);
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ property: 'og:description', content: description });
      this.meta.updateTag({ name: 'twitter:description', content: description });
    });
  }
}
