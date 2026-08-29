import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint, Entity } from '../../core/models/entity.model';
import { RadiusDimensionEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { SpatialIndexService } from '../../core/services/spatial-index.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';

export class DimRadiusTool implements ITool {
  readonly name = 'dimradius';
  private phase: 'select' | 'dimline' = 'select';
  private targetEntity: Entity | null = null;
  private center: IPoint | null = null;
  private arcPoint: IPoint | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  private curScreen = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get spatial() { return this.injector.get(SpatialIndexService) as SpatialIndexService; }

  onMouseMove(wx: number, wy: number, sx: number, sy: number): void {
    this.cur = { x: wx, y: wy };
    this.curScreen = { x: sx, y: sy };
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number): void {
    if (this.phase === 'select') {
      const hit = hitTestAll(this.doc, this.vm, this.curScreen.x, this.curScreen.y, this.spatial);
      if (hit && (hit.entity.type === 'ARC' || hit.entity.type === 'CIRCLE')) {
        this.targetEntity = hit.entity;
        const e = hit.entity as any;
        this.center = { x: e.cx, y: e.cy };
        const r = e.r ?? e.radius ?? 10;
        const dx = wx - this.center.x, dy = wy - this.center.y;
        const d = Math.hypot(dx, dy);
        this.arcPoint = d > 1e-9
          ? { x: this.center.x + (dx / d) * r, y: this.center.y + (dy / d) * r }
          : { x: this.center.x + r, y: this.center.y };
        this.phase = 'dimline';
      }
      return;
    }
    if (this.phase === 'dimline') {
      const dim = new RadiusDimensionEntity(this.center!, this.arcPoint!);
      dim.textPoint = { x: wx, y: wy };
      dim.layer = this.doc.activeLayer;
      dim.styleName = this.doc.activeFile.activeDimStyleName || 'Standard';
      if (this.targetEntity?.id !== undefined) {
        dim.anchorArc = { entityId: this.targetEntity.id, snapIndex: 0 };
      }
      this.cmds.push(new AddEntityCmd(dim, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
      this._reset();
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    if (this.phase === 'select') {
      const hit = hitTestAll(this.doc, this.vm, this.curScreen.x, this.curScreen.y, this.spatial);
      if (hit && (hit.entity.type === 'ARC' || hit.entity.type === 'CIRCLE')) {
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        hit.entity.draw(ctx, this.vm, this.doc);
      }
    } else if (this.phase === 'dimline' && this.center && this.arcPoint) {
      const dim = new RadiusDimensionEntity(this.center, this.arcPoint);
      dim.textPoint = this.cur;
      dim.layer = this.doc.activeLayer;
      dim.styleName = this.doc.activeFile.activeDimStyleName || 'Standard';
      ctx.globalAlpha = 0.5;
      dim.draw(ctx, this.vm, this.doc);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  getPhase(): string { return this.phase === 'select' ? 'select' : 'dim-line'; }

  getAnchor(): IPoint | null { return null; }
  getDynamicInputState(): IDynamicInputState | null { return null; }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this._reset();
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  deactivate(): void { this._reset(); }

  private _reset(): void {
    this.phase = 'select';
    this.targetEntity = null;
    this.center = null;
    this.arcPoint = null;
    this.vm.markDirty();
  }
}
