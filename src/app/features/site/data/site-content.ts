/**
 * Product facts and copy shared by the public pages.
 *
 * One file, so the home page's feature explorer, the features page, the docs
 * command reference and the comparison tables cannot disagree about what the
 * editor does. Everything here is backed by the code base: the command list is
 * `tool-catalog.service.ts`, the object snaps are `snapping.service.ts`, the
 * paper sizes are `plot-options.model.ts`, the numbers are counted, not
 * estimated. When the product changes, change this file with it.
 */

import type { UiIconName } from '../../../shared/ui/icon.component';

/* ── Numbers ───────────────────────────────────────────────────── */

export interface Fact {
  value: number;
  suffix?: string;
  label: string;
  detail: string;
}

export const FACTS: readonly Fact[] = [
  { value: 70, suffix: '+', label: 'drafting commands', detail: 'Each with its AutoCAD alias, from L to DIMSTYLE.' },
  { value: 14, label: 'object snaps', detail: 'Endpoint to parallel, plus ortho and polar tracking.' },
  { value: 14, label: 'interface languages', detail: 'The same set AutoCAD ships, command prompts included.' },
  { value: 26, label: 'named paper sizes', detail: 'ISO A and B series, ANSI and architectural sheets, or a custom size.' },
  { value: 12, label: 'colour themes', detail: 'Eight dark and four light, canvas and chrome together.' },
  { value: 30, suffix: 's', label: 'recovery snapshots', detail: 'Unsaved work is snapshotted in the browser every 30 seconds.' },
];

/* ── Commands, by group ────────────────────────────────────────── */

export interface CommandRef {
  /** Display name as the toolbar shows it. */
  name: string;
  /** Command-line aliases, shortest first. */
  aliases: readonly string[];
  /** What it does, in one line. */
  what: string;
}

export interface CommandGroup {
  id: string;
  label: string;
  icon: UiIconName;
  /** One line for the explorer tab. */
  hint: string;
  /** Paragraph for the explorer panel. */
  summary: string;
  commands: readonly CommandRef[];
}

