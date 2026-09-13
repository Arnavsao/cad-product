import { SetMetadata } from '@nestjs/common';
import { PlatformRole } from '../generated/prisma/client';

/** Metadata key read by `AdminGuard`. */
export const ADMIN_MIN_ROLE_KEY = 'cad:adminMinRole';

/**
 * Declares the minimum staff tier for a controller or handler.
 *
 * `@AdminOnly()` alone means SUPPORT, which is the read tier — a portal route
 * that forgets to say what it needs therefore gets the *most* restrictive
 * useful default rather than the least. Handler metadata overrides the class's,
 * so a controller can be `@AdminOnly()` with one `@AdminOnly(PlatformRole.OWNER)`
 * method inside it.
 */
export const AdminOnly = (min: PlatformRole = PlatformRole.SUPPORT): ClassDecorator & MethodDecorator =>
  SetMetadata(ADMIN_MIN_ROLE_KEY, min);
