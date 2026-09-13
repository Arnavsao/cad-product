import { SetMetadata } from '@nestjs/common';
import type { AuditTargetType } from './audit.service';

/** Metadata key read by `AuditInterceptor`. */
export const AUDITED_KEY = 'cad:audited';

/** What `@Audited()` records about a handler. */
export interface AuditedMeta {
  /** Dotted verb stored in `audit_log.action`, e.g. `user.suspend`. */
  action: string;
  targetType: AuditTargetType;
  /**
   * Route parameter naming the target id. Defaults to `id`; set it when the
   * handler's parameter is called something else (`:userId`, `:key`).
   */
  idParam?: string;
  /**
   * Body field carrying the actor's reason. Defaults to `reason`. Set to `null`
   * for endpoints that do not ask for one.
   */
  reasonField?: string | null;
}

/**
 * Marks a handler as auditable. The interceptor does the writing, so adding an
 * endpoint to the trail is one line and cannot be half-done.
 *
 * The `before` snapshot is NOT taken here — a generic interceptor cannot know
 * how to read the row. Services that want one call `AuditContext.setBefore()`
 * while they still have it in hand.
 */
export const Audited = (meta: AuditedMeta): MethodDecorator => SetMetadata(AUDITED_KEY, meta);
