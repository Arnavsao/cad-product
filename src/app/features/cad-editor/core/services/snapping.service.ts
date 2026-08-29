import { Injectable, inject, signal } from '@angular/core';
import { DocumentService } from './document.service';
import { ViewModelService, createProxyVm } from './view-model.service';
import { TopologyService } from './topology.service';
import { ThemeService } from './theme.service';
import { IPoint, ISnapPoint } from '../models/entity.model';
import { ObjectSnapTrackingService } from './object-snap-tracking.service';
import { ToolManagerService } from './tool-manager.service';
import { SpatialIndexService } from './spatial-index.service';

export interface ISnapResult {
  x: number;
  y: number;
  label: string;
  sx: number;
  sy: number;
  mode?: ObjectSnapMode;
  /** Source entity id if the snap came from a single entity's snap point. */
  entityId?: number;
  /** Index into the source entity's `snapPoints()` array. */
  snapIndex?: number;
}

export type ObjectSnapMode =
  | 'endpoint'
  | 'vertex'
  | 'midpoint'
  | 'center'
  | 'geometricCenter'
  | 'node'
  | 'quadrant'
  | 'intersection'
  | 'extension'
  | 'insertion'
  | 'perpendicular'
  | 'tangent'
  | 'nearest'
  | 'apparentIntersection'
  | 'parallel';

export interface ObjectSnapModeDefinition {
  id: ObjectSnapMode;
  label: string;
  icon: string;
}

export const OBJECT_SNAP_MODES: readonly ObjectSnapModeDefinition[] = [
  { id: 'vertex', label: 'Vertex', icon: 'VTX' },
  { id: 'endpoint', label: 'Endpoint', icon: '⌞' },
  { id: 'midpoint', label: 'Midpoint', icon: '△' },
  { id: 'center', label: 'Center', icon: '⊙' },
  { id: 'geometricCenter', label: 'Geometric Center', icon: '▣' },
  { id: 'node', label: 'Node', icon: '▪' },
  { id: 'quadrant', label: 'Quadrant', icon: '◌' },
  { id: 'intersection', label: 'Intersection', icon: '╳' },
  { id: 'extension', label: 'Extension', icon: '⋯' },
  { id: 'insertion', label: 'Insertion', icon: '⌑' },
  { id: 'perpendicular', label: 'Perpendicular', icon: '⊥' },
  { id: 'tangent', label: 'Tangent', icon: '◜' },
  { id: 'nearest', label: 'Nearest', icon: '⌁' },
  { id: 'apparentIntersection', label: 'Apparent Intersection', icon: '╳' },
  { id: 'parallel', label: 'Parallel', icon: '∥' },
] as const;

/**
 * Port of 42-snapping-ortho.js — OSNAP + Ortho engines.
 *
 * Active tools should:
 *   1. Call snap.find(sx, sy) → if hit, prefer that world point over raw cursor.
 *   2. Call snap.constrain(...) before placing geometry if ortho is on.
 *   3. Implement `getAnchor()` (or expose `p1`/`center`/etc.) so ortho knows the pivot.
 *   4. Call snap.render(ctx) inside drawPreview so the green marker appears.
 */
@Injectable({ providedIn: 'root' })
export class SnappingService {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private topology = inject(TopologyService);
  private theme = inject(ThemeService);
  private otrack = inject(ObjectSnapTrackingService);
  private toolMgr = inject(ToolManagerService);
  private spatial = inject(SpatialIndexService);

  readonly osnapEnabled = signal(true);
  readonly orthoEnabled = signal(false);
  readonly gridEnabled = signal(true);
  readonly polarEnabled = signal(false);
  readonly polarIncrement = signal(15);
  readonly otrackEnabled = this.otrack.enabled;
  readonly enabledObjectSnaps = signal<ReadonlySet<ObjectSnapMode>>(loadObjectSnapModes());

  /**
   * Temporary ortho override — true while the user holds Shift. XOR'd with
   * `orthoEnabled` to produce the effective state. Matches AutoCAD: Shift held
   * inverts the F8 state for the duration it's held.
   */
  readonly orthoOverride = signal(false);

  /** Screen-pixel tolerance for snap detection. */
  tolerance = 15;

  current: ISnapResult | null = null;

  /** Last angle (degrees) locked by polar/ortho, used by render() for the ray label. */
  private lockedAngleDeg: number | null = null;