export const COMMAND_GROUPS: readonly CommandGroup[] = [
  {
    id: 'draw',
    label: 'Draw',
    icon: 'pencil',
    hint: 'Lines to splines, with snaps and dynamic input',
    summary:
      'The full 2D primitive set, typed or clicked. Every tool takes coordinates at the command line, relative or polar, and every point can snap to one of fourteen object snaps or track along ortho and polar guides.',
    commands: [
      { name: 'Line', aliases: ['L', 'LINE'], what: 'Chained segments; Close and Undo mid-command.' },
      { name: 'Polyline', aliases: ['PL'], what: 'Line and arc segments in one entity, with width.' },
      { name: 'Circle', aliases: ['C'], what: 'Centre-radius, 2P, 3P and tangent-tangent-radius.' },
      { name: 'Arc', aliases: ['A'], what: '3-point, start-centre-end, start-end-angle and more.' },
      { name: 'Rectangle', aliases: ['REC'], what: 'Two corners, or dimensions from a corner.' },
      { name: 'Ellipse', aliases: ['EL'], what: 'Axis-endpoint and centre methods.' },
      { name: 'Spline', aliases: ['SP'], what: 'Fit-point splines.' },
      { name: 'Hatch', aliases: ['H'], what: 'Pick a point inside a boundary; regenerates when edges move.' },
      { name: 'Construction line', aliases: ['XL', 'XLH', 'XLV'], what: 'Infinite guides, horizontal or vertical presets.' },
      { name: 'Point', aliases: ['PO'], what: 'Nodes you can snap to.' },
      { name: 'Table', aliases: ['TB'], what: 'Schedules and legends, edited in place.' },
      { name: 'Image', aliases: ['IM'], what: 'Raster underlays for tracing.' },
      { name: 'Symbol', aliases: ['SYM'], what: 'Insert from the symbol library.' },
    ],
  },
  {
    id: 'annotate',
    label: 'Annotate',
    icon: 'tag',
    hint: 'Dimensions, text, leaders, centre marks',
    summary:
      'Dimensions are associative: they measure the geometry they are attached to and update when it moves. Dimension styles control arrows, text and units per drawing, and MText gives you paragraphs with formatting rather than one-line labels.',
    commands: [
      { name: 'Dimension', aliases: ['D', 'DIM'], what: 'Linear, aligned, angular, radius and diameter from one tool.' },
      { name: 'Linear dimension', aliases: ['DIMLINEAR'], what: 'Horizontal or vertical distance between two points.' },
      { name: 'Text / MText', aliases: ['T'], what: 'Single-line and multi-line text with an in-canvas editor.' },
      { name: 'Multileader', aliases: ['MLD', 'MLEADER'], what: 'Leader line with a text or block note.' },
      { name: 'Centerline', aliases: ['CL'], what: 'Centreline between two lines.' },
      { name: 'Center mark', aliases: ['CM'], what: 'Cross at the centre of a circle or arc.' },
      { name: 'Dimension style', aliases: ['DIMSTYLE', 'DST'], what: 'Arrowheads, text height, precision, units.' },
      { name: 'Distance', aliases: ['DI', 'DIST'], what: 'Measure without drawing anything.' },
    ],
  },
  {
    id: 'modify',
    label: 'Modify',
    icon: 'move',
    hint: 'Trim, fillet, offset, array, match properties',
    summary:
      'Everything you expect from a modify ribbon, working on a selection you build with window, crossing or pick. Grips on every entity let you stretch without a command, and every change lands on one undo stack with the assistant’s edits.',
    commands: [
      { name: 'Move / Copy', aliases: ['M', 'CO', 'CP'], what: 'Displacement by two points or typed offset.' },
      { name: 'Rotate / Scale / Mirror', aliases: ['RO', 'SC', 'MI'], what: 'About a base point, with Copy options.' },
      { name: 'Trim', aliases: ['TR'], what: 'Cut to cutting edges; Shift for extend.' },
      { name: 'Fillet', aliases: ['F'], what: 'Round two edges with a radius, or zero to square them.' },
      { name: 'Offset', aliases: ['O'], what: 'Parallel copies at a distance or through a point.' },
      { name: 'Array', aliases: ['AR'], what: 'Rectangular and polar arrays.' },
      { name: 'Stretch', aliases: ['STR'], what: 'Move the vertices inside a crossing window.' },
      { name: 'Join / Explode', aliases: ['J', 'X'], what: 'Merge into polylines, or break blocks and polylines apart.' },
      { name: 'Match properties', aliases: ['MA'], what: 'Copy layer, colour, lineweight and style between entities.' },
      { name: 'Draw order', aliases: ['DR'], what: 'Bring to front, send to back.' },
      { name: 'Erase', aliases: ['E', 'DEL'], what: 'Delete the selection.' },
      { name: 'Clipboard', aliases: ['Ctrl+C', 'Ctrl+V', 'COPYBASE', 'PASTEBLOCK'], what: 'Copy with base point, paste to original coordinates or as a block.' },
    ],
  },
  {
    id: 'blocks',
    label: 'Blocks & layers',
    icon: 'grid',
    hint: 'Definitions, attributes, a block editor, a library',
    summary:
      'Draw a door once and place it forty times. A block edit changes every instance; attributes give each instance its own tag. Layers carry colour, lineweight and linetype, can be switched off, frozen, locked or kept off the plot, and travel in and out of DXF untouched.',
    commands: [
      { name: 'Block', aliases: ['B', 'BMAKE'], what: 'Define a block from a selection and base point.' },
      { name: 'Insert', aliases: ['I'], what: 'Place a block with scale and rotation.' },
      { name: 'Block editor', aliases: ['BEDIT', 'BCLOSE'], what: 'Edit the definition in isolation; every instance follows.' },
      { name: 'Blocks palette', aliases: ['BLOCKS'], what: 'Browse and drag in every block in the drawing.' },
      { name: 'Layers', aliases: ['LA'], what: 'Create, colour, switch off, freeze, lock, plot or not.' },
      { name: 'Properties', aliases: ['PR'], what: 'Inspect and edit the selection.' },
      { name: 'Library', aliases: ['LIB'], what: 'Reusable symbols across drawings.' },
      { name: 'Find and replace', aliases: ['FIND'], what: 'Across text, MText, attributes and table cells.' },
    ],
  },
  {
    id: 'layouts',
    label: 'Layouts & plotting',
    icon: 'file',
    hint: 'Paper space, viewports, page setup, PDF',
    summary:
      'Model space is where you draw at full size; layouts are where you decide what gets printed. Each layout has its own paper size and viewports at a real scale, plotted to PDF, SVG or an image with lineweights honoured.',
    commands: [
      { name: 'Layout manager', aliases: ['LAYOUT'], what: 'Add, rename and reorder layout tabs.' },
      { name: 'Make viewport', aliases: ['MVIEW', 'MV'], what: 'Frame a region of the model on the sheet at a scale.' },
      { name: 'Model / paper space', aliases: ['MSPACE', 'PSPACE'], what: 'Edit through a viewport or on the sheet.' },
      { name: 'Page setup', aliases: ['PAGESETUP'], what: 'Paper, orientation, margins, plot style, scale.' },
      { name: 'Viewports', aliases: ['VP'], what: 'Zoom, lock and arrange viewports.' },
      { name: 'Plot', aliases: ['PLOT', 'Ctrl+P'], what: 'Window, extents, layout or display, to PDF or image.' },
      { name: 'Publish', aliases: ['PUBLISH'], what: 'Every layout to one PDF.' },
      { name: 'Export', aliases: ['PDF', 'SVG', 'PNG', 'JPG', 'DXF'], what: 'One command per format.' },
    ],
  },
  {
    id: 'files',
    label: 'Files & cloud',
    icon: 'cloud',
    hint: 'DXF round-trip, versions, sharing, recovery',
    summary:
      'A DXF opens in a background worker so a 20 MB survey never freezes the tab, and writes back out with its own layers, blocks, linetypes and dimension styles. Cloud drawings are versioned, conflicts are caught, and a save made offline is kept in the browser until you save again online.',
    commands: [
      { name: 'Open / New', aliases: ['Ctrl+O', 'NEW'], what: 'From your account, a folder or a local DXF.' },
      { name: 'Save / Save as', aliases: ['Ctrl+S', 'SAVEAS'], what: 'Versioned saves with conflict detection; a recovery snapshot every 30 s.' },
      { name: 'My drawings', aliases: ['DWGS'], what: 'Browse the account from inside the editor.' },
      { name: 'Export DXF', aliases: ['DXFOUT'], what: 'The drawing’s own tables, not a generic template.' },
      { name: 'Version history', aliases: ['Dashboard'], what: 'Every save kept; restore any of them.' },
      { name: 'Share link', aliases: ['Dashboard'], what: 'View or edit links, emailed or copied.' },
    ],
  },
  {
    id: 'ai',
    label: 'AI assistant',
    icon: 'sparkle',
    hint: 'Plain-English edits, validated before they run',
    summary:
      'Type what you want — "change all red lines on layer DIM to blue", "isolate WALLS", "add a dimension to the selected wall" — and the assistant turns it into editor commands. Every action is validated, classed safe, review or destructive, previewed, and undoable. Bring your own model: a local Ollama server or an OpenRouter key.',
    commands: [
      { name: 'Select entities', aliases: ['query'], what: 'By colour, layer, type or the current selection.' },
      { name: 'Change colour / layer / lineweight', aliases: ['mutate:entities'], what: 'On a filter or the selection.' },
      { name: 'Move, delete, replace', aliases: ['mutate:entities'], what: 'Destructive ones ask first.' },
      { name: 'Layer isolate / lock / rename / hide', aliases: ['mutate:layers'], what: 'Layer housekeeping by name.' },
      { name: 'Add dimension', aliases: ['annotation'], what: 'To a selected wall or edge.' },
      { name: 'Insert from library', aliases: ['insert:library'], what: 'Symbols by name.' },
      { name: 'Arrange views', aliases: ['mutate:layout'], what: 'Lay out plan, section and detail views on a sheet.' },
      { name: 'Zoom and navigate', aliases: ['navigate'], what: 'Zoom to a layer, a selection or extents.' },
    ],
  },
];

