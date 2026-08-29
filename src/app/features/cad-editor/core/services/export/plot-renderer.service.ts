import { Injectable, inject } from '@angular/core';
import { DocumentService } from '../document.service';
import { ViewModelService, createProxyVm } from '../view-model.service';
import {
  IPlotOptions,
  getPaperSizeMm,
} from '../../models/plot-options.model';
import type { Entity } from '../../models/entity.model';

/**
 * World-to-paper plot geometry. Computed once per render call so the
 * exporters and the live preview share the same math.
 */
export interface IPlotGeometry {
  /** World-space bbox of the plot area. */
  world: { minX: number; minY: number; maxX: number; maxY: number };
  /** Final paper size in mm (orientation applied). */
  paperMm: { w: number; h: number };
  /** Pixels per mm at the resolution the renderer was asked for. */
  pxPerMm: number;
  /** Canvas pixel dimensions including margin. */
  canvasPx: { w: number; h: number };
  /** World units per paper millimetre (the realised scale). */
  worldPerMm: number;
  /** Transform: world (x, y) → canvas pixel (x, y). */
  w2c: (wx: number, wy: number) => { x: number; y: number };
}

/**
 * Shared canvas plot renderer. Drives PDF (raster, Phase 1), PNG, and the
 * Plot dialog's live preview from a single code path so that what the user
 * sees in preview is what they get on disk.
 *
 * Pipeline:
 *   1. Compute world bbox for the chosen area (extents / display / window /
 *      selection).
 *   2. Map paper size + orientation → final mm.
 *   3. Apply the requested scale (fit-to-page or absolute ratio).
 *   4. Open an offscreen canvas at `pxPerMm = dpi / 25.4` and stamp the
 *      world content through the existing `entity.draw(ctx, fileVm, file)`
 *      pipeline — so dimensions / hatches / tables render identically to
 *      the editor view, just at higher resolution.
 *
 * Vector PDF is intentionally out of scope here (Phase 2).
 */
