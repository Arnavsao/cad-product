import { Viewport } from '../models/viewport.model';

/**
 * A paper-space Viewport's camera pan is an ABSOLUTE screen-space origin,
 * whereas the main view splits its origin across `panX` and `vpCenterX`
 * (see ViewModelService.w2s). ViewportManagerService.add() therefore has to
 * fold the centre in when it seeds a new viewport from the current view —
 * without it a freshly drawn viewport looked at a point half a canvas away
 * and came up empty.
 */
describe('Viewport camera seeded from the main view', () => {
  const W = 1000;
  const H = 600;
  // What ViewModelService/ModelViewportService hold for a single, un-split view.
  const vm = { scale: 2, panX: 30, panY: -15, vpCenterX: W / 2, vpCenterY: H / 2 };

  /** The main view's world→screen mapping. */
  const mainW2s = (wx: number, wy: number) => ({
    x: wx * vm.scale + vm.panX + vm.vpCenterX,
    y: -wy * vm.scale + vm.panY + vm.vpCenterY,
  });

  /** Exactly how ViewportManagerService.add() builds the camera. */
  const newViewport = () =>
    new Viewport(0, 0, 400, 300, {
      scale: vm.scale,
      panX: vm.panX + vm.vpCenterX,
      panY: vm.panY + vm.vpCenterY,
    });

  it('puts a world point at the same screen position as the main view', () => {
    const vp = newViewport();
    for (const [wx, wy] of [[0, 0], [120, -45], [-300, 250]]) {
      const expected = mainW2s(wx, wy);
      const actual = vp.w2s(wx, wy);
      expect(actual.x).toBeCloseTo(expected.x, 6);
      expect(actual.y).toBeCloseTo(expected.y, 6);
    }
  });

  it('is offset by exactly the canvas centre when the centre is dropped', () => {
    const wrong = new Viewport(0, 0, 400, 300, { scale: vm.scale, panX: vm.panX, panY: vm.panY });
    const expected = mainW2s(10, 10);
    expect(expected.x - wrong.w2s(10, 10).x).toBeCloseTo(vm.vpCenterX, 6);
    expect(expected.y - wrong.w2s(10, 10).y).toBeCloseTo(vm.vpCenterY, 6);
  });

  it('round-trips screen→world→screen through its own camera', () => {
    const vp = newViewport();
    const w = vp.s2w(321, 222);
    const s = vp.w2s(w.x, w.y);
    expect(s.x).toBeCloseTo(321, 6);
    expect(s.y).toBeCloseTo(222, 6);
  });
});
