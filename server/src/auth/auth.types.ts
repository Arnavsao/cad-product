import type { Request } from 'express';

/**
 * The authenticated principal attached to `req.user` by `ClerkAuthGuard`.
 * `id` is the LOCAL `users.id` (cuid) — every ownership query keys on it,
 * never on the Clerk id, so a Clerk re-provisioning cannot re-home data.
 */
export interface AuthUser {
  /** Local `users.id`. */
  id: string;
  /** Clerk user id (`user_…`), the JWT `sub`. */
  clerkId: string;
  /** Clerk session id (`sess_…`), the JWT `sid`. */
  sessionId: string | null;
}

/** Express request after the guard has run. */
export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

/**
 * Minimal view of the Clerk session-token claims we rely on. Clerk's default
 * template carries `sub`/`sid`/`azp`; custom templates may add profile fields,
 * which the no-secret-key fallback uses to seed the local user.
 */
export interface ClerkSessionClaims {
  sub: string;
  sid?: string;
  azp?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  image_url?: string;
  [claim: string]: unknown;
}
