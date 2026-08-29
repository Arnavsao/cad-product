import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { OrdinateDimensionEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd } from '../../core/models/command.model';

export class DimOrdinateTool implements ITool {
  readonly name = 'dimordinate';
  private phase: 'feature' | 'leader' = 'feature';
  private featurePoint: IPoint | null = null;
  private cur: IPoint = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.phase === 'leader') this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number): void {
    if (this.phase === 'feature') {
      this.featurePoint = { x: wx, y: wy };
      this.phase = 'leader';
      return;
    }
    if (this.phase === 'leader' && this.featurePoint) {
      const dx = Math.abs(wx - this.featurePoint.x);
      const dy = Math.abs(wy - this.featurePoint.y);
      // Horizontal leader â†’ measuring Y (isXDatum=false); vertical â†’ measuring X (isXDatum=true)
      const isXDatum = dy > dx;
      const dim = new OrdinateDimensionEntity(this.featurePoint, { x: wx, y: wy }, isXDatum);
      dim.layer = this.doc.activeLayer;
      dim.styleName = this.doc.activeFile.activeDimStyleName || 'Standard';
      this.cmds.push(new AddEntityCmd(dim, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
      this._reset();
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'leader' || !this.featurePoint) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.fillStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    const dx = Math.abs(this.cur.x - this.featurePoint.x);
    const dy = Math.abs(this.cur.y - this.featurePoint.y);
    const isXDatum = dy > dx;
    const dim = new OrdinateDimensionEntity(this.featurePoint, this.cur, isXDatum);
    ctx.globalAlpha = 0.6;
    dim.draw(ctx, this.vm, this.doc);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  getPhase(): string { return this.phase === 'feature' ? 'point' : 'leader'; }

  getAnchor(): IPoint | null { return this.featurePoint; }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.featurePoint) return null;
    const dx = Math.abs(this.cur.x - this.featurePoint.x);
    const dy = Math.abs(this.cur.y - this.featurePoint.y);
    const isXDatum = dy > dx;
    const coord = isXDatum ? this.featurePoint.x : this.featurePoint.y;
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      fields: [
        { key: 'coord', label: isXDatum ? 'X' : 'Y', liveValue: coord.toFixed(3), readonly: true, width: 80 },
      ],
    };
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
    this.phase = 'feature';
    this.featurePoint = null;
  }
}
