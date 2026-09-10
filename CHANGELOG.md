# Changelog

## Unreleased

DXF import fidelity. An imported drawing now renders as AutoCAD renders it: correct dimension
values, decoded text, per-style fonts and real lineweights.

### Added
* **A full public website around the editor.** The three marketing pages (landing, features,
  pricing), each carrying its own copy of the header and footer, are now a nine-page site under one
  shell route: Home, Product (how it works), Features, Use cases, Pricing, Docs, About, Contact and
  What's new, plus the legal drafts. `SiteShellComponent` mounts once for all of them: fixed
  translucent header with the primary nav and auth-aware actions, a mobile drawer, a four-column
  footer, the drafting-grid backdrop, per-route `<meta name="description">` from `data.description`,
  scroll reset and ScrollTrigger refresh on navigation.

  Content is real and shared. `site-content.ts` holds the facts every page cites — the command
  groups with their aliases (from `tool-catalog.service.ts`), the fourteen object snaps, paper sizes,
  formats, audiences, principles and timeline — so the home explorer, the features page and the docs
  command reference cannot list different commands. The screenshots in `public/site/*.webp` are
  headless captures of the editor with the repository's bridge general-arrangement DXF open (model,
  detail, layout, Layers, Blocks, AI Agent, Plot); nothing is a mock-up. The contact form posts to the
  existing `/feedback` endpoint, which already accepts anonymous submissions.

  Layouts vary by purpose: a Three.js hero that explodes the drawing into its layers as the page
  scrolls (`SiteLayerStackComponent`, lazily imported, SVG fallback without WebGL or under reduced
  motion); the CSS scroll-drawn floor plan kept from the old hero; a sticky command-line monitor
  beside the five workflow steps; a tabbed command explorer (`SiteExplorerComponent`, shared by Home
  and Features); annotated hotspots on a real screenshot; a sticky model/paper/plot walkthrough;
  comparison and format tables; accordions; a scroll-snap row of audiences; a docs page with a
  scrollspy sidebar and a filterable command reference.

  Motion is GSAP + ScrollTrigger (`SiteRevealDirective`, count-ups, the hero scrub) with Lenis
  smooth scrolling on the site routes only, all loaded on demand by `MotionService` and all skipped
  under `prefers-reduced-motion`, where every element lands on its finished state. `three`, `gsap`
  and `lenis` are new dependencies; none of them is in the initial bundle.

* **Profile pictures can be uploaded and removed.** `/dashboard/profile` was rendering an avatar
  it had no way to change — whatever the sign-in provider supplied was final. There is now a
  picker (and a drop target on the identity block) plus a Remove action behind the usual danger
  confirm. The image is downscaled and centre-cropped to a 256 px square in the browser
  (`resizeToSquare`) before upload, so a phone photo is stored as ~20 KB of WebP rather than
  several MB, and the circular avatar never letterboxes.

  The URL goes into Supabase `user_metadata.avatar_url` and the session is refreshed, **not**
  into `users.image_url` directly: that column is a mirror the API re-derives from the access
  token on every authenticated request (`refreshProfileIfStale`), so a value that never reaches
  the token is silently overwritten on the next call. Same reasoning as `updateName`. Both
  actions then re-read `/me`, because the page prefers the server's mirrored value over the
  session's.

  Requires a public `avatars` bucket in the Supabase project, with RLS on `storage.objects`
  scoping writes to `(storage.foldername(name))[1] = auth.uid()::text` — a per-user folder.
  Object keys carry a timestamp instead of a fixed name: with a stable key the `<img src>` would
  not change after a re-upload and the browser would keep serving the cached picture. The
  previous object is deleted best-effort.

