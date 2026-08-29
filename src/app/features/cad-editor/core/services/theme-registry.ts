/**
 * Theme registry — the editor's colour schemes.
 *
 * A theme is declared as a compact SEED (a dozen colours). Two derivations
 * expand it into the values the rest of the editor consumes:
 *
 *   seed ──► uiTokens()      → CSS custom properties (`--color-*`) that
 *   │                          cad-editor.scss maps onto its `--cad-*` tokens.
 *   └─────► buildPalette()   → ICadCanvasPalette, read by canvas-runtime
 *                              drawing code, which cannot resolve CSS vars.
 *
 * Deriving rather than hand-writing every key means a new theme is ~12 lines
 * and can never silently miss a paint role.
 */

/**
 * Palette consumed by canvas-runtime drawing code (TypeScript ctx.fillStyle
 * cannot read CSS variables, so we mirror the SCSS tokens here). One key per
 * paint role — drawing code reads `theme.canvas().<key>` instead of inlining hex.
 */
export interface ICadCanvasPalette {
  /** Solid background of the drawing area (matches .cad-canvas-area). */
  canvasBg: string;
  /** Minor grid line color (already includes alpha). */
  gridMinor: string;
  /** Major grid line color (10x step). */
  gridMajor: string;
  /** World origin X-axis line (red). */
  axisX: string;
  /** World origin Y-axis line (green). */
  axisY: string;
  /** Default stroke color for entities whose resolved color matches the
   *  background (e.g. ACI 7 = white in dark theme, black in light theme). */
  entityDefault: string;
  /** Selection dashed-overlay color. */
  selection: string;
  /** Grip square fill, unselected entity. */
  gripFillUnselected: string;
  /** Grip square fill, selected entity. */
  gripFillSelected: string;
  /** Grip square stroke, unselected entity. */
  gripStrokeUnselected: string;
  /** Grip square stroke, selected entity. */
  gripStrokeSelected: string;
  /** Manager grip square: idle (cyan-ish). */
  gripIdle: string;
  /** Manager grip square: hover (yellow). */
  gripHover: string;
  /** Manager grip square: active drag (red). */
  gripActive: string;
  /** Outline stroke around grip-manager grip squares. */
  gripOutline: string;
  /** Snap marker color (green diamond/X). */
  snapMarker: string;
  /** Ortho/polar guide line color. */
  guide: string;
  /** Polar angle label color. */
  guideLabel: string;
  /** OSnap candidate ring (orange) — used in many grip-manager paths. */
  osnapHint: string;
  /** Preselection hover highlight color (used by modify tools). */
  hover: string;
  /** Target entity highlight (Cyan) to distinguish from boundaries. */
  target: string;
}

/** Whether a theme paints on a dark or a light ground. */
export type CadThemeKind = 'dark' | 'light';

/** The dozen colours that define a theme. Everything else is derived. */
export interface ICadThemeSeed {
  /** Stable id persisted in localStorage. Never rename an existing one. */
  id: string;
  /** Label shown in the Settings picker. */
  name: string;
  kind: CadThemeKind;
  /** Drawing area / canvas background — the theme's dominant colour. */
  bg: string;
  /** Panels, sidebar and toolbar background. */
  chrome: string;
  /** Title bar / header background. */
  titleBar: string;
  /** Hairlines between regions. */
  border: string;
  /** Primary body text. */
  text: string;
  /** Secondary text, icons, placeholders. */
  textDim: string;
  /** Accent — active tool, focus ring, selection overlay. */
  accent: string;
  /** Pressed/darker accent. */
  accentDark: string;
  /** Text drawn on top of `accent`. */
  onAccent: string;
  /** Input / dropdown background. */
  inputBg: string;
  /** Semantic accents used by the status bar and toggles. */
  green: string;
  yellow: string;
  red: string;
  /** Rare per-theme canvas tweaks (e.g. a warmer grid on a sepia ground). */
  canvas?: Partial<ICadCanvasPalette>;
}

