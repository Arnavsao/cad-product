import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT } from 'jose';

/**
 * Self-minted "Clerk-shaped" session tokens for tests and local development.
 *
 * `ClerkAuthGuard` verifies tokens with `@clerk/backend`'s `verifyToken`,
 * which — given `CLERK_JWT_KEY` (an RS256 public key PEM) — checks the
 * signature, `exp`/`nbf`/`iat` and the `azp` claim, and never talks to Clerk.
 * So a keypair we generate here, with the public half in `CLERK_JWT_KEY`,
 * exercises the real guard end-to-end without a Clerk account.
 */

/**
 * Private key type as produced by this jose version (jose 5: `KeyLike`;
 * jose 6: `CryptoKey`). Derived so a major upgrade does not break the API.
 * Note: jose 6 is ESM-only and cannot be `require()`d by Jest on Node < 24.9,
 * which is why the package pins jose 5.
 */
export type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

export interface DevKeypair {
  privateKey: PrivateKey;
  /** SPKI PEM — what goes into `CLERK_JWT_KEY` (after `toEnvPem`). */
  publicPem: string;
  /** PKCS8 PEM — persist to re-use the same key across runs. */
  privatePem: string;
}

export interface SessionClaims {
  /** Clerk user id, e.g. `user_dev`. */
  sub: string;
  /** Clerk session id, e.g. `sess_dev`. */
  sid?: string;
  /** Authorized party — must be in `CLERK_AUTHORIZED_PARTIES`/`CORS_ORIGIN`. */
  azp?: string;
  /** Lifetime in seconds (default 3600). Negative to mint an already-expired token. */
  ttlSec?: number;
  /** Extra claims (e.g. `email`, `first_name`) used by the no-secret-key user provisioning. */
  extra?: Record<string, unknown>;
}

/** Generates a fresh RS256 keypair. */
export async function createDevKeypair(): Promise<DevKeypair> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  return {
    privateKey,
    publicPem: await exportSPKI(publicKey),
    privatePem: await exportPKCS8(privateKey),
  };
}

/** Re-imports a PKCS8 private key PEM written by `createDevKeypair`. */
export async function importPrivateKey(privatePem: string): Promise<PrivateKey> {
  return importPKCS8(privatePem, 'RS256');
}

/** One-line, `\n`-escaped PEM for `.env` files. */
export function toEnvPem(pem: string): string {
  return pem.trim().replace(/\r?\n/g, '\\n');
}

/** Mints a session JWT with Clerk's standard claim set. */
export async function mintSessionToken(privateKey: PrivateKey, claims: SessionClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = claims.ttlSec ?? 3600;
  return new SignJWT({
    sid: claims.sid ?? 'sess_dev',
    azp: claims.azp ?? 'http://localhost:4200',
    ...(claims.extra ?? {}),
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'dev-key' })
    .setSubject(claims.sub)
    .setIssuer('https://dev.clerk.local')
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(now + ttl)
    .sign(privateKey);
}