  /** Effective ortho state = persistent toggle XOR Shift override. */
  isOrthoActive(): boolean {
    return this.orthoEnabled() !== this.orthoOverride();
  }

  toggleOsnap(): void {
    this.osnapEnabled.update((v) => !v);
    if (!this.osnapEnabled()) this.clear();
    this.vm.markDirty();
  }

  isObjectSnapEnabled(mode: ObjectSnapMode): boolean {
    return this.enabledObjectSnaps().has(mode);
  }

  toggleObjectSnap(mode: ObjectSnapMode): void {
    const next = new Set(this.enabledObjectSnaps());
    if (next.has(mode)) next.delete(mode);
    else next.add(mode);
    this.setObjectSnapModes(next);
  }

  setAllObjectSnaps(enabled: boolean): void {
    this.setObjectSnapModes(enabled ? new Set(OBJECT_SNAP_MODES.map((m) => m.id)) : new Set());
  }

  private setObjectSnapModes(modes: ReadonlySet<ObjectSnapMode>): void {
    this.enabledObjectSnaps.set(new Set(modes));
    try {
      localStorage.setItem(OBJECT_SNAP_STORAGE_KEY, JSON.stringify([...modes]));
    } catch {
      // Local storage can be unavailable in tests/private contexts; snapping
      // should still work for the current session.
    }
    this.clear();
    this.vm.markDirty();
  }

  toggleOrtho(): void {
    this.orthoEnabled.update((v) => !v);
    if (this.orthoEnabled()) this.polarEnabled.set(false);
    this.vm.markDirty();
  }

  togglePolar(): void {
    this.polarEnabled.update((v) => !v);
    if (this.polarEnabled()) this.orthoEnabled.set(false);
    this.lockedAngleDeg = null;
    this.vm.markDirty();
  }

  toggleGrid(): void {
    this.gridEnabled.update((v) => !v);
    this.vm.markGridDirty();
  }

  clear(): void {
    this.current = null;
    this.otrack.clear();
  }

  toggleOtrack(): void {
    this.otrack.toggle();
  }

  /** Find nearest snap point under the cursor (screen pixels). */
  find(sx: number, sy: number, anchor: IPoint | null = null): ISnapResult | null {
    return this.findObjectSnap(sx, sy, anchor);
    // Legacy implementation retained below as reference while the richer
    // AutoCAD-style OSNAP mode engine handles live snapping.
    /*
    if (!this.osnapEnabled() || (this.toolMgr.activeTool as any).isWindowSelecting?.()) return null;
    let best: ISnapResult | null = null;
    let bestDist = this.tolerance;

    for (const file of this.doc.files) {
      if (!file.visible || file.locked) continue;
      const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);

      // Cursor in file-local coords + a world-units tolerance corresponding
      // to the screen pixel tolerance at this file's effective scale.
      // Used to skip the per-entity snapPoints() walk for anything whose
      // bbox is clearly outside the cursor's reach. snapPoints() can be
      // expensive on polylines/splines/tables, so prefiltering by bbox
      // turns O(n * m) per mousemove into O(n + k*m) where k is the
      // entity count actually near the cursor.
      const cursorLocal = fileVm.s2w(sx, sy);
      const effScale = Math.max(fileVm.cumulativeScale, 1e-6);
      const localTol = this.tolerance / effScale;

      for (const ent of file.entities) {
        if (!ent.visible) continue;
        const lay = file.layers.get(ent.layer);
        if (lay && (lay.frozen || !lay.visible || lay.locked)) continue;

        // Bbox prefilter: if the entity has a finite bbox and the cursor
        // (expanded by tolerance) misses it, skip the snap-points scan.
        // Entities without a bbox (XLINE etc.) bypass the filter.
        const b = ent.bbox?.();
        if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h)) {
          if (cursorLocal.x < b.x - localTol) continue;
          if (cursorLocal.x > b.x + b.w + localTol) continue;
          if (cursorLocal.y < b.y - localTol) continue;
          if (cursorLocal.y > b.y + b.h + localTol) continue;
        }

        const pts: ISnapPoint[] = ent.snapPoints();
        for (let pi = 0; pi < pts.length; pi++) {
          const pt = pts[pi];
          const s = fileVm.w2s(pt.x, pt.y);
          const d = Math.hypot(sx - s.x, sy - s.y);
          if (d < bestDist) {
            bestDist = d;
            const wPt = this.vm.s2w(s.x, s.y);
            best = {
              x: wPt.x, y: wPt.y,
              label: pt.label || 'endpoint',
              sx: s.x, sy: s.y,
              entityId: ent.id,
              snapIndex: pi,
            };
          }
        }
      }
    }

    // Intersection osnap: ask the topology engine for entity-entity crossings
    // within the screen tolerance around the cursor.
    const cursorW = this.vm.s2w(sx, sy);
    const worldRadius = this.tolerance / Math.max(this.vm.scale, 1e-6);
    const intersections = this.topology.findIntersectionsNear(cursorW.x, cursorW.y, worldRadius);
    for (const pt of intersections) {
      const s = this.vm.w2s(pt.x, pt.y);
      const d = Math.hypot(sx - s.x, sy - s.y);
      // Bias slightly toward intersections by subtracting 1px from the comparison —
      // matches AutoCAD's INT-takes-priority behavior when both are within tolerance.
      if (d - 1 < bestDist) {
        bestDist = d;
        best = { x: pt.x, y: pt.y, label: 'intersection', sx: s.x, sy: s.y };
      }
    }
    return best;
    */
  }

