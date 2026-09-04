import {
  decodeMtext,
  decodeTextCodes,
  splitDimensionText,
  splitTextLines,
} from './text-control-codes';

describe('decodeTextCodes (%% escapes)', () => {
  it('strips %%U and reports the underline', () => {
    // Real string from RTM-S&C-GAD-BR-NO.384; it used to render with the code
    // visible instead of an underlined heading.
    const r = decodeTextCodes('%%UHALF ELEVATION');
    expect(r.text).toBe('HALF ELEVATION');
    expect(r.underline).toBe(true);
  });

  it('treats %%U as a toggle, so a matched pair leaves it off', () => {
    const r = decodeTextCodes('A%%UB%%UC');
    expect(r.text).toBe('ABC');
    expect(r.underline).toBe(false);
  });

  it('maps the symbol escapes', () => {
    expect(decodeTextCodes('30%%D').text).toBe('30°');
    expect(decodeTextCodes('%%C50').text).toBe('Ø50');
    expect(decodeTextCodes('%%P0.5').text).toBe('±0.5');
    expect(decodeTextCodes('100%%%').text).toBe('100%');
  });

  it('decodes %%nnn character codes', () => {
    expect(decodeTextCodes('%%176').text).toBe('°');
  });

  it('decodes \\U+XXXX unicode escapes and drops \\M+ multibyte ones', () => {
    expect(decodeTextCodes('\\U+0394 : 6°').text).toBe('Δ : 6°');
    expect(decodeTextCodes('a\\M+1A1B2b').text).toBe('ab');
  });

  it('leaves ordinary text untouched', () => {
    expect(decodeTextCodes('R.L : 523.510m').text).toBe('R.L : 523.510m');
  });
});

describe('decodeMtext (backslash codes)', () => {
  it('strips paragraph alignment and splits on \\P', () => {
    const r = decodeMtext('\\pxqr;TO DAHODE JN.\\PAMJHERA STN.');
    expect(r.text).toBe('TO DAHODE JN.\nAMJHERA STN.');
    expect(r.alignment).toBe('right');
  });

  it('strips colour codes and grouping braces', () => {
    const r = decodeMtext('\\pxql;TO INDORE JN.\\P{\\C7;TIRILA STN.}');
    expect(r.text).toBe('TO INDORE JN.\nTIRILA STN.');
  });

  it('strips the vertical-alignment code used inside *D blocks', () => {
    expect(decodeMtext('\\A1;1676').text).toBe('1676');
    expect(decodeMtext('\\A1;(OVERALL SLAB LENGTH)').text).toBe('(OVERALL SLAB LENGTH)');
  });

  it('reports underline from \\L', () => {
    const r = decodeMtext('\\LUnderlined\\l plain');
    expect(r.text).toBe('Underlined plain');
    expect(r.underline).toBe(true);
  });

  it('reads a relative height factor that opens the string', () => {
    expect(decodeMtext('\\H0.7x;small').heightFactor).toBe(0.7);
  });

  it('ignores a height factor that appears mid-string', () => {
    // It scopes to the run after it; applying it to the whole entity would
    // resize text the code never touched.
    expect(decodeMtext('normal \\H0.7x;small').heightFactor).toBeNull();
  });

  it('reads a font family and drops its style flags', () => {
    expect(decodeMtext('\\fArial|b1|i0|c0|p34;bold').font).toBe('Arial');
  });

  it('ignores a font switch that appears mid-string', () => {
    expect(decodeMtext('plain \\fArial|b1;bold').font).toBeNull();
  });

  it('flattens stacked text', () => {
    expect(decodeMtext('m\\S2^ ;').text).toBe('m²');
    expect(decodeMtext('\\S1/2;').text).toBe('1/2');
  });

  it('honours escaped literals', () => {
    expect(decodeMtext('a\\\\b').text).toBe('a\\b');
    expect(decodeMtext('\\{literal\\}').text).toBe('{literal}');
  });

  it('keeps a backslash that is not a control code', () => {
    // Dropping unknown escapes would quietly eat the D from "Drawings".
    expect(decodeMtext('C:\\Drawings\\file').text).toBe('C:\\Drawings\\file');
  });

  it('turns caret tabs and newlines into whitespace', () => {
    expect(decodeMtext('2.^IPROPOSED WORK').text).toBe('2.\tPROPOSED WORK');
    expect(decodeMtext('a^Jb').text).toBe('a\nb');
  });

  it('returns empty output for empty input', () => {
    expect(decodeMtext('').text).toBe('');
  });
});

describe('splitDimensionText', () => {
  it('splits on \\X into above and below the dimension line', () => {
    expect(splitDimensionText('10280\\X(OVERALL SLAB LENGTH)'))
      .toEqual(['10280', '(OVERALL SLAB LENGTH)']);
    expect(splitDimensionText('25\\XGAP')).toEqual(['25', 'GAP']);
  });

  it('preserves whitespace either side of the split', () => {
    expect(splitDimensionText('9150 \\XCLEAR SPAN')).toEqual(['9150 ', 'CLEAR SPAN']);
  });

  it('reports no second line when there is no \\X', () => {
    expect(splitDimensionText('20mm GAP')).toEqual(['20mm GAP', null]);
  });
});

describe('splitTextLines', () => {
  it('splits on \\P and on real newlines', () => {
    expect(splitTextLines('a\\Pb\nc')).toEqual(['a', 'b', 'c']);
  });
});
