---
name: angular-frontend
description: Conventions for Angular code in CADO's src/ — zoneless change detection with signals, standalone OnPush components with inline templates, the layering rule (cad-core → app/core → cad-editor → features/app shell), theme tokens and ThemeService, the design-system primitives in app/shared/ui, API access through HttpManagerService and typed clients, and CSP-safe boot code. Use when writing or reviewing any component, service, route, or style in the web app, or when a change "works in ng serve but not in prod".
---

# Angular conventions (web app)

Angular 20, **zoneless**, signals, standalone components, `ChangeDetection.OnPush` by default (`angular.json` schematics). No Zone.js is loaded.

## Zoneless consequences

- Only a **signal write** schedules a render. Callbacks that fire outside Angular (Supabase `onAuthStateChange`, `window` listeners, Web Worker messages, `setTimeout`) must set a signal rather than mutate a plain field and hope.
- No `NgZone.run`, no `ChangeDetectorRef.detectChanges()` as a fix. If a view is stale, the state it reads is not a signal.
- TestBeds for services that touch Angular need `provideZonelessChangeDetection()`; the specs that lack it are the known failures (see the verify skill).

## Component shape

```ts
@Component({
  selector: 'app-thing',
  standalone: true,
  imports: [/* only what the template uses */],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `…`,           // inline; SCSS via styles: [`…`]
})
export class ThingComponent {
  private readonly svc = inject(ThingService);
  readonly items = computed(() => …);
}
```

- `inject()` over constructor injection in new code.
- Inline `template:` is a template literal: **no backticks in HTML comments** or the file stops parsing.
- Wrap translatable templates in one `*transloco="let t"` on the outermost element (see the i18n-strings skill).
- Heavy features load lazily: routes use `loadComponent`, editor tools use `registerAsync`.

## Layering (arrows point down only)

```
app shell → features/* → app/shared/ui → app/core → cad-core
```

- `src/cad-core` imports **nothing** from Angular or `app/`. It runs in the DXF worker.
- `features/cad-editor` may import `cad-core` and `app/core`, never the app shell or another feature.
- `app/core` knows nothing about CAD.
- New code uses the `@cad-core/*` and `@cad-editor/*` path aliases from `tsconfig.json`; migrated code has relative imports and need not be churned.

## Styling and themes

- Colours come from `--color-*` custom properties applied to `<body>` by `ThemeService` (12 themes in `theme-registry.ts`). Never hardcode a hex in a component; if a token is missing, add it to the theme seed expansion and the fallbacks in `theme.scss`.
- Canvas drawing code reads the palette from `ThemeService` rather than DI.
- Component styles have a 40 kB warning budget; shared visual patterns belong in `app/shared/ui` primitives (button, input, card, dialog, menu, empty state, skeleton, icon) rather than being re-declared.

## Data access

- Call the API through the typed clients in `app/core/api`; they use `HttpManagerService`, which unwraps `{ success, data }`, normalises errors to user-presentable `Error`s, and attaches the bearer token from `AUTH_TOKEN_PROVIDER`.
- URLs are relative `/api/v1`; never embed a host.
- 401 redirects to `/sign-in?redirect_url=…` except on public routes. Do not add a second redirect path.
- `GlobalErrorHandler` already toasts uncaught errors once; do not wrap every call in try/catch that swallows.

## CSP-safe boot

Production nginx sends a CSP without `'unsafe-inline'`. No inline `<script>` in `index.html`, no `onload=` attributes, and `inlineCritical` stays `false` in `angular.json`. Boot-time code goes in `public/*.js` files. If something works in `ng serve` and not in prod, suspect this first (see the deploy-azure skill).

## Environments

`src/environments/environment.ts` is dev; `environment.prod.ts` replaces it in production builds. `supabaseUrl`/`supabaseAnonKey` are public keys and safe to commit; leaving either empty switches the app into embedded, auth-less mode. Nothing secret belongs in `src/`.

## Before you finish

`npm run typecheck && npm run build` with zero warnings, and `npm run i18n` if any user-visible text changed. Then the verify skill.