  private findObjectSnap(sx: number, sy: number, anchor: IPoint | null): ISnapResult | null {
    if (!this.osnapEnabled() || (this.toolMgr.activeTool as any)?.isWindowSelecting?.()) return null;
    const enabled = this.enabledObjectSnaps();
    if (!enabled.size) return null;

    let best: ISnapResult | null = null;
    let bestDist = this.tolerance;
    let bestRank = Number.POSITIVE_INFINITY;
    const anchorScreen = anchor ? this.vm.w2s(anchor.x, anchor.y) : null;

    const consider = (
      s: IPoint,
      mode: ObjectSnapMode,
      entityId?: number,
      snapIndex?: number,
      biasPx = 0,
      exactWorld?: IPoint,
    ) => {
      const d = Math.hypot(sx - s.x, sy - s.y);
      if (d > this.tolerance) return;
      const rank = snapPriority(mode);
      const weightedDist = Math.max(0, d - biasPx);
      if (rank < bestRank || (rank === bestRank && weightedDist < bestDist)) {
        bestRank = rank;
        bestDist = weightedDist;
        const wPt = exactWorld ?? this.vm.s2w(s.x, s.y);
        best = { x: wPt.x, y: wPt.y, label: normalizedSnapLabel(mode), mode, sx: s.x, sy: s.y, entityId, snapIndex };
      }
    };

    for (const file of this.doc.files) {
      if (!file.visible || file.locked) continue;
      const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);
      const cursorLocal = fileVm.s2w(sx, sy);
      const localTol = this.tolerance / Math.max(fileVm.cumulativeScale, 1e-6);

      // Spatial candidate filter (active file only): narrow the per-mousemove
      // scan from every entity down to just those whose bbox is near the
      // cursor — turning O(n) into O(k). Skipped when extension/parallel
      // snaps are active (they legitimately snap outside an entity's bbox)
      // or when the index isn't ready yet (returns null → full scan).
      let candidateIds: Set<number> | null = null;
      if (!enabled.has('extension') && !enabled.has('parallel') && file === this.doc.activeFile) {
        const nearIds = this.spatial.queryPoint(cursorLocal.x, cursorLocal.y, localTol);
        if (nearIds) candidateIds = new Set(nearIds);
      }

      const rad = (file.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const localToWorld = (pt: IPoint) => {
        const rx = pt.x * cos - pt.y * sin;
        const ry = pt.x * sin + pt.y * cos;
        return {
          x: rx * file.scale + file.x,
          y: ry * file.scale + file.y
        };
      };

      for (const ent of file.entities) {
        if (!ent.visible) continue;
        if (candidateIds && !candidateIds.has(ent.id)) continue;
        const lay = file.layers.get(ent.layer);
        if (lay && (lay.frozen || !lay.visible || lay.locked)) continue;

        const b = ent.bbox?.();
        const canSnapOutsideBbox = enabled.has('extension') || enabled.has('parallel');
        if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h)) {
          const miss =
            cursorLocal.x < b.x - localTol ||
            cursorLocal.x > b.x + b.w + localTol ||
            cursorLocal.y < b.y - localTol ||
            cursorLocal.y > b.y + b.h + localTol;
          if (miss && !canSnapOutsideBbox) continue;
        }

        const pts: ISnapPoint[] = snapPointsForEntity(ent);
        for (let pi = 0; pi < pts.length; pi++) {
          const mode = snapModeForPoint(ent, pts[pi].label);
          if (!mode || !enabled.has(mode)) continue;
          const exactWorld = localToWorld(pts[pi]);
          consider(fileVm.w2s(pts[pi].x, pts[pi].y), mode, ent.id, pi, 0, exactWorld);
        }

        if (enabled.has('geometricCenter')) {
          const center = geometricCenter(ent);
          if (center) {
            const exactWorld = localToWorld(center);
            consider(fileVm.w2s(center.x, center.y), 'geometricCenter', ent.id, undefined, 0, exactWorld);
          }
        }

        for (const seg of entitySegments(ent)) {
          const aw = localToWorld(seg.a);
          const bw = localToWorld(seg.b);
          const a = fileVm.w2s(seg.a.x, seg.a.y);
          const b2 = fileVm.w2s(seg.b.x, seg.b.y);
          const cursorProjection = projectPointToSegmentScreen({ x: sx, y: sy }, a, b2, true);
          if (cursorProjection && enabled.has('nearest') && cursorProjection.t >= 0 && cursorProjection.t <= 1) {
            const exactWorld = { x: aw.x + (bw.x - aw.x) * cursorProjection.t, y: aw.y + (bw.y - aw.y) * cursorProjection.t };
            consider(cursorProjection, 'nearest', ent.id, undefined, 0, exactWorld);
          }
          if (cursorProjection && enabled.has('extension') && (cursorProjection.t < -1e-6 || cursorProjection.t > 1 + 1e-6)) {
            const exactWorld = { x: aw.x + (bw.x - aw.x) * cursorProjection.t, y: aw.y + (bw.y - aw.y) * cursorProjection.t };
            consider(cursorProjection, 'extension', ent.id, undefined, 0, exactWorld);
          }
          if (anchorScreen && enabled.has('perpendicular')) {
            const foot = projectPointToSegmentScreen(anchorScreen, a, b2, false);
            if (foot && foot.t >= 0 && foot.t <= 1) {
              const exactWorld = { x: aw.x + (bw.x - aw.x) * foot.t, y: aw.y + (bw.y - aw.y) * foot.t };
              consider(foot, 'perpendicular', ent.id, undefined, 0, exactWorld);
            }
          }
          if (anchorScreen && enabled.has('parallel')) {
            const parallel = projectPointToParallelThroughAnchor({ x: sx, y: sy }, anchorScreen, a, b2);
            if (parallel) consider(parallel, 'parallel', ent.id);
          }
        }

        if ((ent.type === 'CIRCLE' || ent.type === 'ARC') && (enabled.has('nearest') || enabled.has('perpendicular') || enabled.has('tangent'))) {
          const cw = localToWorld({ x: ent['cx'], y: ent['cy'] });
          const c = fileVm.w2s(ent['cx'], ent['cy']);
          const rEdgeW = localToWorld({ x: ent['cx'] + ent['r'], y: ent['cy'] });
          const rEdge = fileVm.w2s(ent['cx'] + ent['r'], ent['cy']);
          const radius = Math.hypot(rEdge.x - c.x, rEdge.y - c.y);
          const worldRadius = Math.hypot(rEdgeW.x - cw.x, rEdgeW.y - cw.y);
          const angle = Math.atan2(sy - c.y, sx - c.x);
          const nearest = { x: c.x + Math.cos(angle) * radius, y: c.y + Math.sin(angle) * radius };
          if (enabled.has('nearest') && pointOnArcScreen(nearest, ent, fileVm)) {
            const exactWorld = { x: cw.x + Math.cos(angle) * worldRadius, y: cw.y - Math.sin(angle) * worldRadius };
            consider(nearest, 'nearest', ent.id, undefined, 0, exactWorld);
          }
          if (anchorScreen && enabled.has('perpendicular')) {
            const a = Math.atan2(anchorScreen.y - c.y, anchorScreen.x - c.x);
            const perpPoints = [
              { x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius, exact: { x: cw.x + Math.cos(a) * worldRadius, y: cw.y - Math.sin(a) * worldRadius } },
              { x: c.x - Math.cos(a) * radius, y: c.y - Math.sin(a) * radius, exact: { x: cw.x - Math.cos(a) * worldRadius, y: cw.y + Math.sin(a) * worldRadius } },
            ];
            for (const p of perpPoints) {
              if (pointOnArcScreen(p, ent, fileVm)) consider(p, 'perpendicular', ent.id, undefined, 0, p.exact);
            }
          }
          if (anchorScreen && enabled.has('tangent')) {
            for (const p of tangentPointsFromScreen(anchorScreen, c, radius)) {
              if (pointOnArcScreen(p, ent, fileVm)) consider(p, 'tangent', ent.id);
            }
          }
        }
      }
    }

    if (enabled.has('intersection') || enabled.has('apparentIntersection')) {
      const cursorW = this.vm.s2w(sx, sy);
      const worldRadius = this.tolerance / Math.max(this.vm.scale, 1e-6);
      const intersections = this.topology.findIntersectionsNear(cursorW.x, cursorW.y, worldRadius);
      for (const pt of intersections) {
        const s = this.vm.w2s(pt.x, pt.y);
        const mode = enabled.has('intersection') ? 'intersection' : 'apparentIntersection';
        consider(s, mode, undefined, undefined, 1, pt);
      }
    }

    return best;
  }

  /** Update the active snap state. Returns previously-cached snap if any. */
  setCurrent(snap: ISnapResult | null): void {
    this.current = snap;
    // The snap marker is rendered on the dynamic canvas which is cleared and
    // redrawn every RAF frame — no main-canvas redraw needed here.
  }

  /** Constrain a cursor world coord to the nearest ortho axis from anchor. */
  orthoConstrain(wx: number, wy: number, anchor: IPoint | null): IPoint {
    if (!this.isOrthoActive() || !anchor) return { x: wx, y: wy };
    const dx = wx - anchor.x;
    const dy = wy - anchor.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      this.lockedAngleDeg = dx >= 0 ? 0 : 180;
      return { x: wx, y: anchor.y };
    }
    this.lockedAngleDeg = dy >= 0 ? 90 : -90;
    return { x: anchor.x, y: wy };
  }

  /** Constrain a cursor world coord to the nearest polar angle from anchor. */
  polarConstrain(wx: number, wy: number, anchor: IPoint | null): IPoint {
    if (!this.polarEnabled() || !anchor) return { x: wx, y: wy };
    const dx = wx - anchor.x;
    const dy = wy - anchor.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-9) return { x: wx, y: wy };
    const inc = Math.max(1, this.polarIncrement());
    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    const snappedDeg = Math.round(angleDeg / inc) * inc;
    
    // Calculate angular tolerance based on screen-space distance, matching the global snapping tolerance (e.g. 6px)
    // We allow a slightly larger snap area for polar tracking to make it easy to catch.
    const screenDist = dist * this.vm.scale;
    const maxDevDeg = (12 / Math.max(screenDist, 1)) * (180 / Math.PI);
    
    if (Math.abs(angleDeg - snappedDeg) > maxDevDeg) {
      return { x: wx, y: wy };
    }

    this.lockedAngleDeg = snappedDeg;
    const rad = snappedDeg * Math.PI / 180;
    return { x: anchor.x + dist * Math.cos(rad), y: anchor.y + dist * Math.sin(rad) };
  }

  /** Resolve a screen-space cursor to a world point honoring snap + ortho/polar. */
  resolve(sx: number, sy: number, anchor: IPoint | null = null): { wx: number; wy: number; snapped: boolean } {
    if ((this.toolMgr.activeTool as any)?.isWindowSelecting?.()) {
      const w = this.vm.s2w(sx, sy);
      return { wx: w.x, wy: w.y, snapped: false };
    }
    const snap = this.find(sx, sy, anchor);
    this.setCurrent(snap);
    
    const w = this.vm.s2w(sx, sy);
    this.otrack.onMouseMove(w.x, w.y, sx, sy, snap);

    if (snap) {
      this.lockedAngleDeg = null;
      this.otrack.setActiveTracking(null);
      return { wx: snap.x, wy: snap.y, snapped: true };
    }
    
    const worldTol = this.tolerance / Math.max(this.vm.scale, 1e-6);
    const otrackResult = this.otrack.getTrackingCandidates(w.x, w.y, worldTol);
    if (otrackResult) {
      this.lockedAngleDeg = null;
      this.otrack.setActiveTracking(otrackResult.guides);
      return { wx: otrackResult.wx, wy: otrackResult.wy, snapped: true };
    } else {
      this.otrack.setActiveTracking(null);
    }

    this.lockedAngleDeg = null;
    // Ortho (including Shift temp override) takes priority over polar.
    if (this.isOrthoActive()) {
      const o = this.orthoConstrain(w.x, w.y, anchor);
      return { wx: o.x, wy: o.y, snapped: false };
    }
    if (this.polarEnabled()) {
      const p = this.polarConstrain(w.x, w.y, anchor);
      return { wx: p.x, wy: p.y, snapped: false };
    }
    return { wx: w.x, wy: w.y, snapped: false };
  }

  /** Render snap marker + ortho/polar guides into the supplied main-canvas context. */
  render(ctx: CanvasRenderingContext2D, anchor: IPoint | null = null): void {
    if ((this.toolMgr.activeTool as any)?.isWindowSelecting?.()) return;
    const palette = this.theme.canvas();
    if (this.isOrthoActive() && anchor) {
      const s = this.vm.w2s(anchor.x, anchor.y);
      const W = this.vm.canvasWidth;
      const H = this.vm.canvasHeight;
      ctx.save();
      ctx.strokeStyle = palette.guide;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, s.y); ctx.lineTo(W, s.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x, 0); ctx.lineTo(s.x, H);
      ctx.stroke();
      ctx.restore();
    }

    if (this.polarEnabled() && anchor && this.lockedAngleDeg !== null) {
      const s = this.vm.w2s(anchor.x, anchor.y);
      const W = this.vm.canvasWidth;
      const H = this.vm.canvasHeight;
      const rad = this.lockedAngleDeg * Math.PI / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const farT = clipRayToRect(s.x, s.y, dx, dy, W, H);
      const nearT = clipRayToRect(s.x, s.y, -dx, -dy, W, H);
      const ex = s.x + dx * farT;
      const ey = s.y + dy * farT;
      const sx0 = s.x - dx * nearT;
      const sy0 = s.y - dy * nearT;
      ctx.save();
      ctx.strokeStyle = palette.guide;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = palette.guideLabel;
      ctx.font = '11px system-ui, sans-serif';
      const label = `${formatPolarAngle(this.lockedAngleDeg)}°`;
      ctx.fillText(label, s.x + 10, s.y - 8);
      ctx.restore();
    }

    this.otrack.render(ctx);

    if (!this.current) return;
    const s = { x: this.current.sx, y: this.current.sy };
    ctx.save();
    ctx.strokeStyle = palette.snapMarker;
    ctx.lineWidth = 2;
    drawSnapMarker(ctx, s.x, s.y, this.current.mode ?? 'endpoint');
    ctx.restore();
  }
}

