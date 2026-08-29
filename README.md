# Aagento CAD

A standalone, production-ready **browser-based 2D CAD editor** built with Angular 20 (zoneless, signals, standalone components).
It provides DXF import/export, paper-space layouts and viewports, blocks with attributes, dimensions and dimension
styles, hatches, tables, text/MText editing, an object library, PDF/SVG plotting and an AI drafting assistant.

The editor was extracted from the Aagento bridge-design application into this self-contained project so it can be
developed, tested, versioned and deployed on its own, and embedded back into host applications through a small,
documented integration surface (see [docs/INTEGRATION.md](docs/INTEGRATION.md)).

---

## Quick start

```bash
nvm use            # Node 24 (see .nvmrc); Node >= 20.19 is required
npm ci
npm start          # http://localhost:4200  (dev server, hot reload)
```

| Script                 | What it does                                                          |
| ---------------------- | --------------------------------------------------------------------- |
| `npm start`            | Dev server with source maps at `http://localhost:4200`                |
| `npm run start:lan`    | Same, bound to `0.0.0.0` so other devices on the LAN can open it      |
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

| Key                | Purpose                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `apiUrl`           | Base URL of the optional CAD backend (L-section generation, AI audit log, file uploads). Leave empty (`''`) to run fully offline; backend-backed features then surface a friendly error instead of failing silently. |
| `defaultOllamaUrl` | Default Ollama endpoint pre-filled in the AI panel settings (users can override it in the UI). |
| `appName`          | Product name.                                                                               |

`environment.prod.ts` is swapped in by `ng build` (`fileReplacements`). Template it in your release pipeline if the
API URL differs per environment. The bearer token attached to backend calls is read through the pluggable
`AUTH_TOKEN_PROVIDER` (`src/app/core/config/auth-token.provider.ts`); the default reads `localStorage['cad.auth.token']`.

## Deployment

The build output is a static SPA. Any static host works; the repository ships a hardened nginx setup:

```bash
docker build -t aagento-cad .
docker run --rm -p 8080:80 aagento-cad
```

`nginx.conf` provides the SPA fallback, gzip, immutable caching for hashed assets, `no-store` for `index.html`,
security headers and a `/healthz` endpoint used by the container `HEALTHCHECK`.

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
│   ├── core/                 App-level infrastructure: HTTP wrapper, auth interceptor, uploads,
│   │                         notifications, global error handler, auth-token provider
│   ├── shared/               Notification toast display
│   └── features/cad-editor/  The editor
│       ├── core/             Document/view/command services, entity models, registries, DXF worker
│       ├── tools/            Draw / modify / select / block / option tools (command pattern)
│       └── features/         UI: canvas, toolbar, panels, dialogs, text/table editors, AI agent, L-section
├── environments/             Build-time configuration
├── polyfills.ts              Canvas `ellipse()` negative-radius guard
└── styles.scss, theme.scss   Global baseline + `--color-*` theme tokens (editor tokens are in cad-editor.scss)
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
* [docs/INTEGRATION.md](docs/INTEGRATION.md) — embedding the editor and handing drawings to it from a host app.
* [docs/MIGRATION.md](docs/MIGRATION.md) — what was moved from the bridge repository, what stayed, and how the bridge
  app should consume this package going forward.
* [CHANGELOG.md](CHANGELOG.md)
