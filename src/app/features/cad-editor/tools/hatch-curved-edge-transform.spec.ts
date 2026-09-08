import { HatchEntity } from '../core/models/entity-extended.model';
import { dxfEdgeLoopToFrozen, frozenLoopToPolygon } from '../core/models/hatch-boundary.model';
import { translateEntitiesInPlace, rotateEntityInPlace } from './geometry-utils';

/**
 * A curved hatch edge carries a centre and angles as well as its endpoints.
 * Transforms used to move the endpoints and leave the centre in place, so after
 * the import's centring shift every arc-edged loop swept across the sheet.
 */
describe('frozen hatch curved-edge transforms', () => {
  // A thin curved band: two lines and two concentric arcs, r 75 and 78.
  const edges = () => [
    { type: 'LINE', start: { x: 196.13, y: 378.66 }, end: { x: 192.48, y: 378.66 } },
    { type: 'ARC', center: { x: 131.38, y: 334.98 }, radius: 75.11, startAngle: 324.45 * Math.PI / 180, endAngle: 359.99 * Math.PI / 180, isCcw: false },
    { type: 'LINE', start: { x: 206.48, y: 335.0 }, end: { x: 209.5, y: 335.0 } },
    { type: 'ARC', center: { x: 131.49, y: 335.0 }, radius: 78.0, startAngle: 0, endAngle: 34.04 * Math.PI / 180, isCcw: true },
  ];

  function bandHatch(): HatchEntity {
    const h = new HatchEntity([edges()], 'GRAVEL', 1, 0, false);
    (h as any).boundarySpec = { loops: [{ frozen: dxfEdgeLoopToFrozen(edges()) }] };
    return h;
  }

  function bbox(h: HatchEntity) {
    const pts = frozenLoopToPolygon((h as any).boundarySpec.loops[0].frozen, 24);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }

  it('starts as a thin band', () => {
    const b = bbox(bandHatch());
    expect(b.maxX - b.minX).toBeLessThan(20);
    expect(b.maxY - b.minY).toBeLessThan(45);
  });

  it('keeps the band thin after a translation', () => {
    const h = bandHatch();
    translateEntitiesInPlace([h], -500, -700);
    const b = bbox(h);
    expect(b.maxX - b.minX).toBeLessThan(20);
    expect(b.maxY - b.minY).toBeLessThan(45);
    expect(b.minX).toBeCloseTo(192.48 - 500, 0);
    // The arc centre moved with its endpoints.
    const arc = (h as any).boundarySpec.loops[0].frozen.find((e: any) => e.kind === 'ARC');
    expect(arc.center.x).toBeCloseTo(131.38 - 500, 1);
  });

  it('keeps the band thin after a rotation', () => {
    const h = bandHatch();
    rotateEntityInPlace(h, 200, 350, Math.PI / 3);
    const b = bbox(h);
    // A 17×44 band rotated 60° fits in a ~45×45 box; a broken one spans hundreds.
    expect(b.maxX - b.minX).toBeLessThan(60);
    expect(b.maxY - b.minY).toBeLessThan(60);
  });
});
