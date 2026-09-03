import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

/** Options a verifier needs; mirrors what the guard reads out of config. */
export interface SupabaseVerifierConfig {
  /** Project URL, e.g. `https://abc.supabase.co`. Trailing slash tolerated. */
  supabaseUrl?: string;
  /** Legacy symmetric JWT secret. When present, HS256 is used. */
  jwtSecret?: string;
  /** Accepted clock skew, in seconds. */
  clockToleranceSec: number;
}

/**
 * Shape of the verification function the guard depends on. Kept deliberately
 * loose in its return type so the guard's existing normalisation still applies
 * and so tests can substitute a plain stub.
 */
export type TokenVerifier = (token: string) => Promise<unknown>;

/** Supabase issues access tokens with this audience for a signed-in user. */
export const SUPABASE_AUDIENCE = 'authenticated';

/** `https://abc.supabase.co` → `https://abc.supabase.co/auth/v1` (the `iss`). */
export function issuerFor(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

/** Where a project publishes its public signing keys. */
export function jwksUrlFor(supabaseUrl: string): URL {
  return new URL(`${issuerFor(supabaseUrl)}/.well-known/jwks.json`);
}

/**
 * Builds the token verifier.
 *
 * Two signing modes, chosen by what the environment provides:
 *
 * - **`SUPABASE_JWT_SECRET` set** — HS256 against that shared secret. This is the
 *   legacy scheme and is checked first because a project that still has a symmetric
 *   secret configured is signing with it.
 * - **Otherwise** — asymmetric keys fetched from the project's JWKS. `jose` caches
 *   the key set, so steady-state verification makes no network call. This is the
 *   "networkless after warm-up" property we want from a request-path verifier.
 *
 * `iss` and `aud` are both asserted. That matters: Supabase has no `azp` claim, so
 * these two are what stop an access token minted by a *different* Supabase project
 * from being replayed against this API. Dropping them would leave the API accepting
 * any validly-signed Supabase token from anywhere.
 *
 * Returns `null` when neither mode is configured, which the guard turns into
 * 503 `AUTH_NOT_CONFIGURED` rather than silently accepting everything.
 */
export function createSupabaseVerifier(config: SupabaseVerifierConfig): TokenVerifier | null {
  const { supabaseUrl, jwtSecret, clockToleranceSec } = config;

  // Without the project URL there is no issuer to check and no JWKS to fetch.
  if (!supabaseUrl) {
    return null;
  }
  const issuer = issuerFor(supabaseUrl);
  const shared = {
    issuer,
    audience: SUPABASE_AUDIENCE,
    clockTolerance: clockToleranceSec,
  };

  if (jwtSecret) {
    const key = new TextEncoder().encode(jwtSecret);
    return async (token: string): Promise<JWTPayload> => {
      const { payload } = await jwtVerify(token, key, { ...shared, algorithms: ['HS256'] });
      return payload;
    };
  }

  // One JWKS instance per verifier so `jose`'s cache is actually reused; building
  // it per request would fetch the key set on every call.
  const jwks: JWTVerifyGetKey = createRemoteJWKSet(jwksUrlFor(supabaseUrl));
  return async (token: string): Promise<JWTPayload> => {
    const { payload } = await jwtVerify(token, jwks, { ...shared, algorithms: ['RS256', 'ES256'] });
    return payload;
  };
}
