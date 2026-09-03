import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from '../../auth/auth.types';

/**
 * Injects the principal set by `SupabaseAuthGuard`.
 *
 *   @Get() list(@CurrentUser() user: AuthUser)
 *   @Get() list(@CurrentUser('id') ownerId: string)
 *
 * Throws 500 (not 401) when used on a `@Public()` route: that is a programming
 * error, not a client error.
 */
export const CurrentUser = createParamDecorator((field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  const user = req.user;
  if (!user) {
    throw new InternalServerErrorException('@CurrentUser() used on a route without SupabaseAuthGuard');
  }
  return field ? user[field] : user;
});
