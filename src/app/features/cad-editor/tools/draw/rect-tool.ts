import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { makeRect, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { evalExpression, parseCadVector } from '../../core/utils/expression-parser';
import { formatLen } from './draw-utils';

export class RectTool implements ITool {
  readonly name = 'rect';
  private p1: IPoint | null = null;
  private cur: IPoint = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  onMouseDown(wx: number, wy: number): void {
    const pt = { x: wx, y: wy };
    if (!this.p1) {
      this.p1 = pt;
      this.dyn.clearEdits();
    } else {
      const corner = this.previewCorner();
      if (Math.abs(corner.x - this.p1.x) > 1e-6 && Math.abs(corner.y - this.p1.y) > 1e-6) {
        const e = makeRect(this.p1.x, this.p1.y, corner.x, corner.y);
        e.layer = this.doc.activeLayer;
        this.cmds.push(new AddEntityCmd(e, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
      }
      this.p1 = null;
      this.dyn.clearEdits();
    }
    this.vm.markDirty();
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.p1) this.vm.markDirty();
  }

  /**
   * Width/Height for the live preview.
   *
   * If the user has typed a value into a field, its magnitude is used but the SIGN comes
   * from the current cursor quadrant relative to p1. This mirrors AutoCAD: type 100Ã—50
   * with the cursor to the bottom-left â†’ the rect grows bottom-left from p1.
   */
  private effectiveSize(): { width: number; height: number } {
    if (!this.p1) return { width: 0, height: 0 };
    const liveW = this.cur.x - this.p1.x;
    const liveH = this.cur.y - this.p1.y;
    const signX = liveW < 0 ? -1 : 1;
    const signY = liveH < 0 ? -1 : 1;
    let width = liveW;
    let height = liveH;
    const edits = this.dyn.editedValues();
    const ew = edits['width'];
    if (ew !== undefined) {
      const n = evalExpression(ew);
      if (n !== null) width = Math.abs(n) * signX;
    }
    const eh = edits['height'];
    if (eh !== undefined) {
      const n = evalExpression(eh);
      if (n !== null) height = Math.abs(n) * signY;
    }
    return { width, height };
  }

  private previewCorner(): IPoint {
    if (!this.p1) return this.cur;
    const { width, height } = this.effectiveSize();
    return { x: this.p1.x + width, y: this.p1.y + height };
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.p1) return;
    const corner = this.previewCorner();
    const a = this.vm.w2s(this.p1.x, this.p1.y);
    const b = this.vm.w2s(corner.x, corner.y);
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    ctx.restore();
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.p1) return null;
    const { width, height } = this.effectiveSize();
    const corner = this.previewCorner();
    return {
      wx: corner.x,
      wy: corner.y,
      primaryFieldKey: 'width',
      fields: [
        { key: 'width', label: 'Width', liveValue: formatLen(Math.abs(width)) },
        { key: 'height', label: 'Height', liveValue: formatLen(Math.abs(height)) },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (!this.p1) return false;
    const signX = this.cur.x - this.p1.x < 0 ? -1 : 1;
    const signY = this.cur.y - this.p1.y < 0 ? -1 : 1;
    // Allow `100,50` typed into the Width field to set both at once.
    const widthRaw = values['width'] ?? '';
    const vec = parseCadVector(widthRaw);
    let width: number | null = null;
    let height: number | null = null;
    if (vec && vec.kind === 'cartesian' && vec.dx !== undefined && vec.dy !== undefined) {
      width = Math.abs(vec.dx) * signX;
      height = Math.abs(vec.dy) * signY;
    } else {
      const w = evalExpression(widthRaw);
      const h = evalExpression(values['height'] ?? '');
      if (w !== null) width = Math.abs(w) * signX;
      if (h !== null) height = Math.abs(h) * signY;
    }
    if (width === null || height === null) return false;
    if (Math.abs(width) < 1e-6 || Math.abs(height) < 1e-6) return false;
    const e = makeRect(this.p1.x, this.p1.y, this.p1.x + width, this.p1.y + height);
    e.layer = this.doc.activeLayer;
    this.cmds.push(new AddEntityCmd(e, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    this.p1 = null;
    this.dyn.clearEdits();
    this.vm.markDirty();
    return true;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.p1 = null;
      this.dyn.clearEdits();
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  getAnchor(): IPoint | null { return this.p1; }

  getPhase(): string | null {
    return this.p1 ? 'opposite' : 'first';
  }

  deactivate(): void {
    this.p1 = null;
    this.dyn.clearEdits();
    this.dyn.setState(null);
    this.vm.markDirty();
  }
}
