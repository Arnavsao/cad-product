import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mock, type MockProxy } from 'jest-mock-extended';
import { mintSessionToken, TEST_JWT_SECRET, TEST_SUPABASE_URL, testAuthId } from '../../test/support/jwt';
import { OPTIONAL_AUTH_KEY } from '../common/decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ApiException } from '../common/errors/api-error';
import type { User } from '../generated/prisma/client';
import { UsersService } from '../users/users.service';
import type { AuthenticatedRequest } from './auth.types';
import { extractBearer, SupabaseAuthGuard, type TokenVerifier } from './supabase-auth.guard';
import { createSupabaseVerifier } from './supabase-token-verifier';

const AUTH_ID = testAuthId('dev');

const LOCAL_USER: User = {
  id: 'cuser000000000000000000001',
  authId: AUTH_ID,
  email: 'dev@example.com',
  firstName: 'Dev',
  lastName: null,
  imageUrl: null,
  onboardedAt: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

/** Fabricates an ExecutionContext, stamping metadata keys onto the fake handler. */
function contextFor(
  req: Partial<AuthenticatedRequest>,
  metadata: Record<string, boolean> = {},
): { ctx: ExecutionContext; req: Partial<AuthenticatedRequest> } {
  const handler = Object.assign(() => undefined, metadata);
  const ctx = {
    getHandler: () => handler,
    getClass: () => class Dummy {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('SupabaseAuthGuard', () => {
  let reflector: MockProxy<Reflector>;
  let verify: jest.MockedFunction<TokenVerifier>;
  let users: MockProxy<UsersService>;
  let guard: SupabaseAuthGuard;

  beforeEach(() => {
    reflector = mock<Reflector>();
    // Generic: reads whichever metadata key the guard asks for off the fake
    // handler, so `@Public()` and `@OptionalAuth()` are both driveable.
    reflector.getAllAndOverride.mockImplementation((key: unknown, targets: unknown[]) => {
      const handler = (targets as Array<Record<string, unknown>>)[0];
      return handler?.[key as string] === true;
    });
    verify = jest.fn() as jest.MockedFunction<TokenVerifier>;
    users = mock<UsersService>();
    guard = new SupabaseAuthGuard(reflector, verify, users);
  });

  it('bypasses @Public() routes without touching the token or the DB', async () => {
    const { ctx } = contextFor({ headers: {} }, { [IS_PUBLIC_KEY]: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(users.ensureLocalUser).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header with 401 UNAUTHENTICATED', async () => {
    const { ctx } = contextFor({ headers: {} });
    const err = await guard.canActivate(ctx).catch((e: ApiException) => e);
    expect((err as ApiException).code).toBe('UNAUTHENTICATED');
    expect((err as ApiException).getStatus()).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a non-Bearer scheme with 401 UNAUTHENTICATED', async () => {
    const { ctx } = contextFor({ headers: { authorization: 'Basic abc' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('maps a verifier that throws to 401 INVALID_TOKEN', async () => {
    verify.mockRejectedValue(new Error('signature verification failed'));
    const { ctx } = contextFor({ headers: { authorization: 'Bearer bad' } });
    const err = await guard.canActivate(ctx).catch((e: ApiException) => e);
    expect((err as ApiException).code).toBe('INVALID_TOKEN');
    expect((err as ApiException).getStatus()).toBe(401);
  });

  it('maps a verifier returning { errors } to 401 INVALID_TOKEN', async () => {
    verify.mockResolvedValue({ data: undefined, errors: [new Error('expired')] });
    const { ctx } = contextFor({ headers: { authorization: 'Bearer bad' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('rejects a payload without a string sub', async () => {
    verify.mockResolvedValue({ email: 'nobody@example.com' });
    const { ctx } = contextFor({ headers: { authorization: 'Bearer weird' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('valid token → lazily ensures the local user and attaches req.user', async () => {
    verify.mockResolvedValue({ sub: AUTH_ID, session_id: 'sess-1' });
    users.ensureLocalUser.mockResolvedValue(LOCAL_USER);
    const { ctx, req } = contextFor({ headers: { authorization: 'Bearer good' } });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(users.ensureLocalUser).toHaveBeenCalledWith(AUTH_ID, { sub: AUTH_ID, session_id: 'sess-1' });
    expect(req.user).toEqual({ id: LOCAL_USER.id, authId: AUTH_ID, email: 'dev@example.com', sessionId: 'sess-1' });
  });

  it('accepts the { data } result style too', async () => {
    verify.mockResolvedValue({ data: { sub: AUTH_ID } });
    users.ensureLocalUser.mockResolvedValue(LOCAL_USER);
    const { ctx, req } = contextFor({ headers: { authorization: 'Bearer good' } });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user?.sessionId).toBeNull();
  });

  it('rejects a soft-deleted user with 403 USER_DELETED', async () => {
    verify.mockResolvedValue({ sub: AUTH_ID });
    users.ensureLocalUser.mockResolvedValue({ ...LOCAL_USER, deletedAt: new Date() });
    const { ctx } = contextFor({ headers: { authorization: 'Bearer good' } });

    const err = await guard.canActivate(ctx).catch((e: ApiException) => e);
    expect((err as ApiException).code).toBe('USER_DELETED');
    expect((err as ApiException).getStatus()).toBe(403);
  });

  it('answers 503 AUTH_NOT_CONFIGURED when no verifier could be built', async () => {
    guard = new SupabaseAuthGuard(reflector, null, users);
    const { ctx } = contextFor({ headers: { authorization: 'Bearer good' } });
    const err = await guard.canActivate(ctx).catch((e: ApiException) => e);
    expect((err as ApiException).code).toBe('AUTH_NOT_CONFIGURED');
    expect((err as ApiException).getStatus()).toBe(503);
  });

  // ---------------------------------------------------------------------------
  // @OptionalAuth() — reachable anonymously, but attributed when possible.
  // @Public() returns before the token is ever read, so a public route sees
  // `req.user === undefined` even for a signed-in caller.
  // ---------------------------------------------------------------------------

  describe('@OptionalAuth()', () => {
    const optionalContext = (req: Partial<AuthenticatedRequest>) => contextFor(req, { [OPTIONAL_AUTH_KEY]: true });

    it('allows a request with no token through as anonymous', async () => {
      const { ctx, req } = optionalContext({ headers: {} });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.user).toBeUndefined();
      expect(verify).not.toHaveBeenCalled();
    });

    it('attaches req.user when a valid token IS present', async () => {
      verify.mockResolvedValue({ sub: AUTH_ID, session_id: 'sess-1' });
      users.ensureLocalUser.mockResolvedValue(LOCAL_USER);
      const { ctx, req } = optionalContext({ headers: { authorization: 'Bearer good' } });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.user).toEqual({ id: LOCAL_USER.id, authId: AUTH_ID, email: 'dev@example.com', sessionId: 'sess-1' });
    });

    it('treats an invalid or expired token as anonymous rather than 401', async () => {
      verify.mockRejectedValue(new Error('token expired'));
      const { ctx, req } = optionalContext({ headers: { authorization: 'Bearer stale' } });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.user).toBeUndefined();
      expect(users.ensureLocalUser).not.toHaveBeenCalled();
    });

    it('still refuses a soft-deleted account', async () => {
      verify.mockResolvedValue({ sub: AUTH_ID });
      users.ensureLocalUser.mockResolvedValue({ ...LOCAL_USER, deletedAt: new Date() });
      const { ctx } = optionalContext({ headers: { authorization: 'Bearer good' } });

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'USER_DELETED' });
    });
  });
});

// -----------------------------------------------------------------------------
// The verifier itself, with real crypto. These are the cases that actually
// defend the API: `iss` and `aud` replace Clerk's `azp` check as the thing that
// stops a validly-signed token from ANOTHER Supabase project being replayed here.
// -----------------------------------------------------------------------------

describe('createSupabaseVerifier (HS256)', () => {
  const verifier = () =>
    createSupabaseVerifier({
      supabaseUrl: TEST_SUPABASE_URL,
      jwtSecret: TEST_JWT_SECRET,
      clockToleranceSec: 10,
    })!;

  it('returns null when the project URL is missing, so the guard can answer 503', () => {
    expect(createSupabaseVerifier({ jwtSecret: TEST_JWT_SECRET, clockToleranceSec: 10 })).toBeNull();
  });

  it('accepts a well-formed token and returns its claims', async () => {
    const token = await mintSessionToken({ sub: AUTH_ID, email: 'dev@example.com' });
    const claims = (await verifier()(token)) as Record<string, unknown>;
    expect(claims.sub).toBe(AUTH_ID);
    expect(claims.email).toBe('dev@example.com');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await mintSessionToken({ sub: AUTH_ID }, 'a-completely-different-secret-value-32ch');
    await expect(verifier()(token)).rejects.toThrow();
  });

  it("rejects a token from another project (wrong iss)", async () => {
    const token = await mintSessionToken({ sub: AUTH_ID, issuer: 'https://someone-else.supabase.co/auth/v1' });
    await expect(verifier()(token)).rejects.toThrow();
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await mintSessionToken({ sub: AUTH_ID, audience: 'anon' });
    await expect(verifier()(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await mintSessionToken({ sub: AUTH_ID, ttlSec: -120 });
    await expect(verifier()(token)).rejects.toThrow();
  });

  it('tolerates a token that expired within the clock-skew window', async () => {
    // Expired 5s ago, inside the 10s tolerance — a slightly fast server clock
    // must not start rejecting live sessions.
    const token = await mintSessionToken({ sub: AUTH_ID, ttlSec: -5 });
    await expect(verifier()(token)).resolves.toBeDefined();
  });
});

describe('extractBearer', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['  Bearer   abc  ', 'abc'],
    ['Basic abc', null],
    ['abc', null],
    ['', null],
    [undefined, null],
  ])('%p → %p', (header, expected) => {
    expect(extractBearer(header as string | undefined)).toBe(expected);
  });

  it('takes the first value of a repeated header', () => {
    expect(extractBearer(['Bearer first', 'Bearer second'])).toBe('first');
  });
});
