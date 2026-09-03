/**
 * Composes `public/i18n/en.json` from two sources:
 *
 *  1. `registry-keys.en.json` — generated from the editor's two registries by
 *     `extract-registries.mjs`. Regenerated, never hand-edited.
 *  2. `app-strings.en.json`   — hand-written keys for everything else
 *     (marketing, auth, dashboard, settings, dialogs).
 *
 * English is written into `en.json` even though `translateOr` can fall back to
 * the registry's own literals. Two reasons: Transloco's `fallbackLang` can then
 * resolve any missing key in any language without the code path, and
 * translators get one complete file to work from instead of one file plus
 * "…and also read these TypeScript literals".
 *
 * Run: node scripts/i18n/build-en.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));

const registry = read('scripts/i18n/registry-keys.en.json');
const app = read('scripts/i18n/app-strings.en.json');

const overlap = Object.keys(registry).filter((k) => k in app);
if (overlap.length) {
  console.error(`refusing to build: ${overlap.length} key(s) defined in both sources:`);
  for (const k of overlap.slice(0, 10)) console.error(`  ${k}`);
  process.exit(1);
}

const merged = { ...registry, ...app };
const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));

writeFileSync(resolve(root, 'public/i18n/en.json'), JSON.stringify(sorted, null, 2) + '\n');
console.log(`en.json: ${Object.keys(sorted).length} keys (${Object.keys(registry).length} generated + ${Object.keys(app).length} hand-written)`);
