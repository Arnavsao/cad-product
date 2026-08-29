# Changelog

## 1.0.0 — 2026-08-29

### Added
* Standalone Angular 20 application shell (zoneless, lazy-loaded editor route, global error handler, toast display).
* Pluggable `AUTH_TOKEN_PROVIDER`, backend-scoped `authInterceptor`, typed `HttpManagerService`, `FileUploadService`.
* `DrawingTransferService` host hand-off contract.
* Typed environments (`environment.model.ts`), Dockerfile + hardened nginx config, GitHub Actions CI, `.nvmrc`.
* Documentation: README, ARCHITECTURE, INTEGRATION, MIGRATION.

### Changed
* Extracted `cad-core` and the CAD editor from the bridge application (see docs/MIGRATION.md).
* Removed the bridge account dropdown from the editor header.
* The light/dark toggle that lived in that dropdown is now a sun/moon button in the editor header, which flips between
  the last theme chosen for each ground.
* Colour themes: 12 built-in schemes (8 dark, 4 light) picked from a searchable list in the Settings panel — previously
  a stub. Themes colour the chrome, the canvas ground, the grid and the semantic accents together; the active one is
  persisted under `localStorage['cad.theme']`.
* The editor defaults to the dark theme when no preference is saved (`localStorage['theme']`); the OS `prefers-color-scheme` fallback was removed.
* LAN-specific Ollama default replaced by `environment.defaultOllamaUrl`.

### Known issues (pre-existing, unchanged by the extraction)
19 of 126 unit specs fail identically in the source repository: `AiPreviewService` (6), `CadContextService` (4),
`Vector` (2), `DraftingLine` (2), `DraftingCanvasContext` (2), `Transform` (1), `Point` (1), `HatchRendererService` (1).
Run `npm run test:ci` for the current list.
