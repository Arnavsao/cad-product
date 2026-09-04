import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiGridBackdropComponent } from '../../shared/ui/grid-backdrop.component';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiLogoComponent } from '../../shared/ui/logo.component';
import { UiRevealDirective } from '../../shared/ui/reveal.directive';
import { UiSkeletonComponent } from '../../shared/ui/skeleton.component';

/** Plan geometry, in the hero SVG's own viewBox units. */
const SHEET_W = 960;
const SHEET_H = 600;
/** The plan's origin corner — bottom-left of the outer wall. */
const PLAN_X0 = 140;
const PLAN_Y0 = 480;
/** One viewBox unit is 10mm, which makes the outer wall a round 7000 × 3400. */
const MM_PER_UNIT = 10;

/**
 * Public landing page (`/`).
 *
 * Static content so it paints before auth has loaded; the call-to-action area
 * renders skeletons until `isLoaded()` and then shows Sign in / Create account,
 * or — in embedded mode — a single "Open editor". Signed-in visitors are
 * forwarded to the dashboard.
 *
 * The hero is a CAD viewport rather than a decorated headline: a floor plan
 * that draws itself in drafting order as it scrolls in, over the grid, with the
 * editor's own vocabulary as the ornament — snap markers, dimension lines whose
 * measurements count up, a coordinate readout and a command prompt. All of it
 * is CSS (see `blueprint.scss`); the only script is the pointer readout below.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiButtonDirective,
    UiGridBackdropComponent,
    UiIconComponent,
    UiLogoComponent,
    UiRevealDirective,
    UiSkeletonComponent,
  ],
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.scss',
})
export class LandingPage implements AfterViewInit, OnDestroy {
  protected readonly auth = inject(SupabaseAuthService);
  private readonly router = inject(Router);

  protected readonly appName = environment.appName;
  protected readonly year = new Date().getFullYear();

  /**
   * Screen capture of the real editor, when one has been added to `public/`.
   * Null until then, and the section renders a marked placeholder rather than a
   * `<video>` pointing at a 404 — a broken player says less than an honest gap.
   */
  protected readonly demoVideo: string | null = null;
  protected readonly demoPoster: string | null = null;

  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  private readonly coordX = viewChild<ElementRef<HTMLElement>>('coordX');
  private readonly coordY = viewChild<ElementRef<HTMLElement>>('coordY');

  private frame = 0;
  private detach: (() => void) | null = null;

  constructor() {
    effect(() => {
      if (this.auth.isLoaded() && this.auth.isSignedIn()) {
        void this.router.navigateByUrl('/dashboard', { replaceUrl: true });
      }
    });
  }

  /**
   * Live coordinate readout.
   *
   * Written straight to the two text nodes instead of through a signal: the app
   * runs zoneless, and a pointer stream re-rendering the hero on every move
   * would be change detection at input rate for two numbers that no other
   * binding depends on. One rAF coalesces a burst of moves into a single write.
   */
  ngAfterViewInit(): void {
    const sheet = this.sheet()?.nativeElement;
    const xEl = this.coordX()?.nativeElement;
    const yEl = this.coordY()?.nativeElement;
    if (!sheet || !xEl || !yEl) return;

    let pending: PointerEvent | null = null;

    const flush = (): void => {
      this.frame = 0;
      const event = pending;
      pending = null;
      if (!event) return;

      const rect = sheet.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      // Pointer -> viewBox units -> plan millimetres, Y counted upwards the way
      // a drafter reads it rather than the way the screen does.
      const u = ((event.clientX - rect.left) / rect.width) * SHEET_W;
      const v = ((event.clientY - rect.top) / rect.height) * SHEET_H;
      xEl.textContent = ((u - PLAN_X0) * MM_PER_UNIT).toFixed(1);
      yEl.textContent = ((PLAN_Y0 - v) * MM_PER_UNIT).toFixed(1);
    };

    const onMove = (event: PointerEvent): void => {
      pending = event;
      this.frame ||= requestAnimationFrame(flush);
    };

    sheet.addEventListener('pointermove', onMove, { passive: true });
    this.detach = () => sheet.removeEventListener('pointermove', onMove);
  }

  ngOnDestroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.detach?.();
  }
}
