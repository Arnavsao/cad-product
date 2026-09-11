/**
 * Reference data for the documentation page that is not already in
 * `site-content.ts`.
 *
 * Everything here was read from the code, not remembered: the shortcuts are the
 * `window:keydown` handler in `cad-editor.ts` and `command-line.component.ts`,
 * the paper sizes are `plot-registry.model.ts`, the scales `SCALE_REGISTRY`, the
 * AI models `ai-model.ts`, the conflict answers `drawing-persistence.service.ts`,
 * the languages `README.md`. When the editor changes, change this file with it.
 *
 * Every prose field holds a translation KEY (`…Key`), resolved with
 * `t(item.bodyKey)` in the template. The English text lives in
 * `scripts/i18n/app-strings/site-pages.en.json` under `site.docs.*`. Keyboard
 * shortcuts, command names, paper sizes, scales, file formats, endonyms, code
 * snippets and the example prompts the (English-only) built-in parser accepts
 * stay literal.
 */

/* ── Page outline ──────────────────────────────────────────────── */

export interface DocSection {
  id: string;
  labelKey: string;
}

/** Section ids are linked from the site footer; do not rename them. */
export const DOC_SECTIONS: readonly DocSection[] = [
  { id: 'getting-started', labelKey: 'site.docs.section.gettingStarted' },
  { id: 'commands', labelKey: 'site.docs.section.commands' },
  { id: 'shortcuts', labelKey: 'site.docs.section.shortcuts' },
  { id: 'snapping', labelKey: 'site.docs.section.snapping' },
  { id: 'layers-blocks', labelKey: 'site.docs.section.layersBlocks' },
  { id: 'layouts', labelKey: 'site.docs.section.layouts' },
  { id: 'dxf', labelKey: 'site.docs.section.dxf' },
  { id: 'ai', labelKey: 'site.docs.section.ai' },
  { id: 'cloud', labelKey: 'site.docs.section.cloud' },
  { id: 'languages', labelKey: 'site.docs.section.languages' },
  { id: 'embedding', labelKey: 'site.docs.section.embedding' },
  { id: 'faq-support', labelKey: 'site.docs.section.faqSupport' },
];

/* ── Getting started ───────────────────────────────────────────── */

export interface StartStep {
  id: string;
  titleKey: string;
  bodyKey: string;
  /** Keys or commands mentioned in the step, rendered as chips. Literal. */
  keys: readonly string[];
}

export const START_STEPS: readonly StartStep[] = [
  { id: 'account', titleKey: 'site.docs.start.account.title', bodyKey: 'site.docs.start.account.body', keys: [] },
  { id: 'open', titleKey: 'site.docs.start.open.title', bodyKey: 'site.docs.start.open.body', keys: ['Ctrl+O', 'NEW'] },
  { id: 'draw', titleKey: 'site.docs.start.draw.title', bodyKey: 'site.docs.start.draw.body', keys: ['L', 'C', 'REC', 'TR', 'F'] },
  { id: 'save', titleKey: 'site.docs.start.save.title', bodyKey: 'site.docs.start.save.body', keys: ['Ctrl+S', 'Ctrl+Shift+S'] },
  { id: 'plot', titleKey: 'site.docs.start.plot.title', bodyKey: 'site.docs.start.plot.body', keys: ['Ctrl+P', 'PUBLISH', 'DXFOUT'] },
];

/* ── Keyboard shortcuts ────────────────────────────────────────── */

export interface Shortcut {
  id: string;
  /** Key names as printed on the keyboard; literal. */
  keys: readonly string[];
  whatKey: string;
}