/* ── Object snaps ──────────────────────────────────────────────── */

export const OBJECT_SNAPS: readonly string[] = [
  'Endpoint', 'Midpoint', 'Center', 'Geometric center', 'Node', 'Quadrant', 'Intersection',
  'Apparent intersection', 'Extension', 'Insertion', 'Perpendicular', 'Tangent', 'Nearest', 'Parallel',
];

/* ── The drawing's journey (home page workflow) ────────────────── */

export interface WorkflowStep {
  id: string;
  index: string;
  title: string;
  body: string;
  /** Command-line line shown in the step's terminal chip. */
  prompt: string;
  icon: UiIconName;
}

export const WORKFLOW: readonly WorkflowStep[] = [
  {
    id: 'open',
    index: '01',
    title: 'Open a DXF, or start blank',
    body: 'Drop a file on the dashboard or open it from the editor. Parsing runs in a Web Worker, so a large survey never blocks the UI, and the drawing renders as AutoCAD renders it: dimension values, text, fonts and lineweights included.',
    prompt: 'Opening site.dxf — 12,480 entities, 14 layers, 3 layouts',
    icon: 'upload',
  },
  {
    id: 'draft',
    index: '02',
    title: 'Draft with the commands you know',
    body: 'Type L, C, TR or F and answer the same prompts. Fourteen object snaps, ortho and polar tracking and dynamic input next to the cursor keep the geometry exact. Grips, undo and the properties panel behave the way your hands expect.',
    prompt: '_LINE Specify next point or [Close/Undo]: @3400<90',
    icon: 'pencil',
  },
  {
    id: 'annotate',
    index: '03',
    title: 'Annotate so it survives edits',
    body: 'Dimensions attach to geometry and follow it. Hatch regenerates when its boundary moves. Blocks carry attributes, so a plan can be counted into a schedule with a table instead of retyped.',
    prompt: '_DIMLINEAR Specify second extension line origin: 7000.0',
    icon: 'tag',
  },
  {
    id: 'layout',
    index: '04',
    title: 'Lay it out on paper',
    body: 'Add a layout, set the paper, place viewports at 1:50 or 1:100, fill the title block. The same model can carry a general arrangement and a detail sheet without duplicating a line.',
    prompt: '_MVIEW Specify corner of viewport: scale 1:50 on A3 landscape',
    icon: 'file',
  },
  {
    id: 'share',
    index: '05',
    title: 'Plot, export, share',
    body: 'Plot to PDF with real lineweights, export SVG or an image, or write the DXF back out with its own layers, blocks and linetypes. Save keeps a version; a share link lets a reviewer open it in their browser too.',
    prompt: 'Saved v14 · exported GA-01.pdf · link copied',
    icon: 'share',
  },
];

