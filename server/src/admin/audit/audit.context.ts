import type { Request } from 'express';

/** Per-request slot the interceptor reads after the handler returns. */
const SLOT = Symbol('cad:auditContext');

interface Slot {
  before?: unknown;
  targetId?: string;
  reason?: string;
}

/**
 * Lets a service hand the auditor the "before" state it alone could read.
 *
 * A request-scoped provider would be the textbook answer, but it would make
 * every admin service request-scoped too (Nest propagates the scope up the
 * injection chain), which costs a fresh instantiation per request across the
 * whole module. A symbol on the request object buys the same thing for nothing,
 * and the interceptor is the only reader.
 */
export const AuditContext = {
  setBefore(req: Request, before: unknown): void {
    slotOf(req).before = before;
  },
  /** For creates, where the id only exists after the handler has run. */
  setTargetId(req: Request, targetId: string): void {
    slotOf(req).targetId = targetId;
  },
  setReason(req: Request, reason: string): void {
    slotOf(req).reason = reason;
  },
  read(req: Request): Slot {
    return (req as Request & { [SLOT]?: Slot })[SLOT] ?? {};
  },
};

function slotOf(req: Request): Slot {
  const holder = req as Request & { [SLOT]?: Slot };
  holder[SLOT] ??= {};
  return holder[SLOT];
}
