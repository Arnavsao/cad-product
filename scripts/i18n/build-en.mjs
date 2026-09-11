/**
 * Composes `public/i18n/en.json` from two sources:
 *
 *  1. `registry-keys.en.json` — generated from the editor's two registries by
 *     `extract-registries.mjs`. Regenerated, never hand-edited.
 *  2. `app-strings.en.json`   — hand-written keys shared across areas
 *     (`common.*`, `auth.*`).
 *  3. `app-strings/<area>.en.json` — hand-written keys for one area of the app
 *     each (dashboard, editor panels, site…). One file per area keeps the
 *     files reviewable and lets several people add strings without merge
 *     conflicts. Every key must be unique across all sources.
 *
 * English is written into `en.json` even though `translateOr` can fall back to
 * the registry's own literals. Two reasons: Transloco's `fallbackLang` can then
 * resolve any missing key in any language without the code path, and
 * translators get one complete file to work from instead of one file plus
 * "…and also read these TypeScript literals".
 *
 * Run: node scripts/i18n/build-en.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));

const registry = read('scripts/i18n/registry-keys.en.json');

const fragmentDir = resolve(root, 'scripts/i18n/app-strings');
const sources = [
  ['scripts/i18n/app-strings.en.json', read('scripts/i18n/app-strings.en.json')],
  ...readdirSync(fragmentDir)
    .filter((f) => f.endsWith('.en.json'))
    .sort()
    .map((f) => [`scripts/i18n/app-strings/${f}`, read(`scripts/i18n/app-strings/${f}`)]),
];

const merged = { ...registry };
const owner = new Map(Object.keys(registry).map((k) => [k, 'scripts/i18n/registry-keys.en.json']));
let clashes = 0;
let app = {};
for (const [file, keys] of sources) {
  for (const [k, v] of Object.entries(keys)) {
    if (owner.has(k)) {
      if (clashes < 10) console.error(`  ${k}  in ${owner.get(k)} and ${file}`);
      clashes++;
      continue;
    }
    owner.set(k, file);
    merged[k] = v;
  }
  app = { ...app, ...keys };
}
if (clashes) {
  console.error(`refusing to build: ${clashes} key(s) defined in more than one source (listed above)`);
  process.exit(1);
}
const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));

writeFileSync(resolve(root, 'public/i18n/en.json'), JSON.stringify(sorted, null, 2) + '\n');
console.log(`en.json: ${Object.keys(sorted).length} keys (${Object.keys(registry).length} generated + ${Object.keys(app).length} hand-written)`);