/** A fully expanded theme, ready to apply. */
export interface ICadTheme {
  id: string;
  name: string;
  kind: CadThemeKind;
  /** `--color-*` custom properties, applied to <body>. */
  ui: Readonly<Record<string, string>>;
  /** Canvas-runtime paint colours. */
  canvas: ICadCanvasPalette;
  /** Three-colour preview used by the Settings picker swatch. */
  swatch: readonly [string, string, string];
}

/** `#rrggbb` → `rgba(r, g, b, a)`. Falls back to the input when unparseable. */
function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** CSS custom properties for a seed. Consumed by cad-editor.scss. */
function uiTokens(s: ICadThemeSeed): Record<string, string> {
  return {
    '--color-bg': s.bg,
    '--color-text': s.text,
    '--color-primary': s.accent,
    '--color-primary-dark': s.accentDark,

    '--color-nav-bg': s.titleBar,
    '--color-nav-border': s.border,
    '--color-nav-link': s.textDim,
    '--color-nav-link-hover': s.text,
    '--color-nav-link-bg-hover': s.chrome,
    '--color-nav-link-active': s.accent,
    '--color-nav-link-active-bg': rgba(s.accent, 0.12),

    '--color-input-bg': s.inputBg,
    '--color-input-border': s.border,
    '--color-input-text': s.text,
    '--color-input-placeholder': s.textDim,

    // Consumed by cad-editor.scss through `var(--color-x, <fallback>)`, so
    // themes that predate a token still render with the original value.
    '--color-on-accent': s.onAccent,
    '--color-accent-tint': rgba(s.accent, 0.15),
    '--color-accent-glow': rgba(s.accent, 0.3),
    '--color-green': s.green,
    '--color-yellow': s.yellow,
    '--color-red': s.red,
    '--color-surface': s.chrome,
    '--color-shadow-panel': `0 4px 16px ${rgba('#000000', s.kind === 'dark' ? 0.4 : 0.14)}`,
    '--color-shadow-float': `0 4px 20px ${rgba('#000000', s.kind === 'dark' ? 0.5 : 0.18)}`,
  };
}

/** Paint roles that do not vary with the accent, split by ground brightness. */
const CANVAS_BASE: Record<CadThemeKind, Omit<ICadCanvasPalette, 'canvasBg' | 'selection' | 'guide' | 'guideLabel' | 'gripFillSelected' | 'snapMarker' | 'gripHover' | 'gripActive'>> = {
  dark: {
    gridMinor: 'rgba(255,255,255,0.06)',
    gridMajor: 'rgba(255,255,255,0.18)',
    axisX: 'rgba(252,129,129,0.55)',
    axisY: 'rgba(104,211,145,0.55)',
    entityDefault: '#ffffff',
    gripFillUnselected: '#68d391',
    gripStrokeUnselected: '#0d0f14',
    gripStrokeSelected: '#1a3a5c',
    gripIdle: '#63e0e0',
    gripOutline: '#ffffff',
    osnapHint: 'rgba(240, 160, 48, 0.85)',
    hover: '#4fc3f7',
    target: '#00e5ff',
  },
  light: {
    gridMinor: 'rgba(0,0,0,0.07)',
    gridMajor: 'rgba(0,0,0,0.18)',
    axisX: 'rgba(200,40,40,0.55)',
    axisY: 'rgba(40,140,60,0.55)',
    entityDefault: '#000000',
    gripFillUnselected: '#2d8a4a',
    gripStrokeUnselected: '#ffffff',
    gripStrokeSelected: '#0b2a55',
    gripIdle: '#1c8a8a',
    gripOutline: '#1a1a1a',
    osnapHint: 'rgba(204, 102, 0, 0.9)',
    hover: '#039be5',
    target: '#00b0ff',
  },
};

