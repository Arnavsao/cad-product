# Migration from the bridge repository

Extracted on 2026-08-29 from `aagento-bridge-integration-bridge-engine-stable`.
The source repository was **not modified** — it still builds and its bridge exporters still import `src/cad-core`.

## What moved (copied) here

| Source (bridge repo)                                        | Destination (this repo)                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| `src/cad-core/**`                                           | `src/cad-core/**` (unchanged)                                 |
| `src/app/features/cad/components/cad-editor/**`             | `src/app/features/cad-editor/**`                              |
| `src/app/features/cad/services/gad-transfer.service.ts`     | `src/app/features/cad-editor/core/services/drawing-transfer.service.ts` (renamed `DrawingTransferService`, storage keys `cad.transfer.*`) |
| `src/app/core/services/notification.service.ts`             | `src/app/core/services/notification.service.ts`               |
| `src/app/core/services/http-manager.service.ts`             | `src/app/core/services/http-manager.service.ts` (uses `environment.apiUrl`) |
| `FeedbackService.getPresignedUrl/uploadToS3`                | `src/app/core/services/file-upload.service.ts` (`FileUploadService`) |
| `src/app/shared/components/notification-display`            | `src/app/shared/components/notification-display`              |
| `main.ts` canvas `ellipse()` patch                          | `src/polyfills.ts`                                            |

354 files / ~80k lines. Every relative import was re-resolved programmatically; all intra-tree paths were verified to
exist before the first build.

## Edits made to migrated code

1. `cad-editor.ts/.html` — removed the bridge app's `<app-profile-dropdown>` (account menu) from the header;
   `GadTransferService` → `DrawingTransferService`.
2. `features/l-section/l-section-panel.component.ts` — `FeedbackService` → `FileUploadService` (same method names).
3. `features/ai-agent/services/ai-audit.service.ts` — `environment.nodeApiUrl` → `environment.apiUrl`; skips the POST when
   no backend is configured.
4. `features/ai-agent/models/ai-model.ts` and the AI panel — the hard-coded LAN Ollama address
   (`http://192.168.1.109:11434`) is now `environment.defaultOllamaUrl` (default `http://localhost:11434`).

No algorithmic or rendering code was changed.

## What intentionally stayed in the bridge repository

These are bridge-domain integrations that *use* CAD rather than being part of it:

* `src/app/features/cad/services/` — `dxf-export.service`, `dxf-preview.service`, `boq-export.service`,
  `bridge-excel-import.service`, `excel-import.models`, `layout-state.service` (all import bridge exporters, BOQ
  engines and project state).
* `src/app/features/cad/components/` — `dxf-preview`, `workspace-panel`, `layout-editor`.
* `src/app/features/cad/config/railway-excel.config.ts`, `src/app/features/cad/endpoints/*`.
* `src/pages/cad-editor/core/services/theme.service.ts` — an orphaned duplicate with no importers; safe to delete.

## Recommended next step for the bridge repository

Point the bridge app at this project instead of its private copy, then delete the copy:

1. Publish `src/cad-core` (and optionally `features/cad-editor`) from this repo as an npm package or add this repo as a
   git submodule / workspace package.
2. In the bridge repo, replace `../../../cad-core/...` imports in the 11 `*-dxf-export.ts` files with the package import,
   and route `/cad-editor` to the published component (or link to the standalone deployment and hand drawings over via
   `DrawingTransferService` / the JSON payload contract in INTEGRATION.md).
3. Remove `src/cad-core` and `src/app/features/cad/components/cad-editor` from the bridge repo.

Until step 3 is done, fixes must be applied in both places — treat this repository as the source of truth.
