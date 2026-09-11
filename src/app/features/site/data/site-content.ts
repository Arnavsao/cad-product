/**
 * Product facts and copy shared by the public pages.
 *
 * One file, so the home page's feature explorer, the features page, the docs
 * command reference and the comparison tables cannot disagree about what the
 * editor does. Everything here is backed by the code base: the command list is
 * `tool-catalog.service.ts`, the object snaps are `snapping.service.ts`, the
 * paper sizes are `plot-options.model.ts`, the numbers are counted, not
 * estimated. When the product changes, change this file with it.
 *
 * Translation convention: every prose field holds a translation KEY, not
 * English, and is named `…Key` (`title` → `titleKey`, `body` → `bodyKey`,
 * `label` → `labelKey`, `points` → `pointKeys`). Resolve with `t(item.titleKey)`
 * in a template or `TranslocoService.translate()` in code. The English lives in
 * `scripts/i18n/app-strings/site-core.en.json` under `site.content.*`.
 * Identifiers stay literal and untranslated: ids, icons, command-line aliases,
 * object snap names (as AutoCAD spells them), file formats, numbers and dates.
 */

import type { UiIconName } from '../../../shared/ui/icon.component';

/* ── Numbers ───────────────────────────────────────────────────── */

export interface Fact {
  /** Stable identifier (`FACTS.find((f) => f.id === 'snapshots')`). */
  id: string;
  value: number;
  suffix?: string;
  labelKey: string;
  detailKey: string;
}

export const FACTS: readonly Fact[] = [
  { id: 'commands', value: 70, suffix: '+', labelKey: 'site.content.facts.commands.label', detailKey: 'site.content.facts.commands.detail' },
  { id: 'snaps', value: 15, labelKey: 'site.content.facts.snaps.label', detailKey: 'site.content.facts.snaps.detail' },
  { id: 'languages', value: 14, labelKey: 'site.content.facts.languages.label', detailKey: 'site.content.facts.languages.detail' },
  { id: 'paperSizes', value: 26, labelKey: 'site.content.facts.paperSizes.label', detailKey: 'site.content.facts.paperSizes.detail' },
  { id: 'themes', value: 12, labelKey: 'site.content.facts.themes.label', detailKey: 'site.content.facts.themes.detail' },
  { id: 'snapshots', value: 30, suffix: 's', labelKey: 'site.content.facts.snapshots.label', detailKey: 'site.content.facts.snapshots.detail' },
];

/* ── Commands, by group ────────────────────────────────────────── */

export interface CommandRef {
  /** Stable identifier, unique within the group. */
  id: string;
  /** Display name as the toolbar shows it (translated). */
  nameKey: string;
  /** Command-line aliases, shortest first. Never translated. */
  aliases: readonly string[];
  /** What it does, in one line (translated). */
  whatKey: string;
}

export interface CommandGroup {
  id: string;
  labelKey: string;
  icon: UiIconName;
  /** One line for the explorer tab. */
  hintKey: string;
  /** Paragraph for the explorer panel. */
  summaryKey: string;
  commands: readonly CommandRef[];
}

/** Builds a command whose keys live under `site.content.groups.<group>.cmd.<id>`. */
function cmd(group: string, id: string, aliases: readonly string[]): CommandRef {
  const base = `site.content.groups.${group}.cmd.${id}`;
  return { id, nameKey: `${base}.name`, aliases, whatKey: `${base}.what` };
}

function group(id: string, icon: UiIconName, commands: readonly CommandRef[]): CommandGroup {
  const base = `site.content.groups.${id}`;
  return { id, labelKey: `${base}.label`, icon, hintKey: `${base}.hint`, summaryKey: `${base}.summary`, commands };
}

