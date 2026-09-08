import { paperViewportFromEntity, type IViewportEntityLike } from './layout.model';

function vpEntity(over: Partial<IViewportEntityLike> = {}): IViewportEntityLike {
  return {
    cx: 210, cy: 148.5, w: 380, h: 257,
    viewCenter: { x: 5000, y: 2500 },
    viewHeight: 25700,
    ...over,
  };
}

describe('paperViewportFromEntity', () => {
  it('places the viewport by its lower-left corner in paper mm (+Y up)', () => {
    const vp = paperViewportFromEntity(vpEntity())!;
    expect(vp).not.toBeNull();
    expect(vp.x).toBeCloseTo(20);
    expect(vp.y).toBeCloseTo(20);
    expect(vp.w).toBe(380);
    expect(vp.h).toBe(257);
  });

  it('derives the camera from the DXF view centre and view height', () => {
    const vp = paperViewportFromEntity(vpEntity())!;
    expect(vp.camCenterX).toBe(5000);
    expect(vp.camCenterY).toBe(2500);
    // 25700 model units across 257 mm of paper → 1:100
    expect(vp.camScale).toBeCloseTo(100);
  });

  it('remembers the source entity so camera edits can round-trip to DXF', () => {
    const e = vpEntity();
    expect(paperViewportFromEntity(e)!.sourceEntity).toBe(e);
  });

  it('skips the paper-space view itself (group 69 = 1)', () => {
    expect(paperViewportFromEntity(vpEntity({ dxfViewportId: 1 }))).toBeNull();
    expect(paperViewportFromEntity(vpEntity({ dxfViewportId: 2 }))).not.toBeNull();
  });

  it('skips switched-off viewports (group 68 <= 0) but keeps ones without a status', () => {
    expect(paperViewportFromEntity(vpEntity({ dxfStatus: 0 }))).toBeNull();
    expect(paperViewportFromEntity(vpEntity({ dxfStatus: -1 }))).toBeNull();
    expect(paperViewportFromEntity(vpEntity({ dxfStatus: 3 }))).not.toBeNull();
    expect(paperViewportFromEntity(vpEntity({ dxfStatus: undefined }))).not.toBeNull();
  });

  it('rejects degenerate rectangles and falls back to 1:1 for an empty view', () => {
    expect(paperViewportFromEntity(vpEntity({ w: 0 }))).toBeNull();
    expect(paperViewportFromEntity(vpEntity({ h: -5 }))).toBeNull();
    expect(paperViewportFromEntity(vpEntity({ viewHeight: 0 }))!.camScale).toBe(1);
  });
});

describe('PaperViewport backed by a VIEWPORT entity', () => {
  it('edits geometry and camera on the source entity in place', () => {
    const e = vpEntity();
    const vp = paperViewportFromEntity(e)!;

    vp.x = 30;                       // move right by 10 mm
    expect(e.cx).toBeCloseTo(220);
    expect(vp.w).toBe(380);          // width unchanged

    vp.w = 200;                      // resize keeps the left edge
    expect(vp.x).toBeCloseTo(30);
    expect(e.cx).toBeCloseTo(130);

    const scaleBefore = vp.camScale;
    vp.h = 100;                      // resize keeps the bottom edge and the scale
    expect(vp.y).toBeCloseTo(20);
    expect(vp.camScale).toBeCloseTo(scaleBefore);
    expect(e.viewHeight).toBeCloseTo(scaleBefore * 100);

    vp.camCenterX = 1; vp.camCenterY = 2;
    expect(e.viewCenter).toEqual({ x: 1, y: 2 });
    vp.camScale = 50;
    expect(e.viewHeight).toBeCloseTo(5000);
  });

  it('a clone is detached from the entity', () => {
    const e = vpEntity();
    const c = paperViewportFromEntity(e)!.clone();
    expect(c.sourceEntity).toBeNull();
    c.x = 999;
    expect(e.cx).toBeCloseTo(210);
  });
});
