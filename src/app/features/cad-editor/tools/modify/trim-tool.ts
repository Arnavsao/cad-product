import { Injector } from '@angular/core';
import { ExtendTool } from './extend-tool';
import { ITool } from '../../core/models/tool.interface';
import { LineEntity, PolylineEntity, ArcEntity, CircleEntity, type Entity, type IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService, createProxyVm } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { IntersectionService } from '../../core/services/intersection.service';
import { ModifyGeometryCmd, DeleteEntityCmd, AddEntityCmd, CompoundCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';
import { snapshotEntity, pointToSegmentDistance, pointToArcDistance } from '../geometry-utils';
import { SpatialIndexService } from '../../core/services/spatial-index.service';

interface IPreviewCut {
  type: 'LINE' | 'ARC';
  x1?: number; y1?: number; x2?: number; y2?: number; // For LINE
  cx?: number; cy?: number; r?: number; sa?: number; ea?: number; ccw?: boolean; // For ARC
  entity: Entity;
}

interface IFencePoint {
  wx: number; wy: number;
  sx: number; sy: number;
}

/**
 * Quick-trim. Every other visible entity acts as a cutting edge. Click on the
 * portion of an entity you want removed.
 *
 * Behavior is node-based: cuts happen only at intersection nodes (or, for
 * polylines, also at the polyline's own vertices). The "interval" containing
 * the click â€” bounded by the two nearest nodes â€” is what gets removed.
 *
 * Supported targets:
 *   - LINE: split into 0/1/2 LineEntities depending on which interval is cut.
 *   - POLYLINE: re-emit as 1 or 2 open polylines depending on geometry.
 *     Closed polylines (e.g. rectangles) become open polylines on first cut.
 *
 * Not supported: arcs, circles, ellipses, splines as TARGETS (they still
 * count as cutting edges via IntersectionService).
 */
export class TrimTool implements ITool {
  readonly name = 'trim';
  private hoverSegment: IPreviewCut | null = null;
  private cur: IPoint = { x: 0, y: 0 };

  // Fence Trim State
  private isDragging = false;
  private fencePoints: IFencePoint[] = [];
  private dragCandidates = new Map<Entity, { cx: number; cy: number; cut: IPreviewCut }>();
  private pendingCmds: import('../../core/models/command.model').ICommand[] | null = null;
  
  // Temporary Extend Mode (Shift key)
  private isShiftPressed = false;
  private _extendTool: ExtendTool | null = null;
  private get extendTool(): ExtendTool {
    if (!this._extendTool) {
      this._extendTool = new ExtendTool(this.injector);
      this._extendTool.activate();
    }
    return this._extendTool;
  }

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get intersect() { return this.injector.get(IntersectionService) as IntersectionService; }
  private get spatial() { return this.injector.get(SpatialIndexService) as SpatialIndexService; }

  private pushCmd(cmd: import('../../core/models/command.model').ICommand) {
    if (this.pendingCmds) {
      this.pendingCmds.push(cmd);
    } else {
      this.cmds.push(cmd);
    }
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
        // Temporary Extend mode: clear any trim-specific state
        if (this.isDragging) {
          this.isDragging = false;
          this.fencePoints = [];
          this.dragCandidates.clear();
        }
        this.hoverSegment = null;
        this.extendTool.onMouseMove(wx, wy, sx, sy, e);
        return;
      }
    }

    this.cur = { x: wx, y: wy };

    if (this.isDragging) {
      const lastPt = this.fencePoints[this.fencePoints.length - 1];
      const dist = Math.hypot(sx - lastPt.sx, sy - lastPt.sy);
      if (dist > 4) {
        this.fencePoints.push({ wx, wy, sx, sy });
        this.collectFenceCandidates(lastPt.wx, lastPt.wy, wx, wy);
      }
      this.vm.markDirty();
      return;
    }

    this.hoverSegment = null;
    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (hit) {
      const file = this.doc.getFileOfEntity(hit.entity);
      let localX = wx;
      let localY = wy;
      if (file) {
        const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);
        const loc = fileVm.s2w(sx, sy);
        localX = loc.x;
        localY = loc.y;
      }
      const cut = this.computeCut(hit.entity, localX, localY);
      if (cut) {
        this.hoverSegment = cut;
      }
    }
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;
    
    if (this.tools.activeTool === this) {
      // Update shift state immediately
      this.isShiftPressed = e.shiftKey;
      
      if (this.isShiftPressed) {
        this.extendTool.onMouseDown(wx, wy, sx, sy, e);
        return;
      }
    }
    this.isDragging = true;
    this.fencePoints = [{ wx, wy, sx, sy }];
    this.dragCandidates.clear();
    this.hoverSegment = null;
    this.vm.markDirty();
  }

  onMouseUp(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (this.tools.activeTool === this) {
      // Update shift state immediately
      this.isShiftPressed = e.shiftKey;
      
      if (this.isShiftPressed) {
        this.extendTool.onMouseUp(wx, wy, sx, sy, e);
        return;
      }
    }
    if (!this.isDragging) return;
    this.isDragging = false;

    // If we didn't drag far, treat it as a single click trim
    const totalDist = this.fencePoints.length > 1 
      ? Math.hypot(sx - this.fencePoints[0].sx, sy - this.fencePoints[0].sy) 
      : 0;

    if (this.fencePoints.length === 1 || totalDist < 4) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit) {
        const file = this.doc.getFileOfEntity(hit.entity);
        let localX = wx;
        let localY = wy;
        if (file) {
          const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);
          const loc = fileVm.s2w(sx, sy);
          localX = loc.x;
          localY = loc.y;
        }
        this.trimEntity(hit.entity, localX, localY);
      }
    } else {
      // Execute collected fence trims
      if (this.dragCandidates.size > 0) {
        this.pendingCmds = [];
        for (const [ent, cand] of this.dragCandidates.entries()) {
          this.trimEntity(ent, cand.cx, cand.cy);
        }
        if (this.pendingCmds.length > 0) {
          this.cmds.push(new CompoundCmd(this.pendingCmds));
        }
        this.pendingCmds = null;
      }
    }

    this.fencePoints = [];
    this.dragCandidates.clear();
    this.onMouseMove(wx, wy, sx, sy);
  }

  private trimEntity(entity: Entity, cx: number, cy: number): void {
    if (entity instanceof LineEntity) {
      this.trimLine(entity, cx, cy);
    } else if (entity instanceof PolylineEntity) {
      this.trimPolyline(entity, cx, cy);
    } else if (entity instanceof ArcEntity) {
      this.trimArc(entity, cx, cy);
    } else if (entity instanceof CircleEntity) {
      this.trimCircle(entity, cx, cy);
    }
  }

  private collectFenceCandidates(wx1: number, wy1: number, wx2: number, wy2: number) {
    const left = Math.min(wx1, wx2);
    const right = Math.max(wx1, wx2);
    const bottom = Math.min(wy1, wy2);
    const top = Math.max(wy1, wy2);

    for (const file of this.doc.files) {
      if (!file.visible || file.locked) continue;
      const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);
      
      let candidateEntities: Entity[];
      if (file === this.doc.activeFile && this.spatial) {
        const ids = this.spatial.queryBox({ x: left, y: bottom, w: right - left, h: top - bottom });
        candidateEntities = this.spatial.resolve(ids);
        for (const ent of file.entities) {
          if (ent.type === 'XLINE' && !candidateEntities.includes(ent)) {
            candidateEntities.push(ent);
          }
        }
      } else {
        candidateEntities = file.entities;
      }

      const s1 = this.vm.w2s(wx1, wy1);
      const s2 = this.vm.w2s(wx2, wy2);
      const loc1 = fileVm.s2w(s1.x, s1.y);
      const loc2 = fileVm.s2w(s2.x, s2.y);
      const fenceSeg = new LineEntity(loc1.x, loc1.y, loc2.x, loc2.y);
      
      for (const ent of candidateEntities) {
        if (!ent.visible) continue;
        const lay = file.layers.get(ent.layer);
        if (lay && (lay.frozen || !lay.visible || lay.locked)) continue;
        
        if (this.dragCandidates.has(ent)) continue;

        const ints = this.intersect.getIntersections(fenceSeg, ent);
        if (ints.length > 0) {
          const ip = ints[0]; // IIntersection has x, y
          const cut = this.computeCut(ent, ip.x, ip.y);
          if (cut) {
            this.dragCandidates.set(ent, { cx: ip.x, cy: ip.y, cut });
          }
        }
      }
    }
  }

  /**
   * For hover preview: compute the interval (segment piece) of `target` that the
   * trim click would remove. Returns null if `target` isn't a supported type.
   */
  private computeCut(
    target: Entity,
    cx: number,
    cy: number,
  ): IPreviewCut | null {
    if (target instanceof LineEntity) {
      const r = this.findLineCut(target, cx, cy);
      if (!r) return null;
      return { type: 'LINE', x1: r.cutStart.x, y1: r.cutStart.y, x2: r.cutEnd.x, y2: r.cutEnd.y, entity: target };
    }
    if (target instanceof PolylineEntity) {
      const r = this.findPolylineCut(target, cx, cy);
      if (!r) return null;
      return { type: 'LINE', x1: r.cutStart.x, y1: r.cutStart.y, x2: r.cutEnd.x, y2: r.cutEnd.y, entity: target };
    }
    if (target instanceof ArcEntity) {
      const r = this.findArcCut(target, cx, cy);
      if (!r) return null;
      return { type: 'ARC', cx: r.cx, cy: r.cy, r: r.r, sa: r.sa, ea: r.ea, ccw: r.ccw, entity: target };
    }
    if (target instanceof CircleEntity) {
      const r = this.findCircleCut(target, cx, cy);
      if (!r) return null;
      return { type: 'ARC', cx: r.cx, cy: r.cy, r: r.r, sa: r.sa, ea: r.ea, ccw: r.ccw, entity: target };
    }
    return null;
  }

  /** Collect all other visible entities that can act as cutting edges for `target`. */
  private collectCuttingEdges(target: Entity): Entity[] {
    const edges: Entity[] = [];
    for (const file of this.doc.files) {
      if (!file.visible || file.locked) continue;
      for (const ent of file.entities) {
        if (!ent.visible) continue;
        const lay = file.layers.get(ent.layer);
        if (lay && (lay.frozen || !lay.visible || lay.locked)) continue;
        edges.push(ent);
      }
    }
    return edges;
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    // Only draw extend preview when Shift is pressed
    if (this.isShiftPressed && this._extendTool) {
      this._extendTool.drawPreview(ctx);
      return; // Don't draw trim preview when in extend mode
    }

    // Draw the fence path
    if (this.isDragging && this.fencePoints.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; // AutoCAD dashed white line style
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(this.fencePoints[0].sx, this.fencePoints[0].sy);
      for (let i = 1; i < this.fencePoints.length; i++) {
        ctx.lineTo(this.fencePoints[i].sx, this.fencePoints[i].sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Draw preview cuts
    const cutsToDraw: IPreviewCut[] = [];
    if (this.hoverSegment) cutsToDraw.push(this.hoverSegment);
    if (this.isDragging) {
      for (const cand of this.dragCandidates.values()) {
        cutsToDraw.push(cand.cut);
      }
    }

    for (const seg of cutsToDraw) {
      const ent = seg.entity;
      const file = this.doc.getFileOfEntity(ent);
      const fileVm = file
        ? createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation)
        : this.vm;

      ctx.save();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)'; // red highlight
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      
      if (seg.type === 'LINE') {
        const p1 = fileVm.w2s(seg.x1!, seg.y1!);
        const p2 = fileVm.w2s(seg.x2!, seg.y2!);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      } else if (seg.type === 'ARC') {
        const c = fileVm.w2s(seg.cx!, seg.cy!);
        const r = seg.r! * fileVm.scale;
        const sa = -seg.sa! * Math.PI / 180;
        const ea = -seg.ea! * Math.PI / 180;
        ctx.arc(c.x, c.y, r, sa, ea, seg.ccw);
      }
      
      ctx.stroke();
      ctx.restore();
    }
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

    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.hoverSegment = null;
      this.isShiftPressed = false;
      if (this._extendTool) {
        this._extendTool.deactivate();
      }
      this.tools.setTool('select');
      e.preventDefault();
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

  getPhase(): string { return 'select'; }

  getDynamicInputState(): import('../../core/models/tool.interface').IDynamicInputState | null {
    return this.extendTool.getDynamicInputState();
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    return this.extendTool.commitDynamicInput(values);
  }

  getCursor(): string {
    return 'crosshair';
  }

  getStatusText(): string {
    if (this.isShiftPressed) {
      return 'EXTEND (Temporary) - Release Shift to return to TRIM';
    }
    return 'TRIM - Hold Shift for temporary EXTEND mode';
  }

  deactivate(): void {
    this.hoverSegment = null;
    this.isDragging = false;
    this.fencePoints = [];
    this.dragCandidates.clear();
    this.isShiftPressed = false;
    if (this._extendTool) {
      const ext = this._extendTool;
      this._extendTool = null;
      ext.deactivate();
    }
  }

  activate(): void {
    this.isShiftPressed = false;
  }


  /**
   * Find the cut interval on a LINE target: nearest pair of nodes (intersections
   * with cutting edges, plus the line's own endpoints at t=0/1) that brackets the click.
   */
  private findLineCut(
    line: LineEntity,
    cx: number,
    cy: number,
  ): { t0: number; t1: number; cutStart: IPoint; cutEnd: IPoint; isStartAtEnd: boolean; isEndAtEnd: boolean; empty: boolean } | null {
    const edges = this.collectCuttingEdges(line);
    const ints: number[] = [];
    for (const edge of edges) {
      for (const h of this.intersect.getIntersections(line, edge)) {
        if (h.t > 0.001 && h.t < 0.999) ints.push(h.t);
      }
    }
    if (!ints.length) return { empty: true, t0: 0, t1: 1, cutStart: { x: line.x1, y: line.y1 }, cutEnd: { x: line.x2, y: line.y2 }, isStartAtEnd: true, isEndAtEnd: true };
    ints.sort((a, b) => a - b);

    const params = [0, ...ints, 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < params.length - 1; i++) {
      const t0 = params[i];
      const t1 = params[i + 1];
      const mx = line.x1 + ((t0 + t1) / 2) * (line.x2 - line.x1);
      const my = line.y1 + ((t0 + t1) / 2) * (line.y2 - line.y1);
      const d = Math.hypot(mx - cx, my - cy);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const t0 = params[bestIdx];
    const t1 = params[bestIdx + 1];
    return {
      t0, t1,
      cutStart: { x: line.x1 + t0 * (line.x2 - line.x1), y: line.y1 + t0 * (line.y2 - line.y1) },
      cutEnd: { x: line.x1 + t1 * (line.x2 - line.x1), y: line.y1 + t1 * (line.y2 - line.y1) },
      isStartAtEnd: bestIdx === 0,
      isEndAtEnd: bestIdx === params.length - 2,
      empty: false,
    };
  }

  private trimLine(line: LineEntity, cx: number, cy: number): void {
    const cut = this.findLineCut(line, cx, cy);
    if (!cut) return;
    const file = this.doc.getFileOfEntity(line);
    
    if (cut.empty && file) {
      this.pushCmd(new DeleteEntityCmd(line, file, { markDirty: () => this.vm.markContentDirty() }));
      return;
    }
    
    const before = snapshotEntity(line);

    if (cut.isStartAtEnd) {
      const after = { x1: cut.cutEnd.x, y1: cut.cutEnd.y, x2: line.x2, y2: line.y2 };
      this.pushCmd(new ModifyGeometryCmd(line, before, after, { markDirty: () => this.vm.markContentDirty() }));
    } else if (cut.isEndAtEnd) {
      const after = { x1: line.x1, y1: line.y1, x2: cut.cutStart.x, y2: cut.cutStart.y };
      this.pushCmd(new ModifyGeometryCmd(line, before, after, { markDirty: () => this.vm.markContentDirty() }));
    } else {
      const after = { x1: line.x1, y1: line.y1, x2: cut.cutStart.x, y2: cut.cutStart.y };
      const modCmd = new ModifyGeometryCmd(line, before, after, { markDirty: () => this.vm.markContentDirty() });
      const endLine = new LineEntity(cut.cutEnd.x, cut.cutEnd.y, line.x2, line.y2);
      endLine.layer = line.layer;
      endLine.colorNumber = line.colorNumber;
      endLine.lineType = line.lineType;
      if (file) {
        this.pushCmd(new CompoundCmd([modCmd, new AddEntityCmd(endLine, file, { markDirty: () => this.vm.markContentDirty() })]));
      } else {
        this.pushCmd(modCmd);
      }
    }

    const eps = 1e-6;
    if (Math.hypot(line.x2 - line.x1, line.y2 - line.y1) < eps && file) {
      this.pushCmd(new DeleteEntityCmd(line, file, { markDirty: () => this.vm.markContentDirty() }));
    }
  }

  /**
   * Find the cut interval on a POLYLINE target. Nodes are:
   *   - the polyline's own vertices (segment endpoints), and
   *   - intersections with every other visible entity, projected onto whichever segment they hit.
   *
   * The click locates which segment, and which "node-to-node" interval on that segment, is selected.
   * Returns the interval's start/end world coords plus enough metadata to rebuild the polyline.
   */
  private findPolylineCut(
    poly: PolylineEntity,
    cx: number,
    cy: number,
  ): { segIdx: number; t0: number; t1: number; cutStart: IPoint; cutEnd: IPoint; empty: boolean } | null {
    const pts = poly.pts;
    if (!pts || pts.length < 2) return null;
    const numSegs = poly.closed ? pts.length : pts.length - 1;
    if (numSegs <= 0) return null;

    const edges = this.collectCuttingEdges(poly);

    // 1. Find the segment closest to the click.
    let bestSeg = -1;
    let bestSegDist = Infinity;
    for (let i = 0; i < numSegs; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const d = pointToSegmentDistance(cx, cy, a, b);
      if (d < bestSegDist) { bestSegDist = d; bestSeg = i; }
    }
    if (bestSeg < 0) return null;

    // 2. On that segment, gather intersections (as t-params in [0,1]).
    const a = pts[bestSeg];
    const b = pts[(bestSeg + 1) % pts.length];
    const tempLine = new LineEntity(a.x, a.y, b.x, b.y);
    const ints: number[] = [];
    for (const edge of edges) {
      for (const h of this.intersect.getIntersections(tempLine, edge)) {
        if (h.t > 0.001 && h.t < 0.999) ints.push(h.t);
      }
    }
    
    if (!ints.length && edges.length === 0) {
        return { segIdx: 0, t0: 0, t1: 1, cutStart: a, cutEnd: b, empty: true };
    }

    ints.sort((p, q) => p - q);

    // 3. Bracket the click with the nearest pair of nodes (segment endpoints + intersections).
    const params = [0, ...ints, 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < params.length - 1; i++) {
      const t0 = params[i];
      const t1 = params[i + 1];
      const mx = a.x + ((t0 + t1) / 2) * (b.x - a.x);
      const my = a.y + ((t0 + t1) / 2) * (b.y - a.y);
      const d = Math.hypot(mx - cx, my - cy);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const t0 = params[bestIdx];
    const t1 = params[bestIdx + 1];
    return {
      segIdx: bestSeg,
      t0, t1,
      cutStart: { x: a.x + t0 * (b.x - a.x), y: a.y + t0 * (b.y - a.y) },
      cutEnd: { x: a.x + t1 * (b.x - a.x), y: a.y + t1 * (b.y - a.y) },
      empty: false,
    };
  }

  private trimPolyline(poly: PolylineEntity, cx: number, cy: number): void {
    const cut = this.findPolylineCut(poly, cx, cy);
    if (!cut) return;
    const file = this.doc.getFileOfEntity(poly);
    if (!file) return;
    
    if ((cut as any).empty) {
      this.pushCmd(new DeleteEntityCmd(poly, file, { markDirty: () => this.vm.markContentDirty() }));
      return;
    }

    const results = buildPolylineAfterCut(poly, cut.segIdx, cut.t0, cut.t1, cut.cutStart, cut.cutEnd);
    if (!results.length) {
      // Whole polyline goes away.
      this.pushCmd(new DeleteEntityCmd(poly, file, { markDirty: () => this.vm.markContentDirty() }));
      return;
    }

    const sub: Array<DeleteEntityCmd | AddEntityCmd> = [
      new DeleteEntityCmd(poly, file, { markDirty: () => this.vm.markContentDirty() }),
    ];
    for (const ptsArr of results) {
      const newPoly = new PolylineEntity(ptsArr.map((p: any) => ({ x: p.x, y: p.y })), false);
      newPoly.layer = poly.layer;
      newPoly.colorNumber = poly.colorNumber;
      newPoly.lineType = poly.lineType;
      sub.push(new AddEntityCmd(newPoly, file, { markDirty: () => this.vm.markContentDirty() }));
    }
    this.pushCmd(new CompoundCmd(sub));
  }

  private findArcCut(arc: ArcEntity, cx: number, cy: number) {
    const edges = this.collectCuttingEdges(arc);
    const ints: number[] = [];
    for (const edge of edges) {
      for (const h of this.intersect.getIntersections(arc, edge)) {
        if (h.t > 0.001 && h.t < 0.999) ints.push(h.t);
      }
    }
    
    if (!ints.length) {
      return { empty: true, t0: 0, t1: 1, sa: arc.startAngle, ea: arc.endAngle, cx: arc.cx, cy: arc.cy, r: arc.r, ccw: arc.ccw, isStartAtEnd: true, isEndAtEnd: true };
    }
    
    const uniqueInts = Array.from(new Set(ints.map(t => Math.round(t * 1e6) / 1e6))).sort((a, b) => a - b);
    const params = [0, ...uniqueInts, 1];
    
    const saNorm = norm360(arc.startAngle);
    const eaNorm = norm360(arc.endAngle);
    const sweep = arc.ccw 
      ? ((eaNorm - saNorm + 360) % 360 || 360) 
      : -((saNorm - eaNorm + 360) % 360 || 360);
      
    let bestIdx = -1;
    let bestDist = Infinity;
    
    for (let i = 0; i < params.length - 1; i++) {
      const t0 = params[i];
      const t1 = params[i + 1];
      
      const sa = arc.startAngle + t0 * sweep;
      const ea = arc.startAngle + t1 * sweep;
      
      const dist = pointToArcDistance(cx, cy, arc.cx, arc.cy, arc.r, sa, ea, arc.ccw);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    
    if (bestIdx === -1) return null;
    
    const t0 = params[bestIdx];
    const t1 = params[bestIdx + 1];
    
    const cutSa = arc.startAngle + t0 * sweep;
    const cutEa = arc.startAngle + t1 * sweep;
    
    return {
      t0, t1,
      sa: cutSa, ea: cutEa, cx: arc.cx, cy: arc.cy, r: arc.r, ccw: arc.ccw,
      isStartAtEnd: bestIdx === 0,
      isEndAtEnd: bestIdx === params.length - 2,
      empty: false
    };
  }

  private trimArc(arc: ArcEntity, cx: number, cy: number): void {
    const cut = this.findArcCut(arc, cx, cy);
    if (!cut) return;
    const file = this.doc.getFileOfEntity(arc);
    if (!file) return;

    if (cut.empty) {
      this.pushCmd(new DeleteEntityCmd(arc, file, { markDirty: () => this.vm.markContentDirty() }));
      return;
    }

    const before = snapshotEntity(arc);
    const sweep = arc.ccw 
      ? ((norm360(arc.endAngle) - norm360(arc.startAngle) + 360) % 360 || 360) 
      : -((norm360(arc.startAngle) - norm360(arc.endAngle) + 360) % 360 || 360);

    if (cut.isStartAtEnd) {
      const after = { startAngle: arc.startAngle + cut.t1 * sweep, endAngle: arc.endAngle };
      this.pushCmd(new ModifyGeometryCmd(arc, before, after, { markDirty: () => this.vm.markContentDirty() }));
    } else if (cut.isEndAtEnd) {
      const after = { startAngle: arc.startAngle, endAngle: arc.startAngle + cut.t0 * sweep };
      this.pushCmd(new ModifyGeometryCmd(arc, before, after, { markDirty: () => this.vm.markContentDirty() }));
    } else {
      const after = { startAngle: arc.startAngle, endAngle: arc.startAngle + cut.t0 * sweep };
      const modCmd = new ModifyGeometryCmd(arc, before, after, { markDirty: () => this.vm.markContentDirty() });
      const endArc = new ArcEntity(arc.cx, arc.cy, arc.r, arc.startAngle + cut.t1 * sweep, arc.endAngle, arc.ccw);
      endArc.layer = arc.layer;
      endArc.colorNumber = arc.colorNumber;
      endArc.lineType = arc.lineType;
      this.pushCmd(new CompoundCmd([modCmd, new AddEntityCmd(endArc, file, { markDirty: () => this.vm.markContentDirty() })]));
    }
  }

  private findCircleCut(circle: CircleEntity, cx: number, cy: number) {
    const edges = this.collectCuttingEdges(circle);
    const ints: number[] = [];
    for (const edge of edges) {
      for (const h of this.intersect.getIntersections(circle, edge)) {
        ints.push(h.t); // t is in [0, 1) based on 360 deg
      }
    }
    
    if (ints.length < 2) {
      return { empty: true, sa: 0, ea: 360, cx: circle.cx, cy: circle.cy, r: circle.r, ccw: true, t0: 0, t1: 1, ints };
    }
    
    // Sort and unique
    const uniqueInts = Array.from(new Set(ints.map(t => Math.round(t * 1e6) / 1e6))).sort((a, b) => a - b);
    if (uniqueInts.length < 2) {
      return { empty: true, sa: 0, ea: 360, cx: circle.cx, cy: circle.cy, r: circle.r, ccw: true, t0: 0, t1: 1, ints: uniqueInts };
    }

    let bestIdx = -1;
    let bestDist = Infinity;
    
    for (let i = 0; i < uniqueInts.length; i++) {
      const t0 = uniqueInts[i];
      const t1 = uniqueInts[(i + 1) % uniqueInts.length];
      
      const sa = t0 * 360;
      const ea = t1 * 360;
      
      const dist = pointToArcDistance(cx, cy, circle.cx, circle.cy, circle.r, sa, ea, true);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    
    if (bestIdx === -1) return null;
    
    const t0 = uniqueInts[bestIdx];
    const t1 = uniqueInts[(bestIdx + 1) % uniqueInts.length];
    const finalT1 = bestIdx === uniqueInts.length - 1 ? t1 + 1 : t1;

    return {
      empty: false,
      sa: t0 * 360, ea: finalT1 * 360, cx: circle.cx, cy: circle.cy, r: circle.r, ccw: true,
      t0, t1: finalT1, ints: uniqueInts
    };
  }

  private trimCircle(circle: CircleEntity, cx: number, cy: number): void {
    const cut = this.findCircleCut(circle, cx, cy);
    if (!cut) return;
    const file = this.doc.getFileOfEntity(circle);
    if (!file) return;

    if (cut.empty) {
      this.pushCmd(new DeleteEntityCmd(circle, file, { markDirty: () => this.vm.markContentDirty() }));
      return;
    }

    // Convert circle to an arc that spans the REMAINING part.
    // The cut is from t0 to t1. The remaining arc is from t1 to t0 + 1!
    const remSa = cut.t1 * 360;
    const remEa = (cut.t0 + 1) * 360;
    
    const arc = new ArcEntity(circle.cx, circle.cy, circle.r, remSa, remEa, true);
    arc.layer = circle.layer;
    arc.colorNumber = circle.colorNumber;
    arc.lineType = circle.lineType;

    const delCmd = new DeleteEntityCmd(circle, file, { markDirty: () => this.vm.markContentDirty() });
    const addCmd = new AddEntityCmd(arc, file, { markDirty: () => this.vm.markContentDirty() });
    
    this.pushCmd(new CompoundCmd([delCmd, addCmd]));
  }
}

const norm360 = (v: number) => ((v % 360) + 360) % 360;

/* -------------------------------------------------------------------------- */

/**
 * Rebuild a polyline's vertex list(s) after removing the interval (cutStartâ†’cutEnd)
 * on segment `segIdx`. Returns 1 polyline (if open & cut at an end, or if closed),
 * 2 polylines (open polyline cut in the middle), or 0 (degenerate).
 */
function buildPolylineAfterCut(
  poly: PolylineEntity,
  segIdx: number,
  t0: number,
  t1: number,
  cutStart: IPoint,
  cutEnd: IPoint,
): IPoint[][] {
  const pts = poly.pts;
  const N = pts.length;
  const eps = 1e-6;
  const startAtVertex = t0 < eps;
  const endAtVertex = t1 > 1 - eps;

  if (poly.closed) {
    // Open the loop, walking from cutEnd â†’ pts[(segIdx+1)%N] â†’ ... â†’ pts[segIdx] â†’ cutStart.
    const result: IPoint[] = [];
    if (!endAtVertex) result.push(cutEnd);
    for (let k = 1; k <= N; k++) {
      const idx = (segIdx + k) % N;
      result.push({ x: pts[idx].x, y: pts[idx].y });
    }
    if (!startAtVertex) result.push(cutStart);
    return result.length >= 2 ? [result] : [];
  }

  // Open polyline: emit prefix and suffix as separate polylines.
  const out: IPoint[][] = [];

  const prefix: IPoint[] = [];
  for (let k = 0; k <= segIdx; k++) prefix.push({ x: pts[k].x, y: pts[k].y });
  if (!startAtVertex) prefix.push(cutStart);
  if (prefix.length >= 2) out.push(prefix);

  const suffix: IPoint[] = [];
  if (!endAtVertex) suffix.push(cutEnd);
  for (let k = segIdx + 1; k < N; k++) suffix.push({ x: pts[k].x, y: pts[k].y });
  if (suffix.length >= 2) out.push(suffix);

  return out;
}
