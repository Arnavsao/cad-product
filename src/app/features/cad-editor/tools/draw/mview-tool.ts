// @ts-nocheck
/**
 * MView Tool — creates Paper Space viewports.
 *
 * AutoCAD command: MVIEW (alias MV)
 *
 * Workflow:
 *   1. User is on a Layout tab (PSPACE mode).
 *   2. Activates MVIEW tool.
 *   3. Clicks first corner on the paper sheet (paper-mm coords).
 *   4. Drags/clicks second corner.
 *   5. A new PaperViewport is created in the active layout.
 *   6. Tool returns to Select.
 *
 * Paper-space coordinates (mm) are obtained via PaperSpaceRendererService,
 * which provides the screen → paper-mm conversion.
 */
import { Injector } from '@angular/core';
import type { ITool } from '../../core/models/tool.interface';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { LayoutManagerService } from '../../core/services/layout-manager.service';
import { PaperSpaceRendererService } from '../../core/services/paper-space-renderer.service';
import { NotificationService } from '../../../../core/services/notification.service';

export class MViewTool implements ITool {
  readonly name = 'mview';

  private p1: { mmX: number; mmY: number } | null = null;
  private cur: { mmX: number; mmY: number } | null = null;

  constructor(private injector: Injector) {}

  private get vm()         { return this.injector.get(ViewModelService) as ViewModelService; }
  private get tools()      { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get layoutMgr()  { return this.injector.get(LayoutManagerService) as LayoutManagerService; }
  private get paperRenderer() { return this.injector.get(PaperSpaceRendererService) as PaperSpaceRendererService; }
  private get notify()     { return this.injector.get(NotificationService) as NotificationService; }

  activate(): void {
    // Guard: only usable in PSPACE mode on a Layout tab.
    if (this.layoutMgr.isModelSpace() || this.layoutMgr.workspaceMode() === 'MSPACE') {
      this.notify.info('MVIEW — Switch to a Layout tab (Paper Space) first.', 3000);
      this.tools.setTool('select');
    }
  }

  onMouseDown(_wx: number, _wy: number, sx: number, sy: number): void {
    const layout = this.layoutMgr.activeLayout();
    if (layout.isModel) { this.tools.setTool('select'); return; }

    const geom = this.paperRenderer.computePaperGeometry(layout);
    const mm   = geom.s2mm(sx, sy);

    if (!this.p1) {
      this.p1  = { mmX: mm.x, mmY: mm.y };
      return;
    }

    // Second click — commit
    const x = Math.min(this.p1.mmX, mm.x);
    const y = Math.min(this.p1.mmY, mm.y);
    const w = Math.abs(mm.x - this.p1.mmX);
    const h = Math.abs(mm.y - this.p1.mmY);

    // Minimum size: 10 mm × 10 mm
    if (w >= 10 && h >= 10) {
      this.layoutMgr.addViewportToActiveLayout(x, y, w, h);
    } else {
      this.notify.info('Viewport too small (minimum 10 × 10 mm).', 2000);
    }

    this.p1  = null;
    this.cur = null;
    this.tools.setTool('select');
  }

  onMouseMove(_wx: number, _wy: number, sx: number, sy: number): void {
    if (!this.p1) return;
    const layout = this.layoutMgr.activeLayout();
    if (layout.isModel) return;
    const geom = this.paperRenderer.computePaperGeometry(layout);
    const mm   = geom.s2mm(sx, sy);
    this.cur   = { mmX: mm.x, mmY: mm.y };
    this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.p1 || !this.cur) return;

    const layout = this.layoutMgr.activeLayout();
    if (layout.isModel) return;
    const geom = this.paperRenderer.computePaperGeometry(layout);

    const tl = geom.mm2s(
      Math.min(this.p1.mmX, this.cur.mmX),
      Math.max(this.p1.mmY, this.cur.mmY),
    );
    const br = geom.mm2s(
      Math.max(this.p1.mmX, this.cur.mmX),
      Math.min(this.p1.mmY, this.cur.mmY),
    );

    const sw = br.x - tl.x;
    const sh = br.y - tl.y;

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#499bea';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(tl.x, tl.y, sw, sh);
    ctx.fillStyle   = 'rgba(73,155,234,0.07)';
    ctx.fillRect(tl.x, tl.y, sw, sh);
    // Dimensions label
    if (sw > 60 && sh > 20) {
      const mmW = Math.abs(this.cur.mmX - this.p1.mmX).toFixed(0);
      const mmH = Math.abs(this.cur.mmY - this.p1.mmY).toFixed(0);
      ctx.font      = '10px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#499bea';
      ctx.setLineDash([]);
      ctx.fillText(`${mmW} × ${mmH} mm`, tl.x + 6, tl.y + 14);
    }
    ctx.restore();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.cancel();
    }
  }

  deactivate(): void {
    this.cancel();
  }

  private cancel(): void {
    this.p1  = null;
    this.cur = null;
    this.vm.markDirty();
    this.tools.setTool('select');
  }
}
