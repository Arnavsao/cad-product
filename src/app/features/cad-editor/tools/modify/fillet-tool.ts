import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { LineEntity, ArcEntity, PolylineEntity, type Entity, type IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { ModifyGeometryCmd, AddEntityCmd, CompoundCmd, type ICommand } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';
import { snapshotEntity } from '../geometry-utils';

export class FilletTool implements ITool {
  readonly name = 'fillet';
  private radius = 0;
  
  private first: Entity | null = null;
  private clickA: IPoint | null = null;
  
  private second: Entity | null = null;
  private clickB: IPoint | null = null;
  
  private hovered: Entity | null = null;
  
  private previewArc: ArcEntity | null = null;
  private previewOps: { ent: Entity, after: any, removedLine?: { x1: number, y1: number, x2: number, y2: number } }[] = [];
  
  private waitingForRadius = false;
  private trimMode = true;
  /** Multiple mode: tool resets to first-object pick after each commit. */
  private multipleMode = false;
  /** Polyline mode: fillet all corners of the selected polyline. */
  private polylineMode = false;
  /** Track cursor world position for DI anchoring in pre-click radius mode. */
  private cur: IPoint = { x: 0, y: 0 };
  
  private firstSegmentIndex = -1;
  private secondSegmentIndex = -1;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get di() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  activate(): void {
    this.reset();
  }

  deactivate(): void {
    this.reset();
  }

  private reset() {
    this.first = null;
    this.clickA = null;
    this.firstSegmentIndex = -1;
    this.second = null;
    this.clickB = null;
    this.secondSegmentIndex = -1;
    this.hovered = null;
    this.previewArc = null;
    this.previewOps = [];
    this.waitingForRadius = false;
    this.polylineMode = false;
    this.dynInputState = null;
    this.vm.markDirty();
  }

  private dynInputState: any = null;

  private getClosestPolylineSegment(poly: PolylineEntity, wx: number, wy: number): number {
    let closestIdx = -1;
    let minDist = Infinity;
    const count = poly.closed ? poly.pts.length : poly.pts.length - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % poly.pts.length;
      const a = poly.pts[i];
      const b = poly.pts[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let dist = 0;
      if (len2 === 0) {
        dist = Math.hypot(wx - a.x, wy - a.y);
      } else {
        const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / len2));
        const px = a.x + t * dx;
        const py = a.y + t * dy;
        dist = Math.hypot(wx - px, wy - py);
      }
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    return closestIdx;
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;
    
    if (this.waitingForRadius) {
      this.commitFillet();
      return;
    }

    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (!hit || !(hit.entity instanceof LineEntity || hit.entity instanceof ArcEntity || hit.entity instanceof PolylineEntity)) return;

    if (this.polylineMode && hit.entity instanceof PolylineEntity) {
      this.first = hit.entity;
      this.clickA = { x: wx, y: wy };
      this.updatePreview(wx, wy);
      this.waitingForRadius = true;
      let cx = wx, cy = wy;
      if (this.previewArc) { cx = this.previewArc.cx; cy = this.previewArc.cy; }
      const scr = this.vm.w2s(cx, cy);
      this.di.setCursor(scr.x, scr.y);
      this.di.setActiveField('radius');
      setTimeout(() => this.di.focusPrimaryField(), 10);
      this.vm.markDirty();
      return;
    }

    if (!this.first) {
      this.first = hit.entity;
      this.clickA = { x: wx, y: wy };
      if (this.first instanceof PolylineEntity) {
        this.firstSegmentIndex = this.getClosestPolylineSegment(this.first, wx, wy);
      }
      this.vm.markDirty();
      return;
    }

    // Second click
    this.second = hit.entity;
    this.clickB = { x: wx, y: wy };
    if (this.second instanceof PolylineEntity) {
      this.secondSegmentIndex = this.getClosestPolylineSegment(this.second, wx, wy);
    }

    if (this.first === this.second && !(this.first instanceof PolylineEntity)) {
      this.reset();
      return;
    }

    this.updatePreview(wx, wy);

    this.waitingForRadius = true;

    let cx = wx, cy = wy;
    if (this.previewArc) {
      cx = this.previewArc.cx;
      cy = this.previewArc.cy;
    }
    const scr = this.vm.w2s(cx, cy);
    this.di.setCursor(scr.x, scr.y);
    this.di.setActiveField('radius');
    setTimeout(() => this.di.focusPrimaryField(), 10);
    this.vm.markDirty();
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    this.cur = { x: wx, y: wy };
    if (this.waitingForRadius) return;

    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    this.hovered = hit ? hit.entity : null;

    if (this.first && this.hovered && (this.hovered !== this.first || this.first instanceof PolylineEntity)) {
      this.updatePreview(wx, wy);
    } else {
      this.previewArc = null;
      this.previewOps = [];
      this.vm.markDirty();
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.reset();
      this.tools.setTool('select');
      return;
    }
    if (this.waitingForRadius) return;
    if (e.key === 'Enter' || e.key === ' ') {
      this.tools.setTool('select');
      return;
    }
    // Note: T (trim toggle) is now handled via invokeOption so option-key
    // routing intercepts it before this handler. Kept here as a no-op guard.
  }

  getPhase(): string | null {
    if (this.waitingForRadius) return 'radius';
    if (this.first) return 'second';
    return 'first';
  }

  invokeOption(key: string): boolean {
    switch (key) {
      case 'T':
        if (!this.first) {
          this.trimMode = !this.trimMode;
          return true;
        }
        return false;
      case 'P':
        if (!this.first) {
          this.polylineMode = !this.polylineMode;
          this.multipleMode = false;
          return true;
        }
        return false;
      case 'R': {
        // Allow radius entry at any time during first-object selection.
        if (this.first) return false; // already picking second â€” don't interrupt
        this.waitingForRadius = true;
        this.vm.markDirty();
        setTimeout(() => this.di.focusPrimaryField(), 10);
        return true;
      }
      case 'M':
        if (!this.first) {
          this.multipleMode = !this.multipleMode;
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  getAnchor(): IPoint | null {
    return this.clickB;
  }

  getDynamicInputState(): any {
    if (this.waitingForRadius) {
      const typed = this.di.editedValues()['radius'];
      if (typed !== undefined) {
        const val = parseFloat(typed);
        if (Number.isFinite(val) && val >= 0) {
          this.radius = val;
          if (this.clickB) {
            this.updatePreview(this.clickB.x, this.clickB.y);
          } else if (this.clickA) {
            this.updatePreview(this.clickA.x, this.clickA.y);
          }
        }
      }

      // Anchor: use previewArc center when available, else clickB, else cursor.
      let cx = this.cur.x;
      let cy = this.cur.y;
      if (this.clickB) { cx = this.clickB.x; cy = this.clickB.y; }
      if (this.previewArc) { cx = this.previewArc.cx; cy = this.previewArc.cy; }
      return {
        wx: cx,
        wy: cy,
        primaryFieldKey: 'radius',
        fields: [{
          key: 'radius',
          liveValue: this.radius.toFixed(2),
          label: 'Radius'
        }]
      };
    }
    return null;
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (!this.waitingForRadius) return false;
    const val = parseFloat(values['radius']);
    if (Number.isFinite(val) && val >= 0) this.radius = val;
    // If both objects already selected (post-click radius), commit the fillet.
    // In polylineMode, we only need clickA to commit.
    // If radius was set via R option before first click, just exit radius mode.
    if (this.first && this.clickA && (this.clickB || this.polylineMode)) {
      this.commitFillet();
    } else {
      this.waitingForRadius = false;
      this.vm.markDirty();
    }
    return true;
  }

  private updatePreview(wx: number, wy: number): void {
    this.previewArc = null;
    this.previewOps = [];
    if (!this.first) return;

    if (this.polylineMode && this.first instanceof PolylineEntity) {
      const poly = this.first;
      const newPts: IPoint[] = [];
      const newBulges: number[] = [];
      let modified = false;

      const bulges = poly.bulges || [];
      const count = poly.pts.length;

      for (let i = 0; i < count; i++) {
        let isCorner = true;
        let prevIdx = i - 1;
        let nextIdx = i + 1;
        
        if (i === 0) {
          if (!poly.closed) isCorner = false;
          else prevIdx = count - 1;
        }
        if (i === count - 1) {
          if (!poly.closed) isCorner = false;
          else nextIdx = 0;
        }

        if (isCorner) {
          const res = this.solvePolylineVertexFillet(poly.pts, bulges, i, prevIdx, nextIdx, this.radius);
          if (res) {
             newPts.push(res.T1);
             newBulges.push(res.bulge);
             newPts.push(res.T2);
             newBulges.push(i < bulges.length ? bulges[i] : 0);
             modified = true;
          } else {
             newPts.push(poly.pts[i]);
             newBulges.push(i < bulges.length ? bulges[i] : 0);
          }
        } else {
          newPts.push(poly.pts[i]);
          newBulges.push(i < bulges.length ? bulges[i] : 0);
        }
      }
      
      if (modified) {
        const afterPoly = poly.clone();
        afterPoly.pts = newPts;
        afterPoly.bulges = newBulges;
        this.previewOps.push({ ent: poly, after: afterPoly });
      }
      this.vm.markDirty();
      return;
    }

    const secondEnt = this.second || this.hovered;
    if (!secondEnt) return;

    if (this.first instanceof PolylineEntity && secondEnt === this.first) {
       const poly = this.first;
       const idx1 = this.firstSegmentIndex;
       const idx2 = this.second ? this.secondSegmentIndex : this.getClosestPolylineSegment(poly, wx, wy);
       
       let vIdx = -1;
       const count = poly.pts.length;
       if (idx1 === (idx2 + 1) % count) vIdx = idx1;
       else if (idx2 === (idx1 + 1) % count) vIdx = idx2;
       
       if (vIdx !== -1) {
          const newPts: IPoint[] = [];
          const newBulges: number[] = [];
          let modified = false;
          const bulges = poly.bulges || [];
          
          for (let i = 0; i < count; i++) {
             if (i === vIdx) {
                let prevIdx = i - 1;
                let nextIdx = i + 1;
                if (i === 0) prevIdx = count - 1;
                if (i === count - 1) nextIdx = 0;
                
                const res = this.solvePolylineVertexFillet(poly.pts, bulges, i, prevIdx, nextIdx, this.radius);
                if (res) {
                   newPts.push(res.T1);
                   newBulges.push(res.bulge);
                   newPts.push(res.T2);
                   newBulges.push(i < bulges.length ? bulges[i] : 0);
                   modified = true;
                } else {
                   newPts.push(poly.pts[i]);
                   newBulges.push(i < bulges.length ? bulges[i] : 0);
                }
             } else {
                newPts.push(poly.pts[i]);
                newBulges.push(i < bulges.length ? bulges[i] : 0);
             }
          }
          
          if (modified) {
            const afterPoly = poly.clone();
            afterPoly.pts = newPts;
            afterPoly.bulges = newBulges;
            this.previewOps.push({ ent: poly, after: afterPoly });
          }
          this.vm.markDirty();
          return;
       }
    }

    const extractLine = (ent: Entity, segIdx: number): LineEntity | null => {
      if (ent instanceof LineEntity) return ent;
      if (ent instanceof PolylineEntity) {
        const count = ent.closed ? ent.pts.length : ent.pts.length - 1;
        if (segIdx < 0 || segIdx >= count) return null;
        const j = (segIdx + 1) % ent.pts.length;
        return new LineEntity(ent.pts[segIdx].x, ent.pts[segIdx].y, ent.pts[j].x, ent.pts[j].y);
      }
      return null;
    };

    const lineA = extractLine(this.first, this.firstSegmentIndex);
    const idx2 = this.second ? this.secondSegmentIndex : (secondEnt instanceof PolylineEntity ? this.getClosestPolylineSegment(secondEnt, wx, wy) : -1);
    const lineB = extractLine(secondEnt, idx2);

    if (lineA && lineB) {
      const clickB = this.clickB || { x: wx, y: wy };
      const res = this.calculateLineFillet(lineA, lineB, this.radius, this.clickA!, clickB);
      
      if (res) {
        this.previewArc = res.arc;
        
        if (this.trimMode) {
          const trimEntity = (ent: Entity, segIdx: number, newPt: IPoint) => {
            if (ent instanceof LineEntity) {
              const after = { x1: ent.x1, y1: ent.y1, x2: ent.x2, y2: ent.y2 };
              const dA1 = Math.hypot(ent.x1 - res.ix.x, ent.y1 - res.ix.y);
              const dA2 = Math.hypot(ent.x2 - res.ix.x, ent.y2 - res.ix.y);
              let removedLine;
              if (dA1 < dA2) {
                after.x1 = newPt.x; after.y1 = newPt.y;
                removedLine = { x1: ent.x1, y1: ent.y1, x2: newPt.x, y2: newPt.y };
              } else {
                after.x2 = newPt.x; after.y2 = newPt.y;
                removedLine = { x1: ent.x2, y1: ent.y2, x2: newPt.x, y2: newPt.y };
              }
              this.previewOps.push({ ent, after, removedLine });
            } else if (ent instanceof PolylineEntity) {
              const poly = ent;
              const afterPoly = poly.clone();
              const pts = [...poly.pts];
              const p1 = pts[segIdx];
              const p2 = pts[(segIdx + 1) % pts.length];
              const dA1 = Math.hypot(p1.x - res.ix.x, p1.y - res.ix.y);
              const dA2 = Math.hypot(p2.x - res.ix.x, p2.y - res.ix.y);
              let removedLine;
              if (dA1 < dA2) {
                afterPoly.pts = pts.slice(segIdx);
                afterPoly.pts[0] = { x: newPt.x, y: newPt.y };
                if (poly.bulges) afterPoly.bulges = poly.bulges.slice(segIdx);
                removedLine = { x1: p1.x, y1: p1.y, x2: newPt.x, y2: newPt.y };
              } else {
                afterPoly.pts = pts.slice(0, segIdx + 2);
                afterPoly.pts[segIdx + 1] = { x: newPt.x, y: newPt.y };
                if (poly.bulges) afterPoly.bulges = poly.bulges.slice(0, segIdx + 1);
                removedLine = { x1: p2.x, y1: p2.y, x2: newPt.x, y2: newPt.y };
              }
              afterPoly.closed = false;
              this.previewOps.push({ ent: poly, after: afterPoly, removedLine });
            }
          };

          trimEntity(this.first, this.firstSegmentIndex, res.tA);
          trimEntity(secondEnt, idx2, res.tB);
        }
      }
    }
    this.vm.markDirty();
  }

  private commitFillet(): void {
    if (this.first && this.clickA && (this.clickB || this.polylineMode)) {
      if (this.clickB) {
        this.updatePreview(this.clickB.x, this.clickB.y);
      } else {
        this.updatePreview(this.clickA.x, this.clickA.y);
      }
      
      const cmdsList: ICommand[] = [];
      
      for (const op of this.previewOps) {
        const before = snapshotEntity(op.ent);
        cmdsList.push(new ModifyGeometryCmd(op.ent, before, op.after, { markDirty: () => this.vm.markContentDirty() }));
      }
      
      if (this.previewArc) {
        this.previewArc.layer = this.first.layer;
        cmdsList.push(new AddEntityCmd(this.previewArc, this.doc.getFileOfEntity(this.first) ?? this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
      }

      if (cmdsList.length > 0) {
        this.cmds.push(new CompoundCmd(cmdsList));
      }
    }

    if (this.multipleMode) {
      // Multiple mode: reset to first-object pick but keep multipleMode and radius.
      this.first = null;
      this.clickA = null;
      this.firstSegmentIndex = -1;
      this.second = null;
      this.clickB = null;
      this.secondSegmentIndex = -1;
      this.hovered = null;
      this.previewArc = null;
      this.previewOps = [];
      this.waitingForRadius = false;
      this.dynInputState = null;
      this.vm.markDirty();
    } else {
      this.reset();
    }
  }

  /** Calculate infinite line intersection. */
  private lineLineIntersection(a: LineEntity, b: LineEntity): { x: number; y: number } | null {
    const dAx = a.x2 - a.x1;
    const dAy = a.y2 - a.y1;
    const dBx = b.x2 - b.x1;
    const dBy = b.y2 - b.y1;
    const det = dAx * dBy - dAy * dBx;
    if (Math.abs(det) < 1e-10) return null;
    const tA = ((b.x1 - a.x1) * dBy - (b.y1 - a.y1) * dBx) / det;
    return { x: a.x1 + tA * dAx, y: a.y1 + tA * dAy };
  }

  private solvePolylineVertexFillet(
    pts: IPoint[], bulges: number[], i: number,
    prevIdx: number, nextIdx: number, r: number
  ): { T1: IPoint, T2: IPoint, bulge: number } | null {
    if (r < 1e-6) return null; // No fillet if radius is essentially zero
    const V = pts[i];
    const prev = pts[prevIdx];
    const next = pts[nextIdx];

    const bulgeIn = prevIdx < bulges.length ? (bulges[prevIdx] || 0) : 0;
    const bulgeOut = i < bulges.length ? (bulges[i] || 0) : 0;
    if (Math.abs(bulgeIn) > 1e-9 || Math.abs(bulgeOut) > 1e-9) return null;

    const vA = { x: prev.x - V.x, y: prev.y - V.y };
    const vC = { x: next.x - V.x, y: next.y - V.y };
    const lenA = Math.hypot(vA.x, vA.y);
    const lenC = Math.hypot(vC.x, vC.y);
    if (lenA < 1e-6 || lenC < 1e-6) return null;

    const uA = { x: vA.x / lenA, y: vA.y / lenA };
    const uC = { x: vC.x / lenC, y: vC.y / lenC };
    const dot = uA.x * uC.x + uA.y * uC.y;
    const halfAngle = Math.acos(Math.max(-1, Math.min(1, dot))) / 2;
    if (halfAngle < 1e-6 || Math.PI / 2 - halfAngle < 1e-6) return null;

    const d = r / Math.tan(halfAngle);
    if (d > lenA / 2 || d > lenC / 2) return null; 

    const T1 = { x: V.x + d * uA.x, y: V.y + d * uA.y };
    const T2 = { x: V.x + d * uC.x, y: V.y + d * uC.y };

    const cross = uA.x * uC.y - uA.y * uC.x;
    const turnCross = -cross;
    const beta = Math.acos(Math.max(-1, Math.min(1, dot))); 
    const theta = turnCross > 0 ? (Math.PI - beta) : -(Math.PI - beta);
    const bulge = Math.tan(theta / 4);

    return { T1, T2, bulge };
  }

  private calculateLineFillet(lineA: LineEntity, lineB: LineEntity, r: number, clA: IPoint, clB: IPoint): { arc: ArcEntity | null, tA: IPoint, tB: IPoint, ix: IPoint } | null {
    const ix = this.lineLineIntersection(lineA, lineB);
    if (!ix) return null;

    const dAx = lineA.x2 - lineA.x1, dAy = lineA.y2 - lineA.y1;
    const dBx = lineB.x2 - lineB.x1, dBy = lineB.y2 - lineB.y1;
    const lenA = Math.hypot(dAx, dAy), lenB = Math.hypot(dBx, dBy);
    const uAx = dAx / lenA, uAy = dAy / lenA;
    const uBx = dBx / lenB, uBy = dBy / lenB;

    if (r < 0.0001) {
      return { arc: null, tA: ix, tB: ix, ix };
    }

    const dot = uAx * uBx + uAy * uBy;
    const halfAngle = Math.acos(Math.max(-1, Math.min(1, Math.abs(dot))));
    if (halfAngle < 1e-6) return null;
    const dist = r / Math.tan(halfAngle / 2);

    let sA = 1, sB = 1;
    const cDA = Math.hypot(clA.x - (ix.x + dist * uAx), clA.y - (ix.y + dist * uAy));
    const cDA2 = Math.hypot(clA.x - (ix.x - dist * uAx), clA.y - (ix.y - dist * uAy));
    sA = cDA < cDA2 ? 1 : -1;

    const cDB = Math.hypot(clB.x - (ix.x + dist * uBx), clB.y - (ix.y + dist * uBy));
    const cDB2 = Math.hypot(clB.x - (ix.x - dist * uBx), clB.y - (ix.y - dist * uBy));
    sB = cDB < cDB2 ? 1 : -1;

    const tAx = ix.x + sA * dist * uAx, tAy = ix.y + sA * dist * uAy;
    const tBx = ix.x + sB * dist * uBx, tBy = ix.y + sB * dist * uBy;

    const nAx = -uAy, nAy = uAx;
    const nBx = -uBy, nBy = uBx;

    let cx = 0, cy = 0, found = false;
    for (const sNA of [1, -1]) {
      for (const sNB of [1, -1]) {
        const cxA = tAx + sNA * r * nAx, cyA = tAy + sNA * r * nAy;
        const cxB = tBx + sNB * r * nBx, cyB = tBy + sNB * r * nBy;
        if (Math.hypot(cxA - cxB, cyA - cyB) < r * 0.01) {
          cx = (cxA + cxB) / 2; cy = (cyA + cyB) / 2;
          found = true; break;
        }
      }
      if (found) break;
    }
    if (!found) return null;

    const sa = (Math.atan2(tAy - cy, tAx - cx) * 180) / Math.PI;
    const ea = (Math.atan2(tBy - cy, tBx - cx) * 180) / Math.PI;

    const arc = new ArcEntity(cx, cy, r, sa, ea, true);
    const cross = (tAx - cx) * (tBy - cy) - (tAy - cy) * (tBx - cx);
    arc.ccw = cross > 0;
    
    return { arc, tA: { x: tAx, y: tAy }, tB: { x: tBx, y: tBy }, ix };
  }

  /** Standard crosshair for command mode. */
  getCursor(): string {
    return 'crosshair';
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    // â”€â”€ First entity: persistent 'selected' highlight until commit/cancel â”€â”€
    if (this.first) {
      this.first.drawHovered(ctx, this.vm, this.doc, 'selected');
    }

    // â”€â”€ Second entity (after commit-lock): also persistent highlight â”€â”€
    if (this.waitingForRadius && this.second) {
      this.second.drawHovered(ctx, this.vm, this.doc, 'selected');
    }

    // â”€â”€ Hover preselection: show which entity the cursor is over â”€â”€
    if (!this.waitingForRadius && this.hovered) {
      // Before first pick: any valid entity gets hover glow.
      // After first pick: only entities != first get hover glow.
      if (!this.first || this.hovered !== this.first) {
        this.hovered.drawHovered(ctx, this.vm, this.doc, 'hover');
      }
    }

    // â”€â”€ Live fillet arc preview (dashed orange) â”€â”€
    if (this.previewArc) {
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(240, 160, 48, 0.9)';
      ctx.setLineDash([6, 3]);
      this.previewArc.draw(ctx, this.vm, this.doc);
      ctx.restore();

      // Center marker
      const c = this.vm.w2s(this.previewArc.cx, this.previewArc.cy);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(c.x - 4, c.y); ctx.lineTo(c.x + 4, c.y);
      ctx.moveTo(c.x, c.y - 4); ctx.lineTo(c.x, c.y + 4);
      ctx.strokeStyle = 'rgba(99,179,237,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }

    // â”€â”€ Trim preview: show removed segments as red dashed â”€â”€
    if (this.previewOps.length > 0) {
      ctx.save();
      for (const op of this.previewOps) {
        if (op.removedLine) {
          ctx.save();
          ctx.strokeStyle = 'rgba(240, 60, 60, 0.7)';
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 3]);
          const p1 = this.vm.w2s(op.removedLine.x1, op.removedLine.y1);
          const p2 = this.vm.w2s(op.removedLine.x2, op.removedLine.y2);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.restore();
        } else if (op.after instanceof PolylineEntity) {
          ctx.save();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(240, 160, 48, 0.9)';
          ctx.setLineDash([6, 3]);
          (op.after as PolylineEntity).draw(ctx, this.vm, this.doc);
          ctx.restore();
        }
      }
      ctx.restore();
    }
  }
}


