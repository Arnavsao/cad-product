import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { Entity } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService, createProxyVm } from '../../core/services/view-model.service';
import { GripManagerService } from '../../core/services/grip-manager.service';
import { SpatialIndexService } from '../../core/services/spatial-index.service';

interface HitResult { entity: Entity; dist: number; }

/**
 * Pick the single closest entity under the cursor within the configured pickbox radius.
 * If multiple entities are hit (e.g. they overlap), it prefers text/blocks
 * (as geometry proxy) so the nearest geometry within the pickbox wins —
 * matching AutoCAD's "nearest within pickbox" selection behaviour.
 */
export function hitTestAll(doc: DocumentService, vm: ViewModelService, sx: number, sy: number, spatial?: SpatialIndexService): HitResult | null {
  const tol = vm.pickboxSize;
  let best: (HitResult & { area?: number }) | null = null;
  
  // Convert screen pick point to world coordinates
  const wx = vm.s2w(sx, sy).x;
  const wy = vm.s2w(sx, sy).y;
  // Convert screen pickbox tolerance to world units
  const wTol = tol / vm.scale;

  for (let i = doc.files.length - 1; i >= 0; i--) {
    const file = doc.files[i];
    if (!file.visible || file.locked) continue;
    const fileVm = createProxyVm(vm, file.x, file.y, file.scale, file.scale, file.rotation);
    
    let candidateEntities: Entity[];
    if (spatial && file === doc.activeFile) {
      // Fast path: use spatial index for active file
      const candidateIds = spatial.queryPoint(wx, wy, wTol);
      candidateEntities = spatial.resolve(candidateIds);
      // Reverse to process top-down
      candidateEntities.reverse();
      // Supplement with XLINEs that might not be returned by spatial index
      for (let j = file.entities.length - 1; j >= 0; j--) {
        const ent = file.entities[j];
        if (ent.type === 'XLINE' && !candidateEntities.includes(ent)) {
          candidateEntities.push(ent);
        }
      }
    } else {
      // Fallback: linear scan for xrefs / non-active files
      candidateEntities = file.entities.slice().reverse();
    }

    for (const ent of candidateEntities) {
      if (!ent.visible) continue;
      const lay = file.layers.get(ent.layer);
      if (lay && (lay.frozen || !lay.visible || lay.locked)) continue;
      if (!ent.hitTest(sx, sy, fileVm, tol)) continue;
      
      // Rank by distance to nearest snap point
      let d = tol;
      const pts = ent.snapPoints();
      for (const p of pts) {
        const s = fileVm.w2s(p.x, p.y);
        const dd = Math.hypot(sx - s.x, sy - s.y);
        if (dd < d) d = dd;
      }

      // Compute bounding box area — smaller enclosed entities take priority over large enclosing ones!
      const b = ent.bbox();
      const area = b ? (b.w * b.h) : Infinity;

      if (!best) {
        best = { entity: ent, dist: d, area };
      } else {
        if (d < best.dist - 0.5) {
          best = { entity: ent, dist: d, area };
        } else if (Math.abs(d - best.dist) <= 0.5) {
          const bestArea = best.area ?? Infinity;
          if (area <= bestArea) {
            best = { entity: ent, dist: d, area };
          }
        }
      }
    }
  }
  return best ? { entity: best.entity, dist: best.dist } : null;
}

export function deselectAll(doc: DocumentService): void {
  doc.clearSelection();
}

export function getSelectedEntities(doc: DocumentService): Entity[] {
  return doc.getSelectedEntities();
}

/**
 * Return ALL entities under the cursor within `tol` pixels, ordered
 * top-to-bottom (most recently drawn first). Used by Tab-key cycling.
 */
