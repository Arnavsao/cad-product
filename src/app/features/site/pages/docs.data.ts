/**
 * Reference data for the documentation page that is not already in
 * `site-content.ts`.
 *
 * Everything here was read from the code, not remembered: the shortcuts are the
 * `window:keydown` handler in `cad-editor.ts` and `command-line.component.ts`,
 * the paper sizes are `plot-registry.model.ts`, the scales `SCALE_REGISTRY`, the
 * AI models `ai-model.ts`, the conflict answers `drawing-persistence.service.ts`,
 * the languages `README.md`. When the editor changes, change this file with it.
 */

/* ── Page outline ──────────────────────────────────────────────── */

export interface DocSection {
  id: string;
  label: string;
}

/** Section ids are linked from the site footer; do not rename them. */
export const DOC_SECTIONS: readonly DocSection[] = [
  { id: 'getting-started', label: 'Getting started' },
  { id: 'commands', label: 'Command reference' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'snapping', label: 'Snapping and input' },
  { id: 'layers-blocks', label: 'Layers and blocks' },
  { id: 'layouts', label: 'Layouts and plotting' },
  { id: 'dxf', label: 'DXF compatibility' },
  { id: 'ai', label: 'AI assistant' },
  { id: 'cloud', label: 'Accounts and cloud' },
  { id: 'languages', label: 'Languages' },
  { id: 'embedding', label: 'Embedding the editor' },
  { id: 'faq-support', label: 'FAQ and support' },
];

/* ── Getting started ───────────────────────────────────────────── */

export interface StartStep {
  title: string;
  body: string;
  /** Keys or commands mentioned in the step, rendered as chips. */
  keys: readonly string[];
}

export const START_STEPS: readonly StartStep[] = [
  {
    title: 'Create an account',
    body: 'Sign up with an email address. The Free plan includes the whole toolset and DXF export; you only need a paid plan for more cloud drawings and for organizations.',
    keys: [],
  },
  {
    title: 'Open a DXF, or start blank',
    body: 'Drag a .dxf onto the dashboard to upload it into your account, or press Ctrl+O in the editor to open one from My Drawings or your disk. Parsing runs in a Web Worker, so a large survey does not freeze the tab. A blank drawing is one click from Recent.',
    keys: ['Ctrl+O', 'NEW'],
  },
  {
    title: 'Draw with the commands you know',
    body: 'Type an alias at the command line and answer the prompts: absolute coordinates as 100,50, relative as @100,50, polar as @3400<90. Every point can snap to geometry, and Enter or Space repeats the last command.',
    keys: ['L', 'C', 'REC', 'TR', 'F'],
  },
  {
    title: 'Save a version',
    body: 'Ctrl+S saves to your account and keeps a version you can restore from the dashboard. Independently of that, a recovery snapshot is written to the browser every 30 seconds in case the tab dies.',
    keys: ['Ctrl+S', 'Ctrl+Shift+S'],
  },
  {
    title: 'Plot or export',
    body: 'Ctrl+P opens Plot for PDF, SVG, PNG or JPG of a window, the extents, the display or a layout. DXFOUT writes the drawing back out as DXF with its own layers, blocks, linetypes and dimension styles.',
    keys: ['Ctrl+P', 'PUBLISH', 'DXFOUT'],
  },
];

/* ── Keyboard shortcuts ────────────────────────────────────────── */

export interface Shortcut {
  keys: readonly string[];
  what: string;
}

export interface ShortcutGroup {
  id: string;
  label: string;
  note?: string;
  items: readonly Shortcut[];
}

