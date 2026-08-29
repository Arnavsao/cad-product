import { runLayoutValidation, computeAutoLayout } from './views-intelligent-layout.tools';
import type { DetectedView } from '../models/ai-view.model';

function view(id: string, x: number, y: number, w: number, h: number, label = id): DetectedView {
  return { id, label, bbox: { x, y, w, h }, entityIds: [1] };
}

describe('runLayoutValidation', () => {
  it('passes for an empty drawing (info only)', () => {
    const report = runLayoutValidation([]);
    expect(report.passed).toBeTrue();
    expect(report.viewCount).toBe(0);
  });

  it('detects overlapping views as an error', () => {
    const views = [view('A', 0, 0, 100, 100), view('B', 50, 50, 100, 100)];
    const report = runLayoutValidation(views);
    expect(report.passed).toBeFalse();
    expect(report.issues.some(i => i.code === 'OVERLAP' && i.severity === 'error')).toBeTrue();
  });

  it('passes for cleanly separated, evenly spaced views', () => {
    const views = [
      view('A', 0, 0, 100, 100),
      view('B', 200, 0, 100, 100),
      view('C', 400, 0, 100, 100),
    ];
    const report = runLayoutValidation(views);
    expect(report.passed).toBeTrue();
    expect(report.issues.some(i => i.code === 'OVERLAP')).toBeFalse();
  });

  it('flags uneven spacing as a warning (not a hard failure)', () => {
    const views = [
      view('A', 0, 0, 100, 100),
      view('B', 200, 0, 100, 100),   // gap 100
      view('C', 1000, 0, 100, 100),  // gap 700 — way off
    ];
    const report = runLayoutValidation(views);
    expect(report.issues.some(i => i.code === 'UNEVEN_SPACING')).toBeTrue();
    expect(report.passed).toBeTrue(); // warnings don't fail
  });

  it('reports unlabelled views as info', () => {
    const views = [view('A', 0, 0, 100, 100, 'View 1'), view('B', 300, 0, 100, 100, 'PLAN')];
    const report = runLayoutValidation(views);
    expect(report.issues.some(i => i.code === 'UNLABELLED_VIEWS')).toBeTrue();
  });
});

describe('computeAutoLayout', () => {
  it('returns no moves for an empty list', () => {
    expect(computeAutoLayout([])).toEqual([]);
  });

  it('produces one move entry per view', () => {
    const views = [
      view('A', 0, 0, 100, 100),
      view('B', 500, 500, 100, 100),
      view('C', -300, 800, 100, 100),
    ];
    const moves = computeAutoLayout(views, { columns: 2 });
    expect(moves.length).toBe(3);
    // Every view is represented exactly once.
    const ids = moves.map(m => m.view.id).sort();
    expect(ids).toEqual(['A', 'B', 'C']);
  });

  it('packs views without overlaps after applying the deltas', () => {
    const views = [
      view('A', 0, 0, 100, 80),
      view('B', 1000, 0, 120, 100),
      view('C', 0, 1000, 90, 90),
      view('D', 1000, 1000, 110, 70),
    ];
    const moves = computeAutoLayout(views, { columns: 2 });

    // Apply deltas to get packed bboxes.
    const packed = moves.map(m => ({
      id: m.view.id,
      x: m.view.bbox.x + m.dx,
      y: m.view.bbox.y + m.dy,
      w: m.view.bbox.w,
      h: m.view.bbox.h,
    }));

    // No two packed bboxes overlap.
    for (let i = 0; i < packed.length; i++) {
      for (let j = i + 1; j < packed.length; j++) {
        const a = packed[i], b = packed[j];
        const overlap =
          a.x < b.x + b.w && a.x + a.w > b.x &&
          a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap).withContext(`${a.id} vs ${b.id}`).toBeFalse();
      }
    }
  });

  it('anchors the packed group near the original top-left by default', () => {
    const views = [view('A', 1000, 1000, 100, 100), view('B', 1300, 1000, 100, 100)];
    const moves = computeAutoLayout(views);
    const packedMinX = Math.min(...moves.map(m => m.view.bbox.x + m.dx));
    const origMinX = Math.min(...views.map(v => v.bbox.x));
    expect(packedMinX).toBeCloseTo(origMinX, 6);
  });
});
