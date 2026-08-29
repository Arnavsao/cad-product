import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { getSelectedEntities, hitTestAll } from '../select/select-tool';
import { rotateEntityInPlace, snapshotEntity } from '../geometry-utils';
import { beginDragPreview, endDragPreview, drawTransformGhost, commitEntityTransforms } from '../drag-preview';
import { evalExpression } from '../../core/utils/expression-parser';
import { formatAngleDeg } from '../draw/draw-utils';

export class RotateTool implements ITool {
  readonly name = 'rotate';
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
    // If still nothing selected, try to click-select like the JS version
    if (!this.targets.length) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit) {
        hit.entity.selected = true;
        this.targets = [hit.entity];
        this.vm.markContentDirty();
      }
      return;
    }

    if (!this.basePoint) {
      this.basePoint = { x: wx, y: wy };
      this.snapshots = this.targets.map((ent) => ({ ent, snap: snapshotEntity(ent) }));
      beginDragPreview(this.vm, this.targets);
      this.dyn.clearEdits();
      return;
    }

    const rad = Math.atan2(wy - this.basePoint.y, wx - this.basePoint.x);
    this.applyRotation(rad);
  }

  private applyRotation(rad: number): boolean {
    if (!this.basePoint) return false;
    const cx = this.basePoint.x;
    const cy = this.basePoint.y;
    // Entities were never mutated during the drag (ghost-only preview) — apply
    // once and record as a single atomic undo step.
    commitEntityTransforms(this.snapshots, (e: any) => rotateEntityInPlace(e, cx, cy, rad), this.cmds, this.vm);
    this.cleanup();
    this.dyn.clearEdits();
    this.tools.setTool('select');
    return true;
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (!this.basePoint) return;
    // Ghost-only preview: drawPreview() renders the rotating ghost.
    this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.basePoint) return;
    const rad = Math.atan2(this.cur.y - this.basePoint.y, this.cur.x - this.basePoint.x);
    drawTransformGhost(ctx, this.vm, this.doc, this.targets, {
      kind: 'rotate', cx: this.basePoint.x, cy: this.basePoint.y, rad,
    });
    const a = this.vm.w2s(this.basePoint.x, this.basePoint.y);
    const b = this.vm.w2s(this.cur.x, this.cur.y);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    ctx.restore();
  }

  getAnchor(): IPoint | null { return this.basePoint; }

  getPhase(): string {
    if (!this.targets.length) return 'select';
    if (!this.basePoint) return 'base';
    return 'angle';
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.basePoint) return null;
    const liveDeg = Math.atan2(this.cur.y - this.basePoint.y, this.cur.x - this.basePoint.x) * 180 / Math.PI;
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      primaryFieldKey: 'angle',
      fields: [
        { key: 'angle', label: 'Angle', liveValue: formatAngleDeg(liveDeg), suffix: '°', width: 70 },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (!this.basePoint) return false;
    const deg = evalExpression(values['angle'] ?? '');
    if (deg === null) return false;
    return this.applyRotation(deg * Math.PI / 180);
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.cleanup();
      this.tools.setTool('select');
    }
  }

  deactivate(): void {
    this.cleanup();
  }

  private cleanup(): void {
    endDragPreview(this.vm);
    this.snapshots = [];
    this.basePoint = null;
  }
}