/**
 * Source: the single `window:keydown` handler in `cad-editor.ts` and
 * `CommandLineComponent.onKey`. `Ctrl` is also `⌘` on macOS (the handler
 * accepts `metaKey`).
 */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: 'files',
    label: 'Files and output',
    items: [
      { keys: ['Ctrl+S'], what: 'Save. On a never-saved drawing this becomes Save As.' },
      { keys: ['Ctrl+Shift+S'], what: 'Save As: a new name, folder or workspace.' },
      { keys: ['Ctrl+O'], what: 'Open: My Drawings, a folder or a local DXF.' },
      { keys: ['Ctrl+P'], what: 'Plot dialog.' },
      { keys: ['Ctrl+Shift+P'], what: 'Quick plot with the last settings; opens the dialog if there are none yet.' },
      { keys: ['Ctrl+E'], what: 'Export dialog (the same dialog as Plot, ready for a file).' },
      { keys: ['Ctrl+Tab', 'Ctrl+Shift+Tab'], what: 'Next / previous open drawing.' },
      { keys: ['Ctrl+W'], what: 'Close the active drawing; asks to save first.' },
      { keys: ['Ctrl+Shift+T'], what: 'Reopen the last closed drawing.' },
    ],
  },
  {
    id: 'editing',
    label: 'Editing',
    note: 'Undo, redo, select all and the clipboard work wherever focus is, except inside the in-canvas text or table editor, which keep their own history.',
    items: [
      { keys: ['Ctrl+Z'], what: 'Undo. One step per command, including anything the assistant did.' },
      { keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], what: 'Redo.' },
      { keys: ['Ctrl+A'], what: 'Select all.' },
      { keys: ['Ctrl+C', 'Ctrl+X', 'Ctrl+V'], what: 'Copy, cut and paste.' },
      { keys: ['Ctrl+Shift+V'], what: 'Paste to original coordinates (PASTEORIG).' },
      { keys: ['Ctrl+Alt+V'], what: 'Paste as a block (PASTEBLOCK).' },
      { keys: ['Delete', 'Backspace'], what: 'Erase the selection. Inside Polyline or Leader, Backspace removes the last vertex instead.' },
      { keys: ['Esc'], what: 'Cancel the running command and return to Select. In the block editor, asks whether to save the block.' },
      { keys: ['Enter', 'Space'], what: 'With nothing running: repeat the last drawing or modify command.' },
      { keys: ['Shift'], what: 'Held: temporary ortho override. In Trim and Extend it swaps to the other tool instead.' },
    ],
  },
  {
    id: 'aids',
    label: 'Drafting aids',
    note: 'The same function keys as AutoCAD. Each one also has a button in the status bar.',
    items: [
      { keys: ['F3'], what: 'Object snap on / off.' },
      { keys: ['F7'], what: 'Grid.' },
      { keys: ['F8'], what: 'Ortho. Turning it on turns polar off.' },
      { keys: ['F10'], what: 'Polar tracking. Turning it on turns ortho off.' },
      { keys: ['F11'], what: 'Object snap tracking.' },
      { keys: ['F12'], what: 'Dynamic input next to the cursor.' },
    ],
  },
  {
    id: 'cmdline',
    label: 'Command line',
    note: 'Start typing anywhere and the text lands in the command line; you never have to click it first.',
    items: [
      { keys: ['A–Z'], what: 'Type a command alias. While a command runs, a letter picks the option with that key, as in [Close/Undo].' },
      { keys: ['Space'], what: 'Same as Enter, as in AutoCAD.' },
      { keys: ['↑', '↓'], what: 'Move through the matching commands.' },
      { keys: ['Tab'], what: 'Accept the greyed completion.' },
      { keys: ['Esc'], what: 'Clear the line and cancel.' },
    ],
  },
];

/* ── Snapping and input ────────────────────────────────────────── */

export interface Aid {
  name: string;
  key: string;
  body: string;
}

/** Source: `snapping.service.ts`, `dynamic-input.service.ts`. */
export const DRAFTING_AIDS: readonly Aid[] = [
  {
    name: 'Ortho',
    key: 'F8',
    body: 'Constrains the next point to horizontal or vertical from the previous one. Hold Shift to flip it temporarily. Ortho and polar are exclusive; enabling one disables the other.',
  },
  {
    name: 'Polar tracking',
    key: 'F10',
    body: 'Snaps the cursor to angle increments from the previous point, 15° by default, and labels the locked angle on the guide.',
  },
  {
    name: 'Object snap tracking',
    key: 'F11',
    body: 'Acquires points you hover over and projects alignment guides from them, so you can place a point in line with geometry you are not touching.',
  },
  {
    name: 'Dynamic input',
    key: 'F12',
    body: 'Fields next to the cursor show the length, angle or coordinates the tool is about to use. Type a number and it goes into the field; type a letter to pick a command option without moving to the command line.',
  },
];