/**
 * Maximum t ≥ 0 such that (sx + t*dx, sy + t*dy) lies inside the [0,W] × [0,H] rect.
 * Returns the diagonal length as a safe fallback when the ray direction is degenerate.
 */
function clipRayToRect(sx: number, sy: number, dx: number, dy: number, W: number, H: number): number {
  const fallback = Math.hypot(W, H);
  let t = fallback;
  if (Math.abs(dx) > 1e-9) {
    const tx = dx > 0 ? (W - sx) / dx : (0 - sx) / dx;
    if (tx >= 0) t = Math.min(t, tx);
  }
  if (Math.abs(dy) > 1e-9) {
    const ty = dy > 0 ? (H - sy) / dy : (0 - sy) / dy;
    if (ty >= 0) t = Math.min(t, ty);
  }
  return Math.max(0, t);
}

function formatPolarAngle(deg: number): string {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  if (a === 0) return '0';
  return Number.isInteger(a) ? String(a) : a.toFixed(1);
}

function drawSnapMarker(ctx: CanvasRenderingContext2D, x: number, y: number, mode: ObjectSnapMode): void {
  const r = 7;
  ctx.beginPath();
  switch (mode) {
    case 'endpoint':
      ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.stroke();
      break;
    case 'vertex':
      ctx.moveTo(x, y - r - 2);
      ctx.lineTo(x + r + 2, y);
      ctx.lineTo(x, y + r + 2);
      ctx.lineTo(x - r - 2, y);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'midpoint':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'center':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x - r - 3, y);
      ctx.lineTo(x + r + 3, y);
      ctx.moveTo(x, y - r - 3);
      ctx.lineTo(x, y + r + 3);
      ctx.stroke();
      break;
    case 'geometricCenter':
      ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      ctx.stroke();
      break;
    case 'node':
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.stroke();
      break;
    case 'quadrant':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'intersection':
    case 'apparentIntersection':
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.stroke();
      break;
    case 'extension':
      ctx.setLineDash([4, 3]);
      ctx.moveTo(x - r - 4, y);
      ctx.lineTo(x + r + 4, y);
      ctx.moveTo(x + r, y - 4);
      ctx.lineTo(x + r + 4, y);
      ctx.lineTo(x + r, y + 4);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    case 'insertion':
      ctx.moveTo(x - r, y + r);
      ctx.lineTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.stroke();
      break;
    case 'perpendicular':
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.stroke();
      break;
    case 'tangent':
      ctx.arc(x - 2, y + 2, r - 2, 0, Math.PI * 2);
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.stroke();
      break;
    case 'nearest':
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x - r + 3, y - 4);
      ctx.lineTo(x - r, y);
      ctx.lineTo(x - r + 3, y + 4);
      ctx.moveTo(x + r - 3, y - 4);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x + r - 3, y + 4);
      ctx.stroke();
      break;
    case 'parallel':
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x - 1, y + r);
      ctx.moveTo(x + 1, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.stroke();
      break;
  }
}

