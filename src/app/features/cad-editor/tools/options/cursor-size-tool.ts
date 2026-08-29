import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';

/**
 * CURSORSIZE — sets the crosshair arm length as a percentage of the screen
 * height (1–100). Mirrors AutoCAD's CURSORSIZE system variable.
 *
 * After activation the DYN overlay immediately focuses the value field.
 * Live preview: every keystroke redraws the crosshair at the typed size.
 */
export class CursorSizeTool implements ITool {
  readonly name = 'cursorsize';

  private vm: ViewModelService;
  private toolMgr: ToolManagerService;
  private dyn: DynamicInputService;

  constructor(injector: Injector) {
    this.vm = injector.get(ViewModelService);
    this.toolMgr = injector.get(ToolManagerService);
    this.dyn = injector.get(DynamicInputService);
  }

  activate(): void {
    // Give Angular one rAF to render the overlay, then auto-focus.
    setTimeout(() => this.dyn.focusPrimaryField(), 50);
  }

  deactivate(): void { }

  getDynamicInputState(): IDynamicInputState | null {
    const { x, y } = this.vm.lastCursorWorld;
    return {
      wx: x,
      wy: y,
      primaryFieldKey: 'value',
      fields: [{
        key: 'value',
        label: `CURSORSIZE (1-100) <${this.vm.cursorSize}>:`,
        liveValue: String(this.vm.cursorSize),
        width: 90,
      }],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    const raw = values['value']?.trim() ?? '';
    const v = parseInt(raw, 10);
    if (isNaN(v) || v < 1 || v > 100) return false;
    this.vm.cursorSize = v;
    this.vm.markDirty();
    this.toolMgr.setTool('select');
    return true;
  }

  /**
   * Live crosshair-size preview drawn on the dynamic canvas every rAF frame.
   * Shows a white crosshair at the current cursor position using the size that
   * the user has currently typed (falls back to the stored value if empty).
   */
  drawPreview(ctx: CanvasRenderingContext2D): void {
    const edits = this.dyn.editedValues();
    const raw = edits['value']?.trim() ?? '';
    const parsed = parseInt(raw, 10);
    const previewSize = !isNaN(parsed) && parsed >= 1 && parsed <= 100
      ? parsed
      : this.vm.cursorSize;

    const sp = this.vm.w2s(this.vm.lastCursorWorld.x, this.vm.lastCursorWorld.y);
    const mx = sp.x;
    const my = sp.y;

    const sizePct = previewSize / 100;
    const lineLen = Math.max(this.vm.canvasWidth, this.vm.canvasHeight) * sizePct / 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.85)'; // orange tint for preview
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(mx - lineLen, my);
    ctx.lineTo(mx + lineLen, my);
    ctx.moveTo(mx, my - lineLen);
    ctx.lineTo(mx, my + lineLen);
    ctx.stroke();
    ctx.restore();
  }
}
