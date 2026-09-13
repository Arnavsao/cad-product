import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AUTH_TOKEN_PROVIDER } from '../config/auth-token.provider';

/** True when the request targets our own backend (never third-party hosts such as S3 or LLM gateways). */
export function isBackendRequest(url: string): boolean {
  const base = environment.apiUrl;
  return !!base && url.startsWith(base);
}

// `/unsubscribe` is here because the link is clicked by people who have often
// stopped signing in; bouncing them to a sign-in form would defeat the point.
const PUBLIC_SITE_PATHS = ['/product', '/features', '/use-cases', '/pricing', '/docs', '/about', '/contact', '/whats-new', '/terms', '/privacy', '/unsubscribe'];

/**
 * 403 codes that describe the ACCOUNT rather than the request.
 *
 * They need their own handling because retrying, re-authenticating or showing
 * a toast all fail the same way: every other route will answer 403 too, so the
 * only useful response is a page that says what happened. Ordinary 403s (a
 * staff tier too low, a drawing not shared) are left to the caller.
 */
const BLOCKED_CODES: Record<string, string> = {
  USER_SUSPENDED: 'suspended',
  SIGNUPS_CLOSED: 'closed',
};

/** Reads `{ code, reason }` off an error body without trusting its shape. */
function blockedFrom(error: HttpErrorResponse): { kind: string; reason?: string } | null {
  const body = error.error as { code?: unknown; reason?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code : null;
  const kind = code ? BLOCKED_CODES[code] : undefined;
  if (!kind) return null;
  return { kind, reason: typeof body?.reason === 'string' ? body.reason : undefined };
}

/** Routes that must never bounce to /sign-in on a 401 (they are reachable signed out). */
function isPublicUrl(url: string): boolean {
  const path = url.split('?')[0].split('#')[0];
  if (path === '/' || path === '' || path.startsWith('/sign-in') || path.startsWith('/sign-up')) return true;
  // The public site (see the site-shell children in app.routes.ts).
  return PUBLIC_SITE_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Attaches `Authorization: Bearer <token>` to backend requests.
 *
 * The token provider may be asynchronous (Supabase mints short-lived access tokens), so the request is deferred behind `from(Promise.resolve(...))` and
 * only sent once the token resolves. On 401 the provider is cleared and the
 * user is sent to `/sign-in?redirect_url=<where they were>` unless they are
 * already on a public route. Requests to other hosts (presigned S3 URLs, AI providers)
 * pass through untouched.
 *
 * The redirect is skipped entirely in embedded mode (no Supabase config): there
 * is no sign-in flow to send anyone to, and a host application supplying its own
 * token through `AUTH_TOKEN_PROVIDER` must handle its own expiry — bouncing the
 * user into our sign-in page would hijack the host's navigation.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isBackendRequest(req.url)) return next(req);

  const tokens = inject(AUTH_TOKEN_PROVIDER);
  const router = inject(Router);

  return from(Promise.resolve(tokens.getToken())).pipe(
    switchMap((token) => next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req)),
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        tokens.clearToken();
        const current = router.url;
        if (environment.supabaseUrl && environment.supabaseAnonKey && !isPublicUrl(current)) {
          void router.navigateByUrl(`/sign-in?redirect_url=${encodeURIComponent(current)}`);
        }
      } else if (error.status === 403) {
        const blocked = blockedFrom(error);
        if (blocked && !router.url.startsWith('/account-blocked')) {
          const reason = blocked.reason ? `&reason=${encodeURIComponent(blocked.reason)}` : '';
          void router.navigateByUrl(`/account-blocked?kind=${blocked.kind}${reason}`);
        }
      }
      return throwError(() => error);
    }),
  );
};
