import { Injector } from '@angular/core';
import { ITool } from '../core/models/tool.interface';
import { ViewModelService } from '../core/services/view-model.service';
import { ToolManagerService } from '../core/services/tool-manager.service';
import { PlotWindowPickService } from '../features/plot-dialog/plot-window-pick.service';

/**
 * Temporary tool activated when the user clicks "Pick Window" in the Plot dialog.
 *
 * The user clicks two corners; the tool hands the world-space bounds back to
 * `PlotWindowPickService.resolve()` and immediately deactivates, returning to
 * the Select tool.  The Plot dialog then re-opens with `area='window'` and the
 * picked bounds already set.
 *
 * Esc cancels the pick (resolve is called with null).
 *
 * Visual feedback: while dragging a dashed magenta rectangle is drawn over the
 * canvas via `drawPreview()`.
 */
export class PlotWindowTool implements ITool {
  readonly name = 'plot_window';

  private p1: { x: number; y: number } | null = null;
  private cur: { x: number; y: number } = { x: 0, y: 0 };

  private vm: ViewModelService;
  private tools: ToolManagerService;
  private picker: PlotWindowPickService;

  constructor(injector: Injector) {
    this.vm = injector.get(ViewModelService);
    this.tools = injector.get(ToolManagerService);
    this.picker = injector.get(PlotWindowPickService);
  }

  activate(): void {
    this.p1 = null;
  }

  deactivate(): void {
    this.p1 = null;
    this.vm.markDirty();
  }

  getCursor(): string { return 'crosshair'; }

  onMouseDown(wx: number, wy: number): void {
    if (!this.p1) {
      this.p1 = { x: wx, y: wy };
    } else {
      this.finish(wx, wy);
    }
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.p1) this.vm.markDirty();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.p1) return;
    const a = this.vm.w2s(this.p1.x, this.p1.y);
    const b = this.vm.w2s(this.cur.x, this.cur.y);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ff00ff';
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y),
    );
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y),
    );
    ctx.restore();
  }

  private finish(wx: number, wy: number): void {
    if (!this.p1) return;
    const bounds = {
      minX: Math.min(this.p1.x, wx),
      minY: Math.min(this.p1.y, wy),
      maxX: Math.max(this.p1.x, wx),
      maxY: Math.max(this.p1.y, wy),
    };
    // Guard: zero-area window is useless — just cancel.
    if (bounds.maxX - bounds.minX < 1e-6 || bounds.maxY - bounds.minY < 1e-6) {
      this.cancel();
      return;
    }
    this.tools.setTool('select');
    this.picker.resolve(bounds);
  }

  private cancel(): void {
    this.tools.setTool('select');
    this.picker.resolve(null);
  }
}
