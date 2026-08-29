import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isPrismaKnownError, PRISMA_ERROR } from '../../prisma/prisma.service';
import { ApiErrorBody, ApiException } from '../errors/api-error';

/** Default machine codes for statuses raised by framework exceptions. */
const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

/** Shape of errors raised by `body-parser` / `raw-body`. */
interface BodyParserError {
  type?: string;
  status?: number;
  statusCode?: number;
  message?: string;
  expose?: boolean;
}

interface ResolvedError {
  status: number;
  body: ApiErrorBody;
  /** Original error for server-side logging of 5xx. */
  cause?: unknown;
}

/**
 * Turns every thrown value into the `{ success: false, message, code }`
 * envelope from plan §1.
 *
 * Design: one place owns the error contract so controllers/services can throw
 * whatever is natural (`ApiException` for domain errors, Prisma errors from
 * `update`/`delete` on a missing row, Express body-parser limits) and the
 * client always sees a stable code. 5xx messages are hidden in production
 * because stack details leak schema/infra information.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly hideInternalMessages: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const { status, body, cause } = this.resolve(exception);

    if (status >= 500) {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      this.logger.error(`${req.method} ${req.originalUrl ?? req.url} -> ${status} ${body.code}: ${err.message}`, err.stack);
    }

    if (res.headersSent) {
      return;
    }
    res.status(status).json(body);
  }

  /** Pure mapping — exposed for unit tests. */
  resolve(exception: unknown): ResolvedError {
    // 1. Our own domain errors carry the full body already.
    if (exception instanceof ApiException) {
      return { status: exception.getStatus(), body: exception.getResponse() as ApiErrorBody };
    }

    // 2. Prisma "known request" errors → HTTP semantics.
    if (isPrismaKnownError(exception)) {
      if (exception.code === PRISMA_ERROR.NOT_FOUND) {
        return { status: 404, body: { success: false, code: 'NOT_FOUND', message: 'Not found' } };
      }
      if (exception.code === PRISMA_ERROR.UNIQUE_VIOLATION) {
        return { status: 409, body: { success: false, code: 'CONFLICT', message: 'Resource already exists' } };
      }
      if (exception.code === PRISMA_ERROR.FK_VIOLATION) {
        return { status: 422, body: { success: false, code: 'INVALID_REFERENCE', message: 'Referenced resource does not exist' } };
      }
      return this.internal(exception);
    }

    // 3. Raw body-parser errors (when they bypass Nest's own mapping).
    const bp = exception as BodyParserError;
    if (bp && typeof bp === 'object' && typeof bp.type === 'string') {
      if (bp.type === 'entity.too.large') {
        return { status: 413, body: { success: false, code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } };
      }
      if (bp.type === 'entity.parse.failed') {
        return { status: 400, body: { success: false, code: 'MALFORMED_JSON', message: 'Malformed JSON body' } };
      }
      if (bp.type === 'encoding.unsupported' || bp.type === 'charset.unsupported') {
        return { status: 415, body: { success: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: bp.message ?? 'Unsupported encoding' } };
      }
      if (bp.type === 'request.aborted') {
        return { status: 400, body: { success: false, code: 'REQUEST_ABORTED', message: 'Request aborted' } };
      }
    }

    // 4. JSON syntax errors (Nest wraps body-parser's SyntaxError in a 400).
    if (exception instanceof SyntaxError) {
      return { status: 400, body: { success: false, code: 'MALFORMED_JSON', message: 'Malformed JSON body' } };
    }

    // 5. Framework HttpExceptions (ValidationPipe, Throttler, Nest built-ins).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (response && typeof response === 'object') {
        const r = response as Record<string, unknown>;
        if (typeof r['code'] === 'string') {
          // Already in our shape (e.g. built by the ValidationPipe exceptionFactory).
          const { code, message, ...rest } = r;
          return {
            status,
            body: { ...rest, success: false, code, message: typeof message === 'string' ? message : 'Request failed' },
          };
        }
        const msg = r['message'];
        const message = Array.isArray(msg) ? String(msg[0]) : typeof msg === 'string' ? msg : exception.message;
        if (status === 400 && /JSON/i.test(message)) {
          return { status, body: { success: false, code: 'MALFORMED_JSON', message: 'Malformed JSON body' } };
        }
        return { status, body: { success: false, code: CODE_BY_STATUS[status] ?? 'ERROR', message } };
      }
      const message = typeof response === 'string' ? response : exception.message;
      if (status === 400 && /JSON/i.test(message)) {
        return { status, body: { success: false, code: 'MALFORMED_JSON', message: 'Malformed JSON body' } };
      }
      if (status >= 500) {
        return this.internal(exception, status);
      }
      return { status, body: { success: false, code: CODE_BY_STATUS[status] ?? 'ERROR', message } };
    }

    // 6. Anything else is a bug.
    return this.internal(exception);
  }

  private internal(cause: unknown, status: number = HttpStatus.INTERNAL_SERVER_ERROR): ResolvedError {
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    return {
      status,
      cause,
      body: {
        success: false,
        code: CODE_BY_STATUS[status] ?? 'INTERNAL',
        message: this.hideInternalMessages ? 'Internal server error' : rawMessage,
      },
    };
  }
}