export const COMMAND_GROUPS: readonly CommandGroup[] = [
  group('draw', 'pencil', [
    cmd('draw', 'line', ['L', 'LINE']),
    cmd('draw', 'polyline', ['PL']),
    cmd('draw', 'circle', ['C']),
    cmd('draw', 'arc', ['A']),
    cmd('draw', 'rectangle', ['REC']),
    cmd('draw', 'ellipse', ['EL']),
    cmd('draw', 'spline', ['SP']),
    cmd('draw', 'hatch', ['H']),
    cmd('draw', 'xline', ['XL', 'XLH', 'XLV']),
    cmd('draw', 'point', ['PO']),
    cmd('draw', 'table', ['TB']),
    cmd('draw', 'image', ['IM']),
    cmd('draw', 'symbol', ['SYM']),
  ]),
  group('annotate', 'tag', [
    cmd('annotate', 'dimension', ['D', 'DIM']),
    cmd('annotate', 'dimlinear', ['DIMLINEAR']),
    cmd('annotate', 'text', ['T']),
    cmd('annotate', 'multileader', ['MLD', 'MLEADER']),
    cmd('annotate', 'centerline', ['CL']),
    cmd('annotate', 'centerMark', ['CM']),
    cmd('annotate', 'dimstyle', ['DIMSTYLE', 'DST']),
    cmd('annotate', 'distance', ['DI', 'DIST']),
  ]),
  group('modify', 'move', [
    cmd('modify', 'moveCopy', ['M', 'CO', 'CP']),
    cmd('modify', 'rotateScaleMirror', ['RO', 'SC', 'MI']),
    cmd('modify', 'trim', ['TR']),
    cmd('modify', 'fillet', ['F']),
    cmd('modify', 'offset', ['O']),
    cmd('modify', 'array', ['AR']),
    cmd('modify', 'stretch', ['STR']),
    cmd('modify', 'joinExplode', ['J', 'X']),
    cmd('modify', 'matchProperties', ['MA']),
    cmd('modify', 'drawOrder', ['DR']),
    cmd('modify', 'erase', ['E', 'DEL']),
    cmd('modify', 'clipboard', ['Ctrl+C', 'Ctrl+V', 'COPYBASE', 'PASTEBLOCK']),
  ]),
  group('blocks', 'grid', [
    cmd('blocks', 'block', ['B', 'BMAKE']),
    cmd('blocks', 'insert', ['I']),
    cmd('blocks', 'bedit', ['BEDIT', 'BCLOSE']),
    cmd('blocks', 'palette', ['BLOCKS']),
    cmd('blocks', 'layers', ['LA']),
    cmd('blocks', 'properties', ['PR']),
    cmd('blocks', 'library', ['LIB']),
    cmd('blocks', 'find', ['FIND']),
  ]),
  group('layouts', 'file', [
    cmd('layouts', 'layout', ['LAYOUT']),
    cmd('layouts', 'mview', ['MVIEW', 'MV']),
    cmd('layouts', 'spaces', ['MSPACE', 'PSPACE']),
    cmd('layouts', 'pagesetup', ['PAGESETUP']),
    cmd('layouts', 'viewports', ['VP']),
    cmd('layouts', 'plot', ['PLOT', 'Ctrl+P']),
    cmd('layouts', 'publish', ['PUBLISH']),
    cmd('layouts', 'export', ['PDF', 'SVG', 'PNG', 'JPG', 'DXF']),
  ]),
  group('files', 'cloud', [
    cmd('files', 'open', ['Ctrl+O', 'NEW']),
    cmd('files', 'save', ['Ctrl+S', 'SAVEAS']),
    cmd('files', 'myDrawings', ['DWGS']),
    cmd('files', 'dxfout', ['DXFOUT']),
    cmd('files', 'versions', ['Dashboard']),
    cmd('files', 'share', ['Dashboard']),
  ]),
  group('ai', 'sparkle', [
    cmd('ai', 'select', ['query']),
    cmd('ai', 'recolour', ['mutate:entities']),
    cmd('ai', 'moveDelete', ['mutate:entities']),
    cmd('ai', 'layers', ['mutate:layers']),
    cmd('ai', 'dimension', ['annotation']),
    cmd('ai', 'insertLibrary', ['insert:library']),
    cmd('ai', 'arrange', ['mutate:layout']),
    cmd('ai', 'navigate', ['navigate']),
  ]),
];

/* ── Object snaps ──────────────────────────────────────────────── */

/** Object snap names as AutoCAD spells them. Not translated. */
export const OBJECT_SNAPS: readonly string[] = [
  'Endpoint', 'Midpoint', 'Center', 'Geometric center', 'Node', 'Quadrant', 'Intersection',
  'Apparent intersection', 'Extension', 'Insertion', 'Perpendicular', 'Tangent', 'Nearest', 'Parallel',
];

/* ── The drawing's journey (home page workflow) ────────────────── */

export interface WorkflowStep {
  id: string;
  index: string;
  titleKey: string;
  bodyKey: string;
  /** Command-line line shown in the step's terminal chip (translated). */
  promptKey: string;
  icon: UiIconName;
}

function workflowStep(id: string, index: string, icon: UiIconName): WorkflowStep {
  const base = `site.content.workflow.${id}`;
  return { id, index, titleKey: `${base}.title`, bodyKey: `${base}.body`, promptKey: `${base}.prompt`, icon };
}

export const WORKFLOW: readonly WorkflowStep[] = [
  workflowStep('open', '01', 'upload'),
  workflowStep('draft', '02', 'pencil'),
  workflowStep('annotate', '03', 'tag'),
  workflowStep('layout', '04', 'file'),
  workflowStep('share', '05', 'share'),
];