export interface ShortcutGroup {
  id: string;
  labelKey: string;
  noteKey?: string;
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
    labelKey: 'site.docs.shortcuts.files.label',
    items: [
      { id: 'save', keys: ['Ctrl+S'], whatKey: 'site.docs.shortcuts.files.save' },
      { id: 'saveAs', keys: ['Ctrl+Shift+S'], whatKey: 'site.docs.shortcuts.files.saveAs' },
      { id: 'open', keys: ['Ctrl+O'], whatKey: 'site.docs.shortcuts.files.open' },
      { id: 'plot', keys: ['Ctrl+P'], whatKey: 'site.docs.shortcuts.files.plot' },
      { id: 'quickPlot', keys: ['Ctrl+Shift+P'], whatKey: 'site.docs.shortcuts.files.quickPlot' },
      { id: 'export', keys: ['Ctrl+E'], whatKey: 'site.docs.shortcuts.files.export' },
      { id: 'nextDrawing', keys: ['Ctrl+Tab', 'Ctrl+Shift+Tab'], whatKey: 'site.docs.shortcuts.files.nextDrawing' },
      { id: 'close', keys: ['Ctrl+W'], whatKey: 'site.docs.shortcuts.files.close' },
      { id: 'reopen', keys: ['Ctrl+Shift+T'], whatKey: 'site.docs.shortcuts.files.reopen' },
    ],
  },
  {
    id: 'editing',
    labelKey: 'site.docs.shortcuts.editing.label',
    noteKey: 'site.docs.shortcuts.editing.note',
    items: [
      { id: 'undo', keys: ['Ctrl+Z'], whatKey: 'site.docs.shortcuts.editing.undo' },
      { id: 'redo', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], whatKey: 'site.docs.shortcuts.editing.redo' },
      { id: 'selectAll', keys: ['Ctrl+A'], whatKey: 'site.docs.shortcuts.editing.selectAll' },
      { id: 'clipboard', keys: ['Ctrl+C', 'Ctrl+X', 'Ctrl+V'], whatKey: 'site.docs.shortcuts.editing.clipboard' },
      { id: 'pasteOrig', keys: ['Ctrl+Shift+V'], whatKey: 'site.docs.shortcuts.editing.pasteOrig' },
      { id: 'pasteBlock', keys: ['Ctrl+Alt+V'], whatKey: 'site.docs.shortcuts.editing.pasteBlock' },
      { id: 'erase', keys: ['Delete', 'Backspace'], whatKey: 'site.docs.shortcuts.editing.erase' },
      { id: 'cancel', keys: ['Esc'], whatKey: 'site.docs.shortcuts.editing.cancel' },
      { id: 'repeat', keys: ['Enter', 'Space'], whatKey: 'site.docs.shortcuts.editing.repeat' },
      { id: 'shift', keys: ['Shift'], whatKey: 'site.docs.shortcuts.editing.shift' },
    ],
  },
  {
    id: 'aids',
    labelKey: 'site.docs.shortcuts.aids.label',
    noteKey: 'site.docs.shortcuts.aids.note',
    items: [
      { id: 'osnap', keys: ['F3'], whatKey: 'site.docs.shortcuts.aids.osnap' },
      { id: 'grid', keys: ['F7'], whatKey: 'site.docs.shortcuts.aids.grid' },
      { id: 'ortho', keys: ['F8'], whatKey: 'site.docs.shortcuts.aids.ortho' },
      { id: 'polar', keys: ['F10'], whatKey: 'site.docs.shortcuts.aids.polar' },
      { id: 'otrack', keys: ['F11'], whatKey: 'site.docs.shortcuts.aids.otrack' },
      { id: 'dynamicInput', keys: ['F12'], whatKey: 'site.docs.shortcuts.aids.dynamicInput' },
    ],
  },
  {
    id: 'cmdline',
    labelKey: 'site.docs.shortcuts.cmdline.label',
    noteKey: 'site.docs.shortcuts.cmdline.note',
    items: [
      { id: 'letters', keys: ['A–Z'], whatKey: 'site.docs.shortcuts.cmdline.letters' },
      { id: 'space', keys: ['Space'], whatKey: 'site.docs.shortcuts.cmdline.space' },
      { id: 'arrows', keys: ['↑', '↓'], whatKey: 'site.docs.shortcuts.cmdline.arrows' },
      { id: 'tab', keys: ['Tab'], whatKey: 'site.docs.shortcuts.cmdline.tab' },
      { id: 'esc', keys: ['Esc'], whatKey: 'site.docs.shortcuts.cmdline.esc' },
    ],
  },
];

/* ── Snapping and input ────────────────────────────────────────── */

export interface Aid {
  id: string;
  nameKey: string;
  /** Function key; literal. */
  key: string;
  bodyKey: string;
}

/** Source: `snapping.service.ts`, `dynamic-input.service.ts`. */
export const DRAFTING_AIDS: readonly Aid[] = [
  { id: 'ortho', nameKey: 'site.docs.aids.ortho.name', key: 'F8', bodyKey: 'site.docs.aids.ortho.body' },
  { id: 'polar', nameKey: 'site.docs.aids.polar.name', key: 'F10', bodyKey: 'site.docs.aids.polar.body' },
  { id: 'otrack', nameKey: 'site.docs.aids.otrack.name', key: 'F11', bodyKey: 'site.docs.aids.otrack.body' },
  { id: 'dynamicInput', nameKey: 'site.docs.aids.dynamicInput.name', key: 'F12', bodyKey: 'site.docs.aids.dynamicInput.body' },
];