const OBJECT_SNAP_STORAGE_KEY = 'cad-editor.object-snap-modes';
const ALL_OBJECT_SNAP_IDS = new Set<ObjectSnapMode>(OBJECT_SNAP_MODES.map((m) => m.id));

function loadObjectSnapModes(): ReadonlySet<ObjectSnapMode> {
  try {
    const raw = localStorage.getItem(OBJECT_SNAP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const modes = parsed.filter(isObjectSnapMode);
        if (modes.length) {
          const restored = new Set<ObjectSnapMode>(modes);
          if (restored.has('endpoint')) restored.add('vertex');
          return restored;
        }
      }
    }
  } catch {
    // Browser storage is optional; default to the full AutoCAD-like set.
  }
  return new Set(OBJECT_SNAP_MODES.map((m) => m.id));
}

function isObjectSnapMode(value: unknown): value is ObjectSnapMode {
  return typeof value === 'string' && ALL_OBJECT_SNAP_IDS.has(value as ObjectSnapMode);
}

function snapPriority(mode: ObjectSnapMode): number {
  switch (mode) {
    case 'endpoint':
    case 'vertex':
      return 0;
    case 'intersection':
    case 'apparentIntersection':
      return 1;
    case 'midpoint':
    case 'center':
    case 'geometricCenter':
    case 'node':
    case 'quadrant':
    case 'insertion':
      return 2;
    case 'perpendicular':
    case 'tangent':
    case 'extension':
    case 'parallel':
      return 3;
    case 'nearest':
      return 9;
  }
}

