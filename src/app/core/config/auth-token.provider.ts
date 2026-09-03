import { InjectionToken } from '@angular/core';

/**
 * Pluggable source of the bearer token attached to backend API calls.
 *
 * The standalone app provides `SupabaseAuthTokenProvider` (see app.config.ts).
 * A host application embedding the editor can override this token to
 * integrate its own session handling:
 *
 *   { provide: AUTH_TOKEN_PROVIDER, useExisting: MySessionService }
 */
export interface AuthTokenProvider {
  /**
   * Return the current access token, or null when unauthenticated. May be
   * asynchronous: Supabase (and most modern session libraries) mint short-lived
   * access tokens on demand, so `authInterceptor` awaits the result before sending.
   */
  getToken(): string | null | Promise<string | null>;
  /** Called when the backend rejects the token (HTTP 401). */
  clearToken(): void;
}

export const AUTH_TOKEN_STORAGE_KEY = 'cad.auth.token';

/** Simple localStorage-backed provider for hosts that manage their own token. */
export class LocalStorageAuthTokenProvider implements AuthTokenProvider {
  getToken(): string | null {
    try { return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY); } catch { return null; }
  }
  clearToken(): void {
    try { localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY); } catch { /* ignore */ }
  }
}

export const AUTH_TOKEN_PROVIDER = new InjectionToken<AuthTokenProvider>('AUTH_TOKEN_PROVIDER', {
  providedIn: 'root',
  factory: () => new LocalStorageAuthTokenProvider(),
});
