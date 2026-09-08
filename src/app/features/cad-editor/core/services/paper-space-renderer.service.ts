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
 *
 * The paper sheet is white in every theme (as in AutoCAD), so the whole render
 * runs with the colour mapper's paint surface forced to 'light': entities whose
 * stored colour is white (ACI 7 / the default) display as black on the sheet
 * instead of disappearing into it when the editor theme is dark.
 */
import { Injectable, inject } from '@angular/core';
import { ViewModelService, createProxyVm, type IProxyVm } from './view-model.service';
import { DocumentService } from './document.service';
import { ThemeService } from './theme.service';
import { SnappingService } from './snapping.service';
import type { Layout, PaperViewport } from '../models/layout.model';
import { niceGridStep } from './view-model.service';
import { withPaintSurface } from '../utils/theme-color-mapper';

/** Surround colour outside the paper sheet (AutoCAD: neutral grey). */
export const PAPER_SURROUND_LIGHT = '#9a9a9a';
export const PAPER_SURROUND_DARK  = '#3c3f45';

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
  private vm    = inject(ViewModelService);
  private doc   = inject(DocumentService);
  private theme = inject(ThemeService);
  private snap  = inject(SnappingService);

  /** Background colour drawn around the paper sheet for the current theme. */
  surroundColor(): string {
    return this.theme.isLight() ? PAPER_SURROUND_LIGHT : PAPER_SURROUND_DARK;
  }

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

    // Sheet corners in world coords (mm = world units in paper space). Always
    // through the BASE view: in MSPACE the view model composes the viewport
    // camera onto w2s/s2w, but the sheet itself stays where the paper zoom puts it.
    const tl = this.vm.baseW2s(0,   hMm);  // top-left  (y-flip: +Y up)
    const br = this.vm.baseW2s(wMm, 0);    // bot-right

    const widthPx  = br.x - tl.x;
    const heightPx = br.y - tl.y;
    const pxPerMm  = widthPx / wMm;

    // Paper mm ARE world units on a layout tab: origin at the sheet's lower-left,
    // +Y up, exactly like DXF paper space. `w2s` already flips Y for the
    // screen, so no extra flip here — flipping again put paper (0,0) at the
    // TOP of the sheet, every viewport rect came out with a negative height
    // and `drawViewportContent` bailed before drawing a single entity.
    const mm2s = (mmX: number, mmY: number) => this.vm.baseW2s(mmX, mmY);
    const s2mm = (sx: number, sy: number) => this.vm.baseS2w(sx, sy);

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

    withPaintSurface('light', () => {
      this.drawPaperBackground(ctx, geom, layout);
      this.drawViewports(ctx, layout, geom, activeMspaceVpId);
      this.drawPaperEntities(ctx, layout, geom);
      this.drawViewportBorders(ctx, layout, geom, activeMspaceVpId);

      // Active MSPACE overlay: dim everything outside the active viewport
      if (activeMspaceVpId) {
        this.drawMspaceOverlay(ctx, layout, geom, activeMspaceVpId);
      }
    });

    this.drawUcsIcon(ctx, !!activeMspaceVpId);
  }

  // ─── UCS icon ──────────────────────────────────────────────────────────────

  /**
   * AutoCAD shows a triangular "paper space" icon at the lower-left of the
   * drawing area on a layout tab, and the X/Y axis icon while in MSPACE.
   */
  private drawUcsIcon(ctx: CanvasRenderingContext2D, mspace: boolean): void {
    // CSS-pixel height: the editor pre-scales its contexts by the DPR, so the
    // backing store (`ctx.canvas.height`) is not the drawable extent.
    const H = this.vm.canvasHeight || ctx.canvas.height;
    const x0 = 22, y0 = H - 22, size = 48;
    ctx.save();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = this.theme.isLight() ? '#1f4fd1' : '#7aa7ff';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.setLineDash([]);
    if (!mspace) {
      // Set-square triangle
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0, y0 - size);
      ctx.lineTo(x0 + size, y0);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x0 + 8, y0 - 8);
      ctx.lineTo(x0 + 8, y0 - size * 0.62);
      ctx.lineTo(x0 + size * 0.62, y0 - 8);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeRect(x0, y0 - 8, 8, 8);
    } else {
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + size, y0);
      ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 - size);
      ctx.stroke();
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillText('X', x0 + size + 4, y0 + 4);
      ctx.fillText('Y', x0 - 4, y0 - size - 4);
      ctx.strokeRect(x0 - 4, y0 - 4, 8, 8);
    }
    ctx.restore();
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
    ctx.strokeStyle = 'rgba(90,90,110,0.7)';
    ctx.lineWidth = 1;
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
      this.drawViewportContent(ctx, vp, layout, geom, vp.id === activeMspaceVpId);
    }
  }

  private drawViewportContent(
    ctx: CanvasRenderingContext2D,
    vp: PaperViewport,
    layout: Layout,
    geom: IPaperGeometry,
    isActiveMspace = false,
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

    // Viewport interior is the paper itself (white), like AutoCAD.
    ctx.fillStyle = '#ffffff';
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

    // Model-space grid, seen through the viewport camera (AutoCAD shows the
    // model grid inside each layout viewport when GRID is on).
    if (this.snap.gridEnabled()) {
      this.drawViewportGrid(ctx, vpVm, sx, sy, sw, sh);
    }

    // Draw model entities through the viewport camera
    for (const file of this.doc.files) {
      if (!file.visible) continue;
      ctx.globalAlpha = file.opacity;
      const fileVm = createProxyVm(vpVm, file.x, file.y, file.scale, file.scale, file.rotation);
      for (const ent of file.entities) {
        if (!ent.visible || ent.inPaperSpace) continue;
        // Entities being grip-dragged are painted live on the dynamic layer.
        if (this.vm.previewHiddenIds?.has(ent.id)) continue;
        const lay = file.layers.get(ent.layer);
        if (lay && (lay.frozen || !lay.visible)) continue;
        if (!vp.isLayerVisible(ent.layer)) continue;
        ctx.save();
        ent.draw(ctx, fileVm, file);
        // Selection highlight only in the viewport being edited through.
        if (isActiveMspace && ent.selected) ent.drawSelected(ctx, fileVm, file);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore(); // remove clip
  }

  private drawViewportGrid(
    ctx: CanvasRenderingContext2D,
    vpVm: IProxyVm,
    sx: number, sy: number, sw: number, sh: number,
  ): void {
    const step = niceGridStep(vpVm.scale);
    const step2 = step * 10;
    const tl = vpVm.s2w(sx, sy);
    const br = vpVm.s2w(sx + sw, sy + sh);
    const x0 = Math.floor(Math.min(tl.x, br.x) / step) * step;
    const x1 = Math.ceil(Math.max(tl.x, br.x) / step) * step;
    const y0 = Math.floor(Math.min(tl.y, br.y) / step) * step;
    const y1 = Math.ceil(Math.max(tl.y, br.y) / step) * step;
    // Guard against pathological densities.
    if ((x1 - x0) / step > 2000 || (y1 - y0) / step > 2000) return;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.beginPath();
    for (let wx = x0; wx <= x1; wx += step) {
      if (Math.abs(wx % step2) < step * 0.01) continue;
      const px = vpVm.w2s(wx, 0).x;
      ctx.moveTo(px, sy); ctx.lineTo(px, sy + sh);
    }
    for (let wy = y0; wy <= y1; wy += step) {
      if (Math.abs(wy % step2) < step * 0.01) continue;
      const py = vpVm.w2s(0, wy).y;
      ctx.moveTo(sx, py); ctx.lineTo(sx + sw, py);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    for (let wx = Math.floor(x0 / step2) * step2; wx <= x1; wx += step2) {
      const px = vpVm.w2s(wx, 0).x;
      ctx.moveTo(px, sy); ctx.lineTo(px, sy + sh);
    }
    for (let wy = Math.floor(y0 / step2) * step2; wy <= y1; wy += step2) {
      const py = vpVm.w2s(0, wy).y;
      ctx.moveTo(sx, py); ctx.lineTo(sx + sw, py);
    }
    ctx.stroke();

    // World axes
    const o = vpVm.w2s(0, 0);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(200,60,60,0.75)';
    ctx.beginPath(); ctx.moveTo(sx, o.y); ctx.lineTo(sx + sw, o.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(60,160,60,0.75)';
    ctx.beginPath(); ctx.moveTo(o.x, sy); ctx.lineTo(o.x, sy + sh); ctx.stroke();
    ctx.restore();
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
        ctx.strokeStyle = 'rgba(40,40,50,0.85)';
        ctx.lineWidth   = 1;
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
    const vp = layout.viewports.find((v) => v.id === activeMspaceVpId);
    if (!vp) return;

    // Dim everything outside the active viewport
    const W = this.vm.canvasWidth || ctx.canvas.width;
    const H = this.vm.canvasHeight || ctx.canvas.height;
    const tl = geom.mm2s(vp.x,        vp.y + vp.h);
    const br = geom.mm2s(vp.x + vp.w, vp.y);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    // Fill the whole canvas, then cut out the active viewport with evenodd.
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
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

  /** Screen rectangle of a viewport (top-left origin, positive size). */
  viewportScreenRect(vp: PaperViewport, geom: IPaperGeometry): { x: number; y: number; w: number; h: number } {
    const tl = geom.mm2s(vp.x,        vp.y + vp.h);
    const br = geom.mm2s(vp.x + vp.w, vp.y);
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  }

  /**
   * Grip positions of a viewport frame in screen px. Index order matches
   * `drawViewportGrips`: 0 TL, 1 T, 2 TR, 3 R, 4 BR, 5 B, 6 BL, 7 L.
   */
  viewportGripPoints(vp: PaperViewport, geom: IPaperGeometry): { x: number; y: number }[] {
    const r = this.viewportScreenRect(vp, geom);
    return [
      { x: r.x,           y: r.y },           { x: r.x + r.w / 2, y: r.y },
      { x: r.x + r.w,     y: r.y },           { x: r.x + r.w,     y: r.y + r.h / 2 },
      { x: r.x + r.w,     y: r.y + r.h },     { x: r.x + r.w / 2, y: r.y + r.h },
      { x: r.x,           y: r.y + r.h },     { x: r.x,           y: r.y + r.h / 2 },
    ];
  }

  /**
   * PSPACE object picking for viewports. A viewport is an object on the sheet:
   * its FRAME is selectable (not its interior, which belongs to whatever paper
   * entities lie there), and a selected, unlocked viewport exposes resize grips.
   * Returns the topmost hit, grips of selected viewports taking priority.
   */
  viewportFrameHit(
    sx: number, sy: number,
    layout: Layout,
    geom: IPaperGeometry,
    tolPx = 6,
  ): { vp: PaperViewport; handle: number | null } | null {
    for (let i = layout.viewports.length - 1; i >= 0; i--) {
      const vp = layout.viewports[i];
      if (!vp.visible || !vp.selected || vp.locked) continue;
      const pts = this.viewportGripPoints(vp, geom);
      for (let h = 0; h < pts.length; h++) {
        if (Math.abs(sx - pts[h].x) <= tolPx && Math.abs(sy - pts[h].y) <= tolPx) {
          return { vp, handle: h };
        }
      }
    }
    for (let i = layout.viewports.length - 1; i >= 0; i--) {
      const vp = layout.viewports[i];
      if (!vp.visible) continue;
      const r = this.viewportScreenRect(vp, geom);
      const withinY = sy >= r.y - tolPx && sy <= r.y + r.h + tolPx;
      const withinX = sx >= r.x - tolPx && sx <= r.x + r.w + tolPx;
      const onVertical   = withinY && (Math.abs(sx - r.x) <= tolPx || Math.abs(sx - (r.x + r.w)) <= tolPx);
      const onHorizontal = withinX && (Math.abs(sy - r.y) <= tolPx || Math.abs(sy - (r.y + r.h)) <= tolPx);
      if (onVertical || onHorizontal) return { vp, handle: null };
    }
    return null;
  }

  /**
   * Return the topmost viewport whose interior contains the screen point.
   * Used by the canvas to decide double-click → enter MSPACE.
   */
  viewportAtScreen(
    sx: number, sy: number,
    layout: Layout,
    geom: IPaperGeometry,
  ): PaperViewport | null {
    // Viewports imported from DXF are adopted into `layout.viewports` when the
    // layout is first shown (LayoutManagerService), so this list is complete.
    let hit: PaperViewport | null = null;
    for (const vp of layout.viewports) {
      if (!vp.visible) continue;
      const tl = geom.mm2s(vp.x,        vp.y + vp.h);
      const br = geom.mm2s(vp.x + vp.w, vp.y);
      if (sx >= tl.x && sx <= br.x && sy >= tl.y && sy <= br.y) {
        hit = vp;
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
    const vp = layout.viewports.find(v => v.id === vpId);
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