/* ── Who it is for (home page split, use-cases page) ───────────── */

export interface Audience {
  id: string;
  label: string;
  icon: UiIconName;
  headline: string;
  body: string;
  points: readonly string[];
}

export const AUDIENCES: readonly Audience[] = [
  {
    id: 'architects',
    label: 'Architects',
    icon: 'building',
    headline: 'Plans, sections and schedules without the seat licence.',
    body: 'Open consultant DXFs, draw over them, and issue sheets at a real scale. Blocks with attributes turn doors and windows into schedules; layouts carry a GA and a detail sheet from one model.',
    points: ['DXF round-trip with layers and blocks intact', 'Layouts, viewports and title blocks', 'Hatch, dimension styles and MText'],
  },
  {
    id: 'engineers',
    label: 'Civil & structural engineers',
    icon: 'grid',
    headline: 'GA drawings that read the way AutoCAD wrote them.',
    body: 'Dimension values, plot-scale overrides, per-style fonts and lineweights are imported faithfully, so a bridge general arrangement opens as issued. Measure, mark up and export without a conversion step.',
    points: ['Faithful dimension and text import', 'Distance and inquiry tools', 'PDF plotting with lineweights honoured'],
  },
  {
    id: 'students',
    label: 'Students & educators',
    icon: 'user',
    headline: 'The same commands as the industry, on any laptop in the room.',
    body: 'Nothing to install and nothing to license per seat. The command line, aliases and prompts match AutoCAD, so what students learn transfers, and the UI speaks fourteen languages.',
    points: ['Free plan with the full toolset', 'AutoCAD command aliases and prompts', 'Works on Chromebooks and shared machines'],
  },
  {
    id: 'teams',
    label: 'Studios & teams',
    icon: 'users',
    headline: 'One set of drawings, one place, with a version for every save.',
    body: 'Organizations with owner, admin, member and viewer roles; shared folders; view or edit links you can email. Two people saving the same drawing get a clear choice instead of a silent overwrite.',
    points: ['Organizations and roles', 'Version history and restore', 'Share links, view-only or edit'],
  },
  {
    id: 'builders',
    label: 'Product teams',
    icon: 'settings',
    headline: 'A drafting surface you can embed in your own product.',
    body: 'The editor is a standalone Angular component with a small API: hand it DXF text or a drawing id, receive the DXF back on save, and keep your own identity system. Run it on your origin or ours.',
    points: ['initialDxf / save / close component API', 'Bring-your-own auth token provider', 'Embedded mode with no sign-in'],
  },
];

/* ── Formats ───────────────────────────────────────────────────── */

export interface FormatRow {
  format: string;
  read: string;
  write: string;
  note: string;
}

