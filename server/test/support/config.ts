import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.schema';

/** A complete, valid `Env` for unit tests; override what matters per test. */
export const TEST_ENV: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'silent',
  CORS_ORIGIN: ['http://localhost:4200'],
  DATABASE_URL: 'postgresql://cad:cad@localhost:5432/cad',
  DIRECT_DATABASE_URL: 'postgresql://cad:cad@localhost:5432/cad',
  SUPABASE_URL: undefined,
  SUPABASE_JWT_SECRET: undefined,
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: undefined,
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'drawings',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  S3_FORCE_PATH_STYLE: true,
  RATE_LIMIT_LIMIT: 300,
  RATE_LIMIT_TTL_MS: 60_000,
  MAX_INLINE_CONTENT_BYTES: 5 * 1024 * 1024,
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
  MAX_THUMBNAIL_BYTES: 512 * 1024,
  MAX_VERSIONS_PER_DRAWING: 50,
  DOWNLOAD_URL_TTL_SECONDS: 600,
  THUMBNAIL_URL_TTL_SECONDS: 7200,
};

/**
 * Minimal `ConfigService<Env, true>` stand-in: supports `get(key)` and
 * `get(key, { infer: true })`, which is all our services use.
 */
export function stubConfig(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const env: Env = { ...TEST_ENV, ...overrides };
  const stub = {
    get: (key: keyof Env) => env[key],
    getOrThrow: (key: keyof Env) => {
      const v = env[key];
      if (v === undefined) {
        throw new Error(`Missing ${String(key)}`);
      }
      return v;
    },
  };
  return stub as unknown as ConfigService<Env, true>;
}