export function hitTestAllList(
  doc: DocumentService,
  vm: ViewModelService,
  sx: number,
  sy: number,
  tol = vm.pickboxSize,
  spatial?: SpatialIndexService,
): Entity[] {
  const hits: Entity[] = [];
  
  // Convert screen pick point to world coordinates
  const wx = vm.s2w(sx, sy).x;
  const wy = vm.s2w(sx, sy).y;
  const wTol = tol / vm.scale;

  for (let i = doc.files.length - 1; i >= 0; i--) {
    const file = doc.files[i];
    if (!file.visible || file.locked) continue;
    const fileVm = createProxyVm(vm, file.x, file.y, file.scale, file.scale, file.rotation);
    
    let candidateEntities: Entity[];
    if (spatial && file === doc.activeFile) {
      // Fast path: use spatial index for active file
      const candidateIds = spatial.queryPoint(wx, wy, wTol);
      candidateEntities = spatial.resolve(candidateIds);
      // Reverse to process top-down
      candidateEntities.reverse();
      // Supplement with XLINEs that might not be returned by spatial index
      for (let j = file.entities.length - 1; j >= 0; j--) {
        const ent = file.entities[j];
        if (ent.type === 'XLINE' && !candidateEntities.includes(ent)) {
          candidateEntities.push(ent);
        }
      }
    } else {
      // Fallback: linear scan for non-active files
      candidateEntities = file.entities.slice().reverse();
    }

    for (const ent of candidateEntities) {
      if (!ent.visible) continue;
      const lay = file.layers.get(ent.layer);
      if (lay && (lay.frozen || !lay.visible || lay.locked)) continue;
      if (ent.hitTest(sx, sy, fileVm, tol)) hits.push(ent);
    }
  }
  return hits;
}

/** Entity types that automatically show grips on single-click selection.
 *  Covers every type with a grip generator in `generateEntityGrips` so all
 *  nodes (corner vertices + edge midpoints) are draggable AutoCAD-style. */
const AUTO_GRIP_TYPES = new Set([
  'LINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'POINT', 'TEXT',
  'LEADER', 'DIMENSION', 'HATCH', 'XLINE', 'INSERT', 'IMAGE', 'TABLE', 'SPLINE',
]);

export enum SelectionState {
  Idle,
  AwaitingSecondPoint,
  WindowSelecting
}

export class SelectTool implements ITool {
  readonly name = 'select';
  
  getCursor(): string {
    return 'pickbox';
  }
  
  state: SelectionState = SelectionState.Idle;
  anchorPoint: { sx: number; sy: number } | null = null;
  currentPoint: { sx: number; sy: number } | null = null;
  previewCandidates: Entity[] = [];

  // ── Hover state ─────────────────────────────────────────────────────────
  /** Entity currently under the cursor (null when none). */
  private hoveredEntity: Entity | null = null;

  // ── Selection cycling (Tab key) ──────────────────────────────────────────
  /** All entities under the cursor at the last hover position. */
  private cycleCandidates: Entity[] = [];
  /** Index into cycleCandidates; -1 means no cycling active. */
  private cycleIndex = -1;
  /** Entity highlighted via Tab cycling (distinct from hover glow). */
  private cycleHighlight: Entity | null = null;
  /** Last screen position used to populate cycleCandidates. */
  private cyclePos: { sx: number; sy: number } | null = null;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get grips() { return this.injector.get(GripManagerService) as GripManagerService; }
  private get spatial() { return this.injector.get(SpatialIndexService) as SpatialIndexService; }

  isWindowSelecting(): boolean {
    return this.state === SelectionState.WindowSelecting;
  }

  onMouseDown(_wx: number, _wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button === 2) {
      if (this.state !== SelectionState.Idle) {
        this.cancelWindow();
        e.preventDefault();
      }
      return;
    }
    if (e.button !== 0) return;

    if (this.state === SelectionState.WindowSelecting) {
      this.finalizeSelection(e.shiftKey, e.ctrlKey);
      return;
    }

