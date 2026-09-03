import { SetMetadata } from '@nestjs/common';

/** Metadata key read by `SupabaseAuthGuard` to authenticate without requiring it. */
export const OPTIONAL_AUTH_KEY = 'cad:optionalAuth';

/**
 * Marks a handler as reachable **with or without** a session: the guard verifies
 * a bearer token when one is present and populates `req.user`, but a missing,
 * expired or invalid token is not an error — the handler simply sees no user.
 *
 * This exists because `@Public()` returns before the guard ever looks at the
 * token, so `req.user` is `undefined` on a public route *even for a signed-in
 * caller*. Any endpoint that is open to anonymous traffic but wants to attribute
 * the request when it can (feedback being the first) needs this instead.
 *
 * `@CurrentUser()` is still unusable on these routes — it throws when `req.user`
 * is absent, which here is a legitimate outcome. Read `req.user?.id` directly.
 */
export const OptionalAuth = (): ClassDecorator & MethodDecorator => SetMetadata(OPTIONAL_AUTH_KEY, true);
