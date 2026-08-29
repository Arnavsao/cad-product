import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint, Entity } from '../../core/models/entity.model';
import { ArcLengthDimensionEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { SpatialIndexService } from '../../core/services/spatial-index.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';

export class DimArcTool implements ITool {
  readonly name = 'dimarc';
  private phase: 'select' | 'dimplace' = 'select';
  private targetEntity: Entity | null = null;
  private center: IPoint | null = null;
  private p1: IPoint | null = null;
  private p2: IPoint | null = null;
  private arcRadius = 0;
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
      if (hit && hit.entity.type === 'ARC') {
        const e = hit.entity as any;
        this.targetEntity = hit.entity;
        this.center = { x: e.cx, y: e.cy };
        this.arcRadius = e.r ?? 10;
        // Compute p1/p2 from arc start/end angles (in degrees, CCW from +X)
        const sa = (e.startAngle ?? 0) * Math.PI / 180;
        const ea = (e.endAngle ?? 90) * Math.PI / 180;
        this.p1 = { x: e.cx + Math.cos(sa) * this.arcRadius, y: e.cy + Math.sin(sa) * this.arcRadius };
        this.p2 = { x: e.cx + Math.cos(ea) * this.arcRadius, y: e.cy + Math.sin(ea) * this.arcRadius };
        this.phase = 'dimplace';
      }
      return;
    }
    if (this.phase === 'dimplace' && this.center && this.p1 && this.p2) {
      // Dim arc radius = distance from center to cursor
      const dimR = Math.hypot(wx - this.center.x, wy - this.center.y);
      const useR = Math.max(dimR, this.arcRadius * 1.05);
      const dim = new ArcLengthDimensionEntity(this.center, this.p1, this.p2, useR);
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
      if (hit && hit.entity.type === 'ARC') {
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        hit.entity.draw(ctx, this.vm, this.doc);
      }
    } else if (this.phase === 'dimplace' && this.center && this.p1 && this.p2) {
      const dimR = Math.max(
        Math.hypot(this.cur.x - this.center.x, this.cur.y - this.center.y),
        this.arcRadius * 1.05
      );
      const dim = new ArcLengthDimensionEntity(this.center, this.p1, this.p2, dimR);
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
    this.p1 = null;
    this.p2 = null;
    this.arcRadius = 0;
    this.vm.markDirty();
  }
}
