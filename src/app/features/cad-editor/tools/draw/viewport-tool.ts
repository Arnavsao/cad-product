import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { ViewportManagerService } from '../../core/services/viewport-manager.service';

/**
 * Paper-space viewport tool — two-corner click defines a viewport rectangle.
 *
 * Unlike the previous draft, the result is NOT a model-space entity; it's a
 * `Viewport` registered with ViewportManagerService. Each viewport carries its
 * own independent camera. Port of `ViewportTool` from 45-viewport-system.js.
 */
export class ViewportTool implements ITool {
  readonly name = 'viewport';
  private p1: { sx: number; sy: number } | null = null;
  private cur: { sx: number; sy: number } | null = null;

  constructor(private injector: Injector) {}

  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get vps() { return this.injector.get(ViewportManagerService) as ViewportManagerService; }

  onMouseDown(_wx: number, _wy: number, sx: number, sy: number): void {
    if (!this.p1) {
      this.p1 = { sx, sy };
      return;
    }
    const x = Math.min(this.p1.sx, sx);
    const y = Math.min(this.p1.sy, sy);
    const w = Math.abs(sx - this.p1.sx);
    const h = Math.abs(sy - this.p1.sy);
    if (w > 40 && h > 40) {
      this.vps.add(x, y, w, h);
    }
    this.p1 = null;
    this.cur = null;
    this.tools.setTool('select');
  }

  onMouseMove(_wx: number, _wy: number, sx: number, sy: number): void {
    if (this.p1) {
      this.cur = { sx, sy };
      this.vm.markDirty();
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.p1 || !this.cur) return;
    const x = Math.min(this.p1.sx, this.cur.sx);
    const y = Math.min(this.p1.sy, this.cur.sy);
    const w = Math.abs(this.cur.sx - this.p1.sx);
    const h = Math.abs(this.cur.sy - this.p1.sy);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#499bea';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(73,155,234,0.07)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.p1 = null;
      this.cur = null;
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  deactivate(): void {
    this.p1 = null;
    this.cur = null;
  }
}
