# Changelog

## 1.5.0 — 2026-09-03

Paid plans. Pro and Team are sold as subscriptions through Dodo Payments; checkout and the
customer portal are both hosted by them.

### Added
* **`BillingModule`** (`server/src/billing/`) — checkout sessions, customer-portal links,
  a signed webhook receiver, and reconciliation against Dodo's API.
  * `GET /billing` — current plan and period.
  * `POST /billing/checkout` — starts a hosted checkout, returns the URL to redirect to.
  * `POST /billing/portal` — link to Dodo's portal for card, invoices and cancellation.
  * `POST /billing/refresh` — re-reads the subscription from Dodo.
  * `POST /billing/webhook` — the only unauthenticated route that can change a plan.
* **`subscriptions` and `webhook_events` tables** (migration `20260903170726_billing_dodo_payments`).
  `subscriptions` is a *projection of Dodo's state*, not a source of truth — which is why
  there is no local cancel endpoint. `webhook_events` is keyed by Dodo's `webhook-id`, so the
  insert itself is the idempotency check; it doubles as an audit trail.
* **`billing` on `/me`**, joined into the existing `Promise.all` fan-out so `/me` costs the
  same as before. Always present: an account with no subscription row reports the Free state,
  so no backfill was needed for accounts predating billing.
* **Plan & billing pane in Settings**, at `/dashboard/settings/billing` — the checkout
  `return_url`. Shows the plan, renewal or trial date, a pending cancellation, a Manage
  billing button and a Refresh button.
* Pricing page's paid CTAs now start a real checkout for signed-in visitors, and read
  "Current plan" on the tier the account is already on.
* [docs/BILLING.md](docs/BILLING.md) — setup, the flow diagram, and the webhook's safety
  properties. 25 unit specs (230 server tests total, all passing).

### Notes on design
* **Entitlement is derived, never stored twice.** `plan` records what was bought and `status`
  whether it is current; `BillingService.effectivePlan()` computes the effective plan from
  both. A cancelled Pro subscription keeps `plan = PRO` as the historical record while
  granting nothing. Feature checks must use `effectivePlan`, not `plan`.
* **`PAST_DUE` keeps access.** Dodo retries a failed charge over several days; revoking on the
  first failure punishes an expired card. When retries are exhausted the status becomes
  `CANCELLED` and access ends then.
* **Unknown upstream statuses fail closed.** Dodo documents a wider status vocabulary than we
  model and adds to it; anything unrecognised maps to `INCOMPLETE`, which grants nothing. A
  new upstream status must never accidentally hand out a paid plan.
* **The webhook fails closed.** With no `DODO_WEBHOOK_KEY` every delivery is rejected with 503
  rather than trusted. Signature verification runs against the **raw** request bytes —
  `app.setup.ts` mounts `express.raw()` for that path, because `express.json()` re-serialising
  the body breaks the HMAC. A handler error returns 500 so Dodo retries; returning 200 would
  silently drop a plan change.
* **Test vs live mode is inferred from the API key prefix**, with no separate flag. A flag
  could contradict the key, and a test key pointed at the live host is a mistake nobody
  notices until a real customer hits it.
* `OAuthButtonsComponent`-style string concatenation was avoided throughout; the checkout
  race (browser return beating the webhook) is handled by `POST /billing/refresh` rather than
  by optimistically assuming success.

### Known gaps
* **No keys are configured.** Billing is inert until `DODO_API_KEY`, `DODO_WEBHOOK_KEY` and at
  least one `DODO_PRODUCT_*` id are set. See [docs/BILLING.md](docs/BILLING.md).
* **Plan limits are recorded but not enforced.** The Free tier's advertised caps (3 drawings,
  50 MB) are not applied anywhere yet.
* Only subscription events are acted on. Payment, refund, dispute and licence-key events are
  recorded in `webhook_events` but have no handler, so adding one later needs no backfill.
* The billing pane's strings are hardcoded English — they are not yet in the translation
  files, so they do not follow the language setting.
* Prices in `pricing.data.ts` are display only; the charged amount is whatever the Dodo
  product says. Nothing reconciles the two.

