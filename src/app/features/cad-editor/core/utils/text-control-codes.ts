/**
 * AutoCAD text control codes.
 *
 * Two unrelated encodings share this file because a single entity can carry
 * both:
 *
 *  - `%%` codes — the original TEXT/ATTDEF escapes (`%%U`, `%%D`, `%%C`, `%%P`).
 *  - MTEXT inline codes — the backslash language (`\P`, `\C7;`, `\pxqr;`,
 *    `\H0.7x;`, `\L`, `{}` grouping…).
 *
 * Both used to reach the canvas untouched, so drawings rendered literal
 * `%%UHALF ELEVATION` and `\pxqr;TO DAHODE JN.` instead of an underlined
 * heading and a right-aligned label.
 *
 * ## Why this flattens
 *
 * `TextLayoutEngine` measures one font, one height and one set of decorations
 * per entity — `ITextLineLayout` has nowhere to hang a per-run style. So these
 * decoders return plain text plus a single uniform style, which is what
 * `TextEntity` can actually represent. Callers keep the original coded string
 * for round-trip; nothing here is destructive to the source.
 */

/** Uniform style recovered from a coded string, alongside its plain text. */
export interface IDecodedText {
  /** Display text, codes removed, `\P` turned into `\n`. */
  text: string;
  /** Any part of the source was underlined (`%%U` / `\L`). */
  underline: boolean;
  /** Any part of the source was overlined (`%%O` / `\O`). */
  overline: boolean;
  /** Any part of the source was struck through (`\K`). */
  strikethrough: boolean;
}

/** MTEXT adds properties that have no `%%` equivalent. */
export interface IDecodedMtext extends IDecodedText {
  /** Relative height multiplier from `\H<n>x;`, when the whole string shares one. */
  heightFactor: number | null;
  /** Font family requested by `\f`/`\F`, raw (still a font *name*, not CSS). */
  font: string | null;
  /** Paragraph alignment from `\pxq<l|c|r|j>;`. */
  alignment: 'left' | 'center' | 'right' | 'justify' | null;
}

/** Unicode superscripts, for flattening a stacked fraction with no denominator. */
const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻',
};

/* -------------------------------------------------------------------------- */
/* %% codes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Decodes the `%%` escapes used by TEXT, ATTDEF and dimension text overrides.
 *
 * `%%U` and `%%O` are *toggles* in AutoCAD. Since a `TextEntity` carries one
 * underline flag for the whole entity, an odd number of toggles is reported as
 * "on" — which is the common real-world case, a heading prefixed with `%%U`.
 *
 * @example decodeTextCodes('%%UHALF ELEVATION')
 *   // → { text: 'HALF ELEVATION', underline: true, ... }
 */
export function decodeTextCodes(raw: string): IDecodedText {
  const out: IDecodedText = { text: '', underline: false, overline: false, strikethrough: false };
  if (!raw) return out;

  // `\U+XXXX` is AutoCAD's Unicode escape (R2007+ writes non-codepage glyphs
  // this way — `\U+0394` is Δ). `\M+nXXXX` is the legacy multibyte form; it
  // cannot be mapped without the bigfont, so it is dropped rather than shown.
  raw = raw
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\M\+[1-5][0-9A-Fa-f]{4}/g, '');

  let underlineCount = 0;
  let overlineCount = 0;
  let text = '';

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '%' || raw[i + 1] !== '%') {
      text += raw[i];
      continue;
    }
    const marker = raw[i + 2];
    if (marker === undefined) { text += raw[i]; continue; }

    switch (marker.toUpperCase()) {
      case 'U': underlineCount++; i += 2; continue;
      case 'O': overlineCount++; i += 2; continue;
      case 'D': text += '°'; i += 2; continue; // degree
      case 'C': text += 'Ø'; i += 2; continue; // diameter
      case 'P': text += '±'; i += 2; continue; // plus/minus
      case '%': text += '%';      i += 2; continue; // literal percent
      default: break;
    }

    // %%nnn — a three-digit character code.
    const digits = raw.slice(i + 2, i + 5);
    if (/^\d{3}$/.test(digits)) {
      text += String.fromCharCode(parseInt(digits, 10));
      i += 4;
      continue;
    }
    text += raw[i];
  }

  out.text = text;
  out.underline = underlineCount % 2 === 1;
  out.overline = overlineCount % 2 === 1;
  return out;
}

