import { DxfImportService } from './dxf-import.service';
import { DxfFile } from '../models/layer.model';
import { HatchEntity, InsertEntity } from '../models/entity-extended.model';
import type { EllipseEntity } from '../models/entity-extended.model';
import type { PolylineEntity } from '../models/entity.model';

/**
 * `createEntity` is the pure heart of the importer — it touches no injected
 * service — so it can be exercised without Angular DI, the same way the
 * headless render harness does.
 */
function importer(): any {
  return Object.create(DxfImportService.prototype);
}

function create(ent: any, rawTags: Array<[number, string]> = []) {
  const file = new DxfFile('ocs.dxf');
  const raw = new Map<string, any>();
  if (ent.handle) raw.set(ent.handle, { originalTags: rawTags.map(([code, value]) => ({ code, value })) });
  return importer().createEntity(ent, file, raw);
}

const FLIPPED = { x: 0, y: 0, z: -1 };

describe('DXF import honours the extrusion normal (OCS)', () => {
  it('mirrors a block reference stored on the (0,0,-1) plane back onto the sheet', () => {
    // GL MARK 42A8 from the bridge GA: AutoCAD's MIRROR left it in the
    // mirrored frame, so the stored x is the negative of where it sits.
    const ins = create({
      type: 'INSERT', name: 'GL MARK', handle: '42A8',
      position: { x: -404.5766874667004, y: 472.6736138716024, z: 0 },
      xScale: 0.0009860967250505, yScale: 0.0009860967250505,
      rotation: 358.0526112474878,
      extrusionDirection: { x: -4.16e-18, y: 1.22e-16, z: -1 },
    }) as InsertEntity;
    expect(ins.x).toBeCloseTo(404.5766874667004, 9);
    expect(ins.y).toBeCloseTo(472.6736138716024, 9);
    expect(ins.sx).toBeCloseTo(-0.0009860967250505, 12);
    expect(ins.sy).toBeCloseTo(0.0009860967250505, 12);
    expect(ins.rotation).toBeCloseTo(-358.0526112474878, 9);
  });

  it('leaves a block reference on the default plane untouched', () => {
    const ins = create({
      type: 'INSERT', name: 'GL', position: { x: 50.6, y: 63.5, z: 0 },
      xScale: 0.015, yScale: 0.015, extrusionDirection: { x: 0, y: 0, z: 1 },
    }) as InsertEntity;
    expect(ins.x).toBe(50.6);
    expect(ins.sx).toBe(0.015);
    expect(ins.rotation).toBe(0);
  });

  it('mirrors polyline vertices and reverses their bulges', () => {
    const pl = create({
      type: 'LWPOLYLINE', vertices: [{ x: 10, y: 5, bulge: 0.5 }, { x: 20, y: 5 }, { x: 20, y: 15 }],
      extrusionDirectionX: 0, extrusionDirectionY: 0, extrusionDirectionZ: -1,
    }) as PolylineEntity;
    expect(pl.pts.map((p) => p.x)).toEqual([-10, -20, -20]);
    expect(pl.pts.map((p) => p.y)).toEqual([5, 5, 15]);
    expect(pl.bulges?.[0]).toBe(-0.5);
  });

  it('reads the ellipse normal from the raw tags and swaps a partial sweep', () => {
    // dxf-parser has no case 230 for ELLIPSE; the parameters 4.17→8.39 about
    // -Z are the WCS parameters -8.39→-4.17, i.e. 4.17→8.39 - 2π + 2π.
    const el = create({
      type: 'ELLIPSE', handle: 'E1', center: { x: 543.4, y: 535.2 },
      majorAxisEndPoint: { x: 0, y: -0.154 }, axisRatio: 0.6,
      startAngle: 1.983995216518069, endAngle: 4.299190090661517,
    }, [[210, '0.0'], [220, '0.0'], [230, '-1.0']]) as EllipseEntity;
    const TAU = Math.PI * 2;
    expect(el.startAngle).toBeCloseTo(TAU - 4.299190090661517, 9);
    expect(el.endAngle).toBeCloseTo(TAU - 1.983995216518069, 9);
  });

  it('keeps a full ellipse as a full ellipse under the flipped normal', () => {
    const el = create({
      type: 'ELLIPSE', handle: 'E2', center: { x: 0, y: 0 },
      majorAxisEndPoint: { x: 1, y: 0 }, axisRatio: 0.6, startAngle: 0, endAngle: Math.PI * 2,
    }, [[230, '-1.0']]) as EllipseEntity;
    expect(el.startAngle).toBe(0);
    expect(el.endAngle).toBeCloseTo(Math.PI * 2, 12);
  });

  it('honours group 60 (invisible)', () => {
    const line = create({ type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], visible: false });
    expect(line.visible).toBe(false);
    const shown = create({ type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    expect(shown.visible).toBe(true);
  });
});

describe('DXF import of SOLID', () => {
  const quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];

  it('walks the corners in AutoCAD bow-tie order 1→2→4→3', () => {
    const h = create({ type: 'SOLID', points: quad }) as HatchEntity;
    const loop = h.boundaries[0];
    expect(loop.map((e: any) => [e.start.x, e.start.y])).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(h.solid).toBe(true);
  });

  it('collapses a repeated fourth corner into a triangle', () => {
    const h = create({ type: 'SOLID', points: [quad[0], quad[1], quad[2], { ...quad[2] }] }) as HatchEntity;
    expect(h.boundaries[0].length).toBe(3);
  });

  it('gives every edge its own endpoints, so a translation moves the shape once', () => {
    const h = create({ type: 'SOLID', points: quad }) as HatchEntity;
    const loop = h.boundaries[0];
    for (let i = 1; i < loop.length; i++) expect(loop[i].start).not.toBe(loop[i - 1].end);
    expect(h.boundarySpec).toBeTruthy();
  });

  it('maps the corners through a flipped normal', () => {
    const h = create({ type: 'SOLID', points: quad, extrusionDirection: FLIPPED }) as HatchEntity;
    const xs = h.boundaries[0].map((e: any) => e.start.x);
    expect(Math.min(...xs)).toBe(-10);
    expect(Math.max(...xs)).toBe(-0);
  });
});
