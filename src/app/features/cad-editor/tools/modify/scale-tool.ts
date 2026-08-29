import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { getSelectedEntities, hitTestAll } from '../select/select-tool';
import { scaleEntityInPlace, snapshotEntity } from '../geometry-utils';
import { beginDragPreview, endDragPreview, drawTransformGhost, commitEntityTransforms } from '../drag-preview';
import { evalExpression } from '../../core/utils/expression-parser';

export class ScaleTool implements ITool {
  readonly name = 'scale';
  private basePoint: IPoint | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  private targets: Entity[] = [];
  private snapshots: { ent: Entity; snap: Record<string, unknown> }[] = [];

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  activate(): void {
    this.targets = getSelectedEntities(this.doc);
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (!this.targets.length) this.targets = getSelectedEntities(this.doc);
    if (!this.targets.length) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit) { hit.entity.selected = true; this.targets = [hit.entity]; this.vm.markContentDirty(); }
      return;
    }

    if (!this.basePoint) {
      this.basePoint = { x: wx, y: wy };
      this.snapshots = this.targets.map((ent) => ({ ent, snap: snapshotEntity(ent) }));
      beginDragPreview(this.vm, this.targets);
      this.dyn.clearEdits();
      return;
    }

    const dist = Math.hypot(wx - this.basePoint.x, wy - this.basePoint.y);
    const factor = Math.max(0.001, dist / 100.0);
    this.applyFactor(factor);
  }

  private applyFactor(factor: number): boolean {
    if (!this.basePoint) return false;
    if (!Number.isFinite(factor) || factor < 1e-6) {
      this.cancel();
      return false;
    }
    const cx = this.basePoint.x;
    const cy = this.basePoint.y;
    // Entities were never mutated during the drag (ghost-only preview) — apply
    // once and record as a single atomic undo step.
    commitEntityTransforms(this.snapshots, (e: any) => scaleEntityInPlace(e, cx, cy, factor), this.cmds, this.vm);
    this.cleanup();
    this.dyn.clearEdits();
    this.tools.setTool('select');
    return true;
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (!this.basePoint) return;
    // Ghost-only preview: drawPreview() renders the scaling ghost.
    this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.basePoint) return;
    const dist = Math.hypot(this.cur.x - this.basePoint.x, this.cur.y - this.basePoint.y);
    const factor = Math.max(0.001, dist / 100.0);
    if (Number.isFinite(factor)) {
      drawTransformGhost(ctx, this.vm, this.doc, this.targets, {
        kind: 'scale', cx: this.basePoint.x, cy: this.basePoint.y, factor,
      });
    }
    const a = this.vm.w2s(this.basePoint.x, this.basePoint.y);
    const b = this.vm.w2s(this.cur.x, this.cur.y);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
  }

  getAnchor(): IPoint | null { return this.basePoint; }

  getPhase(): string {
    if (!this.targets.length) return 'select';
    if (!this.basePoint) return 'base';
    return 'factor';
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.basePoint) return null;
    const d = Math.hypot(this.cur.x - this.basePoint.x, this.cur.y - this.basePoint.y);
    const factor = Math.max(0.001, d / 100.0);
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      primaryFieldKey: 'factor',
      fields: [
        { key: 'factor', label: 'Factor', liveValue: factor.toFixed(3), width: 70 },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (!this.basePoint) return false;
    const f = evalExpression(values['factor'] ?? '1.0');
    if (f === null || f <= 0) return false;
    return this.applyFactor(f);
  }

  private cancel(): void {
    this.cleanup();
    this.vm.markDirty();
  }

  private cleanup(): void {
    endDragPreview(this.vm);
    this.basePoint = null;
    this.snapshots = [];
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.cancel();
      this.tools.setTool('select');
    }
  }

  deactivate(): void {
    this.cancel();
  }
}
