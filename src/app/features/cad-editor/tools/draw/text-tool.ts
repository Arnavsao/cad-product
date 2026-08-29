import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { TextEditorService } from '../../features/text-editor/text-editor.service';

/**
 * MTEXT/TEXT tool.
 *
 * Workflow:
 *   1. Click and release: Places an unconstrained single-line TEXT.
 *   2. Click and drag: Places a width-constrained auto-wrapping MTEXT block.
 */
export class TextTool implements ITool {
  readonly name = 'text';

  private p1: { wx: number; wy: number; sx: number; sy: number } | null = null;
  private p2: { wx: number; wy: number } | null = null;
  private isDragging = false;

  constructor(private injector: Injector) { }

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get textEditor() { return this.injector.get(TextEditorService) as TextEditorService; }

  onMouseDown(wx: number, wy: number, sx: number, sy: number): void {
    if (!this.p1) {
      this.p1 = { wx, wy, sx, sy };
      this.p2 = { wx, wy };
      this.isDragging = true;
    }
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number): void {
    if (this.isDragging && this.p1) {
      this.p2 = { wx, wy };
      this.vm.markDirty();
    }
  }

  onMouseUp(wx: number, wy: number, sx: number, sy: number): void {
    if (this.isDragging && this.p1) {
      this.p2 = { wx, wy };

      const dxScreen = sx - this.p1.sx;
      const dyScreen = sy - this.p1.sy;
      const dist = Math.sqrt(dxScreen * dxScreen + dyScreen * dyScreen);

      let mtextWidth = 0;
      let placement = { x: this.p1.wx, y: this.p1.wy };

      // If dragged more than 5 screen pixels, treat as an MTEXT boundary.
      if (dist > 5) {
        mtextWidth = Math.abs(this.p2.wx - this.p1.wx);
        // Anchor at the top-left of the drawn rectangle in world space (Y is usually up, so top-left means minX, maxY)
        // Or we can just keep p1 as the anchor and let mtextWidth constrain it.
        // Usually, MTEXT anchors at the top-left corner of the dragged rectangle.
        placement = {
          x: Math.min(this.p1.wx, this.p2.wx),
          y: Math.max(this.p1.wy, this.p2.wy)
        };
      }

      setTimeout(() => {
        this.textEditor.openForNew(placement, mtextWidth);
      }, 0);

      this.p1 = null;
      this.p2 = null;
      this.isDragging = false;
      this.vm.markDirty();
    }
  }

  getPhase(): string { return this.p1 ? 'enter' : 'point'; }

  getAnchor(): IPoint | null { return this.p1 ? { x: this.p1.wx, y: this.p1.wy } : null; }

  getDynamicInputState(): IDynamicInputState | null { return null; }
  commitDynamicInput(values: Record<string, string>): boolean { return false; }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.p1 = null;
      this.p2 = null;
      this.isDragging = false;
      this.vm.markDirty();
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.isDragging && this.p1 && this.p2) {
      const s1 = this.vm.w2s(this.p1.wx, this.p1.wy);
      const s2 = this.vm.w2s(this.p2.wx, this.p2.wy);

      ctx.save();
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)'; // cad-accent
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      // Draw from s1 to s2
      ctx.rect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  deactivate(): void {
    this.p1 = null;
    this.p2 = null;
    this.isDragging = false;
  }
}
