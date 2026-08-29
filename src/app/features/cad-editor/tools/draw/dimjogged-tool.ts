import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint, Entity } from '../../core/models/entity.model';
import { ArcEntity, CircleEntity } from '../../core/models/entity.model';
import { JoggedRadiusDimensionEntity } from '../../core/models/entity-extended.model';
import type { IDimAnchor } from '../../core/models/dimension-style.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { SpatialIndexService } from '../../core/services/spatial-index.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';

export class DimJoggedTool implements ITool {
  readonly name = 'dimjogged';
  private phase: 'select' | 'dimline' = 'select';
  
  private targetEntity: Entity | null = null;
  private trueCenter: IPoint | null = null;
  private textPoint: IPoint | null = null;
  private arcPoint: IPoint | null = null;
  
  private cur: IPoint = { x: 0, y: 0 };
  private curScreen: { x: number, y: number } = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get spatial() { return this.injector.get(SpatialIndexService) as SpatialIndexService; }

  onMouseMove(wx: number, wy: number, sx: number, sy: number, ev: MouseEvent): void {
    this.cur = { x: wx, y: wy };
    this.curScreen = { x: sx, y: sy };
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number): void {
    if (this.phase === 'select') {
      const hit = hitTestAll(this.doc, this.vm, this.curScreen.x, this.curScreen.y, this.spatial);
      if (hit && (hit.entity.type === 'ARC' || hit.entity.type === 'CIRCLE')) {
        this.targetEntity = hit.entity;
        this.trueCenter = { x: (hit.entity as any).cx, y: (hit.entity as any).cy };
        this.phase = 'dimline';
      }
      return;
    }

    if (this.phase === 'dimline') {
      this.textPoint = { x: wx, y: wy };
      
      // The angle is from trueCenter to the cursor (textPoint).
      // The arcPoint is exactly on the circle along this angle.
      const dx = wx - this.trueCenter!.x;
      const dy = wy - this.trueCenter!.y;
      const dist = Math.hypot(dx, dy);
      const radius = (this.targetEntity as any).radius ?? (this.targetEntity as any).r ?? 10;
      
      let ux = 1, uy = 0;
      if (dist > 1e-9) {
        ux = dx / dist;
        uy = dy / dist;
      }
      
      this.arcPoint = {
        x: this.trueCenter!.x + ux * radius,
        y: this.trueCenter!.y + uy * radius
      };
      
      const dim = new JoggedRadiusDimensionEntity(
        this.trueCenter!,
        this.trueCenter!, // overrideCenter is now just the true center
        this.arcPoint!,
        this.trueCenter!  // jogPoint is ignored
      );
      
      dim.textPoint = this.textPoint;
      dim.layer = this.doc.activeLayer;
      dim.styleName = this.doc.activeFile.activeDimStyleName || 'Standard';
      
      // Setup associative anchor
      if (this.targetEntity && this.targetEntity.id !== undefined) {
        dim.anchorArc = { entityId: this.targetEntity.id, snapIndex: 0 };
      }
      
      this.cmds.push(new AddEntityCmd(dim, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
      this._reset();
      this.vm.markDirty();
      this.tools.setTool('select');
      return;
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
    } 
    else if (this.phase === 'dimline') {
      // Dynamic live dimension preview
      const dx = this.cur.x - this.trueCenter!.x;
      const dy = this.cur.y - this.trueCenter!.y;
      const dist = Math.hypot(dx, dy);
      const radius = (this.targetEntity as any).radius ?? (this.targetEntity as any).r ?? 10;
      
      let ux = 1, uy = 0;
      if (dist > 1e-9) {
        ux = dx / dist;
        uy = dy / dist;
      }

      const previewArcPoint = {
        x: this.trueCenter!.x + ux * radius,
        y: this.trueCenter!.y + uy * radius
      };
      
      const dim = new JoggedRadiusDimensionEntity(
        this.trueCenter!,
        this.trueCenter!, // No override
        previewArcPoint,
        this.trueCenter!  // No jog
      );
      
      dim.textPoint = this.cur;
      dim.layer = this.doc.activeLayer;
      dim.styleName = this.doc.activeFile.activeDimStyleName || 'Standard';
      
      ctx.globalAlpha = 0.5;
      dim.draw(ctx, this.vm, this.doc);
      ctx.globalAlpha = 1.0;
    }
    
    ctx.restore();
  }

  getPhase(): string { return this.phase === 'select' ? 'select' : 'dim-line'; }

  getAnchor(): IPoint | null { return null; }

  getDynamicInputState(): IDynamicInputState | null {
    // Dynamic Input can be added if needed, similar to DimensionTool
    return null;
  }

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
    this.trueCenter = null;
    this.textPoint = null;
    this.arcPoint = null;
    this.vm.markDirty();
  }
}