### Changed
* **The assistant's local parser understands which entities you mean.** Every entity-level
  command (select, delete, recolour, change layer, lineweight) now goes through one target
  builder instead of five copies of "type word or nothing". It reads a colour adjective as a
  filter (`delete the red circles`, `change all red lines to blue` → filter red, destination
  blue), `on/in/of layer X` as a scope, `to layer X` as a destination only, and "selected /
  these / them" as the current selection. When nothing is named and something is selected, the
  selection is the target — matching how AutoCAD's own property commands behave — and an
  unqualified `delete` or `change layer` asks instead of erroring with "no entities match".
  `change the color of layer DIM to red` recolours what is on DIM instead of moving the whole
  drawing onto it (that branch used to win because it ran first and matched "change … layer").

  Answers to clarifying questions now work: a bare `red` after "What color?" or `5m right`
  after "How far?" is re-parsed together with the previous request, so the exchange completes
  instead of falling back to "I'm not sure how to handle: red". A bare colour word with no verb
  is no longer an order to repaint everything.

  Smaller fixes in the same pass: `0.25mm` and `0.5` lineweights parse as millimetres and snap
  to the nearest DXF weight (the old integer-only match read `0.25mm` as 0), `thick/thin/heavy`
  map to weights, `color 3` / `ACI 3` read an index, the last direction word wins (`move the
  right view to the left` goes left), and a layer named `0` no longer matches the "0" in `500`.
  The hosted-model system prompt carries the same targeting rules.

* **Monokai is the default dark theme**, replacing CAD Dark (`DEFAULT_THEME_ID.dark`, the client
  `DEFAULT_PREFERENCES.theme` fallback, and the onboarding wizard's dark preview tile, which
  would otherwise have previewed a theme the app no longer defaults to). `theme-color` and the
  PWA manifest colours follow Monokai's `#272822` so the browser chrome matches the first paint.

  A one-time localStorage migration moves existing users too. The active theme is persisted on
  every apply, so a returning user who never opened the picker still had `cad-dark` written to
  storage — which wins over the default and would have pinned them to it forever. The migration
  rewrites only keys still holding that exact id and drops a marker so it never runs twice, and
  so re-picking CAD Dark afterwards sticks. A stored value cannot distinguish "chose CAD Dark"
  from "was given CAD Dark", so someone who deliberately picked the old default is moved once.

  The server is deliberately untouched: `theme` is a free-form `@Length(1, 64)` string with no
  allowlist, and its `@default("dark")` is a ground-shaped placeholder that `findTheme` ignores —
  which is precisely the mechanism that lets the client default apply to a fresh account.

### Fixed
* **Sign-in and the dashboard felt slow on every visit, and much slower after a quiet spell.**
  Measured from India against the Korea Central deployment: a single API call cost 370–500 ms
  even when nothing was wrong, the first request after a few idle minutes waited around 22 s,
  and the dashboard needed five dependent waves of requests before it was usable. Four causes,
  each fixed separately.
  1. *Scale-to-zero.* Both Container Apps ran with `--min-replicas 0`, so the first request after
     idle paid for an image pull, `prisma migrate deploy` and the Nest boot — and that request
     was almost always the sign-in. Both apps now keep one warm replica (`provision.sh`, applied
     to the live apps on 2026-09-10; README *Cold starts* has the rollback).
  2. *A TLS handshake per API call.* The web container's nginx proxied `/api/` with a variable
     `proxy_pass`, which gives nginx no connection pool: every browser request opened a new TCP
     and TLS connection to the API ingress. The Azure nginx config now declares a keep-alive
     `upstream` (with background re-resolution of the ingress hostname) and sends an empty
     `Connection` header so those connections are reused.
  3. *Redundant database work on `GET /me`.* The auth guard had already read the user row, and
     the handler read it again by primary key; it also ran an `upsert` with an empty update on the
     preferences row — a write, with its row lock and WAL — on every dashboard visit. The guard
     now carries the loaded row on `req.user.record`, `getMe` reuses it, and preferences are read
     first and created only on an account's very first request. Separately, the API pings the
     database every `DB_KEEPALIVE_SECONDS` (default 240) so Neon never suspends its compute and
     the first query after idle does not wait out a cold start.
  4. *A JavaScript download between the guards and the page.* The dashboard shell and Recent
     page chunks were fetched only after `/me` had answered, adding a full round trip. The
     sign-in page now prefetches both while the user types, and the dashboard route is flagged
     for the existing signed-in preload strategy.

  What remains is geography: about 120 ms per round trip from India to Korea Central and about
  100 ms per query from there to the database in Singapore. README *Latency and region* records
  the measurements and the `centralindia` re-provisioning path.
