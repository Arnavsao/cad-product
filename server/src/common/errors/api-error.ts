import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Shape of every error body the API emits (see plan §1):
 * `{ success: false, message, code, ...extra }`.
 */
export interface ApiErrorBody {
  success: false;
  code: string;
  message: string;
  [extra: string]: unknown;
}

/**
 * Application error with a stable machine-readable `code`.
 *
 * Design: Nest's built-in exceptions only carry an HTTP status and a message;
 * the frontend needs codes (`VERSION_CONFLICT`, `INVALID_DXF`, …) and some
 * errors must carry payload (409 → `{ currentVersion }`). `extra` is merged
 * into the body so callers can do `new ApiException(409, 'VERSION_CONFLICT',
 * 'Drawing was modified', { currentVersion: 7 })`.
 */
export class ApiException extends HttpException {
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: HttpStatus | number, code: string, message: string, extra: Record<string, unknown> = {}) {
    const body: ApiErrorBody = { success: false, code, message, ...extra };
    super(body, status);
    this.code = code;
    this.extra = extra;
  }

  /** 404 with a domain code; used for ownership violations so existence never leaks. */
  static notFound(code = 'NOT_FOUND', message = 'Not found'): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, code, message);
  }

  static conflict(code: string, message: string, extra?: Record<string, unknown>): ApiException {
    return new ApiException(HttpStatus.CONFLICT, code, message, extra);
  }

  static unprocessable(code: string, message: string, extra?: Record<string, unknown>): ApiException {
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message, extra);
  }

  static payloadTooLarge(limitBytes: number, message = 'Payload too large'): ApiException {
    return new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', message, { limitBytes });
  }

  static unsupportedMediaType(code: string, message: string): ApiException {
    return new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, code, message);
  }
}