    if (this.state === SelectionState.AwaitingSecondPoint) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy, this.spatial);
      if (hit) {
        if (e.shiftKey || e.ctrlKey) {
          this.doc.setEntitySelected(hit.entity, false, { notify: false });
        } else {
          this.doc.setSelection([hit.entity], { additive: true, notify: false });
        }
        if (hit.entity.selected && AUTO_GRIP_TYPES.has(hit.entity.type)) {
          this.grips.setVisible(true);
        }
        this.cancelWindow();
      } else {
        this.anchorPoint = { sx, sy };
        this.currentPoint = { sx, sy };
      }
      this.vm.markContentDirty();
      return;
    }

    if (this.cycleHighlight) {
      if (e.shiftKey || e.ctrlKey) {
        this.doc.setEntitySelected(this.cycleHighlight, false, { notify: false });
      } else {
        this.doc.setSelection([this.cycleHighlight], { additive: true, notify: false });
      }
      if (this.cycleHighlight.selected && AUTO_GRIP_TYPES.has(this.cycleHighlight.type)) {
        this.grips.setVisible(true);
      }
      this._clearCycle();
      this.vm.markContentDirty();
      return;
    }

    const hit = hitTestAll(this.doc, this.vm, sx, sy, this.spatial);
    
    if (hit) {
      if (e.shiftKey || e.ctrlKey) {
        this.doc.setEntitySelected(hit.entity, false, { notify: false });
      } else {
        this.doc.setSelection([hit.entity], { additive: true, notify: false });
      }
      if (hit.entity.selected && AUTO_GRIP_TYPES.has(hit.entity.type)) {
        this.grips.setVisible(true);
      }
    } else {
      this.state = SelectionState.AwaitingSecondPoint;
      this.anchorPoint = { sx, sy };
      this.currentPoint = { sx, sy };
      if ((this.grips as any).setHover) {
        (this.grips as any).setHover(null);
      }
    }
    this._clearCycle();
    this.vm.markContentDirty();
  }

  onMouseMove(_wx: number, _wy: number, sx: number, sy: number): void {
    this.currentPoint = { sx, sy };
    
    if (this.state === SelectionState.AwaitingSecondPoint && this.anchorPoint) {
      const dist = Math.hypot(sx - this.anchorPoint.sx, sy - this.anchorPoint.sy);
      if (dist > 3) {
        this.state = SelectionState.WindowSelecting;
        this.vm.markDirty();
      }
    }

    if (this.state === SelectionState.WindowSelecting && this.anchorPoint) {
      const x1 = this.anchorPoint.sx;
      const y1 = this.anchorPoint.sy;
      const left = Math.min(x1, sx);
      const right = Math.max(x1, sx);
      const top = Math.min(y1, sy);
      const bottom = Math.max(y1, sy);
      const isWindow = sx >= x1;

      this.previewCandidates = this.getEntitiesInBox(left, top, right, bottom, isWindow);
      this.vm.markDirty();
      return;
    }

    const hit = hitTestAll(this.doc, this.vm, sx, sy, this.spatial);
    const prev = this.hoveredEntity;
    this.hoveredEntity = hit?.entity ?? null;
    if (this.hoveredEntity !== prev) {
      this.vm.markDirty();
    }

    if (this.cycleCandidates.length > 0) {
      const dist = Math.hypot(sx - (this.cyclePos?.sx ?? 0), sy - (this.cyclePos?.sy ?? 0));
      if (dist > this.vm.pickboxSize) this._clearCycle();
    }
  }

  onMouseUp(_wx: number, _wy: number, sx: number, sy: number, e: MouseEvent): void {
    // No-op for selection window since it's click-click
  }

  private getEntitiesInBox(left: number, top: number, right: number, bottom: number, isWindow: boolean): Entity[] {
    const selected: Entity[] = [];
    for (const file of this.doc.files) {
      if (!file.visible || file.locked) continue;
      const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);
      
      let candidateEntities: Entity[];
      if (file === this.doc.activeFile) {
        // Fast path: spatial index box query
        const wx1 = this.vm.s2w(left, top).x;
        const wy1 = this.vm.s2w(left, top).y;
        const wx2 = this.vm.s2w(right, bottom).x;
        const wy2 = this.vm.s2w(right, bottom).y;
        const wLeft = Math.min(wx1, wx2);
        const wRight = Math.max(wx1, wx2);
        const wBottom = Math.min(wy1, wy2);
        const wTop = Math.max(wy1, wy2);
        const candidateIds = this.spatial.queryBox({ x: wLeft, y: wBottom, w: wRight - wLeft, h: wTop - wBottom });
        candidateEntities = this.spatial.resolve(candidateIds);
        // Supplement with XLINEs that might not be returned by spatial index
        for (const ent of file.entities) {
          if (ent.type === 'XLINE' && !candidateEntities.includes(ent)) {
            candidateEntities.push(ent);
          }
        }
      } else {
        candidateEntities = file.entities;
      }

      for (const ent of candidateEntities) {
        if (!ent.visible) continue;
        const lay = file.layers.get(ent.layer);
        if (lay && (lay.frozen || !lay.visible || lay.locked)) continue;

        if ((ent as any).type === 'XLINE') {
          const eX = ent as any;
          const b = fileVm.w2s(eX.x, eX.y);
          const bDir = fileVm.w2s(eX.x + Math.cos(eX.angle), eX.y + Math.sin(eX.angle));
          const ddx = bDir.x - b.x;
          const ddy = bDir.y - b.y;
          if (xlineIntersectsScreenBox(b.x, b.y, ddx, ddy, left, right, top, bottom)) {
            selected.push(ent);
          }
          continue;
        }

        const pts = ent.snapPoints();
        if (isWindow) {
          if (pts.length && pts.every((p: any) => {
            const s = fileVm.w2s(p.x, p.y);
            return s.x >= left && s.x <= right && s.y >= top && s.y <= bottom;
          })) {
            const b = typeof ent.bbox === 'function' ? ent.bbox() : null;
            if (b) {
               const sMin = fileVm.w2s(b.x, b.y + b.h);
               const sMax = fileVm.w2s(b.x + b.w, b.y);
               const eLeft = Math.min(sMin.x, sMax.x);
               const eRight = Math.max(sMin.x, sMax.x);
               const eTop = Math.min(sMin.y, sMax.y);
               const eBottom = Math.max(sMin.y, sMax.y);
               if (eLeft >= left && eRight <= right && eTop >= top && eBottom <= bottom) {
                 selected.push(ent);
               }
            } else {
               selected.push(ent);
            }
          }
        } else {
          let hit = pts.some((p: any) => {
            const s = fileVm.w2s(p.x, p.y);
            return s.x >= left && s.x <= right && s.y >= top && s.y <= bottom;
          });
          if (!hit) {
            hit = entityCrossesRect(ent as any, fileVm, left, top, right, bottom);
          }
          if (hit) selected.push(ent);
        }
      }
    }
    return selected;
  }

  private finalizeSelection(shiftKey: boolean, ctrlKey: boolean): void {
    if (!this.anchorPoint || !this.currentPoint) {
      this.cancelWindow();
      return;
    }
    
    const x1 = this.anchorPoint.sx;
    const y1 = this.anchorPoint.sy;
    const x2 = this.currentPoint.sx;
    const y2 = this.currentPoint.sy;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    if (shiftKey && this.grips.visible()) {
      let gripsSelected = false;
      for (const g of this.grips.grips) {
        const s = this.vm.w2s(g.x, g.y);
        if (s.x >= left && s.x <= right && s.y >= top && s.y <= bottom) {
          this.grips.selectedGripIds.add(`${g.entity.id}:${g.key}`);
          gripsSelected = true;
        }
      }
      if (gripsSelected) {
        this.vm.markDirty();
        this.cancelWindow();
        return;
      }
    }

    const candidates = this.previewCandidates;
    
    if (shiftKey || ctrlKey) {
      for (const ent of candidates) {
        this.doc.setEntitySelected(ent, false, { notify: false });
      }
    } else {
        this.doc.setSelection(candidates, { additive: true, notify: false });
    }
    
    if (getSelectedEntities(this.doc).some((ent) => AUTO_GRIP_TYPES.has(ent.type))) {
      this.grips.setVisible(true);
    } else {
      this.grips.setVisible(false);
    }
    
    this.vm.markContentDirty();
    this.cancelWindow();
  }

  cancelWindow(): void {
    this.state = SelectionState.Idle;
    this.anchorPoint = null;
    this.currentPoint = null;
    this.previewCandidates = [];
    this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.state === SelectionState.Idle && this.hoveredEntity && !this.hoveredEntity.selected && !this.cycleHighlight) {
      try {
        this.hoveredEntity.drawHovered(ctx, this.vm, this.doc, 'hover');
      } catch { /* ignore */ }
    }

    if (this.state === SelectionState.Idle && this.cycleHighlight && !this.cycleHighlight.selected) {
      try {
        this.cycleHighlight.drawHovered(ctx, this.vm, this.doc, 'selected');
      } catch { /* ignore */ }
    }

    if (this.state === SelectionState.WindowSelecting && this.anchorPoint && this.currentPoint) {
      const x1 = this.anchorPoint.sx;
      const y1 = this.anchorPoint.sy;
      const x2 = this.currentPoint.sx;
      const y2 = this.currentPoint.sy;
      const isWindow = x2 >= x1;
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const right = Math.max(x1, x2);
      const bottom = Math.max(y1, y2);
      
      ctx.save();
      ctx.setLineDash(isWindow ? [] : [6, 3]);
      ctx.strokeStyle = isWindow ? 'rgba(0, 102, 204, 0.85)' : 'rgba(0, 153, 76, 0.85)';
      ctx.fillStyle = isWindow ? 'rgba(0, 102, 204, 0.22)' : 'rgba(0, 153, 76, 0.22)';
      ctx.lineWidth = 1;
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.strokeRect(left, top, right - left, bottom - top);
      ctx.restore();

      for (const ent of this.previewCandidates) {
        if (!ent.selected) {
          try {
            ent.drawHovered(ctx, this.vm, this.doc, 'preview');
          } catch { /* ignore */ }
        }
      }
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.state !== SelectionState.Idle) {
        this.cancelWindow();
        e.preventDefault();
        e.stopPropagation();
      } else {
        deselectAll(this.doc);
        this._clearCycle();
        this.grips.setVisible(false);
        this.vm.markDirty();
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (!this.currentPoint) return;
      const { sx, sy } = this.currentPoint;

      // Re-fetch cycle candidates if we moved outside the original pickbox
      if (!this.cyclePos || Math.hypot(sx - this.cyclePos.sx, sy - this.cyclePos.sy) > this.vm.pickboxSize) {
        this.cycleCandidates = hitTestAllList(this.doc, this.vm, sx, sy, this.vm.pickboxSize, this.spatial);
        this.cyclePos = { sx, sy };
        this.cycleIndex = -1;
      }

      if (!this.cycleCandidates.length) return;

      this.cycleIndex = (this.cycleIndex + 1) % this.cycleCandidates.length;
      this.cycleHighlight = this.cycleCandidates[this.cycleIndex];
      this.vm.markDirty();
    }
  }

  deactivate(): void {
    this.cancelWindow();
    this._clearCycle();
    this.hoveredEntity = null;
    // Keep grips visible when switching to other tools so they serve as reference nodes
    // this.grips.setVisible(false);
  }

  /** Reset Tab-cycle state. */
  private _clearCycle(): void {
    this.cycleCandidates = [];
    this.cycleIndex = -1;
    this.cycleHighlight = null;
    this.cyclePos = null;
  }
}