* **Changing the language did not change the editor.** Picking another language in Settings
  updated `<html lang>` and the sign-in page, but the toolbar kept its English tool names and section
  labels, and an active command's prompt did not follow either. On a cold load in a non-English
  browser the editor was English for the whole session even though the right file had been fetched.
  Two causes: `ToolbarComponent` translated its sections once, in a field initialiser, and
  `CommandPromptService` re-resolved on an `effect()` that read `getActiveLang()` — a plain method,
  not a signal, so the effect never re-ran. Neither reacted to the translation file *arriving*
  either, and `translateOr` is synchronous, so whatever was rendered before `<lang>.json` landed
  stayed. `ToolCatalogService` now exposes `translationRevision`, a signal bumped on Transloco's
  `langChanges$` and every `translationLoadSuccess`; `getGrouped()` reads it, the toolbar's
  `sections` is a `computed()` over it, and the prompt service's effect tracks it. The toolbar also
  remembered the last-used sub-tool per group by object, which pinned the old language's label on
  the split buttons; it now remembers the id and looks the tool up in the current sections.
* **Assistant edits did not appear until the drawing was panned.** Recolouring, relayering or
  deleting through the assistant changed the entities but the canvas kept showing the old
  picture until the next pan or zoom forced a redraw. The AI tool hooks called `markDirty()`,
  which only sets the canvas flag; the cached content layer, spatial index and hatch regen are
  all keyed on the content epoch (`vm.version()`), which only `markContentDirty()` bumps — the
  same call every interactive tool and undo/redo already use. The hooks now bump the content
  epoch and the properties panel (`doc.bump()`), the action router bumps it once more after any
  applied action as a safety net, `query.selectEntities` bumps it so the selection highlight
  updates, and zoom-to-view uses `markViewDirty()` so the view epoch follows the pan.

* **Default-colour entities looked grey on HiDPI screens.** The three editor canvases were sized
  in CSS pixels with no device-pixel-ratio scaling, so on a Retina display the browser upscaled
  the bitmap and a 1 px white (or black) line blurred into a light-grey smear on every dark
  theme — the theme colour mapper was correct, the pixels were not. The backing stores are now
  sized in device pixels with the contexts pre-scaled, and the static-layer cache blits at CSS
  size, so lines render crisp in the mapped colour; drawing code keeps working in CSS pixels
  via `vm.canvasWidth`/`vm.canvasHeight`. Follows browser zoom and display moves.
* **Layout tabs never showed the model.** Three faults stacked up:
  * The sheet mapping flipped paper Y a second time (`w2s` already flips for the screen), so
    paper (0,0) landed at the *top* of the sheet, every viewport rectangle came out with a
    negative height and the viewport draw returned before painting an entity. Only the frames
    and any selection highlight (drawn with the main view at paper-mm coordinates) were
    visible — the "drawing under the sheet" effect. Paper mm are now plain world units, +Y up,
    as in DXF paper space; MVIEW, title blocks and hit-testing all share the corrected mapping.
  * Viewports imported from DXF were kept only as `VIEWPORT` entities that draw a bare border,
    and their presence suppressed the default viewport. They are now adopted into the layout's
    viewports on first activation (camera = view centre + view height, skipping the layout's own
    paper-space view `69=1` and switched-off `68<=0` records) and mirrored back on zoom/pan so the
    DXF writer, which also referenced fields the entity never had, round-trips them.
  * Entity colours were mapped against the editor theme, so the default white (ACI 7) stayed
    white on the white paper of a dark-themed editor. The paper-space renderer now paints with
    the colour mapper's surface forced to light — white/black defaults display as black on the
    sheet in every theme, explicit colours are untouched — the same swap AutoCAD does.
  Selection is now confined to the active space (model entities on the Model tab, paper
  entities on a layout), and switching between spaces clears the selection.
