import { SignJWT } from 'jose';

/**
 * Self-minted, Supabase-shaped access tokens for tests and local development.
 *
 * `SupabaseAuthGuard` verifies with `jose` against either the project JWKS or
 * `SUPABASE_JWT_SECRET`, checking the signature, `iss`, `aud` and `exp`/`nbf`/`iat`
 * — and never calling Supabase. So signing here with the same shared secret that
 * the API has in `SUPABASE_JWT_SECRET` exercises the real guard end to end,
 * with no Supabase project and no network.
 *
 * HS256 is deliberate for the harness: a symmetric secret needs no keypair, so
 * there is no `.dev-keys` directory and no PEM plumbing to keep in sync.
 */

/** Project URL the tests pretend to be, and its derived issuer. */
export const TEST_SUPABASE_URL = 'https://test-project.supabase.co';
/** Any non-empty string works; both sides just have to agree. */
export const TEST_JWT_SECRET = 'test-jwt-secret-value-at-least-32-chars-long';

export interface SessionClaims {
  /** `auth.users.id` — a UUID in real tokens. */
  sub: string;
  /** Supabase session id. */
  sessionId?: string;
  email?: string;
  /** Goes under `user_metadata` (`full_name`, `avatar_url`, `first_name`, …). */
  userMetadata?: Record<string, unknown>;
  /** Lifetime in seconds (default 3600). Negative mints an already-expired token. */
  ttlSec?: number;
  /** Override the issuer — for asserting that a foreign project is rejected. */
  issuer?: string;
  /** Override the audience — for asserting a non-`authenticated` token is rejected. */
  audience?: string;
  /** Any further top-level claims. */
  extra?: Record<string, unknown>;
}

/** `https://x.supabase.co` → `https://x.supabase.co/auth/v1`. */
export function issuerFor(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

/** HS256 signing key from a shared secret. */
export function secretKey(secret: string = TEST_JWT_SECRET): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Mints an access token with Supabase's standard claim set. */
export async function mintSessionToken(claims: SessionClaims, secret: string = TEST_JWT_SECRET): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = claims.ttlSec ?? 3600;

  return new SignJWT({
    role: 'authenticated',
    session_id: claims.sessionId ?? '00000000-0000-4000-8000-00000000ffff',
    ...(claims.email ? { email: claims.email } : {}),
    ...(claims.userMetadata ? { user_metadata: claims.userMetadata } : {}),
    ...(claims.extra ?? {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(claims.issuer ?? issuerFor(TEST_SUPABASE_URL))
    .setAudience(claims.audience ?? 'authenticated')
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(now + ttl)
    .sign(secretKey(secret));
}

/** A deterministic UUID-shaped id, so tokens look like the real thing. */
export function testAuthId(suffix: string): string {
  const tail = suffix.replace(/[^0-9a-f]/gi, '').padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${tail}`;
}
