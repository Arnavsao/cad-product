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
 * - `CLERK_JWT_KEY` is a PEM with `\n` escaped on one line; we unescape it.
 * - `CORS_ORIGIN` / `CLERK_AUTHORIZED_PARTIES` are comma-separated lists.
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
  /** Allowed browser origins; also the default set of accepted `azp` claims. */
  CORS_ORIGIN: z
    .string()
    .min(1)
    .transform(splitCsv)
    .pipe(z.array(z.url()).min(1, 'CORS_ORIGIN must list at least one origin')),

  // --- Postgres -----------------------------------------------------------
  DATABASE_URL: z.string().min(1).startsWith('postgres', 'DATABASE_URL must be a postgres:// URL'),
  DIRECT_DATABASE_URL: z.string().min(1).startsWith('postgres', 'DIRECT_DATABASE_URL must be a postgres:// URL'),

  // --- Clerk --------------------------------------------------------------
  /** Optional: without it we cannot call the Clerk Backend API (lazy user data falls back to JWT claims). */
  CLERK_SECRET_KEY: optionalString,
  /** Optional: JWKS public key PEM for networkless verification. `\n`-escaped. */
  CLERK_JWT_KEY: optionalString.transform((pem) => pem?.replace(/\\n/g, '\n')),
  /** Optional: Svix signing secret. Without it `POST /webhooks/clerk` answers 503. */
  CLERK_WEBHOOK_SECRET: optionalString,
  /** Optional: accepted `azp` values; defaults to CORS_ORIGIN at the call site. */
  CLERK_AUTHORIZED_PARTIES: optionalString.transform((v) => (v ? splitCsv(v) : undefined)),

  // --- Object storage -----------------------------------------------------
  S3_ENDPOINT: z.url(),
  /** Endpoint embedded in presigned URLs when it differs from S3_ENDPOINT (containerised API). */
  S3_PUBLIC_ENDPOINT: optionalUrl,
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: boolFromString.default(true),

  // --- Limits -------------------------------------------------------------
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
  return result.data;
}
