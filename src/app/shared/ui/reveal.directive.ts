import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input } from '@angular/core';

/**
 * Reveals its host the first time it scrolls into view (`.ui-reveal` ->
 * `.ui-reveal.is-in`, styled in `blueprint.scss`).
 *
 * Hand-rolled rather than pulled from a library: the whole behaviour is one
 * `IntersectionObserver`, and the landing page's first paint is a budget worth
 * protecting.
 *
 * Two deliberate choices:
 *  - **One-way.** The class is added once and the element is unobserved, so
 *    content that has already been read never animates away again on scroll up
 *    -- re-triggering reads as a glitch, not as polish.
 *  - **Fails visible.** Where `IntersectionObserver` is missing the host is
 *    revealed immediately. `.ui-reveal` starts at `opacity: 0`, so a silent
 *    failure here would hide content rather than un-animate it.
 *
 * ```html
 * <article uiReveal>…</article>
 * <article uiReveal="90">…</article>   <!-- 90ms into a stagger -->
 * ```
 */
@Directive({
  selector: '[uiReveal]',
  standalone: true,
  host: {
    class: 'ui-reveal',
    '[style.--ui-reveal-delay.ms]': 'delay()',
  },
})
export class UiRevealDirective implements AfterViewInit, OnDestroy {
  /** Stagger offset within a group, in ms. Bare `uiReveal` means no delay. */
  readonly delay = input(0, { alias: 'uiReveal', transform: (v: unknown) => Number(v) || 0 });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private observer: IntersectionObserver | null = null;

  ngAfterViewInit(): void {
    const el = this.host.nativeElement;

    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-in');
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          this.observer?.unobserve(entry.target);
        }
      },
      // Waits until the element is a little way in, so something entering at
      // the very bottom edge does not animate off-screen.
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );

    this.observer.observe(el);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
