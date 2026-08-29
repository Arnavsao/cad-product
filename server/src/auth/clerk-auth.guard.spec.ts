import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mock, type MockProxy } from 'jest-mock-extended';
import { stubConfig } from '../../test/support/config';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ApiException } from '../common/errors/api-error';
import type { User } from '../generated/prisma/client';
import { UsersService } from '../users/users.service';
import type { AuthenticatedRequest } from './auth.types';
import { ClerkAuthGuard, extractBearer, type TokenVerifier } from './clerk-auth.guard';

const LOCAL_USER: User = {
  id: 'cuser000000000000000000001',
  clerkId: 'user_dev',
  email: 'dev@example.com',
  firstName: 'Dev',
  lastName: null,
  imageUrl: null,
  onboardedAt: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function contextFor(req: Partial<AuthenticatedRequest>, isPublic = false): { ctx: ExecutionContext; req: Partial<AuthenticatedRequest> } {
  const handler = isPublic ? Object.assign(() => undefined, { [IS_PUBLIC_KEY]: true }) : () => undefined;
  const ctx = {
    getHandler: () => handler,
    getClass: () => class Dummy {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('ClerkAuthGuard', () => {
  let reflector: MockProxy<Reflector>;
  let verify: jest.MockedFunction<TokenVerifier>;
  let users: MockProxy<UsersService>;
  let guard: ClerkAuthGuard;

  beforeEach(() => {
    reflector = mock<Reflector>();
    reflector.getAllAndOverride.mockImplementation((key: unknown, targets: unknown[]) => {
      const handler = (targets as Array<Record<string, unknown>>)[0];
      return key === IS_PUBLIC_KEY && handler?.[IS_PUBLIC_KEY] === true;
    });
    verify = jest.fn() as jest.MockedFunction<TokenVerifier>;
    users = mock<UsersService>();
    guard = new ClerkAuthGuard(
      reflector,
      stubConfig({ CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----' }),
      verify,
      users,
    );
  });

  it('bypasses @Public() routes without touching the token or the DB', async () => {
    const { ctx } = contextFor({ headers: {} }, true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(users.ensureLocalUser).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header with 401 UNAUTHENTICATED', async () => {
    const { ctx } = contextFor({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject<Partial<ApiException>>({ code: 'UNAUTHENTICATED' });
    const err = await guard.canActivate(ctx).catch((e: ApiException) => e);
    expect((err as ApiException).getStatus()).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a non-Bearer scheme with 401 UNAUTHENTICATED', async () => {
    const { ctx } = contextFor({ headers: { authorization: 'Basic abc' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('maps a verifier that throws to 401 INVALID_TOKEN', async () => {
    verify.mockRejectedValue(new Error('signature mismatch'));
    const { ctx } = contextFor({ headers: { authorization: 'Bearer bad' } });
    const err = await guard.canActivate(ctx).catch((e: ApiException) => e);
    expect(err).toBeInstanceOf(ApiException);
    expect((err as ApiException).code).toBe('INVALID_TOKEN');
    expect((err as ApiException).getStatus()).toBe(401);
    expect(users.ensureLocalUser).not.toHaveBeenCalled();
  });

  it('maps a verifier returning { errors } to 401 INVALID_TOKEN', async () => {
    verify.mockResolvedValue({ data: undefined, errors: [new Error('expired')] });
    const { ctx } = contextFor({ headers: { authorization: 'Bearer expired' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('passes the configured verification options', async () => {
    verify.mockResolvedValue({ sub: 'user_dev', sid: 'sess_dev' });
    users.ensureLocalUser.mockResolvedValue(LOCAL_USER);
    const { ctx } = contextFor({ headers: { authorization: 'Bearer good' } });
    await guard.canActivate(ctx);
    expect(verify).toHaveBeenCalledWith('good', {
      secretKey: undefined,
      jwtKey: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----',
      authorizedParties: ['http://localhost:4200'],
      clockSkewInMs: 10_000,
    });
  });

  it('prefers CLERK_AUTHORIZED_PARTIES over CORS_ORIGIN for azp', async () => {
    guard = new ClerkAuthGuard(
      reflector,
      stubConfig({ CLERK_SECRET_KEY: 'sk_test_x', CLERK_AUTHORIZED_PARTIES: ['https://app.example.com'] }),
      verify,
      users,
    );
    verify.mockResolvedValue({ sub: 'user_dev' });
    users.ensureLocalUser.mockResolvedValue(LOCAL_USER);
    const { ctx } = contextFor({ headers: { authorization: 'Bearer good' } });
    await guard.canActivate(ctx);
    expect(verify.mock.calls[0][1].authorizedParties).toEqual(['https://app.example.com']);
  });

  it('valid token → lazily ensures the local user and attaches req.user', async () => {
    verify.mockResolvedValue({ sub: 'user_dev', sid: 'sess_dev', azp: 'http://localhost:4200', email: 'dev@example.com' });
    users.ensureLocalUser.mockResolvedValue(LOCAL_USER);
    const { ctx, req } = contextFor({ headers: { authorization: 'Bearer good' } });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(users.ensureLocalUser).toHaveBeenCalledWith('user_dev', expect.objectContaining({ sub: 'user_dev', email: 'dev@example.com' }));
    expect(req.user).toEqual({ id: LOCAL_USER.id, clerkId: 'user_dev', sessionId: 'sess_dev' });
  });

  it('accepts the { data } result style too', async () => {
    verify.mockResolvedValue({ data: { sub: 'user_dev' } });
    users.ensureLocalUser.mockResolvedValue(LOCAL_USER);
    const { ctx, req } = contextFor({ headers: { authorization: 'Bearer good' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user?.sessionId).toBeNull();
  });

  it('rejects a soft-deleted user with 403 USER_DELETED', async () => {
    verify.mockResolvedValue({ sub: 'user_dev' });
    users.ensureLocalUser.mockResolvedValue({ ...LOCAL_USER, deletedAt: new Date() });
    const { ctx, req } = contextFor({ headers: { authorization: 'Bearer good' } });
    const err = await guard.canActivate(ctx).catch((e: ApiException) => e);
    expect((err as ApiException).code).toBe('USER_DELETED');
    expect((err as ApiException).getStatus()).toBe(403);
    expect(req.user).toBeUndefined();
  });

  it('answers 503 AUTH_NOT_CONFIGURED when neither key is set', async () => {
    guard = new ClerkAuthGuard(reflector, stubConfig(), verify, users);
    const { ctx } = contextFor({ headers: { authorization: 'Bearer good' } });
    const err = await guard.canActivate(ctx).catch((e: ApiException) => e);
    expect((err as ApiException).code).toBe('AUTH_NOT_CONFIGURED');
    expect((err as ApiException).getStatus()).toBe(503);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('extractBearer', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc', 'abc'],
    ['  Bearer   spaced  ', 'spaced'],
    ['Basic abc', null],
    ['Bearer', null],
    ['', null],
    [undefined, null],
  ])('%p → %p', (header, expected) => {
    expect(extractBearer(header as string | undefined)).toBe(expected);
  });

  it('takes the first value of a repeated header', () => {
    expect(extractBearer(['Bearer one', 'Bearer two'])).toBe('one');
  });
});
