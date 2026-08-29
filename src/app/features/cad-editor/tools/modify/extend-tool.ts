import { Injector } from '@angular/core';
import { TrimTool } from './trim-tool';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { LineEntity, PolylineEntity, ArcEntity, type Entity, type IPoint } from '../../core/models/entity.model';
import { SplineEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { IntersectionService } from '../../core/services/intersection.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { ModifyGeometryCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';
import { snapshotEntity } from '../geometry-utils';
import { evalExpression } from '../../core/utils/expression-parser';
import { formatLen } from '../draw/draw-utils';

type ExtendMode = 'select_boundary' | 'extend_target';
type ExtendEndpointKind = 'lineA' | 'lineB' | 'polyFirst' | 'polyLast' | 'arcStart' | 'arcEnd' | 'splineStart' | 'splineEnd';

export class ExtendTool implements ITool {
  readonly name = 'extend';

  /** AutoCAD Quick mode: every other visible entity is a boundary. */
  private mode: ExtendMode = 'extend_target';
  private useAllBoundaries = true;
  private boundaries = new Set<Entity>();
  private boundaryHover: Entity | null = null;
  private targetHover: Entity | null = null;

  /** Practical "ray to infinity" for line-of-extension intersection queries (world units). */
  private readonly FAR = 1e6;

  /** Live preview state while the cursor is over a valid extendable endpoint. */
  private preview: IExtendPreview | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  private committedOnPointerDown = false;
  
  // Temporary Trim Mode (Shift key)
  private isShiftPressed = false;
  private _trimTool: TrimTool | null = null;
  private get trimTool(): TrimTool {
    if (!this._trimTool) {
      this._trimTool = new TrimTool(this.injector);
    }
    return this._trimTool;
  }

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get intersect() { return this.injector.get(IntersectionService) as IntersectionService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  getCursor(): string {
    return 'crosshair';
  }

  getStatusText(): string {
    if (this.isShiftPressed) {
      return 'TRIM (Temporary) - Release Shift to return to EXTEND';
    }
    return 'EXTEND - Hold Shift for temporary TRIM mode';
  }

  activate(): void {
    this.reset();
    this.isShiftPressed = false;
  }

  private reset(): void {
    this.mode = 'extend_target';
    this.useAllBoundaries = true;
    this.boundaries.clear();
    this.boundaryHover = null;
    this.targetHover = null;
    this.preview = null;
    this.committedOnPointerDown = false;
    this.isShiftPressed = false;
    this.dyn.clearEdits();
    this.vm.markDirty();
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number, e?: MouseEvent): void {
    if (this.tools.activeTool === this) {
      // Check if Shift key state changed
      const shiftNow = e?.shiftKey ?? false;
      if (shiftNow !== this.isShiftPressed) {
        this.isShiftPressed = shiftNow;
        this.vm.markDirty(); // Force cursor/visual update
      }

      if (this.isShiftPressed) {
        // Temporary Trim mode: clear any extend-specific state
        if (this.preview) {
          this.preview = null;
          this.vm.markDirty();
        }
        this.trimTool.onMouseMove(wx, wy, sx, sy, e);
        return;
      }
    }

    this.cur = { x: wx, y: wy };
    const hit = hitTestAll(this.doc, this.vm, sx, sy);

    if (this.mode === 'select_boundary') {
      const newHover = hit ? hit.entity : null;
      if (this.boundaryHover !== newHover) {
        this.boundaryHover = newHover;
        this.vm.markDirty();
      }
    } else {
      const newTarget = hit && this.isEditableTarget(hit.entity) ? hit.entity : null;
      if (this.targetHover !== newTarget) {
        this.targetHover = newTarget;
        this.vm.markDirty();
      }
      if (!newTarget) {
        if (this.preview) {
          this.preview = null;
          this.vm.markDirty();
        }
        return;
      }
      const next = this.buildPreview(newTarget, wx, wy);
      if (!sameExtension(this.preview, next)) {
        this.preview = next;
        this.vm.markDirty();
      }
    }
  }

  onMouseDown(_wx: number, _wy: number, _sx: number, _sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;
    
    if (this.tools.activeTool === this) {
      // Update shift state immediately
      this.isShiftPressed = e.shiftKey;
      
      if (this.isShiftPressed) {
        this.trimTool.onMouseDown(_wx, _wy, _sx, _sy, e);
        return;
      }
    }
    this.committedOnPointerDown = false;

    if (this.mode === 'select_boundary') {
      if (this.boundaryHover) {
        if (this.boundaries.has(this.boundaryHover)) {
          this.boundaries.delete(this.boundaryHover);
        } else {
          this.boundaries.add(this.boundaryHover);
        }
        this.vm.markDirty();
      }
    } else {
      if (!this.preview) return;
      this.applyExtension(this.preview);
      this.committedOnPointerDown = true;
      // Keep boundaries active for continuous extending, just clear preview.
      this.preview = null;
      this.dyn.clearEdits();
      this.vm.markDirty();
    }
  }

  /**
   * Mouse-up fallback for hosts/overlays that claim the initial pointer-down.
   * When mouse-down already committed, this is deliberately a no-op.
   */
  onMouseUp(_wx: number, _wy: number, _sx: number, _sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;
    
    if (this.tools.activeTool === this) {
      // Update shift state immediately
      this.isShiftPressed = e.shiftKey;
      
      if (this.isShiftPressed) {
        this.trimTool.onMouseUp(_wx, _wy, _sx, _sy, e);
        return;
      }
    }
    if (this.committedOnPointerDown) {
      this.committedOnPointerDown = false;
      return;
    }
    if (this.mode !== 'extend_target' || !this.preview) return;

    this.applyExtension(this.preview);
    this.preview = null;
    this.dyn.clearEdits();
    this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    // Only draw trim preview when Shift is pressed
    if (this.isShiftPressed && this._trimTool) {
      this._trimTool.drawPreview(ctx);
      return; // Don't draw extend preview when in trim mode
    }

    // 1. Draw boundaries (persistent blue selection)
    for (const ent of this.boundaries) {
      ent.drawHovered(ctx, this.vm, this.doc, 'selected');
    }

    // 2. Draw hover highlights based on mode
    if (this.mode === 'select_boundary') {
      if (this.boundaryHover && !this.boundaries.has(this.boundaryHover)) {
        this.boundaryHover.drawHovered(ctx, this.vm, this.doc, 'hover');
      }
    } else {
      if (this.targetHover && !this.boundaries.has(this.targetHover)) {
        this.targetHover.drawHovered(ctx, this.vm, this.doc, 'target');
      }
    }

    // 3. Draw extension preview (dashed orange + endpoint marker)
    if (this.mode === 'extend_target' && this.preview) {
      const tip = this.vm.w2s(this.preview.tip.x, this.preview.tip.y);
      const dst = this.vm.w2s(this.preview.newTip.x, this.preview.newTip.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(240, 160, 48, 0.9)';
      ctx.fillStyle = 'rgba(240, 160, 48, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      
      if (this.preview.target instanceof ArcEntity) {
        // Draw dashed arc segment instead of a straight line
        const arc = this.preview.target;
        const fakeArc = new ArcEntity(
          arc.cx, 
          arc.cy, 
          arc.r, 
          this.preview.kind === 'arcEnd' ? arc.endAngle : this.preview.arcHitAngle!, 
          this.preview.kind === 'arcEnd' ? this.preview.arcHitAngle! : arc.startAngle, 
          arc.ccw
        );
        fakeArc.draw(ctx, this.vm, this.doc);
      } else {
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(dst.x, dst.y);
        ctx.stroke();
      }
      
      // Intersection marker at the new endpoint.
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(dst.x, dst.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  getPhase(): string {
    return this.mode === 'select_boundary' ? 'select' : 'target';
  }

  getAnchor(): IPoint | null {
    return this.preview ? this.preview.tip : null;
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.preview) return null;
    return {
      wx: this.preview.newTip.x,
      wy: this.preview.newTip.y,
      primaryFieldKey: 'distance',
      fields: [
        { key: 'distance', label: 'Distance', liveValue: formatLen(this.preview.distance), width: 80 },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (!this.preview) return false;
    const d = evalExpression(values['distance'] ?? '');
    if (d === null || !Number.isFinite(d) || d <= 0) return false;
    const newTip = {
      x: this.preview.tip.x + this.preview.ux * d,
      y: this.preview.tip.y + this.preview.uy * d,
    };
    this.applyExtension({ ...this.preview, newTip, distance: d });
    this.preview = null;
    this.dyn.clearEdits();
    return true;
  }

  onKeyDown(e: KeyboardEvent): void {
    // Track Shift key press globally
    if (e.key === 'Shift') {
      if (!this.isShiftPressed) {
        this.isShiftPressed = true;
        this.vm.markDirty(); // Trigger visual update
      }
      return;
    }

    if (e.key === 'Escape') {
      if (this.mode === 'extend_target') {
        // AutoCAD ESC out of target selection usually cancels the command
        this.reset();
        this.tools.setTool('select');
      } else {
        this.reset();
        this.tools.setTool('select');
      }
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      if (this.mode === 'select_boundary') {
        if (this.boundaries.size === 0) {
          // "Select All" fallback: populate with all visible entities
          for (const file of this.doc.files) {
            if (!file.visible || file.locked) continue;
            for (const ent of file.entities) {
              if (ent.visible) {
                const lay = file.layers.get(ent.layer);
                if (!lay || (!lay.frozen && lay.visible && !lay.locked)) {
                  this.boundaries.add(ent);
                }
              }
            }
          }
        }
        this.mode = 'extend_target';
        this.boundaryHover = null;
        this.vm.markDirty();
        e.preventDefault();
      } else {
        this.reset();
        this.tools.setTool('select');
        e.preventDefault();
      }
      return;
    }
  }

  onKeyUp(e: KeyboardEvent): void {
    // Track Shift key release globally
    if (e.key === 'Shift') {
      if (this.isShiftPressed) {
        this.isShiftPressed = false;
        this.vm.markDirty(); // Trigger visual update
      }
    }
  }

  deactivate(): void {
    this.isShiftPressed = false;
    if (this._trimTool) {
      const trim = this._trimTool;
      this._trimTool = null;
      trim.deactivate();
    }
    this.reset();
  }

  /* -------------------------------------------------------------------- */
  /*  Geometry                                                              */
  /* -------------------------------------------------------------------- */

  private buildPreview(target: Entity, cx: number, cy: number): IExtendPreview | null {
    if (!this.useAllBoundaries && this.boundaries.has(target)) return null;

    let kind: ExtendEndpointKind;
    let tip: IPoint;
    let tail: IPoint;

    if (target instanceof LineEntity) {
      const d1 = Math.hypot(cx - target.x1, cy - target.y1);
      const d2 = Math.hypot(cx - target.x2, cy - target.y2);
      if (d1 < d2) {
        kind = 'lineA'; tip = { x: target.x1, y: target.y1 }; tail = { x: target.x2, y: target.y2 };
      } else {
        kind = 'lineB'; tip = { x: target.x2, y: target.y2 }; tail = { x: target.x1, y: target.y1 };
      }
    } else if (target instanceof PolylineEntity) {
      if (target.closed || !target.pts || target.pts.length < 2) return null;
      const first = target.pts[0];
      const last = target.pts[target.pts.length - 1];
      const dFirst = Math.hypot(cx - first.x, cy - first.y);
      const dLast = Math.hypot(cx - last.x, cy - last.y);
      if (dFirst < dLast) {
        kind = 'polyFirst'; tip = { x: first.x, y: first.y }; tail = { x: target.pts[1].x, y: target.pts[1].y };
      } else {
        kind = 'polyLast'; tip = { x: last.x, y: last.y };
        const prev = target.pts[target.pts.length - 2];
        tail = { x: prev.x, y: prev.y };
      }
    } else if (target instanceof ArcEntity) {
      const pStart = target.getStartPoint();
      const pEnd = target.getEndPoint();
      const dStart = Math.hypot(cx - pStart.x, cy - pStart.y);
      const dEnd = Math.hypot(cx - pEnd.x, cy - pEnd.y);
      if (dStart < dEnd) {
        kind = 'arcStart'; tip = pStart; tail = pEnd;
      } else {
        kind = 'arcEnd'; tip = pEnd; tail = pStart;
      }
    } else if (target instanceof SplineEntity) {
      if (target.controlPoints.length < 2) return null;
      const first = target.controlPoints[0];
      const last = target.controlPoints[target.controlPoints.length - 1];
      const dFirst = Math.hypot(cx - first.x, cy - first.y);
      const dLast = Math.hypot(cx - last.x, cy - last.y);
      if (dFirst < dLast) {
        kind = 'splineStart';
        tip = { x: first.x, y: first.y };
        tail = { x: target.controlPoints[1].x, y: target.controlPoints[1].y };
      } else {
        kind = 'splineEnd';
        tip = { x: last.x, y: last.y };
        const prev = target.controlPoints[target.controlPoints.length - 2];
        tail = { x: prev.x, y: prev.y };
      }
    } else {
      return null;
    }

    if (target instanceof ArcEntity) {
      const fakeCircle = { cx: target.cx, cy: target.cy, r: target.r, type: 'CIRCLE' };
      let bestAngleDiff = Infinity;
      let bestHit: IPoint | null = null;
      let bestHitAngle = 0;
      
      const norm360 = (a: number) => ((a % 360) + 360) % 360;
      const sa = norm360(target.startAngle);
      const ea = norm360(target.endAngle);
      const isCcw = target.ccw !== false;

      for (const ent of this.boundaryCandidates(target)) {
        let hits;
        try { hits = this.intersect.getIntersections(fakeCircle as any, ent); }
        catch { continue; }
        for (const h of hits) {
          const hitAngle = norm360((Math.atan2(h.y - target.cy, h.x - target.cx) * 180) / Math.PI);
          let diff = 0;

          if (kind === 'arcEnd') {
            diff = isCcw ? norm360(hitAngle - ea) : norm360(ea - hitAngle);
          } else { // arcStart
            diff = isCcw ? norm360(sa - hitAngle) : norm360(hitAngle - sa);
          }

          if (diff > 0.1 && diff < bestAngleDiff && diff < 359) {
            bestAngleDiff = diff;
            bestHit = { x: h.x, y: h.y };
            bestHitAngle = hitAngle;
          }
        }
      }
      if (!bestHit || bestAngleDiff === Infinity) return null;
      
      const arcLenDist = (bestAngleDiff * Math.PI / 180) * target.r;
      return { target, kind, tip, ux: 0, uy: 0, newTip: bestHit, distance: arcLenDist, arcHitAngle: bestHitAngle };
    }

    const dx = tip.x - tail.x;
    const dy = tip.y - tail.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const ux = dx / len;
    const uy = dy / len;

    const fakeRay = {
      x1: tip.x, y1: tip.y,
      x2: tip.x + ux * this.FAR, y2: tip.y + uy * this.FAR,
      type: 'LINE',
    };
    let bestDist = Infinity;
    let bestHit: IPoint | null = null;
    
    for (const ent of this.boundaryCandidates(target)) {
      let hits;
      try { hits = this.intersect.getIntersections(fakeRay as any, ent); }
      catch { continue; }
      for (const h of hits) {
        if (h.t <= 1e-9) continue;
        const dist = h.t * this.FAR;
        if (dist < bestDist) {
          bestDist = dist;
          bestHit = { x: h.x, y: h.y };
        }
      }
    }
    
    if (!bestHit || !Number.isFinite(bestDist)) return null;

    return { target, kind, tip, ux, uy, newTip: bestHit, distance: bestDist };
  }

  /**
   * Quick-mode cutting edges. Keeping candidates in the active file avoids
   * mixing untransformed reference-file coordinates with active-file geometry.
   */
  private boundaryCandidates(target: Entity): Entity[] {
    if (!this.useAllBoundaries) {
      return [...this.boundaries];
    }

    const file = this.doc.activeFile;
    return file.entities.filter((entity) => {
      if (!entity.visible) return false;
      const layer = file.layers.get(entity.layer);
      return !layer || (!layer.frozen && layer.visible && !layer.locked);
    });
  }

  private isEditableTarget(entity: Entity): boolean {
    if (!this.doc.activeFile.entities.includes(entity)) return false;
    return entity instanceof LineEntity
      || entity instanceof PolylineEntity
      || entity instanceof ArcEntity
      || entity instanceof SplineEntity;
  }

  private applyExtension(p: IExtendPreview): void {
    const ent = p.target;
    const before = snapshotEntity(ent);
    const after = snapshotEntity(ent);

    if (p.kind === 'lineA') {
      after['x1'] = p.newTip.x;
      after['y1'] = p.newTip.y;
    } else if (p.kind === 'lineB') {
      after['x2'] = p.newTip.x;
      after['y2'] = p.newTip.y;
    } else if (p.kind === 'polyFirst') {
      const poly = ent as PolylineEntity;
      after['pts'] = poly.pts.map((q, i) => i === 0
        ? { x: p.newTip.x, y: p.newTip.y }
        : { x: q.x, y: q.y });
    } else if (p.kind === 'polyLast') {
      const poly = ent as PolylineEntity;
      const last = poly.pts.length - 1;
      after['pts'] = poly.pts.map((q, i) => i === last
        ? { x: p.newTip.x, y: p.newTip.y }
        : { x: q.x, y: q.y });
    } else if (p.kind === 'arcStart') {
      after['startAngle'] = p.arcHitAngle!;
    } else if (p.kind === 'arcEnd') {
      after['endAngle'] = p.arcHitAngle!;
    } else if (p.kind === 'splineStart') {
      const spl = ent as SplineEntity;
      after['controlPoints'] = [{ x: p.newTip.x, y: p.newTip.y }, ...spl.controlPoints];
    } else if (p.kind === 'splineEnd') {
      const spl = ent as SplineEntity;
      after['controlPoints'] = [...spl.controlPoints, { x: p.newTip.x, y: p.newTip.y }];
    }

    this.cmds.push(new ModifyGeometryCmd(ent, before, after, { markDirty: () => this.vm.markContentDirty() }));
  }
}

interface IExtendPreview {
  target: Entity;
  kind: ExtendEndpointKind;
  tip: IPoint;
  ux: number;
  uy: number;
  newTip: IPoint;
  distance: number;
  arcHitAngle?: number;
}

function sameExtension(a: IExtendPreview | null, b: IExtendPreview | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.target !== b.target) return false;
  if (a.kind !== b.kind) return false;
  if (Math.abs(a.newTip.x - b.newTip.x) > 1e-6) return false;
  if (Math.abs(a.newTip.y - b.newTip.y) > 1e-6) return false;
  return true;
}

