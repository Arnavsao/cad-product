import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.types';
import type { Actor } from '../access';

/**
 * Injects the caller as an `Actor` — `{ userId, email }`, the shape every
 * access decision takes (`common/access.ts`).
 *
 *   @Get(':id') get(@CurrentActor() actor: Actor, …)
 *
 * A separate decorator from `@CurrentUser()` rather than a mapping in each
 * controller: the `id` → `userId` rename and the lowercasing of the address are
 * the kind of thing that goes wrong in exactly one handler and is then very
 * hard to see. Like `@CurrentUser()`, using it on a `@Public()` route is a
 * programming error and answers 500, not 401.
 */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) {
    throw new InternalServerErrorException('@CurrentActor() used on a route without SupabaseAuthGuard');
  }
  return { userId: user.id, email: user.email.toLowerCase() };
});
