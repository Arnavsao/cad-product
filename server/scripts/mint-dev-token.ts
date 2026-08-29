/**
 * Mint a Clerk-shaped session token for local development WITHOUT a Clerk
 * account.
 *
 *   npx tsx scripts/mint-dev-token.ts                 # prints a token for user_dev
 *   npx tsx scripts/mint-dev-token.ts --sub user_ann  # different user
 *   npx tsx scripts/mint-dev-token.ts --write-env     # also sets CLERK_JWT_KEY in .env
 *
 * First run generates an RS256 keypair under `.dev-keys/` (gitignored) and
 * prints the `CLERK_JWT_KEY=` line to paste into `.env` (or writes it with
 * `--write-env`). Subsequent runs reuse the keypair, so tokens stay valid
 * against the running API. Then:
 *
 *   curl -s localhost:3000/api/v1/me -H "Authorization: Bearer $TOKEN"
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDevKeypair, importPrivateKey, mintSessionToken, toEnvPem, type PrivateKey } from '../test/support/jwt';

// CommonJS (tsconfig `module: commonjs`, run via `npx tsx`): __dirname is available.
const serverRoot = resolve(__dirname, '..');
const keyDir = resolve(serverRoot, '.dev-keys');
const privatePath = resolve(keyDir, 'private.pem');
const publicPath = resolve(keyDir, 'public.pem');
const envPath = resolve(serverRoot, '.env');

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function loadOrCreateKeys(): Promise<{ privateKey: PrivateKey; publicPem: string; created: boolean }> {
  if (existsSync(privatePath) && existsSync(publicPath)) {
    return {
      privateKey: await importPrivateKey(readFileSync(privatePath, 'utf8')),
      publicPem: readFileSync(publicPath, 'utf8'),
      created: false,
    };
  }
  const pair = await createDevKeypair();
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(privatePath, pair.privatePem, { mode: 0o600 });
  writeFileSync(publicPath, pair.publicPem);
  return { privateKey: pair.privateKey, publicPem: pair.publicPem, created: true };
}

function upsertEnvLine(key: string, value: string): void {
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(current) ? current.replace(re, line) : `${current.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(envPath, next);
}

async function main(): Promise<void> {
  const sub = arg('sub', 'user_dev')!;
  const sid = arg('sid', 'sess_dev')!;
  const azp = arg('azp', 'http://localhost:4200')!;
  const ttlSec = Number(arg('ttl', '3600'));
  const email = arg('email', `${sub}@example.com`)!;

  const { privateKey, publicPem, created } = await loadOrCreateKeys();
  const envPem = toEnvPem(publicPem);

  if (flag('write-env')) {
    upsertEnvLine('CLERK_JWT_KEY', envPem);
    console.error(`✔ wrote CLERK_JWT_KEY to ${envPath} — restart the API if it is running`);
  } else if (created) {
    console.error(`✔ generated ${privatePath}\n  Add this to server/.env (or re-run with --write-env):\n`);
    console.error(`CLERK_JWT_KEY=${envPem}\n`);
  }

  const token = await mintSessionToken(privateKey, { sub, sid, azp, ttlSec, extra: { email, first_name: 'Dev' } });
  console.error(`sub=${sub} sid=${sid} azp=${azp} ttl=${ttlSec}s\n`);
  // Token on stdout only, so `TOKEN=$(npx tsx scripts/mint-dev-token.ts)` works.
  console.log(token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
