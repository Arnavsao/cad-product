import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

/** Success envelope — mirrors what the Angular `HttpManagerService` unwraps. */
export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

/**
 * Wraps every successful handler result as `{ success: true, data }`.
 *
 * Design: the frontend's `HttpManagerService` already unwraps this envelope
 * for the legacy API, so keeping it lets the new endpoints plug into the
 * existing client without special cases. Handlers that must return a raw
 * body opt out with `@RawResponse()`.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T> | T> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [context.getHandler(), context.getClass()]);
    if (raw) {
      return next.handle();
    }
    return next.handle().pipe(map((data) => ({ success: true as const, data: data === undefined ? null : data }) as SuccessEnvelope<T>));
  }
}
