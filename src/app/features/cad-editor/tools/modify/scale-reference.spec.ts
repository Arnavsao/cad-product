import type { Entity } from '../../core/models/entity.model';
import { scaleReferenceDistance, scaleFactorFor } from './scale-reference';

/** Minimal stand-in: SCALE only ever reads `bbox()` off its targets. */
const boxed = (x: number, y: number, w: number, h: number) =>
  ({ bbox: () => ({ x, y, w, h }) }) as unknown as Entity;

describe('scaleReferenceDistance', () => {
  it('is the distance to the farthest bbox corner', () => {
    // 30×40 box with the base point on its bottom-left corner → far corner is the 3-4-5 diagonal.
    expect(scaleReferenceDistance([boxed(0, 0, 30, 40)], 0, 0)).toBeCloseTo(50, 9);
  });

  it('spans the whole selection, not just the first entity', () => {
    const near = boxed(0, 0, 10, 10);
    const far = boxed(100, 0, 10, 10);
    expect(scaleReferenceDistance([near, far], 0, 0)).toBeCloseTo(Math.hypot(110, 10), 9);
  });

  it('falls back to one drawing unit for a degenerate selection', () => {
    expect(scaleReferenceDistance([], 5, 5)).toBe(1);
    expect(scaleReferenceDistance([boxed(7, 7, 0, 0)], 7, 7)).toBe(1);
    expect(scaleReferenceDistance([{} as Entity], 0, 0)).toBe(1);
  });

  it('ignores entities that have no bbox', () => {
    expect(scaleReferenceDistance([{} as Entity, boxed(0, 0, 3, 4)], 0, 0)).toBeCloseTo(5, 9);
  });
});

describe('scaleFactorFor', () => {
  it('is 1.0 when the cursor sits on the selection corner', () => {
    const ref = scaleReferenceDistance([boxed(0, 0, 30, 40)], 0, 0);
    expect(scaleFactorFor(ref, ref)).toBeCloseTo(1, 9);
  });

  it('doubles at twice the reference distance and halves at half', () => {
    const ref = scaleReferenceDistance([boxed(0, 0, 30, 40)], 0, 0);
    expect(scaleFactorFor(ref * 2, ref)).toBeCloseTo(2, 9);
    expect(scaleFactorFor(ref / 2, ref)).toBeCloseTo(0.5, 9);
  });

  it('gives the same factor whatever the drawing is measured in', () => {
    // The same shape drawn in mm and in m: dragging to the matching point must
    // scale identically. The old fixed 100-unit reference failed exactly here.
    const mm = scaleReferenceDistance([boxed(0, 0, 3000, 4000)], 0, 0);
    const m = scaleReferenceDistance([boxed(0, 0, 3, 4)], 0, 0);
    expect(scaleFactorFor(mm * 1.5, mm)).toBeCloseTo(scaleFactorFor(m * 1.5, m), 9);
    expect(scaleFactorFor(mm * 1.5, mm)).toBeCloseTo(1.5, 9);
  });

  it('clamps instead of collapsing to zero at the base point', () => {
    expect(scaleFactorFor(0, 50)).toBe(0.001);
  });
});