function snapPointsForEntity(ent: any): ISnapPoint[] {
  if (!ent) return [];

  if (ent.type === 'LINE') {
    return [
      { x: ent.x1, y: ent.y1, label: 'endpoint' },
      { x: ent.x2, y: ent.y2, label: 'endpoint' },
      { x: (ent.x1 + ent.x2) / 2, y: (ent.y1 + ent.y2) / 2, label: 'midpoint' },
    ];
  }

  if (ent.type === 'POLYLINE' && Array.isArray(ent.pts)) {
    const out: ISnapPoint[] = [];
    const lastIndex = ent.pts.length - 1;
    ent.pts.forEach((p: IPoint, i: number) => {
      const isOpenEnd = !ent.closed && (i === 0 || i === lastIndex);
      out.push({ x: p.x, y: p.y, label: isOpenEnd ? 'endpoint' : 'vertex' });
      if (i < lastIndex) {
        out.push({ x: (p.x + ent.pts[i + 1].x) / 2, y: (p.y + ent.pts[i + 1].y) / 2, label: 'midpoint' });
      }
    });
    if (ent.closed && ent.pts.length > 2) {
      const first = ent.pts[0];
      const last = ent.pts[lastIndex];
      out.push({ x: (last.x + first.x) / 2, y: (last.y + first.y) / 2, label: 'midpoint' });
    }
    return out;
  }          

  if (ent.type === 'SPLINE' && Array.isArray(ent.controlPoints)) {
    const lastIndex = ent.controlPoints.length - 1;
    return ent.controlPoints.map((p: IPoint, i: number) => ({
      x: p.x,
      y: p.y,
      label: i === 0 || i === lastIndex ? 'endpoint' : 'vertex',
    }));
  }

  if (typeof ent.snapPoints === 'function') return ent.snapPoints();
  return [];
}

