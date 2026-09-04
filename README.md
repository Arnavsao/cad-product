# CADO

A **browser-based 2D CAD product** — an Angular 20 drafting editor (zoneless, signals, standalone components) with
accounts, cloud drawing storage and a file dashboard behind it.

The editor provides DXF import/export, paper-space layouts and viewports, blocks with attributes, dimensions and
dimension styles, hatches, tables, text/MText editing, an object library, PDF/SVG plotting and an AI drafting
assistant. The whole UI, command prompts included, is available in the same fourteen languages AutoCAD ships in. Around it sit Supabase authentication, onboarding, a drawings dashboard, and a NestJS API backed by Postgres
and S3-compatible object storage.

The editor can still be embedded in a host application that owns identity — leave the Supabase keys empty and it
runs standalone (see [docs/INTEGRATION.md](docs/INTEGRATION.md)).

---

## Quick start

Full stack (web + API + Postgres + MinIO):

```bash
nvm use            # Node 24 (see .nvmrc); Node >= 20.19 is required
npm run setup      # installs both packages, starts Postgres + MinIO, runs migrations
npm run dev        # API on :3000, web on http://localhost:4200
```

Editor only, no backend — leave `supabaseUrl`/`supabaseAnonKey` empty in `src/environments/environment.ts`:

```bash
npm ci
npm start          # http://localhost:4200  (dev server, hot reload)
```

