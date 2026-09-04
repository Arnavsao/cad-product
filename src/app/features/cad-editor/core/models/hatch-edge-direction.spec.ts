import { dxfEdgeLoopToFrozen, frozenLoopToPolygon } from './hatch-boundary.model';

/**
 * AutoCAD stores the angles of a *clockwise* hatch edge mirrored. Read at face
 * value, a 63° sliver on a north-arrow sweeps the remaining 297° and fills the
 * whole symbol as a blob.
 */
describe('hatch boundary edge direction', () => {
  it('mirrors the angles of a clockwise arc edge', () => {
    const [ccw] = dxfEdgeLoopToFrozen([{ type: 'ARC', center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: Math.PI / 2, isCcw: true }]);
    const [cw] = dxfEdgeLoopToFrozen([{ type: 'ARC', center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: Math.PI / 2, isCcw: false }]);
    expect(ccw.a1).toBeCloseTo(Math.PI / 2);
    expect(cw.a1).toBeCloseTo(-Math.PI / 2);
    // Both are quarter arcs, not a quarter and three-quarters.
    const span = (e: any) => frozenLoopToPolygon([e], 8).length;
    expect(span(cw)).toBe(span(ccw));
  });

  it('converts ellipse-edge true angles to parametric angles', () => {
    // rx 7.5, ry 3: a point at true angle 117.3° sits at parameter ~101.7°.
    const [e] = dxfEdgeLoopToFrozen([{
      type: 'ELLIPSE', center: { x: 0, y: 0 }, majorAxisEndPoint: { x: 7.5, y: 0 }, axisRatio: 0.4,
      startAngle: 0, endAngle: 117.3 * Math.PI / 180, isCcw: true,
    }]);
    expect((e.a1 ?? 0) * 180 / Math.PI).toBeCloseTo(101.7, 0);
    // Its end point is where the true angle says it is.
    expect(Math.atan2(e.p1.y, e.p1.x) * 180 / Math.PI).toBeCloseTo(117.3, 0);
  });

  it('keeps a full-circle ellipse edge whole', () => {
    const [e] = dxfEdgeLoopToFrozen([{
      type: 'ELLIPSE', center: { x: 0, y: 0 }, majorAxisEndPoint: { x: 2, y: 0 }, axisRatio: 0.5,
      startAngle: 0, endAngle: Math.PI * 2, isCcw: true,
    }]);
    expect(Math.abs((e.a1 ?? 0) - (e.a0 ?? 0))).toBeCloseTo(Math.PI * 2);
  });
});
