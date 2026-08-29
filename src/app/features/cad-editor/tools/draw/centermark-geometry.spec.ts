import { buildCenterMarkSegments } from './centermark-geometry';

describe('buildCenterMarkSegments', () => {
  it('builds a central cross and four extension arms', () => {
    const result = buildCenterMarkSegments({ cx: 10, cy: 20, r: 10 });

    expect(result.length).toBe(6);
    expect(result[0]).toEqual({ x1: 8.8, y1: 20, x2: 11.2, y2: 20 });
    expect(result[1]).toEqual({ x1: 10, y1: 18.8, x2: 10, y2: 21.2 });
    expect(result[2]).toEqual({ x1: -1, y1: 20, x2: 8.2, y2: 20 });
    expect(result[3]).toEqual({ x1: 11.8, y1: 20, x2: 21, y2: 20 });
  });

  it('returns no geometry for an invalid radius', () => {
    expect(buildCenterMarkSegments({ cx: 0, cy: 0, r: 0 })).toEqual([]);
    expect(buildCenterMarkSegments({ cx: 0, cy: 0, r: -2 })).toEqual([]);
  });
});
