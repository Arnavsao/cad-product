/**
 * Lists the keys `en.json` has that a given language file lacks, as JSON, so a
 * translator (human or agent) gets a worklist of exactly the strings to add.
 *
 *   node scripts/i18n/missing.mjs de            -> {"key": "English text", ...} on stdout
 *   node scripts/i18n/missing.mjs de --prefix site.   (only keys under a prefix)
 *   node scripts/i18n/missing.mjs de --count    -> just the number
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [lang, ...flags] = process.argv.slice(2);
if (!lang) {
  console.error('usage: node scripts/i18n/missing.mjs <lang> [--prefix p] [--count]');
  process.exit(2);
}
const read = (f) => JSON.parse(readFileSync(resolve(root, 'public/i18n', f), 'utf8'));
const en = read('en.json');
const target = read(`${lang}.json`);
const prefixIdx = flags.indexOf('--prefix');
const prefix = prefixIdx >= 0 ? flags[prefixIdx + 1] : '';

const missing = Object.fromEntries(
  Object.keys(en)
    .filter((k) => !(k in target) && k.startsWith(prefix))
    .sort()
    .map((k) => [k, en[k]]),
);
if (flags.includes('--count')) console.log(Object.keys(missing).length);
else process.stdout.write(JSON.stringify(missing, null, 2) + '\n');
