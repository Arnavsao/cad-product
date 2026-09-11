import { Injectable, signal } from '@angular/core';

/**
 * Owns the full-page branded loader shown between "the OAuth account picker
 * closed" and "the destination page is usable".
 *
 * It lives in a service rather than in `AuthCallbackPage` because the wait spans
 * a navigation: the callback page exchanges the token and then routes to
 * `/dashboard` or `/onboarding`, destroying itself on the way. A loader owned by
 * that component would vanish mid-wait and hand the user back to the 2px route
 * bar, an empty dashboard shell and then skeleton tiles — four loading
 * treatments for one continuous wait. The overlay is rendered once by `App`,
 * above the router outlet, so it survives the handoff.
 *
 * The contract is **whoever calls `begin()` is responsible for `end()` being
 * reached on every path, including failures**. Only flows whose destination
 * calls `end()` should call `begin()`: the `?next=` / `?redirect_url=` callback
 * paths route to arbitrary pages that know nothing about this service, so they
 * deliberately do not raise the overlay at all.
 */
@Injectable({ providedIn: 'root' })
export class SignInHandoffService {
  /**
   * Minimum time the loader stays up once shown. A warm session completes the
   * callback in ~100ms, and a loader that appears and disappears inside a frame
   * or two reads as a glitch rather than as progress. `end()` waits out the
   * remainder instead of clearing immediately.
   */
  private static readonly MIN_VISIBLE_MS = 400;

  /**
   * Hard ceiling. The overlay covers the whole viewport and has no dismiss
   * affordance, so a missed `end()` — a navigation that throws, a guard that
   * redirects somewhere uninstrumented — would soft-lock the app. Failing open
   * to a possibly-unpolished page is strictly better than stranding the user.
   */
  private static readonly MAX_VISIBLE_MS = 15_000;

  private readonly visible = signal(false);

  /** True while the branded sign-in overlay should cover the app. */
  readonly active = this.visible.asReadonly();

  /**
   * False until the minimum hold has elapsed. Tracked with a timer rather than
   * by comparing `Date.now()` readings so that the two deadlines share one clock
   * — which also keeps the service testable under `jasmine.clock()`, as this app
   * is zoneless and has no `fakeAsync`.
   */
  private minElapsed = false;
  /** Set when `end()` arrives before the minimum hold is up. */
  private endPending = false;
  private minTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  /** Raise the overlay. Idempotent: re-entry will not restart the minimum. */
  begin(): void {
    if (this.visible()) return;

    // A pending hold from a previous handoff would otherwise clear this one early.
    this.clearTimers();
    this.minElapsed = false;
    this.endPending = false;
    this.visible.set(true);

    this.minTimer = setTimeout(() => {
      this.minTimer = null;
      this.minElapsed = true;
      // The work finished while the loader was still serving its minimum.
      if (this.endPending) this.clear();
    }, SignInHandoffService.MIN_VISIBLE_MS);

    this.maxTimer = setTimeout(() => this.clear(), SignInHandoffService.MAX_VISIBLE_MS);
  }

  /**
   * Lower the overlay, honouring the minimum display time. Safe to call when
   * nothing is showing, and safe to call more than once — the destination page
   * may settle its first load repeatedly.
   */
  end(): void {
    if (!this.visible()) return;

    if (this.minElapsed) {
      this.clear();
      return;
    }
    // Cleared by the minimum-hold timer when it fires.
    this.endPending = true;
  }

  private clear(): void {
    this.clearTimers();
    this.minElapsed = false;
    this.endPending = false;
    this.visible.set(false);
  }

  private clearTimers(): void {
    if (this.minTimer !== null) {
      clearTimeout(this.minTimer);
      this.minTimer = null;
    }
    if (this.maxTimer !== null) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
  }
}
