import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../common/errors/api-error';
import { PlatformRole, type User } from '../generated/prisma/client';
import { AdminGuard } from './admin.guard';
import { ADMIN_MIN_ROLE_KEY } from './admin.decorators';

function userWith(role: PlatformRole): User {
  return {
    id: 'cuser000000000000000000001',
    authId: '00000000-0000-4000-8000-000000000001',
    email: 'staff@example.com',
    firstName: null,
    lastName: null,
    imageUrl: null,
    onboardedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    platformRole: role,
    suspendedAt: null,
    suspendedReason: null,
    lastSeenAt: null,
  };
}

/** Minimal ExecutionContext carrying the route's declared minimum and a user. */
function contextFor(required: PlatformRole | undefined, user: User | undefined): ExecutionContext {
  const handler = () => undefined;
  if (required) {
    Reflect.defineMetadata(ADMIN_MIN_ROLE_KEY, required, handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user: user ? { id: user.id, record: user } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard(new Reflector());

  it('admits a role at the required tier', () => {
    expect(guard.canActivate(contextFor(PlatformRole.SUPPORT, userWith(PlatformRole.SUPPORT)))).toBe(true);
  });

  it('admits a role above the required tier', () => {
    expect(guard.canActivate(contextFor(PlatformRole.SUPPORT, userWith(PlatformRole.OWNER)))).toBe(true);
  });

  it('refuses a plain user with 403 and both tiers named', () => {
    const context = contextFor(PlatformRole.SUPPORT, userWith(PlatformRole.USER));
    try {
      guard.canActivate(context);
      fail('expected a refusal');
    } catch (error) {
      const api = error as ApiException;
      expect(api.getStatus()).toBe(403);
      expect(api.code).toBe('FORBIDDEN');
      // The client shows "you need admin"; without both values it cannot.
      expect(api.extra).toEqual({ required: 'support', actual: 'user' });
    }
  });

  it('refuses SUPPORT on an ADMIN route', () => {
    const context = contextFor(PlatformRole.ADMIN, userWith(PlatformRole.SUPPORT));
    expect(() => guard.canActivate(context)).toThrow(ApiException);
  });

  it('refuses ADMIN on an OWNER route', () => {
    const context = contextFor(PlatformRole.OWNER, userWith(PlatformRole.ADMIN));
    expect(() => guard.canActivate(context)).toThrow(ApiException);
  });

  it('treats a missing user record as a plain user rather than trusting it', () => {
    const user = userWith(PlatformRole.OWNER);
    const context = {
      getHandler: () => {
        const handler = () => undefined;
        Reflect.defineMetadata(ADMIN_MIN_ROLE_KEY, PlatformRole.SUPPORT, handler);
        return handler;
      },
      getClass: () => class Controller {},
      // `record` absent: the guard must not assume the tier from anything else.
      switchToHttp: () => ({ getRequest: () => ({ user: { id: user.id } }) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(context)).toThrow(ApiException);
  });

  it('fails closed when the route forgot @AdminOnly()', () => {
    try {
      guard.canActivate(contextFor(undefined, userWith(PlatformRole.OWNER)));
      fail('expected a refusal');
    } catch (error) {
      const api = error as ApiException;
      expect(api.getStatus()).toBe(500);
      expect(api.code).toBe('ADMIN_ROUTE_MISCONFIGURED');
    }
  });

  it('refuses an unauthenticated request', () => {
    expect(() => guard.canActivate(contextFor(PlatformRole.SUPPORT, undefined))).toThrow(ApiException);
  });
});
