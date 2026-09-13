import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { AuthenticatedRequest } from '../../auth/auth.types';
import { AuditContext } from './audit.context';
import { AUDITED_KEY, type AuditedMeta } from './audited.decorator';
import { AuditService } from './audit.service';

/**
 * Writes one `audit_log` row per successful `@Audited()` handler.
 *
 * Why an interceptor rather than a call in each service: the trail's value
 * depends on it being complete, and "remember to log" is exactly the kind of
 * thing that is omitted on the endpoint someone adds in a hurry. Here, the
 * decorator is the whole contract.
 *
 * A handler that throws writes nothing — `tap`'s next callback only runs on
 * success — because an action that did not happen has nothing to record, and a
 * refused one is already visible as a 4xx in the request log.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditedMeta | undefined>(AUDITED_KEY, context.getHandler());
    if (!meta) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = req.user;

    return next.handle().pipe(
      tap((result) => {
        if (!actor) {
          return;
        }
        const slot = AuditContext.read(req);
        const reasonField = meta.reasonField === undefined ? 'reason' : meta.reasonField;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const bodyReason = reasonField ? body[reasonField] : undefined;

        // Fire and forget: the response must not wait on the trail, and
        // `AuditService.record` never rejects.
        void this.audit.record(actor, {
          action: meta.action,
          targetType: meta.targetType,
          targetId: slot.targetId ?? paramOf(req.params, meta.idParam ?? 'id') ?? idOf(result),
          before: slot.before,
          after: result ?? undefined,
          reason: slot.reason ?? (typeof bodyReason === 'string' ? bodyReason : null),
          ip: AuditService.ipOf(req),
          userAgent: AuditService.userAgentOf(req),
        });
      }),
    );
  }
}

/** One route parameter as a string; Express types it loosely enough to matter. */
function paramOf(params: Record<string, unknown> | undefined, name: string): string | null {
  const value = params?.[name];
  return typeof value === 'string' ? value : null;
}

/** Last resort for a create: the handler's own result usually carries the id. */
function idOf(result: unknown): string | null {
  if (result && typeof result === 'object') {
    const id = (result as { id?: unknown }).id;
    if (typeof id === 'string') {
      return id;
    }
  }
  return null;
}
