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

## 1.1.0 — 2026-08-29

CADOnline becomes a product rather than a standalone editor: accounts, cloud drawing storage and a file dashboard.

### Added
* **Backend** (`server/`) — NestJS 11 + Prisma 7 + Postgres, S3-compatible object storage (MinIO in dev, R2/S3 in
  prod). Drawings, versions, folders, trash, uploads/import, thumbnails, `/me` and onboarding. `docker-compose.yml`
  brings up Postgres + MinIO; `npm run dev` starts everything.
* **Auth** — Clerk. Sign-in / sign-up, guards, onboarding (role, units, theme), and a Svix-verified webhook that
  syncs users. Leaving `clerkPublishableKey` empty keeps the old standalone behaviour (embedded mode).
* **Dashboard** — Recent, My Drawings with folders and breadcrumbs, Trash, Settings, search, and drag-and-drop upload.
* **Cloud persistence** — Ctrl+S saves to the user's account. Saves carry `If-Match`, so a concurrent save from
  another session yields a 409 and the choice of Overwrite / Save as copy / Reload rather than silent data loss.
  Payloads over 5 MB upload directly to storage and commit separately. Thumbnails render after each save.
* **Design-system primitives** (`src/app/shared/ui/`) — button, input, card, dialog, menu, empty state, skeleton, icon.

### Fixed
* `closeDocument`'s "Save changes?" prompt called a stub that only cleared the dirty flag — answering **Yes threw the
  work away**. It now performs a real save and aborts the close if the save fails. The tab context menu had the same bug.
* A blank `CLERK_AUTHORIZED_PARTIES=` reached the guard as `''` rather than `undefined`, so `verifyToken` saw an empty
  list and **skipped the `azp` check entirely**, accepting tokens minted for any other Clerk frontend.
* A blank `S3_PUBLIC_ENDPOINT=` made the presigner sign for real AWS instead of MinIO, so every presigned URL was dead
  in local development. Blank optional env keys are now stripped centrally so the class of bug cannot recur.
* Opening a drawing with zero entities was treated as corruption, which would have made every blank cloud drawing
  unopenable.
* `DrawingTransferService.consume()` never cleared its inbox, so a handed-off drawing reopened on every visit.

### Removed
* **L-section** DXF generation and `FileUploadService` — bridge-specific, and this is a general-purpose CAD product.
* The **AI audit** `POST /ai/audit` upload. The log remains, local-only.
* `DXFPythonExporter` from `cad-core` — dead code that POSTed to a hard-coded `127.0.0.1:8000`.

### Known issues
The 19 pre-existing unit-spec failures from 1.0.0 are unchanged (107 pass / 19 fail).
