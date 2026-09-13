import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { HatchRendererService } from './hatch-renderer.service';
import { HatchEntity, type IHatchEdge } from '../models/entity-extended.model';

/** Closed rectangular boundary in the legacy `IHatchEdge[][]` form. */
function rectBoundary(x: number, y: number, w: number, h: number): IHatchEdge[][] {
  const p = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  return [p.map((a, i) => ({ type: 'LINE', start: a, end: p[(i + 1) % 4] }) as IHatchEdge)];
}

/**
 * Minimal view model: `scale` px per world unit, world origin at the canvas
 * bottom-left, plus the `visibleWorldRect` the real ViewModelService exposes.
 */
function makeVm(scale: number, W: number, H: number) {
  return {
    scale,
    canvasWidth: W,
    canvasHeight: H,
    w2s: (wx: number, wy: number) => ({ x: wx * scale, y: H - wy * scale }),
    s2w: (sx: number, sy: number) => ({ x: sx / scale, y: (H - sy) / scale }),
    visibleWorldRect: () => ({ x: 0, y: 0, w: W / scale, h: H / scale }),
  };
}

interface IRecorded {
  dashes: number[][];
  offsets: number[];
  caps: string[];
  moveTo: number;
  fills: number;
}

/** Wrap a real 2D context so the calls the renderer makes can be inspected. */
function recording(ctx: CanvasRenderingContext2D): { ctx: CanvasRenderingContext2D; rec: IRecorded } {
  const rec: IRecorded = { dashes: [], offsets: [], caps: [], moveTo: 0, fills: 0 };
  const proxy = new Proxy(ctx, {
    get(t, k) {
      const v = (t as any)[k];
      if (k === 'setLineDash') return (a: number[]) => { rec.dashes.push(a.slice()); return t.setLineDash(a); };
      if (k === 'moveTo') return (x: number, y: number) => { rec.moveTo++; return t.moveTo(x, y); };
      if (k === 'fill') return (...a: any[]) => { rec.fills++; return (t.fill as any)(...a); };
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, k, v) {
      if (k === 'lineDashOffset') rec.offsets.push(v);
      if (k === 'lineCap') rec.caps.push(v);
      (t as any)[k] = v;
      return true;
    },
  });
  return { ctx: proxy, rec };
}

function paintedPixels(ctx: CanvasRenderingContext2D, W: number, H: number): number {
  const data = ctx.getImageData(0, 0, W, H).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
  return n;
}

function makeHatch(pattern: string, w: number, h: number, scale = 1): HatchEntity {
  const hatch = new HatchEntity(rectBoundary(0, 0, w, h), pattern, scale, 0, false);
  hatch.associative = false;
  return hatch;
}

describe('HatchRendererService', () => {
  const W = 1200, H = 800;
  let canvas: HTMLCanvasElement;
  let raw: CanvasRenderingContext2D;
  const doc = { entities: [] };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    raw = canvas.getContext('2d')!;
  });

  it('should be created', () => {
    expect(TestBed.inject(HatchRendererService)).toBeTruthy();
  });

  it('draws a 10 m × 8 m room in every dotted / dashed pattern in well under a frame budget', () => {
    // 0.12 px/mm: the whole room fits the canvas. With the old renderer a
    // single AR-SAND hatch at this size took tens of seconds (tens of millions
    // of sub-pixel dashes) and hung the tab; the picker hover re-drew it.
    // AR-* patterns are defined at real-world size (203 mm blocks, 40 mm sand
    // grain spacing) and are used at scale 1; the small section patterns get
    // the scale a 1:100 plan would use.
    const vm = makeVm(0.12, W, H);
    for (const pattern of ['AR-SAND', 'EARTH', 'BRICK', 'GRAVEL', 'AR-CONC', 'HEX', 'ANSI31', 'ANSI33']) {
      raw.clearRect(0, 0, W, H);
      const hatch = makeHatch(pattern, 10000, 8000, pattern.startsWith('AR-') || pattern === 'GRAVEL' ? 1 : 25);
      const t0 = performance.now();
      hatch.draw(raw, vm, doc);
      const ms = performance.now() - t0;
      expect(ms).withContext(`${pattern} took ${ms.toFixed(1)} ms`).toBeLessThan(250);
      expect(paintedPixels(raw, W, H)).withContext(`${pattern} painted nothing`).toBeGreaterThan(1000);
    }
  });

  it('collapses a pattern denser than a pixel to a translucent fill instead of stroking it', () => {
    const { ctx, rec } = recording(raw);
    const vm = makeVm(0.12, W, H);
    makeHatch('ANSI31', 10000, 8000, 1).draw(ctx, vm, doc); // 0.38 px spacing
    expect(rec.fills).toBeGreaterThan(0);
    expect(rec.moveTo).toBeLessThan(10);
    expect(paintedPixels(raw, W, H)).toBeGreaterThan(100_000);
  });

  it('strokes BRICK with the per-family dash phase: dash-first array and a half-period offset for the odd joints', () => {
    const { ctx, rec } = recording(raw);
    const ppu = 4;
    makeHatch('BRICK', 200, 100).draw(ctx, makeVm(ppu, W, H), doc);
    const dashed = rec.dashes.filter((d) => d.length);
    expect(dashed.length).toBe(2);
    for (const d of dashed) {
      expect(d.length).toBe(2);
      expect(d[0]).toBeCloseTo(6.35 * ppu, 6);
      expect(d[1]).toBeCloseTo(6.35 * ppu, 6);
    }
    const nonZero = rec.offsets.filter((o) => o !== 0);
    expect(nonZero.length).toBe(1);
    expect(nonZero[0]).toBeCloseTo(6.35 * ppu, 6);
  });

  it('switches to round caps for dot patterns so zero-length dashes print as dots', () => {
    const { ctx, rec } = recording(raw);
    makeHatch('AR-SAND', 2000, 2000).draw(ctx, makeVm(0.5, W, H), doc);
    expect(rec.caps).toContain('round');
    expect(rec.caps[rec.caps.length - 1]).toBe('butt'); // state restored afterwards
  });

  it('clips pattern lines to the visible rectangle rather than the whole boundary', () => {
    // 100 m × 100 m boundary, viewing a 1200 × 800 px window at 1 px/mm.
    // Unclipped, ANSI31 needs ~44 000 lines; the visible window needs ~400.
    const { ctx, rec } = recording(raw);
    makeHatch('ANSI31', 100_000, 100_000).draw(ctx, makeVm(1, W, H), doc);
    expect(rec.moveTo).toBeGreaterThan(300);
    expect(rec.moveTo).toBeLessThan(1000);
    expect(paintedPixels(raw, W, H)).toBeGreaterThan(50_000);
  });

  it('renders DXF-embedded definitions (registry form) through the same path', () => {
    const { ctx, rec } = recording(raw);
    const hatch = makeHatch('OFFICE-CUSTOM', 200, 200);
    hatch.customPatternLines = [
      { angle: 0, x0: 0, y0: 0, dx: 0, dy: 10, dashArray: [5, -5] },
    ];
    hatch.draw(ctx, makeVm(2, W, H), doc);
    expect(rec.dashes.some((d) => d.length === 2 && Math.abs(d[0] - 10) < 1e-6)).toBeTrue();
    expect(rec.moveTo).toBeGreaterThanOrEqual(20); // 200/10 courses
    expect(rec.moveTo).toBeLessThanOrEqual(24);
  });
});
