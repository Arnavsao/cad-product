import { SetMetadata } from '@nestjs/common';

/** Metadata key read by `ClerkAuthGuard` to skip authentication. */
export const IS_PUBLIC_KEY = 'cad:isPublic';

/**
 * Marks a controller or handler as reachable without a Clerk session token.
 * Only `GET /healthz` and `POST /webhooks/clerk` should ever carry this.
 */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(IS_PUBLIC_KEY, true);
