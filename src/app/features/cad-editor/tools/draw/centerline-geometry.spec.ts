import { buildCenterlineSegment } from './centerline-geometry';

describe('buildCenterlineSegment', () => {
  it('creates a centered, extended line between parallel lines', () => {
    const result = buildCenterlineSegment(
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 0, y1: 4, x2: 10, y2: 4 },
    );

    expect(result).not.toBeNull();
    expect(result!.x1).toBeCloseTo(-1.2, 8);
    expect(result!.y1).toBeCloseTo(2, 8);
    expect(result!.x2).toBeCloseTo(11.2, 8);
    expect(result!.y2).toBeCloseTo(2, 8);
  });

  it('handles source lines drawn in opposite directions', () => {
    const result = buildCenterlineSegment(
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 10, y1: 4, x2: 0, y2: 4 },
      undefined,
      undefined,
      0,
    );

    expect(result).toEqual({ x1: 0, y1: 2, x2: 10, y2: 2 });
  });

  it('creates the picked angle bisector for intersecting lines', () => {
    const result = buildCenterlineSegment(
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 0, y1: 0, x2: 0, y2: 10 },
      { x: 8, y: 0 },
      { x: 0, y: 8 },
      0,
    );

    expect(result).not.toBeNull();
    expect(result!.x1).toBeCloseTo(0, 8);
    expect(result!.y1).toBeCloseTo(0, 8);
    expect(result!.x2).toBeCloseTo(5, 8);
    expect(result!.y2).toBeCloseTo(5, 8);
  });

  it('rejects zero-length source geometry', () => {
    const result = buildCenterlineSegment(
      { x1: 1, y1: 1, x2: 1, y2: 1 },
      { x1: 0, y1: 2, x2: 10, y2: 2 },
    );

    expect(result).toBeNull();
  });
});