/* ── Layers ────────────────────────────────────────────────────── */

export interface LayerState {
  name: string;
  body: string;
}

/** Source: the four toggles in `layers-panel.component.ts` and `Layer` in `layer.model.ts`. */
export const LAYER_STATES: readonly LayerState[] = [
  { name: 'On / Off', body: 'Layers that are off are not drawn, cannot be picked and are left out of zoom-to-extents.' },
  { name: 'Freeze / Thaw', body: 'Frozen layers are skipped by the renderer and by extents as well; use it for reference geometry you never want to see.' },
  { name: 'Lock / Unlock', body: 'Locked layers stay visible but their entities are protected from editing.' },
  { name: 'Plot / No plot', body: 'A no-plot layer shows on screen and is left out of PDF, SVG and image output. Defpoints is no-plot by default.' },
];

/* ── Layouts and plotting ──────────────────────────────────────── */

export interface PaperFamily {
  label: string;
  sizes: readonly string[];
}

/** Source: `PAPER_REGISTRY` in `plot-registry.model.ts`, grouped by category. */
export const PAPER_FAMILIES: readonly PaperFamily[] = [
  { label: 'ISO', sizes: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'] },
  { label: 'ANSI', sizes: ['ANSI A', 'ANSI B', 'ANSI C', 'ANSI D', 'ANSI E'] },
  { label: 'Architectural', sizes: ['ARCH A', 'ARCH B', 'ARCH C', 'ARCH D', 'ARCH E', 'ARCH E1'] },
  { label: 'Engineering', sizes: ['B', 'C', 'D', 'E'] },
  { label: 'Office', sizes: ['Letter', 'Legal', 'Tabloid', 'Ledger'] },
  { label: 'Custom', sizes: ['Any width and height in mm or inches'] },
];

/** Source: `SCALE_REGISTRY`. */
export const PLOT_SCALES = {
  metric: ['1:1', '1:2', '1:5', '1:10', '1:20', '1:25', '1:50', '1:75', '1:100', '1:125', '1:150', '1:200', '1:250', '1:500', '1:1000'],
  imperial: ['1/8" = 1\'', '1/4" = 1\'', '3/8" = 1\'', '1/2" = 1\'', '3/4" = 1\'', '1" = 1\''],
} as const;

export interface PlotOutput {
  format: string;
  body: string;
}

/** Source: `FORMAT_META` and the presets in `plot-options.model.ts`. */
export const PLOT_OUTPUTS: readonly PlotOutput[] = [
  { format: 'PDF', body: 'Vector, with lineweights, searchable text and embedded fonts. Publish writes every layout to one PDF.' },
  { format: 'SVG', body: 'Vector export of the plotted area.' },
  { format: 'PNG / JPG', body: 'Raster at 72 to 1200 DPI, or by long edge at 2K, 4K or 8K.' },
  { format: 'DXF', body: 'The drawing itself, written back out. See DXF compatibility.' },
];

export interface PlotStyleRow {
  name: string;
  body: string;
}

/** Source: `PlotStyle` in `plot-options.model.ts`. */
export const PLOT_STYLES: readonly PlotStyleRow[] = [
  { name: 'Color', body: 'Entity and layer colours plot as stored.' },
  { name: 'Monochrome', body: 'Everything plots black, the way a CTB monochrome table does.' },
  { name: 'Grayscale', body: 'Colours are mapped to greys by luminance.' },
];

/* ── DXF compatibility ─────────────────────────────────────────── */

export interface DxfRow {
  area: string;
  body: string;
}

/**
 * Source: the Unreleased section of CHANGELOG.md, `dxf-import.service.ts`,
 * `dxf-scanner.ts` and `export.service.ts`. Only what is implemented is listed.
 */
export const DXF_ROUNDTRIP: readonly DxfRow[] = [
  { area: 'Layers', body: 'Name, colour, on/off, frozen, locked, linetype and lineweight. The drawing’s own LTYPE table and $LTSCALE are read and written, so dashes come back at the same length.' },
  { area: 'Blocks and attributes', body: 'Block definitions, inserts with scale and rotation, ATTDEF and ATTRIB. BYBLOCK colours resolve through the insert. Anonymous *D and *T blocks are kept.' },
  { area: 'Text and MText', body: 'STYLE table with per-style fonts, %% escapes, MText formatting codes (\\P, \\pxq, \\Q, \\W, \\U+XXXX), justification anchored at group 11, oblique and width factor. Pre-R2007 files are decoded with their $DWGCODEPAGE.' },
  { area: 'Dimensions', body: 'DIMSTYLE table, per-entity DIMLFAC and DIMSCALE overrides read from XDATA, DIMDEC, DIMCLRD/E/T, rotated dimensions, the stored text midpoint, \\X stacked text. Verified against the *D blocks AutoCAD writes.' },
  { area: 'Hatch', body: 'Solid and pattern hatches with their embedded pattern definitions, so a pattern the registry has never heard of still renders from the file. Clockwise and elliptical edges are handled.' },
  { area: 'Polylines', body: 'Vertices, bulges, constant and tapered widths (which is how AutoCAD draws a filled arrowhead).' },
  { area: 'Tables, viewports, pictures', body: 'ACAD_TABLE renders from its block. Paper-space VIEWPORTs become the layout’s viewports and write back. OLE2FRAME signature stamps are shown and re-emitted verbatim.' },
  { area: 'Geometry in other planes', body: 'The extrusion normal (OCS) is honoured, so entities AutoCAD mirrored onto the (0,0,−1) plane land where they belong.' },
  { area: 'Everything else', body: 'Entity types the editor has no model for are kept as raw records and written back unchanged, so a save does not strip what it did not understand.' },
];

export const DXF_LIMITS: readonly DxfRow[] = [
  { area: 'DWG', body: 'A .dwg can be uploaded to the dashboard, versioned and downloaded, but the editor cannot open it yet. Conversion is planned; today you need a DXF to draw.' },
  { area: 'Export version', body: 'Export always writes AC1032 (AutoCAD 2018) ASCII DXF. There is no option for an older version or for binary DXF.' },
  { area: 'MText formatting', body: 'One font and one height per entity. A \\H or \\f code is honoured when it opens the string; a change mid-paragraph is dropped rather than applied to text it never covered.' },
  { area: '3D', body: 'CADO is a 2D drafter. Z coordinates are read but nothing is modelled or displayed in 3D.' },
  { area: 'Inconsistent hatch files', body: 'Where a file stores pattern lines at a different scale from what its own header implies, CADO draws what the file says; AutoCAD Web appears to regenerate the pattern instead, so the two can differ.' },
];

/* ── AI assistant ──────────────────────────────────────────────── */

export interface AiBackend {
  name: string;
  where: string;
  body: string;
}

/** Source: `ai-model.ts`, `ai-model.service.ts`, `llm-gateway.service.ts`. */
export const AI_BACKENDS: readonly AiBackend[] = [
  {
    name: 'Built-in parser',
    where: 'Runs in the tab',
    body: 'The default. A rule-based parser that understands colours, layers, lineweights, directions and the current selection. Nothing leaves the browser and no setup is needed.',
  },
  {
    name: 'Ollama',
    where: 'Your machine or network',
    body: 'Point the panel at a server URL (default http://localhost:11434) and pick a pulled model. Set OLLAMA_ORIGINS so the browser may call it; an https:// deployment cannot reach an http:// server.',
  },
  {
    name: 'OpenRouter',
    where: 'Third-party API',
    body: 'Paste an API key in the panel’s settings. The key is kept in this browser’s localStorage and sent straight to OpenRouter from the browser; a consent notice explains what is shared before the first request.',
  },
];

export interface AiCapability {
  group: string;
  items: readonly string[];
}

/** Source: the tool files in `ai-agent/tools/`. */
export const AI_CAPABILITIES: readonly AiCapability[] = [
  { group: 'Select', items: ['Entities by colour, layer, type or the current selection'] },
  { group: 'Edit entities', items: ['Change colour', 'Change layer', 'Change lineweight', 'Move', 'Delete', 'Replace with a library symbol'] },
  { group: 'Layers', items: ['Isolate', 'Lock and unlock', 'Show and hide', 'Rename'] },
  { group: 'Annotate and insert', items: ['Add a dimension to a selected edge', 'Insert a symbol from the library', 'Generate a sheet from a library template'] },
  { group: 'Sheets and views', items: ['Arrange plan, section and detail views', 'Move a view', 'Zoom to a layer, a selection or extents'] },
];

export interface RiskRow {
  cls: string;
  tone: 'success' | 'warning' | 'danger';
  body: string;
}

/** Source: `riskClass` in the tools and `ActionRouterService.validate`. */
export const AI_RISK: readonly RiskRow[] = [
  { cls: 'safe', tone: 'success', body: 'Reads and navigation: selecting, zooming, describing. Applied at once.' },
  { cls: 'review', tone: 'warning', body: 'Reversible edits such as recolouring or relayering. Shown with the affected count before they run.' },
  { cls: 'destructive', tone: 'danger', body: 'Deleting or replacing geometry. Always asks for confirmation first.' },
];

/** Prompts the built-in parser handles; each is covered by a changelog entry. */
export const AI_EXAMPLES: readonly string[] = [
  'delete the red circles',
  'change all red lines to blue',
  'change the color of layer DIM to red',
  'isolate layer WALLS',
  'set the selected lines to 0.5mm',
  'move the right view to the left',
];

/* ── Accounts and cloud ────────────────────────────────────────── */

export interface ConflictAnswer {
  label: string;
  body: string;
}

/** Source: the conflict dialog in `drawing-persistence.service.ts`. */
export const CONFLICT_ANSWERS: readonly ConflictAnswer[] = [
  { label: 'Save as copy', body: 'Keeps both. Your work becomes a new drawing in the same folder and workspace.' },
  { label: 'Reload latest', body: 'Drops your unsaved changes and opens the version the server has.' },
  { label: 'Overwrite', body: 'Saves over the other version. It is still in the version history.' },
];

export interface RoleRow {
  role: string;
  body: string;
}

/** Source: `OrgRole` in `api.models.ts`. */
export const ORG_ROLES: readonly RoleRow[] = [
  { role: 'Viewer', body: 'Opens and downloads the organization’s drawings. Cannot save, rename or trash.' },
  { role: 'Member', body: 'Everything a viewer can, plus create, save, rename and trash drawings and folders.' },
  { role: 'Admin', body: 'Everything a member can, plus invite people and assign viewer, member or admin.' },
  { role: 'Owner', body: 'Everything an admin can, plus transfer ownership. One per organization.' },
];

/* ── Languages ─────────────────────────────────────────────────── */

/** Source: the Languages section of README.md; the same set AutoCAD ships. */
export const LANGUAGES: readonly string[] = [
  'English', 'Čeština', 'Deutsch', 'Español', 'Français', 'Magyar', 'Italiano',
  '日本語', '한국어', 'Polski', 'Português (Brasil)', 'Русский', '简体中文', '繁體中文',
];

/* ── Embedding ─────────────────────────────────────────────────── */

/** Source: docs/INTEGRATION.md, checked against `cad-editor.ts` and `drawing-transfer.service.ts`. */
export const EMBED_SNIPPETS = {
  api: `readonly id         = input<string>();           // open this stored drawing on init
readonly initialDxf = input<string>();           // ...or hand it DXF text / a JSON entity payload
readonly exitUrl    = input<string | null>('/dashboard'); // null keeps browser-history Back
readonly save       = output<string>();          // the DXF, emitted from Plot > Export
readonly close      = output<void>();            // the user pressed Back`,
  template: `<app-cad-editor
  [initialDxf]="dxf"
  [exitUrl]="null"
  (save)="onSave($event)"
  (close)="onClose()"
></app-cad-editor>`,
  token: `{ provide: AUTH_TOKEN_PROVIDER, useExisting: MySessionService } // implements AuthTokenProvider`,
  transfer: `inject(DrawingTransferService).set(dxfText, 'Bridge_GAD.dxf', drawingId, projectId);
router.navigateByUrl('/editor');
// The editor calls consume() on start-up; call clear() once you have persisted the result.`,
} as const;
