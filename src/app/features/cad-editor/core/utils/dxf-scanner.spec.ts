import { scanDimStyleOverrides, scanDxfTables, scanRawDxfObjects } from './dxf-scanner';

/** Builds a DXF fragment from code/value pairs. */
function dxf(...pairs: Array<[string | number, string | number]>): string {
  return pairs.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
}

const TABLES_FIXTURE = dxf(
  [0, 'SECTION'], [2, 'TABLES'],

  [0, 'TABLE'], [2, 'STYLE'], [70, 2],
  [0, 'STYLE'], [5, '7D'], [2, 'TIMES NEW ROMAN'], [70, 0], [40, 20.0],
  [41, 1.0], [50, 0.0], [71, 0], [3, 'times.ttf'], [4, ''],
  [0, 'STYLE'], [5, '80'], [2, 'Ecsl 150'], [70, 0], [40, 0.0],
  [41, 0.85], [50, 15.0], [71, 0], [3, 'arial.ttf'], [4, ''],
  [0, 'ENDTAB'],

  [0, 'TABLE'], [2, 'DIMSTYLE'], [70, 1],
  [0, 'DIMSTYLE'], [105, '93'], [2, 'ECSL_150'], [70, 0],
  [40, 150.0],   // DIMSCALE
  [41, 2.5],     // DIMASZ
  [42, 1.5],     // DIMEXO
  [44, 1.5],     // DIMEXE
  [140, 2.5],    // DIMTXT
  [147, 0.9],    // DIMGAP
  [271, 0],      // DIMDEC
  [278, 46],     // DIMDSEP '.'
  [77, 1],       // DIMTAD
  [340, '80'],   // DIMTXSTY -> the "Ecsl 150" style above
  [0, 'ENDTAB'],

  [0, 'TABLE'], [2, 'LAYER'], [70, 2],
  [0, 'LAYER'], [2, 'ECSL_DIM'], [70, 0], [62, 10], [6, 'Continuous'], [370, 25],
  [0, 'LAYER'], [2, 'HIDDEN'], [70, 1], [62, -3], [6, 'DASHED'], [370, 9],
  [0, 'ENDTAB'],

  [0, 'ENDSEC'],
);

describe('scanDxfTables', () => {
  const tables = scanDxfTables(TABLES_FIXTURE);

  it('reads the STYLE table dxf-parser does not expose', () => {
    const times = tables.textStyles.get('TIMES NEW ROMAN');
    expect(times).toBeTruthy();
    expect(times!.font).toBe('times.ttf');
    expect(times!.fixedHeight).toBe(20);
    expect(times!.handle).toBe('7D');
  });

  it('reads per-style width factor and oblique angle', () => {
    const s = tables.textStyles.get('Ecsl 150')!;
    expect(s.widthFactor).toBe(0.85);
    expect(s.obliqueAngle).toBe(15);
  });

  it('maps DIMSTYLE variables onto DimensionStyle field names', () => {
    const ds = tables.dimStyles.get('ECSL_150')!;
    expect(ds.globalScale).toBe(150);   // DIMSCALE
    expect(ds.arrowSize).toBe(2.5);     // DIMASZ
    expect(ds.textHeight).toBe(2.5);    // DIMTXT
    expect(ds.textOffset).toBe(0.9);    // DIMGAP
    expect(ds.extensionGap).toBe(1.5);  // DIMEXO
    expect(ds.extensionPast).toBe(1.5); // DIMEXE
    expect(ds.textAbove).toBe(1);       // DIMTAD
  });

  it('reads DIMDEC, the variable behind imported dimensions showing 4 decimals', () => {
    expect(tables.dimStyles.get('ECSL_150')!.unitPrecision).toBe(0);
  });

  it('resolves DIMTXSTY from its handle to a style name', () => {
    expect(tables.dimStyles.get('ECSL_150')!.textStyleName).toBe('Ecsl 150');
  });

  it('does not mistake the table entry flags (group 70) for DIMTOL', () => {
    expect((tables.dimStyles.get('ECSL_150') as any).unitFormat).toBeUndefined();
  });

  it('reads layer lineweight and linetype, which dxf-parser drops', () => {
    expect(tables.layers.get('ECSL_DIM')!.lineWeight).toBe(25);
    expect(tables.layers.get('HIDDEN')!.lineType).toBe('DASHED');
  });

  it('reads a negative colour as a layer that is switched off', () => {
    const hidden = tables.layers.get('HIDDEN')!;
    expect(hidden.visible).toBe(false);
    expect(hidden.colorIndex).toBe(3);
    expect(hidden.frozen).toBe(true);
  });
});

describe('scanDimStyleOverrides', () => {
  const ENTITIES_FIXTURE = dxf(
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'DIMENSION'], [5, '1877'], [8, 'ECSL_DIM'], [2, '*D3'], [3, 'ECSL_150'],
    [1001, 'ACAD'], [1000, 'DSTYLE'], [1002, '{'],
    [1070, 144], [1040, 150.0],   // DIMLFAC
    [1070, 40], [1040, 1.0],      // DIMSCALE
    [1070, 77], [1070, 3],        // DIMTAD
    [1002, '}'],
    [0, 'DIMENSION'], [5, '1A41'], [8, 'ECSL_DIM'], [2, '*D24'],
    // No XDATA at all.
    [0, 'LINE'], [5, 'ABC'], [8, '0'],
    [0, 'ENDSEC'],
  );

  const overrides = scanDimStyleOverrides(scanRawDxfObjects(ENTITIES_FIXTURE));

  it('recovers DIMLFAC, which dxf-parser discards with the rest of XDATA', () => {
    // Without this, a span drawn 68.5333 units long labels itself 68.5333
    // where AutoCAD shows 10280.
    expect(overrides.get('1877')!.linearFactor).toBe(150);
  });

  it('recovers the DIMSCALE override that keeps visuals at their true size', () => {
    expect(overrides.get('1877')!.globalScale).toBe(1);
  });

  it('reads integer-valued variables as well as reals', () => {
    expect(overrides.get('1877')!.textAbove).toBe(3);
  });

  it('reports nothing for a dimension with no overrides', () => {
    expect(overrides.has('1A41')).toBe(false);
  });

  it('ignores non-DIMENSION entities', () => {
    expect(overrides.has('ABC')).toBe(false);
  });
});
