# CADO LinkedIn carousel

Eight square slides (1080 × 1080) that onboard new users and promote the product.
Design canvas: https://claude.ai/code/artifact/b8b65ea5-4796-4666-896a-4f67a5eedc4d

## Visual system

Uses the app's Monokai theme, the default dark theme (`src/theme.scss`, `theme-registry.ts`). Use Monokai for all CADO marketing material.

| Token | Value |
| --- | --- |
| Background | `#272822` |
| Surface (cards) | `#414339` |
| Border | `#49483e` |
| Text | `#cfcfc2` |
| Text, strong | `#f8f8f2` |
| Text, dim | `#9d9b8a` |
| Accent | `#a6e22e` |
| Text on accent | `#1e1f1c` |
| Review / warning | `#e6db74` |
| Accent tint | `rgba(166, 226, 46, .15)` |
| Headline type | Inter 700, letter-spacing −.028em |
| Command text | JetBrains Mono |
| Backdrop | Drafting grid, 140 px major / 28 px minor lines, faded at the edges |

Every slide carries the four-tile CADO mark and "CADO" bottom-left, eight
progress dots bottom-centre, and `cado.website` bottom-right. Safe margin is
72 px on all sides.

## Post caption

> Most of the world's working drawings are still 2D, and the tool for them still
> needs an installer and a $500–2,300 seat.
>
> CADO is a full 2D drafting editor that opens in a browser tab. Same commands,
> same DXF files, whole UI in 14 languages, free to start.
>
> Swipe for what to know before your first drawing → cado.website
>
> #CAD #2D #AutoCAD #DXF #architecture #engineering #construction

## Slides

### 1 · Cover

- **Eyebrow:** Browser-native 2D CAD
- **Headline:** The drafting tool you already know, in the tab you already have open.
- **Lede:** Seven things to know before your first drawing. Swipe.
- **Visual:** Logo and wordmark top-left; "Swipe →" in accent bottom-right.

### 2 · Nothing to install

- **Eyebrow:** 01 · Nothing to install
- **Headline:** Open a link. Start drawing.
- **Lede:** No installer, no licence server, no IT ticket. It works the same on Windows, macOS, Linux and a Chromebook.
- **Visual:** Browser-tab mockup with the address `cado.website/app/drawings/ground-floor-plan.dxf`, a simple floor-plan sketch with one accent dimension (12 400), and the command line reading `Command: _line Specify first point:`.

### 3 · Your files, unchanged

- **Eyebrow:** 02 · Your files, unchanged
- **Headline:** Open a DXF exactly as AutoCAD drew it.
- **Lede:** Layers, blocks, dimensions, hatches and paper layouts come through intact, validated against AutoCAD's own output. Edit, then write the DXF back out.
- **Cards:**
  - Import and export — **R12 → 2018** — Every AutoCAD DXF version, both directions.
  - On every plan — **Free included** — DXF in and out is never paywalled.
- **Note (accent-tinted):** Have a DWG? Save it as DXF from your desktop CAD first. DWG files can be stored and downloaded; opening them is on the roadmap.

### 4 · Zero retraining

- **Eyebrow:** 03 · Zero retraining
- **Headline:** Type what you already type.
- **Lede:** 70+ drafting commands with the same short aliases and the same prompts. Your hands already know this.
- **Command transcript (mono):**

  ```
  Command: L
  LINE Specify first point: 0,0
  Specify next point or [Undo]: @12400,0
  Command: O
  OFFSET Specify offset distance: 230
  Command: TR
  TRIM Select objects to trim: ▮
  ```

- **Alias chips:** L · PL · C · A · REC · H · M · CO · RO · MI · TR · F · O · AR · DIM · B · I · MA · +50 more

### 5 · In your language

- **Eyebrow:** 04 · In your language
- **Headline:** The whole editor in 14 languages. Prompts included.
- **Lede:** The same 14 languages AutoCAD ships in. Switch once; menus, dialogs and the command line follow.
- **Prompt table:**

  | | |
  | --- | --- |
  | EN | Specify first point: |
  | DE | Ersten Punkt angeben: |
  | ES | Precise primer punto: |
  | JA | 1点目を指定: |
  | PT | Especifique o primeiro ponto: |

- **Footer line:** Also čeština · français · italiano · magyar · polski · русский · 한국어 · 简体中文 · 繁體中文
- **Check before posting:** confirm the four translated prompts against `public/i18n/*.json`.

### 6 · From model to sheet

- **Eyebrow:** 05 · From model to sheet
- **Headline:** Lay it out on paper. Plot to PDF.
- **Lede:** Paper-space layouts with viewports, title blocks as blocks with attributes, 26 standard sheet sizes, and print-ready PDF or SVG out.
- **Visual:** White A3 sheet with a border, an accent viewport, the floor-plan sketch, and a title block reading Ground floor plan · 1 : 100 · A3 · 01.
- **Side cards:** **26** paper sizes, ISO and ANSI · **PDF · SVG** plot output, vector, to scale.

### 7 · AI drafting assistant

- **Eyebrow:** 06 · AI drafting assistant
- **Headline:** Say what you mean. Review what it will do. Undo if you change your mind.
- **Visual:** Assistant panel, header "AI Agent · your key · Claude or OpenRouter".
  - User message: *change all red lines on layer DIM to blue*
  - Plan · 3 steps · **review** — 128 entities affected
    - Select entities — `colour = red, layer = DIM`
    - Change colour — `to blue`
    - Commit — `undoable with Ctrl+Z`
  - Buttons: **Apply** (accent) · Cancel

### 8 · Start free

- **Eyebrow:** 07 · Start free
- **Headline:** Your first drawing is five minutes away.
- **Lede:** The full drafting toolset and DXF export are free. Upgrade only when the work asks for it.
- **Plan cards:**
  - Free — **$0** — 3 cloud drawings · 50 MB
  - Pro — **$10/mo** — Unlimited · 25 GB · history
  - Team — **$24/user** — Shared folders · 250 GB
- **Call to action:** **Start drawing free** · `cado.website`
- **Closing line:** Save the post. Share it with the person on your team who is still waiting for a licence.

## Export

From the canvas toolbar, export each artboard as PNG (1080 × 1080) and upload
the eight images to LinkedIn in order, or export the whole canvas as one PDF
for a document post.