/* ── Who it is for (home page split, use-cases page) ───────────── */

export interface Audience {
  id: string;
  labelKey: string;
  icon: UiIconName;
  headlineKey: string;
  bodyKey: string;
  pointKeys: readonly string[];
}

function audience(id: string, icon: UiIconName): Audience {
  const base = `site.content.audiences.${id}`;
  return {
    id,
    labelKey: `${base}.label`,
    icon,
    headlineKey: `${base}.headline`,
    bodyKey: `${base}.body`,
    pointKeys: [`${base}.point1`, `${base}.point2`, `${base}.point3`],
  };
}

export const AUDIENCES: readonly Audience[] = [
  audience('architects', 'building'),
  audience('engineers', 'grid'),
  audience('students', 'user'),
  audience('teams', 'users'),
  audience('builders', 'settings'),
];

/* ── Formats ───────────────────────────────────────────────────── */

/** The read/write cell values. `FORMAT_NONE` renders as a dash; compare against it for styling. */
export const FORMAT_YES = 'site.content.formats.yes';
export const FORMAT_NONE = 'site.content.formats.none';
export const FORMAT_STORE_ONLY = 'site.content.formats.storeOnly';
export const FORMAT_AS_UNDERLAY = 'site.content.formats.asUnderlay';

export interface FormatRow {
  /** File format name. Not translated. */
  format: string;
  readKey: string;
  writeKey: string;
  noteKey: string;
}

export const FORMATS: readonly FormatRow[] = [
  { format: 'DXF', readKey: FORMAT_YES, writeKey: FORMAT_YES, noteKey: 'site.content.formats.dxf.note' },
  { format: 'DWG', readKey: FORMAT_STORE_ONLY, writeKey: FORMAT_NONE, noteKey: 'site.content.formats.dwg.note' },
  { format: 'PDF', readKey: FORMAT_NONE, writeKey: FORMAT_YES, noteKey: 'site.content.formats.pdf.note' },
  { format: 'SVG', readKey: FORMAT_NONE, writeKey: FORMAT_YES, noteKey: 'site.content.formats.svg.note' },
  { format: 'PNG / JPG', readKey: FORMAT_AS_UNDERLAY, writeKey: FORMAT_YES, noteKey: 'site.content.formats.raster.note' },
];

/* ── Browser vs installed desktop CAD ──────────────────────────── */

export interface CompareRow {
  id: string;
  labelKey: string;
  cadoKey: string;
  desktopKey: string;
}

function compareRow(id: string): CompareRow {
  const base = `site.content.compare.${id}`;
  return { id, labelKey: `${base}.label`, cadoKey: `${base}.cado`, desktopKey: `${base}.desktop` };
}

export const COMPARE: readonly CompareRow[] = [
  compareRow('install'),
  compareRow('licensing'),
  compareRow('os'),
  compareRow('files'),
  compareRow('sharing'),
  compareRow('commandLine'),
  compareRow('layouts'),
  compareRow('threeD'),
];

/* ── Principles (about page) ───────────────────────────────────── */

export interface Principle {
  id: string;
  titleKey: string;
  bodyKey: string;
}

function principle(id: string): Principle {
  const base = `site.content.principles.${id}`;
  return { id, titleKey: `${base}.title`, bodyKey: `${base}.body` };
}

export const PRINCIPLES: readonly Principle[] = [
  principle('parity'),
  principle('ownership'),
  principle('browser'),
  principle('ai'),
];

/* ── Timeline (about page) ─────────────────────────────────────── */

export interface Milestone {
  id: string;
  /**
   * ISO date (`2026-08-29`, `2026-09`) formatted by the page, or `''` for a
   * roadmap bucket, in which case `dateLabelKey` names it ("Next", "Later").
   */
  date: string;
  dateLabelKey?: string;
  titleKey: string;
  bodyKey: string;
  status: 'shipped' | 'now' | 'planned';
}

function milestone(id: string, date: string, status: Milestone['status'], dateLabelKey?: string): Milestone {
  const base = `site.content.timeline.${id}`;
  return { id, date, dateLabelKey, titleKey: `${base}.title`, bodyKey: `${base}.body`, status };
}

export const TIMELINE: readonly Milestone[] = [
  milestone('editor', '2026-08-29', 'shipped'),
  milestone('accounts', '2026-08-29', 'shipped'),
  milestone('product', '2026-09-01', 'shipped'),
  milestone('fidelity', '2026-09', 'now'),
  milestone('billing', '', 'planned', 'site.content.timeline.dates.next'),
  milestone('threeD', '', 'planned', 'site.content.timeline.dates.later'),
];