function snapModeForPoint(ent: any, label?: string): ObjectSnapMode | null {
  const normalized = (label || '').toLowerCase();
  if (ent?.type === 'POINT') return 'node';
  if (normalized === 'endpoint' || normalized === 'corner' || normalized === 'dim-end' || normalized === 'arrowhead') return 'endpoint';
  if (normalized === 'vertex' || normalized === 'control') return 'vertex';
  if (normalized === 'midpoint') return 'midpoint';
  if (normalized === 'center') return 'center';
  if (normalized === 'quadrant') return 'quadrant';
  if (normalized === 'insertion' || normalized === 'basepoint' || normalized === 'landing') return 'insertion';
  if (normalized === 'node') return 'node';
  return null;
}

function normalizedSnapLabel(mode: ObjectSnapMode): string {
  if (mode === 'geometricCenter') return 'geometric center';
  if (mode === 'apparentIntersection') return 'apparent intersection';
  return mode;
}

function geometricCenter(ent: any): IPoint | null {
  if (ent?.type !== 'POLYLINE' || !ent.closed || !Array.isArray(ent.pts) || ent.pts.length < 3) return null;
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ent.pts.length; i++) {
    const a = ent.pts[i];
    const b = ent.pts[(i + 1) % ent.pts.length];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) > 1e-9) {
    return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
  }
  const xs = ent.pts.map((p: IPoint) => p.x);
  const ys = ent.pts.map((p: IPoint) => p.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function entitySegments(ent: any): Array<{ a: IPoint; b: IPoint }> {
  if (ent?.type === 'LINE') {
    return [{ a: { x: ent.x1, y: ent.y1 }, b: { x: ent.x2, y: ent.y2 } }];
  }
  if (ent?.type === 'POLYLINE' && Array.isArray(ent.pts) && ent.pts.length > 1) {
    const out: Array<{ a: IPoint; b: IPoint }> = [];
    const count = ent.closed ? ent.pts.length : ent.pts.length - 1;
    for (let i = 0; i < count; i++) {
      out.push({ a: ent.pts[i], b: ent.pts[(i + 1) % ent.pts.length] });
    }
    return out;
  }
  return [];
}

function projectPointToSegmentScreen(p: IPoint, a: IPoint, b: IPoint, allowInfinite: boolean): (IPoint & { t: number }) | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return null;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (!allowInfinite) t = Math.max(0, Math.min(1, t));
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}