You need a [Supabase](https://supabase.com) project for the signed-in flow. Copy `server/.env.example` to
`server/.env` and fill in `SUPABASE_URL` (plus `SUPABASE_JWT_SECRET` on projects still using the legacy symmetric
secret); put the project URL and anon key in `src/environments/environment.ts`. Add
`http://localhost:4200/auth/callback` to the project's redirect allow-list, and enable whichever OAuth providers you
want. For local API work without a Supabase project at all, `npm --prefix server run mint-token`
issues a token the guard accepts.

| Script                 | What it does                                                          |
| ---------------------- | --------------------------------------------------------------------- |
| `npm run setup`        | Install both packages, start Postgres + MinIO, run migrations         |
| `npm run dev`          | Everything: Postgres + MinIO, the API, and the web dev server         |
| `npm start`            | Web dev server only, at `http://localhost:4200`                       |
| `npm run start:lan`    | Same, bound to `0.0.0.0` so other devices on the LAN can open it      |
| `npm run db:up` / `db:down` / `db:reset` | Postgres + MinIO containers                         |
| `npm run db:migrate` / `db:studio` | Prisma migrations / data browser                          |
| `npm run build`        | Production build → `dist/aagento-cad/browser` (hashed, minified)      |
| `npm run build:dev`    | Unminified development build                                          |
| `npm run typecheck`    | `tsc --noEmit` over the application sources                           |
| `npm test`             | Karma/Jasmine in watch mode                                           |
| `npm run test:ci`      | Single headless run (used by CI)                                      |
| `npm run analyze`      | Production build with `stats.json` for bundle analysis                |
| `npm run docker:build` | Build the production container image (`aagento-cad`)                  |
| `npm run docker:run`   | Serve the image on `http://localhost:8080`                            |

## Configuration

Runtime configuration lives in `src/environments/`:

| Key                     | Purpose                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `apiUrl`                | Base URL of the CADO API (drawings, folders, profile). Relative `/api/v1` in both dev (proxied by `ng serve`) and prod (proxied by nginx). |
| `supabaseUrl`           | Supabase project URL — public, safe to commit. |
| `supabaseAnonKey`       | Supabase anon key — public, safe to commit. **Either empty disables auth**: the dashboard is unreachable and the editor runs standalone (embedded mode). |
| `defaultOllamaUrl`      | Default Ollama endpoint pre-filled in the AI panel settings (users can override it in the UI). |
| `appName`               | Product name.                                                                          |

`environment.prod.ts` is swapped in by `ng build` (`fileReplacements`) — template the publishable key in your release
pipeline. Bearer tokens come from the pluggable `AUTH_TOKEN_PROVIDER`
(`src/app/core/config/auth-token.provider.ts`), which resolves to Supabase's short-lived access token; a host application
can override it to supply its own.

The API reads `server/.env` (see `server/.env.example`): `DATABASE_URL` + `DIRECT_DATABASE_URL` (pooled and direct —
Neon needs both), the `SUPABASE_*` keys, and the `S3_*` block pointing at MinIO locally or R2/S3 in production.

## Languages

The UI ships in fourteen languages — deliberately AutoCAD's set, so a drafter arriving from AutoCAD finds both their
language and their terminology:

English · Čeština · Deutsch · Español · Français · Magyar · Italiano · 日本語 · 한국어 · Polski ·
Português (Brasil) · Русский · 简体中文 · 繁體中文

The language is resolved from `localStorage['cad.locale']`, then the browser's `navigator.languages`, then English;
signing in applies the account's stored `locale` on top. Users switch it in **Settings → Language**, and the choice
persists to the account and follows them across devices. `LanguageService`
(`src/app/core/i18n/language.service.ts`) is shaped like `ThemeService` on purpose — both are runtime preferences with
the same lifecycle.

Translation files live in `public/i18n/<code>.json` and are served from the web root. **`en.json` is generated** —
the editor's ~465 command prompts and tool names are extracted from
`command-prompts.registry.ts` and `tool-catalog.service.ts` rather than hand-maintained, so adding a tool cannot ship
an untranslatable name. Edit `scripts/i18n/app-strings.en.json` for app text, then run `npm run i18n`.

A key missing from a language falls back to its English text rather than rendering the key name, which is what makes a
partially-translated language safe to ship — and also what makes a gap invisible at runtime. `npm run i18n:validate`
runs in CI and is the only thing that surfaces it.

> **The non-English files are drafted, not professionally reviewed.** They follow established AutoCAD terminology per
> language, but each should be read by a native-speaking drafter before you call that language done. Command prompts
> are the highest-risk area — they are read mid-task by someone who will not tolerate a wrong term.

See [docs/TRANSLATING.md](docs/TRANSLATING.md) for the conventions, what must never be translated, and how to add a
language.

## Billing

Pro and Team are sold as subscriptions through [Dodo Payments](https://dodopayments.com).
Checkout and the customer portal are both hosted by Dodo; the API records which plan an
account is entitled to and never decides it locally.

Billing is **off until configured**. With no `DODO_API_KEY` the checkout endpoints answer
`503 BILLING_NOT_CONFIGURED` and the webhook route rejects every delivery — it fails closed,
because an unauthenticated route that changes what someone has paid for must never accept an
unverified body. Everything else in the app works normally, reporting the Free plan.

Plan entitlement is recorded but **not yet enforced**: the Free tier's advertised limits are
not applied. `BillingService.effectivePlan()` is the one place to read when adding gating.

See [docs/BILLING.md](docs/BILLING.md) for product setup, the webhook endpoint, the
checkout/webhook race, and the four safety properties of the webhook route.

## Deployment

Two containers: nginx serving the Angular build, and the API.

```bash
docker compose -f docker-compose.prod.yml up -d --build   # web on :80, api internal
```

`nginx.conf` (plus the shared `nginx.common.conf` it includes) provides the SPA fallback, gzip, immutable caching for
hashed assets, `no-store` for `index.html`, security headers including a Content-Security-Policy, `robots.txt`, a
`/healthz` endpoint used by the container `HEALTHCHECK`, and a `location ^~ /api/` proxy to the API container. That
proxy is not optional: the app calls a relative `/api/v1`, so without it every API request falls into the SPA
fallback and gets `index.html` back. Its `client_max_body_size 8m` matters too — nginx's 1 MB default would reject
every inline drawing save.

It serves plain HTTP on :80 by default, which is correct when TLS is terminated upstream (Cloudflare, an ALB, a
reverse proxy). If this container is the public edge instead, see [DEPLOYMENT_TLS.md](DEPLOYMENT_TLS.md) to switch to
`nginx.ssl.conf` with a Let's Encrypt certificate.

> **CSP note.** The auth UI is now first-party Angular, so no third-party script host has to be allow-listed for
> sign-in. The browser does call your Supabase project directly, so `connect-src` in `nginx.common.conf`'s CSP header
> must permit `https://<your-ref>.supabase.co` before going live — otherwise sign-in requests are blocked silently.

Postgres and object storage are external in production (Neon, Cloudflare R2 / S3), configured through `server/.env`.
The API runs `prisma migrate deploy` on boot. See [docs/BACKUPS.md](docs/BACKUPS.md) for the backup/restore story on
both.

The editor alone is still a static SPA — build it and host the `dist/` output anywhere if you don't need the backend.

**Browser requirements:** Web Workers (`new Worker(new URL(...))`), Canvas 2D, ES2022. The DXF parser runs in a worker
so large drawings never block the UI thread.

## Project layout

```
src/
├── cad-core/                 Framework-agnostic geometry & drafting model (no Angular imports)
│   ├── primitives/ math/     Point, Vector, Transform, tolerance
│   ├── models/               Drafting entities, dimensions, semantics, export models
│   ├── adapters/             DraftingCanvasContext (Canvas2D-compatible recorder), CanvasMultiplexer
│   ├── renderers/dxf/        DXF writer
│   └── spatial/ validation/  Spatial index, validators, telemetry hooks
├── app/
│   ├── core/                 HTTP wrapper, typed API clients, Supabase auth + guards, notifications,
│   │                         global error handler, auth-token provider, preload strategy
│   │   └── i18n/             14-language registry, LanguageService, Transloco loader + providers
│   ├── shared/ui/            Design-system primitives: button, input, card, dialog, menu,
│   │                         empty state, skeleton, icon, account button, pipes
│   └── features/
│       ├── landing/ auth/    Marketing page, sign-in / sign-up / reset / OAuth callback
│       ├── onboarding/       First-run: role, units, theme
│       ├── dashboard/        Recent, My Drawings, folders, Trash, Settings, upload
│       └── cad-editor/       The editor
│           ├── core/         Document/view/command services, persistence, entity models, DXF worker
│           ├── tools/        Draw / modify / select / block / inquiry tools (command pattern)
│           └── features/     UI: canvas, toolbar, panels, dialogs, text/table editors, AI agent
├── environments/             Build-time configuration
├── polyfills.ts              Canvas `ellipse()` negative-radius guard
└── styles.scss, theme.scss   Global baseline + `--color-*` fallback tokens (themes are applied at runtime by
                              ThemeService; editor tokens are derived in cad-editor.scss)

server/                       NestJS API (own package)
├── prisma/schema.prisma      User, Folder, Drawing, DrawingVersion, ShareLink, WebhookEvent
└── src/
    ├── auth/                 SupabaseAuthGuard, jose verifier, lazy local-user creation
    ├── billing/              Dodo Payments: checkout, customer portal, signed webhooks
    ├── drawings/ folders/    CRUD, versioned saves, uploads/import, thumbnails
    ├── storage/              S3-compatible object store (MinIO / R2 / S3)
    ├── users/                /me + onboarding, profile mirrored from token claims
    └── common/ config/       Response envelope, exception filter, Zod-validated env
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layering rules and the main services.

## Quality gates

* `npm run typecheck` — passes.
* `npm run build` — passes with **zero warnings**; initial bundle ≈ 283 kB raw / 81 kB transferred, editor lazy-loaded.
* `npm run test:ci` — 126 specs, 107 passing. The 19 failures are pre-existing and identical to the source
  repository (`AiPreviewService`, `CadContextService`, and a handful of `cad-core` geometry expectations); they are tracked in
  [CHANGELOG.md](CHANGELOG.md) as known issues and were intentionally not altered during the extraction.
* CI (`.github/workflows/ci.yml`) runs typecheck → build → headless tests on every push and PR.

## Documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, key services, data flow, extension points.
* [docs/TRANSLATING.md](docs/TRANSLATING.md) — the fourteen languages, translation conventions, what not to translate.
* [docs/BILLING.md](docs/BILLING.md) — Dodo Payments setup, the checkout/webhook flow, and how to add feature gating.
* [docs/INTEGRATION.md](docs/INTEGRATION.md) — embedding the editor and handing drawings to it from a host app.
* [docs/MIGRATION.md](docs/MIGRATION.md) — what was moved from the bridge repository, what stayed, and how the bridge
  app should consume this package going forward.
* [docs/3D-MODELING-PLAN.md](docs/3D-MODELING-PLAN.md) — the phased plan for parametric 3D modeling (kernel choice,
  architecture, data model, backend changes, effort). Roadmap for after the 2D launch; nothing from it is implemented yet.
* [CHANGELOG.md](CHANGELOG.md)
