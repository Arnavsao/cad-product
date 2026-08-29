import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { Entity, LineEntity, ArcEntity, CircleEntity, type IPoint } from '../../core/models/entity.model';
import { AngularDimensionEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';

type Phase = 'select-first' | 'select-second' | 'vertex' | 'p1' | 'p2' | 'place';

function getLinesIntersection(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): IPoint | null {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null; // Parallel

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return {
    x: x1 + t * (x2 - x1),
    y: y1 + t * (y2 - y1),
  };
}

export class DimAngularTool implements ITool {
  readonly name = 'dimangular';
  private phase: Phase = 'select-first';
  private vertex: IPoint | null = null;
  private p1: IPoint | null = null;
  private p2: IPoint | null = null;
  private firstLine: LineEntity | null = null;
  private fixedA1: number | null = null;
  private fixedA2: number | null = null;
  private hovered: Entity | null = null;
  private cur: IPoint = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  activate(): void {
    this._reset();
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.phase === 'select-first' || this.phase === 'select-second') {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit && (hit.entity instanceof LineEntity || hit.entity instanceof ArcEntity || hit.entity instanceof CircleEntity)) {
        this.hovered = hit.entity;
      } else {
        this.hovered = null;
      }
    } else {
      this.hovered = null;
    }
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;

    if (this.phase === 'select-first') {
      if (this.hovered) {
        if (this.hovered instanceof ArcEntity) {
          this.vertex = { x: this.hovered.cx, y: this.hovered.cy };
          this.fixedA1 = this.hovered.startAngle * Math.PI / 180;
          this.fixedA2 = this.hovered.endAngle * Math.PI / 180;
          const r = this.hovered.r;
          this.p1 = { x: this.vertex.x + r * Math.cos(this.fixedA1), y: this.vertex.y + r * Math.sin(this.fixedA1) };
          this.p2 = { x: this.vertex.x + r * Math.cos(this.fixedA2), y: this.vertex.y + r * Math.sin(this.fixedA2) };
          this.phase = 'place';
        } else if (this.hovered instanceof CircleEntity) {
          this.vertex = { x: this.hovered.cx, y: this.hovered.cy };
          this.fixedA1 = Math.atan2(wy - this.vertex.y, wx - this.vertex.x);
          this.p1 = { x: wx, y: wy };
          this.phase = 'p2'; // Next point is the second point on circle
        } else if (this.hovered instanceof LineEntity) {
          this.firstLine = this.hovered;
          this.p1 = { x: wx, y: wy };
          this.phase = 'select-second';
        }
      } else {
        // Fallback to manual 3-point
        this.vertex = { x: wx, y: wy };
        this.phase = 'p1';
      }
      this.hovered = null;
      this.vm.markDirty();
      return;
    }

    if (this.phase === 'select-second') {
      if (this.hovered instanceof LineEntity && this.hovered !== this.firstLine && this.firstLine) {
        const l1 = this.firstLine;
        const l2 = this.hovered;
        const ix = getLinesIntersection(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2);
        if (ix) {
          this.vertex = ix;
          const d1_1 = Math.hypot(this.p1!.x - l1.x1, this.p1!.y - l1.y1);
          const d1_2 = Math.hypot(this.p1!.x - l1.x2, this.p1!.y - l1.y2);
          const pt1 = d1_1 < d1_2 ? { x: l1.x1, y: l1.y1 } : { x: l1.x2, y: l1.y2 };
          
          const d2_1 = Math.hypot(wx - l2.x1, wy - l2.y1);
          const d2_2 = Math.hypot(wx - l2.x2, wy - l2.y2);
          const pt2 = d2_1 < d2_2 ? { x: l2.x1, y: l2.y1 } : { x: l2.x2, y: l2.y2 };

          this.fixedA1 = Math.atan2(pt1.y - ix.y, pt1.x - ix.x);
          this.fixedA2 = Math.atan2(pt2.y - ix.y, pt2.x - ix.x);
          this.p1 = pt1;
          this.p2 = pt2;
          this.phase = 'place';
        } else {
          this._reset();
        }
      } else {
         this._reset();
      }
      this.hovered = null;
      this.vm.markDirty();
      return;
    }

    if (this.phase === 'vertex') {
      this.vertex = { x: wx, y: wy };
      this.phase = 'p1';
      this.vm.markDirty();
      return;
    }
    if (this.phase === 'p1') {
      this.p1 = { x: wx, y: wy };
      this.phase = 'p2';
      this.vm.markDirty();
      return;
    }
    if (this.phase === 'p2') {
      if (this.vertex && this.fixedA1 !== null) {
        // We are on a circle, second point sets the angle
        this.fixedA2 = Math.atan2(wy - this.vertex.y, wx - this.vertex.x);
      }
      this.p2 = { x: wx, y: wy };
      this.phase = 'place';
      this.vm.markDirty();
      return;
    }
    if (this.phase === 'place') {
      const dim = new AngularDimensionEntity(this.vertex!, this.p1!, this.p2!, { x: wx, y: wy });
      dim.layer = this.doc.activeLayer;
      dim.styleName = this.doc.activeFile.activeDimStyleName || 'Standard';
      this.cmds.push(new AddEntityCmd(dim, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
      this._reset();
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.hovered) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      this.hovered.draw(ctx, this.vm, this.doc, '#f00'); // Highlight hovered
      ctx.restore();
    }

    if (this.phase === 'select-first' || this.phase === 'select-second' || this.phase === 'vertex' || !this.vertex) return;
    
    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.fillStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;

    const sv = this.vm.w2s(this.vertex.x, this.vertex.y);
    const sc = this.vm.w2s(this.cur.x, this.cur.y);

    if (this.phase === 'p1') {
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(sv.x, sv.y);
      ctx.lineTo(sc.x, sc.y);
      ctx.stroke();
    } else if (this.phase === 'p2' && this.p1) {
      const sp1 = this.vm.w2s(this.p1.x, this.p1.y);
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(sv.x, sv.y);
      ctx.lineTo(sp1.x, sp1.y);
      ctx.moveTo(sv.x, sv.y);
      ctx.lineTo(sc.x, sc.y);
      ctx.stroke();
    } else if (this.phase === 'place' && this.p1 && this.p2) {
      const dim = new AngularDimensionEntity(this.vertex, this.p1, this.p2, this.cur);
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.6;
      dim.draw(ctx, this.vm, this.doc);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  getPhase(): string {
    if (this.phase === 'select-first' || this.phase === 'vertex') return 'first';
    if (this.phase === 'select-second' || this.phase === 'p1') return 'second';
    if (this.phase === 'p2') return 'second'; // (Wait, p2 is the second leg endpoint)
    return 'dim-line';
  }

  getAnchor(): IPoint | null { return this.cur; }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.vertex || !this.p1 || this.phase !== 'place') return null;
    const p2 = this.p2 || this.cur;
    const a1 = Math.atan2(this.p1.y - this.vertex.y, this.p1.x - this.vertex.x);
    const a2 = Math.atan2(p2.y - this.vertex.y, p2.x - this.vertex.x);
    let sweep = (a2 - a1) * 180 / Math.PI;
    sweep = ((sweep % 360) + 360) % 360;
    if (sweep > 180) sweep = 360 - sweep;
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      fields: [{ key: 'angle', label: 'Angle', liveValue: `${sweep.toFixed(1)}\u00b0`, readonly: true, width: 80 }],
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
    this.phase = 'select-first';
    this.vertex = null;
    this.p1 = null;
    this.p2 = null;
    this.firstLine = null;
    this.fixedA1 = null;
    this.fixedA2 = null;
    this.hovered = null;
  }
}
