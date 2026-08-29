# Integrating the editor into a host application

## 1. Run it as a separate deployment (recommended)

Deploy this project on its own origin (e.g. `cad.example.com`) and link to it. Pass context through the query string
(`/editor?projectId=…`); `LSectionPanelComponent` already reads `projectId` from the route.

## 2. Embed the component

`CadEditorComponent` (`src/app/features/cad-editor/cad-editor.ts`) is a standalone component with a small API:

```ts
readonly initialDxf = input<string>();  // DXF text or JSON entity payload to open on init
readonly save  = output<string>();      // emitted with the DXF when the user saves
readonly close = output<void>();
```

```html
<app-cad-editor [initialDxf]="dxf" (save)="onSave($event)" (close)="onClose()"></app-cad-editor>
```

Provide `provideHttpClient(withInterceptors([authInterceptor]))` (or your own interceptor) and, if your app has its own
session handling, override the token source:

```ts
{ provide: AUTH_TOKEN_PROVIDER, useExisting: MySessionService } // implements AuthTokenProvider
```

## 3. Hand a drawing over between pages

`DrawingTransferService` is a tiny inbox that survives a page refresh:

```ts
inject(DrawingTransferService).set(dxfText, 'Bridge_GAD.dxf', drawingId, projectId);
router.navigateByUrl('/editor');
```

The editor calls `consume()` on start-up and opens the drawing. Call `clear()` after persisting it.
Storage keys are prefixed `cad.transfer.*`.

## Payload formats accepted

* DXF text (AC1032 headers are validated; older files are still parsed).
* JSON entity payloads produced by `cad-core` exporters: an array of `IDraftingEntity`, or an object with
  `entities` / `drawingData` / `data` arrays.
