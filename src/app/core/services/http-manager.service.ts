import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/** Envelope returned by the backend for every JSON endpoint. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  code?: string;
}

/** Per-request options accepted by every verb. `undefined` params are skipped. */
export interface RequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Error thrown by every `HttpManagerService` call. Keeps the HTTP status and
 * the backend's machine-readable `code` so callers can branch on 409
 * `VERSION_CONFLICT`, 404, 413 … instead of string-matching messages.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when the server was unreachable. */
    readonly status: number,
    /** Backend error code, e.g. `VERSION_CONFLICT`, `FOLDER_NOT_EMPTY`. */
    readonly code?: string,
    /** Raw response body (the `{ success:false, message, code, … }` envelope for API errors). */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the failure was a network/CORS problem rather than a server answer. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

/**
 * Thin typed wrapper around HttpClient for the CADOnline API.
 *
 * Resolves relative paths against `environment.apiUrl`, unwraps the
 * `ApiResponse` envelope and normalises failures into `ApiError` (status +
 * code preserved). Authorization is handled by `authInterceptor`, which only
 * touches `apiUrl`-prefixed requests — so `getText()` against a presigned
 * storage URL is sent without a bearer token, as it must be.
 */
@Injectable({ providedIn: 'root' })
export class HttpManagerService {
  private http = inject(HttpClient);

  get<T>(path: string, options?: RequestOptions): Observable<T> {
    return this.http.get<ApiResponse<T>>(this.url(path), this.opts(options)).pipe(map(unwrap), catchError(handleError));
  }
  post<T>(path: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http.post<ApiResponse<T>>(this.url(path), body, this.opts(options)).pipe(map(unwrap), catchError(handleError));
  }
  put<T>(path: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http.put<ApiResponse<T>>(this.url(path), body, this.opts(options)).pipe(map(unwrap), catchError(handleError));
  }
  patch<T>(path: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http.patch<ApiResponse<T>>(this.url(path), body, this.opts(options)).pipe(map(unwrap), catchError(handleError));
  }
  delete<T>(path: string, options?: RequestOptions): Observable<T> {
    return this.http.delete<ApiResponse<T>>(this.url(path), this.opts(options)).pipe(map(unwrap), catchError(handleError));
  }

  /**
   * PUT a raw (non-JSON) body — DXF text or a PNG blob — with an explicit
   * `Content-Type`. The response is still the JSON envelope and is unwrapped.
   */
  putRaw<T>(path: string, body: string | Blob, contentType: string, headers?: Record<string, string>): Observable<T> {
    const merged = { ...(headers ?? {}), 'Content-Type': contentType };
    return this.http
      .put<ApiResponse<T>>(this.url(path), body, { headers: new HttpHeaders(merged) })
      .pipe(map(unwrap), catchError(handleError));
  }

  /**
   * GET an absolute URL as plain text with no envelope handling — used for
   * presigned storage downloads. Because the host differs from `apiUrl`, the
   * interceptor adds no Authorization header (S3/R2 would reject one).
   */
  getText(absoluteUrl: string): Observable<string> {
    return this.http.get(absoluteUrl, { responseType: 'text' }).pipe(catchError(handleError));
  }

  private url(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const base = environment.apiUrl.replace(/\/+$/, '');
    return `${base}/${path.replace(/^\/+/, '')}`;
  }

  private opts(options?: RequestOptions): { headers?: HttpHeaders; params?: HttpParams } {
    if (!options) return {};
    const out: { headers?: HttpHeaders; params?: HttpParams } = {};
    if (options.headers) out.headers = new HttpHeaders(options.headers);
    if (options.params) {
      let params = new HttpParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value === undefined) continue;
        params = params.set(key, String(value));
      }
      out.params = params;
    }
    return out;
  }
}

function unwrap<T>(res: ApiResponse<T> | T): T {
  return res && typeof res === 'object' && 'data' in (res as object) ? (res as ApiResponse<T>).data : (res as T);
}

function handleError(error: HttpErrorResponse) {
  console.error('[CAD] API error:', error);
  const body: unknown = error.error;
  const envelope = body && typeof body === 'object' && !(body instanceof ErrorEvent) && !(body instanceof Blob)
    ? (body as { message?: unknown; code?: unknown })
    : null;

  let message: string;
  if (error.status === 0) {
    message = 'Unable to reach the server. Check your network connection.';
  } else if (body instanceof ErrorEvent) {
    message = body.message;
  } else if (envelope && typeof envelope.message === 'string' && envelope.message) {
    message = envelope.message;
  } else {
    message = `Request failed (${error.status}): ${error.message}`;
  }
  const code = envelope && typeof envelope.code === 'string' ? envelope.code : undefined;
  return throwError(() => new ApiError(message, error.status, code, body));
}
