import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AUTH_TOKEN_PROVIDER } from '../config/auth-token.provider';

/** True when the request targets our own backend (never third-party hosts such as S3 or LLM gateways). */
export function isBackendRequest(url: string): boolean {
  const base = environment.apiUrl;
  return !!base && url.startsWith(base);
}

/**
 * Attaches `Authorization: Bearer <token>` to backend requests and clears the
 * token when the backend answers 401.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const tokens = inject(AUTH_TOKEN_PROVIDER);
  const backend = isBackendRequest(req.url);

  if (backend) {
    const token = tokens.getToken();
    if (token) req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (backend && error.status === 401) tokens.clearToken();
      return throwError(() => error);
    })
  );
};