## 1.4.0 — 2026-09-03

The UI becomes multilingual: fourteen languages, chosen to match AutoCAD's own set so a drafter arriving from AutoCAD
finds both their language and their terminology.

### Added
* **Transloco 8** (`@jsverse/transloco`), wired in `src/app/core/i18n/`:
  `provideI18n()`, a loader that reads `public/i18n/<code>.json` from the web root, and a 14-locale registry
  (`locales.ts`) that is the single source of truth — adding a language is a row there plus a JSON file.
* **`LanguageService`**, shaped deliberately like `ThemeService`: a signal-backed runtime preference persisted to
  `localStorage['cad.locale']`, mirrored onto `<html lang>`/`<html dir>`, and synced across tabs via the `storage`
  event. First load resolves `localStorage` → `navigator.languages` (widening `de-AT` → `de`, routing `zh-TW` →
  `zh-Hant` by script) → English.
* **Language picker** in Settings, next to Theme, listing each language by its endonym (`Deutsch`, not `German`).
* **`locale` on `UserPreferences`** (`TEXT NOT NULL DEFAULT 'en'`, migration `20260903180000_ui_locale`), validated
  against a server-side list on write and degraded to English on read, so a dropped language cannot break `/me`.
  `MeService.applyPreferences` pushes it into `LanguageService` exactly as it already did the theme.
* **Generated English for the editor.** `npm run i18n:extract` derives the ~465 command-prompt and tool-catalog keys
  from `command-prompts.registry.ts` and `tool-catalog.service.ts`; `npm run i18n:build` merges them with the
  hand-written `app-strings.en.json` into `public/i18n/en.json`. Adding a tool therefore cannot ship an
  untranslatable name. **`public/i18n/en.json` is generated — do not hand-edit it.**
* **`npm run i18n:validate`**, in CI: checks all 14 files against `en.json` for missing keys, extra keys and
  mismatched `{{placeholders}}`. A missing key falls back to English *silently*, so this check is the only thing that
  surfaces a gap. CI also fails if the committed `en.json` differs from what the registries generate.
* [docs/TRANSLATING.md](docs/TRANSLATING.md) — conventions, and the list of things that must never be translated.
* Specs for locale resolution and the translation fallback (248 specs total, all passing).

### Changed
* **`ToolCatalogService` translates tool titles and section labels**, preserving the keyboard alias: `'Line (L)'` is
  translated as `'Line'` and the `(L)` re-appended verbatim, since it is a shortcut rather than prose. `search()` now
  ranks against both the English and the translated title, so a French user can type "cercle" and someone following an
  English tutorial can still type "circle".
* **`CommandPromptService` translates prompt messages, option labels and hints.** Command names (`LINE`, `FILLET`) and
  option key letters are left in English on purpose: both are typed input matched by the parser, and the letter is
  what muscle memory and every AutoCAD tutorial use. Option matching accepts the key letter *and* the translated
  label. A language switch mid-command now re-resolves the visible prompt rather than waiting for the next phase.
* **`OAuthButtonsComponent`'s `verb` input became `mode`** (`'continue' | 'signUp'`). The old template built
  `verb + ' with ' + provider`, which cannot be translated — the joining word and the word order are both
  language-specific, and Japanese puts the provider first. It is now one parameterised sentence per mode.
* Transloco is injected `{ optional: true }` in both editor services, so an embedding host that never calls
  `provideI18n()` and specs without a Transloco provider both keep working, in English.

### Known gaps
* The non-English files are **drafted, not professionally reviewed**. They follow established AutoCAD terminology per
  language, but each should be read by a native-speaking drafter before that language is called done.
* Only the sign-in surface has been migrated to translation keys so far; the rest of the app (dashboard, onboarding,
  pricing, legal, editor panels and dialogs) still renders hardcoded English. Those strings are unaffected and
  continue to work — they simply do not respond to the language setting yet.
* No RTL language ships, so `dir` is `ltr` for all fourteen. `ILocale.dir` exists so adding one stays additive.

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

CADO becomes a product rather than a standalone editor: accounts, cloud drawing storage and a file dashboard.

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
