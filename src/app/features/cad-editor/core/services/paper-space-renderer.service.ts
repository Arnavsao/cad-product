/**
 * PaperSpaceRendererService
 *
 * Renders a complete Layout (paper sheet + viewports + paper-space entities)
 * onto a Canvas 2D context.
 *
 * Pipeline (per frame):
 *   1. Compute sheet origin in screen space (the paper sheet is panned/zoomed
 *      like any CAD content via the main ViewModelService).
 *   2. Draw paper shadow + white sheet rectangle.
 *   3. Draw margin indicators + printable area border.
 *   4. For each PaperViewport in the layout:
 *      a. Clip to viewport paper rect.
 *      b. Draw model entities through the viewport's camera.
 *      c. Restore clip.
 *      d. Draw viewport border / lock icon / scale label.
 *   5. Draw paper-space entities (title blocks, annotations) via DocumentService.
 *   6. Draw active-MSPACE overlay if a viewport is in edit mode.
 */
import { Injectable, inject } from '@angular/core';
import { ViewModelService, createProxyVm, type IProxyVm } from './view-model.service';
import { DocumentService } from './document.service';
import type { Layout, PaperViewport } from '../models/layout.model';

/** Screen-space geometry for the paper sheet. Recomputed each frame. */
export interface IPaperGeometry {
  /** Top-left screen pixel of the paper sheet. */
  originX: number;
  originY: number;
  /** Sheet dimensions in screen pixels. */
  widthPx: number;
  heightPx: number;
  /** Scale: screen pixels per paper mm. */
  pxPerMm: number;
  /** Convert paper-mm → screen-px. */
  mm2s: (mmX: number, mmY: number) => { x: number; y: number };
  /** Convert screen-px → paper-mm. */
  s2mm: (sx: number, sy: number) => { x: number; y: number };
}

@Injectable({ providedIn: 'root' })
export class PaperSpaceRendererService {
  private vm  = inject(ViewModelService);
  private doc = inject(DocumentService);

  // ─── Sheet geometry ────────────────────────────────────────────────────────

  /**
   * Compute paper-sheet geometry for the current view.
   *
   * The paper sheet is treated as a model-space rectangle: its lower-left
   * corner is at world (0, 0) and its upper-right at (paperWidthMm, paperHeightMm).
   * The main ViewModelService (pan/zoom) moves the sheet on screen just like
   * any other CAD content.
   */
  private _geomCacheKey = '';
  private _cachedGeom: IPaperGeometry | null = null;

  computePaperGeometry(layout: Layout): IPaperGeometry {
    const wMm = layout.paperWidthMm;
    const hMm = layout.paperHeightMm;

    const cacheKey = `${layout.id}|${wMm}|${hMm}|${this.vm.viewEpoch()}`;
    if (this._cachedGeom && this._geomCacheKey === cacheKey) {
      return this._cachedGeom;
    }

    // Sheet corners in world coords (mm = world units in paper space)
    const tl = this.vm.w2s(0,   hMm);  // top-left  (y-flip: +Y up)
    const br = this.vm.w2s(wMm, 0);    // bot-right

    const widthPx  = br.x - tl.x;
    const heightPx = br.y - tl.y;
    const pxPerMm  = widthPx / wMm;

    const mm2s = (mmX: number, mmY: number) => {
      // Paper Y goes up; screen Y goes down.
      return this.vm.w2s(mmX, hMm - mmY);
    };

    const s2mm = (sx: number, sy: number) => {
      const w = this.vm.s2w(sx, sy);
      return { x: w.x, y: hMm - w.y };
    };

    this._geomCacheKey = cacheKey;
    this._cachedGeom = {
      originX: tl.x,
      originY: tl.y,
      widthPx,
      heightPx,
      pxPerMm,
      mm2s,
      s2mm,
    };
    return this._cachedGeom;
  }

  // ─── Main render entry ─────────────────────────────────────────────────────

  /**
   * Draw the complete paper space view for a layout.
   * Called from CanvasComponent's draw loop when a Layout tab is active.
   */
  render(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    activeMspaceVpId: string | null,
  ): void {
    const geom = this.computePaperGeometry(layout);

    this.drawPaperBackground(ctx, geom, layout);
    this.drawViewports(ctx, layout, geom, activeMspaceVpId);
    this.drawPaperEntities(ctx, layout, geom);
    this.drawViewportBorders(ctx, layout, geom, activeMspaceVpId);

    // Active MSPACE overlay: dim everything outside the active viewport
    if (activeMspaceVpId) {
      this.drawMspaceOverlay(ctx, layout, geom, activeMspaceVpId);
    }
  }

