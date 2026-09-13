import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Env } from '../config/env.schema';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ApiException } from '../common/errors/api-error';
import { PlatformRole } from '../generated/prisma/client';
import { ADMIN_MIN_ROLE_KEY } from './admin.decorators';
import { allowsPlatform, platformRoleToWire } from './platform-role';

/**
 * The security boundary of the admin portal.
 *
 * Route-scoped rather than global: it runs *after* `SupabaseAuthGuard` (which is
 * an `APP_GUARD`) has verified the token and put the local user on the request,
 * so this guard only has to make the authorization decision.
 *
 * Design notes:
 * - The tier is read from `req.user.record`, the row the auth guard already
 *   loaded. No second read, and no way for a stale client-side claim to matter:
 *   the token never carries the role, the database does.
 * - A caller below the bar gets **403 with `{ required, actual }`**, the same
 *   shape `common/access.ts` uses for row-level refusals. Deliberately not a
 *   404: hiding the existence of `/admin` from a signed-in user buys nothing
 *   (the routes are in the client bundle) and makes every real permission
 *   problem look like a typo.
 * - A route in the admin module that somehow carries no `@AdminOnly()` is a
 *   programming error and answers 500, never an open door.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformRole | undefined>(ADMIN_MIN_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'ADMIN_ROUTE_MISCONFIGURED',
        'Admin route is missing @AdminOnly()',
      );
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) {
      // Only reachable if this guard were ever used without the auth guard.
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Missing bearer token');
    }

    const actual = user.record?.platformRole ?? PlatformRole.USER;
    if (!allowsPlatform(actual, required)) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Insufficient staff permissions', {
        required: platformRoleToWire(required),
        actual: platformRoleToWire(actual),
      });
    }

    // Network restriction first: when an allowlist is configured, an address
    // outside it is refused whatever tier it holds.
    this.assertAllowedNetwork(req);
    // Then the second factor, for the tiers that can change things.
    this.assertSecondFactor(user.aal, actual);
    return true;
  }

  /**
   * Refuses a request from outside `ADMIN_IP_ALLOWLIST`, when one is set.
   *
   * Prefix matching rather than CIDR arithmetic: `203.0.113.` is an unambiguous
   * way to write a /24 in an environment variable, and a subtly wrong CIDR
   * parser inside an access control fails in the direction that lets people in.
   */
  private assertAllowedNetwork(req: AuthenticatedRequest): void {
    const allowlist = this.config.get('ADMIN_IP_ALLOWLIST', { infer: true });
    if (!allowlist.length) {
      return;
    }
    const ip = clientIpOf(req);
    if (!ip || !allowlist.some((entry) => ip === entry || ip.startsWith(entry))) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'ADMIN_NETWORK_BLOCKED', 'The admin portal is not available here');
    }
  }

  /**
   * Requires a verified second factor for ADMIN and OWNER when
   * `ADMIN_REQUIRE_MFA` is on.
   *
   * SUPPORT is exempt: that tier reads and triages, and the accounts most
   * likely to hold it are the ones least likely to have enrolled. The code is
   * distinct from `FORBIDDEN` so the client can say "enrol a second factor"
   * rather than "you lack permission", which would be untrue and unactionable.
   */
  private assertSecondFactor(aal: string, role: PlatformRole): void {
    if (!this.config.get('ADMIN_REQUIRE_MFA', { infer: true })) {
      return;
    }
    if (!allowsPlatform(role, PlatformRole.ADMIN)) {
      return;
    }
    if (aal !== 'aal2') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'MFA_REQUIRED',
        'This deployment requires a second factor for admin access',
        { aal },
      );
    }
  }
}

/** Client IP, honouring the proxy chain nginx and Azure put in front of us. */
function clientIpOf(req: AuthenticatedRequest): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (first) {
    return first.split(',')[0]?.trim() || null;
  }
  return req.ip ?? null;
}
