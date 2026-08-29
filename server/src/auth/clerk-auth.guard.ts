import type { VerifyTokenOptions } from '@clerk/backend';
import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ApiException } from '../common/errors/api-error';
import type { Env } from '../config/env.schema';
import { UsersService } from '../users/users.service';
import type { AuthenticatedRequest, ClerkSessionClaims } from './auth.types';

/** DI token for the token-verification function (swappable in tests). */
export const CLERK_TOKEN_VERIFIER = Symbol('CLERK_TOKEN_VERIFIER');

/**
 * Shape of `verifyToken` from `@clerk/backend`. v2/v3 public export resolves
 * to the payload and THROWS on failure; the internal variant resolves to
 * `{ data, errors }`. We type it loosely and normalise in `verifyClaims`.
 */
export type TokenVerifier = (token: string, options: VerifyTokenOptions) => Promise<unknown>;

/** Accepted clock skew between Clerk's issuer and this server. */
const CLOCK_SKEW_MS = 10_000;

/**
 * Global guard: every route needs a valid Clerk session JWT unless marked
 * `@Public()`.
 *
 * Design:
 * - Verification is networkless when `CLERK_JWT_KEY` (JWKS public PEM) is set;
 *   otherwise `@clerk/backend` fetches JWKS with the secret key. Either works;
 *   the PEM keeps auth up even if Clerk's API is slow.
 * - `authorizedParties` (the `azp` claim) defaults to `CORS_ORIGIN` so a token
 *   minted for another Clerk frontend cannot be replayed here.
 * - After verification we resolve (or lazily create) the LOCAL user and put
 *   `{ id, clerkId, sessionId }` on `req.user`. Handlers key everything on the
 *   local id, never on the Clerk id.
 * - Soft-deleted users get 403 `USER_DELETED`, distinct from 401 so the client
 *   does not loop through sign-in.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);
  private readonly secretKey: string | undefined;
  private readonly jwtKey: string | undefined;
  private readonly authorizedParties: string[];

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
    @Inject(CLERK_TOKEN_VERIFIER) private readonly verify: TokenVerifier,
    private readonly users: UsersService,
  ) {
    this.secretKey = config.get('CLERK_SECRET_KEY', { infer: true });
    this.jwtKey = config.get('CLERK_JWT_KEY', { infer: true });
    this.authorizedParties =
      config.get('CLERK_AUTHORIZED_PARTIES', { infer: true }) ?? config.get('CORS_ORIGIN', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(req.headers?.authorization);
    if (!token) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Missing bearer token');
    }

    const claims = await this.verifyClaims(token);
    const user = await this.users.ensureLocalUser(claims.sub, claims);
    if (user.deletedAt) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'USER_DELETED', 'This account has been deleted');
    }

    req.user = { id: user.id, clerkId: user.clerkId, sessionId: typeof claims.sid === 'string' ? claims.sid : null };
    return true;
  }

  /** Verifies the JWT and normalises the SDK's two result styles. */
  private async verifyClaims(token: string): Promise<ClerkSessionClaims> {
    if (!this.secretKey && !this.jwtKey) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AUTH_NOT_CONFIGURED',
        'Set CLERK_SECRET_KEY and/or CLERK_JWT_KEY',
      );
    }

    let result: unknown;
    try {
      result = await this.verify(token, {
        secretKey: this.secretKey,
        jwtKey: this.jwtKey,
        authorizedParties: this.authorizedParties,
        clockSkewInMs: CLOCK_SKEW_MS,
      });
    } catch (error) {
      this.logger.debug(`Token rejected: ${(error as Error)?.message ?? error}`);
      throw invalidToken();
    }

    // `{ data, errors }` style (internal/legacy) vs. plain payload.
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
    return payload as ClerkSessionClaims;
  }
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
