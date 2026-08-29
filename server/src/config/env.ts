import { ConfigService } from '@nestjs/config';
import { Env, validateEnv } from './env.schema';

export type { Env, EnvKey } from './env.schema';
export { envSchema, validateEnv } from './env.schema';

/**
 * Typed `ConfigService`. Inject as `ConfigService<Env, true>` and read with
 * `config.get('PORT', { infer: true })` — the second generic marks every key as
 * present (the Zod schema guarantees defaults), so no `!` or `?? fallback`
 * noise in services.
 */
export type TypedConfigService = ConfigService<Env, true>;

/**
 * Loads and validates the environment outside Nest (scripts, e2e bootstrap).
 * Reads `process.env` only — callers load `.env` with dotenv first.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return validateEnv(source as Record<string, unknown>);
}
