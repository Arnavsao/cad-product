---
name: add-editor-tool
description: Add or extend an interactive CAD editor tool (draw, modify, select, block, inquiry, options) in src/app/features/cad-editor — the ITool class, ToolManager registration, COMMAND_PROMPTS phases, the ToolCatalog toolbar entry, command aliases, undoable commands, and the i18n regeneration that must follow. Use when asked for a new drawing/modify command, a new option on an existing command, a toolbar button, or an AutoCAD command CADO lacks.
---

# Adding an editor tool

A tool is finished only when all six touchpoints agree. Missing one produces a tool that runs but has no prompt, no toolbar button, or an untranslatable name that fails CI.

## 1. The tool class — `tools/<group>/<name>-tool.ts`

Implements `ITool` (`core/models/tool.interface.ts`). Pattern from `tools/draw/line-tool.ts`:

- Constructor takes an `Injector`; pull services with `injector.get(...)`: `DocumentService`, `ViewModelService`, `CommandStackService`, `ToolManagerService`, `DynamicInputService`, `SnappingService`.
- `readonly name = '<id>'` — same string as the registration id and the `COMMAND_PROMPTS` key.
- Pointer hooks receive **world** coords first (`wx, wy`), screen second. Convert with `vm.w2s` / `vm.s2w`; on a layout tab these already compose the active viewport's camera, so tools never special-case paper space.
- `getPhase()` returns the current phase id; it must match a phase in the tool's `COMMAND_PROMPTS` entry. Return `null` right after activation.
- `drawPreview(ctx)` draws in screen pixels via `vm.w2s`; call `vm.markDirty()` on every state change that should repaint.
- Optional: `getDynamicInputState()` / `commitDynamicInput()` for the heads-up fields, `getCursor()` (`'pickbox'`, `'crosshair'`, …), `getStatusText()`.

## 2. Mutate only through commands

Never push to `file.entities` directly. Build an `ICommand` (`core/models/command.model.ts`) and `cmds.push(cmd)`. Existing commands cover most cases: `AddEntityCmd`, `DeleteMultipleCmd`, `ModifyEntitiesCmd`, `CompoundCmd`. New entities get `e.layer = doc.activeLayer`; `AddEntityCmd` stamps `inPaperSpace` from the editing space on first execute, so the tool does not decide model vs paper.

Pass hooks `{ markDirty: () => vm.markContentDirty() }` so the static-layer cache invalidates.

## 3. Register — `cad-editor.ts` `ngOnInit`

```ts
this.toolMgr.register('mytool', (i) => new MyTool(i));
// heavy or rarely used → lazy chunk:
this.toolMgr.registerAsync('mytool', async (i) => new (await import('./tools/draw/my-tool')).MyTool(i));
```

Variants of one tool share a class with a mode argument (`new ArcTool(i, 'sce')`) and register under separate ids (`arc_sce`).

## 4. Prompts — `core/services/command-prompts.registry.ts`

Add a `COMMAND_PROMPTS['<id>']` entry: `command: 'AUTOCADNAME'`, `phases: [{ id, message, options? }]`. Options are `{ key: 'U', label: 'Undo', hint }` where the key is a single uppercase letter and, by convention, the label's first letter. **All prompt text lives here** — no hardcoded prompt strings in the tool. Use AutoCAD's exact wording (`Specify next point or`, `Select objects:`); drafters recognise it.

## 5. Toolbar + aliases — `core/services/tool-catalog.service.ts`

Add a `ToolMeta` to the right section array: `{ id, title: 'Name (ALIAS)', group, aliases: ['alias', 'name'], svg }`. The `(ALIAS)` in the title is stripped before translation and re-appended verbatim. Sub-tools go in `subTools`. `aliases` are what the command line matches, lowercase. The 16×16 inline SVG uses `currentColor`.

## 6. Regenerate translations

```bash
npm run i18n
git add public/i18n/en.json scripts/i18n/registry-keys.en.json
```

Both registries feed `en.json`; CI diffs it. The other 13 languages fall back to English silently, so also add the new keys to `public/i18n/<code>.json` when you can (see the i18n-strings skill).

## Tests

Put geometry in a pure helper next to the tool (`centerline-geometry.ts` + `.spec.ts`) and test that, not the pointer choreography. Karma runs in ChromeHeadless; see the verify skill for `--include`.

## Checklist before done

- [ ] `getPhase()` ids ⊆ `COMMAND_PROMPTS[id].phases[].id`
- [ ] Escape cancels cleanly (`deactivate` clears preview state, `vm.markDirty()`)
- [ ] Undo removes exactly what the tool added, redo restores it
- [ ] Works on a layout tab inside a viewport (MSPACE) and on the Model tab
- [ ] `npm run i18n` ran and `en.json` is staged
- [ ] CHANGELOG `Unreleased → Added` line (see changelog-and-commit skill)
