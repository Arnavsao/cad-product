import { Injectable, inject } from '@angular/core';
import { AuthTokenProvider } from '../config/auth-token.provider';
import { ClerkService } from './clerk.service';

/**
 * `AuthTokenProvider` backed by the Clerk session.
 *
 * Async by design: Clerk's session JWT lives ~60 s and `session.getToken()`
 * refreshes it transparently, so the interceptor must await a Promise rather
 * than read a cached string. In embedded mode (no publishable key) it resolves
 * to null synchronously without touching the SDK.
 */
@Injectable({ providedIn: 'root' })
export class ClerkAuthTokenProvider implements AuthTokenProvider {
  private readonly clerk = inject(ClerkService);

  getToken(): string | null | Promise<string | null> {
    return this.clerk.enabled() ? this.clerk.getToken() : null;
  }

  clearToken(): void {
    // Intentionally a no-op. Clerk owns the session: a 401 means the JWT was
    // stale or the session ended server-side, and Clerk either refreshes it on
    // the next `getToken()` or reports the user as signed out via its listener.
    // There is no local copy of the token to discard.
  }
}
