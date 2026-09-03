import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';

/**
 * Indeterminate progress bar for route transitions.
 *
 * Every route in this app is lazy (`loadComponent`), and the two biggest chunks —
 * the editor and the Supabase SDK — are large, so a click could sit with no
 * feedback at all while the chunk downloaded. This bridges that gap.
 *
 * Two deliberate choices:
 *  - **Indeterminate, not a percentage.** The router reports no byte progress, so
 *    a numeric bar would be fiction. The bar animates across and is removed on
 *    arrival.
 *  - **Delayed appearance.** Showing instantly makes fast, already-prefetched
 *    navigations flash a bar for ~50ms, which reads as jank. Nothing renders
 *    until a navigation has been pending for `SHOW_AFTER_MS`.
 */
const SHOW_AFTER_MS = 150;

@Component({
  selector: 'app-route-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="rp" role="status" aria-live="polite" aria-label="Loading page">
        <div class="rp__bar"></div>
      </div>
    }
  `,
  styles: [`
    .rp {
      position: fixed;
      inset: 0 0 auto 0;
      height: 2px;
      /* Above app chrome (the editor root sits at 1000) but below modals. */
      z-index: 2000;
      overflow: hidden;
      background: color-mix(in srgb, var(--ui-accent, #4c9aff) 22%, transparent);
      pointer-events: none;
    }

    .rp__bar {
      width: 40%;
      height: 100%;
      background: var(--ui-accent, #4c9aff);
      border-radius: 0 2px 2px 0;
      animation: rp-slide 1.1s ease-in-out infinite;
    }

    @keyframes rp-slide {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(350%); }
    }

    /* Keep the affordance, drop the motion. */
    @media (prefers-reduced-motion: reduce) {
      .rp__bar { animation: none; width: 100%; opacity: .65; }
    }
  `],
})
export class RouteProgressComponent {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly visible = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.scheduleShow();
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.hide();
      }
    });

    // A navigation in flight when this component is torn down would otherwise
    // leave the timer pending.
    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  private scheduleShow(): void {
    if (this.visible() || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.visible.set(true);
    }, SHOW_AFTER_MS);
  }

  private hide(): void {
    this.clearTimer();
    this.visible.set(false);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
