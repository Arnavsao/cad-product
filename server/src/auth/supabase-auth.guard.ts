import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { OPTIONAL_AUTH_KEY } from '../common/decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ApiException } from '../common/errors/api-error';
import type { Env } from '../config/env.schema';
import { UsersService } from '../users/users.service';
import type { AuthenticatedRequest, SupabaseSessionClaims } from './auth.types';
import { createSupabaseVerifier, type TokenVerifier } from './supabase-token-verifier';

// Re-exported so consumers (and tests) get the guard's contract from one place.
export type { TokenVerifier };

/** DI token for the token-verification function (swappable in tests). */
export const AUTH_TOKEN_VERIFIER = Symbol('AUTH_TOKEN_VERIFIER');

/** Accepted clock skew between Supabase and this server, in seconds. */
const CLOCK_SKEW_SEC = 10;

/**
 * Factory for the default verifier. Registered in `AuthModule`; returns `null`
 * when the project is not configured, which the guard reports as 503 rather than
 * letting unverified requests through.
 */
export function supabaseVerifierFactory(config: ConfigService<Env, true>): TokenVerifier | null {
  return createSupabaseVerifier({
    supabaseUrl: blankToUndefined(config.get('SUPABASE_URL', { infer: true })),
    jwtSecret: blankToUndefined(config.get('SUPABASE_JWT_SECRET', { infer: true })),
    clockToleranceSec: CLOCK_SKEW_SEC,
  });
}

/**
 * Global guard: every route needs a valid Supabase access token unless marked
 * `@Public()` or `@OptionalAuth()`.
 *
 * Design:
 * - Verification is delegated to an injected function (see
 *   `supabase-token-verifier.ts`), which asserts the signature plus `iss` and
 *   `aud`. Keeping it behind a DI token means this guard's policy — public
 *   routes, optional auth, soft-deleted accounts — is testable without crypto.
 * - After verification we resolve (or lazily create) the LOCAL user and put
 *   `{ id, authId, email, sessionId }` on `req.user`. Handlers key everything on
 *   the local id, never on the Supabase id; `email` rides along because sharing
 *   targets people by address (`common/access.ts`) and re-reading the user row
 *   on every request to learn it would be wasteful.
 * - Soft-deleted users get 403 `USER_DELETED`, distinct from 401 so the client
 *   does not loop through sign-in.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_TOKEN_VERIFIER) private readonly verify: TokenVerifier | null,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) {
      return true;
    }
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, targets);

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(req.headers?.authorization);
    if (!token) {
      if (optional) {
        return true;
      }
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Missing bearer token');
    }

    // On an `@OptionalAuth()` route a bad token means "anonymous", not 401: the
    // caller may simply have a stale session, and the endpoint works without one.
    // A *deleted* account still gets its 403 either way — that is a decision about
    // the account, not about whether this request is authenticated.
    let claims: SupabaseSessionClaims;
    try {
      claims = await this.verifyClaims(token);
    } catch (error) {
      if (optional) {
        return true;
      }
      throw error;
    }

    const user = await this.users.ensureLocalUser(claims.sub, claims);
    if (user.deletedAt) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'USER_DELETED', 'This account has been deleted');
    }

    req.user = {
      id: user.id,
      authId: user.authId,
      // Lowercased once, here: shares are matched by address and every
      // comparison downstream then gets to be a plain equality.
      email: user.email.toLowerCase(),
      sessionId: typeof claims.session_id === 'string' ? claims.session_id : null,
    };
    return true;
  }

  /** Verifies the JWT and normalises whatever the verifier returned. */
  private async verifyClaims(token: string): Promise<SupabaseSessionClaims> {
    if (!this.verify) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AUTH_NOT_CONFIGURED',
        'Set SUPABASE_URL (and SUPABASE_JWT_SECRET for legacy HS256 projects)',
      );
    }

    let result: unknown;
    try {
      result = await this.verify(token);
    } catch (error) {
      this.logger.debug(`Token rejected: ${(error as Error)?.message ?? error}`);
      throw invalidToken();
    }

    // Tolerate a `{ data, errors }`-style verifier as well as a plain payload, so
    // a stub or a future SDK wrapper can be dropped in without touching the guard.
    let payload: unknown = result;
    if (result && typeof result === 'object' && ('data' in result || 'errors' in result)) {
      const wrapped = result as { data?: unknown; errors?: unknown[] };
      if (wrapped.errors && wrapped.errors.length > 0) {
        this.logger.debug(`Token rejected: ${(wrapped.errors[0] as Error)?.message ?? 'unknown'}`);
        throw invalidToken();
      }
      payload = wrapped.data;
    }

    if (!payload || typeof payload !== 'object' || typeof (payload as { sub?: unknown }).sub !== 'string') {
      throw invalidToken();
    }
    return payload as SupabaseSessionClaims;
  }
}

/** A present-but-blank env value means "unset" (see `env.schema.ts`). */
function blankToUndefined(value: string | undefined): string | undefined {
  return value && value.trim() !== '' ? value : undefined;
}

function invalidToken(): ApiException {
  return new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_TOKEN', 'Invalid or expired session token');
}

/** `Authorization: Bearer <token>` → token, else `null`. */
export function extractBearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : null;
}
