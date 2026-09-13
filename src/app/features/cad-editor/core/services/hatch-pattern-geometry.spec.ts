import { HATCH_PATTERNS } from '../registries/hatch-patterns';
import { planPatternFamilies, intersectRects, type IFamilyPlan } from './hatch-pattern-geometry';

const XF = { scale: 1, angleDeg: 0, originX: 0, originY: 0 };

function plan(name: string, clip = { x: 0, y: 0, w: 100, h: 100 }, ppu = 4, xf = XF, extra = {}) {
  return planPatternFamilies(HATCH_PATTERNS[name].lines, xf, { clip, pixelsPerUnit: ppu, ...extra });
}

/** Distance of a point outside a rect (0 when inside). */
function outside(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

function period(p: IFamilyPlan): number {
  return p.dash!.reduce((s, v) => s + v, 0);
}

describe('planPatternFamilies', () => {
  it('ANSI31 fills a 100×100 square with continuous 45° lines 3.175 apart', () => {
    const [fam] = plan('ANSI31');
    expect(fam.mode).toBe('lines');
    expect(fam.dash).toBeNull();
    expect(fam.spacing).toBeCloseTo(3.175, 6);
    // Perpendicular extent of the square along the 45° normal is 100·√2.
    const expected = (100 * Math.SQRT2) / 3.175;
    expect(fam.segments.length).toBeGreaterThanOrEqual(Math.floor(expected));
    expect(fam.segments.length).toBeLessThanOrEqual(Math.ceil(expected) + 4);
    for (const s of fam.segments) {
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI;
      expect(Math.abs(((ang % 180) + 180) % 180 - 45)).toBeLessThan(1e-6);
      expect(outside({ x: s.x1, y: s.y1 }, { x: 0, y: 0, w: 100, h: 100 })).toBeLessThan(1e-6);
      expect(outside({ x: s.x2, y: s.y2 }, { x: 0, y: 0, w: 100, h: 100 })).toBeLessThan(1e-6);
    }
  });

  it('anchors every dashed line on a period boundary of its own base point', () => {
    // BRICK family 2: vertical joints every 12.7, dash 6.35 / gap 6.35, base (0,0).
    const [, joints] = plan('BRICK');
    expect(joints.dash).toEqual([6.35, 6.35]);
    expect(joints.dashOffset).toBe(0);
    for (const s of joints.segments) {
      // Vertical line: x is a multiple of 12.7 (the family spacing) …
      expect(Math.abs(s.x1 / 12.7 - Math.round(s.x1 / 12.7))).toBeLessThan(1e-6);
      // … and the segment starts at a multiple of the 12.7 dash period in y.
      expect(Math.abs(s.y1 / 12.7 - Math.round(s.y1 / 12.7))).toBeLessThan(1e-6);
      expect(s.y1).toBeLessThanOrEqual(0 + 1e-9);
    }
  });

  it('rotates a sequence that begins with a gap and shifts the phase to match', () => {
    // BRICK family 3 is `[-6.35, 6.35]` at x0 = 6.35: gap first. The renderer
    // must see a dash-first array and start 6.35 into it.
    const [, , offsetJoints] = plan('BRICK');
    expect(offsetJoints.dash).toEqual([6.35, 6.35]);
    expect(offsetJoints.dashOffset).toBeCloseTo(6.35, 9);
    for (const s of offsetJoints.segments) {
      const k = (s.x1 - 6.35) / 12.7;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
  });

  it('staggers rows through dx (AR-B816 running bond)', () => {
    // Family 2: angle 90, dx = dy = 203.2, dash [203.2, -203.2]. Each successive
    // vertical joint line is shifted 203.2 along its length, so the segment
    // start (a period boundary from that line's base) alternates 0 / 203.2 mod 406.4.
    const [, joints] = plan('AR-B816', { x: 0, y: 0, w: 2000, h: 2000 }, 0.5);
    const byX = new Map<number, number>();
    for (const s of joints.segments) byX.set(Math.round(s.x1 / 203.2), s.y1);
    const cols = [...byX.keys()].sort((a, b) => a - b);
    expect(cols.length).toBeGreaterThan(4);
    for (let i = 1; i < cols.length; i++) {
      const a = byX.get(cols[i - 1])!, b = byX.get(cols[i])!;
      const diff = Math.abs(((a - b) % 406.4 + 406.4) % 406.4);
      // Adjacent columns differ by exactly half a period (203.2), never 0.
      expect(Math.min(diff, 406.4 - diff)).toBeCloseTo(203.2, 6);
    }
  });

  it('flags dot sequences so the renderer can use round caps', () => {
    const sand = plan('AR-SAND', { x: 0, y: 0, w: 1000, h: 1000 }, 1);
    expect(sand.length).toBe(4);
    for (const fam of sand) {
      expect(fam.mode).toBe('lines');
      expect(fam.hasDots).toBeTrue();
      expect(fam.coverage).toBeLessThan(0.2);
    }
    expect(plan('ANSI31')[0].hasDots).toBeFalse();
  });

  it('collapses a family to a translucent fill when its lines are closer than a pixel', () => {
    const [fam] = plan('ANSI31', { x: 0, y: 0, w: 10000, h: 8000 }, 0.1); // 0.3175 px spacing
    expect(fam.mode).toBe('fill');
    expect(fam.segments.length).toBe(0);
    expect(fam.fillAlpha).toBeGreaterThan(0.5);
    expect(fam.fillAlpha).toBeLessThanOrEqual(0.85);
  });

  it('draws sub-pixel dashes as a lightened continuous line rather than dashing', () => {
    // EARTH dashes are 6.35 mm; at 0.1 px/mm the period is 1.27 px.
    const fams = plan('EARTH', { x: 0, y: 0, w: 200, h: 200 }, 0.1, XF, { minSpacingPx: 0 });
    expect(fams.length).toBeGreaterThan(0);
    for (const fam of fams) {
      expect(fam.mode).toBe('lines');
      expect(fam.dash).toBeNull();
      expect(fam.fillAlpha).toBeLessThan(1);
      expect(fam.fillAlpha).toBeCloseTo(0.5, 6);
    }
  });

  it('keeps the segment estimate under budget on a 10 m room with a dotted pattern', () => {
    const t0 = performance.now();
    const fams = plan('AR-SAND', { x: 0, y: 0, w: 10000, h: 8000 }, 0.12, XF, { segmentBudget: 200_000 });
    const elapsed = performance.now() - t0;
    const total = fams.reduce((s, f) => s + f.estimatedSegments, 0);
    expect(total).toBeLessThanOrEqual(200_000);
    const drawn = fams.filter((f) => f.mode === 'lines');
    expect(drawn.length).toBeGreaterThan(0); // the sparse families survive as lines
    expect(elapsed).toBeLessThan(100);
  });

  it('never emits a segment further than one dash period outside the clip', () => {
    const clip = { x: 250, y: 130, w: 300, h: 220 };
    for (const name of ['BRICK', 'EARTH', 'AR-SAND', 'GRAVEL', 'HEX', 'ANSI33']) {
      for (const fam of plan(name, clip, 2)) {
        const slack = fam.dash ? period(fam) : 1e-6;
        for (const s of fam.segments) {
          expect(outside({ x: s.x1, y: s.y1 }, clip)).toBeLessThanOrEqual(slack + 1e-6);
          expect(outside({ x: s.x2, y: s.y2 }, clip)).toBeLessThanOrEqual(1e-6);
        }
      }
    }
  });

  it('applies hatch scale, angle and origin to base point, spacing and dashes', () => {
    const [fam] = plan('BRICK', { x: 0, y: 0, w: 400, h: 400 }, 2, { scale: 2, angleDeg: 90, originX: 10, originY: 20 });
    // Horizontal courses rotated 90° become vertical lines 12.7 apart, through x = 10 + k·12.7.
    expect(fam.spacing).toBeCloseTo(12.7, 9);
    for (const s of fam.segments) {
      expect(Math.abs(s.x1 - s.x2)).toBeLessThan(1e-9);
      const k = (s.x1 - 10) / 12.7;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
    const [, joints] = plan('BRICK', { x: 0, y: 0, w: 400, h: 400 }, 2, { scale: 2, angleDeg: 0, originX: 0, originY: 0 });
    expect(joints.dash).toEqual([12.7, 12.7]);
  });

  it('returns nothing for an empty clip and a single line for a zero-spacing family', () => {
    expect(plan('ANSI31', { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
    const one = planPatternFamilies(
      [{ angle: 0, x0: 0, y0: 50, dx: 0, dy: 0, dashArray: [] }], XF, { clip: { x: 0, y: 0, w: 100, h: 100 }, pixelsPerUnit: 1 },
    );
    expect(one.length).toBe(1);
    expect(one[0].segments.length).toBe(1);
    expect(one[0].segments[0].y1).toBeCloseTo(50, 9);
  });
});

describe('intersectRects', () => {
  it('returns the overlap, the first rect when the second is absent, and null when disjoint', () => {
    expect(intersectRects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: -5, w: 10, h: 10 })).toEqual({ x: 5, y: 0, w: 5, h: 5 });
    expect(intersectRects({ x: 1, y: 2, w: 3, h: 4 }, null)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(intersectRects({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 })).toBeNull();
  });
});
