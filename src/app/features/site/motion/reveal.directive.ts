import { AfterViewInit, DestroyRef, Directive, ElementRef, inject, input, numberAttribute } from '@angular/core';
import { MotionService } from './motion.service';

export type SiteRevealVariant = 'up' | 'fade' | 'left' | 'right' | 'scale' | '';

/**
 * Reveals its host (or a set of its children) once, as it scrolls into view,
 * using GSAP + ScrollTrigger.
 *
 * The CSS-only `uiReveal` stays the right choice for a single block; this one
 * exists for the things CSS cannot do well — staggering a list of children from
 * one trigger, or a reveal that moves sideways. It fails visible: the
 * `.site-reveal-pending` class hides the host only until GSAP arrives, and a
 * watchdog clears it if the library never does.
 *
 * ```html
 * <section siteReveal>…</section>
 * <ul siteReveal revealStagger="li">…</ul>           each li, 90 ms apart
 * <div siteReveal="left" revealDelay="120">…</div>
 * ```
 */
@Directive({ selector: '[siteReveal]', standalone: true })
export class SiteRevealDirective implements AfterViewInit {
  readonly variant = input<SiteRevealVariant>('up', { alias: 'siteReveal' });
  /** CSS selector for children to stagger; the host itself is revealed when empty. */
  readonly stagger = input<string>('', { alias: 'revealStagger' });
  readonly delay = input(0, { alias: 'revealDelay', transform: numberAttribute });
  readonly distance = input(28, { alias: 'revealDistance', transform: numberAttribute });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly motion = inject(MotionService);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  constructor() {
    if (!this.motion.reduced()) this.host.nativeElement.classList.add('site-reveal-pending');
    this.destroyRef.onDestroy(() => (this.destroyed = true));
  }

  async ngAfterViewInit(): Promise<void> {
    const el = this.host.nativeElement;
    if (this.motion.reduced()) return;

    const watchdog = setTimeout(() => el.classList.remove('site-reveal-pending'), 2500);
    const { gsap } = await this.motion.load();
    clearTimeout(watchdog);
    if (this.destroyed) {
      el.classList.remove('site-reveal-pending');
      return;
    }

    const selector = this.stagger();
    const targets: Element[] = selector ? Array.from(el.querySelectorAll(selector)) : [el];
    if (!targets.length) {
      el.classList.remove('site-reveal-pending');
      return;
    }

    const variant = this.variant() || 'up';
    const d = this.distance();
    const from: Record<string, number> = { opacity: 0 };
    if (variant === 'up') from['y'] = d;
    if (variant === 'left') from['x'] = -d;
    if (variant === 'right') from['x'] = d;
    if (variant === 'scale') from['scale'] = 0.94;

    // Children hidden and host shown in the same frame, so nothing flashes.
    gsap.set(targets, from);
    el.classList.remove('site-reveal-pending');

    const tween = gsap.to(targets, {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      duration: 0.9,
      ease: 'power3.out',
      delay: this.delay() / 1000,
      stagger: selector ? 0.09 : 0,
      clearProps: 'transform',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });

    this.destroyRef.onDestroy(() => {
      tween.scrollTrigger?.kill();
      tween.kill();
    });
  }
}
