# CADO 3D — Parametric Modeling Implementation Plan

*Status: proposal, nothing implemented. Written 2026-09-05 from a full read of the codebase plus a survey of the
browser CAD kernel landscape as of September 2026.*

---

## 0. Executive summary

CADO today is a well-built **2D drafting editor whose entire model, renderer, tool system and save format are
2D and DXF-shaped**. There is no Z coordinate in any live entity, no camera abstraction, no constraint solver,
no dependency graph beyond associative hatches, and the cloud save channel accepts nothing but DXF text.

What the goal describes — constrained sketches, extrude/revolve, booleans, an editable feature history — is the
**Inventor / Fusion / SolidWorks paradigm**, not AutoCAD's own 3D (which is direct modeling with a limited solid
history). We should borrow AutoCAD's *idioms* (command line, DYN input, viewports, visual styles, ViewCube, UCS)
and build the parametric core the way the history-based tools do.

**Recommendation in one paragraph.** Add a second document kind, **Part**, stored as a versioned JSON envelope
alongside the existing DXF drawings in the same `drawings` table, sharing folders, versions, sharing, trash and
autosave. Geometry comes from **Open CASCADE (OCCT) compiled to WebAssembly, running in a dedicated Web
Worker**, behind a thin kernel interface we own. Sketch constraints come from **planegcs** (FreeCAD's solver in
WASM). Rendering is **three.js (WebGL) on a fourth canvas layer driven by the existing render loop**. Sketches
**reuse the existing 2D entity classes, draw/modify tools, snapping, dynamic input and topology (closed-loop)
code**, so the 2D investment becomes the sketcher. The feature history is a new, small, pure-TypeScript model
that produces `ICommand`s for the existing undo stack. The 2D drawing product is untouched: a Part is a new
kind of document, not a change to `DrawingDocument`.

**Effort.** A working MVP (Phase 0–2: sketch → constraints → extrude/revolve → boolean → editable feature tree →
save/load/STEP) is roughly **12–17 engineer-weeks of a 2–3 person team with one graphics/CAD-experienced
engineer**, i.e. **3.5–4.5 calendar months**. Reaching a credible "serious 3D CAD" (Phases 3–4: fillets,
patterns, parameters, faces as sketch planes, part → drawing views, STEP import) is **9–12 months**.

---

## 1. What exists today (findings that shape the design)

Everything below was verified against the source. File references are relative to the repo root.

### 1.1 Data model — strictly 2D, class-based, DXF-mirroring

* `IPoint {x, y}` is the only point type in the live model (`src/app/features/cad-editor/core/models/entity.model.ts:8`).
  `IBBox` is `{x, y, w, h}`. Every `bbox()`, `hitTest()`, `snapPoints()` on ~22 entity classes assumes 2D.
* `Entity` (`entity.model.ts:71`) is a class with virtual `draw(ctx: CanvasRenderingContext2D, vm, doc)`,
  `hitTest(sx, sy, vm)`, `snapPoints()`, `bbox()`, `getPropertiesSchema()`, `applyPropertyChange()`, a
  monotonic `revision` counter bumped by `refreshCaches()`, and an `[key: string]: any` index signature.
  `tsconfig.json` has `strict: false`.
* Entity types: POINT, LINE, CIRCLE, ARC, POLYLINE (with bulges), ELLIPSE, SPLINE, TEXT/MTEXT, HATCH, INSERT,
  XLINE, LEADER/MLEADER, 8 dimension classes, VIEWPORT, IMAGE, TABLE.
* Z appears only as DXF round-trip baggage (hatch `elevation`/`extrusion`, `ViewportEntity.viewTarget`).
  `3DSOLID`, `REGION`, `BODY` are **explicitly dropped on DXF import** (`dxf-import.service.ts:964-971`).
* `DrawingDocument` (`core/models/document.model.ts`) wraps a `DxfFile` (entities, `layers`, `blocks:
  Map<string, IBlockDef>`, dim styles) plus per-document undo stack, view state, spatial-index state and an
  entity id counter.
* **Blocks** are `IBlockDef {name, basePoint, entities, attDefs}` instanced by `InsertEntity` through a proxy
  view-model (rendering-time transform, not baked geometry). Attributes are text only. The object library
  (`library.service.ts`) is a localStorage palette that pastes loose geometry; it is not a component system.
  There is **no parametric component anywhere** — the closest things are dead `cad-core/library/BlockLibrary.ts`
  generators and the AI agent's `component-family.model.ts` typed parameter descriptors (emit once, then
  forget).
* **Units are cosmetic.** `$INSUNITS` round-trips as a raw string; nothing converts. Paper space is in mm,
  lineweights in 1/100 mm. The user preference `Units` enum is disjoint from the DXF code.

### 1.2 `src/cad-core/` — mostly orphaned

Only `DimensionStyle` and `DimensionGeometryBuilder` are imported by the app. `ConstraintEngine` is a
**validator, not a solver** (checks whether Horizontal/Vertical/Parallel/Perpendicular/Concentric currently
hold; `Tangent` has no branch; `Coincident` is a stub). `TopologyEngine` is a misnamed Cohen–Sutherland line
clipper. `DraftingCanvasContext` / `CanvasMultiplexer` have zero consumers in `src/app/` — the claim in
`docs/ARCHITECTURE.md` that entities render through them is **out of date**; the real multi-target recorder is
`export/svg-recorder.context.ts`. `Point`/`Vector`/`Transform` there *are* 3D-capable but unused.

