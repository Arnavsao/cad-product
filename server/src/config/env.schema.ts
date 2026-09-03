import { z } from 'zod';

/**
 * Environment schema (Zod). Validated once at boot by `ConfigModule.forRoot({
 * validate })` so a bad deployment fails fast with a readable list of problems
 * instead of a 500 on the first request.
 *
 * Conventions:
 * - Empty strings are treated as "unset" so `.env.example` can ship blank
 *   optional keys.
 * - Numerics use `z.coerce.number()` because process.env values are strings.
 * - `CORS_ORIGIN` is a comma-separated list.
 */

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

/** `''` → `undefined`, so optional keys may be present-but-blank in `.env`. */
const blankToUndefined = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const optionalString = z.preprocess(blankToUndefined, z.string().trim().optional());

const optionalUrl = z.preprocess(blankToUndefined, z.url().optional());

const boolFromString = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) {
      return true;
    }
    if (['0', 'false', 'no', 'off', ''].includes(v)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const splitCsv = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

export const envSchema = z.object({
  // --- HTTP ---------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** Allowed browser origins (CORS only). */
  CORS_ORIGIN: z
    .string()
    .min(1)
    .transform(splitCsv)
    .pipe(z.array(z.url()).min(1, 'CORS_ORIGIN must list at least one origin')),

  // --- Postgres -----------------------------------------------------------
  DATABASE_URL: z.string().min(1).startsWith('postgres', 'DATABASE_URL must be a postgres:// URL'),
  DIRECT_DATABASE_URL: z.string().min(1).startsWith('postgres', 'DIRECT_DATABASE_URL must be a postgres:// URL'),

  // --- Supabase auth ------------------------------------------------------
  /**
   * Project URL (`https://<ref>.supabase.co`). Required to verify tokens: it is
   * both the expected `iss` (`<url>/auth/v1`) and where the JWKS lives. Optional
   * only so the API still boots unconfigured — auth then answers 503.
   */
  SUPABASE_URL: optionalUrl,
  /**
   * Optional: legacy symmetric JWT secret (Settings → API → JWT Secret). When set,
   * tokens are verified HS256 with it. Leave empty on projects using asymmetric
   * signing keys, where the JWKS under SUPABASE_URL is used instead.
   */
  SUPABASE_JWT_SECRET: optionalString,

  // --- Object storage -----------------------------------------------------
  S3_ENDPOINT: z.url(),
  /** Endpoint embedded in presigned URLs when it differs from S3_ENDPOINT (containerised API). */
  S3_PUBLIC_ENDPOINT: optionalUrl,
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: boolFromString.default(true),

  // --- Transactional email ------------------------------------------------
  // All optional: the API must still boot with none of them set, which is the
  // development default. `MailModule` then picks the logging transport.
  /** Resend API key. Absent → email is logged, never sent (see `MailService`). */
  RESEND_API_KEY: optionalString,
  /** Envelope From, e.g. `CADOnline <no-reply@cadonline.app>`. Required to send. */
  MAIL_FROM: optionalString,
  /** Optional Reply-To applied to all outbound mail. */
  MAIL_REPLY_TO: optionalString,
  /**
   * Public origin of the web app, used to build links in emails. The API cannot
   * infer it: requests arrive from the client's own host and `CORS_ORIGIN` may
   * list several. Defaults to the first CORS origin, which is right in dev.
   */
  APP_BASE_URL: optionalUrl,

  // --- Billing (Dodo Payments) ---------------------------------------------
  /**
   * All FOUR keys are OPTIONAL, and billing is off unless the API key and the
   * two product ids are present. That mirrors `MailModule`'s rule: local
   * development has no Dodo account, and the checkout endpoints answering
   * `503 BILLING_NOT_CONFIGURED` is far better than the API refusing to boot
   * and making every other feature undemonstrable.
   *
   * Secret key from the Dodo dashboard (Developer -> API keys). A `sk_test_…`
   * key selects test mode below; anything else selects live mode.
   */
  DODO_API_KEY: optionalString,
  /**
   * Signing secret for the webhook endpoint (Developer -> Webhooks -> Overview).
   *
   * Without it the webhook route rejects EVERY delivery with 503 rather than
   * trusting an unverified body. That is deliberate: an unauthenticated route
   * that mutates a user's plan is the single most dangerous thing in this
   * module, so "not configured" must fail closed, never open.
   */
  DODO_WEBHOOK_KEY: optionalString,
  /**
   * Product ids backing the Pro and Team tiers on the pricing page. Ids live in
   * config rather than in code because they differ between Dodo's test and live
   * modes, so hardcoding them would make a test-mode checkout impossible.
   *
   * Monthly and annual are separate products in Dodo, hence four ids.
   */
  DODO_PRODUCT_PRO_MONTHLY: optionalString,
  DODO_PRODUCT_PRO_ANNUAL: optionalString,
  DODO_PRODUCT_TEAM_MONTHLY: optionalString,
  DODO_PRODUCT_TEAM_ANNUAL: optionalString,

  // --- Limits -------------------------------------------------------------
  /**
   * Default per-IP request budget, in requests per `RATE_LIMIT_TTL_MS`.
   *
   * Configurable because the e2e suites all run in ONE process, `--runInBand`,
   * against a single in-memory counter from a single IP: their combined traffic
   * is a plausible fraction of the production budget, so a slow run used to trip
   * the limiter and fail unrelated tests. The harness raises this instead of the
   * production default being weakened to accommodate it.
   */
  RATE_LIMIT_LIMIT: positiveInt(300),
  RATE_LIMIT_TTL_MS: positiveInt(60_000),

  MAX_INLINE_CONTENT_BYTES: positiveInt(5 * 1024 * 1024),
  MAX_UPLOAD_BYTES: positiveInt(50 * 1024 * 1024),
  MAX_THUMBNAIL_BYTES: positiveInt(512 * 1024),
  MAX_VERSIONS_PER_DRAWING: positiveInt(50),
  DOWNLOAD_URL_TTL_SECONDS: positiveInt(600),
  THUMBNAIL_URL_TTL_SECONDS: positiveInt(7200),
});

/** Fully validated + transformed environment. `CORS_ORIGIN` is an array here. */
export type Env = z.infer<typeof envSchema>;

/** Raw (pre-validation) key names, handy for scripts. */
export type EnvKey = keyof Env;

/**
 * `ConfigModule.forRoot({ validate })` hook. Throws with every problem listed
 * so an operator fixes them all in one go.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  // `@nestjs/config` falls back to raw `process.env` whenever a validated key
  // is `undefined`, so a blank line in `.env` (`SUPABASE_JWT_SECRET=`) reaches
  // `config.get()` as `''` — which is NOT nullish, so `?? fallback` keeps the
  // empty string. That has bitten twice already: an empty `S3_PUBLIC_ENDPOINT`
  // made the presigner sign for real AWS instead of MinIO, and an empty
  // authorized-parties list once made token verification skip its audience
  // check altogether, accepting tokens minted for any other frontend.
  //
  // Deleting the blank keys here restores `undefined` at the fallback site, so
  // the whole class of bug cannot recur for a future optional key.
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.trim() === '') {
      delete process.env[key];
    }
  }

  return result.data;
}