export const FORMATS: readonly FormatRow[] = [
  { format: 'DXF', read: 'Yes', write: 'Yes', note: 'ASCII DXF. Layers, blocks, attributes, linetypes, dimension styles, hatches, MText, tables, layouts and viewports round-trip.' },
  { format: 'DWG', read: 'Store only', write: '—', note: 'A .dwg can be uploaded, versioned and downloaded from the dashboard, but the editor cannot open it yet. Save as DXF from your desktop CAD first.' },
  { format: 'PDF', read: '—', write: 'Yes', note: 'Vector plot of a window, the extents or a layout, with lineweights; Publish writes every layout to one file.' },
  { format: 'SVG', read: '—', write: 'Yes', note: 'Vector export of the current view.' },
  { format: 'PNG / JPG', read: 'As underlay', write: 'Yes', note: 'Raster export at a chosen resolution; images can be inserted as tracing underlays.' },
];

/* ── Browser vs installed desktop CAD ──────────────────────────── */

export interface CompareRow {
  label: string;
  cado: string;
  desktop: string;
}

export const COMPARE: readonly CompareRow[] = [
  { label: 'Install and updates', cado: 'Open a tab. Updates arrive with the page.', desktop: 'Multi-gigabyte installer per machine, yearly upgrades.' },
  { label: 'Licensing', cado: 'Free plan; Pro and Team per user, cancel any time.', desktop: 'Per-seat subscription or a licence server.' },
  { label: 'Operating system', cado: 'Windows, macOS, Linux, ChromeOS — anything with a modern browser.', desktop: 'Usually Windows, sometimes macOS.' },
  { label: 'Where files live', cado: 'Your account, versioned, or your disk as DXF.', desktop: 'Local disk or a network share.' },
  { label: 'Sharing a drawing', cado: 'A link. The recipient opens it in a browser.', desktop: 'Export a PDF, or install a viewer.' },
  { label: 'Command line', cado: 'Yes, with AutoCAD aliases and prompts.', desktop: 'Yes.' },
  { label: 'Layouts and plotting', cado: 'Model and paper space, viewports, PDF.', desktop: 'Yes.' },
  { label: '3D modelling', cado: 'Not yet — CADO is 2D drafting. 3D is on the roadmap.', desktop: 'Usually.' },
];

/* ── Principles (about page) ───────────────────────────────────── */

export interface Principle {
  title: string;
  body: string;
}

export const PRINCIPLES: readonly Principle[] = [
  {
    title: 'AutoCAD parity is the bar, not a feature.',
    body: 'A drawing must open in CADO the way it was issued: same dimension values, same text, same lineweights. When a DXF renders differently from AutoCAD we treat it as a bug and fix the importer, not the drawing.',
  },
  {
    title: 'Your files are yours.',
    body: 'DXF export is on every plan, including Free. If you stop paying your drawings stay readable and exportable. There is no proprietary format standing between you and your work.',
  },
  {
    title: 'The browser is enough.',
    body: 'Parsing, rendering, snapping, hatching and plotting all run on your machine, in the tab. The server holds identity, files and versions. A large drawing does not need a large upload to draw a line.',
  },
  {
    title: 'AI proposes, you decide.',
    body: 'The assistant compiles plain language into ordinary editor commands, validates them, labels the risk and shows you before it commits. Everything it does is undoable, and the audit log stays on your device.',
  },
];

/* ── Timeline (about page) ─────────────────────────────────────── */

export interface Milestone {
  date: string;
  title: string;
  body: string;
  status: 'shipped' | 'now' | 'planned';
}

export const TIMELINE: readonly Milestone[] = [
  { date: '2026-08-29', title: '1.0 — the editor', body: 'Lines, polylines, arcs, hatch, dimensions, blocks, layouts, DXF in and out, twelve themes.', status: 'shipped' },
  { date: '2026-08-29', title: '1.1 — accounts and cloud drawings', body: 'Sign in, save to your account, Recent, My Drawings with folders, Trash, safe concurrent saves, drag-and-drop upload.', status: 'shipped' },
  { date: '2026-09-01', title: '1.2 — a product around the editor', body: 'Feedback, notifications, personal info, plans and pricing, and a run of editor fixes.', status: 'shipped' },
  { date: '2026-09', title: 'DXF fidelity and layouts', body: 'Imported drawings render as AutoCAD renders them; layout tabs show the model and accept every tool; HiDPI-crisp canvases; the assistant understands which entities you mean.', status: 'now' },
  { date: 'Next', title: 'Plan enforcement, billing live, team invoicing', body: 'The Free tier limits advertised on the pricing page are recorded today and will be enforced once billing goes live.', status: 'planned' },
  { date: 'Later', title: 'Parametric 3D', body: 'A phased plan exists for a 3D kernel after the 2D product is complete. Nothing from it ships yet, and nothing on this site claims otherwise.', status: 'planned' },
];
