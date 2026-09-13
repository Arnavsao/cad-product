import type { Request } from 'express';
import type { User } from '../generated/prisma/client';

/**
 * The authenticated principal attached to `req.user` by `SupabaseAuthGuard`.
 * `id` is the LOCAL `users.id` (cuid) — every ownership query keys on it, never
 * on the provider id, so re-provisioning an identity cannot re-home data.
 */
export interface AuthUser {
  /** Local `users.id`. */
  id: string;
  /** Supabase `auth.users.id` (a UUID), the JWT `sub`. */
  authId: string;
  /**
   * The local row's email, **lowercased**. Carried on the principal because
   * every access decision needs it — a `Share` names its person by address, so
   * `common/access.ts` would otherwise re-read the user row on every request.
   */
  email: string;
  /** Supabase session id, the JWT `session_id`. Null when the token omits it. */
  sessionId: string | null;
  /** `aal1` or `aal2`; see `SupabaseSessionClaims.aal`. Never undefined here. */
  aal: string;
  /**
   * The full local row the guard already read while resolving this request.
   * Handlers that would otherwise re-read the same user (`GET /me`) take it from
   * here instead of paying a second indexed round trip to the database.
   */
  record?: User;
}

/** Express request after the guard has run. */
export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

/**
 * Profile fields Supabase keeps in `user_metadata`.
 *
 * `full_name` / `name` / `avatar_url` are what the OAuth providers populate;
 * `first_name` / `last_name` are what our own account form writes, so they are
 * preferred when present (see `resolveProfile` in `users.service.ts`).
 */
export interface SupabaseUserMetadata {
  full_name?: string;
  name?: string;
  avatar_url?: string;
  picture?: string;
  first_name?: string;
  last_name?: string;
  [key: string]: unknown;
}

/**
 * The Supabase access-token claims we rely on.
 *
 * The profile fields are not opt-in: Supabase puts `email` at the top level and
 * the rest under `user_metadata` on every token, which is what lets
 * the local `users` row be provisioned and kept fresh from the token alone — no
 * Backend API call and no webhook.
 */
export interface SupabaseSessionClaims {
  /** `auth.users.id` (UUID). The only claim we treat as mandatory. */
  sub: string;
  /** Always `authenticated` for a signed-in user; asserted during verification. */
  aud?: string | string[];
  role?: string;
  email?: string;
  phone?: string;
  session_id?: string;
  /**
   * Authenticator Assurance Level, per Supabase's MFA support: `aal1` for a
   * password or OAuth sign-in, `aal2` once a second factor has been verified.
   *
   * Read by `AdminGuard` when `ADMIN_REQUIRE_MFA` is on. Absent on tokens from
   * a project with MFA disabled, which is why the guard treats "missing" as
   * `aal1` rather than assuming the best.
   */
  aal?: string;
  user_metadata?: SupabaseUserMetadata;
  app_metadata?: Record<string, unknown>;
  [claim: string]: unknown;
}
