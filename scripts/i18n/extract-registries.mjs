/**
 * Generates the `editor.cmd.*` and `editor.tool.*` translation keys from the
 * two registries that hold the editor's text.
 *
 * Why a generator rather than hand-written keys: `command-prompts.registry.ts`
 * is ~1000 lines of structured prompt definitions and `tool-catalog.service.ts`
 * ~700 of tool metadata. Both are already the single source of truth for their
 * English text, and both are edited when tools change. Deriving the keys from
 * them means adding a tool cannot silently ship an untranslatable string, and
 * the English never has to be maintained in two places.
 *
 * Run: node scripts/i18n/extract-registries.mjs
 * Writes: scripts/i18n/registry-keys.en.json  (English source for translators)
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Replaces Angular and Transloco with inert stubs.
 *
 * Both registries are plain exported data, but they live in files that also
 * declare an `@Injectable` service. Importing the real packages here makes
 * Angular try to JIT-compile Transloco's providers in a bare Node process,
 * which fails — and would be pointless work even if it succeeded, since this
 * script only reads object literals. The stubs satisfy the decorator and the
 * `inject()` call at module-evaluation time and nothing else.
 */
const stubAngularPlugin = {
  name: 'stub-angular',
  setup(build) {
    const stubs = {
      '@angular/core': `
        export const Injectable = () => (target) => target;
        export const inject = () => ({});
      `,
      '@jsverse/transloco': `
        export class TranslocoService {}
      `,
    };
    const filter = new RegExp(`^(${Object.keys(stubs).map((s) => s.replace('/', '\\/')).join('|')})$`);
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: stubs[args.path],
      loader: 'js',
    }));
  },
};

/** Bundle a TS module to a temp ESM file and import it, so we read real values. */
async function loadModule(relPath, tmpName) {
  const outfile = resolve(root, 'node_modules/.cache/i18n', tmpName);
  mkdirSync(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [resolve(root, relPath)],
    outfile,
    bundle: true,
    format: 'esm',
    // `node`, not `neutral`: the catalog imports Angular and Transloco for its
    // decorator and DI, and only node resolution walks node_modules the way
    // those packages' own internal imports expect. Nothing Angular actually
    // runs here — we import the module for its exported data — but it does have
    // to resolve.
    platform: 'node',
    plugins: [stubAngularPlugin],
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

const out = {};
const set = (key, value) => {
  if (typeof value === 'string' && value.trim()) out[key] = value;
};

// ── Command prompts ────────────────────────────────────────────────────────
const { COMMAND_PROMPTS } = await loadModule(
  'src/app/features/cad-editor/core/services/command-prompts.registry.ts',
  'command-prompts.mjs',
);

let phaseCount = 0;
let optionCount = 0;
for (const [commandId, def] of Object.entries(COMMAND_PROMPTS)) {
  for (const phase of def.phases ?? []) {
    set(`editor.cmd.${commandId}.${phase.id}.message`, phase.message);
    phaseCount++;
    for (const opt of phase.options ?? []) {
      // `key` (the typed letter) and `command` (LINE, MOVE) are intentionally
      // absent: both are input, not prose. See TRANSLATING.md.
      set(`editor.cmd.${commandId}.${phase.id}.opt.${opt.key}.label`, opt.label);
      set(`editor.cmd.${commandId}.${phase.id}.opt.${opt.key}.hint`, opt.hint);
      optionCount++;
    }
  }
}

// ── Tool catalog ───────────────────────────────────────────────────────────
const catalogMod = await loadModule(
  'src/app/features/cad-editor/core/services/tool-catalog.service.ts',
  'tool-catalog.mjs',
);

/**
 * Read the exported `SECTIONS` rather than calling `getGrouped()`:
 * `ToolCatalogService` injects TranslocoService, so constructing it here would
 * need an Angular injector — and `getGrouped()` is now the thing that consumes
 * these keys, so using it to generate them would be circular.
 *
 * Hidden tools are filtered the same way `getGrouped()` filters them: nobody
 * can see them, so nobody should be paying to translate them.
 */
let toolCount = 0;
const seenTools = new Set();
function walkTools(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(walkTools);
    return;
  }
  if (typeof node.id === 'string' && typeof node.title === 'string') {
    // Strip the trailing keyboard alias — "Line (L)" is translated as "Line",
    // the "(L)" is a shortcut and must survive untranslated. The renderer
    // re-appends it from `aliases`.
    const title = node.title.replace(/\s*\(([^)]*)\)\s*$/, '').trim();
    const key = `editor.tool.${node.id}.title`;
    if (title && !seenTools.has(key)) {
      seenTools.add(key);
      set(key, title);
      toolCount++;
    }
  }
  if (typeof node.label === 'string' && Array.isArray(node.tools)) {
    set(`editor.toolSection.${node.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, node.label);
  }
  for (const value of Object.values(node)) walkTools(value);
}
const visible = catalogMod.SECTIONS.map((section) => ({
  ...section,
  tools: section.tools
    .filter((tool) => !tool.hidden)
    .map((tool) => ({ ...tool, subTools: tool.subTools?.filter((sub) => !sub.hidden) })),
})).filter((section) => section.tools.length > 0);
walkTools(visible);

// ── Write ──────────────────────────────────────────────────────────────────
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
const dest = resolve(root, 'scripts/i18n/registry-keys.en.json');
writeFileSync(dest, JSON.stringify(sorted, null, 2) + '\n');

console.log(`commands : ${Object.keys(COMMAND_PROMPTS).length}`);
console.log(`phases   : ${phaseCount}`);
console.log(`options  : ${optionCount}`);
console.log(`tools    : ${toolCount}`);
console.log(`keys     : ${Object.keys(sorted).length}  ->  ${dest.replace(root + '/', '')}`);
