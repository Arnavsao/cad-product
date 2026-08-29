import { Injectable } from '@angular/core';

/**
 * Maps AutoCAD SHX font names to web-safe equivalents.
 *
 * SHX fonts are vector-based fonts specific to AutoCAD. Since browsers cannot
 * render SHX natively, we map common engineering fonts to the closest available
 * web fonts. This service centralises the mapping so DXF import, text rendering,
 * and the editor all resolve fonts consistently.
 *
 * ## Mapping Philosophy
 *
 * - Mono-stroke SHX fonts (romans, simplex, txt) map to clean sans-serif
 *   typefaces that approximate their proportional metrics.
 * - Gothic/complex SHX fonts map to slightly heavier serif/sans-serif equivalents.
 * - Unknown SHX names fall back to Arial (the AutoCAD TrueType default).
 */
@Injectable({ providedIn: 'root' })
export class FontResolverService {
  /**
   * SHX → web font mapping table.
   * Keys are normalised (lowercase, no extension).
   */
  private static readonly SHX_MAP: Record<string, string> = {
    // ── Simplex (mono-stroke, sans-serif feel) ──────────────────
    'simplex':      'Arial',
    'simplex.shx':  'Arial',
    'txt':          'Consolas, "Courier New", monospace',
    'txt.shx':      'Consolas, "Courier New", monospace',
    'monotxt':      'Consolas, "Courier New", monospace',
    'monotxt.shx':  'Consolas, "Courier New", monospace',

    // ── Roman (proportional serif feel) ─────────────────────────
    'romans':       '"Times New Roman", Georgia, serif',
    'romans.shx':   '"Times New Roman", Georgia, serif',
    'romanc':       '"Times New Roman", Georgia, serif',
    'romanc.shx':   '"Times New Roman", Georgia, serif',
    'romand':       '"Times New Roman", Georgia, serif',
    'romand.shx':   '"Times New Roman", Georgia, serif',
    'romant':       '"Times New Roman", Georgia, serif',
    'romant.shx':   '"Times New Roman", Georgia, serif',

    // ── Gothic (sans-serif, heavier weight) ─────────────────────
    'gothice':      'Arial',
    'gothice.shx':  'Arial',
    'gothicg':      'Arial',
    'gothicg.shx':  'Arial',
    'gothici':      'Arial',
    'gothici.shx':  'Arial',

    // ── Script / cursive ────────────────────────────────────────
    'scripts':      '"Segoe Script", "Comic Sans MS", cursive',
    'scripts.shx':  '"Segoe Script", "Comic Sans MS", cursive',
    'scriptc':      '"Segoe Script", "Comic Sans MS", cursive',
    'scriptc.shx':  '"Segoe Script", "Comic Sans MS", cursive',

    // ── Complex (detailed engineering) ──────────────────────────
    'complex':      'Arial',
    'complex.shx':  'Arial',

    // ── Italic variants ─────────────────────────────────────────
    'italict':      'Arial',
    'italict.shx':  'Arial',
    'italicc':      'Arial',
    'italicc.shx':  'Arial',

    // ── ISO standard ────────────────────────────────────────────
    'isocp':        'Arial',
    'isocp.shx':    'Arial',
    'isocp2':       'Arial',
    'isocp2.shx':   'Arial',
    'isocp3':       'Arial',
    'isocp3.shx':   'Arial',
    'isocpeur':     'Arial',
    'isocpeur.shx': 'Arial',
    'isoct':        'Arial',
    'isoct.shx':    'Arial',
    'isoct2':       'Arial',
    'isoct2.shx':   'Arial',
    'isoct3':       'Arial',
    'isoct3.shx':   'Arial',
    'isocteur':     'Arial',
    'isocteur.shx': 'Arial',

    // ── CJK / special ──────────────────────────────────────────
    'gbcbig':       '"Microsoft YaHei", "SimHei", sans-serif',
    'gbcbig.shx':   '"Microsoft YaHei", "SimHei", sans-serif',
    'bigfont':      '"Microsoft YaHei", "SimHei", sans-serif',
    'bigfont.shx':  '"Microsoft YaHei", "SimHei", sans-serif',
  };

  /** Default fallback when no SHX mapping exists. */
  private static readonly FALLBACK = 'Arial';

  /**
   * Resolve a font name from a DXF style or entity to a CSS font-family string.
   *
   * Handles:
   *  - SHX names with or without `.shx` extension
   *  - TrueType font names passed through unchanged
   *  - Null / undefined → fallback
   */
  static resolve(fontName: string | null | undefined): string {
    if (!fontName) return FontResolverService.FALLBACK;

    const key = fontName.trim().toLowerCase();

    // Direct SHX lookup
    const mapped = FontResolverService.SHX_MAP[key];
    if (mapped) return mapped;

    // Try without .shx extension
    const withoutExt = key.replace(/\.shx$/i, '');
    const mappedNoExt = FontResolverService.SHX_MAP[withoutExt];
    if (mappedNoExt) return mappedNoExt;

    // If it looks like an SHX name (contains .shx) but isn't in our map,
    // fall back to Arial rather than passing a non-existent font family.
    if (key.endsWith('.shx')) return FontResolverService.FALLBACK;

    // Otherwise assume it's a TrueType font name and pass through.
    return fontName;
  }
}