* **Tools did not work on layout tabs.** Every tool, osnap, grip and hit-test reads the view
  model's `w2s`/`s2w`, which knew nothing about viewports, so inside a viewport (MSPACE) clicks
  landed at paper coordinates and nothing could be picked, drawn or snapped. The view model now
  composes the active viewport's camera onto the paper zoom while in MSPACE: `scale`, `panX`,
  `panY`, `w2s` and `s2w` are the through-the-viewport view, and writes to them move the
  viewport camera instead of the sheet — so PAN, ZOOM, wheel zoom and every tool work through
  the viewport unchanged, and previews/grips are clipped to it. The paper sheet itself keeps
  using the base transform. Osnap only targets entities of the space being edited, and new
  entities are stamped `inPaperSpace` from the editing space (PSPACE → paper; Model tab and
  MSPACE → model) by the add/paste commands, so drawing a title block on the sheet stays on
  the sheet. Viewports are objects in PSPACE, as in AutoCAD: click the frame to select, drag
  to move, drag a grip to resize (scale preserved), Delete erases, Escape deselects; an
  adopted DXF viewport edits its `VIEWPORT` entity in place so export round-trips.
* **Dimension values were wrong by the drawing's plot scale.** Every DIMENSION in a scaled
  drawing carries a `DIMLFAC` override in XDATA (`1001 ACAD` / `1000 DSTYLE` / `1070 144`),
  and `dxf-parser` collapses XDATA to `{applicationName, customStrings}` — dropping the values.
  A span drawn 68.5333 units long was labelled `68.5333` where AutoCAD reads `10280`.
  `scanDimStyleOverrides` recovers them; `DimensionEntity.linearFactor` applies them.
  A single drawing routinely mixes factors, so this is per entity, not per style.
* **Dimensions showed four decimals.** `dxf-parser`'s DIMENSION handler has no `case 3`, so the
  style name never arrived and every dimension resolved to `Standard`. `DIMDEC` was not read
  either. Both fixed; `DEFAULT_DIM_STYLE` and the `Standard` map entry no longer disagree.
* **Rotated dimensions measured the diagonal** instead of the projection onto their axis
  (group 50 was never transferred to `DimensionEntity.rotation`).
* **Dimension text was re-placed rather than read.** AutoCAD stores the text midpoint in
  group 11 and flags it authoritative; recomputing it collapsed dense drawings into
  overlapping labels. Now honoured on import, on export, in hit-testing and in the inline editor.
* **`\X` in dimension text rendered literally.** It stacks the text: `<>\X(BERM)` is `3000`
  above the dimension line and `(BERM)` below.
* **Text control codes rendered literally** — `%%UHALF ELEVATION` instead of an underlined
  heading, `\pxqr;TO DAHODE JN.` instead of a label. New `text-control-codes.ts` decodes both
  the `%%` escapes and the MTEXT backslash language, flattening to the uniform style a
  `TextEntity` can represent while keeping the source string for round-trip.
* **All text rendered in one typeface.** `dxf-parser` exposes no STYLE table and no group 7, so
  no font was ever resolved. Worse, a resolved TrueType *file name* (`times.ttf`) was passed
  straight to `ctx.font`, which the canvas rejects outright — leaving text in whatever font was
  set last and caching those metrics. `FontResolverService` now maps file names to families.
* **Layer lineweight and linetype were dropped**, flattening every line to one thickness.
* **Entity types silently discarded**: `ACAD_TABLE` (rendered via its `*T` block, which is how
  the signature block reappears), `VIEWPORT`, and `ATTRIB` — whose `case` fell through into the
  VIEWPORT branch and so could never build anything.
* **DXF export discarded the above**, which matters because drawings persist as DXF: no STYLE or
  DIMSTYLE table was written, group 11 was the bare midpoint of the measured points, and text
  carried no style name. Round-trip is now lossless.
* Copy/paste dropped dimension styles — `collectDimStyles` read `dimStyleName`, a field that
  never existed.
