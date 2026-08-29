# Integrating the editor into a host application

## 1. Run it as a separate deployment (recommended)

Deploy this project on its own origin (e.g. `cad.example.com`) and link to it. Link straight to a stored drawing with
`/editor/<drawingId>`, or to a blank one with `/editor`.

## 2. Embed the component

`CadEditorComponent` (`src/app/features/cad-editor/cad-editor.ts`) is a standalone component with a small API:

```ts
readonly id         = input<string>();          // open this stored drawing on init
readonly initialDxf = input<string>();          // …or hand it DXF text / a JSON entity payload directly
readonly exitUrl    = input<string | null>('/dashboard'); // pass null to keep the browser-history Back behaviour
readonly save       = output<string>();         // emitted with the DXF from Plot → Export
readonly close      = output<void>();           // emitted when the user presses Back
```

```html
<app-cad-editor [initialDxf]="dxf" [exitUrl]="null" (save)="onSave($event)" (close)="onClose()"></app-cad-editor>
```

**Embedded mode.** Leave `clerkPublishableKey` empty in `src/environments/environment.ts`. The route guards then pass
through, the account menu renders nothing, and a 401 from the API no longer redirects to our sign-in page — your
application owns identity. The dashboard is not meant to be used in this mode; link users straight at `/editor`.

Provide `provideHttpClient(withInterceptors([authInterceptor]))` (or your own interceptor) and, if your app has its own
session handling, override the token source:

```ts
{ provide: AUTH_TOKEN_PROVIDER, useExisting: MySessionService } // implements AuthTokenProvider
```

`getToken()` may return a `string`, `null`, or a `Promise` of either — return a promise if your tokens are minted on
demand. Your provider is responsible for its own expiry: in embedded mode the editor will not navigate on a 401.

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