/* ─── Geometry helpers ───────────────────────────────────────────────────── */

/**
 * Test whether an infinite XLINE intersects a screen-space rectangle.
 *
 * The line is defined by its base point in screen space (bx, by) and its
 * world-space angle (radians). We map the direction vector to screen space
 * (canvas: Y axis is inverted relative to world Y), then use the slab
 * algorithm to find the parameter range [tMin, tMax] where the ray is inside
 * the AABB. A non-empty interval means the line crosses the box.
 *
 * @param bx    Base point X in screen pixels
 * @param by    Base point Y in screen pixels
 * @param angle Line angle in world radians
 * @param scale  Current view scale (pixels per world unit)
 * @param left, right, top, bottom  Screen-space rectangle bounds
 */
function xlineIntersectsScreenBox(
  bx: number, by: number,
  ddx: number, ddy: number,
  left: number, right: number,
  top: number, bottom: number,
): boolean {
  let tMin = -Infinity;
  let tMax = Infinity;

  // Slab X
  if (Math.abs(ddx) < 1e-9) {
    if (bx < left || bx > right) return false; // parallel and outside
  } else {
    const t1 = (left - bx) / ddx;
    const t2 = (right - bx) / ddx;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }

  // Slab Y
  if (Math.abs(ddy) < 1e-9) {
    if (by < top || by > bottom) return false;
  } else {
    const t1 = (top - by) / ddy;
    const t2 = (bottom - by) / ddy;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }

  return tMax >= tMin;
}