* **Centred and right-justified MTEXT sat half a box-width too far right.** The entity position
  is the *attachment point* — the middle of the reference box for a centred justify — but the
  wrapped-text path in `TextLayoutEngine` treated it as the box's left edge. Every title-block
  cell overlapped its neighbour and the signature-table caption hung off the table's right edge.
* **Justified TEXT was anchored at group 10.** For centred/right/middle text the anchor is
  group 11; group 10 is merely where the first character lands. Aligned (3) and Fit (5) text now
  anchors at the midpoint of the two points and takes its rotation from them.
* **Top-level ATTDEFs were dropped.** Outside a block AutoCAD draws an ATTDEF as its *tag* —
  the "A1"/"A2" section markers were exactly this.
* **BYBLOCK geometry inside an insert rendered white.** `InsertEntity` passed `this.color`
  (only set for true-colour inserts) as the BYBLOCK colour; it now passes the resolved colour,
  so a green table is green.
* **Clockwise hatch edges filled the wrong side.** AutoCAD stores a clockwise edge's angles
  mirrored; taken at face value a 63° sliver on the north-arrow swept the other 297° and drew the
  whole symbol as a solid blob. Ellipse edges also store *true* angles, not the parametric ones
  the ellipse equation needs — both are now converted in `dxfEdgeLoopToFrozen`.
* **Polyline widths and bulges were discarded.** A tapered 0 → w → 0 pair of segments is how
  AutoCAD draws a filled arrowhead, and group 42 is what makes a polyline curve; neither made it
  through import. `PolylineEntity` now carries `widths` and renders them as filled bands, and the
  exporter writes 40/41/42 back out.
* **Pre-R2007 DXF was read as UTF-8**, turning every `°` and `±` into U+FFFD. `decodeDxfBytes`
  tries strict UTF-8 first and falls back to the `$DWGCODEPAGE` code page. `\U+XXXX` escapes and
  `^I` caret-tabs in MTEXT are decoded too.
* Font map: `romans.shx` (Roman *Simplex*) is a stroke sans, not a serif; AutoCAD's `romantic.ttf`
  is a roman serif, not a script face.
* **Hatch patterns the registry did not know rendered as nothing** — `GRAVEL` was literally
  `lines: []`, and `HOUND`/`ANSI36` fell back to ANSI31. Every non-solid HATCH carries its own
  pattern definition (groups 78/53/43–46/79/49); the import now feeds it to the existing
  `customPatternLines` path, so any pattern renders from the file rather than from a lookup table.
  AutoCAD stores those lines already scaled and rotated, and the renderer re-applies scale/angle, so
  they are normalised on the way in.
* **Dashed linetypes rendered as dots.** `DocumentService` exposes no `lineTypes`, so the renderer
  never saw the file's LTYPE table (metric `DASHED` = 12.7/−6.35) and fell back to the tiny imperial
  built-in; `$LTSCALE` (0.2 here) was never read at all. Both are now taken from the file, and the
  exporter writes the real LTYPE table and `$LTSCALE` back out.
* **Leader lines took the entity colour instead of `DIMCLRD`.** Two leaders carry an explicit blue
  entity colour that AutoCAD draws red, because the style says BYLAYER (256). DIMCLRD/DIMCLRE/DIMCLRT
  are now scanned (176/177/178), DSTYLE overrides are read on LEADERs too, and a non-BYBLOCK DIMCLRD
  wins.
* Arrowheads were drawn at a 2:1 aspect; AutoCAD's closed-filled arrow is DIMASZ long by DIMASZ/3
  wide (3:1).
* **Signature stamps were missing.** OLE2FRAME payloads are OLE compound blobs, but the pictures
  drawings actually embed carry a plain DIB behind a `BM` header; `DxfOle2FrameHandler` locates and
  validates it and the import places it as an `ImageEntity`. The original record stays in the raw
  list so a save re-emits it verbatim and the next open re-derives the picture.
