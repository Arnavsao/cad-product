/**
 * Checks every translation file against `en.json`.
 *
 * The failure this exists to catch: a key added to a template and to `en.json`
 * but not to the other thirteen files. Transloco's fallback means that ships
 * *silently* — the string renders in English for a Japanese user and nothing
 * errors — so nothing but a check like this will tell you. Run it in CI.
 *
 * Reports, per language:
 *   missing    keys in en.json that this language does not have  -> renders English
 *   extra      keys this language has that en.json does not      -> dead weight
 *   untranslated  values byte-identical to English               -> may be fine (cognates)
 *   params     keys whose {{placeholders}} differ from English   -> renders a literal
 *
 * Exits non-zero on missing, extra, or mismatched params. `untranslated` is
 * reported but never fatal: "Pan", "Spline" and "2P" are genuinely the same
 * word in several of these languages.
 *
 * Run: node scripts/i18n/validate.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(root, 'public/i18n');
const read = (f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));

const en = read('en.json');
const enKeys = new Set(Object.keys(en));
const paramsOf = (s) => (String(s).match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).map((p) => p.replace(/[{}\s]/g, '')).sort();

const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json').sort();
let failed = false;

console.log(`en.json: ${enKeys.size} keys\n`);
for (const file of files) {
  const lang = file.replace(/\.json$/, '');
  const t = read(file);
  const keys = new Set(Object.keys(t));

  const missing = [...enKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !enKeys.has(k));
  const untranslated = [...keys].filter((k) => enKeys.has(k) && t[k] === en[k]);
  const badParams = [...keys].filter(
    (k) => enKeys.has(k) && paramsOf(t[k]).join(',') !== paramsOf(en[k]).join(','),
  );

  const bad = missing.length || extra.length || badParams.length;
  if (bad) failed = true;

  console.log(
    `${bad ? 'FAIL' : 'ok  '}  ${lang.padEnd(8)} ` +
      `keys=${String(keys.size).padStart(4)}  ` +
      `missing=${String(missing.length).padStart(3)}  ` +
      `extra=${String(extra.length).padStart(3)}  ` +
      `params=${String(badParams.length).padStart(3)}  ` +
      `untranslated=${String(untranslated.length).padStart(3)}`,
  );
  for (const k of missing.slice(0, 5)) console.log(`         missing: ${k}`);
  for (const k of extra.slice(0, 5)) console.log(`         extra:   ${k}`);
  for (const k of badParams.slice(0, 5)) {
    console.log(`         params:  ${k}  en=${paramsOf(en[k]).join(',') || '-'}  ${lang}=${paramsOf(t[k]).join(',') || '-'}`);
  }
}

// Every language the app offers must have a file at all.
const localesTs = readFileSync(resolve(root, 'src/app/core/i18n/locales.ts'), 'utf8');
const declared = [...localesTs.matchAll(/code:\s*'([^']+)'/g)].map((m) => m[1]);
const present = new Set([...files.map((f) => f.replace(/\.json$/, '')), 'en']);
const absent = declared.filter((c) => !present.has(c));
if (absent.length) {
  failed = true;
  console.log(`\nFAIL  offered in the picker but no translation file exists: ${absent.join(', ')}`);
}

console.log(failed ? '\ni18n validation FAILED' : `\ni18n validation passed (${files.length + 1} languages)`);
process.exit(failed ? 1 : 0);
