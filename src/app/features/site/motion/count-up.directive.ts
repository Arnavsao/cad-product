import { AfterViewInit, DestroyRef, Directive, ElementRef, inject, input, numberAttribute } from '@angular/core';
import { MotionService } from './motion.service';

/**
 * Counts the host's text up to a number the first time it scrolls into view.
 *
 * ```html
 * <span siteCountUp="14"></span>
 * <span siteCountUp="465" countSuffix="+"></span>
 * ```
 *
 * Plain `requestAnimationFrame` rather than GSAP: a number ticking up needs no
 * library, and this directive is also used on pages that never load one. The
 * final value is rendered immediately under reduced motion or without
 * `IntersectionObserver`, so the number is never missing.
 */
@Directive({ selector: '[siteCountUp]', standalone: true })
export class SiteCountUpDirective implements AfterViewInit {
  readonly target = input.required<number, unknown>({ alias: 'siteCountUp', transform: numberAttribute });
  readonly prefix = input('', { alias: 'countPrefix' });
  readonly suffix = input('', { alias: 'countSuffix' });
  readonly decimals = input(0, { alias: 'countDecimals', transform: numberAttribute });
  readonly duration = input(1400, { alias: 'countDuration', transform: numberAttribute });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly motion = inject(MotionService);
  private readonly destroyRef = inject(DestroyRef);
  private frame = 0;

  ngAfterViewInit(): void {
    const el = this.host.nativeElement;
    this.render(0);

    if (this.motion.reduced() || typeof IntersectionObserver === 'undefined') {
      this.render(this.target());
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        this.run();
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    this.destroyRef.onDestroy(() => {
      observer.disconnect();
      cancelAnimationFrame(this.frame);
    });
  }

  private run(): void {
    const start = performance.now();
    const to = this.target();
    const ms = Math.max(200, this.duration());
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / ms);
      // Decelerating ease-out: the last digits settle rather than snap.
      const eased = 1 - Math.pow(1 - t, 3);
      this.render(to * eased);
      if (t < 1) this.frame = requestAnimationFrame(step);
      else this.render(to);
    };
    this.frame = requestAnimationFrame(step);
  }

  private render(value: number): void {
    const formatted = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: this.decimals(),
      maximumFractionDigits: this.decimals(),
    }).format(value);
    this.host.nativeElement.textContent = `${this.prefix()}${formatted}${this.suffix()}`;
  }
}