### 1.3 Rendering — Canvas2D, one rAF loop, carefully tuned

* Three absolute-positioned canvases (`grid`, `main`, `dynamic`) in `features/canvas/canvas.component.ts`
  (1275 lines), plus an offscreen static-layer cache blitted on pan. One `requestAnimationFrame` loop gated by
  three plain dirty flags (`vm.dirty`, `vm.gridDirty`, `_dynamicNeedsRedraw`). Mousemove is throttled to one
  `snap.resolve()` per frame. No devicePixelRatio scaling, no LOD.
* `ViewModelService.w2s/s2w` is scalar scale + pan + Y-flip. `IProxyVm {scale, cumulativeScale, w2s, s2w}` is
  the only camera contract renderers accept; `createProxyVm()` composes rotation and non-uniform scale.
* Picking: uniform-grid `SpatialIndexService` → per-entity `hitTest` in screen space. Snapping computes
  candidates from entity geometry in world coords plus `TopologyService.findIntersectionsNear`.
* **The multi-view 3D chrome already exists and is inert.** `IModelViewportTile` has `viewName` ("Top",
  "Front", "SW Isometric"…) and `visualStyle` ("2D Wireframe", "Conceptual", "Realistic", "Shaded"), 12
  presets, per-tile dropdown UI behind `showTileHeaderOverlay = false` (`canvas.component.ts:266`), and
  `drawModelSpaceTiledViewports()` (`:1170`) already clips per tile and swaps camera state. Nothing reads
  `visualStyle`. This is the natural seam for a GL viewport.
* No WebGL, no OffscreenCanvas, no WASM, no three.js anywhere. Build is the esbuild `@angular/build:application`
  builder; workers via `new Worker(new URL(...), {type: 'module'})` work with no config; `.wasm` files can ship
  as assets. Initial-bundle budget is 1 MB warn / 2 MB error; the editor is already lazy-loaded.

### 1.4 Tools, commands, undo

* `ITool` receives `(wx, wy, sx, sy, e)` and draws previews into a `CanvasRenderingContext2D`. Dynamic input
  (`getDynamicInputState` / `commitDynamicInput`), command-line option keywords (`invokeOptionByKey`), prompts
  registry and `expression-parser.ts` (arithmetic + `@dx,dy` / `len<angle`) are all reusable as-is.
* `ICommand {execute, undo}` with `CompoundCmd` batching; `ModifyGeometryCmd` is snapshot-diff. Stack is
  per-document on `DrawingDocument.cmdState`. No transaction API, no depth cap.
* The only dependency-rebuild precedent is the associative-hatch pipeline: `EntityDependencyService` (revision
  snapshots) + `HatchRegenSchedulerService` (runs in `DocumentService.preDrawHook`, version-gated, records a
  `RegenerateHatchCmd`). It is hatch-specific but the *shape* (track inputs → detect stale → recompute → record
  undo) is exactly a one-level feature rebuild. `preDrawHook` is a single slot.
* Dimensions are associative by `(entityId, snapIndex)` — positional, fragile.

### 1.5 Closed-loop detection — the best asset for sketch profiles

* `core/utils/region-topology.ts` (V1, default): planar arrangement, tessellated to segments (32/arc), face walk,
  island detection. **Ignores polyline bulges; excludes SPLINE and INSERT.**
* `core/services/topology/*` (V2, opt-in): curve-native DCEL with `IEdgeSource {entityId, subIndex, t0, t1,
  blockPath}` — a parametric back-reference from a face edge to the source entity span. `IFace` carries
  `polygon`, `signedArea`, `contributingEntityIds`. `IHatchBoundarySpec`'s `anchors ⟷ frozen` duality is the
  pattern for "profile that follows its sketch" vs "baked profile".

### 1.6 UI shell

* Panels are a hard-coded string union (`WorkspacePanelService.DrawerPanelId`) + `@switch` in
  `cad-editor.html` + a `BUTTONS` const in the sidebar — four coordinated edits per new panel.
* There is **no AutoCAD-style workspace/ribbon mode**. The only ribbon swap is `text-editor-ribbon` replacing
  `cad-toolbar` while a text/table editor is open — the pattern to copy. `ToolCatalogService.SECTIONS` is a
  module const.
* **Properties panel is schema-driven** (`IPropertySchema`, intersected across the selection, grouped by
  category) — any object implementing `getPropertiesSchema()` / `applyPropertyChange()` gets a UI for free.
* The AI agent's `AiTool.validate → compile(): ICommand[] → one CompoundCmd` registry is the cleanest
  capability-registry pattern in the repo and the right shape for a feature API.
* Settings drawer has only a theme picker; the server has `UserPreferences.uiState Json?` unused.

### 1.7 Persistence and backend — DXF text end to end

* **Save format is DXF (AC1032) text**, produced by `ExportService.buildDxfString()`, for both IndexedDB
  (`StoredDrawing.dxf`) and the cloud. No document `schemaVersion`; the decision is documented in
  `core/models/stored-drawing.model.ts:1-11`. **Layouts and images are not persisted at all.**
