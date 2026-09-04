/**
 * Turns the raw bytes of a DXF file into a string, honouring its declared
 * code page.
 *
 * DXF before R2007 (`$ACADVER` < AC1021) is written in the Windows code page
 * named by `$DWGCODEPAGE`; only R2007+ is UTF-8. Reading every file as UTF-8
 * mangles any byte above 0x7F — a `°` stored as 0xB0 in ANSI_1252 comes out as
 * U+FFFD, so `6°18'44"` reads `6�18'44"`.
 *
 * Strategy: try strict UTF-8 first (a UTF-8 file, or a pure-ASCII one, decodes
 * cleanly); only when that fails fall back to the declared code page. This
 * also copes with exporters that stamp ANSI_1252 on UTF-8 output.
 */

/** `$DWGCODEPAGE` value → WHATWG TextDecoder label. */
const CODEPAGE_LABELS: Record<string, string> = {
  ANSI_1250: 'windows-1250',
  ANSI_1251: 'windows-1251',
  ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254',
  ANSI_1255: 'windows-1255',
  ANSI_1256: 'windows-1256',
  ANSI_1257: 'windows-1257',
  ANSI_1258: 'windows-1258',
  ANSI_874:  'windows-874',
  ANSI_932:  'shift_jis',
  ANSI_936:  'gbk',
  ANSI_949:  'euc-kr',
  ANSI_950:  'big5',
  DOS437:    'ibm437',    // not in every browser; falls through to 1252 below
  DOS850:    'ibm850',
  DOS852:    'ibm852',
  DOS866:    'ibm866',
  ISO8859_1: 'iso-8859-1',
  ISO8859_2: 'iso-8859-2',
  ISO8859_15: 'iso-8859-15',
  MACINTOSH: 'macintosh',
};

/** Reads `$DWGCODEPAGE` (group 3) out of the header, or `null`. */
export function sniffDxfCodePage(headerText: string): string | null {
  const m = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([^\r\n]+)/i.exec(headerText);
  return m ? m[1].trim().toUpperCase() : null;
}

/** Reads `$ACADVER` (group 1) out of the header, e.g. `AC1018`, or `null`. */
export function sniffDxfVersion(headerText: string): string | null {
  const m = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(headerText);
  return m ? m[1] : null;
}

/** The TextDecoder label a DXF's declared code page maps to, or `null` when it is UTF-8. */
export function dxfDecoderLabel(codePage: string | null, version: string | null): string | null {
  // R2007 and later are UTF-8 regardless of what the header says.
  if (version && version >= 'AC1021') return null;
  if (!codePage) return null;
  return CODEPAGE_LABELS[codePage] ?? null;
}

export function decodeDxfBytes(bytes: ArrayBuffer): string {
  // Strict UTF-8 wins whenever it parses — ASCII-only files land here too.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { /* not valid UTF-8: consult the declared code page */ }

  // Only the header is needed to pick a code page; decoding it as latin1 is
  // lossless for the ASCII the variable names are made of.
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 64 * 1024));
  const label = dxfDecoderLabel(sniffDxfCodePage(head), sniffDxfVersion(head)) ?? 'windows-1252';

  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // The browser lacks that encoding — 1252 is the closest thing to a
    // universal legacy default and is never rejected.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
