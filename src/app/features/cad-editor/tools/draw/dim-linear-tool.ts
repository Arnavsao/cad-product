import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { DimensionEntity } from '../../core/models/entity-extended.model';
import type { IDimAnchor } from '../../core/models/dimension-style.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { SnappingService } from '../../core/services/snapping.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { formatLen } from './draw-utils';

export class DimLinearTool implements ITool {
  readonly name = 'dimlinear';
  private p1: IPoint | null = null;
  private p2: IPoint | null = null;
  private anchor1: IDimAnchor | null = null;
  private anchor2: IDimAnchor | null = null;
  private cur: IPoint = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get snap() { return this.injector.get(SnappingService) as SnappingService; }

  onMouseDown(wx: number, wy: number): void {
    if (!this.p1) {
      this.p1 = { x: wx, y: wy };
      this.anchor1 = this._captureAnchor();
      return;
    }
    if (!this.p2) {
      this.p2 = { x: wx, y: wy };
      this.anchor2 = this._captureAnchor();
      return;
    }
    // Third click: constrain to H or V based on cursor offset from p1-p2 midpoint
    const mid = { x: (this.p1.x + this.p2.x) / 2, y: (this.p1.y + this.p2.y) / 2 };
    const offX = Math.abs(wx - mid.x);
    const offY = Math.abs(wy - mid.y);
    
    const dim = new DimensionEntity(this.p1, this.p2, { x: wx, y: wy });
    // Offset more vertical -> horizontal dim; offset more horizontal -> vertical dim
    if (offY >= offX) {
      dim.rotation = 0; // Horizontal dimension
    } else {
      dim.rotation = Math.PI / 2; // Vertical dimension
    }

    dim.layer = this.doc.activeLayer;
    dim.styleName = this.doc.activeFile.activeDimStyleName || 'Standard';
    if (this.anchor1) dim.anchor1 = this.anchor1;
    if (this.anchor2) dim.anchor2 = this.anchor2;
    this.cmds.push(new AddEntityCmd(dim, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    this._reset();
    this.vm.markDirty();
  }

  private _captureAnchor(): IDimAnchor | null {
    const s = this.snap.current;
    if (!s) return null;
    if (typeof s.entityId !== 'number' || typeof s.snapIndex !== 'number') return null;
    return { entityId: s.entityId, snapIndex: s.snapIndex };
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.p1) this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.p1) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.fillStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    if (!this.p2) {
      const a = this.vm.w2s(this.p1.x, this.p1.y);
      const b = this.vm.w2s(this.cur.x, this.cur.y);
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      const mid = { x: (this.p1.x + this.p2.x) / 2, y: (this.p1.y + this.p2.y) / 2 };
      const offX = Math.abs(this.cur.x - mid.x);
      const offY = Math.abs(this.cur.y - mid.y);
      
      const preview = new DimensionEntity(this.p1, this.p2, { x: this.cur.x, y: this.cur.y });
      if (offY >= offX) preview.rotation = 0;
      else preview.rotation = Math.PI / 2;
      ctx.setLineDash([]);
      preview.draw(ctx, this.vm, this.doc);
    }
    ctx.restore();
  }

  getPhase(): string {
    if (!this.p1) return 'first-ext';
    if (!this.p2) return 'second-ext';
    return 'dim-line';
  }

  getAnchor(): IPoint | null { return this.p2 ?? this.p1; }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.p1) return null;
    if (!this.p2) {
      const d = Math.hypot(this.cur.x - this.p1.x, this.cur.y - this.p1.y);
      return { wx: this.cur.x, wy: this.cur.y, fields: [{ key: 'distance', label: 'Distance', liveValue: formatLen(d), readonly: true, width: 80 }] };
    }
    const mid = { x: (this.p1.x + this.p2.x) / 2, y: (this.p1.y + this.p2.y) / 2 };
    const offX = Math.abs(this.cur.x - mid.x);
    const offY = Math.abs(this.cur.y - mid.y);
    
    const dim = new DimensionEntity(this.p1, this.p2, { x: this.cur.x, y: this.cur.y });
    if (offY >= offX) dim.rotation = 0;
    else dim.rotation = Math.PI / 2;

    if (dim.length < 1e-9) return null;
    return { wx: this.cur.x, wy: this.cur.y, fields: [{ key: 'length', label: 'Length', liveValue: formatLen(dim.length), readonly: true, width: 80 }] };
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
    this.p1 = null;
    this.p2 = null;
    this.anchor1 = null;
    this.anchor2 = null;
  }
}