* The DXF worker already sniffs `{`/`[` and routes JSON entity payloads
  (`core/workers/dxf-parser.worker.ts:20-38`) — a ready two-format dispatcher.
* Backend: NestJS 11 + Prisma 7 + Postgres (metadata only) + S3/MinIO/R2 (payloads). `Drawing.format` is a
  two-value enum `dxf | dwg`. Everything else on `Drawing` (`storageKey`, `byteSize`, `currentVersion`,
  `thumbnailKey`, folders, shares, trash, name uniqueness) is format-agnostic.
* `commitVersion()` (reserve-then-write with a unique `(drawingId, version)` lock, compensating transaction,
  `If-Match` 409s, append-only restore, prune at 50) is **exactly right** for a part document and needs no change.
* Three layers reject non-DXF content: `express.text({type:'text/plain', limit:'6mb'})` on the content route,
  `looksLikeDxf` sniff (422), and the hardcoded `.dxf` in `storage-keys.ts`.
* **Live bug:** `presignContent`/`completeContent` call `assertInlineSize` (5 MB), but the client only uses that
  path *above* 5 MB — cloud saves are effectively capped at 5 MB, not 50 MB.
* No queue, no worker threads, no native toolchain in the `node:24-alpine` image, `npm ci --ignore-scripts`.
  WASM would run in Node 24 unchanged; native kernels would not.

### 1.8 Quality gates that constrain us

* **i18n:** every tool in `SECTIONS` / `COMMAND_PROMPTS` generates keys; `npm run i18n:validate` is CI-fatal
  across 14 languages. New tools must ship `hidden: true` until translated, or translations must be budgeted.
* **Tests:** 32 Karma specs, none on tools/commands/undo/canvas. Only pure modules are tested — 3D math must
  live in injector-free modules to get coverage.
* Bundle budget 1 MB / 2 MB initial; kernel WASM must be a lazy chunk fetched on first part open.

---

## 2. Technology decisions

### 2.1 Geometry kernel — OCCT in WebAssembly, in a worker, behind our own port

