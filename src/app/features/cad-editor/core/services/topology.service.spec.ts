import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { TopologyService } from './topology.service';
import { DocumentService } from './document.service';
import { ViewModelService } from './view-model.service';
import { LineEntity, CircleEntity, type Entity, type IPoint } from '../models/entity.model';

function rect(x: number, y: number, w: number, h: number): Entity[] {
  return [
    new LineEntity(x, y, x + w, y),
    new LineEntity(x + w, y, x + w, y + h),
    new LineEntity(x + w, y + h, x, y + h),
    new LineEntity(x, y + h, x, y),
  ];
}

function area(poly: IPoint[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a) / 2;
}

const WIDE = { x: -1e5, y: -1e5, w: 2e5, h: 2e5 };

describe('TopologyService pick-point queries', () => {
  let topo: TopologyService;
  let doc: DocumentService;
  let vm: ViewModelService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    topo = TestBed.inject(TopologyService);
    doc = TestBed.inject(DocumentService);
    vm = TestBed.inject(ViewModelService);
  });

  function add(...ents: Entity[]): void {
    for (const e of ents) doc.activeFile.entities.push(e);
    vm.markContentDirty(); // the spatial index re-syncs on the content epoch
  }

  it('finds the loop around the pick and reports a boundary set of just that loop', () => {
    add(...rect(0, 0, 100, 50));
    const r = topo.findRegionForPick(50, 25, { window: WIDE });
    expect(r).not.toBeNull();
    expect(area(r!.polygon)).toBeCloseTo(5000, 6);
    expect(r!.islands.length).toBe(0);
    expect(topo.lastQuery.rejection).toBe('none');
    expect(topo.lastQuery.edgeCount).toBe(4);
    expect(topo.lastQuery.candidateIds.length).toBe(4);
  });

  it('answers a pick in open space without building anything', () => {
    add(...rect(1000, 1000, 100, 50));
    const t0 = performance.now();
    const r = topo.findRegionForPick(0, 0, { window: WIDE });
    expect(r).toBeNull();
    expect(topo.lastQuery.rejection).toBe('not-enclosed');
    expect(topo.lastQuery.edgeCount).toBe(0);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('uses the window as the boundary set: a wall outside the view cannot close the loop', () => {
    add(...rect(0, 0, 100, 50));
    // Window that misses the left wall (x = 0) entirely → no enclosure from the visible set.
    const r = topo.findRegionForPick(95, 45, { window: { x: 90, y: 40, w: 100, h: 100 } });
    expect(r).toBeNull();
    expect(topo.lastQuery.rejection).toBe('not-enclosed');
    // A window that merely clips every wall still sees all four (bbox overlap) and finds the loop.
    const r2 = topo.findRegionForPick(50, 25, { window: { x: -5, y: -5, w: 110, h: 60 } });
    expect(r2).not.toBeNull();
    expect(area(r2!.polygon)).toBeCloseTo(5000, 6);
  });

  it('detects islands inside the picked loop', () => {
    add(...rect(0, 0, 100, 100), ...rect(40, 40, 20, 20));
    const r = topo.findRegionForPick(10, 10, { window: WIDE });
    expect(r).not.toBeNull();
    expect(area(r!.polygon)).toBeCloseTo(10000, 6);
    expect(r!.islands.length).toBe(1);
    expect(area(r!.islands[0])).toBeCloseTo(400, 6);
  });

  it('refuses a boundary set over the edge budget instead of grinding (the "Aw, Snap" hover)', () => {
    // A sheet frame with 3 000 circles inside — 192 000 tessellated edges.
    const ents: Entity[] = rect(0, 0, 10000, 10000);
    for (let i = 0; i < 3000; i++) ents.push(new CircleEntity(100 + (i % 60) * 160, 300 + Math.floor(i / 60) * 180, 30));
    add(...ents);
    const t0 = performance.now();
    const r = topo.findRegionForPick(5000, 100, { window: WIDE }); // empty space inside the frame
    const ms = performance.now() - t0;
    expect(r).toBeNull();
    expect(topo.lastQuery.rejection).toBe('too-complex');
    expect(topo.lastQuery.edgeCount).toBeGreaterThan(TopologyService.MAX_BOUNDARY_EDGES);
    expect(ms).toBeLessThan(250);
    // Zooming in — a window around one circle — makes the same drawing tractable.
    const r2 = topo.findRegionForPick(100, 300, { window: { x: 40, y: 240, w: 120, h: 120 } });
    expect(r2).not.toBeNull();
    expect(area(r2!.polygon)).toBeCloseTo(Math.PI * 30 * 30, -1);
  });

  it('bounds BHATCH the same way', () => {
    const ents: Entity[] = [];
    for (let i = 0; i < 600; i++) ents.push(new CircleEntity(i * 100, 0, 30)); // 38 400 edges
    add(...ents);
    expect(topo.findAllRegions()).toEqual([]);
    expect(topo.lastQuery.rejection).toBe('too-complex');
  });
});