@Injectable({ providedIn: 'root' })
export class PlotRendererService {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);

  /**
   * Compute the world-to-canvas geometry without drawing anything. Used by
   * the dialog to display realised scale / sheet utilisation before commit.
   */
  computeGeometry(opts: IPlotOptions, dpiOverride?: number): IPlotGeometry | null {
    const world = this.computeAreaBounds(opts);
    if (!world) return null;
    const worldW = world.maxX - world.minX;
    const worldH = world.maxY - world.minY;
    if (worldW <= 0 || worldH <= 0) return null;

    const raw = getPaperSizeMm(opts.paper, opts.customPaperMm);
    const paperMm =
      opts.orientation === 'portrait'
        ? { w: Math.min(raw.w, raw.h), h: Math.max(raw.w, raw.h) }
        : { w: Math.max(raw.w, raw.h), h: Math.min(raw.w, raw.h) };

    const printMmW = Math.max(1, paperMm.w - 2 * opts.margin);
    const printMmH = Math.max(1, paperMm.h - 2 * opts.margin);

    // worldPerMm: how many world units fit in 1 mm of paper.
    //   'fit'   → autoscale so the drawing fills the print area
    //   number  → user-chosen ratio (e.g. 100 = 1:100)
    let worldPerMm: number;
    if (opts.scale === 'fit') {
      worldPerMm = Math.max(worldW / printMmW, worldH / printMmH);
    } else {
      worldPerMm = opts.scale;
    }
    if (!Number.isFinite(worldPerMm) || worldPerMm <= 0) return null;

    const dpi = dpiOverride ?? opts.dpi;
    const pxPerMm = dpi / 25.4;
    const canvasPx = {
      w: Math.max(1, Math.round(paperMm.w * pxPerMm)),
      h: Math.max(1, Math.round(paperMm.h * pxPerMm)),
    };

    const mmPerWorld = 1 / worldPerMm;
    const pxPerWorld = pxPerMm * mmPerWorld;

    // Place the drawing on the page: centered (default) or top-left origin.
    // centerDrawing === false → AutoCAD "Plot offset (0,0)": drawing origin
    // placed at the top-left printable corner (margin, margin).
    const center = opts.centerDrawing !== false; // true by default
    let originPx: { x: number; y: number };
    if (center) {
      const cxWorld = (world.minX + world.maxX) / 2;
      const cyWorld = (world.minY + world.maxY) / 2;
      originPx = {
        x: canvasPx.w / 2 - cxWorld * pxPerWorld,
        y: canvasPx.h / 2 + cyWorld * pxPerWorld, // y-flipped
      };
    } else {
      // Top-left printable corner. Paper Y grows down; world Y grows up.
      const marginPx = opts.margin * pxPerMm;
      originPx = {
        x: marginPx - world.minX * pxPerWorld,
        y: canvasPx.h - marginPx + world.minY * pxPerWorld, // y-flipped
      };
    }

    const w2c = (wx: number, wy: number) => ({
      x: originPx.x + wx * pxPerWorld,
      y: originPx.y - wy * pxPerWorld, // y-flipped (paper +Y is up)
    });

    return { world, paperMm, pxPerMm, canvasPx, worldPerMm, w2c };
  }

  /**
   * Draw the plot onto the given 2D context. The context's transform is left
   * untouched; positions are computed via the geometry's `w2c`.
   */
  render(ctx: CanvasRenderingContext2D, opts: IPlotOptions, geom: IPlotGeometry): void {
    this.fillBackground(ctx, opts, geom);

    // Synthesize a VM-shaped object so entity draw() routines can use w2s
    // without knowing they're in plot mode.
    const plotVm = {
      scale: geom.pxPerMm / geom.worldPerMm, // pixels per world unit
      panX: 0,
      panY: 0,
      w2s: geom.w2c,
      s2w: (sx: number, sy: number) => {
        // Inverse of w2c — derive by plugging sx/sy into the forward formula and
        // solving for (wx, wy).  Works for both centered and offset origins.
        const pxPerWorld = geom.pxPerMm / geom.worldPerMm;
        const probe = geom.w2c(0, 0);
        return {
          x: (sx - probe.x) / pxPerWorld,
          y: -(sy - probe.y) / pxPerWorld,
        };
      },
    } as any;

    // Switch entity draws onto the plot pipeline for the duration of this
    // render. setupContext checks these hints and routes through
    // resolvedPlotColor → PlotColorMapper. isPrintMode is also set so legacy
    // paths (anything still using resolvedDisplayColor) treat this as paper.
    const lightBg = opts.background !== 'dark';
    const wasPrintMode = (this.doc as any).isPrintMode;
    const wasPlotStyle = (this.doc as any)._plotStyle;
    const wasPlotLightBg = (this.doc as any)._plotLightBg;
    (this.doc as any).isPrintMode = true;
    (this.doc as any)._plotStyle = opts.plotStyle;
    (this.doc as any)._plotLightBg = lightBg;
    try {
      for (const file of this.doc.files) {
        if (!file.visible) continue;
        ctx.globalAlpha = opts.plotTransparency ? file.opacity : 1;
        // Propagate the plot hints onto each file (entities resolve color
        // through their owning file's `doc` argument, not the global doc).
        (file as any)._plotStyle = opts.plotStyle;
        (file as any)._plotLightBg = lightBg;
        const fileVm = createProxyVm(plotVm, file.x, file.y, file.scale, file.scale, file.rotation);
        for (const ent of file.entities) {
          if (!ent.visible) continue;
          if (opts.area === 'selection' && !ent.selected) continue;
          const lay = file.layers.get(ent.layer);
          if (lay && (lay.print === false || lay.frozen || !lay.visible)) continue;
          ent.draw(ctx, fileVm, file);
        }
        delete (file as any)._plotStyle;
        delete (file as any)._plotLightBg;
      }
      ctx.globalAlpha = 1;
    } finally {
      (this.doc as any).isPrintMode = wasPrintMode;
      (this.doc as any)._plotStyle = wasPlotStyle;
      (this.doc as any)._plotLightBg = wasPlotLightBg;
      // The editor view still wants to redraw at its own resolution.
      this.vm.markDirty();
    }
  }

  /**
   * One-shot helper: compute geometry, allocate a canvas, render, return it.
   * Used by PDF and PNG exporters.
   */
  renderToCanvas(opts: IPlotOptions, dpiOverride?: number): { canvas: HTMLCanvasElement; geom: IPlotGeometry } | null {
    const geom = this.computeGeometry(opts, dpiOverride);
    if (!geom) return null;

    const canvas = document.createElement('canvas');
    canvas.width = geom.canvasPx.w;
    canvas.height = geom.canvasPx.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    this.render(ctx, opts, geom);
    return { canvas, geom };
  }

  /* ─── internals ────────────────────────────────────────────────────────── */

  private fillBackground(ctx: CanvasRenderingContext2D, opts: IPlotOptions, geom: IPlotGeometry): void {
    if (opts.background === 'transparent') return;
    ctx.fillStyle = opts.background === 'dark' ? '#1f1f1f' : '#ffffff';
    ctx.fillRect(0, 0, geom.canvasPx.w, geom.canvasPx.h);
  }

  /** Resolve `area` into a world bbox. */
  private computeAreaBounds(opts: IPlotOptions): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (opts.area === 'window' && opts.windowBounds) {
      return { ...opts.windowBounds };
    }

    if (opts.area === 'display') {
      const w = this.vm.canvasWidth;
      const h = this.vm.canvasHeight;
      if (w <= 0 || h <= 0) return null;
      const tl = this.vm.s2w(0, 0);
      const br = this.vm.s2w(w, h);
      return {
        minX: Math.min(tl.x, br.x),
        minY: Math.min(tl.y, br.y),
        maxX: Math.max(tl.x, br.x),
        maxY: Math.max(tl.y, br.y),
      };
    }

    // 'extents' and 'selection' both walk entities; 'selection' filters first.
    const useSelection = opts.area === 'selection';
    const bounds = this.doc.getValidDrawingBounds(useSelection, false);
    
    if (!bounds) {
      // Selection requested but empty → fall back to extents so the user
      // doesn't get a blank dialog.
      if (useSelection) return this.computeAreaBounds({ ...opts, area: 'extents' });
      return null;
    }
    
    return bounds;
  }
}