| Option | Verdict | Why |
|---|---|---|
| **OCCT via WASM** (B-rep, LGPL-2.1 + exception) | **Adopt** | The only mature open B-rep kernel that runs in-browser. Exact geometry, fillets/chamfers, STEP/IGES/STL/BREP I/O, HLR projections for 2D views later. Same `.wasm` runs in Node 24 for future server-side jobs. |
| Manifold (mesh CSG, Apache-2.0, 200 KB gz) | Reject as primary | Rock-solid booleans but mesh-only: no fillets on exact geometry, no STEP, no exact edges for drawing views. Could be an optional fast-preview engine later; not worth the dual-kernel complexity now. |
| Truck / Fornjot / brepkit (Rust) | Reject | Fornjot archived 2026-06; CADmium (truck's flagship) archived 2025-09; truck's fillets are experimental; brepkit is AGPL/commercial with unverified claims. |
| Hosted kernel (Zoo.dev, Onshape-style geometry servers) | Reject for now | Per-second metered API, cloud-only, no offline. Our product is client-first; the API container has no compute story. Revisit only if browser WASM proves inadequate. |
| Write our own | Reject | Years of work; the user explicitly ruled it out. |

**Which OCCT binding?** Three live options, none perfect:

| | replicad + replicad-opencascadejs | occt-wasm + brepjs | Own OCCT 8.0.1 Emscripten build |
|---|---|---|---|
| OCCT | 7.6.2 (2023 image) | 8.0.1 | 8.0.1 |
| License | MIT wrapper / LGPL wasm | MIT+Apache tooling / LGPL wasm / Apache brepjs | LGPL wasm |
| WASM size (measured) | 7.05 MB gz / 5.4 MB br | 6.9 MB gz / 5.3 MB br | ~5–7 MB gz, depends on symbols |
| Maturity | 5 years, 63 releases, docs, active (v1.1.0 2026-09-04) | 5 months old, auto-published, single maintainer | We own toolchain + bindings |
| API fit | Fluent code-CAD: `sketch → extrude/revolve → fuse/cut → fillet/chamfer`, STEP/STL export, single+multi-thread builds, worker examples | Arena handles (no manual `.delete()`), structured errors, `OcctWorker` Comlink class, XCAF, STEP/STL/BREP | Anything OCCT does |
| Risk | Old OCCT; one maintainer | Very young; one maintainer | Toolchain cost (Chili3d's `packages/wasm` is the template, but it is AGPL — use as a *reference*, copy no code) |

**Decision:** wrap the kernel behind an `IGeometryKernel` port owned by us (≈ 25 operations: makeFace(wires),
extrude, revolve, boolean, fillet, chamfer, tessellate with face/edge ids, bbox, mass props, STEP/STL
import/export, serialize/deserialize BREP). **Default binding for MVP: replicad**, chosen for maturity and
documentation. **Phase 0 runs a two-week bake-off against occt-wasm/brepjs on our exact operations**; if it wins
on init time, robustness or memory, we switch before Phase 1 code depends on either. By Phase 3 we should be
prepared to own an OCCT 8.x build for the latest boolean/fillet fixes regardless.

Non-negotiable kernel rules: the kernel lives **only in a Web Worker** (never on the main thread — OCCT init is
1–3 s and booleans can take hundreds of ms), single-threaded build first (pthreads need COOP/COEP headers and a
compile-time pool; treat as a later optimisation), lazy-loaded on first Part open, cached by the browser (add a
service worker or long `Cache-Control` for the `.wasm` asset), and every kernel result carries stable
face/edge/vertex ids so the UI never holds raw OCCT handles.

### 2.2 Sketch constraint solver — planegcs

`@salusoft89/planegcs` 1.2.0 (2026-07-06): FreeCAD's Sketcher solver compiled to WASM, 169 KB gz, TypeScript
types, every constraint we need (coincident, horizontal, vertical, parallel, perpendicular, tangent, equal,
concentric/point-on-object, symmetric, distance/angle/radius/diameter, driving and non-driving), DogLeg / LM /
BFGS / SQP, reports conflicting/redundant constraints and DOF. LGPL (ship as a separate `.wasm`, attribute).
Alternatives are worse: SolveSpace's solver is GPL and not packaged for JS; the TS hobby solvers lack tangent/
equal/dimensions; a home-grown Newton solver is months of work we do not need. Runs in the same worker as the
kernel or its own; either way, off the main thread, with a drag-solve fast path (temporary constraints).

### 2.3 Rendering — three.js WebGLRenderer

three.js r185 (2026-07-01), MIT, ≈ 84 KB gz core. Use `WebGLRenderer`; `WebGPURenderer` is still labelled
experimental in the official manual — keep it behind a flag. CAD-specific pieces: `BatchedMesh` for bodies,
`EdgesGeometry` + `LineSegments2`/`LineMaterial` for screen-space-width edges, `three-mesh-bvh` for picking,
`GLTFExporter`/`STLExporter` for mesh export. Babylon.js 9 is heavier and game-shaped; no advantage for us.

### 2.4 Where the new code lives

```
src/
├── cad3d-core/            Pure TS, no Angular, worker-safe: part model, feature DAG, rebuild engine,
│                          persistent naming, sketch model + constraint model, JSON schema + migrations,
│                          math (vec3/mat4/plane). Strict-typed. Fully unit-testable.
├── cad3d-kernel/          IGeometryKernel port, replicad adapter, worker entry, Comlink-style RPC,
│                          tessellation → typed arrays with face/edge ids.
├── cad3d-sketch/          planegcs adapter, entity ↔ solver primitive mapping, DOF reporting.
└── app/features/cad-editor/
    ├── core/models/part-document.model.ts        PartDocument (sibling of DrawingDocument)
    ├── core/services/part-*.service.ts           PartRebuildService, PartPersistenceService, Viewport3dService…
    ├── features/viewport-3d/                     GL layer, camera, ViewCube, picking, visual styles
    ├── features/panels/feature-tree-panel        Feature browser + rollback bar
    ├── features/panels/parameters-panel
    ├── features/toolbar-3d/                      Modeling + Sketch ribbons
    └── tools/model/ , tools/sketch/              EXTRUDE, REVOLVE, UNION…, constraint tools
```

Do **not** revive `src/cad-core/`; decide separately whether to delete its orphaned parts. Do not copy code
from Chili3d (AGPL); replicad (MIT) may be read and used freely.

---

## 3. Architecture

### 3.1 Two document kinds, one editor shell

```
DocumentManagerService.documents(): (DrawingDocument | PartDocument)[]
                                              │
                    ┌─────────────────────────┴──────────────────────────┐
             DrawingDocument (unchanged)                          PartDocument (new)
             DxfFile · DXF save · 2D tools                        PartModel · JSON save
                                                                 ├── parameters[]
                                                                 ├── sketches[]  ── entities: existing 2D classes
                                                                 ├── features[]  ── DAG, ordered
                                                                 └── derived: bodies (kernel handles + meshes)
```

`EditorMode` signal: `'drafting' | 'modeling' | 'sketch'`. Drafting is today's editor, untouched. Modeling shows
the GL viewport, the modeling ribbon, the feature tree and parameters panels. Sketch mode is entered from a
feature (new sketch / edit sketch): the camera locks normal to the sketch plane, and the **existing 2D canvas
layers, tools, snapping and DYN input operate on the sketch's entity list** as if it were a tiny drawing.

### 3.2 Sketches reuse the 2D system

A `Sketch` is `{id, name, plane: SketchPlane, entities: Entity[], constraints: Constraint[], idCounter}` where
`SketchPlane` is either a base plane (XY/XZ/YZ + offset) or, from Phase 3, a reference to a planar face by
persistent name. Sketch coordinates are the plane's local 2D frame, so **every existing entity class and tool
works unchanged**: LINE, CIRCLE, ARC, POLYLINE, ELLIPSE, SPLINE, RECTANG, POLYGON, TRIM, EXTEND, OFFSET, FILLET
(2D), MIRROR, ARRAY, and the dimension tools.

What is added on top:

* **Sketch-legal entity subset** enforced by mode (no TEXT/HATCH/INSERT/TABLE in a sketch; construction
  geometry via a `construction` flag drawn dashed).
* **Constraints** referencing `(entityId, pointRole)` where `pointRole ∈ {start, end, center, mid, whole}` —
  *role-based, not `snapIndex`-based*, so changing an entity's snap-point count cannot silently rebind.
* **Driving dimensions**: `DimensionEntity` subclasses gain an optional `drives: {constraintId}`; editing the
  dimension text solves the sketch. Non-driving dimensions remain annotations (planegcs supports both).
* **Profiles**: closed loops found by the existing topology code (V2 DCEL preferred, because `IEdgeSource`
  gives per-edge back-references). Required fixes: honour polyline bulges, add SPLINE support, expose an
  "all faces" query. A profile is stored as `{sketchId, loopSignatures[]}` using the existing `loopSignature`
  idea, so it survives re-solving when entity ids are stable.
* **Camera ↔ view-model bridge**: in sketch mode the orthographic 3D camera looks down the plane normal with the
  plane's X axis screen-aligned, so plane-local → screen is affine. `Viewport3dService` computes
  `{scale, panX, panY}` for `ViewModelService` each frame; pan/zoom in sketch mode drives both. This is the one
  place the 2D and 3D cameras must agree, and it is exactly what `IProxyVm` was built for.

### 3.3 Feature model and rebuild engine (`cad3d-core`)

```ts
interface Feature {
  id: string;                  // uuid, stable for life
  type: 'sketch' | 'extrude' | 'revolve' | 'boolean' | 'fillet' | 'chamfer' | 'plane' | 'hole' | 'mirror' | 'pattern' | …;
  name: string;
  params: Record<string, ParamValue>;        // numbers or expressions ("d1 * 2 + 5")
  inputs: Record<string, Reference>;         // profile / body / face / edge / axis refs
  operation?: 'new' | 'join' | 'cut' | 'intersect';
  suppressed: boolean;
}
type Reference =
  | { kind: 'profile'; sketchId; loops: string[] }
  | { kind: 'body'; featureId }               // body produced by feature
  | { kind: 'face' | 'edge' | 'vertex'; name: PersistentName }
  | { kind: 'sketchEntity'; sketchId; entityId; role };
```

**Rebuild** = topological order over the DAG (edges from `inputs` + `operation` targets); on any change, mark
the edited feature and everything downstream dirty; replay dirty features in the worker; cache each feature's
resulting body handle + tessellation (the **rollback bar** is just "render the cache at index k").
Parameters are evaluated with `expression-parser.ts` extended with identifiers (today it deliberately has none
— add a scoped symbol table, keep no `eval`). Feature errors (kernel failure, lost reference, conflicting
constraints) are stored on the feature and rendered as badges; the model never becomes unloadable because of a
failed feature — downstream features are skipped and the last good body shown.

**Persistent naming** is the hardest part of any parametric CAD and the plan is honest about it:

* MVP: name a face/edge by `(creatingFeatureId, generator)` where the generator is e.g.
  `{kind:'extrudeCap', end:'start'|'end'}` or `{kind:'extrudeSide', sketchEntityId, subIndex}` or
  `{kind:'revolveSide', sketchEntityId}`. Booleans and fillets tag their output faces with the input names they
  derive from. Resolution walks the tessellation's face-id → generator table from the kernel adapter.
* Fallback: if a name fails to resolve after rebuild, match geometrically (face type, normal, centroid, area
  within tolerance) and warn; if that fails, mark "reference lost" on the feature.
* Phase 3+: v2 naming with split/merge lineage through booleans.

**Undo/redo** reuses `CommandStackService` unchanged: `AddFeatureCmd`, `UpdateFeatureCmd` (snapshot-diff of
params/inputs, exactly like `ModifyGeometryCmd`), `ReorderFeaturesCmd`, `SuppressFeatureCmd`,
`AddSketchEntitiesCmd`… Sketch edits inside sketch mode use the *existing* commands on the sketch's entity
array (the block editor already proves array-swapping `file.entities` works). Rebuild is triggered by a
`PartModel.revision` bump and runs via a `preDrawHook`-style scheduler — copy `HatchRegenSchedulerService`,
but make the hook a list.

### 3.4 3D viewport

* A fourth canvas, `canvas-gl`, inserted **below `canvas-main`** in `canvas.component.ts`. In modeling mode the
  2D main layer draws only sketch-mode content and overlays; in drafting mode the GL layer is hidden and
  untouched — zero cost to 2D users.
* **One render loop.** The GL renderer draws inside the existing `renderFrame` when a new `gl.dirty` flag is set
  (camera moved, scene changed, hover changed). No second rAF. Tiled viewports use `gl.setScissor` per
  `IModelViewportTile`; `viewName` / `visualStyle` finally get consumers; flip `showTileHeaderOverlay` on for
  parts.
* Camera: orthographic by default (CAD), perspective toggle; AutoCAD gestures (middle-drag orbit as 3DORBIT,
  Shift+middle pan, wheel zoom to cursor), ViewCube-lite, named views from the tile presets, `PLAN` to the
  current sketch plane, zoom-extents reusing the existing animation code shape.
* Visual styles → materials: 2D Wireframe (edges only), Hidden (edges, depth-tested), Shaded, Shaded with Edges
  (default), Realistic (PBR lighting). Theme palette from `ICadCanvasPalette` (background, selection, hover).
* Picking: `three-mesh-bvh` raycast against face meshes; face/edge/vertex ids ride along as geometry groups /
  attributes from the tessellator; selection filter (body / face / edge / vertex / sketch). Hover and selection
  highlight in the same accent colors the 2D editor uses.
* 3D object snaps (MVP subset): endpoint / midpoint of B-rep edges, center of circular edges, face-plane
  projection; return the existing `ISnapResult` shape with a 3D point attached.
* Thumbnails: offscreen GL render to PNG → existing `PUT /drawings/:id/thumbnail` unchanged.

### 3.5 Tools and UI

* **Modeling ribbon** (swap pattern from `text-editor-ribbon`): Sketch · Extrude · Revolve · Union · Subtract ·
  Intersect · Fillet · Chamfer · Plane · Measure · Views · Visual style. Commands registered in
  `CommandRegistry`/`SECTIONS` under AutoCAD names where they exist (`EXTRUDE`, `REVOLVE`, `UNION`, `SUBTRACT`,
  `INTERSECT`, `FILLETEDGE`, `CHAMFEREDGE`, `3DORBIT`, `VSCURRENT`, `PLAN`, `UCS`) and new ones (`SKETCH`,
  `PARAMETERS`). Ship `hidden: true` until translations land.
* **Sketch ribbon**: existing draw/modify/dimension sections + a Constraints section (coincident, horizontal,
  vertical, parallel, perpendicular, tangent, equal, concentric, fix, symmetric) + Finish Sketch. Constraint
  glyphs drawn on the dynamic layer; DOF count in the status bar.
* **3D tool interface**: `ITool3d` extends `ITool` with `onPick(hit: PickResult)` and `drawPreview3d(scene)`;
  DYN input and prompts reused verbatim (EXTRUDE prompts "Specify height or [Direction/Taper/Expression]" with a
  live-dragging numeric field, exactly the 2D DYN flow).
* **Feature tree panel** (new `DrawerPanelId`): ordered list with icons, error badges, rename, suppress, drag
  reorder, rollback bar, right-click Edit Feature / Edit Sketch / Delete. Editing a feature reopens its tool
  pre-filled.
* **Parameters panel**: name / expression / value / unit table; `component-family.model.ts`'s typed descriptors
  are the model to generalise.
* **Properties panel** shows features and bodies by implementing `getPropertiesSchema()` on a light adapter.
* **Dashboard**: "New Part" next to "New Drawing", a part icon and filter, same folders/sharing/trash/versions.

### 3.6 File format

Part document — JSON envelope, versioned from day one:

```jsonc
{
  "schemaVersion": 1,
  "kind": "part",
  "units": "mm",                     // real units, from user preference at creation
  "parameters": [{ "name": "d1", "expression": "40", "value": 40, "unit": "mm" }],
  "sketches": [{ "id": "…", "name": "Sketch1", "plane": { "base": "XY", "offset": 0 },
                 "entities": [ /* sketch-entity JSON via cad3d-core SketchEntityCodec */ ],
                 "constraints": [ { "id": "…", "type": "tangent", "refs": [ { "entityId": 3, "role": "whole" }, … ] } ] }],
  "features": [ /* Feature[] as above, in order */ ],
  "view": { "camera": { … }, "visualStyle": "shadedEdges", "rollback": null },
  "extensions": {}                   // forward-compat: unknown keys round-trip, never dropped
}
```

* Sketch entities get a dedicated small codec for the sketch-legal subset (7–9 types) with stable ids; the
  alternative — storing each sketch as a DXF `ENTITIES` fragment and reusing the existing writer/reader — is
  viable and drift-free but heavier to parse and needs stable handles. Decide in Phase 1; the codec is the
  default recommendation.
* Migrations: `cad3d-core/schema/migrate.ts` with one function per version step; unknown feature types are
  preserved and shown as "unsupported feature" rather than dropped (contrast today's silent skip in
  `_loadFromJsonEntities`).
* **Cached tessellation** (Phase 2+): a sidecar object `mesh.bin` (quantized positions/normals/edge lines + face
  id table) next to each version, so a part opens instantly and thumbnails/viewers never need the kernel;
  the kernel rebuild replaces it in the background.
* Exports: STEP AP214 (kernel), STL / glTF (kernel or three.js), later 3MF, and DXF with bodies as `MESH`/
  `3DFACE` for AutoCAD interchange (DXF `3DSOLID` is ACIS-encoded and out of reach). Imports: STEP / IGES / BREP
  as a "base body" feature (Phase 4).

---

## 4. Backend and database changes

All small; `commitVersion`, sharing, folders, trash, orgs and the versions UI carry over unchanged.

| Area | Change |
|---|---|
| `schema.prisma` | `enum DrawingFormat { DXF DWG PART }` (or a separate `kind` column if we later want format ≠ document class). Migration is additive. |
| `storage-keys.ts` | Parameterise the extension by format: `v{n}.dxf` / `v{n}.json`; staging likewise. Add optional `v{n}.mesh.bin`. |
| Content route | Accept `application/json` (or `application/vnd.cado.part+json`) on `PUT /drawings/:id/content`; mount `express.json`/`express.text` per type. |
| Validation | Replace the unconditional `looksLikeDxf` sniff with a `format → validator` registry: DXF sniff for `dxf`, JSON-envelope check (`kind === 'part'`, `schemaVersion` in range) for `part`. Apply on create, save, complete. |
| Size limits | **Fix the presign path bug** (staged uploads 413 on exactly the payloads they exist for). Per-format `MAX_INLINE_CONTENT_BYTES`. Parts without mesh cache are small; with cache they need the staged path. |
| `POST /drawings` | `initialContent` + `format`; blank part template is client-generated (do not duplicate the `blankDxf()` byte-parity liability). |
| Thumbnails | Unchanged contract. |
| Listing DTOs | `format` already present on `DrawingSummaryDto`; dashboard filters on it. |
| Versions | Feature edits are frequent; keep server versions on explicit save/autosave only (as today), not per feature op. Consider a per-format `MAX_VERSIONS`. |
| Later (Phase 5) | Optional `geometry-worker` Node service running the same WASM kernel for headless regen (thumbnails, STEP on share, version diffs). Needs a queue and memory limits — a real infra addition, planned explicitly. |

Client persistence: `DrawingPersistenceService` becomes format-aware (`serialise()`/`deserialise()` dispatch on
document kind); IndexedDB `StoredDrawing` gains `format` (bump `DRAWING_DB_VERSION` to 2 with a trivial
upgrade); the worker's `{`-prefix branch routes `kind === 'part'` to the part loader.

---

## 5. Phased plan and effort

Assumptions: 2–3 engineers, one with graphics/CAD-kernel experience; estimates are engineer-weeks (ew) with a
range; calendar time assumes ~2.5 ew per week of parallel work. Each phase ends with something demoable.

### Phase 0 — Spike and decisions (2–3 weeks, 4–6 ew)

Goal: retire the biggest unknowns before any product code depends on them.

1. Kernel bake-off in a worker: replicad vs occt-wasm/brepjs on *our* operations — init time (cold/warm),
   extrude/revolve/fuse/cut/fillet on 10 representative profiles, tessellation with face/edge ids, STEP export
   and re-import, memory after 200 operations, failure modes. Produce the `IGeometryKernel` interface from what
   both need.
2. planegcs: map LINE/ARC/CIRCLE/ELLIPSE/SPLINE + constraints to solver primitives; measure solve time for a
   50-entity sketch; verify DOF and conflict reporting.
3. GL layer prototype inside `canvas.component.ts` sharing the existing rAF; verify no regression to 2D frame
   time when hidden; measure bundle impact with the kernel as a lazy chunk.
4. Camera ↔ `ViewModelService` bridge proof: draw an existing `LineEntity` on a tilted plane through the 2D
   path with the 3D camera and confirm pixel agreement.
5. Legal read on LGPL (OCCT, planegcs) for a SaaS with separately-loaded `.wasm` files.

Exit: decision memo (kernel binding, sketch codec choice, worker topology), `IGeometryKernel` + `ISketchSolver`
interfaces committed, risk list updated.

### Phase 1 — Foundations (4–6 weeks, 10–14 ew)

* `cad3d-core`: `PartModel`, `Feature`, `Sketch`, `Reference`, JSON schema v1 + codec + migration scaffold,
  expression evaluator with identifiers, DAG + topological order, unit tests.
* `cad3d-kernel`: worker entry, RPC, replicad adapter for extrude/revolve/boolean/tessellate/STEP/STL, handle
  lifetime management, error mapping.
* `PartDocument` + `DocumentKind` through `DocumentManagerService`, `EditorMode` signal, ribbon swap, empty
  feature-tree and parameters panels, sidebar buttons.
* Viewport: GL layer, orthographic/perspective camera, orbit/pan/zoom, grid + axes, named views, ViewCube-lite,
  visual styles, theme colors, tiled viewports via scissor, HiDPI.
* Backend: enum + migration, storage keys, content-type + validator registry, presign fix, dashboard "New Part".
* Persistence: format-aware serialise/deserialise, IndexedDB v2, autosave, versions/restore for parts.

Exit: create a Part, see a hard-coded test body rendered and orbited, save/reload/version it in the cloud.

### Phase 2 — MVP modeling (6–8 weeks, 14–20 ew) → **first shippable 3D**

* Sketch mode on base planes with the existing 2D tools; sketch-legal subset; construction geometry; Finish
  Sketch.
* Profiles: topology fixes (bulges, splines, all-faces query); profile picking with hover fill; profile
  references by loop signature.
* Constraints: planegcs integration, constraint tools + glyphs, driving dimensions, drag-solve, DOF in status
  bar, conflict UI.
* Features: Extrude (distance / symmetric / through-all, join / cut / new body, direction flip, live DYN
  preview), Revolve (axis from a sketch line or base axis, angle), Boolean (union / subtract / intersect on
  bodies).
* Feature tree: edit / rename / suppress / reorder / delete / rollback; rebuild engine with per-feature cache;
  error badges; undo/redo through `CommandStackService`.
* Picking of bodies/faces/edges; basic 3D snaps; measure distance.
* Export STEP / STL; thumbnails from GL; part appears in dashboard, share, versions.
* Tests: `cad3d-core` (DAG, naming v1, codec, migrations), kernel adapter contract tests in Node against the
  same WASM, a regression corpus of 20 parts rebuilt in CI.

Exit criteria (MVP): a user models a bracket — rectangle sketch with dimensions and constraints → extrude →
sketch a circle on the top base plane offset → cut-extrude a hole → revolve a boss → union; edits the first
dimension and the whole part updates; undoes; saves to the cloud; reopens; exports STEP that opens in FreeCAD.

### Phase 3 — Hardening and mechanical essentials (6–8 weeks, 14–20 ew)

* Sketch on planar faces and offset/angled work planes (persistent naming in anger); project edges into sketch.
* Fillet / Chamfer (3D) on edge selections; Hole (simple/counterbore), Shell, Mirror, Rectangular/Circular
  Pattern; Move/Rotate body.
* Parameters table with expressions and units across sketches and features; unit-aware DYN input.
* Persistent naming v2 (lineage through booleans), geometric fallback, "reference lost" repair UI.
* Cached tessellation sidecar → instant open, kernel loads in background; LOD for edges; large-part performance
  budget (≥ 200 features / 50k faces at 60 fps orbit).
* Section view, mass properties, measure angle/area/volume; more visual styles.
* Translations for the 3D command set (14 languages), unhide tools; accessibility pass on new panels.

### Phase 4 — Meeting the 2D product (6–10 weeks, 14–24 ew)

* **Part → Drawing views**: OCCT HLR projections (front/top/side/iso/section) inserted into a normal DXF drawing
  as associative blocks with hidden-line styles; update-on-change via a `PartReference` in the drawing's
  extension dictionary; dimensions attach to projected edges via the existing anchor mechanism.
* Import STEP / IGES / BREP as a base body feature; DXF export of bodies as MESH/3DFACE; glTF/3MF export.
* AI agent tools for 3D using the `validate → compile → ICommand[]` pattern (e.g. "add a 5 mm fillet to the
  top edges").
* Multi-body management (bodies panel, visibility, appearance/material per body).

### Phase 5 — Toward a serious platform (ongoing)

Sweep / loft / thread cosmetics · assemblies with mates (needs a 3D constraint solver — planegcs is 2D; evaluate
OCCT-based or in-house rigid-body solver) · real-time collaboration (the part model is a small JSON document,
so CRDT/OT on the feature list is far more tractable than on DXF) · server-side geometry worker (same WASM in
Node: headless regen, thumbnails, STEP on demand, version diffs) · own OCCT 8.x build with pthreads behind
COOP/COEP · WebGPU when three.js drops "experimental" · sheet-metal and simulation are out of scope.

### Totals

| Milestone | Engineer-weeks | Calendar (2–3 people) |
|---|---|---|
| Phase 0 | 4–6 | 2–3 weeks |
| Phase 1 | 10–14 | 4–6 weeks |
| Phase 2 (**MVP**) | 14–20 | 6–8 weeks |
| **MVP total** | **28–40** | **≈ 3.5–4.5 months** |
| Phase 3 | 14–20 | 6–8 weeks |
| Phase 4 | 14–24 | 6–10 weeks |
| **Through Phase 4** | **56–84** | **≈ 9–12 months** |

---

## 6. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Persistent naming breaks on edits (the classic parametric-CAD failure) | Features lose references after upstream changes | Generator-based names in MVP, geometric fallback, explicit "reference lost" state, repair UI in Phase 3; restrict MVP sketch planes to base planes so it cannot bite before Phase 3. |
| Kernel payload 5–7 MB + 1–3 s init | Slow first open, bundle budget | Lazy chunk on first Part open, long-lived caching, cached tessellation sidecar so the model shows before the kernel is ready; never in the initial bundle. |
| OCCT robustness (booleans/fillets fail on some inputs) | Feature errors | Fail per feature, never the document; regression corpus in CI; plan for OCCT 8.x build by Phase 3. |
| Single-maintainer dependencies (replicad, planegcs, occt-wasm) | Abandonment | Port interfaces we own; vendor the `.wasm` artifacts; keep an own-build path documented. |
| LGPL/AGPL compliance | Legal | OCCT and planegcs as separately loaded `.wasm` with attribution; no Chili3d code. Legal review in Phase 0. |
| 2D regression | Existing users | GL layer and 3D services only instantiated for `PartDocument`; drafting mode code paths unchanged; 2D smoke tests before each phase merge. |
| i18n CI gate | Blocked merges | `hidden: true` on 3D tools until Phase 3 translation sprint. |
| Thin test culture on tools | Bugs in interactive code | All 3D logic in pure modules (`cad3d-*`) with unit tests; kernel contract tests run in Node against the same WASM; interactive layer kept thin. |
| Main-thread jank from solving/rebuilding | Poor UX | Kernel and solver only in workers; drag-solve fast path; rebuild results applied on the render loop like hatch regen. |
| `strict: false` and `[key: string]: any` | Type safety erodes in 3D code | New `cad3d-*` folders written strict-clean and linted as such; schedule project-wide `strict: true` as a separate chore. |

---

## 7. Decisions needed from the product side

1. **Kernel binding after Phase 0** (replicad default vs occt-wasm/brepjs vs own build) — engineering recommends
   deciding on measured results, not now.
2. **Part as a separate document kind vs 3D inside DXF drawings** — this plan chooses the former; the latter
   would put a feature tree into DXF extension dictionaries and gate every save on DXF, which we advise against.
3. **Translation budget timing** for the 3D command set (Phase 3 in this plan).
4. **Whether Phase 4's part → drawing views is the priority after MVP** (mechanical users will expect it) versus
   Phase 3 depth (fillets, patterns, parameters). The plan orders depth first because views depend on stable
   persistent naming.