/* -------------------------------------------------------------------------- */
/* MTEXT inline codes                                                          */
/* -------------------------------------------------------------------------- */

/** Codes shaped `\X<params>;` — consumed up to the terminating semicolon. */
const TERMINATED_CODES = 'ACcFfHQTWp';
/** Codes that are a bare letter with no parameters. */
const TOGGLE_CODES = 'LlOoKk';
/**
 * Every letter AutoCAD actually assigns a meaning to.
 *
 * Deliberately exhaustive: a backslash followed by anything *outside* this set
 * is not a code, so it stays as literal text. Dropping it instead would quietly
 * corrupt ordinary content — `C:\Drawings\file` would lose its `D`.
 */
const KNOWN_CODE_LETTERS = new Set([
  ...TERMINATED_CODES, ...TOGGLE_CODES, 'P', 'S', 'X', 'N',
]);

/**
 * Decodes MTEXT inline formatting to plain text plus one uniform style.
 *
 * Handles everything this codebase has encountered in the wild: `\P` newlines,
 * `{}` grouping, escaped `\\ \{ \}`, the `\L \l \O \o \K \k` toggles, and the
 * terminated codes `\A; \C; \c; \H; \W; \Q; \T; \f; \F; \p;` plus `\S` stacking
 * and `\~` non-breaking space.
 *
 * Unknown codes are dropped rather than printed, matching AutoCAD — but only
 * when they actually look like codes, so stray backslashes survive as text.
 *
 * @example decodeMtext('\\pxql;TO INDORE JN.\\P{\\C7;TIRILA STN.}')
 *   // → { text: 'TO INDORE JN.\nTIRILA STN.', alignment: 'left', ... }
 */
export function decodeMtext(raw: string): IDecodedMtext {
  const out: IDecodedMtext = {
    text: '',
    underline: false,
    overline: false,
    strikethrough: false,
    heightFactor: null,
    font: null,
    alignment: null,
  };
  if (!raw) return out;

  let text = '';
  let i = 0;

  // Caret notation: `^I` is a tab and `^J` a line break inside MTEXT. Left as
  // is, the notes column of a drawing reads "2.^IPROPOSED WORK".
  raw = raw.replace(/\^I/g, '\t').replace(/\^J/g, '\n');

  while (i < raw.length) {
    const ch = raw[i];

    // Grouping braces carry scope in AutoCAD; with a uniform style they are noise.
    if (ch === '{' || ch === '}') { i++; continue; }

    if (ch !== '\\') { text += ch; i++; continue; }

    const code = raw[i + 1];
    if (code === undefined) { text += ch; i++; break; }

    // Escaped literals.
    if (code === '\\' || code === '{' || code === '}') { text += code; i += 2; continue; }
    // \X only reaches here when the caller did not split on it first (see
    // splitDimensionText); as a plain MTEXT code it is a paragraph break.
    if (code === 'P' || code === 'X') { text += '\n'; i += 2; continue; }
    if (code === '~') { text += '\u00A0'; i += 2; continue; }

    if (TOGGLE_CODES.includes(code)) {
      if (code === 'L') out.underline = true;
      else if (code === 'O') out.overline = true;
      else if (code === 'K') out.strikethrough = true;
      i += 2;
      continue;
    }

    // Stacked text: \S<numerator><^|/|#><denominator>;
    if (code === 'S') {
      const end = raw.indexOf(';', i + 2);
      const body = end < 0 ? raw.slice(i + 2) : raw.slice(i + 2, end);
      text += flattenStack(body);
      i = end < 0 ? raw.length : end + 1;
      continue;
    }

    if (TERMINATED_CODES.includes(code)) {
      const end = raw.indexOf(';', i + 2);
      if (end < 0) {
        // Unterminated: not a real code, keep the backslash as literal text.
        text += ch;
        i++;
        continue;
      }
      const body = raw.slice(i + 2, end);
      // `leading` is true while no visible text has been emitted yet. A code
      // that opens the string governs the whole entity and can be flattened
      // onto it; the same code appearing mid-string governs only the run that
      // follows, which a single uniform style cannot express — so it is
      // consumed and dropped rather than applied to everything.
      applyMtextCode(out, code, body, text.length === 0);
      i = end + 1;
      continue;
    }

    // A recognised letter with no handler above is a code we do not model —
    // drop it. Anything else is not a code at all, so the backslash is literal.
    if (KNOWN_CODE_LETTERS.has(code)) { i += 2; continue; }
    text += ch;
    i++;
  }

  out.text = text;
  return out;
}

