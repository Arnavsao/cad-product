import { isFlippedNormal, isWcsNormal, ocsAxes, ocsToWcs } from './ocs';

describe('OCS → WCS (Arbitrary Axis Algorithm)', () => {
  const FLIPPED = { x: 0, y: 0, z: -1 };

  it('treats a missing or +Z normal as WCS', () => {
    expect(isWcsNormal(null)).toBe(true);
    expect(isWcsNormal({ x: 0, y: 0, z: 1 })).toBe(true);
    expect(isWcsNormal(FLIPPED)).toBe(false);
    expect(ocsToWcs({ x: 3, y: 4 }, { x: 0, y: 0, z: 1 })).toEqual({ x: 3, y: 4 });
  });

  it('recognises the mirrored plane AutoCAD writes', () => {
    expect(isFlippedNormal(FLIPPED)).toBe(true);
    expect(isFlippedNormal({ x: 0, y: 0, z: 1 })).toBe(false);
    // The file under test stores tiny x/y noise on the normal; still flipped.
    expect(isFlippedNormal({ x: -4.16e-18, y: 1.22e-16, z: -1 })).toBe(true);
  });

  it('derives Ax = Wy × N = -X and Ay = +Y for the flipped normal', () => {
    const { ax, ay } = ocsAxes(FLIPPED);
    expect(ax.x).toBeCloseTo(-1, 12); expect(ax.y).toBeCloseTo(0, 12);
    expect(ay.x).toBeCloseTo(0, 12); expect(ay.y).toBeCloseTo(1, 12);
  });

  it('mirrors x and keeps y for the flipped normal', () => {
    // The GL MARK insert stored at OCS (-404.58, 472.67) sits at WCS (+404.58, 472.67),
    // inside the 841-wide sheet rather than 400 units left of it.
    const w = ocsToWcs({ x: -404.5766874667004, y: 472.6736138716024 }, FLIPPED);
    expect(w.x).toBeCloseTo(404.5766874667004, 9);
    expect(w.y).toBeCloseTo(472.6736138716024, 9);
  });

  it('returns a fresh object, never the input', () => {
    const p = { x: 1, y: 2 };
    expect(ocsToWcs(p, null)).not.toBe(p);
  });

  it('builds an orthonormal frame for a tilted normal', () => {
    const { ax, ay, az } = ocsAxes({ x: 0.3, y: 0.4, z: 0.866 });
    const dot = (a: any, b: any) => a.x * b.x + a.y * b.y + a.z * b.z;
    expect(dot(ax, ay)).toBeCloseTo(0, 12);
    expect(dot(ax, az)).toBeCloseTo(0, 12);
    expect(dot(ay, az)).toBeCloseTo(0, 12);
    expect(Math.hypot(ax.x, ax.y, ax.z)).toBeCloseTo(1, 12);
    expect(Math.hypot(ay.x, ay.y, ay.z)).toBeCloseTo(1, 12);
  });
});