/**
 * Cohen-Sutherland region codes for the AABB clip test used in crossing selection.
 */
const INSIDE = 0, LEFT_BIT = 1, RIGHT_BIT = 2, BOTTOM_BIT = 4, TOP_BIT = 8;

function regionCode(x: number, y: number, left: number, top: number, right: number, bottom: number): number {
  let code = INSIDE;
  if (x < left) code |= LEFT_BIT;
  else if (x > right) code |= RIGHT_BIT;
  if (y < top) code |= TOP_BIT;
  else if (y > bottom) code |= BOTTOM_BIT;
  return code;
}

/**
 * Cohen-Sutherland line-clip: returns true when the segment (ax,ay)→(bx,by)
 * intersects or lies within the screen rectangle [left,top,right,bottom].
 */
function segmentIntersectsRect(
  ax: number, ay: number,
  bx: number, by: number,
  left: number, top: number,
  right: number, bottom: number,
): boolean {
  let code0 = regionCode(ax, ay, left, top, right, bottom);
  let code1 = regionCode(bx, by, left, top, right, bottom);
  let x = ax, y = ay;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!(code0 | code1)) return true;       // both inside
    if (code0 & code1) return false;          // both outside same region
    const code = code0 || code1;
    let nx = x, ny = y;
    if (code & BOTTOM_BIT) {
      nx = x + (bx - ax) * (bottom - ay) / (by - ay);
      ny = bottom;
    } else if (code & TOP_BIT) {
      nx = x + (bx - ax) * (top - ay) / (by - ay);
      ny = top;
    } else if (code & RIGHT_BIT) {
      ny = y + (by - ay) * (right - ax) / (bx - ax);
      nx = right;
    } else if (code & LEFT_BIT) {
      ny = y + (by - ay) * (left - ax) / (bx - ax);
      nx = left;
    }
    if (code === code0) {
      ax = nx; ay = ny;
      code0 = regionCode(ax, ay, left, top, right, bottom);
      x = ax; y = ay;
    } else {
      bx = nx; by = ny;
      code1 = regionCode(bx, by, left, top, right, bottom);
    }
  }
}

