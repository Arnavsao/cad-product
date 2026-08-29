import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/** Envelope returned by the backend for every JSON endpoint. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * Thin typed wrapper around HttpClient for the CAD backend.
 * Resolves relative paths against `environment.apiUrl`, unwraps the
 * `ApiResponse` envelope and normalises errors into `Error` instances with a
 * user-presentable message. Authorization is handled by `authInterceptor`.
 */
@Injectable({ providedIn: 'root' })
export class HttpManagerService {
  private http = inject(HttpClient);

  get<T>(path: string): Observable<T> {
    return this.http.get<ApiResponse<T>>(this.url(path)).pipe(map(unwrap), catchError(handleError));
  }
  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<ApiResponse<T>>(this.url(path), body).pipe(map(unwrap), catchError(handleError));
  }
  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<ApiResponse<T>>(this.url(path), body).pipe(map(unwrap), catchError(handleError));
  }
  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<ApiResponse<T>>(this.url(path), body).pipe(map(unwrap), catchError(handleError));
  }
  delete<T>(path: string): Observable<T> {
    return this.http.delete<ApiResponse<T>>(this.url(path)).pipe(map(unwrap), catchError(handleError));
  }

  private url(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const base = environment.apiUrl.replace(/\/+$/, '');
    return `${base}/${path.replace(/^\/+/, '')}`;
  }
}

function unwrap<T>(res: ApiResponse<T> | T): T {
  return res && typeof res === 'object' && 'data' in (res as object) ? (res as ApiResponse<T>).data : (res as T);
}

function handleError(error: HttpErrorResponse) {
  console.error('[CAD] API error:', error);
  let message = 'An unknown error occurred.';
  if (error.status === 0) {
    message = 'Unable to reach the server. Check your network connection.';
  } else if (error.error instanceof ErrorEvent) {
    message = error.error.message;
  } else {
    message = error.error?.message || `Request failed (${error.status}): ${error.message}`;
  }
  return throwError(() => new Error(message));
}
