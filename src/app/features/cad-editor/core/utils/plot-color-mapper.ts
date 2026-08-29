/**
 * PlotColorMapper — converts STORED CAD colors into PLOT colors for PDF/PNG
 * export. Independent of the editor theme; driven entirely by IPlotOptions.
 *
 * Architecture:
 *   Entity Color (stored)  →  PlotColorMapper  →  Plot Color
 *
 * Three plot styles match the AutoCAD .ctb conventions:
 *   - 'color'       — preserve named colors; flip ambiguous defaults
 *                      (#ffffff / ACI 7 / #000000) so they print on the chosen
 *                      paper background. Red stays red, blue stays blue.
 *   - 'monochrome'  — every entity becomes black (or white on dark paper).
 *                      Equivalent to AutoCAD's monochrome.ctb.
 *   - 'grayscale'   — every entity becomes its luminance gray.
 *                      Equivalent to AutoCAD's grayscale.ctb.
 *
 * No display logic, no theme logic, no DXF logic. Pure stored → plot mapping.
 */

export type PlotStyle = 'color' | 'monochrome' | 'grayscale';

export interface IPlotMapOptions {
  style: PlotStyle;
  /** True when plotting onto a light (white/transparent) paper background.
   *  Drives the ambiguous-default direction: white→black on light paper. */
  lightBg: boolean;
}

/** Parse `#rgb` / `#rrggbb` (case-insensitive) into 0-255 components. Returns
 *  null when the value isn't a recognizable hex string. */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  let v = hex.trim().toLowerCase();
  if (v.startsWith('#')) v = v.slice(1);
  if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
  if (v.length !== 6 || !/^[0-9a-f]{6}$/.test(v)) return null;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

function isWhite(stored: string): boolean {
  const lc = (stored || '').toLowerCase();
  return lc === '#ffffff' || lc === '#fff';
}

function isBlack(stored: string): boolean {
  const lc = (stored || '').toLowerCase();
  return lc === '#000000' || lc === '#000';
}

/**
 * Rec. 709 luminance — standard CRT/HDTV weighting used by AutoCAD's
 * grayscale.ctb. Produces perceptually balanced grays.
 */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Map a stored CAD color → plot color for the given plot style + background.
 * Pure function. Never mutates the source. Always returns a valid 6-char hex.
 */
export function mapColorForPlot(stored: string, opts: IPlotMapOptions): string {
  const ink = opts.lightBg ? '#000000' : '#ffffff';

  if (opts.style === 'monochrome') {
    return ink;
  }

  const rgb = parseHex(stored);

  if (opts.style === 'grayscale') {
    if (!rgb) return ink;
    // White/black defaults still flip to whichever ink matches the paper —
    // otherwise true white on white paper would vanish.
    if (isWhite(stored) || isBlack(stored)) return ink;
    const lum = luminance(rgb.r, rgb.g, rgb.b);
    // On light paper, cap upper brightness so very light colors stay visible.
    // On dark paper, raise lower brightness so very dark colors stay visible.
    const clamped = opts.lightBg ? Math.min(lum, 220) : Math.max(lum, 35);
    return toHex(clamped, clamped, clamped);
  }

  // 'color' — preserve named colors; only ambiguous defaults flip.
  if (isWhite(stored) || isBlack(stored)) return ink;
  return stored;
}