/** Expand a seed into the canvas palette. */
function buildPalette(s: ICadThemeSeed): ICadCanvasPalette {
  const base = CANVAS_BASE[s.kind];
  return {
    ...base,
    canvasBg: s.bg,
    selection: s.accent,
    gripFillSelected: s.accent,
    snapMarker: s.green,
    gripHover: s.yellow,
    gripActive: s.red,
    guide: rgba(s.accent, s.kind === 'dark' ? 0.45 : 0.55),
    guideLabel: rgba(s.accent, s.kind === 'dark' ? 0.95 : 1),
    ...(s.canvas ?? {}),
  };
}

/**
 * Theme seeds, ordered as they appear in the picker (dark group first, each
 * group's default first). Colours follow the well-known editor schemes of the
 * same name, adapted to this UI's token set.
 */
const SEEDS: readonly ICadThemeSeed[] = [
  // ── Dark ────────────────────────────────────────────────────────────────
  {
    id: 'cad-dark', name: 'CAD Dark', kind: 'dark',
    bg: '#181c22', chrome: '#212730', titleBar: '#1b2027', border: '#2c333d',
    text: '#d7dee8', textDim: '#8b97a8',
    accent: '#4c9aff', accentDark: '#2f6fd0', onAccent: '#ffffff', inputBg: '#252c36',
    green: '#4cc38a', yellow: '#e5a94e', red: '#e0605e',
  },
  {
    id: 'dark-modern', name: 'Dark Modern', kind: 'dark',
    bg: '#1f1f1f', chrome: '#181818', titleBar: '#181818', border: '#2b2b2b',
    text: '#cccccc', textDim: '#8b8b8b',
    accent: '#0078d4', accentDark: '#0060aa', onAccent: '#ffffff', inputBg: '#313131',
    green: '#4ec994', yellow: '#cca700', red: '#f14c4c',
  },
  {
    id: 'abyss', name: 'Abyss', kind: 'dark',
    bg: '#000c18', chrome: '#051336', titleBar: '#010b1a', border: '#0f2757',
    text: '#c2d3e6', textDim: '#6a83a6',
    accent: '#2277ff', accentDark: '#1a5bc4', onAccent: '#ffffff', inputBg: '#0b2547',
    green: '#22aa44', yellow: '#ddbb88', red: '#f0666a',
  },
  {
    id: 'monokai', name: 'Monokai', kind: 'dark',
    bg: '#272822', chrome: '#1e1f1c', titleBar: '#1e1f1c', border: '#3b3c35',
    text: '#f8f8f2', textDim: '#9d9b8a',
    accent: '#a6e22e', accentDark: '#7fae23', onAccent: '#1e1f1c', inputBg: '#32332c',
    green: '#a6e22e', yellow: '#e6db74', red: '#f92672',
    canvas: { gripStrokeUnselected: '#1e1f1c', hover: '#66d9ef', target: '#66d9ef' },
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', kind: 'dark',
    bg: '#002b36', chrome: '#073642', titleBar: '#00212b', border: '#0d4a58',
    text: '#93a1a1', textDim: '#657b83',
    accent: '#268bd2', accentDark: '#1e6fa8', onAccent: '#fdf6e3', inputBg: '#073642',
    green: '#859900', yellow: '#b58900', red: '#dc322f',
    canvas: { gridMinor: 'rgba(147,161,161,0.09)', gridMajor: 'rgba(147,161,161,0.22)', gripStrokeUnselected: '#002b36' },
  },
  {
    id: 'tomorrow-night-blue', name: 'Tomorrow Night Blue', kind: 'dark',
    bg: '#002451', chrome: '#00346e', titleBar: '#001c40', border: '#0e4a8e',
    text: '#ffffff', textDim: '#7285b7',
    accent: '#bbdaff', accentDark: '#7aa6da', onAccent: '#002451', inputBg: '#00346e',
    green: '#d1f1a9', yellow: '#ffc58f', red: '#ff9da4',
  },
  {
    id: 'kimbie-dark', name: 'Kimbie Dark', kind: 'dark',
    bg: '#221a0f', chrome: '#362712', titleBar: '#1c1509', border: '#4a3722',
    text: '#d3af86', textDim: '#a57a4c',
    accent: '#f79a32', accentDark: '#c67a22', onAccent: '#221a0f', inputBg: '#362712',
    green: '#889b4a', yellow: '#f79a32', red: '#dc3958',
    canvas: { gridMinor: 'rgba(211,175,134,0.08)', gridMajor: 'rgba(211,175,134,0.2)', gripStrokeUnselected: '#221a0f' },
  },
  {
    id: 'slate', name: 'Slate', kind: 'dark',
    bg: '#1e293b', chrome: '#374151', titleBar: '#1e293b', border: '#334155',
    text: '#cbd5e1', textDim: '#a1a1aa',
    accent: '#60a5fa', accentDark: '#4f46e5', onAccent: '#ffffff', inputBg: '#2d3748',
    green: '#4caf50', yellow: '#f0a030', red: '#e05555',
  },

  // ── Light ───────────────────────────────────────────────────────────────
  {
    id: 'cad-light', name: 'CAD Light', kind: 'light',
    bg: '#ffffff', chrome: '#f1f5f9', titleBar: '#ffffff', border: '#e2e8f0',
    text: '#334155', textDim: '#64748b',
    accent: '#3b82f6', accentDark: '#2f55d4', onAccent: '#ffffff', inputBg: '#ffffff',
    green: '#16a34a', yellow: '#d97706', red: '#dc2626',
  },
  {
    id: 'light-modern', name: 'Light Modern', kind: 'light',
    bg: '#ffffff', chrome: '#f8f8f8', titleBar: '#f8f8f8', border: '#e5e5e5',
    text: '#3b3b3b', textDim: '#767676',
    accent: '#005fb8', accentDark: '#004a92', onAccent: '#ffffff', inputBg: '#ffffff',
    green: '#107c10', yellow: '#bf8803', red: '#c72e0f',
  },
  {
    id: 'solarized-light', name: 'Solarized Light', kind: 'light',
    bg: '#fdf6e3', chrome: '#eee8d5', titleBar: '#eee8d5', border: '#ded8c3',
    text: '#586e75', textDim: '#93a1a1',
    accent: '#268bd2', accentDark: '#1e6fa8', onAccent: '#fdf6e3', inputBg: '#fdf6e3',
    green: '#859900', yellow: '#b58900', red: '#dc322f',
    canvas: { gridMinor: 'rgba(88,110,117,0.10)', gridMajor: 'rgba(88,110,117,0.24)', entityDefault: '#073642' },
  },
  {
    id: 'quiet-light', name: 'Quiet Light', kind: 'light',
    bg: '#f5f5f5', chrome: '#eeeeee', titleBar: '#eeeeee', border: '#dcdcdc',
    text: '#333333', textDim: '#7a7a7a',
    accent: '#705697', accentDark: '#57427a', onAccent: '#ffffff', inputBg: '#ffffff',
    green: '#448c27', yellow: '#a67f59', red: '#ab6526',
  },
];

/** Every theme, expanded and frozen. Picker order. */
export const CAD_THEMES: readonly ICadTheme[] = SEEDS.map((s) => ({
  id: s.id,
  name: s.name,
  kind: s.kind,
  ui: Object.freeze(uiTokens(s)),
  canvas: Object.freeze(buildPalette(s)),
  swatch: Object.freeze([s.bg, s.chrome, s.accent]) as readonly [string, string, string],
}));

/** Theme applied when nothing is stored, per ground. */
export const DEFAULT_THEME_ID: Record<CadThemeKind, string> = {
  dark: 'cad-dark',
  light: 'cad-light',
};

/** Look a theme up by id; `undefined` when the id is unknown (e.g. removed). */
export function findTheme(id: string | null | undefined): ICadTheme | undefined {
  return id ? CAD_THEMES.find((t) => t.id === id) : undefined;
}