/* ── Layers ────────────────────────────────────────────────────── */

export interface LayerState {
  id: string;
  nameKey: string;
  bodyKey: string;
}

/** Source: the four toggles in `layers-panel.component.ts` and `Layer` in `layer.model.ts`. */
export const LAYER_STATES: readonly LayerState[] = [
  { id: 'onOff', nameKey: 'site.docs.layers.onOff.name', bodyKey: 'site.docs.layers.onOff.body' },
  { id: 'freeze', nameKey: 'site.docs.layers.freeze.name', bodyKey: 'site.docs.layers.freeze.body' },
  { id: 'lock', nameKey: 'site.docs.layers.lock.name', bodyKey: 'site.docs.layers.lock.body' },
  { id: 'plot', nameKey: 'site.docs.layers.plot.name', bodyKey: 'site.docs.layers.plot.body' },
];

/* ── Layouts and plotting ──────────────────────────────────────── */

export interface PaperFamily {
  id: string;
  labelKey: string;
  /** Paper size names; literal. Empty for the custom row, which shows `noteKey` instead. */
  sizes: readonly string[];
  noteKey?: string;
}

/** Source: `PAPER_REGISTRY` in `plot-registry.model.ts`, grouped by category. */
export const PAPER_FAMILIES: readonly PaperFamily[] = [
  { id: 'iso', labelKey: 'site.docs.paper.iso', sizes: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'] },
  { id: 'ansi', labelKey: 'site.docs.paper.ansi', sizes: ['ANSI A', 'ANSI B', 'ANSI C', 'ANSI D', 'ANSI E'] },
  { id: 'arch', labelKey: 'site.docs.paper.arch', sizes: ['ARCH A', 'ARCH B', 'ARCH C', 'ARCH D', 'ARCH E', 'ARCH E1'] },
  { id: 'eng', labelKey: 'site.docs.paper.eng', sizes: ['B', 'C', 'D', 'E'] },
  { id: 'office', labelKey: 'site.docs.paper.office', sizes: ['Letter', 'Legal', 'Tabloid', 'Ledger'] },
  { id: 'custom', labelKey: 'site.docs.paper.custom', sizes: [], noteKey: 'site.docs.paper.customNote' },
];

/** Source: `SCALE_REGISTRY`. Literal. */
export const PLOT_SCALES = {
  metric: ['1:1', '1:2', '1:5', '1:10', '1:20', '1:25', '1:50', '1:75', '1:100', '1:125', '1:150', '1:200', '1:250', '1:500', '1:1000'],
  imperial: ['1/8" = 1\'', '1/4" = 1\'', '3/8" = 1\'', '1/2" = 1\'', '3/4" = 1\'', '1" = 1\''],
} as const;

export interface PlotOutput {
  /** File format; literal. */
  format: string;
  bodyKey: string;
}

/** Source: `FORMAT_META` and the presets in `plot-options.model.ts`. */
export const PLOT_OUTPUTS: readonly PlotOutput[] = [
  { format: 'PDF', bodyKey: 'site.docs.output.pdf' },
  { format: 'SVG', bodyKey: 'site.docs.output.svg' },
  { format: 'PNG / JPG', bodyKey: 'site.docs.output.raster' },
  { format: 'DXF', bodyKey: 'site.docs.output.dxf' },
];

export interface PlotStyleRow {
  id: string;
  nameKey: string;
  bodyKey: string;
}

/** Source: `PlotStyle` in `plot-options.model.ts`. */
export const PLOT_STYLES: readonly PlotStyleRow[] = [
  { id: 'color', nameKey: 'site.docs.plotStyle.color.name', bodyKey: 'site.docs.plotStyle.color.body' },
  { id: 'monochrome', nameKey: 'site.docs.plotStyle.monochrome.name', bodyKey: 'site.docs.plotStyle.monochrome.body' },
  { id: 'grayscale', nameKey: 'site.docs.plotStyle.grayscale.name', bodyKey: 'site.docs.plotStyle.grayscale.body' },
];

/* ── DXF compatibility ─────────────────────────────────────────── */

export interface DxfRow {
  id: string;
  areaKey: string;
  bodyKey: string;
}

/**
 * Source: the Unreleased section of CHANGELOG.md, `dxf-import.service.ts`,
 * `dxf-scanner.ts` and `export.service.ts`. Only what is implemented is listed.
 */
export const DXF_ROUNDTRIP: readonly DxfRow[] = [
  { id: 'layers', areaKey: 'site.docs.dxf.roundtrip.layers.area', bodyKey: 'site.docs.dxf.roundtrip.layers.body' },
  { id: 'blocks', areaKey: 'site.docs.dxf.roundtrip.blocks.area', bodyKey: 'site.docs.dxf.roundtrip.blocks.body' },
  { id: 'text', areaKey: 'site.docs.dxf.roundtrip.text.area', bodyKey: 'site.docs.dxf.roundtrip.text.body' },
  { id: 'dimensions', areaKey: 'site.docs.dxf.roundtrip.dimensions.area', bodyKey: 'site.docs.dxf.roundtrip.dimensions.body' },
  { id: 'hatch', areaKey: 'site.docs.dxf.roundtrip.hatch.area', bodyKey: 'site.docs.dxf.roundtrip.hatch.body' },
  { id: 'polylines', areaKey: 'site.docs.dxf.roundtrip.polylines.area', bodyKey: 'site.docs.dxf.roundtrip.polylines.body' },
  { id: 'tables', areaKey: 'site.docs.dxf.roundtrip.tables.area', bodyKey: 'site.docs.dxf.roundtrip.tables.body' },
  { id: 'ocs', areaKey: 'site.docs.dxf.roundtrip.ocs.area', bodyKey: 'site.docs.dxf.roundtrip.ocs.body' },
  { id: 'other', areaKey: 'site.docs.dxf.roundtrip.other.area', bodyKey: 'site.docs.dxf.roundtrip.other.body' },
];

export const DXF_LIMITS: readonly DxfRow[] = [
  { id: 'dwg', areaKey: 'site.docs.dxf.limits.dwg.area', bodyKey: 'site.docs.dxf.limits.dwg.body' },
  { id: 'version', areaKey: 'site.docs.dxf.limits.version.area', bodyKey: 'site.docs.dxf.limits.version.body' },
  { id: 'mtext', areaKey: 'site.docs.dxf.limits.mtext.area', bodyKey: 'site.docs.dxf.limits.mtext.body' },
  { id: 'threeD', areaKey: 'site.docs.dxf.limits.threeD.area', bodyKey: 'site.docs.dxf.limits.threeD.body' },
  { id: 'hatch', areaKey: 'site.docs.dxf.limits.hatch.area', bodyKey: 'site.docs.dxf.limits.hatch.body' },
];

/* ── AI assistant ──────────────────────────────────────────────── */

export interface AiBackend {
  id: string;
  nameKey: string;
  whereKey: string;
  bodyKey: string;
}

/** Source: `ai-model.ts`, `ai-model.service.ts`, `llm-gateway.service.ts`. */
export const AI_BACKENDS: readonly AiBackend[] = [
  { id: 'builtin', nameKey: 'site.docs.ai.backend.builtin.name', whereKey: 'site.docs.ai.backend.builtin.where', bodyKey: 'site.docs.ai.backend.builtin.body' },
  { id: 'ollama', nameKey: 'site.docs.ai.backend.ollama.name', whereKey: 'site.docs.ai.backend.ollama.where', bodyKey: 'site.docs.ai.backend.ollama.body' },
  { id: 'openrouter', nameKey: 'site.docs.ai.backend.openrouter.name', whereKey: 'site.docs.ai.backend.openrouter.where', bodyKey: 'site.docs.ai.backend.openrouter.body' },
];

export interface AiCapability {
  id: string;
  groupKey: string;
  itemKeys: readonly string[];
}

/** Source: the tool files in `ai-agent/tools/`. */
export const AI_CAPABILITIES: readonly AiCapability[] = [
  { id: 'select', groupKey: 'site.docs.ai.cap.select.group', itemKeys: ['site.docs.ai.cap.select.byFilter'] },
  {
    id: 'edit',
    groupKey: 'site.docs.ai.cap.edit.group',
    itemKeys: [
      'site.docs.ai.cap.edit.colour',
      'site.docs.ai.cap.edit.layer',
      'site.docs.ai.cap.edit.lineweight',
      'site.docs.ai.cap.edit.move',
      'site.docs.ai.cap.edit.delete',
      'site.docs.ai.cap.edit.replace',
    ],
  },
  {
    id: 'layers',
    groupKey: 'site.docs.ai.cap.layers.group',
    itemKeys: ['site.docs.ai.cap.layers.isolate', 'site.docs.ai.cap.layers.lock', 'site.docs.ai.cap.layers.show', 'site.docs.ai.cap.layers.rename'],
  },
  {
    id: 'annotate',
    groupKey: 'site.docs.ai.cap.annotate.group',
    itemKeys: ['site.docs.ai.cap.annotate.dimension', 'site.docs.ai.cap.annotate.symbol', 'site.docs.ai.cap.annotate.sheet'],
  },
  {
    id: 'sheets',
    groupKey: 'site.docs.ai.cap.sheets.group',
    itemKeys: ['site.docs.ai.cap.sheets.arrange', 'site.docs.ai.cap.sheets.moveView', 'site.docs.ai.cap.sheets.zoom'],
  },
];

export interface RiskRow {
  /** Risk class id as the tools declare it. */
  cls: 'safe' | 'review' | 'destructive';
  clsKey: string;
  tone: 'success' | 'warning' | 'danger';
  bodyKey: string;
}

/** Source: `riskClass` in the tools and `ActionRouterService.validate`. */
export const AI_RISK: readonly RiskRow[] = [
  { cls: 'safe', clsKey: 'site.docs.ai.risk.safe.label', tone: 'success', bodyKey: 'site.docs.ai.risk.safe.body' },
  { cls: 'review', clsKey: 'site.docs.ai.risk.review.label', tone: 'warning', bodyKey: 'site.docs.ai.risk.review.body' },
  { cls: 'destructive', clsKey: 'site.docs.ai.risk.destructive.label', tone: 'danger', bodyKey: 'site.docs.ai.risk.destructive.body' },
];

/**
 * Prompts the built-in parser handles; each is covered by a changelog entry.
 * Deliberately literal: the rule-based parser reads English, so a translated
 * example would be one the reader cannot type.
 */
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
  id: string;
  labelKey: string;
  bodyKey: string;
}

