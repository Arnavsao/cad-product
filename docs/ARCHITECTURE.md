# Architecture

## Layering

```
┌──────────────────────────────────────────────────────────────┐
│ app shell        App, routes, guards, providers, errors       │
├──────────────────────────────────────────────────────────────┤
│ features/landing · auth · onboarding · dashboard              │
│ features/cad-editor/features   UI components & dialogs        │
│ features/cad-editor/tools      Interactive tools (commands)   │
│ features/cad-editor/core       Document / view / command svc  │
├──────────────────────────────────────────────────────────────┤
│ app/shared/ui    Design-system primitives (button, dialog …)  │
├──────────────────────────────────────────────────────────────┤
│ app/core         HTTP, API clients, Supabase auth, notifs    │
├──────────────────────────────────────────────────────────────┤
│ cad-core         Pure TypeScript geometry & drafting model    │
└──────────────────────────────────────────────────────────────┘

                    server/   NestJS API (own package, own container)
```

Dependency rule: arrows point **down only**.

* `cad-core` imports nothing from Angular or from `app/`. It is safe to publish as its own package or run in a worker.
* `features/cad-editor` may import `cad-core` and `app/core`, never the app shell.
* `app/core` knows nothing about CAD.

Path aliases `@cad-core/*` and `@cad-editor/*` are configured in `tsconfig.json` for new code; the migrated code uses
relative imports.

## Key runtime services (`features/cad-editor/core/services`)

| Service                    | Responsibility                                                                 |
| -------------------------- | ------------------------------------------------------------------------------ |
| `DocumentManagerService`   | Open documents (tabs), active document, close/save lifecycle                    |
| `DocumentService`          | Entities, layers, blocks, dim styles of the active file; change signalling      |
| `ViewModelService`         | World↔screen transform, zoom/pan, dirty flags, zoom-extents                     |
| `ViewportManagerService`   | Paper-space layouts and viewports                                               |
| `CommandStackService`      | Undo/redo stack of `Command` objects (`core/models/command.model.ts`)           |
| `ToolManagerService`       | Active tool state machine; tools register themselves at bootstrap               |
| `CommandRegistryService`   | Command-line aliases → tool/action mapping                                      |
| `SnappingService`          | Object snaps, ortho/polar tracking, grid                                        |
| `DynamicInputService`      | Heads-up numeric input next to the cursor                                       |
| `DxfImportService`         | Parses DXF (in `core/workers/dxf-parser.worker.ts`) or JSON entity payloads     |
| `ExportService` / `ExportManagerService` / `PdfExportService` | DXF, SVG, PDF plotting                      |
| `LibraryService`           | Reusable symbol library (localStorage-backed)                                   |
| `ThemeService`             | Applies the active colour theme: CSS `--color-*` custom properties onto `<body>`, plus the canvas palette read by non-DI drawing code. Persisted under `localStorage['cad.theme']` |
| `theme-registry.ts`        | The 12 built-in themes. Each is a ~12-colour seed expanded into UI tokens and a full `ICadCanvasPalette` |
| `DrawingTransferService`   | Hand-off inbox for host applications (see INTEGRATION.md)                       |

## Rendering

`features/canvas` owns the HTML canvases (model, overlay, grid). Entities are drawn via renderers in `core/services`
using a `DraftingCanvasContext`-compatible API from `cad-core/adapters`, which lets the same drawing code target the
screen, an SVG recorder or the DXF writer.

## Tools

Every interactive tool (`tools/draw`, `tools/modify`, `tools/select`, `tools/block`, `tools/options`) implements the
`Tool` interface (`core/models/tool.interface.ts`): pointer/keyboard hooks, prompt text, and completion via
`CommandStackService.push(command)`. Geometry helpers shared across tools live in `tools/geometry-utils.ts`.

## AI drafting assistant (`features/ai-agent`)

* `LlmGatewayService` talks to Ollama (local) or OpenRouter directly from the browser.
* `AiToolRegistryService` exposes editor capabilities as tool-calls; `tools/` contains the implementations.
* `AiAuditService` keeps an append-only audit log in IndexedDB (localStorage fallback). It is **local-only** — the
  assistant's actions are the user's own drafting history, not telemetry.

## Auth

Authentication is [Supabase Auth](https://supabase.com/auth). `SupabaseAuthService` (`app/core/auth/`) loads
`@supabase/supabase-js` from a lazy chunk and exposes `isLoaded` / `isSignedIn` / `user` as signals. There is no
hosted widget — the sign-in, sign-up, reset-password and account forms are ours (`app/features/auth/`). Supabase's
`onAuthStateChange` listener fires outside Angular, so the service only ever
*writes signals* — the one mechanism that schedules a render in a zoneless app.

Supabase access tokens are short-lived and `getSession()` refreshes them transparently, so nothing is cached
locally: `AuthTokenProvider.getToken()` may return a promise and `authInterceptor` awaits it per request. A 401
means the session is genuinely gone, so the interceptor redirects to `/sign-in?redirect_url=…` (skipped on public
routes to avoid a loop).

Leaving `supabaseUrl`/`supabaseAnonKey` empty disables auth entirely and the guards pass through — **embedded mode**,
where a host application owns identity and mounts the editor directly.

## Backend (`server/`)

A NestJS API — its own npm package in this repository, deployed as its own container.

| Area | Notes |
| --- | --- |
| Data | Prisma 7 + Postgres. `User`, `UserPreferences`, `Folder`, `Drawing`, `DrawingVersion`, `ShareLink`, `WebhookEvent` |
| Files | Drawing payloads (DXF text) and thumbnails live in S3-compatible storage — MinIO in dev, R2/S3 in prod. Postgres holds metadata only |
| Auth | `SupabaseAuthGuard` verifies the access token with `jose` — asserting signature, `iss` and `aud` — and lazily creates (and refreshes) the local user from the token claims. There is no webhook: the token is the only profile source |
| Contract | Every response is `{ success, data }` / `{ success, message, code }`, which is what `HttpManagerService` unwraps |

**Saving is concurrency-safe by construction.** A save reserves the next version number with a conditional
`UPDATE … WHERE currentVersion = <expected>` plus the unique `(drawingId, version)` index, *then* writes the object.
Two racing saves can never target the same storage key; the loser gets a 409 and the editor offers Overwrite /
Save as copy / Reload. Clients send the version they loaded as `If-Match`.

Drawing, DXF import/export, plotting, the symbol library and layouts still run entirely client-side; the API is for
identity, file management and durability.

## Error handling

`GlobalErrorHandler` logs every uncaught error and shows one throttled toast, so a failure in a tool never leaves the
UI silently frozen. Backend errors are normalised to `Error` instances with user-presentable messages by
`HttpManagerService`.
