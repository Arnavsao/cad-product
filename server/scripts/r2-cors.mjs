#!/usr/bin/env node
/**
 * Read or set the CORS policy on the drawings bucket (Cloudflare R2 in prod,
 * MinIO in dev).
 *
 * The browser talks to storage DIRECTLY: `StorageService.presignGet` /
 * `presignPut` hand out URLs on the bucket's own host, and the editor fetches
 * and uploads to them (`HttpManagerService.getText`,
 * `DrawingsApiService.uploadToStorage`). So the bucket — not the API, not
 * nginx — decides whether those requests are allowed, and a bucket with no
 * matching rule fails every open and every save with "No
 * 'Access-Control-Allow-Origin' header is present".
 *
 * This used to be a prose-only line in provision.sh's manual follow-ups, which
 * is exactly why it was missed when the custom domain was added.
 *
 *   node scripts/r2-cors.mjs --env-file ~/cado-prod.env               # show current
 *   node scripts/r2-cors.mjs --env-file ~/cado-prod.env --apply       # write policy
 *   node scripts/r2-cors.mjs --env-file ~/cado-prod.env --apply \
 *        --origin https://cado.website --origin https://www.cado.website
 *
 * Credentials come from the env file (or the ambient environment) — the same
 * S3_* variables the API already uses. Nothing is printed but the policy.
 */
import { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const all = (f) => argv.flatMap((a, i) => (argv[i - 1] === f ? [a] : []));
const one = (f) => all(f)[0];

if (has('--help')) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0]);
  process.exit(0);
}

const env = { ...process.env };
const envFile = one('--env-file');
if (envFile) {
  const path = envFile.replace(/^~/, process.env.HOME ?? '');
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const need = (k) => {
  const v = env[k];
  if (!v) { console.error(`missing ${k} (pass --env-file, or export it)`); process.exit(1); }
  return v;
};

const bucket = need('S3_BUCKET');
const endpoint = need('S3_ENDPOINT');

const origins = all('--origin');
if (!origins.length) {
  // Defaults: the production web origin, plus the dev server so a local build
  // pointed at real storage also works.
  origins.push('https://cado.website', 'https://www.cado.website', 'http://localhost:4200');
}

/**
 * GET is the drawing/thumbnail download; PUT is the presigned upload, which is
 * not a CORS-simple method and so preflights. The upload sends `Content-Type`
 * (it is part of the SigV4 signature — see StorageService.presignPut), which is
 * why that header has to be allowed by name. ETag is exposed so a caller can
 * read it off the upload response.
 */
// R2 validates this document strictly: unknown keys in the XML body are
// rejected, AllowedOrigins must be real origins, and AllowedHeaders entries
// must be non-empty. Keep to the standard CORSRule fields below.
const rules = [
  {
    AllowedOrigins: origins,
    AllowedMethods: ['GET', 'PUT', 'HEAD'],
    AllowedHeaders: ['content-type'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  },
];

const client = new S3Client({
  region: env.S3_REGION || 'auto',
  endpoint,
  forcePathStyle: String(env.S3_FORCE_PATH_STYLE) === 'true',
  credentials: { accessKeyId: need('S3_ACCESS_KEY'), secretAccessKey: need('S3_SECRET_KEY') },
});

console.log(`bucket   ${bucket}`);
console.log(`endpoint ${endpoint}`);

async function show(label) {
  try {
    const res = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log(`\n${label}:\n${JSON.stringify(res.CORSRules, null, 2)}`);
  } catch (e) {
    console.log(`\n${label}: none (${e.name})`);
  }
}

await show('current');

if (!has('--apply')) {
  console.log('\nwould write:\n' + JSON.stringify(rules, null, 2));
  console.log('\nre-run with --apply to write it.');
  process.exit(0);
}

try {
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } }));
} catch (e) {
  if (e.name === 'NotImplemented') {
    // MinIO does not expose PutBucketCors; it takes CORS through server
    // configuration instead. R2 and S3 both implement it.
    console.error(
      `\n${endpoint} does not implement PutBucketCors (this is MinIO, most likely).\n` +
        'MinIO is configured with MINIO_API_CORS_ALLOW_ORIGIN on the server, not per bucket —\n' +
        'see docker-compose.yml. Point --env-file at the R2 credentials to set the real policy.',
    );
    process.exit(1);
  }
  throw e;
}
await show('after');
