# Architecture

## Layering

```
┌──────────────────────────────────────────────────────────────┐
│ app shell        App, routes, providers, error handler        │
├──────────────────────────────────────────────────────────────┤
│ features/cad-editor/features   UI components & dialogs        │
│ features/cad-editor/tools      Interactive tools (commands)   │
│ features/cad-editor/core       Document / view / command svc  │
├──────────────────────────────────────────────────────────────┤
│ app/core         HTTP, auth token, uploads, notifications     │
├──────────────────────────────────────────────────────────────┤
│ cad-core         Pure TypeScript geometry & drafting model    │
└──────────────────────────────────────────────────────────────┘
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
* `AiAuditService` keeps a local audit queue and, when `environment.apiUrl` is set, mirrors it to `POST /ai/audit`.

## Backend-dependent features

Only two features need a server, both routed through `app/core/services/http-manager.service.ts` and the
`authInterceptor`:

* **L-section** (`features/l-section`): uploads KML/DTM/survey files via pre-signed URLs
  (`FileUploadService`, `GET /upload/presigned-url`), then calls `POST /l-section/generate` and loads the returned DXF.
* **AI audit** (above).

Everything else — drawing, DXF import/export, plotting, library, layouts — runs entirely client-side.

## Error handling

`GlobalErrorHandler` logs every uncaught error and shows one throttled toast, so a failure in a tool never leaves the
UI silently frozen. Backend errors are normalised to `Error` instances with user-presentable messages by
`HttpManagerService`.
