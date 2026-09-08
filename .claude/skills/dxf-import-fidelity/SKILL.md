---
name: dxf-import-fidelity
description: Work on DXF import/export in the CAD editor — what the dxf-parser package silently drops, where CADO compensates (dxf-scanner, dxf-extra-handlers, the parser worker, OCS), how to validate against AutoCAD using *D dimension blocks and export→re-import round trips, and the reference drawing's known quirks. Use when a DXF renders differently from AutoCAD, an entity type or table is missing, text/dimension values are wrong, geometry appears far off the sheet, or when adding DXF export support.
---

# DXF import and export fidelity

The acceptance bar is **AutoCAD parity**: the user opens the same file in CADO and AutoCAD Web side by side. Drawings also persist as DXF (`ExportService.buildDxfString`), so import and export are one round trip and both must be lossless for anything the import recovers.

## Assume nothing arrives

`dxf-parser@1.1.2` skips whatever it has no handler for, **without a warning**. Check `node_modules/dxf-parser/dist/entities/` before trusting a field. Known gaps and where CADO fills them:

| Dropped by the parser | Recovered by |
| --- | --- |
| STYLE and DIMSTYLE tables (`dxf.tables` has only viewPort, lineType, layer) | `core/utils/dxf-scanner.ts` raw-text scan |
| LAYER linetype (6) and lineweight (370) | `dxf-scanner.ts` |
| TEXT style name (7), DIMENSION style name (3), DIMDEC | scanner + `DxfImportService` |
| XDATA values (collapsed to `{applicationName, customStrings}`) — where per-entity `DIMLFAC`/`DIMSCALE` live | `scanDimStyleOverrides` in the scanner → `DimensionEntity.linearFactor` |
| HATCH, LEADER, VIEWPORT, ATTRIB, ACAD_TABLE, MLINE, WIPEOUT, OLE2FRAME | `core/services/dxf-extra-handlers.ts`, registered in `core/workers/dxf-parser.worker.ts` via `parser.registerEntityHandler(...)` |
| Extrusion normal (210/220/230) on ELLIPSE and TEXT; inconsistent shape elsewhere | `_extrusionOf` in the importer, `core/utils/ocs.ts` for OCS → WCS |

**Prefer a custom entity handler over post-processing.** Register it in the worker next to `DxfHatchHandler`; the handler sees the raw group codes.

## Group codes are per entity type

Group 41 is width factor on TEXT but reference-rectangle width on MTEXT. Group 70 on a DIMSTYLE table entry is flags, not DIMTOL. Group 11 on a DIMENSION is the authoritative text midpoint. Read the entity's own section of the DXF reference every time; a wrong guess is silent and dramatic.

## Recurring symptoms → causes

- **Stray geometry far off the sheet**: entities on the `(0,0,-1)` OCS plane (AutoCAD MIRROR leaves them there). Map through `ocs.ts`.
- **Dimension reads 68.5 where AutoCAD reads 10280**: `DIMLFAC` override in XDATA not applied. Per entity, not per style; one drawing mixes factors.
- **Literal `%%U`, `\pxqr;`, `\X`**: text control codes; decode with `core/utils/text-control-codes.ts` (keeps the source string for round-trip).
- **Everything in one font**: STYLE table not resolved, or a TrueType *file name* (`times.ttf`) handed to `ctx.font`, which the canvas rejects. `FontResolverService` maps file → family.
- **Layout tab shows no model**: paper mm are world units, +Y up; viewports adopt DXF `VIEWPORT` records (skip `69=1` and `68<=0`). See CHANGELOG Unreleased for the full account.
- **Grey lines on a dark theme**: not colour mapping. Canvas backing store must be sized in device pixels.

## Validating exactly, not by eye

- **`*D` blocks.** AutoCAD bakes each dimension's rendered geometry and *final text* into an anonymous `*D<n>` block referenced by the DIMENSION's group 2. Compare CADO's resolved dimension string against that block's MTEXT for per-dimension parity. This reached 384/384 on the reference drawing.
- **Round trip.** Import → `buildDxfString` → import again; diff entity counts, style names, group 11 positions, XDATA-derived factors.
- **Real strings in specs.** Test with strings copied from the reference drawing (`text-control-codes.spec.ts` does this) and say which file they came from in the comment.

## The reference drawing

`public/RTM-S&C-GAD-BR-NO.384-DHD-IND(1x9.15m-PSC Slab).dxf` — 35 MB, written by cloudconvert, **no OBJECTS section**, and it genuinely contains **two** complete sheets (Bridge 384 around y≈0–600, Bridge 330 around y≈950–1570) plus real green construction lines. None of that is a bug. Do not "fix" it, and do not use its extents as a single-sheet assumption.

## Export side

Whatever import recovers, `ExportService` must write: STYLE and DIMSTYLE tables, text style names (7), dim style (3), group 11 midpoint, DIMLFAC XDATA, layer linetype/lineweight, adopted viewports. A field that only exists on import is a regression waiting for the next save.

## Headless visual checks

No Playwright here. Chrome is installed and `ws` is in node_modules, so a small CDP driver works; Angular services bundle under esbuild with an `@angular/core` shim (see `scripts/i18n/extract-registries.mjs` for the stub pattern). Put such scripts in the scratchpad, not the repo, unless asked.
