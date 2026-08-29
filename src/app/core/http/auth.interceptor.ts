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

/** Routes that must never bounce to /sign-in on a 401 (they are reachable signed out). */
function isPublicUrl(url: string): boolean {
  const path = url.split('?')[0].split('#')[0];
  return path === '/' || path === '' || path.startsWith('/sign-in') || path.startsWith('/sign-up');
}

/**
 * Attaches `Authorization: Bearer <token>` to backend requests.
 *
 * The token provider may be asynchronous (Clerk mints short-lived JWTs on
 * demand), so the request is deferred behind `from(Promise.resolve(...))` and
 * only sent once the token resolves. On 401 the provider is cleared and the
 * user is sent to `/sign-in?redirect_url=<where they were>` unless they are
 * already on a public route. Requests to other hosts (presigned S3 URLs, Ollama)
 * pass through untouched.
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
        if (!isPublicUrl(current)) {
          void router.navigateByUrl(`/sign-in?redirect_url=${encodeURIComponent(current)}`);
        }
      }
      return throwError(() => error);
    }),
  );
};