/**
 * Applies one terminated MTEXT code to the accumulated uniform style.
 *
 * @param leading whether the code appears before any visible text. Size and
 *   font only carry over to the entity when they do; mid-string they scope to
 *   a run this flattening cannot represent.
 */
function applyMtextCode(out: IDecodedMtext, code: string, body: string, leading: boolean): void {
  switch (code) {
    case 'H': {
      // \H2.5;  → absolute height (ignored: the entity already carries one)
      // \H0.7x; → relative multiplier, which we can honour.
      if (!leading) break;
      const rel = /^([\d.]+)x$/i.exec(body.trim());
      if (rel) {
        const v = Number(rel[1]);
        if (Number.isFinite(v) && v > 0) out.heightFactor = v;
      }
      break;
    }
    case 'f':
    case 'F': {
      // \fArial|b0|i0|c0|p34;  → the family is everything before the first pipe.
      if (!leading) break;
      const family = body.split('|')[0].trim();
      if (family) out.font = family;
      break;
    }
    case 'p': {
      // Paragraph properties, comma-separated; alignment is `q<l|c|r|j>`.
      const q = /(?:^|,|;)\s*x?q([lcrjd])/i.exec(body);
      if (q) {
        const map: Record<string, IDecodedMtext['alignment']> = {
          l: 'left', c: 'center', r: 'right', j: 'justify', d: null,
        };
        out.alignment = map[q[1].toLowerCase()] ?? null;
      }
      break;
    }
    // \A (vertical align), \C / \c (colour), \W (width), \Q (oblique),
    // \T (tracking) carry no uniform-style equivalent worth flattening —
    // consuming them is the whole point, so they simply vanish.
    default:
      break;
  }
}

/** Renders `\S` stacked text as a single line. */
function flattenStack(body: string): string {
  const sep = /[\^/#]/.exec(body);
  if (!sep) return body.trim();
  const at = body.indexOf(sep[0]);
  const upper = body.slice(0, at).trim();
  const lower = body.slice(at + 1).trim();

  if (!lower) {
    // Raised text with nothing beneath it — e.g. `\S2^ ;` for a squared unit.
    const sup = [...upper].map((c) => SUPERSCRIPTS[c]);
    return sup.every(Boolean) ? sup.join('') : upper;
  }
  if (!upper) return lower;
  return `${upper}/${lower}`;
}

/* -------------------------------------------------------------------------- */
/* Shared splitters                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Splits text into lines on MTEXT's `\P` or a literal newline.
 *
 * The canonical implementation — the layout engine, both leader classes and the
 * inline editor overlay all route here rather than repeating the regex.
 */
export function splitTextLines(text: string): string[] {
  return (text || '').split(/\\P|\n/);
}

/**
 * Splits dimension text on `\X`.
 *
 * `\X` is a layout instruction, not formatting: the part before it sits above
 * the dimension line and the part after sits below. `<>\X(BERM)` reads as
 * `3000` over `(BERM)`.
 *
 * @returns `[above, below]`, where `below` is `null` when there is no `\X`.
 */
export function splitDimensionText(text: string): [string, string | null] {
  if (!text) return ['', null];
  const at = text.indexOf('\\X');
  if (at < 0) return [text, null];
  return [text.slice(0, at), text.slice(at + 2)];
}
