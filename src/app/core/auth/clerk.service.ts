import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Clerk } from '@clerk/clerk-js';
import { environment } from '../../../environments/environment';
import { getClerkUiCtor, loadClerkUiBundle } from './clerk-ui-loader';

// Types are derived from the `Clerk` class so we never import `@clerk/shared`
// (a transitive dependency) directly. `import type` is erased at build time, so
// `@clerk/clerk-js` itself only enters the bundle through the dynamic import in
// `load()` — as its own lazy chunk.
type ClerkOptions = NonNullable<Parameters<Clerk['load']>[0]>;
type ClerkUiCtor = Exclude<NonNullable<NonNullable<ClerkOptions['ui']>['ClerkUI']>, Promise<unknown>>;
export type ClerkUser = NonNullable<Clerk['user']>;
export type ClerkSignInProps = NonNullable<Parameters<Clerk['mountSignIn']>[1]>;
export type ClerkSignUpProps = NonNullable<Parameters<Clerk['mountSignUp']>[1]>;
export type ClerkUserButtonProps = NonNullable<Parameters<Clerk['mountUserButton']>[1]>;
export type ClerkUserProfileProps = NonNullable<Parameters<Clerk['mountUserProfile']>[1]>;

/** Where Clerk sends users when a flow finishes without an explicit `redirect_url`. */
export const AFTER_SIGN_IN_URL = '/dashboard';
export const AFTER_SIGN_UP_URL = '/onboarding';
export const SIGN_IN_URL = '/sign-in';
export const SIGN_UP_URL = '/sign-up';
export const ACCOUNT_URL = '/dashboard/settings/account';

/**
 * Thin, signal-based wrapper around `@clerk/clerk-js`.
 *
 * Design decisions:
 *  - **Non-blocking load.** `load()` is kicked off from the `App` constructor
 *    but never awaited there, so the landing page paints instantly; route
 *    guards `await load()` before deciding. The SDK is a dynamic import so it
 *    is a lazy chunk and never inflates the initial bundle.
 *  - **UI from the CDN.** The component UI (`@clerk/ui`) is fetched from the
 *    instance's Frontend API host in parallel with the SDK chunk (see
 *    `clerk-ui-loader.ts`) and handed to `clerk.load({ ui })`. CDN failure is
 *    surfaced as `loadError` so pages can offer a Retry instead of hanging.
 *  - **Signals only.** The app is zoneless; Clerk's `addListener` callback does
 *    nothing but write signals, which is what schedules change detection.
 *  - **No token cache.** `getToken()` always asks Clerk — it keeps its ~60 s
 *    session JWT fresh itself, and caching here would only add a staleness bug.
 *  - **Angular owns navigation.** `routerPush`/`routerReplace` are wired to the
 *    Router so Clerk's path-routed sub-steps (`/sign-in/factor-one`) are
 *    ordinary Angular navigations matched by `prefixMatcher` in app.routes.ts.
 *  - **Embedded mode.** An empty publishable key means `enabled()` is false:
 *    `load()` resolves immediately, guards pass, and nothing is ever mounted.
 */
@Injectable({ providedIn: 'root' })
export class ClerkService {
  private readonly router = inject(Router);

  private clerk: Clerk | null = null;
  private loading: Promise<void> | null = null;

  /** False when `environment.clerkPublishableKey` is empty (embedded mode). */
  readonly enabled = computed(() => !!environment.clerkPublishableKey);
  /** True once `load()` has settled — successfully or not. */
  readonly isLoaded = signal(false);
  /** Human-readable reason the SDK or its UI could not be loaded; null when fine. */
  readonly loadError = signal<string | null>(null);
  /** True while an active Clerk session exists. */
  readonly isSignedIn = signal(false);
  /**
   * The signed-in Clerk user. Clerk mutates the same resource instance in
   * place, so the signal uses a never-equal comparator to notify on every
   * emission rather than only on identity changes.
   */
  readonly user = signal<ClerkUser | null>(null, { equal: () => false });

  /** Load the SDK (+ UI bundle) once. Safe to call from anywhere, any number of times. */
  load(): Promise<void> {
    if (!this.loading) this.loading = this.doLoad();
    return this.loading;
  }

  /** Current session JWT, or null when signed out / disabled. Awaits `load()`. */
  async getToken(): Promise<string | null> {
    if (!this.enabled()) return null;
    await this.load();
    const session = this.clerk?.session;
    if (!session) return null;
    try {
      return (await session.getToken()) ?? null;
    } catch (e) {
      console.warn('[CAD] Clerk getToken failed', e);
      return null;
    }
  }

  /** End the session and return to the landing page. */
  async signOut(): Promise<void> {
    if (!this.clerk) return;
    try {
      await this.clerk.signOut();
    } finally {
      this.sync();
      await this.router.navigateByUrl('/');
    }
  }

