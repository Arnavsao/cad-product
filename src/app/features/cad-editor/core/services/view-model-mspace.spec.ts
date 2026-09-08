import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DocumentManagerService } from './document-manager.service';
import { ViewModelService, composeViewportCamera, type IMspaceCamera } from './view-model.service';

/**
 * MSPACE: editing the model through a layout viewport. The view model composes
 * the viewport camera onto the paper zoom so tools see model coordinates.
 */
describe('ViewModelService MSPACE camera', () => {
  const W = 1000;
  const H = 600;
  let vm: ViewModelService;
  let vp: IMspaceCamera;

  const docManagerStub = {
    activeDocument: {
      vmState: { scale: 2, panX: 0, panY: 0, lastCursorWorld: { x: 0, y: 0 }, previewHiddenIds: null },
    },
  };

  beforeEach(() => {
    // Paper zoom: 2 px per mm, sheet origin at the canvas centre.
    docManagerStub.activeDocument.vmState = {
      scale: 2, panX: 0, panY: 0, lastCursorWorld: { x: 0, y: 0 }, previewHiddenIds: null,
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
    vm.vpCenterX = W / 2;
    vm.vpCenterY = H / 2;
    // A 380 × 257 mm viewport at (20, 20) looking at model (5000, 2500) at 1:100.
    vp = { x: 20, y: 20, w: 380, h: 257, camCenterX: 5000, camCenterY: 2500, camScale: 100 };
  });

  it('composeViewportCamera maps the camera centre to the viewport centre on paper', () => {
    const c = composeViewportCamera({ scale: 2, panX: 0, panY: 0 }, W / 2, H / 2, vp);
    expect(c.scale).toBeCloseTo(0.02); // 2 px/mm ÷ 100 units/mm
    const sx = vp.camCenterX * c.scale + c.panX + W / 2;
    const sy = -vp.camCenterY * c.scale + c.panY + H / 2;
    // Viewport centre (210, 148.5) mm through the base view.
    expect(sx).toBeCloseTo(210 * 2 + W / 2);
    expect(sy).toBeCloseTo(-148.5 * 2 + H / 2);
  });

  it('follows the base view without a camera source', () => {
    expect(vm.scale).toBe(2);
    expect(vm.w2s(10, 0).x).toBeCloseTo(20 + W / 2);
  });

  it('w2s / s2w go through the viewport once a camera is installed', () => {
    vm.setMspaceCameraSource(() => vp);
    expect(vm.scale).toBeCloseTo(0.02);
    const centre = vm.w2s(5000, 2500);
    expect(centre.x).toBeCloseTo(vm.baseW2s(210, 148.5).x);
    expect(centre.y).toBeCloseTo(vm.baseW2s(210, 148.5).y);
    const back = vm.s2w(centre.x + 10, centre.y);
    expect(back.x).toBeCloseTo(5000 + 10 / 0.02);
    expect(back.y).toBeCloseTo(2500);
    // The sheet is untouched.
    expect(vm.baseScale).toBe(2);
  });

  it('writing panX/panY in MSPACE pans the viewport camera, not the sheet', () => {
    vm.setMspaceCameraSource(() => vp);
    vm.panX += 10;   // content moves 10 px right → the centre now shows a point further LEFT in the model
    vm.panY -= 4;    // content moves 4 px up → the centre now shows a point LOWER in the model
    expect(vp.camCenterX).toBeCloseTo(5000 - 10 / 0.02);
    expect(vp.camCenterY).toBeCloseTo(2500 - 4 / 0.02);
    expect(vm.basePanX).toBe(0);
    expect(vm.basePanY).toBe(0);
  });

  it('zoomAt in MSPACE changes the viewport scale and keeps the anchor fixed', () => {
    vm.setMspaceCameraSource(() => vp);
    const anchorScreen = vm.w2s(5100, 2400);
    vm.zoomAt(2, anchorScreen.x, anchorScreen.y);
    expect(vp.camScale).toBeCloseTo(50);
    const after = vm.w2s(5100, 2400);
    expect(after.x).toBeCloseTo(anchorScreen.x, 6);
    expect(after.y).toBeCloseTo(anchorScreen.y, 6);
    expect(vm.baseScale).toBe(2);
  });

  it('clearing the source restores the paper view', () => {
    vm.setMspaceCameraSource(() => vp);
    vm.setMspaceCameraSource(null);
    expect(vm.mspaceCamera).toBeNull();
    expect(vm.scale).toBe(2);
  });
});
