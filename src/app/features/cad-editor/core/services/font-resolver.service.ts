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
    'simplex':      'Arial, Helvetica, sans-serif',
    'simplex.shx':  'Arial, Helvetica, sans-serif',
    'txt':          'Consolas, "Courier New", monospace',
    'txt.shx':      'Consolas, "Courier New", monospace',
    'monotxt':      'Consolas, "Courier New", monospace',
    'monotxt.shx':  'Consolas, "Courier New", monospace',

    // ── Roman. romans (Roman Simplex) is a single-stroke sans face;
    // romanc/romand/romant (complex/duplex/triplex) carry serifs. ────
    'romans':       'Arial, Helvetica, sans-serif',
    'romans.shx':   'Arial, Helvetica, sans-serif',
    'romanc':       '"Times New Roman", Georgia, serif',
    'romanc.shx':   '"Times New Roman", Georgia, serif',
    'romand':       '"Times New Roman", Georgia, serif',
    'romand.shx':   '"Times New Roman", Georgia, serif',
    'romant':       '"Times New Roman", Georgia, serif',
    'romant.shx':   '"Times New Roman", Georgia, serif',

    // ── Gothic (sans-serif, heavier weight) ─────────────────────
    'gothice':      'Arial, Helvetica, sans-serif',
    'gothice.shx':  'Arial, Helvetica, sans-serif',
    'gothicg':      'Arial, Helvetica, sans-serif',
    'gothicg.shx':  'Arial, Helvetica, sans-serif',
    'gothici':      'Arial, Helvetica, sans-serif',
    'gothici.shx':  'Arial, Helvetica, sans-serif',

    // ── Script / cursive ────────────────────────────────────────
    'scripts':      '"Segoe Script", "Comic Sans MS", cursive',
    'scripts.shx':  '"Segoe Script", "Comic Sans MS", cursive',
    'scriptc':      '"Segoe Script", "Comic Sans MS", cursive',
    'scriptc.shx':  '"Segoe Script", "Comic Sans MS", cursive',

    // ── Complex (detailed engineering) ──────────────────────────
    'complex':      'Arial, Helvetica, sans-serif',
    'complex.shx':  'Arial, Helvetica, sans-serif',

    // ── Italic variants ─────────────────────────────────────────
    'italict':      'Arial, Helvetica, sans-serif',
    'italict.shx':  'Arial, Helvetica, sans-serif',
    'italicc':      'Arial, Helvetica, sans-serif',
    'italicc.shx':  'Arial, Helvetica, sans-serif',

    // ── ISO standard ────────────────────────────────────────────
    'isocp':        'Arial, Helvetica, sans-serif',
    'isocp.shx':    'Arial, Helvetica, sans-serif',
    'isocp2':       'Arial, Helvetica, sans-serif',
    'isocp2.shx':   'Arial, Helvetica, sans-serif',
    'isocp3':       'Arial, Helvetica, sans-serif',
    'isocp3.shx':   'Arial, Helvetica, sans-serif',
    'isocpeur':     'Arial, Helvetica, sans-serif',
    'isocpeur.shx': 'Arial, Helvetica, sans-serif',
    'isoct':        'Arial, Helvetica, sans-serif',
    'isoct.shx':    'Arial, Helvetica, sans-serif',
    'isoct2':       'Arial, Helvetica, sans-serif',
    'isoct2.shx':   'Arial, Helvetica, sans-serif',
    'isoct3':       'Arial, Helvetica, sans-serif',
    'isoct3.shx':   'Arial, Helvetica, sans-serif',
    'isocteur':     'Arial, Helvetica, sans-serif',
    'isocteur.shx': 'Arial, Helvetica, sans-serif',

    // ── CJK / special ──────────────────────────────────────────
    'gbcbig':       '"Microsoft YaHei", "PingFang SC", SimHei, sans-serif',
    'gbcbig.shx':   '"Microsoft YaHei", "PingFang SC", SimHei, sans-serif',
    'bigfont':      '"Microsoft YaHei", "PingFang SC", SimHei, sans-serif',
    'bigfont.shx':  '"Microsoft YaHei", "PingFang SC", SimHei, sans-serif',
  };

  /**
   * TrueType **file name** → CSS family stack.
   *
   * The STYLE table stores a filename (group 3), not a family: `times.ttf`, not
   * `Times New Roman`. Passing the filename through produces
   * `ctx.font = '12px times.ttf'`, which is an unparseable shorthand — the
   * canvas ignores the whole assignment and silently keeps whatever font was
   * set last, so text renders in an arbitrary face at an arbitrary size and the
   * layout cache stores those wrong metrics under a correct-looking key.
   *
   * Keys are normalised (lower case, extension stripped).
   */
  private static readonly TTF_MAP: Record<string, string> = {
    'arial':          'Arial, Helvetica, sans-serif',
    'arialbd':        'Arial, Helvetica, sans-serif',
    'ariali':         'Arial, Helvetica, sans-serif',
    'arialn':         '"Arial Narrow", Arial, Helvetica, sans-serif',
    'arialnb':        '"Arial Narrow", Arial, Helvetica, sans-serif',
    'ariblk':         '"Arial Black", Arial, sans-serif',
    'times':          '"Times New Roman", Times, Georgia, serif',
    'timesbd':        '"Times New Roman", Times, Georgia, serif',
    'timesi':         '"Times New Roman", Times, Georgia, serif',
    'cour':           '"Courier New", Courier, monospace',
    'couri':          '"Courier New", Courier, monospace',
    'consola':        'Consolas, "Courier New", monospace',
    'verdana':        'Verdana, Geneva, sans-serif',
    'tahoma':         'Tahoma, Geneva, sans-serif',
    'georgia':        'Georgia, "Times New Roman", serif',
    'calibri':        'Calibri, Candara, Arial, sans-serif',
    'cambria':        'Cambria, Georgia, serif',
    'segoeui':        '"Segoe UI", system-ui, sans-serif',
    'trebuc':         '"Trebuchet MS", Tahoma, sans-serif',
    'impact':         'Impact, Haettenschweiler, sans-serif',
    'comic':          '"Comic Sans MS", cursive',
    'romantic':       '"Times New Roman", Times, Georgia, serif',
    'simsun':         'SimSun, "Songti SC", serif',
    'simhei':         'SimHei, "Heiti SC", sans-serif',
    'msyh':           '"Microsoft YaHei", "PingFang SC", sans-serif',
  };

  /**
   * Default fallback. A concrete stack ending in a CSS generic, so it resolves
   * on every platform rather than depending on a Windows-only family being
   * present.
   */
  private static readonly FALLBACK = 'Arial, Helvetica, sans-serif';

  /**
   * Resolve a DXF font reference to a CSS font-family string that
   * `ctx.font` will actually accept.
   *
   * Accepts, in order of preference:
   *  - SHX names, with or without the `.shx` extension
   *  - TrueType **file** names (`arial.ttf`, `ARIALN.TTF`, `times.ttf`)
   *  - TrueType **family** names already in CSS form (`Times New Roman`)
   *  - MTEXT `\f` payloads, whose `|b0|i0|c0|p34` suffix is stripped
   *
   * Never returns a bare `.ttf` / `.shx` filename, and never returns a
   * multi-word family unquoted.
   */
  static resolve(fontName: string | null | undefined): string {
    if (!fontName) return FontResolverService.FALLBACK;

    // An MTEXT \f payload carries style flags after the family name.
    const name = fontName.split('|')[0].trim();
    if (!name) return FontResolverService.FALLBACK;

    const key = name.toLowerCase();

    // SHX, with and without the extension.
    const shx = FontResolverService.SHX_MAP[key]
      ?? FontResolverService.SHX_MAP[key.replace(/\.shx$/i, '')];
    if (shx) return shx;

    // TrueType/OpenType by file name.
    const stem = key.replace(/\.(ttf|ttc|otf|fon)$/i, '');
    const ttf = FontResolverService.TTF_MAP[stem];
    if (ttf) return ttf;

    // A font file we have no mapping for: guess a generic from the stem rather
    // than emitting a filename the canvas would reject outright.
    if (key !== stem || key.endsWith('.shx')) {
      return FontResolverService.familyFromUnknownFile(stem);
    }

    // Already a family name — quote it if it needs quoting, and give it a
    // generic to fall back on.
    return FontResolverService.toCssFamily(name);
  }

  /**
   * Last-ditch mapping for an unrecognised font file: infer a serif/mono/script
   * intent from the stem so the drawing at least keeps the right texture.
   */
  private static familyFromUnknownFile(stem: string): string {
    if (/(times|roman|serif|book|garamond|georgia|minion|cambria)/.test(stem)) {
      return '"Times New Roman", Times, Georgia, serif';
    }
    if (/(cour|mono|consol|typewriter)/.test(stem)) {
      return '"Courier New", Courier, monospace';
    }
    if (/(script|brush|hand|comic)/.test(stem)) {
      return '"Segoe Script", "Brush Script MT", cursive';
    }
    return FontResolverService.FALLBACK;
  }

  /** Wraps a family name for CSS and appends a generic fallback. */
  private static toCssFamily(name: string): string {
    // Leave anything that already looks like a stack (commas/quotes) alone.
    if (name.includes(',') || name.includes('"') || name.includes("'")) return name;

    const generic = /(times|roman|serif|georgia|garamond|book)/i.test(name) ? 'serif'
      : /(courier|mono|consol)/i.test(name) ? 'monospace'
      : /(script|brush|hand)/i.test(name) ? 'cursive'
      : 'sans-serif';

    const quoted = /^[A-Za-z][A-Za-z0-9-]*$/.test(name) ? name : `"${name}"`;
    return `${quoted}, ${generic}`;
  }
}