function projectPointToParallelThroughAnchor(cursor: IPoint, anchor: IPoint, a: IPoint, b: IPoint): IPoint | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uy = dy / len;
  const t = (cursor.x - anchor.x) * ux + (cursor.y - anchor.y) * uy;
  return { x: anchor.x + ux * t, y: anchor.y + uy * t };
}

function tangentPointsFromScreen(anchor: IPoint, center: IPoint, radius: number): IPoint[] {
  const dx = anchor.x - center.x;
  const dy = anchor.y - center.y;
  const d2 = dx * dx + dy * dy;
  const r2 = radius * radius;
  if (d2 <= r2 + 1e-9) return [];
  const d = Math.sqrt(d2);
  const base = Math.atan2(dy, dx);
  const offset = Math.acos(radius / d);
  return [
    { x: center.x + radius * Math.cos(base + offset), y: center.y + radius * Math.sin(base + offset) },
    { x: center.x + radius * Math.cos(base - offset), y: center.y + radius * Math.sin(base - offset) },
  ];
}

function pointOnArcScreen(screenPoint: IPoint, ent: any, fileVm: any): boolean {
  if (ent?.type !== 'ARC') return true;
  const local = fileVm.s2w(screenPoint.x, screenPoint.y);
  const angle = ((Math.atan2(local.y - ent.cy, local.x - ent.cx) * 180 / Math.PI) % 360 + 360) % 360;
  const start = ((ent.startAngle % 360) + 360) % 360;
  const sweep = Math.abs(ent.getSweep?.() ?? 360);
  const t = ent.ccw ? (angle - start + 360) % 360 : (start - angle + 360) % 360;
  return t <= sweep + 0.5;
}
