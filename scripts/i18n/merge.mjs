/**
 * Merges a translated fragment into `public/i18n/<lang>.json`, keeping the
 * file sorted and refusing keys that `en.json` does not have (a typo in a key
 * would otherwise become silent dead weight that the validator flags as `extra`).
 *
 *   node scripts/i18n/merge.mjs de path/to/fragment.json [more fragments…]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [lang, ...fragments] = process.argv.slice(2);
if (!lang || !fragments.length) {
  console.error('usage: node scripts/i18n/merge.mjs <lang> <fragment.json>…');
  process.exit(2);
}
const file = resolve(root, 'public/i18n', `${lang}.json`);
const en = JSON.parse(readFileSync(resolve(root, 'public/i18n/en.json'), 'utf8'));
const target = JSON.parse(readFileSync(file, 'utf8'));

let added = 0;
let rejected = 0;
for (const f of fragments) {
  const frag = JSON.parse(readFileSync(resolve(f), 'utf8'));
  for (const [k, v] of Object.entries(frag)) {
    if (!(k in en)) {
      console.error(`  not in en.json, skipped: ${k}`);
      rejected++;
      continue;
    }
    if (typeof v !== 'string' || !v.trim()) {
      console.error(`  empty value, skipped: ${k}`);
      rejected++;
      continue;
    }
    if (!(k in target)) added++;
    target[k] = v;
  }
}
const sorted = Object.fromEntries(Object.keys(target).sort().map((k) => [k, target[k]]));
writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
console.log(`${lang}.json: +${added} keys (${rejected} rejected), now ${Object.keys(sorted).length}`);
