import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';

/**
 * PICKBOXSIZE — sets the half-width of the square selection box at the cursor
 * centre, in screen pixels (0–50). Mirrors AutoCAD's PICKBOX system variable.
 *
 * After activation the DYN overlay immediately focuses the value field.
 * Live preview: shows the pickbox square at the typed size every rAF frame.
 */
export class PickboxTool implements ITool {
  readonly name = 'pickboxsize';

  private vm: ViewModelService;
  private toolMgr: ToolManagerService;
  private dyn: DynamicInputService;

  constructor(injector: Injector) {
    this.vm = injector.get(ViewModelService);
    this.toolMgr = injector.get(ToolManagerService);
    this.dyn = injector.get(DynamicInputService);
  }

  activate(): void {
    setTimeout(() => this.dyn.focusPrimaryField(), 50);
  }

  deactivate(): void { }

  getDynamicInputState(): IDynamicInputState | null {
    const { x, y } = this.vm.lastCursorWorld;
    return {
      wx: x, wy: y,
      primaryFieldKey: 'value',
      fields: [{
        key: 'value',
        label: `PICKBOXSIZE (0-50) <${this.vm.pickboxSize}>:`,
        liveValue: String(this.vm.pickboxSize),
        width: 90,
      }],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    const raw = values['value']?.trim() ?? '';
    const v = parseInt(raw, 10);
    if (isNaN(v) || v < 0 || v > 50) return false;
    this.vm.pickboxSize = v;
    this.vm.markDirty();
    this.toolMgr.setTool('select');
    return true;
  }

  /**
   * Live pickbox-size preview drawn on the dynamic canvas every rAF frame.
   * Shows the full pickbox cursor (crosshair + square) using the typed size.
   */
  drawPreview(ctx: CanvasRenderingContext2D): void {
    const edits = this.dyn.editedValues();
    const raw = edits['value']?.trim() ?? '';
    const parsed = parseInt(raw, 10);
    const previewBox = !isNaN(parsed) && parsed >= 0 && parsed <= 50
      ? parsed
      : this.vm.pickboxSize;

    const sp = this.vm.w2s(this.vm.lastCursorWorld.x, this.vm.lastCursorWorld.y);
    const mx = sp.x;
    const my = sp.y;

    const sizePct = this.vm.cursorSize / 100;
    const lineLen = Math.max(this.vm.canvasWidth, this.vm.canvasHeight) * sizePct / 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    // Crosshair arms (gap at box)
    ctx.moveTo(mx - lineLen, my); ctx.lineTo(mx - previewBox, my);
    ctx.moveTo(mx + previewBox, my); ctx.lineTo(mx + lineLen, my);
    ctx.moveTo(mx, my - lineLen); ctx.lineTo(mx, my - previewBox);
    ctx.moveTo(mx, my + previewBox); ctx.lineTo(mx, my + lineLen);
    ctx.stroke();
    // Pickbox square (solid)
    ctx.setLineDash([]);
    ctx.strokeRect(mx - previewBox, my - previewBox, previewBox * 2, previewBox * 2);
    ctx.restore();
  }
}