/** Source: the conflict dialog in `drawing-persistence.service.ts`. */
export const CONFLICT_ANSWERS: readonly ConflictAnswer[] = [
  { id: 'copy', labelKey: 'site.docs.cloud.conflict.copy.label', bodyKey: 'site.docs.cloud.conflict.copy.body' },
  { id: 'reload', labelKey: 'site.docs.cloud.conflict.reload.label', bodyKey: 'site.docs.cloud.conflict.reload.body' },
  { id: 'overwrite', labelKey: 'site.docs.cloud.conflict.overwrite.label', bodyKey: 'site.docs.cloud.conflict.overwrite.body' },
];

export interface RoleRow {
  id: string;
  roleKey: string;
  bodyKey: string;
}

/** Source: `OrgRole` in `api.models.ts`. */
export const ORG_ROLES: readonly RoleRow[] = [
  { id: 'viewer', roleKey: 'site.docs.cloud.role.viewer.name', bodyKey: 'site.docs.cloud.role.viewer.body' },
  { id: 'member', roleKey: 'site.docs.cloud.role.member.name', bodyKey: 'site.docs.cloud.role.member.body' },
  { id: 'admin', roleKey: 'site.docs.cloud.role.admin.name', bodyKey: 'site.docs.cloud.role.admin.body' },
  { id: 'owner', roleKey: 'site.docs.cloud.role.owner.name', bodyKey: 'site.docs.cloud.role.owner.body' },
];

/* ── Languages ─────────────────────────────────────────────────── */

/** Source: the Languages section of README.md; the same set AutoCAD ships. Endonyms; never translated. */
export const LANGUAGES: readonly string[] = [
  'English', 'Čeština', 'Deutsch', 'Español', 'Français', 'Magyar', 'Italiano',
  '日本語', '한국어', 'Polski', 'Português (Brasil)', 'Русский', '简体中文', '繁體中文',
];

/* ── Embedding ─────────────────────────────────────────────────── */

/** Source: docs/INTEGRATION.md, checked against `cad-editor.ts` and `drawing-transfer.service.ts`. Code; literal. */
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
