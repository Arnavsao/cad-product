import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { formatLen } from '../draw/draw-utils';
import { drawInfoLabel, formatMeasure, formatPointXYZ } from './measure-geom';

/**
 * AutoCAD-style ID (inquiry) command tool.
 *
 * Single phase `point`: one click reports the X, Y and Z (always 0 in this
 * 2D editor) of the picked point, using whatever object snap the host applied.
 *
 * A small marker cross is painted at the identified point and kept on screen
 * while the tool remains active — AutoCAD's ID leaves a blip there. Because
 * `drawPreview` only runs while this tool owns the canvas, the return to
 * SELECT happens on the next input (another click picks a new point, Enter or
 * Escape leaves), which keeps the marker visible instead of flashing for one
 * frame and vanishing.
 *
 * Strictly read-only: nothing is added to the document and nothing is pushed
 * onto the command stack.
 */
export class IdTool implements ITool {
  readonly name = 'id';

  /** Last identified point — AutoCAD's LASTPOINT system variable analogue. */
  static lastPoint: IPoint | null = null;

  private marked: IPoint | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  private hasCursor = false;

  constructor(private injector: Injector) {}

  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get notify() { return this.injector.get(NotificationService) as NotificationService; }

  activate(): void {
    this.marked = null;
    const last = this.vm.lastCursorWorld;
    if (last && Number.isFinite(last.x) && Number.isFinite(last.y)) {
      this.cur = { x: last.x, y: last.y };
    }
  }

  deactivate(): void {
    this.marked = null;
    this.hasCursor = false;
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number, _sx: number, _sy: number, e: MouseEvent): void {
    if (e && e.button !== 0) return;
    const pt: IPoint = { x: wx, y: wy };
    this.marked = pt;
    IdTool.lastPoint = pt;

    const text = formatPointXYZ(pt);
    // AutoCAD's ID echoes into the text window; the console is the stand-in here.
    console.info('[ID]\n' + text);
    this.notify.info(text, 6000);
    this.vm.markDirty();
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    this.hasCursor = true;
    this.vm.markDirty();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter') {
      this.marked = null;
      this.tools.setTool('select');
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.setLineDash([]);

    if (this.marked) {
      const s = this.vm.w2s(this.marked.x, this.marked.y);
      ctx.strokeStyle = '#f0a030';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x - 9, s.y); ctx.lineTo(s.x + 9, s.y);
      ctx.moveTo(s.x, s.y - 9); ctx.lineTo(s.x, s.y + 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.restore();
      drawInfoLabel(ctx, s.x, s.y, [
        `X ${formatMeasure(this.marked.x)}`,
        `Y ${formatMeasure(this.marked.y)}`,
        `Z ${formatMeasure(0)}`,
      ]);
      return;
    }

    if (this.hasCursor) {
      const s = this.vm.w2s(this.cur.x, this.cur.y);
      ctx.setLineDash([]);
      ctx.restore();
      drawInfoLabel(ctx, s.x, s.y, [
        `X ${formatMeasure(this.cur.x)}`,
        `Y ${formatMeasure(this.cur.y)}`,
      ]);
      return;
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  getAnchor(): IPoint | null { return this.marked; }

  getPhase(): string | null { return 'point'; }

  getCommandId(): string { return 'id'; }

  getCursor(): string { return 'crosshair'; }

  getStatusText(): string {
    return this.marked
      ? 'ID — point identified; click again for another, Enter/Esc to exit'
      : 'ID — specify a point';
  }

  /** Read-only live readout — ID never accepts typed geometry. */
  getDynamicInputState(): IDynamicInputState | null {
    const p = this.marked ?? this.cur;
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      fields: [
        { key: 'x', label: 'X', liveValue: formatLen(p.x), readonly: true, width: 90 },
        { key: 'y', label: 'Y', liveValue: formatLen(p.y), readonly: true, width: 90 },
        { key: 'z', label: 'Z', liveValue: '0', readonly: true, width: 60 },
      ],
    };
  }
}
