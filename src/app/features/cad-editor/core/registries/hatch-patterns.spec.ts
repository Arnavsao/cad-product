import {
  HATCH_PATTERNS,
  dxfOffsetToPattern,
  patternOffsetToDxf,
  patternLinesFromDxf,
  patternLinesToDxf,
  resolveHatchPattern,
} from './hatch-patterns';

/**
 * Pins the registry to acadiso.pat. The values below are AutoCAD's, in
 * millimetres; if one of these fails the pattern no longer matches what
 * AutoCAD draws for the same name.
 */
describe('HATCH_PATTERNS (acadiso.pat parity)', () => {
  it('ANSI31 is one 45° family 3.175 mm apart', () => {
    expect(HATCH_PATTERNS['ANSI31'].lines).toEqual([
      { angle: 45, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
    ]);
  });

  it('ANSI32 is two 45° families 9.525 apart, the second shifted 4.49 along', () => {
    const [a, b] = HATCH_PATTERNS['ANSI32'].lines;
    expect(a.dy).toBeCloseTo(9.525, 6);
    expect(b.dy).toBeCloseTo(9.525, 6);
    expect(a.x0).toBe(0);
    expect(b.x0).toBeCloseTo(4.490128, 5);
  });

  it('ANSI37 is the 45°/135° crosshatch, not a single direction', () => {
    const angles = HATCH_PATTERNS['ANSI37'].lines.map((l) => l.angle).sort((a, b) => a - b);
    expect(angles).toEqual([45, 135]);
    for (const l of HATCH_PATTERNS['ANSI37'].lines) expect(l.dy).toBeCloseTo(3.175, 6);
  });

  it('BRICK is 12.7 × 6.35 running bond with the second joint row phase-inverted', () => {
    const [courses, joints, offsetJoints] = HATCH_PATTERNS['BRICK'].lines;
    expect(courses).toEqual({ angle: 0, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [] });
    expect(joints.angle).toBe(90);
    expect(joints.dy).toBeCloseTo(12.7, 6);
    expect(joints.dashArray).toEqual([6.35, -6.35]);
    expect(offsetJoints.x0).toBeCloseTo(6.35, 6);
    expect(offsetJoints.dashArray).toEqual([-6.35, 6.35]);
  });

  it('ANGLE, HEX and HONEY carry AutoCAD dash lengths', () => {
    expect(HATCH_PATTERNS['ANGLE'].lines[0].dashArray).toEqual([10.16, -3.81]);
    expect(HATCH_PATTERNS['ANGLE'].lines[0].dy).toBeCloseTo(13.97, 6);
    expect(HATCH_PATTERNS['HEX'].lines.length).toBe(3);
    for (const l of HATCH_PATTERNS['HEX'].lines) expect(l.dashArray).toEqual([3.175, -6.35]);
    expect(HATCH_PATTERNS['HONEY'].lines.length).toBe(3);
  });

  it('AR-SAND is four dot families and AR-CONC / GRAVEL are line definitions, not renderer specials', () => {
    const sand = HATCH_PATTERNS['AR-SAND'].lines;
    expect(sand.length).toBe(4);
    for (const l of sand) expect(l.dashArray.filter((d) => d === 0).length).toBe(3);
    expect(HATCH_PATTERNS['AR-CONC'].lines.length).toBe(13);
    expect(HATCH_PATTERNS['GRAVEL'].lines.length).toBe(41);
  });

  it('keeps the CADO legacy names as aliases of the canonical definitions', () => {
    expect(HATCH_PATTERNS['ANSI30'].lines).toBe(HATCH_PATTERNS['ANSI37'].lines);
    expect(HATCH_PATTERNS['SAND'].lines).toBe(HATCH_PATTERNS['AR-SAND'].lines);
    expect(HATCH_PATTERNS['SOLID'].lines).toEqual([]);
  });

  it('resolves underscore spellings and returns null for unknown names', () => {
    expect(resolveHatchPattern('AR_SAND')).toBe(HATCH_PATTERNS['AR-SAND']);
    expect(resolveHatchPattern('AR-B816')).toBe(HATCH_PATTERNS['AR-B816']);
    expect(resolveHatchPattern('NOPE')).toBeNull();
    expect(resolveHatchPattern(undefined)).toBeNull();
  });
});

describe('DXF offset conversion', () => {
  it('turns acadiso ANSI31 vector (-2.245, 2.245) at 45° into (0 along, 3.175 perpendicular)', () => {
    const { dx, dy } = dxfOffsetToPattern(45, -2.2450640303, 2.2450640303);
    expect(dx).toBeCloseTo(0, 9);
    expect(dy).toBeCloseTo(3.175, 9);
  });

  it('round-trips through patternOffsetToDxf for every registry line', () => {
    for (const pat of Object.values(HATCH_PATTERNS)) {
      for (const l of pat.lines) {
        const v = patternOffsetToDxf(l.angle, l.dx, l.dy);
        const back = dxfOffsetToPattern(l.angle, v.x, v.y);
        expect(back.dx).toBeCloseTo(l.dx, 9);
        expect(back.dy).toBeCloseTo(l.dy, 9);
      }
    }
  });

  it('patternLinesFromDxf undoes the scale, angle and vector encoding AutoCAD writes', () => {
    // BRICK at scale 25, angle 30, origin (100, 50) as AutoCAD would store it …
    const dxf = patternLinesToDxf(HATCH_PATTERNS['BRICK'].lines, 25, 30, 100, 50);
    // … carries the final geometry: 30° courses, 158.75 mm dashes on the joints.
    expect(dxf[0].angle).toBe(30);
    expect(dxf[1].dashArray).toEqual([158.75, -158.75]);
    expect(dxf[0].x0).toBeCloseTo(100, 9);
    expect(dxf[0].y0).toBeCloseTo(50, 9);
    // The offset is a vector: the 6.35 course spacing rotated to 30° + 90°.
    expect(Math.hypot(dxf[0].dx, dxf[0].dy)).toBeCloseTo(6.35 * 25, 9);
    expect(Math.atan2(dxf[0].dy, dxf[0].dx) * 180 / Math.PI).toBeCloseTo(120, 9);

    // Reading it back (without the origin, which DXF does not separate out)
    // gives the registry definition again.
    const back = patternLinesFromDxf(patternLinesToDxf(HATCH_PATTERNS['BRICK'].lines, 25, 30), 25, 30);
    for (let i = 0; i < back.length; i++) {
      const want = HATCH_PATTERNS['BRICK'].lines[i];
      expect(back[i].angle).toBeCloseTo(want.angle, 9);
      expect(back[i].x0).toBeCloseTo(want.x0, 9);
      expect(back[i].y0).toBeCloseTo(want.y0, 9);
      expect(back[i].dx).toBeCloseTo(want.dx, 9);
      expect(back[i].dy).toBeCloseTo(want.dy, 9);
      back[i].dashArray.forEach((d, k) => expect(d).toBeCloseTo(want.dashArray[k], 9));
    }
  });

  it('reads the reference drawing\'s ANSI31 line as 3.175 mm spacing once un-scaled', () => {
    // From the bridge GA DXF in /public: 53=45, 45=-0.0449012806, 46=0.0449012806, 41=0.02.
    const [l] = patternLinesFromDxf(
      [{ angle: 45, x0: -2506.9, y0: -6272.2, dx: -0.0449012806053458, dy: 0.0449012806053458, dashArray: [] }],
      0.02, 0,
    );
    expect(l.dx).toBeCloseTo(0, 6);
    expect(l.dy).toBeCloseTo(3.175, 4);
  });
});
