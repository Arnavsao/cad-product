import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { PolylineEntity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { evalExpression } from '../../core/utils/expression-parser';
import { formatLen } from './draw-utils';

export class PolygonTool implements ITool {
  readonly name = 'polygon';
  
  private phase: 'sides' | 'center' | 'type' | 'radius' | 'edge_start' | 'edge' = 'sides';
  private sides = 4;
  private center: IPoint | null = null;
  private firstEdge: IPoint | null = null;
  private type: 'inscribed' | 'circumscribed' = 'inscribed';
  
  private cur: IPoint = { x: 0, y: 0 };
  
  constructor(private injector: Injector) {}
  
  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  getPhase(): string | null {
    return this.phase;
  }

  onMouseDown(wx: number, wy: number): void {
    const pt = { x: wx, y: wy };
    
    if (this.phase === 'sides') {
      this.phase = 'center';
      this.dyn.clearEdits();
      this.vm.markDirty();
      return;
    }
    
    if (this.phase === 'center') {
      this.center = pt;
      this.phase = 'type';
      this.dyn.clearEdits();
      this.vm.markDirty();
      return;
    }

    if (this.phase === 'type') {
      this.phase = 'radius';
      this.vm.markDirty();
      return;
    }
    
    if (this.phase === 'radius' && this.center !== null) {
      this.commitPolygon(pt);
      return;
    }

    if (this.phase === 'edge_start') {
      this.firstEdge = pt;
      this.phase = 'edge';
      this.dyn.clearEdits();
      this.vm.markDirty();
      return;
    }
    
    if (this.phase === 'edge' && this.firstEdge !== null) {
      this.commitPolygon(pt);
      return;
    }
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    this.vm.markDirty();
  }
  
  private getPolygonPoints(target: IPoint, radiusOverride?: number): IPoint[] {
    const pts: IPoint[] = [];
    if (this.sides < 3) return pts;
    
    if ((this.phase === 'radius' || this.phase === 'type') && this.center) {
      const dx = target.x - this.center.x;
      const dy = target.y - this.center.y;
      let r = radiusOverride !== undefined ? radiusOverride : Math.hypot(dx, dy);
      if (r < 1e-6) return pts;
      
      let startAng = Math.atan2(dy, dx);
      
      if (this.type === 'circumscribed') {
        const apothem = r;
        r = apothem / Math.cos(Math.PI / this.sides);
        startAng -= (Math.PI / this.sides);
      }
      
      for (let i = 0; i < this.sides; i++) {
        const ang = startAng + (i * 2 * Math.PI) / this.sides;
        pts.push({
          x: this.center.x + r * Math.cos(ang),
          y: this.center.y + r * Math.sin(ang)
        });
      }
    } else if (this.phase === 'edge' && this.firstEdge) {
      const dx = target.x - this.firstEdge.x;
      const dy = target.y - this.firstEdge.y;
      const edgeLen = Math.hypot(dx, dy);
      if (edgeLen < 1e-6) return pts;
      
      const edgeAng = Math.atan2(dy, dx);
      const intAng = (this.sides - 2) * Math.PI / this.sides;
      const extAng = Math.PI - intAng;
      
      let currPt = { ...this.firstEdge };
      pts.push(currPt);
      
      let currAng = edgeAng;
      for (let i = 1; i < this.sides; i++) {
        currPt = {
          x: currPt.x + edgeLen * Math.cos(currAng),
          y: currPt.y + edgeLen * Math.sin(currAng)
        };
        pts.push(currPt);
        currAng += extAng;
      }
    }
    
    return pts;
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'sides' || this.phase === 'center' || this.phase === 'edge_start') return;
    
    let target = this.cur;
    let rOverride: number | undefined = undefined;
    
    if (this.phase === 'radius' || this.phase === 'type') {
      const edits = this.dyn.editedValues();
      const typedR = evalExpression(edits['radius'] ?? '');
      if (typedR !== null && typedR > 0) {
        rOverride = typedR;
      }
    } else if (this.phase === 'edge') {
      const edits = this.dyn.editedValues();
      const typedL = evalExpression(edits['length'] ?? '');
      if (typedL !== null && typedL > 0 && this.firstEdge) {
        const dx = this.cur.x - this.firstEdge.x;
        const dy = this.cur.y - this.firstEdge.y;
        const ang = Math.atan2(dy, dx);
        target = {
          x: this.firstEdge.x + typedL * Math.cos(ang),
          y: this.firstEdge.y + typedL * Math.sin(ang)
        };
      }
    }

    const pts = this.getPolygonPoints(target, rOverride);
    if (pts.length < 3) return;

    ctx.save();
    ctx.beginPath();
    const first = this.vm.w2s(pts[0].x, pts[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const pt = this.vm.w2s(pts[i].x, pts[i].y);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(240,160,48,0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    
    ctx.beginPath();
    if ((this.phase === 'radius' || this.phase === 'type') && this.center) {
      const c = this.vm.w2s(this.center.x, this.center.y);
      let p2 = this.cur;
      if (rOverride !== undefined) {
         const dx = this.cur.x - this.center.x;
         const dy = this.cur.y - this.center.y;
         const ang = Math.atan2(dy, dx);
         p2 = { x: this.center.x + rOverride * Math.cos(ang), y: this.center.y + rOverride * Math.sin(ang) };
      }
      const t = this.vm.w2s(p2.x, p2.y);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(t.x, t.y);
    } else if (this.phase === 'edge' && this.firstEdge) {
      const c = this.vm.w2s(this.firstEdge.x, this.firstEdge.y);
      const t = this.vm.w2s(target.x, target.y);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(t.x, t.y);
    }
    ctx.strokeStyle = 'rgba(240,160,48,0.4)';
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    
    ctx.restore();
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (this.phase === 'sides') {
      return {
        wx: this.cur.x,
        wy: this.cur.y,
        primaryFieldKey: 'sides',
        fields: [
          { key: 'sides', label: 'Sides', liveValue: this.sides.toString(), width: 60 },
        ],
      };
    }
    
    if (this.phase === 'radius' && this.center) {
      const dx = this.cur.x - this.center.x;
      const dy = this.cur.y - this.center.y;
      const r = Math.hypot(dx, dy);
      return {
        wx: this.cur.x,
        wy: this.cur.y,
        primaryFieldKey: 'radius',
        fields: [
          { key: 'radius', label: 'Radius', liveValue: formatLen(r), width: 80 },
        ],
      };
    }
    
    if (this.phase === 'edge' && this.firstEdge) {
      const dx = this.cur.x - this.firstEdge.x;
      const dy = this.cur.y - this.firstEdge.y;
      const l = Math.hypot(dx, dy);
      return {
        wx: this.cur.x,
        wy: this.cur.y,
        primaryFieldKey: 'length',
        fields: [
          { key: 'length', label: 'Length', liveValue: formatLen(l), width: 80 },
        ],
      };
    }
    return null;
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (this.phase === 'sides') {
      const s = parseInt(values['sides'] ?? '', 10);
      if (!isNaN(s) && s >= 3) {
        this.sides = s;
      }
      this.phase = 'center';
      this.dyn.clearEdits();
      this.vm.markDirty();
      return true;
    }
    
    if (this.phase === 'radius' && this.center) {
      const typedR = evalExpression(values['radius'] ?? '');
      if (typedR !== null && typedR > 0) {
        const dx = this.cur.x - this.center.x;
        const dy = this.cur.y - this.center.y;
        const ang = Math.atan2(dy, dx);
        const pt = { x: this.center.x + typedR * Math.cos(ang), y: this.center.y + typedR * Math.sin(ang) };
        this.commitPolygon(pt, typedR);
        return true;
      }
    }
    
    if (this.phase === 'edge' && this.firstEdge) {
      const typedL = evalExpression(values['length'] ?? '');
      if (typedL !== null && typedL > 0) {
        const dx = this.cur.x - this.firstEdge.x;
        const dy = this.cur.y - this.firstEdge.y;
        const ang = Math.atan2(dy, dx);
        const pt = { x: this.firstEdge.x + typedL * Math.cos(ang), y: this.firstEdge.y + typedL * Math.sin(ang) };
        this.commitPolygon(pt);
        return true;
      }
    }
    
    return false;
  }

  private commitPolygon(target: IPoint, radiusOverride?: number) {
    const pts = this.getPolygonPoints(target, radiusOverride);
    if (pts.length >= 3) {
      const poly = new PolylineEntity(pts, true);
      poly.layer = this.doc.activeLayer;
      this.cmds.push(new AddEntityCmd(poly, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    }
    this.tools.setTool('select');
    this.vm.markDirty();
  }

  invokeOption(key: string): boolean {
    if (this.phase === 'center' && key === 'E') {
      this.phase = 'edge_start';
      this.dyn.clearEdits();
      this.vm.markDirty();
      return true;
    }
    if (this.phase === 'type' && key === 'I') {
      this.type = 'inscribed';
      this.phase = 'radius';
      this.vm.markDirty();
      return true;
    }
    if (this.phase === 'type' && key === 'C') {
      this.type = 'circumscribed';
      this.phase = 'radius';
      this.vm.markDirty();
      return true;
    }
    return false;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.tools.setTool('select');
      return;
    }
    
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const edits = this.dyn.editedValues();
      if (Object.keys(edits).length > 0 && this.commitDynamicInput(edits)) {
        return;
      }
      
      if (this.phase === 'sides') {
        this.phase = 'center';
        this.dyn.clearEdits();
        this.vm.markDirty();
        return;
      }
      if (this.phase === 'type') {
        this.phase = 'radius';
        this.vm.markDirty();
        return;
      }
    }
  }

  getAnchor(): IPoint | null {
    if (this.phase === 'type' || this.phase === 'radius') return this.center;
    if (this.phase === 'edge') return this.firstEdge;
    return null;
  }

  deactivate(): void {
    this.phase = 'sides';
    this.center = null;
    this.firstEdge = null;
    this.type = 'inscribed';
    this.dyn.clearEdits();
    this.dyn.setState(null);
  }
}
