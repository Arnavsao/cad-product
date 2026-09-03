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

## 1.3.0 — 2026-09-02

Authentication moves from Clerk to Supabase. Auth only — Postgres, Prisma and the S3/MinIO storage layer are
untouched, so drawings, folders, feedback and notifications are unaffected.

### Added
* **Supabase Auth.** `SupabaseAuthService` wraps `@supabase/supabase-js` (lazy chunk) and exposes
  `enabled` / `isLoaded` / `isSignedIn` / `user` as signals, bridged from `onAuthStateChange`.
* **First-party auth UI**, since Supabase ships no drop-in widget: sign-in (email + password, magic link,
  Google / GitHub / Apple), sign-up with a "confirm your email" state, `/reset-password` (both halves of the
  recovery flow on one route), and `/auth/callback` — the single redirect target every Supabase flow returns to,
  and the one URL that must be allow-listed in the project.
* **Our own account menu** (avatar → Personal info / Account settings / Sign out) replacing Clerk's `<UserButton>`,
  and an Account pane in Settings with change-password plus read-only connected providers.
* `SUPABASE_URL` and `SUPABASE_JWT_SECRET` on the server; `supabaseUrl` and `supabaseAnonKey` on the client.

### Changed
* **Token verification** is now `jose` in `SupabaseAuthGuard`, asserting the signature plus **`iss` and `aud`**.
  Supabase has no `azp` claim, so those two are what stop a validly-signed token from another Supabase project
  being replayed against this API. JWKS (asymmetric) is preferred and cached; HS256 via `SUPABASE_JWT_SECRET` is
  the fallback for projects still on the legacy shared secret.
* **`ensureLocalUser` now refreshes the mirrored profile** when the token's claims differ from the stored row,
  writing only changed fields. With no user webhook, the access token is the only thing that carries a renamed
  profile into this database.
* `users.clerk_id` → `users.auth_id`; `AuthUser.clerkId` → `authId`; `MeDto.user.clerkId` → `authId`
  (a wire change). Supabase issues UUIDs, so the migration **truncates `users`** — no pre-existing row could
  match a Supabase sign-in again. `feedback` rows survive with a null user.
* `updateName` refreshes the session after writing `user_metadata`, so the new name reaches the access token
  before `/me` is re-read — otherwise the server re-derives the old name and the change appears to revert.
* Embedded mode now needs **both** client values empty; a half-configured app warns instead of silently
  behaving as though auth were switched off.
* The e2e harness mints HS256 tokens against a test secret it sets itself — no keypair, so `.dev-keys/` is gone.
  `npm run mint-token` works the same way.

### Removed
* `@clerk/clerk-js`, `@clerk/backend`, and with it `standardwebhooks`. `jose` moved to runtime dependencies.
* The `@clerk/ui` CDN loader (`clerk-ui-loader.ts`) — no third-party script is loaded for auth any more, so no
  `script-src` host has to be allow-listed. `connect-src` must now permit your Supabase project.
* `src/webhooks/` and the `webhook_events` table. **Known gap:** Supabase has no outbound "user deleted" webhook,
  so `deletedAt` is no longer set automatically when an account is deleted upstream. Nothing breaks — the token
  stops verifying — but the local row stays live. A Supabase Database Webhook on `auth.users` DELETE would
  restore it.
