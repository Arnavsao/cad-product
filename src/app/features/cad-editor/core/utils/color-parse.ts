import { DXF_ACI_COLORS } from '../registries/aci-colors';

/**
 * What kind of input the user supplied. Lets callers decide whether to also
 * update related fields (e.g. when an ACI index is entered, store the index
 * alongside the resolved hex so DXF export round-trips the symbolic value).
 */
export type ColorInputSource = 'hex' | 'rgb' | 'aci' | 'named' | 'bylayer' | 'byblock';

export interface IParsedColor {
  /** Canonical `#rrggbb` lowercase form. */
  hex: string;
  /** Original input kind. */
  source: ColorInputSource;
  /** ACI index when `source === 'aci'`. */
  aciIndex?: number;
}

/**
 * A small set of CSS-named colors we accept in the picker. Keep this list
 * focused on the colours engineers actually type — we are NOT trying to
 * reproduce the entire CSS3 named-color table.
 */
const NAMED_COLORS: Record<string, string> = {
  red:     '#ff0000',
  green:   '#00ff00',
  blue:    '#0000ff',
  yellow:  '#ffff00',
  cyan:    '#00ffff',
  magenta: '#ff00ff',
  white:   '#ffffff',
  black:   '#000000',
  gray:    '#808080',
  grey:    '#808080',
  orange:  '#ffa500',
  purple:  '#800080',
  pink:    '#ffc0cb',
  brown:   '#a52a2a',
  bylayer: '__BYLAYER__', // sentinel; caller resolves to layer color
  byblock: '__BYBLOCK__',
};

/**
 * Parse any color string a user might type in a picker. Returns a canonical
 * representation, or `null` if the input is unrecognised.
 *
 * Accepted formats:
 *   - `#rgb` / `#rrggbb`                                       → hex
 *   - `rgb(255, 0, 0)` / `rgba(...)` (alpha ignored)           → rgb
 *   - `255,0,0` / `255 0 0` / `255  0   0`                     → rgb
 *   - integer in range 1..256                                  → AutoCAD ACI index
 *   - any key from NAMED_COLORS (case-insensitive)             → named
 *   - `bylayer` / `byblock` (case-insensitive)                 → marker
 *
 * Empty / whitespace inputs return null so the caller can leave the field
 * unchanged. Negative or fractional numbers are NOT treated as ACI indices
 * (they may parse as part of a partial rgb input — let the user finish
 * typing).
 */
export function parseColorInput(input: string): IParsedColor | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  // Named — check first so 'red' beats any future int-parsing edge.
  const named = NAMED_COLORS[raw.toLowerCase()];
  if (named) {
    if (named === '__BYLAYER__') return { hex: '#000000', source: 'bylayer' };
    if (named === '__BYBLOCK__') return { hex: '#000000', source: 'byblock' };
    return { hex: named, source: 'named' };
  }

  // #rgb or #rrggbb (with optional leading #)
  const hex = parseHex(raw);
  if (hex) return { hex, source: 'hex' };

  // rgb(...) / rgba(...) / `r, g, b`
  const rgb = parseRgb(raw);
  if (rgb) return { hex: rgbToHex(rgb), source: 'rgb' };

  // AutoCAD index (1..256). Accept only after the rgb-list check above so
  // `255,0,0` doesn't get misread as the integer 255.
  if (/^\d{1,3}$/.test(raw)) {
    const idx = parseInt(raw, 10);
    if (idx >= 1 && idx < DXF_ACI_COLORS.length) {
      return { hex: DXF_ACI_COLORS[idx], source: 'aci', aciIndex: idx };
    }
    // 256 = ByLayer in AutoCAD convention.
    if (idx === 256) return { hex: '#000000', source: 'bylayer', aciIndex: 256 };
    // 0 = ByBlock.
    if (idx === 0) return { hex: '#000000', source: 'byblock', aciIndex: 0 };
  }

  return null;
}

function parseHex(s: string): string | null {
  const m6 = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m6) return '#' + m6[1].toLowerCase();
  const m3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) {
    const r = m3[1], g = m3[2], b = m3[3];
    return ('#' + r + r + g + g + b + b).toLowerCase();
  }
  return null;
}

function parseRgb(s: string): [number, number, number] | null {
  // rgb(255, 0, 0) / rgba(255, 0, 0, 0.5)
  const fn = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i.exec(s);
  if (fn) {
    return clampRgb([+fn[1], +fn[2], +fn[3]]);
  }
  // Bare comma/space separated: "255, 0, 0" or "255 0 0"
  const bare = /^(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})$/.exec(s);
  if (bare) {
    return clampRgb([+bare[1], +bare[2], +bare[3]]);
  }
  return null;
}

function clampRgb([r, g, b]: number[]): [number, number, number] | null {
  if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return null;
  return [Math.round(r), Math.round(g), Math.round(b)];
}

export function rgbToHex(rgb: [number, number, number]): string {
  const [r, g, b] = rgb;
  return '#' + toHex2(r) + toHex2(g) + toHex2(b);
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function toHex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/** Quick-swatch colors shown at the top of the picker. Order matches
 *  AutoCAD's standard 7-color toolbar (1..7), with Black added last. */
export const QUICK_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Red',     hex: '#ff0000' },
  { name: 'Yellow',  hex: '#ffff00' },
  { name: 'Green',   hex: '#00ff00' },
  { name: 'Cyan',    hex: '#00ffff' },
  { name: 'Blue',    hex: '#0000ff' },
  { name: 'Magenta', hex: '#ff00ff' },
  { name: 'White',   hex: '#ffffff' },
  { name: 'Black',   hex: '#000000' },
];
