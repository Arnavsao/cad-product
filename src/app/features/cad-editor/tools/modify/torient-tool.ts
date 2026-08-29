import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { getSelectedEntities, hitTestAll } from '../select/select-tool';
import { snapshotEntity } from '../geometry-utils';
import { evalExpression } from '../../core/utils/expression-parser';
import { formatAngleDeg } from '../draw/draw-utils';
import { commitEntityTransforms } from '../drag-preview';

export class TorientTool implements ITool {
  readonly name = 'torient';
  private p1: IPoint | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  private targets: Entity[] = [];

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  activate(): void {
    this.targets = this.getValidEntities(getSelectedEntities(this.doc));
  }

  private getValidEntities(entities: Entity[]): Entity[] {
    return entities.filter(e => e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'INSERT');
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (!this.targets.length) {
      this.targets = this.getValidEntities(getSelectedEntities(this.doc));
    }
    
    // If still nothing selected, try to click-select like the JS version
    if (!this.targets.length) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit && (hit.entity.type === 'TEXT' || hit.entity.type === 'MTEXT' || hit.entity.type === 'INSERT')) {
        hit.entity.selected = true;
        this.targets = [hit.entity];
        this.vm.markContentDirty();
      }
      return;
    }

    if (!this.p1) {
      this.p1 = { x: wx, y: wy };
      this.dyn.clearEdits();
      return;
    }

    // We have P2!
    const rad = Math.atan2(wy - this.p1.y, wx - this.p1.x);
    this.applyRotation(rad);
  }

  private applyRotation(rad: number): boolean {
    if (!this.targets.length) return false;
    
    // Convert to degrees for INSERT entities
    const deg = rad * 180 / Math.PI;

    const snapshots = this.targets.map(ent => ({ ent, snap: snapshotEntity(ent) }));
    
    commitEntityTransforms(snapshots, (ent: any) => {
      if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
        ent.rotation = rad;
      } else if (ent.type === 'INSERT') {
        ent.rotation = deg;
      }
      ent.refreshCaches();
    }, this.cmds, this.vm);

    this.cleanup();
    this.dyn.clearEdits();
    this.tools.setTool('select');
    return true;
  }

  private cleanup(): void {
    this.p1 = null;
    this.targets = [];
    this.vm.markContentDirty();
  }
  
  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (!this.p1) return;
    this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.p1) return;
    const a = this.vm.w2s(this.p1.x, this.p1.y);
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

  getAnchor(): IPoint | null { return this.p1; }

  getPhase(): string {
    if (!this.targets.length) return 'select';
    if (!this.p1) return 'angle';
    return 'second-point';
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.targets.length) return null;
    
    if (!this.p1) {
      return {
        wx: this.cur.x,
        wy: this.cur.y,
        primaryFieldKey: 'angle',
        fields: [
          { key: 'angle', label: 'Angle', liveValue: '', suffix: '°', width: 70 },
        ],
      };
    } else {
      const liveDeg = Math.atan2(this.cur.y - this.p1.y, this.cur.x - this.p1.x) * 180 / Math.PI;
      return {
        wx: this.cur.x,
        wy: this.cur.y,
        primaryFieldKey: 'angle',
        fields: [
          { key: 'angle', label: 'Angle', liveValue: formatAngleDeg(liveDeg), suffix: '°', width: 70 },
        ],
      };
    }
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    const deg = evalExpression(values['angle'] ?? '');
    if (deg === null) return false;
    return this.applyRotation(deg * Math.PI / 180);
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.p1) {
        this.p1 = null;
        this.vm.markDirty();
      } else {
        this.tools.setTool('select');
      }
    }
  }

  deactivate(): void {
    this.cleanup();
  }
}
