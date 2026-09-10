import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import type { gsap as GsapInstance } from 'gsap';
import type { ScrollTrigger as ScrollTriggerClass } from 'gsap/ScrollTrigger';
import type Lenis from 'lenis';

/** The two GSAP handles every marketing animation needs, loaded once. */
export interface MotionLibs {
  gsap: typeof GsapInstance;
  ScrollTrigger: typeof ScrollTriggerClass;
}

/**
 * Loads and owns the motion stack for the public pages: GSAP + ScrollTrigger
 * for scroll-driven animation and Lenis for smooth scrolling.
 *
 * Design decisions:
 *  - **Lazy.** Nothing here is imported statically. The landing page's first
 *    paint is a budget worth protecting, and the editor, dashboard and auth
 *    pages never need any of it. Every consumer awaits `load()`.
 *  - **Reduced motion is a hard off switch.** With `prefers-reduced-motion`
 *    set, `reduced()` is true, Lenis is never created and the directives land
 *    on their finished state. Nothing waits on the libraries then.
 *  - **One Lenis instance per shell.** The site shell starts it and stops it;
 *    pages only ask for `scrollToElement`. Lenis drives ScrollTrigger from
 *    GSAP's ticker so the two never disagree about where the page is.
 */
@Injectable({ providedIn: 'root' })
export class MotionService {
  private readonly document = inject(DOCUMENT);

  private readonly reducedQuery =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  /** True while the user asks for reduced motion. */
  readonly reduced = signal(this.reducedQuery?.matches ?? false);

  private libs: Promise<MotionLibs> | null = null;
  private lenis: Lenis | null = null;

  constructor() {
    this.reducedQuery?.addEventListener('change', (e) => this.reduced.set(e.matches));
  }

  /** GSAP and ScrollTrigger, registered. Safe to call repeatedly. */
  load(): Promise<MotionLibs> {
    this.libs ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([g, st]) => {
      g.gsap.registerPlugin(st.ScrollTrigger);
      return { gsap: g.gsap, ScrollTrigger: st.ScrollTrigger };
    });
    return this.libs;
  }

  /**
   * Starts smooth scrolling for the whole window. Returns a disposer. A no-op
   * (returning a no-op) under reduced motion or on a coarse pointer, where
   * native scrolling is what people expect.
   */
  async startSmoothScroll(): Promise<() => void> {
    if (this.reduced() || this.lenis) return () => undefined;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    if (coarse) return () => undefined;

    const [{ gsap, ScrollTrigger }, { default: LenisCtor }] = await Promise.all([this.load(), import('lenis')]);
    if (this.lenis) return () => undefined;

    const lenis = new LenisCtor({
      // Short on purpose. Lenis' own default (1.2s with a long tail) reads as
      // lag rather than polish: the page keeps travelling after the wheel has
      // stopped, and every scroll-driven animation trails the input. This is
      // just enough to take the stepping out of a wheel notch.
      duration: 0.55,
      // Quintic ease-out: nearly all of the distance is covered in the first
      // third of the tween, so motion arrives immediately and settles quickly
      // instead of gliding. A cubic curve here still felt slow.
      easing: (t: number) => 1 - Math.pow(1 - t, 5),
      smoothWheel: true,
      // A little over 1 so a wheel notch covers slightly more than the native
      // distance; combined with the short duration this feels direct.
      wheelMultiplier: 1.1,
      // Lets scroll-driven CSS animations (blueprint.scss) and IntersectionObservers see the same scroll.
      syncTouch: false,
    });
    this.lenis = lenis;

    const onScroll = (): void => ScrollTrigger.update();
    lenis.on('scroll', onScroll);
    const tick = (time: number): void => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.off('scroll', onScroll);
      lenis.destroy();
      if (this.lenis === lenis) this.lenis = null;
    };
  }

  /** Scrolls the window so `target` sits just under the fixed header. */
  scrollToElement(target: HTMLElement, offset = -80): void {
    if (this.lenis) {
      this.lenis.scrollTo(target, { offset, duration: this.reduced() ? 0 : 0.7 });
      return;
    }
    const top = target.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top, behavior: this.reduced() ? 'auto' : 'smooth' });
  }

  /** Jumps to the top without animation — used on route changes. */
  scrollToTop(): void {
    if (this.lenis) this.lenis.scrollTo(0, { immediate: true });
    else window.scrollTo(0, 0);
  }

  /**
   * Recomputes every ScrollTrigger after a page has rendered. Waits two frames
   * so lazily-rendered content has laid out; harmless when nothing is loaded.
   */
  refresh(): void {
    if (!this.libs) return;
    void this.libs.then(({ ScrollTrigger }) => {
      requestAnimationFrame(() => requestAnimationFrame(() => ScrollTrigger.refresh()));
    });
  }

  /** Reads a `--ui-*` colour as the browser resolved it, for canvas/WebGL code. */
  cssColor(token: string, fallback: string): string {
    const value = getComputedStyle(this.document.body).getPropertyValue(token).trim();
    return value || fallback;
  }
}
