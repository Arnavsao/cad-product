import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
  constructor(private readonly reflector: Reflector) {}

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
    return true;
  }
}
