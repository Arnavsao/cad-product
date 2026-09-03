import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DocumentManagerService } from './document-manager.service';
import { ViewModelService } from './view-model.service';
import type { DocumentService } from './document.service';

/**
 * Zoom-extents centring.
 *
 * `w2s` adds BOTH `panX` and `vpCenterX`, and `ModelViewportService.updateVmCenter()`
 * sets `vpCenter` to the canvas centre even for a single (un-split) viewport. So the
 * pan targets computed here must NOT add half the canvas again — doing so lands the
 * focus point on the bottom-right corner instead of the middle.
 */
describe('ViewModelService zoom-extents centring', () => {
  const W = 1000;
  const H = 600;
  let vm: ViewModelService;

  /** Stands in for the single-document manager: just somewhere to hold vmState. */
  const docManagerStub = {
    activeDocument: {
      vmState: { scale: 1, panX: 0, panY: 0, lastCursorWorld: { x: 0, y: 0 }, previewHiddenIds: null },
    },
  };

  const docWithBounds = (b: { minX: number; minY: number; maxX: number; maxY: number } | null) =>
    ({ getValidDrawingBounds: () => b }) as unknown as DocumentService;

  beforeEach(() => {
    docManagerStub.activeDocument.vmState = {
      scale: 1, panX: 0, panY: 0, lastCursorWorld: { x: 0, y: 0 }, previewHiddenIds: null,
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ViewModelService,
        { provide: DocumentManagerService, useValue: docManagerStub },
      ],
    });
    vm = TestBed.inject(ViewModelService);
    vm.canvasWidth = W;
    vm.canvasHeight = H;
    // What updateVmCenter() does when there is one, un-split viewport.
    vm.vpCenterX = W / 2;
    vm.vpCenterY = H / 2;
  });

  it('puts the world origin at the canvas centre when the drawing is empty', () => {
    vm.zoomExtents(docWithBounds(null), 0.05, false);
    const p = vm.w2s(0, 0);
    expect(p.x).toBeCloseTo(W / 2, 3);
    expect(p.y).toBeCloseTo(H / 2, 3);
  });

  it('puts the drawing centre at the canvas centre when the drawing has entities', () => {
    const b = { minX: 100, minY: 50, maxX: 300, maxY: 150 };
    vm.zoomExtents(docWithBounds(b), 0.05, false);
    const p = vm.w2s((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    expect(p.x).toBeCloseTo(W / 2, 3);
    expect(p.y).toBeCloseTo(H / 2, 3);
  });

  it('fits the whole drawing inside the canvas with padding', () => {
    const b = { minX: -400, minY: -20, maxX: 400, maxY: 20 };
    vm.zoomExtents(docWithBounds(b), 0.05, false);
    for (const [wx, wy] of [[b.minX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY], [b.maxX, b.minY]]) {
      const p = vm.w2s(wx, wy);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(H);
    }
  });

  it('reset() centres the origin too', () => {
    vm.reset();
    const p = vm.w2s(0, 0);
    expect(p.x).toBeCloseTo(W / 2, 3);
    expect(p.y).toBeCloseTo(H / 2, 3);
  });
});
