import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/** Where users land when a flow finishes without an explicit redirect. */
export const AFTER_SIGN_IN_URL = '/dashboard';
export const AFTER_SIGN_UP_URL = '/onboarding';
export const SIGN_IN_URL = '/sign-in';
export const SIGN_UP_URL = '/sign-up';
export const RESET_PASSWORD_URL = '/reset-password';
/** Where every Supabase redirect (OAuth, email confirm, recovery) comes back to. */
export const AUTH_CALLBACK_URL = '/auth/callback';
/** Our own account surface. */
export const ACCOUNT_URL = '/dashboard/settings/account';

/** OAuth providers wired into the sign-in / sign-up pages. */
export type OAuthProvider = 'google' | 'github' | 'azure';

export interface AuthActionResult {
  ok: boolean;
  /** Message safe to show the user; null on success. */
  error: string | null;
  /**
   * True when the action succeeded but needs the user to check their inbox
   * (sign-up with confirmation on, magic link, password reset).
   */
  emailSent?: boolean;
}

const ok = (): AuthActionResult => ({ ok: true, error: null });
const fail = (error: unknown): AuthActionResult => ({ ok: false, error: messageOf(error) });
const sent = (): AuthActionResult => ({ ok: true, error: null, emailSent: true });

/** A non-blank string from an untyped metadata bag, else null. */
function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Supabase errors carry a usable `message`; anything else gets a generic line. */
function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Signal-based wrapper around `@supabase/supabase-js` auth.
 *
 * Design decisions:
 *  - **Non-blocking load.** `load()` is kicked off from the `App` constructor but
 *    never awaited there, so the landing page paints instantly; route guards
 *    `await load()` before deciding. The SDK is a dynamic import, so it stays a
 *    lazy chunk and never inflates the initial bundle.
 *  - **Lazily constructed client.** Nothing touches the network — or even
 *    constructs a `SupabaseClient` — until `load()` runs. Unit tests that render
 *    components injecting this service therefore stay offline.
 *  - **Signals only.** The app is zoneless; `onAuthStateChange` does nothing but
 *    write signals, which is what schedules change detection.
 *  - **No token cache.** `getToken()` always asks the SDK, which refreshes the
 *    access token when it is close to expiry.
 *  - **Embedded mode.** With either config value empty `enabled()` is false:
 *    `load()` resolves immediately, guards pass, and no auth UI is shown.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseAuthService {
  private readonly router = inject(Router);

  private client: SupabaseClient | null = null;
  private loading: Promise<void> | null = null;

  /**
   * False when either environment value is empty (embedded mode).
   *
   * Both are required: a half-configured app would otherwise silently behave as
   * if auth were switched off, which is a confusing way to discover a typo — see
   * the warning in `doLoad()`.
   */
  readonly enabled = computed(() => !!environment.supabaseUrl && !!environment.supabaseAnonKey);
  /** True once `load()` has settled — successfully or not. */
  readonly isLoaded = signal(false);
  /** Human-readable reason the SDK could not be initialised; null when fine. */
  readonly loadError = signal<string | null>(null);
  /** True while an active session exists. */
  readonly isSignedIn = signal(false);
  /** The signed-in user, or null. */
  readonly user = signal<User | null>(null);
  /** The current session. Kept so `getToken()` has a synchronous fast path. */
  private readonly session = signal<Session | null>(null);

  /** Load the SDK once. Safe to call from anywhere, any number of times. */
  load(): Promise<void> {
    if (!this.loading) {
      this.loading = this.doLoad();
    }
    return this.loading;
  }

  /**
   * Current access token, or null when signed out / disabled.
   *
   * `getSession()` refreshes an access token that is at or near expiry, so this
   * never hands the interceptor a stale one.
   */
  async getToken(): Promise<string | null> {
    if (!this.enabled()) {
      return null;
    }
    await this.load();
    if (!this.client) {
      return null;
    }
    try {
      const { data } = await this.client.auth.getSession();
      return data.session?.access_token ?? null;
    } catch (e) {
      console.warn('[CAD] Supabase getSession failed', e);
      return null;
    }
  }

  // ── sign in / up ──────────────────────────────────────────────────────────

  async signInWithPassword(email: string, password: string): Promise<AuthActionResult> {
    const client = await this.require();
    if (!client) {
      return fail(new Error('Authentication is not configured.'));
    }
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    return error ? fail(error) : ok();
  }

  /**
   * Creates an account. When the project has email confirmation enabled Supabase
   * returns a user with no session, which is reported as `emailSent` so the page
   * can say "check your inbox" instead of pretending the user is signed in.
   */
  async signUpWithPassword(email: string, password: string, fullName?: string): Promise<AuthActionResult> {
    const client = await this.require();
    if (!client) {
      return fail(new Error('Authentication is not configured.'));
    }
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: this.redirectTo(AUTH_CALLBACK_URL),
        ...(fullName?.trim() ? { data: { full_name: fullName.trim() } } : {}),
      },
    });
    if (error) {
      return fail(error);
    }
    return data.session ? ok() : sent();
  }

  /** Passwordless: emails a one-time link that returns to the callback route. */
  async signInWithMagicLink(email: string): Promise<AuthActionResult> {
    const client = await this.require();
    if (!client) {
      return fail(new Error('Authentication is not configured.'));
    }
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: this.redirectTo(AUTH_CALLBACK_URL) },
    });
    return error ? fail(error) : sent();
  }

  /**
   * Starts an OAuth flow. On success the browser leaves this page, so a resolved
   * result here only means the redirect was accepted.
   *
   * `redirectAfter` is carried through the provider round trip as a query param
   * on the callback URL, since nothing of ours survives the redirect otherwise.
   */
  async signInWithOAuth(provider: OAuthProvider, redirectAfter?: string): Promise<AuthActionResult> {
    const client = await this.require();
    if (!client) {
      return fail(new Error('Authentication is not configured.'));
    }
    const target = redirectAfter
      ? `${AUTH_CALLBACK_URL}?redirect_url=${encodeURIComponent(redirectAfter)}`
      : AUTH_CALLBACK_URL;
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: this.redirectTo(target) },
    });
    return error ? fail(error) : ok();
  }

  // ── password ──────────────────────────────────────────────────────────────

  /** Emails a recovery link that lands on the callback and then the reset form. */
  async sendPasswordReset(email: string): Promise<AuthActionResult> {
    const client = await this.require();
    if (!client) {
      return fail(new Error('Authentication is not configured.'));
    }
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: this.redirectTo(`${AUTH_CALLBACK_URL}?next=${encodeURIComponent(RESET_PASSWORD_URL)}`),
    });
    return error ? fail(error) : sent();
  }

  /** Sets a new password for the signed-in (or recovery-session) user. */
  async updatePassword(password: string): Promise<AuthActionResult> {
    const client = await this.require();
    if (!client) {
      return fail(new Error('Authentication is not configured.'));
    }
    const { error } = await client.auth.updateUser({ password });
    return error ? fail(error) : ok();
  }

  // ── profile ───────────────────────────────────────────────────────────────

  /**
   * Updates the display name.
   *
   * `updateUser` writes `user_metadata`, but the API mirrors the profile from the
   * ACCESS TOKEN — which still holds the old metadata until it is reissued. So
   * the session is refreshed here; without that, the server would re-derive the
   * previous name on the next request and the change would appear to revert.
   */
  async updateName(firstName: string, lastName: string): Promise<void> {
    const client = await this.require();
    if (!client) {
      return;
    }
    const first = firstName.trim();
    const last = lastName.trim();
    const { error } = await client.auth.updateUser({
      data: {
        first_name: first || null,
        last_name: last || null,
        full_name: [first, last].filter(Boolean).join(' ') || null,
      },
    });
    if (error) {
      throw error;
    }
    const { data } = await client.auth.refreshSession();
    this.sync(data.session ?? null);
  }

  /**
   * Profile fields, normalised out of `user_metadata`.
   *
   * Supabase has no first/last name columns — OAuth providers write
   * `full_name` — so the split lives here rather than being repeated in every
   * page that wants a first name. `first_name`/`last_name` (written by our own
   * account form) win over the split, which is a heuristic.
   */
  readonly userEmail = computed(() => this.user()?.email ?? '');
  readonly userAvatarUrl = computed<string | null>(() => {
    const meta = this.user()?.user_metadata ?? {};
    return pickString(meta['avatar_url']) ?? pickString(meta['picture']);
  });
  readonly userFirstName = computed(() => this.splitDisplayName().firstName);
  readonly userLastName = computed(() => this.splitDisplayName().lastName);

  private readonly splitDisplayName = computed<{ firstName: string; lastName: string }>(() => {
    const meta = this.user()?.user_metadata ?? {};
    const explicitFirst = pickString(meta['first_name']);
    const explicitLast = pickString(meta['last_name']);
    if (explicitFirst || explicitLast) {
      return { firstName: explicitFirst ?? '', lastName: explicitLast ?? '' };
    }
    const display = pickString(meta['full_name']) ?? pickString(meta['name']);
    if (!display) {
      return { firstName: '', lastName: '' };
    }
    const normalised = display.replace(/\s+/g, ' ').trim();
    const space = normalised.indexOf(' ');
    return space === -1
      ? { firstName: normalised, lastName: '' }
      : { firstName: normalised.slice(0, space), lastName: normalised.slice(space + 1) };
  });

  /** The OAuth providers this account can sign in with, e.g. `['google']`. */
  readonly identities = computed<string[]>(() => {
    const list = this.user()?.identities ?? [];
    return list.map((identity) => identity.provider).filter((p): p is string => !!p && p !== 'email');
  });

  /** True when the account can sign in with a password (so offer "change password"). */
  readonly hasPasswordIdentity = computed<boolean>(() => {
    const list = this.user()?.identities ?? [];
    return list.length === 0 || list.some((identity) => identity.provider === 'email');
  });

  // ── session ───────────────────────────────────────────────────────────────

  /** End the session and return to the landing page. */
  async signOut(): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      await client.auth.signOut();
    } finally {
      this.sync(null);
      await this.router.navigateByUrl('/');
    }
  }

  /**
   * Completes a redirect landing (OAuth code exchange, email confirmation,
   * recovery) and resolves with the resulting session.
   *
   * `detectSessionInUrl` normally does this automatically during `load()`; this
   * exists so the callback page can await the outcome and report a failure rather
   * than sitting on a spinner forever.
   */
  async completeRedirect(): Promise<Session | null> {
    await this.load();
    const client = this.client;
    if (!client) {
      return null;
    }
    const { data } = await client.auth.getSession();
    this.sync(data.session ?? null);
    return data.session ?? null;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** `load()` then the client, or null when disabled / failed. */
  private async require(): Promise<SupabaseClient | null> {
    if (!this.enabled()) {
      return null;
    }
    await this.load();
    return this.client;
  }

  /** Absolute URL for a Supabase redirect target — it must be an allow-listed URL. */
  private redirectTo(path: string): string {
    return new URL(path, window.location.origin).toString();
  }

  private async doLoad(): Promise<void> {
    const url = environment.supabaseUrl;
    const anonKey = environment.supabaseAnonKey;

    if (!url || !anonKey) {
      // Exactly one set is almost certainly a mistake, and silently running in
      // embedded mode would make it look like auth is "just not working".
      if (url || anonKey) {
        console.warn(
          '[CAD] Supabase is half-configured: both supabaseUrl and supabaseAnonKey are required. Running without auth.',
        );
      }
      this.isLoaded.set(true);
      return;
    }

    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // PKCE + URL detection is what makes the OAuth / email-link callback work.
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      });
      this.client = client;

      const { data } = await client.auth.getSession();
      this.sync(data.session ?? null);
      client.auth.onAuthStateChange((_event, session) => this.sync(session));
    } catch (e) {
      console.error('[CAD] Supabase failed to load', e);
      this.loadError.set(messageOf(e));
    } finally {
      this.isLoaded.set(true);
    }
  }

  /** Mirror SDK state into signals. The only thing the listener is allowed to do. */
  private sync(session: Session | null): void {
    this.session.set(session);
    this.user.set(session?.user ?? null);
    this.isSignedIn.set(!!session?.user);
  }
}