* MTEXT `\Q<deg>;` (obliquing — the italic look of SHX signature text), `\W<f>;` (width factor) and
  `\pxqc;`-style paragraph alignment are honoured; the canvas shear also had the wrong sign for a
  y-down context and back-slanted every oblique text.
* **Curved hatch edges came apart on any transform.** The frozen-hatch move/rotate/scale/mirror
  helpers moved each edge's endpoints but not its centre, radii or angles. Since the import centres
  every drawing, each ARC/ELLIPSE_ARC edge ended up with endpoints in world space and a centre still
  in file space — the loop swept across the sheet and its bbox grew to sheet size. One shared
  `_transformFrozenEdge` now carries the full curve geometry through all four transforms.
* **Stray geometry appeared off the sheet after import.** Three separate causes, none of them in
  the drawing itself:
  * *The extrusion normal was ignored.* Planar entities (INSERT, CIRCLE, ARC, polylines, TEXT,
    SOLID) store their points in their own plane; AutoCAD's MIRROR leaves a mirrored entity on the
    plane `(0, 0, -1)` with its coordinates still in that frame, so an insert stored at x = −404 sits
    at x = +404. Read as WCS, four `GL MARK` inserts (the ground-level hatching under the GL
    triangles) landed 400–700 units left of the sheets. New `ocs.ts` implements the DXF Arbitrary
    Axis Algorithm; the importer maps positions through it and, for the mirrored plane, negates the
    X scale, rotation, arc/ellipse sweep and polyline bulges. ELLIPSE and TEXT normals are read from
    the raw tags because `dxf-parser` drops them.
  * *SOLIDs moved twice.* The SOLID branch built its boundary edges from shared point objects (an
    edge's end was the next edge's start), so the import's centring shift moved every corner twice
    and each SOLID arrowhead ended up a sheet-width away. Edges now own their points, the translate
    helper de-duplicates shared points defensively, and SOLIDs get a frozen `boundarySpec` — without
    one, rotate/scale/mirror were silent no-ops on them. Their corners are also walked in AutoCAD's
    bow-tie order (1→2→4→3) instead of as a self-intersecting quadrilateral.
  * *Group 60 (invisible) was overwritten with `visible = true`.* Now honoured.
  Paper-space entities are also excluded from the extents that drive the centring shift.

### Known divergence from AutoCAD Web
* This file's embedded hatch pattern lines are internally inconsistent: ANGLE/ANSI32/ANSI36 store
  final-scale values as the DXF reference specifies, while GRAVEL and ANSI31 store values 10–100×
  smaller than `pattern × scale`. CADO renders what the file says (GRAVEL at its stated 27-unit
  spacing is nearly empty in a 3-unit band); AutoCAD Web shows those same bands densely filled, so it
  is evidently regenerating predefined patterns rather than drawing the stored lines. No single rule
  reproduces both viewers from this data.

### Notes on design
* **Group codes are context-sensitive; read them per entity type.** Group 41 is a width factor
  on TEXT but the reference-rectangle *width* on MTEXT — reading it blindly stretched a column
  of notes to 166× its size. Likewise group 70 on a DIMSTYLE table entry is the entry's flags,
  not `DIMTOL`.
* **Flattened, not run-styled.** `TextLayoutEngine` measures one font and one height per entity,
  so MTEXT decodes to plain text plus a single style. A `\H` or `\f` code is honoured only when
  it opens the string; mid-string it scopes to a run this cannot express, so it is dropped
  rather than applied to text it never covered.
* **`DIMLFAC` scales the measurement, `DIMSCALE` only the visuals**, and both need a per-entity
  override: a style may set `DIMSCALE 150` while every entity referencing it overrides to 1.
* **Unknown escapes stay literal.** Dropping every `\<letter>` would quietly eat the `D` from
  `C:\Drawings`, so only AutoCAD's actual code letters are consumed.
* Verified against the file itself: AutoCAD bakes each dimension's rendered geometry and final
  text into an anonymous `*D<n>` block, so parity is checkable rather than eyeballed —
  **384/384 dimensions now match**, and still match after an export/re-import cycle.

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
