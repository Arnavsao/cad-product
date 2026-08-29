/**
 * ThemeColorMapper — converts STORED CAD colors into DISPLAY colors based on
 * the canvas brightness behind them, without mutating entity data.
 *
 * Architecture:
 *   Entity Color (stored)  →  ThemeColorMapper  →  Rendered Color
 *
 * The mapper only swaps the two ambiguous defaults (#ffffff ↔ #000000) that
 * become invisible against a same-colored background. Every other color
 * (named hex, ACI 1-6, ACI 8+, RGB) passes through untouched so engineering
 * intent is preserved in both themes.
 *
 *   Stored white on dark canvas  → display white
 *   Stored white on light canvas → display black
 *   Stored black on dark canvas  → display white
 *   Stored black on light canvas → display black
 *   Stored cyan on either canvas → display cyan (no change)
 *
 * Consumers MUST pass through this utility at PAINT time, not at write time.
 * No entity field is ever overwritten by the mapper.
 */

import { isLightTheme } from '../services/theme.service';

/** Brightness of the surface a color will be painted on. */
export type CanvasBrightness = 'light' | 'dark';

export interface IDisplayMapOptions {
  /** True when the canvas behind the paint is light (white/near-white). */
  lightCanvas: boolean;
}

/**
 * Map a stored CAD color to its display color for the given canvas
 * brightness. Black/white defaults swap so neither becomes invisible;
 * all other colors pass through unchanged.
 */
export function mapColorForDisplay(stored: string, opts: IDisplayMapOptions): string {
  if (!stored) return opts.lightCanvas ? '#000000' : '#ffffff';
  const lc = stored.toLowerCase();
  const isWhite = lc === '#ffffff' || lc === '#fff';
  const isBlack = lc === '#000000' || lc === '#000';
  if (isWhite || isBlack) {
    return opts.lightCanvas ? '#000000' : '#ffffff';
  }
  return stored;
}

/**
 * Doc-like shape used to detect editor brightness. Plot/export brightness is
 * handled separately by PlotColorMapper — DO NOT add export flags here.
 */
export interface ICanvasBrightnessHint {
  /** Legacy print-mode flag (still respected as a forced light hint). */
  isPrintMode?: boolean;
}

/** Resolve the effective EDITOR canvas brightness. Exporters should not
 *  read this — they have their own bg semantics in IPlotOptions. */
export function canvasIsLight(doc?: ICanvasBrightnessHint | null): boolean {
  if (doc?.isPrintMode) return true;
  return isLightTheme();
}

/** Stored color → editor display color, picking brightness from the theme. */
export function displayColor(stored: string, doc?: ICanvasBrightnessHint | null): string {
  return mapColorForDisplay(stored, { lightCanvas: canvasIsLight(doc) });
}
