import { Injectable, inject } from '@angular/core';
import { AuthTokenProvider } from '../config/auth-token.provider';
import { SupabaseAuthService } from './supabase-auth.service';

/**
 * `AuthTokenProvider` backed by the Supabase session.
 *
 * Async by design: the access token is short-lived and `getSession()` refreshes
 * it transparently, so the interceptor must await a Promise rather than read a
 * cached string. In embedded mode (no Supabase config) it resolves to null
 * without touching the SDK.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseAuthTokenProvider implements AuthTokenProvider {
  private readonly auth = inject(SupabaseAuthService);

  getToken(): string | null | Promise<string | null> {
    return this.auth.enabled() ? this.auth.getToken() : null;
  }

  clearToken(): void {
    // Intentionally a no-op. The SDK owns the session: a 401 means the access
    // token was stale or the session ended server-side, and `getSession()` will
    // either refresh it on the next call or report the user as signed out via
    // `onAuthStateChange`. Calling `signOut()` here would turn one unlucky 401
    // into an involuntary sign-out.
  }
}