  // ─── Paper background ──────────────────────────────────────────────────────

  private drawPaperBackground(
    ctx: CanvasRenderingContext2D,
    geom: IPaperGeometry,
    layout: Layout,
  ): void {
    const { originX: ox, originY: oy, widthPx: w, heightPx: h } = geom;
    const setup = layout.pageSetup;

    // Shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur  = 16;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, oy, w, h);
    ctx.restore();

    // White paper sheet
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, oy, w, h);

    // Margin dashes
    const pxPerMm = geom.pxPerMm;
    const mt = setup.margins.top    * pxPerMm;
    const mb = setup.margins.bottom * pxPerMm;
    const ml = setup.margins.left   * pxPerMm;
    const mr = setup.margins.right  * pxPerMm;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(150,150,180,0.5)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ox + ml, oy + mt, w - ml - mr, h - mt - mb);
    ctx.restore();
  }

  // ─── Viewport content ──────────────────────────────────────────────────────

  private drawViewports(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    geom: IPaperGeometry,
    activeMspaceVpId: string | null,
  ): void {
    for (const vp of layout.viewports) {
      if (!vp.visible) continue;
      this.drawViewportContent(ctx, vp, layout, geom);
    }
  }

  private drawViewportContent(
    ctx: CanvasRenderingContext2D,
    vp: PaperViewport,
    layout: Layout,
    geom: IPaperGeometry,
  ): void {
    // Paper-mm → screen-px corners
    const tl = geom.mm2s(vp.x,         vp.y + vp.h);
    const br = geom.mm2s(vp.x + vp.w,  vp.y);

    const sx = tl.x;
    const sy = tl.y;
    const sw = br.x - tl.x;
    const sh = br.y - tl.y;

    if (sw <= 0 || sh <= 0) return;

    // Clip to this viewport rectangle
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();

    // Light viewport background (slightly off-white to distinguish from paper)
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(sx, sy, sw, sh);

    // Build a proxy VM that maps model world-coords → screen pixels through
    // this viewport's camera.
    //
    // The camera works in paper-space units (mm). The viewport centre in screen
    // pixels is (sx + sw/2, sy + sh/2). We want:
    //   screenX = centreScreenX + (worldX - camCenterX) * pxPerMm / camScale
    //   screenY = centreScreenY - (worldY - camCenterY) * pxPerMm / camScale
    //
    // which maps to the IProxyVm interface as:
    //   scale    = pxPerMm / camScale
    //   panX     = centreScreenX - camCenterX * scale
    //   panY     = centreScreenY + camCenterY * scale
    const vpScale  = geom.pxPerMm / vp.camScale;   // px per world-unit
    const vpPanX   = (sx + sw / 2) - vp.camCenterX * vpScale;
    const vpPanY   = (sy + sh / 2) + vp.camCenterY * vpScale;

    const vpVm: IProxyVm = {
      scale: vpScale,
      cumulativeScale: vpScale,
      annoScale: vp.camScale,
      w2s: (wx, wy) => ({ x: vpPanX + wx * vpScale, y: vpPanY - wy * vpScale }),
      s2w: (sx2, sy2) => ({ x: (sx2 - vpPanX) / vpScale, y: -(sy2 - vpPanY) / vpScale }),
    };

    // Draw model entities through the viewport camera
    for (const file of this.doc.files) {
      if (!file.visible) continue;
      ctx.globalAlpha = file.opacity;
      const fileVm = createProxyVm(vpVm, file.x, file.y, file.scale, file.scale, file.rotation);
      for (const ent of file.entities) {
        if (!ent.visible) continue;
        const lay = file.layers.get(ent.layer);
        if (lay && (lay.frozen || !lay.visible)) continue;
        if (!vp.isLayerVisible(ent.layer)) continue;
        ctx.save();
        ent.draw(ctx, fileVm, file);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore(); // remove clip
  }

  // ─── Viewport borders + labels ─────────────────────────────────────────────

  private drawViewportBorders(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    geom: IPaperGeometry,
    activeMspaceVpId: string | null,
  ): void {
    for (const vp of layout.viewports) {
      if (!vp.visible) continue;
      const tl = geom.mm2s(vp.x,         vp.y + vp.h);
      const br = geom.mm2s(vp.x + vp.w,  vp.y);
      const sx = tl.x, sy = tl.y;
      const sw = br.x - tl.x, sh = br.y - tl.y;

      const isActive = vp.id === activeMspaceVpId;
      const isSelected = vp.selected;

      ctx.save();
      ctx.setLineDash([]);
      if (vp.locked) {
        ctx.strokeStyle = '#e0a030';
        ctx.lineWidth   = 1.5;
      } else if (isActive) {
        ctx.strokeStyle = '#f0a030';
        ctx.lineWidth   = 2;
        ctx.shadowColor = '#f0a03066';
        ctx.shadowBlur  = 8;
      } else if (isSelected) {
        ctx.strokeStyle = '#499bea';
        ctx.lineWidth   = 1.5;
      } else {
        ctx.strokeStyle = 'rgba(80,80,120,0.6)';
        ctx.lineWidth   = 0.75;
      }
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
      ctx.restore();

      // Lock icon
      if (vp.locked) {
        ctx.save();
        ctx.font      = '11px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#e0a030';
        ctx.fillText('🔒', sx + 4, sy + 14);
        ctx.restore();
      }

      // Scale label
      if (vp.scalePreset) {
        ctx.save();
        ctx.font      = '9px Inter, system-ui, sans-serif';
        ctx.fillStyle = isActive ? '#f0a030' : 'rgba(60,60,80,0.7)';
        ctx.fillText(vp.scalePreset, sx + 4, sy + sh - 4);
        ctx.restore();
      }

      // Resize grips for selected / PSPACE-active viewport
      if (isSelected && !vp.locked && !isActive) {
        this.drawViewportGrips(ctx, sx, sy, sw, sh);
      }
    }
  }

  private drawViewportGrips(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number, sw: number, sh: number,
  ): void {
    const pts = [
      { x: sx,        y: sy },        { x: sx + sw / 2, y: sy },
      { x: sx + sw,   y: sy },        { x: sx + sw,     y: sy + sh / 2 },
      { x: sx + sw,   y: sy + sh },   { x: sx + sw / 2, y: sy + sh },
      { x: sx,        y: sy + sh },   { x: sx,           y: sy + sh / 2 },
    ];
    ctx.save();
    ctx.fillStyle   = '#499bea';
    ctx.strokeStyle = '#1a3a5c';
    ctx.lineWidth   = 1;
    for (const p of pts) {
      ctx.beginPath();
      ctx.rect(p.x - 4, p.y - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ─── Paper-space entities ──────────────────────────────────────────────────

  private drawPaperEntities(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    geom: IPaperGeometry,
  ): void {
    // Build a proxy VM that maps paper-mm → screen-px for paper-space entities.
    // Paper origin (0,0) is at lower-left of the sheet.
    // We use w2s mapping: world (mm) → screen, same as the main VM but relative
    // to the paper sheet position.
    const h = layout.paperHeightMm;
    const paperVm: IProxyVm = {
      scale: geom.pxPerMm,
      cumulativeScale: geom.pxPerMm,
      annoScale: 1.0,
      w2s: (wx, wy) => geom.mm2s(wx, wy),
      s2w: (sx, sy) => geom.s2mm(sx, sy),
    };

    this.doc.drawPaperEntities(ctx, layout, paperVm);
  }

  // ─── MSPACE overlay ────────────────────────────────────────────────────────

  private drawMspaceOverlay(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    geom: IPaperGeometry,
    activeMspaceVpId: string,
  ): void {
    let vp: any = layout.viewports.find((v) => v.id === activeMspaceVpId);
    if (!vp) {
      for (const file of this.doc.files) {
        for (const e of file.entities) {
          if (e.inPaperSpace && e.type === 'VIEWPORT' && e.id.toString() === activeMspaceVpId) {
            const ve = e as any;
            vp = { x: ve.cx - ve.width / 2, y: ve.cy - ve.height / 2, w: ve.width, h: ve.height };
            break;
          }
        }
        if (vp) break;
      }
    }
    if (!vp) return;

    // Dim everything outside the active viewport
    const canvas = ctx.canvas;
    const tl = geom.mm2s(vp.x,        vp.y + vp.h);
    const br = geom.mm2s(vp.x + vp.w, vp.y);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    // Fill the whole canvas, then cut out the active viewport with evenodd.
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.fill('evenodd');
    ctx.restore();

    // Bright border around the active viewport
    ctx.save();
    ctx.strokeStyle = '#f0a030';
    ctx.lineWidth   = 2.5;
    ctx.setLineDash([]);
    ctx.shadowColor = '#f0a03066';
    ctx.shadowBlur  = 10;
    ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, (br.x - tl.x) - 1, (br.y - tl.y) - 1);
    ctx.restore();

    // "MODEL SPACE" label inside the active viewport
    ctx.save();
    ctx.font      = 'bold 10px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#f0a030';
    ctx.fillText('MODEL SPACE', tl.x + 6, tl.y + 14);
    ctx.restore();
  }

  // ─── Hit testing ───────────────────────────────────────────────────────────

  /**
   * Return the topmost viewport whose interior contains the screen point.
   * Used by the canvas to decide double-click → enter MSPACE.
   */
  viewportAtScreen(
    sx: number, sy: number,
    layout: Layout,
    geom: IPaperGeometry,
  ): any | null {
    let hit: PaperViewport | any = null;
    for (const vp of layout.viewports) {
      if (!vp.visible) continue;
      const tl = geom.mm2s(vp.x,        vp.y + vp.h);
      const br = geom.mm2s(vp.x + vp.w, vp.y);
      if (sx >= tl.x && sx <= br.x && sy >= tl.y && sy <= br.y) {
        hit = vp;
      }
    }
    // Also check ViewportEntity objects
    for (const file of this.doc.files) {
      if (!file.visible) continue;
      for (const e of file.entities) {
        if (!e.visible || !e.inPaperSpace || e.type !== 'VIEWPORT') continue;
        const vp = e as any; // ViewportEntity
        const tl = geom.mm2s(vp.cx - vp.width / 2, vp.cy + vp.height / 2);
        const br = geom.mm2s(vp.cx + vp.width / 2, vp.cy - vp.height / 2);
        
        // Ensure mm2s mapping results in tl being top-left (min x, min y in screen coords)
        const minX = Math.min(tl.x, br.x);
        const maxX = Math.max(tl.x, br.x);
        const minY = Math.min(tl.y, br.y);
        const maxY = Math.max(tl.y, br.y);
        
        if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
          // Provide an adapter interface to match PaperViewport if it's interacted with
          hit = {
            id: vp.id.toString(),
            x: vp.cx - vp.width / 2,
            y: vp.cy - vp.height / 2,
            w: vp.width,
            h: vp.height,
            camCenterX: vp.viewCenterX,
            camCenterY: vp.viewCenterY,
            camScale: vp.height / vp.viewHeight,
            visible: true
          };
        }
      }
    }
    return hit;
  }

  /**
   * True if the screen point is inside the paper sheet rectangle.
   */
  isOnPaper(sx: number, sy: number, geom: IPaperGeometry): boolean {
    return (
      sx >= geom.originX &&
      sx <= geom.originX + geom.widthPx &&
      sy >= geom.originY &&
      sy <= geom.originY + geom.heightPx
    );
  }

  /**
   * Convert screen coords to paper-mm, then to model-world through a viewport's camera.
   * Used by MSPACE mouse event routing.
   */
  screenToModelWorld(
    sx: number, sy: number,
    vpId: string,
    layout: Layout,
    geom: IPaperGeometry,
  ): { x: number; y: number } {
    let vp: any = layout.viewports.find(v => v.id === vpId);
    if (!vp) {
      for (const file of this.doc.files) {
        for (const e of file.entities) {
          if (e.inPaperSpace && e.type === 'VIEWPORT' && e.id.toString() === vpId) {
            const ve = e as any;
            vp = { x: ve.cx - ve.width / 2, y: ve.cy - ve.height / 2, w: ve.width, h: ve.height, camCenterX: ve.viewCenterX, camCenterY: ve.viewCenterY, camScale: ve.height / ve.viewHeight };
            break;
          }
        }
        if (vp) break;
      }
    }
    if (!vp) return { x: 0, y: 0 };
    const tl = geom.mm2s(vp.x,        vp.y + vp.h);
    const br = geom.mm2s(vp.x + vp.w, vp.y);
    const vpScale = geom.pxPerMm / vp.camScale;
    const vpPanX  = (tl.x + (br.x - tl.x) / 2) - vp.camCenterX * vpScale;
    const vpPanY  = (tl.y + (br.y - tl.y) / 2) + vp.camCenterY * vpScale;
    return {
      x: (sx - vpPanX) / vpScale,
      y: -(sy - vpPanY) / vpScale,
    };
  }
}
