import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { LineEntity, ArcEntity, PolylineEntity, type Entity, type IPoint } from '../../core/models/entity.model';
import { SplineEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';

export class BlendTool implements ITool {
  readonly name = 'blend_curves';
  
  private first: Entity | null = null;
  private clickA: IPoint | null = null;
  
  private second: Entity | null = null;
  private clickB: IPoint | null = null;
  
  private hovered: Entity | null = null;
  private previewSpline: SplineEntity | null = null;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  activate(): void { this.reset(); }
  deactivate(): void { this.reset(); }

  private reset() {
    this.first = null;
    this.clickA = null;
    this.second = null;
    this.clickB = null;
    this.hovered = null;
    this.previewSpline = null;
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;

    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (!hit || !this.isSupported(hit.entity)) return;

    if (!this.first) {
      this.first = hit.entity;
      this.clickA = { x: wx, y: wy };
      this.vm.markDirty();
      return;
    }

    this.second = hit.entity;
    this.clickB = { x: wx, y: wy };

    if (this.first === this.second) {
      this.reset();
      return;
    }

    this.updatePreview(wx, wy);
    this.commitBlend();
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number): void {
    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    const hitEnt = hit && this.isSupported(hit.entity) ? hit.entity : null;

    if (this.hovered !== hitEnt) {
      this.hovered = hitEnt;
      if (this.first) {
        this.updatePreview(wx, wy);
      }
      this.vm.markDirty();
    } else if (this.first && this.hovered) {
      this.updatePreview(wx, wy);
    }
  }

  getPhase(): string | null {
    if (!this.first) return 'first';
    if (!this.second) return 'second';
    return null;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.reset();
      this.tools.setTool('select');
      return true;
    }
    return false;
  }

  getAnchor(): IPoint | null { return this.clickB; }

  private isSupported(e: Entity): boolean {
    return e instanceof LineEntity || e instanceof ArcEntity || e instanceof PolylineEntity;
  }

  private getEndTangentInfo(e: Entity, click: IPoint): { pt: IPoint, tan: { x: number, y: number } } | null {
    if (e instanceof LineEntity) {
      const d1 = Math.hypot(e.x1 - click.x, e.y1 - click.y);
      const d2 = Math.hypot(e.x2 - click.x, e.y2 - click.y);
      const dx = e.x2 - e.x1;
      const dy = e.y2 - e.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return null;
      if (d1 < d2) {
        // Closer to pt1. Tangent points AWAY from line.
        return { pt: { x: e.x1, y: e.y1 }, tan: { x: -dx/len, y: -dy/len } };
      } else {
        return { pt: { x: e.x2, y: e.y2 }, tan: { x: dx/len, y: dy/len } };
      }
    }
    
    if (e instanceof ArcEntity) {
      // endpoints
      const sRad = e.startAngle * Math.PI / 180;
      const eRad = e.endAngle * Math.PI / 180;
      const ptStart = { x: e.cx + e.r * Math.cos(sRad), y: e.cy + e.r * Math.sin(sRad) };
      const ptEnd = { x: e.cx + e.r * Math.cos(eRad), y: e.cy + e.r * Math.sin(eRad) };
      
      const dStart = Math.hypot(ptStart.x - click.x, ptStart.y - click.y);
      const dEnd = Math.hypot(ptEnd.x - click.x, ptEnd.y - click.y);

      if (dStart < dEnd) {
        // Close to start. Tangent points backwards along the arc path.
        // For CCW arc, curve goes (-sin, cos). Tangent backwards is (sin, -cos).
        let tx = Math.sin(sRad), ty = -Math.cos(sRad);
        if (!e.ccw) { tx = -tx; ty = -ty; }
        return { pt: ptStart, tan: { x: tx, y: ty } };
      } else {
        // Close to end. Tangent points forwards along the arc path.
        // For CCW arc, forward is (-sin, cos).
        let tx = -Math.sin(eRad), ty = Math.cos(eRad);
        if (!e.ccw) { tx = -tx; ty = -ty; }
        return { pt: ptEnd, tan: { x: tx, y: ty } };
      }
    }

    if (e instanceof PolylineEntity && e.pts.length >= 2) {
      const pFirst = e.pts[0];
      const pLast = e.pts[e.pts.length - 1];
      const dFirst = Math.hypot(pFirst.x - click.x, pFirst.y - click.y);
      const dLast = Math.hypot(pLast.x - click.x, pLast.y - click.y);
      
      if (dFirst < dLast) {
        const p1 = pFirst;
        const p2 = e.pts[1];
        const dx = p1.x - p2.x, dy = p1.y - p2.y; // Pointing away from polyline
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) return { pt: p1, tan: { x: dx/len, y: dy/len } };
      } else {
        const p1 = pLast;
        const p2 = e.pts[e.pts.length - 2];
        const dx = p1.x - p2.x, dy = p1.y - p2.y; // Pointing away
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) return { pt: p1, tan: { x: dx/len, y: dy/len } };
      }
    }

    return null;
  }

  private updatePreview(wx: number, wy: number): void {
    this.previewSpline = null;
    if (!this.first || !this.clickA) return;
    const secondEnt = this.second || this.hovered;
    if (!secondEnt) return;
    const clickB = this.clickB || { x: wx, y: wy };

    const infoA = this.getEndTangentInfo(this.first, this.clickA);
    const infoB = this.getEndTangentInfo(secondEnt, clickB);

    if (infoA && infoB) {
      // Calculate cubic bezier-like control points for SplineEntity
      const dist = Math.hypot(infoA.pt.x - infoB.pt.x, infoA.pt.y - infoB.pt.y);
      const k = dist / 3;

      const p0 = infoA.pt;
      const p1 = { x: p0.x + infoA.tan.x * k, y: p0.y + infoA.tan.y * k };
      const p3 = infoB.pt;
      const p2 = { x: p3.x + infoB.tan.x * k, y: p3.y + infoB.tan.y * k };

      // Since SplineEntity uses Catmull-Rom which interpolates through ALL points,
      // creating extra control points at ends helps align tangents if we want true Catmull-Rom blending.
      // Easiest is to generate a few points along the bezier curve, so the SplineEntity traces it exactly.
      const bezierPts: IPoint[] = [];
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const b0 = mt * mt * mt;
        const b1 = 3 * mt * mt * t;
        const b2 = 3 * mt * t * t;
        const b3 = t * t * t;
        bezierPts.push({
          x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
          y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y
        });
      }

      this.previewSpline = new SplineEntity(bezierPts);
    }
  }

  private commitBlend(): void {
    if (this.previewSpline) {
      this.previewSpline.layer = this.first!.layer;
      this.cmds.push(new AddEntityCmd(this.previewSpline, this.doc.getFileOfEntity(this.first!) ?? this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    }
    this.reset();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.first || !this.previewSpline) return;
    
    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.9)';
    ctx.lineWidth = 2;
    // Let the entity render itself!
    this.previewSpline.draw(ctx, this.vm, this.doc, null);
    ctx.restore();
  }
}
