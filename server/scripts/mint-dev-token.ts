/**
 * Mint a Supabase-shaped access token for local development WITHOUT a Supabase
 * project.
 *
 *   npx tsx scripts/mint-dev-token.ts                          # token for a default user
 *   npx tsx scripts/mint-dev-token.ts --sub <uuid>             # a specific user id
 *   npx tsx scripts/mint-dev-token.ts --email ann@example.com
 *   npx tsx scripts/mint-dev-token.ts --write-env              # also set SUPABASE_* in .env
 *
 * The token is signed HS256 with the SAME secret the API verifies against, so
 * point both at the test values (that is what `--write-env` does) and then:
 *
 *   curl -s localhost:3000/api/v1/me -H "Authorization: Bearer $TOKEN"
 *
 * Unlike the old Clerk harness there is no keypair to generate or persist — a
 * shared secret is all HS256 needs, so `.dev-keys/` is gone.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mintSessionToken, TEST_JWT_SECRET, TEST_SUPABASE_URL, testAuthId } from '../test/support/jwt';

const envPath = resolve(__dirname, '..', '.env');

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function upsertEnvLine(key: string, value: string): void {
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(current) ? current.replace(re, line) : `${current.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(envPath, next);
}

async function main(): Promise<void> {
  const sub = arg('sub', testAuthId('dev'))!;
  const email = arg('email', `dev+${sub.slice(-6)}@example.com`)!;
  const name = arg('name', 'Dev User')!;
  const ttlSec = Number(arg('ttl', '3600'));

  if (flag('write-env')) {
    upsertEnvLine('SUPABASE_URL', TEST_SUPABASE_URL);
    upsertEnvLine('SUPABASE_JWT_SECRET', TEST_JWT_SECRET);
    console.error(`Wrote SUPABASE_URL and SUPABASE_JWT_SECRET (test values) to ${envPath}`);
    console.error('Restart the API so it picks them up.');
  } else {
    console.error(`Verify against: SUPABASE_URL=${TEST_SUPABASE_URL}`);
    console.error(`               SUPABASE_JWT_SECRET=${TEST_JWT_SECRET}`);
    console.error('(pass --write-env to put those in .env for you)');
  }

  const token = await mintSessionToken({ sub, email, ttlSec, userMetadata: { full_name: name } });
  console.error(`\nsub=${sub} email=${email} ttl=${ttlSec}s`);
  // stdout carries ONLY the token, so `TOKEN=$(npm run --silent mint-token)` works.
  console.log(token);
}

void main();