  /** Update the signed-in user's name (used by onboarding). */
  async updateName(firstName: string, lastName: string): Promise<void> {
    const user = this.clerk?.user;
    if (!user) return;
    await user.update({ firstName, lastName });
    this.sync();
  }

  // ── component mounting ─────────────────────────────────────────────────
  // All mount helpers use Clerk's *path* routing so multi-step flows change
  // the URL (`/sign-in/factor-one`) — those URLs must stay on the same Angular
  // route, which `prefixMatcher` guarantees.

  mountSignIn(el: HTMLDivElement, props?: Partial<ClerkSignInProps>): void {
    this.clerk?.mountSignIn(el, {
      routing: 'path',
      path: SIGN_IN_URL,
      signUpUrl: SIGN_UP_URL,
      fallbackRedirectUrl: AFTER_SIGN_IN_URL,
      ...(props ?? {}),
    } as ClerkSignInProps);
  }
  unmountSignIn(el: HTMLDivElement): void {
    this.clerk?.unmountSignIn(el);
  }

  mountSignUp(el: HTMLDivElement, props?: Partial<ClerkSignUpProps>): void {
    this.clerk?.mountSignUp(el, {
      routing: 'path',
      path: SIGN_UP_URL,
      signInUrl: SIGN_IN_URL,
      fallbackRedirectUrl: AFTER_SIGN_UP_URL,
      ...(props ?? {}),
    } as ClerkSignUpProps);
  }
  unmountSignUp(el: HTMLDivElement): void {
    this.clerk?.unmountSignUp(el);
  }

  mountUserButton(el: HTMLDivElement, props?: Partial<ClerkUserButtonProps>): void {
    this.clerk?.mountUserButton(el, {
      userProfileMode: 'navigation',
      userProfileUrl: ACCOUNT_URL,
      ...(props ?? {}),
    } as ClerkUserButtonProps);
  }
  unmountUserButton(el: HTMLDivElement): void {
    this.clerk?.unmountUserButton(el);
  }

  mountUserProfile(el: HTMLDivElement, props?: Partial<ClerkUserProfileProps>): void {
    this.clerk?.mountUserProfile(el, {
      routing: 'path',
      path: ACCOUNT_URL,
      ...(props ?? {}),
    } as ClerkUserProfileProps);
  }
  unmountUserProfile(el: HTMLDivElement): void {
    this.clerk?.unmountUserProfile(el);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async doLoad(): Promise<void> {
    const key = environment.clerkPublishableKey;
    if (!key) {
      this.isLoaded.set(true);
      return;
    }
    try {
      // SDK chunk and UI bundle download in parallel; both are needed before `load()`.
      const [{ Clerk }] = await Promise.all([import('@clerk/clerk-js'), loadClerkUiBundle(key)]);
      const clerk = new Clerk(key);
      await clerk.load({
        ui: { ClerkUI: getClerkUiCtor() as ClerkUiCtor },
        routerPush: (to) => this.navigate(to, false),
        routerReplace: (to) => this.navigate(to, true),
        signInUrl: SIGN_IN_URL,
        signUpUrl: SIGN_UP_URL,
        signInFallbackRedirectUrl: AFTER_SIGN_IN_URL,
        signUpFallbackRedirectUrl: AFTER_SIGN_UP_URL,
        appearance: {
          variables: {
            colorPrimary: '#4c9aff',
            fontFamily: 'Inter, system-ui, sans-serif',
            borderRadius: '6px',
          },
        },
      });
      this.clerk = clerk;
      this.sync();
      clerk.addListener(() => this.sync());
    } catch (e) {
      console.error('[CAD] Clerk failed to load', e);
      this.loadError.set(e instanceof Error && e.message ? e.message : 'The authentication service could not be loaded.');
    } finally {
      this.isLoaded.set(true);
    }
  }

  /** Mirror Clerk state into signals. The only thing the listener is allowed to do. */
  private sync(): void {
    const c = this.clerk;
    const user = c?.user ?? null;
    this.isSignedIn.set(!!c?.session && !!user);
    this.user.set(user);
  }

  /**
   * Clerk hands us app-relative paths (possibly with a query string). Anything
   * pointing at a different origin (OAuth, Account Portal) goes through the
   * browser instead, since the Angular router cannot handle it.
   */
  private navigate(to: string, replace: boolean): Promise<unknown> {
    let url = to;
    if (/^https?:\/\//i.test(to)) {
      const target = new URL(to);
      if (target.origin !== window.location.origin) {
        window.location.assign(to);
        return Promise.resolve();
      }
      url = target.pathname + target.search + target.hash;
    }
    return this.router.navigateByUrl(url, { replaceUrl: replace });
  }
}
