import { SetMetadata } from '@nestjs/common';

/** Metadata key read by `SupabaseAuthGuard` to skip authentication. */
export const IS_PUBLIC_KEY = 'cad:isPublic';

/**
 * Marks a controller or handler as reachable without a session token.
 * Only `GET /healthz` should ever carry this; endpoints that are open but want
 * the caller identified when possible use `@OptionalAuth()` instead.
 */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(IS_PUBLIC_KEY, true);