/**
 * Test whether an entity's geometry intersects a screen-space rectangle
 * used for crossing selection. Handles LINE, POLYLINE, ARC, CIRCLE,
 * and ELLIPSE with true segment/curve tests. Falls back to bbox for
 * other entity types (HATCH, INSERT, etc.).
 */
function entityCrossesRect(ent: any, fileVm: any, left: number, top: number, right: number, bottom: number): boolean {
  switch (ent.type as string) {
    case 'LINE': {
      const a = fileVm.w2s(ent.x1, ent.y1);
      const b = fileVm.w2s(ent.x2, ent.y2);
      return segmentIntersectsRect(a.x, a.y, b.x, b.y, left, top, right, bottom);
    }
    case 'POLYLINE': {
      const pts: any[] = ent.pts || [];
      const count = ent.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % pts.length;
        const a = fileVm.w2s(pts[i].x, pts[i].y);
        const b = fileVm.w2s(pts[j].x, pts[j].y);
        if (segmentIntersectsRect(a.x, a.y, b.x, b.y, left, top, right, bottom)) return true;
      }
      return false;
    }
    case 'ARC':
    case 'CIRCLE': {
      // Approximate the arc/circle with polyline segments (32 divisions) and
      // test each segment against the rectangle.
      const c = fileVm.w2s(ent.cx, ent.cy);
      const rS = ent.r * (fileVm.scale ?? 1);
      const isArc = ent.type === 'ARC';
      const sweepRad = isArc
        ? Math.abs((ent.getSweep?.() ?? 360) * Math.PI / 180)
        : Math.PI * 2;
      const startRad = isArc ? (-ent.startAngle * Math.PI / 180) : 0;
      const steps = 32;
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i <= steps; i++) {
        const a = startRad - (sweepRad * i / steps) * (ent.ccw !== false ? 1 : -1);
        const cur = { x: c.x + rS * Math.cos(a), y: c.y + rS * Math.sin(a) };
        if (prev) {
          if (segmentIntersectsRect(prev.x, prev.y, cur.x, cur.y, left, top, right, bottom)) return true;
        }
        prev = cur;
      }
      return false;
    }
    case 'ELLIPSE': {
      // Approximate ellipse with 36 segments in screen space.
      const c = fileVm.w2s(ent.cx, ent.cy);
      const rx = ent.rx * (fileVm.scale ?? 1);
      const ry = ent.ry * (fileVm.scale ?? 1);
      const rot = -(ent.rotation ?? 0);
      const steps = 36;
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i <= steps; i++) {
        const t = (Math.PI * 2 * i) / steps;
        const lx = rx * Math.cos(t);
        const ly = ry * Math.sin(t);
        const cur = {
          x: c.x + lx * Math.cos(rot) - ly * Math.sin(rot),
          y: c.y + lx * Math.sin(rot) + ly * Math.cos(rot),
        };
        if (prev) {
          if (segmentIntersectsRect(prev.x, prev.y, cur.x, cur.y, left, top, right, bottom)) return true;
        }
        prev = cur;
      }
      return false;
    }
    default: {
      // Fallback: use entity bbox converted to screen space.
      const b = typeof ent.bbox === 'function' ? ent.bbox() : null;
      if (!b || b.w === 0 || b.h === 0) return false;
      const sMin = fileVm.w2s(b.x, b.y + b.h);
      const sMax = fileVm.w2s(b.x + b.w, b.y);
      const eLeft = Math.min(sMin.x, sMax.x);
      const eRight = Math.max(sMin.x, sMax.x);
      const eTop = Math.min(sMin.y, sMax.y);
      const eBottom = Math.max(sMin.y, sMax.y);
      // Bbox overlaps selection rect?
      return eLeft <= right && eRight >= left && eTop <= bottom && eBottom >= top;
    }
  }
}
