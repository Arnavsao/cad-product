import { Injectable, inject, signal } from '@angular/core';
import type { Entity, IPoint } from '../models/entity.model';
import { DocumentService } from './document.service';
import { ViewModelService, createProxyVm } from './view-model.service';
import { CommandStackService } from './command-stack.service';
import { ThemeService, getActiveCanvasPalette } from './theme.service';
import { ModifyGeometryCmd } from '../models/command.model';
import { snapshotEntity, moveFrozenHatch } from '../../tools/geometry-utils';

/**
 * Per-grip dashed-guide render callback. Called by `GripManagerService.render`
 * for the ACTIVE grip only, every frame during drag â€” so entities can paint
 * extension guides, alignment lines, or any other stretch-preview hints in
 * screen coordinates.
 *
 * Receives the live `ViewModelService` instance so the callback can convert
 * world â†’ screen via `vm.w2s`. The drag-start world point is exposed via
 * `getDragContext()` (see `IDragContext`) and is the source for "drag began
 * here" guide lines (e.g., dashed line from drag-start to current cursor).
 *
 * The render path always wraps the call in save/restore â€” guide callbacks
 * don't need to manage ctx state themselves.
 */
export type GripGuideRenderFn = (
  ctx: CanvasRenderingContext2D,
  vm: ViewModelService,
) => void;

export interface IGrip {
  key: string;
  entity: Entity;
  type: 'endpoint' | 'midpoint' | 'center' | 'vertex' | 'radius' | 'text' | 'dimension-line' | 'extension-origin' | 'rotation';
  x: number;
  y: number;
  onDrag: (wx: number, wy: number) => void;
  /**
   * Optional dashed-guide painter shown only while THIS grip is being
   * dragged. Use it for extension lines from the opposite endpoint,
   * alignment crosses, leader-style hint paths â€” anything that helps
   * the user visualize the in-flight stretch.
   */
  renderGuides?: GripGuideRenderFn;
}

/**
 * Drag context exposed to grip closures.
 *
 * Why this exists: `GripManagerService.updateDrag()` calls `generate()` on
 * every mouse-move tick to refresh grip *positions* â€” but `generate()`
 * recreates closures, which means any state held inside a closure
 * (drag-start cursor, original entity dimensions) is reset every tick.
 * That breaks delta-based grips (anything that needs "where did I start?").
 *
 * Instead, drag-start state lives on the GripManager and is mirrored into
 * this module-level singleton just before each `onDrag` call. Closures
 * read from it on every invocation â€” they hold no state of their own and
 * are safe to rebuild any number of times.
 *
 * `snapshot` is the entity field map captured at `beginDrag` (via
 * `snapshotEntity`). `startWx / startWy` is the cursor world position on
 * the first updateDrag tick.
 */
export interface IDragContext {
  snapshot: Record<string, unknown>;
  startWx: number;
  startWy: number;
}
let currentDragContext: IDragContext | null = null;
/** Read-only accessor for grip closures. Returns `null` when no drag is active. */
function getDragContext(): IDragContext | null {
  return currentDragContext;
}

/**
 * LINE grips â€” reference implementation of the universal stretch contract.
 *
 *   - `line-start` / `line-end` : drag endpoint; shows a dashed extension
 *     guide from the OPPOSITE endpoint to the cursor while dragging.
 *   - `line-mid`               : translate the line; shows a dashed delta
 *     guide from drag-start to current cursor.
 *
 * All closures are stateless â€” they read drag-start data from
 * `getDragContext()` so they survive the per-tick `generate()` rebuild.
 *
 * Pattern other entities should follow:
 *   1. Mutate fields in `onDrag` using `getDragContext().snapshot` for
 *      "where did I start" data â€” never closure-stored.
 *   2. Optionally provide `renderGuides(ctx, vm)` to paint dashed
 *      extension/alignment hints in screen coords.
 *   3. The grip manager handles snap (via canvas), DI readout, undo via
 *      ModifyGeometryCmd, and the per-tick refresh automatically.
 */
function lineGrips(ent: any): IGrip[] {
  /** Dashed-line helper used by the endpoint extension guide. */
  const dashedLine = (
    ctx: CanvasRenderingContext2D,
    vm: ViewModelService,
    fromW: { x: number; y: number },
    toW: { x: number; y: number },
  ): void => {
    const a = vm.w2s(fromW.x, fromW.y);
    const b = vm.w2s(toW.x, toW.y);
    ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  return [
    // â”€â”€â”€ Start endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: 'line-start', entity: ent, type: 'endpoint',
      x: ent.x1, y: ent.y1,
      onDrag: (wx, wy) => {
        ent.x1 = wx; ent.y1 = wy;
        ent.refreshCaches();
      },
      // Extension guide: dashed line from the OTHER endpoint to the cursor,
      // exactly as AutoCAD does during STRETCH at a line endpoint.
      renderGuides: (ctx, vm) => {
        dashedLine(ctx, vm, { x: ent.x2, y: ent.y2 }, { x: ent.x1, y: ent.y1 });
      },
    },
    // â”€â”€â”€ End endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: 'line-end', entity: ent, type: 'endpoint',
      x: ent.x2, y: ent.y2,
      onDrag: (wx, wy) => {
        ent.x2 = wx; ent.y2 = wy;
        ent.refreshCaches();
      },
      renderGuides: (ctx, vm) => {
        dashedLine(ctx, vm, { x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 });
      },
    },
    // â”€â”€â”€ Midpoint: translate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: 'line-mid', entity: ent, type: 'midpoint',
      x: (ent.x1 + ent.x2) / 2, y: (ent.y1 + ent.y2) / 2,
      onDrag: (wx, wy) => {
        const ctx = getDragContext();
        if (!ctx) return;
        const ox1 = ctx.snapshot['x1'] as number;
        const oy1 = ctx.snapshot['y1'] as number;
        const ox2 = ctx.snapshot['x2'] as number;
        const oy2 = ctx.snapshot['y2'] as number;
        const ddx = wx - ctx.startWx;
        const ddy = wy - ctx.startWy;
        ent.x1 = ox1 + ddx; ent.y1 = oy1 + ddy;
        ent.x2 = ox2 + ddx; ent.y2 = oy2 + ddy;
        ent.refreshCaches();
      },
      // Displacement guide: dashed line from drag-start to current cursor.
      renderGuides: (ctx, vm) => {
        const dctx = getDragContext();
        if (!dctx) return;
        dashedLine(
          ctx, vm,
          { x: dctx.startWx, y: dctx.startWy },
          { x: (ent.x1 + ent.x2) / 2, y: (ent.y1 + ent.y2) / 2 },
        );
      },
    },
  ];
}

/**
 * CIRCLE grips â€” stateless closures + dashed guide rendering.
 *
 *   - `circle-center`        : translate; guide = dashed line from drag-start
 *   - 4 radius grips (N/E/S/W): set radius from cursor distance; guide =
 *     dashed radius line from center to cursor + circle preview at new radius
 *
 * All onDrag closures read drag-start data from `getDragContext()` so the
 * per-tick `generate()` rebuild doesn't lose state.
 */
function circleGrips(ent: any): IGrip[] {
  const center: IGrip = {
    key: 'circle-center', entity: ent, type: 'center',
    x: ent.cx, y: ent.cy,
    onDrag: (wx, wy) => {
      const c = getDragContext();
      if (!c) return;
      const ocx = c.snapshot['cx'] as number;
      const ocy = c.snapshot['cy'] as number;
      ent.cx = ocx + (wx - c.startWx);
      ent.cy = ocy + (wy - c.startWy);
      ent.refreshCaches();
    },
    // Dashed displacement guide from drag-start to current center.
    renderGuides: (ctx, vm) => {
      const c = getDragContext();
      if (!c) return;
      const a = vm.w2s(c.startWx, c.startWy);
      const b = vm.w2s(ent.cx, ent.cy);
      ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    },
  };

  const radius = (kx: number, ky: number, key: string): IGrip => ({
    key: `circle-${key}`, entity: ent, type: 'radius',
    x: ent.cx + ent.r * kx, y: ent.cy + ent.r * ky,
    onDrag: (wx, wy) => {
      // Direct radius assignment from cursor distance â€” no drag-start
      // needed (center stays where it is, radius is purely cursor-driven).
      ent.r = Math.max(0.01, Math.hypot(wx - ent.cx, wy - ent.cy));
      ent.refreshCaches();
    },
    // Dashed radius line from center to cursor + faint circle outline at
    // the in-flight radius so the user sees the new size before commit.
    renderGuides: (ctx, vm) => {
      const c = vm.w2s(ent.cx, ent.cy);
      const r = ent.r * vm.scale;
      ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      // Radius line (center â†’ current angle direction)
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + r * kx, c.y - r * ky); // -ky for canvas y-down
      ctx.stroke();
      ctx.setLineDash([]);
    },
  });

  return [
    center,
    radius(1, 0, 'right'),
    radius(-1, 0, 'left'),
    radius(0, 1, 'top'),
    radius(0, -1, 'bottom'),
  ];
}

/**
 * ARC grips â€” stateless closures + sweep preview guides.
 *
 *   - `arc-center` : translate the arc (delta from drag-start)
 *   - `arc-start`  : rotate the start angle to the cursor + retune radius;
 *                    guide = dashed line centerâ†’cursor + faint arc preview
 *   - `arc-end`    : same for end angle/radius
 *
 * Angles are stored in degrees on ArcEntity.
 */
function arcGrips(ent: any): IGrip[] {
  const dashedRadius = (
    ctx: CanvasRenderingContext2D,
    vm: ViewModelService,
    angleDeg: number,
  ): void => {
    const a = angleDeg * Math.PI / 180;
    const c = vm.w2s(ent.cx, ent.cy);
    const r = ent.r * vm.scale;
    ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    // Canvas Y is down â†’ invert sin term.
    ctx.lineTo(c.x + r * Math.cos(a), c.y - r * Math.sin(a));
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const sa = (ent.startAngle * Math.PI) / 180;
  const ea = (ent.endAngle * Math.PI) / 180;
  return [
    // â”€â”€â”€ Center: translate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: 'arc-center', entity: ent, type: 'center', x: ent.cx, y: ent.cy,
      onDrag: (wx, wy) => {
        const c = getDragContext();
        if (!c) return;
        const ocx = c.snapshot['cx'] as number;
        const ocy = c.snapshot['cy'] as number;
        ent.cx = ocx + (wx - c.startWx);
        ent.cy = ocy + (wy - c.startWy);
        ent.refreshCaches();
      },
      renderGuides: (ctx, vm) => {
        const c = getDragContext();
        if (!c) return;
        const a = vm.w2s(c.startWx, c.startWy);
        const b = vm.w2s(ent.cx, ent.cy);
        ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      },
    },
    // â”€â”€â”€ Start endpoint: rotates startAngle + adjusts radius â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: 'arc-start', entity: ent, type: 'endpoint',
      x: ent.cx + ent.r * Math.cos(sa), y: ent.cy + ent.r * Math.sin(sa),
      onDrag: (wx, wy) => {
        ent.startAngle = (Math.atan2(wy - ent.cy, wx - ent.cx) * 180) / Math.PI;
        ent.r = Math.max(0.01, Math.hypot(wx - ent.cx, wy - ent.cy));
        ent.refreshCaches();
      },
      renderGuides: (ctx, vm) => {
        dashedRadius(ctx, vm, ent.startAngle);
      },
    },
    // â”€â”€â”€ End endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: 'arc-end', entity: ent, type: 'endpoint',
      x: ent.cx + ent.r * Math.cos(ea), y: ent.cy + ent.r * Math.sin(ea),
      onDrag: (wx, wy) => {
        ent.endAngle = (Math.atan2(wy - ent.cy, wx - ent.cx) * 180) / Math.PI;
        ent.r = Math.max(0.01, Math.hypot(wx - ent.cx, wy - ent.cy));
        ent.refreshCaches();
      },
      renderGuides: (ctx, vm) => {
        dashedRadius(ctx, vm, ent.endAngle);
      },
    },
  ];
}

/**
 * POLYLINE grips â€” covers both general polylines AND rectangles (a
 * closed 4-vertex polyline created via `makeRect`).
 *
 *   - Vertex grips (one per vertex) : drag â†’ stretch single vertex.
 *     Guide rendering:
 *       â€¢ Closed 4-vert (rectangle): H + V dashed cross through the
 *         DIAGONALLY-OPPOSITE corner (anchored at drag-start position) so
 *         the user reads the new width/height visually.
 *       â€¢ General polyline: dashed segment-extension lines from the two
 *         neighboring vertices to the dragging vertex.
 *
 *   - Mid-segment grips : drag â†’ move both endpoints of the segment only
 *     along the edge's perpendicular (resize that side; the edge stays
 *     parallel to itself). Guide = dashed line from drag-start to current
 *     cursor.
 *
 * Vertex onDrag uses direct assignment (cursor IS the new vertex position
 * â€” no drag-start delta needed). Mid-segment onDrag pulls drag-start data
 * via `getDragContext()` and reads the snapshot's `pts[]` array.
 */
function polylineGrips(ent: any): IGrip[] {
  const out: IGrip[] = [];
  const isRect = !!ent.closed && Array.isArray(ent.pts) && ent.pts.length === 4;
  const N = ent.pts.length;

  for (let i = 0; i < N; i++) {
    const idx = i;
    out.push({
      key: `poly-${idx}`, entity: ent, type: 'vertex',
      x: ent.pts[idx].x, y: ent.pts[idx].y,
      onDrag: (wx, wy) => {
        ent.pts[idx].x = wx;
        ent.pts[idx].y = wy;
        ent.refreshCaches();
      },
      renderGuides: (ctx, vm) => {
        ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        if (isRect) {
          // Rectangle vertex: H + V dashed cross through the opposite
          // corner â€” exactly what AutoCAD shows during STRETCH on a
          // rectangle so the user can read off the new width/height.
          const opposite = ent.pts[(idx + 2) % 4];
          const op = vm.w2s(opposite.x, opposite.y);
          const W = vm.canvasWidth;
          const H = vm.canvasHeight;
          ctx.beginPath();
          ctx.moveTo(0, op.y); ctx.lineTo(W, op.y);   // horizontal
          ctx.moveTo(op.x, 0); ctx.lineTo(op.x, H);   // vertical
          ctx.stroke();
        } else {
          // Generic polyline: dashed segments from the two neighbor
          // vertices to where the dragging vertex currently sits.
          const cur = ent.pts[idx];
          const c = vm.w2s(cur.x, cur.y);
          const prev = ent.closed && idx === 0 ? ent.pts[N - 1] : ent.pts[idx - 1];
          const next = ent.closed && idx === N - 1 ? ent.pts[0] : ent.pts[idx + 1];
          ctx.beginPath();
          if (prev) {
            const p = vm.w2s(prev.x, prev.y);
            ctx.moveTo(p.x, p.y); ctx.lineTo(c.x, c.y);
          }
          if (next) {
            const n = vm.w2s(next.x, next.y);
            ctx.moveTo(n.x, n.y); ctx.lineTo(c.x, c.y);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
      },
    });
  }

  // â”€â”€â”€ Mid-segment translate grips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // For closed polylines we also generate the wrap-around segment so a
  // rectangle gets all four edge midpoints (not just three).
  const segCount = ent.closed ? N : N - 1;
  for (let i = 0; i < segCount; i++) {
    const a = i;
    const b = (i + 1) % N;
    out.push({
      key: `poly-mid-${a}`, entity: ent, type: 'midpoint',
      x: (ent.pts[a].x + ent.pts[b].x) / 2, y: (ent.pts[a].y + ent.pts[b].y) / 2,
      onDrag: (wx, wy) => {
        const c = getDragContext();
        if (!c) return;
        const snapPts = c.snapshot['pts'] as { x: number; y: number }[] | undefined;
        if (!snapPts || !snapPts[a] || !snapPts[b]) return;
        // Resize-that-side behaviour: move BOTH segment endpoints only along
        // the edge's perpendicular (normal). The cursor's free 2-axis delta is
        // projected onto the normal so the edge slides in/out while staying
        // parallel to itself â€” exactly like dragging an edge-midpoint grip on
        // a rectangle in AutoCAD.
        const ex = snapPts[b].x - snapPts[a].x;
        const ey = snapPts[b].y - snapPts[a].y;
        const elen = Math.hypot(ex, ey);
        const ddx = wx - c.startWx;
        const ddy = wy - c.startWy;
        let mvx: number, mvy: number;
        if (elen < 1e-9) {
          // Degenerate edge (zero length): fall back to free translate.
          mvx = ddx; mvy = ddy;
        } else {
          const nx = -ey / elen;
          const ny = ex / elen;
          const proj = ddx * nx + ddy * ny;
          mvx = proj * nx;
          mvy = proj * ny;
        }
        ent.pts[a].x = snapPts[a].x + mvx;
        ent.pts[a].y = snapPts[a].y + mvy;
        ent.pts[b].x = snapPts[b].x + mvx;
        ent.pts[b].y = snapPts[b].y + mvy;
        ent.refreshCaches();
      },
      renderGuides: (ctx, vm) => {
        const c = getDragContext();
        if (!c) return;
        const start = vm.w2s(c.startWx, c.startWy);
        const cur = vm.w2s((ent.pts[a].x + ent.pts[b].x) / 2, (ent.pts[a].y + ent.pts[b].y) / 2);
        ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y); ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
        ctx.setLineDash([]);
      },
    });
  }
  return out;
}

function pointGrips(ent: any): IGrip[] {
  const grips: IGrip[] = [{
    key: 'point', entity: ent, type: 'endpoint', x: ent.x, y: ent.y,
    onDrag: (wx, wy) => { ent.x = wx; ent.y = wy; ent.refreshCaches(); },
  }];
  if (ent.type === 'TEXT') {
    const bbox = typeof ent.bbox === 'function' ? ent.bbox() : null;
    if (bbox) {
      const horiz = ent.justify[1] as 'L' | 'C' | 'R';
      const localX = (horiz === 'L' ? bbox.w : horiz === 'C' ? bbox.w / 2 : 0) + ent.height * 1.5;
      const rotX = ent.x + localX * Math.cos(ent.rotation);
      const rotY = ent.y + localX * Math.sin(ent.rotation);
      grips.push({
        key: 'text-rotation',
        entity: ent,
        type: 'rotation',
        x: rotX,
        y: rotY,
        onDrag: (wx, wy) => {
          ent.rotation = Math.atan2(wy - ent.y, wx - ent.x);
          ent.refreshCaches();
        },
      });
    }
  }
  return grips;
}

function insertGrips(ent: any): IGrip[] {
  const b = typeof ent.bbox === 'function' ? ent.bbox() : null;
  const grips: IGrip[] = [];

  // 1. Move grip at insertion point
  grips.push({
    key: 'insert-base', entity: ent, type: 'endpoint', x: ent.x, y: ent.y,
    onDrag: (wx, wy) => { ent.x = wx; ent.y = wy; ent.refreshCaches(); },
    renderGuides: (ctx, vm) => {
      const s = vm.w2s(ent.x, ent.y);
      ctx.save();
      ctx.strokeStyle = '#63b3ed';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(s.x - 12, s.y); ctx.lineTo(s.x + 12, s.y);
      ctx.moveTo(s.x, s.y - 12); ctx.lineTo(s.x, s.y + 12);
      ctx.stroke();
      ctx.restore();
    },
  });

  if (!b || b.w < 1e-6 || b.h < 1e-6) return grips;

  // Helper: read start state from snapshot
  const readStart = () => {
    const dc = getDragContext();
    if (!dc) return null;
    const s = dc.snapshot;
    return {
      rotation: s['rotation'] as number ?? ent.rotation,
      sx: s['sx'] as number ?? ent.sx,
      sy: s['sy'] as number ?? ent.sy,
      startWx: dc.startWx,
      startWy: dc.startWy,
    };
  };

  // 2. Rotation grip at top-right corner of bbox
  const rotGripX = b.x + b.w;
  const rotGripY = b.y + b.h;
  grips.push({
    key: 'insert-rotate', entity: ent, type: 'rotation', x: rotGripX, y: rotGripY,
    onDrag: (wx, wy) => {
      const st = readStart();
      if (!st) return;
      const angleToStart = Math.atan2(st.startWy - ent.y, st.startWx - ent.x);
      const angleToCursor = Math.atan2(wy - ent.y, wx - ent.x);
      const delta = (angleToCursor - angleToStart) * 180 / Math.PI;
      ent.rotation = st.rotation + delta;
      ent.refreshCaches();
    },
    renderGuides: (ctx, vm) => {
      const center = vm.w2s(ent.x, ent.y);
      const eb = typeof ent.bbox === 'function' ? ent.bbox() : null;
      if (!eb) return;
      const corner = vm.w2s(eb.x + eb.w, eb.y + eb.h);
      ctx.save();
      ctx.strokeStyle = '#63b3ed';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(corner.x, corner.y);
      ctx.stroke();
      ctx.restore();
    },
  });

  // 3. Uniform scale grip at bottom-left corner of bbox
  const scaleGripX = b.x;
  const scaleGripY = b.y;
  grips.push({
    key: 'insert-scale', entity: ent, type: 'endpoint', x: scaleGripX, y: scaleGripY,
    onDrag: (wx, wy) => {
      const st = readStart();
      if (!st) return;
      const startDist = Math.hypot(st.startWx - ent.x, st.startWy - ent.y);
      if (startDist < 1e-6) return;
      const curDist = Math.hypot(wx - ent.x, wy - ent.y);
      const ratio = curDist / startDist;
      ent.sx = st.sx * ratio;
      ent.sy = st.sy * ratio;
      ent.refreshCaches();
    },
    renderGuides: (ctx, vm) => {
      const eb = typeof ent.bbox === 'function' ? ent.bbox() : null;
      if (!eb) return;
      const c1 = vm.w2s(eb.x, eb.y);
      const c2 = vm.w2s(eb.x + eb.w, eb.y);
      const c3 = vm.w2s(eb.x + eb.w, eb.y + eb.h);
      const c4 = vm.w2s(eb.x, eb.y + eb.h);
      ctx.save();
      ctx.strokeStyle = '#63b3ed';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y);
      ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    },
  });

  return grips;
}

/**
 * XLINE grips â€” matches AutoCAD's construction-line grip model:
 *
 *   - `xline-base`      : blue square at the base point. Drag translates the
 *                         whole line (both base x/y shift by the cursor delta).
 *   - `xline-direction` : blue square at base + 10*dir. Drag rotates the line
 *                         around the fixed base point by updating `angle`.
 *
 * Both grips render the infinite-line guide (dashed) while dragging so the
 * user sees the result before releasing the mouse.
 */
function xlineGrips(ent: any): IGrip[] {
  const DIR_L = 10; // world units to the direction handle

  /** Draw the current XLINE as a dashed guide over the canvas. */
  const renderXLineGuide = (ctx: CanvasRenderingContext2D, vm: ViewModelService): void => {
    const L = 1e5; // long enough to span any practical viewport
    const cos = Math.cos(ent.angle);
    const sin = Math.sin(ent.angle);
    const a = vm.w2s(ent.x - cos * L, ent.y - sin * L);
    const b = vm.w2s(ent.x + cos * L, ent.y + sin * L);
    ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Grip 1: base point â€” translate the whole line.
  const baseGrip: IGrip = {
    key: 'xline-base',
    entity: ent,
    type: 'endpoint',
    x: ent.x,
    y: ent.y,
    onDrag: (wx, wy) => {
      const c = getDragContext();
      if (!c) return;
      ent.x = (c.snapshot['x'] as number) + (wx - c.startWx);
      ent.y = (c.snapshot['y'] as number) + (wy - c.startWy);
      ent.refreshCaches();
    },
    renderGuides: renderXLineGuide,
  };

  // Grip 2: direction handle â€” rotate angle around base.
  const dhX = ent.x + Math.cos(ent.angle) * DIR_L;
  const dhY = ent.y + Math.sin(ent.angle) * DIR_L;
  const dirGrip: IGrip = {
    key: 'xline-direction',
    entity: ent,
    type: 'endpoint',
    x: dhX,
    y: dhY,
    onDrag: (wx, wy) => {
      const c = getDragContext();
      if (!c) return;
      const bx = c.snapshot['x'] as number;
      const by = c.snapshot['y'] as number;
      ent.angle = Math.atan2(wy - by, wx - bx);
      ent.refreshCaches();
    },
    renderGuides: renderXLineGuide,
  };

  return [baseGrip, dirGrip];
}

/**
 * ELLIPSE grips â€” stateless closures + axis guide rendering.
 *
 *   - `ellipse-center`     : translate (delta from drag-start)
 *   - `ellipse-major`      : drag â†’ ellipse rotates so the major-axis
 *                            endpoint tracks the cursor; `rx` updates to
 *                            the cursor distance from center.
 *   - `ellipse-minor`      : drag â†’ project cursor onto the perpendicular
 *                            of the major axis; `ry` updates to that
 *                            projection's absolute length (rotation
 *                            stays fixed).
 *
 * Both axis endpoints render dashed major/minor axis lines through the
 * center while dragging, so the user sees the ellipse's frame live.
 */
function ellipseGrips(ent: any): IGrip[] {
  const dashedAxis = (
    ctx: CanvasRenderingContext2D,
    vm: ViewModelService,
    angleRad: number,
    halfLength: number,
  ): void => {
    const c = vm.w2s(ent.cx, ent.cy);
    const dx = Math.cos(angleRad) * halfLength * vm.scale;
    const dy = Math.sin(angleRad) * halfLength * vm.scale;
    ctx.beginPath();
    ctx.moveTo(c.x - dx, c.y + dy);  // canvas y-down â†’ flip sin
    ctx.lineTo(c.x + dx, c.y - dy);
    ctx.stroke();
  };

  const rot = ent.rotation || 0;
  const majorX = ent.cx + ent.rx * Math.cos(rot);
  const majorY = ent.cy + ent.rx * Math.sin(rot);
  const minorX = ent.cx + ent.ry * Math.cos(rot + Math.PI / 2);
  const minorY = ent.cy + ent.ry * Math.sin(rot + Math.PI / 2);

  return [
    // â”€â”€â”€ Center: translate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: 'ellipse-center', entity: ent, type: 'center',
      x: ent.cx, y: ent.cy,
      onDrag: (wx, wy) => {
        const c = getDragContext();
        if (!c) return;
        const ocx = c.snapshot['cx'] as number;
        const ocy = c.snapshot['cy'] as number;
        ent.cx = ocx + (wx - c.startWx);
        ent.cy = ocy + (wy - c.startWy);
        ent.refreshCaches();
      },
      renderGuides: (ctx, vm) => {
        const c = getDragContext();
        if (!c) return;
        const a = vm.w2s(c.startWx, c.startWy);
        const b = vm.w2s(ent.cx, ent.cy);
        ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      },
    },
    // â”€â”€â”€ Major-axis endpoint: rotates the ellipse + sets rx â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: 'ellipse-major', entity: ent, type: 'endpoint',
      x: majorX, y: majorY,
      onDrag: (wx, wy) => {
        const ndx = wx - ent.cx;
        const ndy = wy - ent.cy;
        const r = Math.hypot(ndx, ndy);
        if (r > 1e-6) {
          ent.rx = r;
          ent.rotation = Math.atan2(ndy, ndx);
        }
        ent.refreshCaches();
      },
      renderGuides: (ctx, vm) => {
        ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        const r = ent.rotation || 0;
        dashedAxis(ctx, vm, r, ent.rx);
        dashedAxis(ctx, vm, r + Math.PI / 2, ent.ry);
        ctx.setLineDash([]);
      },
    },
    // â”€â”€â”€ Minor-axis endpoint: sets ry; rotation unchanged â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: 'ellipse-minor', entity: ent, type: 'endpoint',
      x: minorX, y: minorY,
      onDrag: (wx, wy) => {
        const r = ent.rotation || 0;
        const perpX = Math.cos(r + Math.PI / 2);
        const perpY = Math.sin(r + Math.PI / 2);
        const ndx = wx - ent.cx;
        const ndy = wy - ent.cy;
        const proj = Math.abs(ndx * perpX + ndy * perpY);
        ent.ry = Math.max(0.01, proj);
        ent.refreshCaches();
      },
      renderGuides: (ctx, vm) => {
        ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        const r = ent.rotation || 0;
        dashedAxis(ctx, vm, r, ent.rx);
        dashedAxis(ctx, vm, r + Math.PI / 2, ent.ry);
        ctx.setLineDash([]);
      },
    },
  ];
}

/**
 * IMAGE grips (universal â€” same architecture as line/polyline/etc.):
 *
 *   - `image-center`         â€” translate entire image
 *   - 4 corners (tl/tr/bl/br)â€” free 2-axis resize; opposite corner stays fixed
 *   - 4 edges (t/b/l/r)      â€” single-axis resize; opposite edge stays fixed
 *
 * ImageEntity uses (x, y) = bottom-left, width grows +X, height grows +Y
 * (world Y is up). All closures are STATELESS â€” they read drag-start state
 * from `getDragContext()`. This is critical because `updateDrag()` calls
 * `generate()` on every mouse-move tick to refresh grip *positions*, which
 * recreates closures. Stateful closures would lose their drag-start data
 * after the first tick.
 *
 * The grip manager records `ModifyGeometryCmd(before, after)` on drag end â€”
 * since `snapshotEntity` captures `width / height / x / y`, undo restores
 * cleanly. No image-side drag code anywhere.
 */
function imageGrips(ent: any): IGrip[] {
  const finish = () => ent.refreshCaches();

  /** Dashed boundary preview: image's CURRENT four corners + diagonals. */
  const drawBoundary = (ctx: CanvasRenderingContext2D, vm: ViewModelService): void => {
    const bl = vm.w2s(ent.x, ent.y);
    const br = vm.w2s(ent.x + ent.width, ent.y);
    const tr = vm.w2s(ent.x + ent.width, ent.y + ent.height);
    const tl = vm.w2s(ent.x, ent.y + ent.height);
    ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(bl.x, bl.y);
    ctx.lineTo(br.x, br.y); ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(tl.x, tl.y); ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // â”€â”€â”€ Center: translate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const center: IGrip = {
    key: 'image-center', entity: ent, type: 'center',
    x: ent.x + ent.width / 2, y: ent.y + ent.height / 2,
    onDrag: (wx, wy) => {
      const ctx = getDragContext();
      if (!ctx) return;
      const ox = ctx.snapshot['x'] as number;
      const oy = ctx.snapshot['y'] as number;
      ent.x = ox + (wx - ctx.startWx);
      ent.y = oy + (wy - ctx.startWy);
      finish();
    },
    renderGuides: (ctx, vm) => {
      // Move guide: dashed line from drag-start center to current center.
      const c = getDragContext();
      if (!c) return;
      const ow = c.snapshot['width'] as number;
      const oh = c.snapshot['height'] as number;
      const ox = c.snapshot['x'] as number;
      const oy = c.snapshot['y'] as number;
      const a = vm.w2s(ox + ow / 2, oy + oh / 2);
      const b = vm.w2s(ent.x + ent.width / 2, ent.y + ent.height / 2);
      ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      drawBoundary(ctx, vm);
    },
  };

  // â”€â”€â”€ Corner: free 2-axis resize anchored at opposite corner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const corner = (kx: 0 | 1, ky: 0 | 1, label: string): IGrip => ({
    key: `image-${label}`, entity: ent, type: 'endpoint',
    x: ent.x + ent.width * kx, y: ent.y + ent.height * ky,
    onDrag: (wx, wy) => {
      const ctx = getDragContext();
      if (!ctx) return;
      const ox = ctx.snapshot['x'] as number;
      const oy = ctx.snapshot['y'] as number;
      const ow = ctx.snapshot['width'] as number;
      const oh = ctx.snapshot['height'] as number;
      // Opposite corner stays fixed in world space.
      const oppX = ox + ow * (1 - kx);
      const oppY = oy + oh * (1 - ky);
      const dx = Math.abs(wx - oppX);
      const dy = Math.abs(wy - oppY);
      const scale = Math.max(0.01, Math.max(dx / ow, dy / oh));
      
      const newW = ow * scale;
      const newH = oh * scale;
      
      ent.width = newW;
      ent.height = newH;
      ent.x = kx === 0 ? oppX - newW : oppX;
      ent.y = ky === 0 ? oppY - newH : oppY;
      finish();
    },
    renderGuides: (ctx, vm) => drawBoundary(ctx, vm),
  });

  // â”€â”€â”€ Edge: single-axis resize anchored at opposite edge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const edge = (axis: 'x' | 'y', side: 0 | 1, label: string): IGrip => ({
    key: `image-${label}`, entity: ent, type: 'midpoint',
    x: axis === 'x'
      ? ent.x + ent.width * side
      : ent.x + ent.width / 2,
    y: axis === 'y'
      ? ent.y + ent.height * side
      : ent.y + ent.height / 2,
    onDrag: (wx, wy) => {
      const ctx = getDragContext();
      if (!ctx) return;
      const ox = ctx.snapshot['x'] as number;
      const oy = ctx.snapshot['y'] as number;
      const ow = ctx.snapshot['width'] as number;
      const oh = ctx.snapshot['height'] as number;
      if (axis === 'x') {
        const anchorX = ox + ow * (1 - side);
        const newW = Math.max(0.01, Math.abs(wx - anchorX));
        ent.width = newW;
        ent.x = side === 0 ? anchorX - newW : anchorX;
      } else {
        const anchorY = oy + oh * (1 - side);
        const newH = Math.max(0.01, Math.abs(wy - anchorY));
        ent.height = newH;
        ent.y = side === 0 ? anchorY - newH : anchorY;
      }
      finish();
    },
    renderGuides: (ctx, vm) => drawBoundary(ctx, vm),
  });

  return [
    center,
    corner(0, 0, 'bl'),
    corner(1, 0, 'br'),
    corner(1, 1, 'tr'),
    corner(0, 1, 'tl'),
    edge('y', 0, 'b'),
    edge('y', 1, 't'),
    edge('x', 0, 'l'),
    edge('x', 1, 'r'),
  ];
}

/**
 * TABLE grips (universal â€” same architecture):
 *
 *   - `table-move` (top-left)â€” translate entire table
 *   - 4 corners              â€” scale all colWidths AND/OR rowHeights
 *   - 4 edges (t/b/l/r)      â€” scale one dimension
 *
 * TableEntity (x, y) = top-left corner. Table extends +X (right) and -Y
 * (down, since world Y is up). colWidths[] / rowHeights[] are per-column /
 * per-row world-unit sizes â€” proportional scaling keeps the relative size
 * of each column/row, matching AutoCAD's "scale table" behavior.
 *
 * Internal per-column / per-row separator drag handles live INSIDE the
 * TableEditorOverlay (so they only show while editing), per the user's
 * spec. This grip generator handles only the outer 9-grip set.
 */
/**
 * TABLE grips (universal â€” stateless closures, reads drag-start from
 * `getDragContext()` so it survives `generate()` rebuilds on every tick):
 *
 *   - `table-move` (top-left)â€” translate entire table
 *   - 4 corners (tr/bl/br)   â€” scale colWidths / rowHeights proportionally
 *   - 4 edges (t/b/l/r)      â€” scale one dimension
 *
 * TableEntity (x, y) = top-left corner; +X grows right, -Y grows down
 * (world Y is up). Proportional scaling reads `colWidths` / `rowHeights`
 * from the drag-start snapshot so the relative size of each column/row
 * stays constant â€” matching AutoCAD's "scale table" behavior.
 *
 * Internal per-column / per-row separator handles live in the
 * TableEditorOverlay (visible only while editing), so they aren't
 * duplicated here.
 */
/**
 * TABLE grips (universal â€” stateless closures, reads drag-start from
 * `getDragContext()` so the closures survive the per-tick `generate()`
 * rebuild done in `updateDrag`).
 *
 * Layout (matches the user's spec):
 *   - `table-center`           â€” center grip â†’ translate entire table
 *   - 4 corners (tl/tr/bl/br)  â†’ proportional scale (anchor opposite corner)
 *   - Column-divider grips     â†’ individual column resize on top + bottom edges
 *   - Row-divider grips        â†’ individual row resize on left + right edges
 *
 * TableEntity (x, y) = top-left corner; +X grows right, -Y grows down
 * (world Y is up). All scaling reads `colWidths[]` / `rowHeights[]` from
 * the drag-start snapshot so relative sizes stay constant.
 */
function tableGrips(ent: any): IGrip[] {
  const grips: IGrip[] = [];
  const finish = () => ent.refreshCaches();

  /** Pull the table's frozen drag-start fields out of the context snapshot. */
  const readStart = () => {
    const ctx = getDragContext();
    if (!ctx) return null;
    const s = ctx.snapshot;
    const cw = ((s['colWidths'] as number[]) ?? []).slice();
    const rh = ((s['rowHeights'] as number[]) ?? []).slice();
    return {
      x: s['x'] as number,
      y: s['y'] as number,
      cw,
      rh,
      totalW: cw.reduce((a, b) => a + b, 0),
      totalH: rh.reduce((a, b) => a + b, 0),
      startWx: ctx.startWx,
      startWy: ctx.startWy,
    };
  };

  /**
   * Dashed table-boundary preview: the table's CURRENT outline + the live
   * column/row grid. Painted from the entity's current geometry so the
   * user sees the result of their in-flight drag.
   */
  const drawBoundary = (ctx: CanvasRenderingContext2D, vm: ViewModelService): void => {
    const totalWLive = (ent.colWidths as number[]).reduce((a, b) => a + b, 0);
    const totalHLive = (ent.rowHeights as number[]).reduce((a, b) => a + b, 0);
    const tl = vm.w2s(ent.x, ent.y);
    const br = vm.w2s(ent.x + totalWLive, ent.y - totalHLive);
    ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    // Outer rect
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(br.x, tl.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(tl.x, br.y);
    ctx.closePath();
    // Inner column lines
    let xRun = ent.x;
    for (let i = 0; i < ent.colWidths.length - 1; i++) {
      xRun += ent.colWidths[i];
      const a = vm.w2s(xRun, ent.y);
      const b = vm.w2s(xRun, ent.y - totalHLive);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    // Inner row lines
    let yRun = ent.y;
    for (let i = 0; i < ent.rowHeights.length - 1; i++) {
      yRun -= ent.rowHeights[i];
      const a = vm.w2s(ent.x, yRun);
      const b = vm.w2s(ent.x + totalWLive, yRun);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Live totals for grip positioning. The grip dots are placed where the
  // entity currently is; the onDrag closures use the drag-start snapshot
  // for delta calculations.
  const totalW = (ent.colWidths as number[]).reduce((a, b) => a + b, 0);
  const totalH = (ent.rowHeights as number[]).reduce((a, b) => a + b, 0);

  // â”€â”€â”€ Center: translate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  grips.push({
    key: 'table-center', entity: ent, type: 'center',
    x: ent.x + totalW / 2, y: ent.y - totalH / 2,
    onDrag: (wx, wy) => {
      const s = readStart(); if (!s) return;
      ent.x = s.x + (wx - s.startWx);
      ent.y = s.y + (wy - s.startWy);
      finish();
    },
    renderGuides: (ctx, vm) => {
      // Move guide: dashed line from drag-start center to current center
      // + table outline at the new position.
      const s = readStart(); if (!s) return;
      const a = vm.w2s(s.x + s.totalW / 2, s.y - s.totalH / 2);
      const tw = (ent.colWidths as number[]).reduce((p, q) => p + q, 0);
      const th = (ent.rowHeights as number[]).reduce((p, q) => p + q, 0);
      const b = vm.w2s(ent.x + tw / 2, ent.y - th / 2);
      ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      drawBoundary(ctx, vm);
    },
  });

  // â”€â”€â”€ Corners: proportional scale, opposite corner stays fixed â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // kx âˆˆ {0,1}: 0=left, 1=right. ky âˆˆ {0,1}: 0=top, 1=bottom.
  // TableEntity world Y is up, table grows down (-Y), so the bottom
  // corner is at y = ent.y - totalH.
  const corner = (kx: 0 | 1, ky: 0 | 1, label: string): IGrip => ({
    key: `table-corner-${label}`, entity: ent, type: 'endpoint',
    x: ent.x + totalW * kx, y: ent.y - totalH * ky,
    onDrag: (wx, wy) => {
      const s = readStart(); if (!s) return;
      // Opposite corner in world space, derived from the drag-start pose.
      const oppX = s.x + s.totalW * (1 - kx);
      const oppY = s.y - s.totalH * (1 - ky);
      const dx = Math.abs(wx - oppX);
      const dy = Math.abs(wy - oppY);
      if (s.totalW < 1e-6 || s.totalH < 1e-6) return;
      // Uniform proportional scale â€” the larger of the two axes drives.
      const scale = Math.max(0.01, Math.max(dx / s.totalW, dy / s.totalH));
      for (let i = 0; i < s.cw.length; i++) ent.colWidths[i] = Math.max(1, s.cw[i] * scale);
      for (let i = 0; i < s.rh.length; i++) ent.rowHeights[i] = Math.max(1, s.rh[i] * scale);
      const newW = s.totalW * scale;
      const newH = s.totalH * scale;
      // Re-anchor x/y so the opposite corner is fixed.
      ent.x = kx === 0 ? oppX - newW : oppX;
      ent.y = ky === 0 ? oppY + newH : oppY;
      finish();
    },
    renderGuides: (ctx, vm) => drawBoundary(ctx, vm),
  });
  grips.push(corner(0, 0, 'tl'));
  grips.push(corner(1, 0, 'tr'));
  grips.push(corner(0, 1, 'bl'));
  grips.push(corner(1, 1, 'br'));

  // â”€â”€â”€ Column-divider grips on top & bottom edges â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Each interior column boundary gets two grips (one top, one bottom).
  // Drag resizes the column to the LEFT of that boundary using the cursor
  // X delta from drag-start.
  let cx = ent.x;
  for (let c = 0; c <= ent.cols; c++) {
    if (c > 0 && c < ent.cols) {
      const col = c - 1;
      grips.push({
        key: `table-col-top-${c}`, entity: ent, type: 'midpoint',
        x: cx, y: ent.y,
        onDrag: (wx) => {
          const s = readStart(); if (!s) return;
          ent.colWidths[col] = Math.max(0.5, s.cw[col] + (wx - s.startWx));
          finish();
        },
        renderGuides: (ctx, vm) => drawBoundary(ctx, vm),
      });
      grips.push({
        key: `table-col-bot-${c}`, entity: ent, type: 'midpoint',
        x: cx, y: ent.y - totalH,
        onDrag: (wx) => {
          const s = readStart(); if (!s) return;
          ent.colWidths[col] = Math.max(0.5, s.cw[col] + (wx - s.startWx));
          finish();
        },
        renderGuides: (ctx, vm) => drawBoundary(ctx, vm),
      });
    }
    if (c < ent.cols) cx += ent.colWidths[c];
  }

  // ─── Row-divider grips on left & right edges ────────────────────────────────
  // Dragging DOWN (smaller wy in world coords, since world Y is up) grows
  // the row's height, so we use (startWy - wy) as the delta.
  let cy = ent.y;
  for (let r = 0; r <= ent.rows; r++) {
    if (r > 0 && r < ent.rows) {
      const row = r - 1;
      grips.push({
        key: `table-row-left-${r}`, entity: ent, type: 'midpoint',
        x: ent.x, y: cy,
        onDrag: (_wx, wy) => {
          const s = readStart(); if (!s) return;
          ent.rowHeights[row] = Math.max(0.5, s.rh[row] + (s.startWy - wy));
          finish();
        },
        renderGuides: (ctx, vm) => drawBoundary(ctx, vm),
      });
      grips.push({
        key: `table-row-right-${r}`, entity: ent, type: 'midpoint',
        x: ent.x + totalW, y: cy,
        onDrag: (_wx, wy) => {
          const s = readStart(); if (!s) return;
          ent.rowHeights[row] = Math.max(0.5, s.rh[row] + (s.startWy - wy));
          finish();
        },
        renderGuides: (ctx, vm) => drawBoundary(ctx, vm),
      });
    }
    if (r < ent.rows) cy -= ent.rowHeights[r];
  }

  return grips;
}

/**
 * HATCH grips.
 *
 *   - `hatch-center`       : present for every hatch. For associative hatches
 *                            this is display-only (the hatch is defined by its
 *                            host entities; dragging the center has no effect
 *                            â€” AutoCAD behaves the same way). For frozen
 *                            (non-associative) hatches it translates the entire
 *                            stored polygon via `moveFrozenHatch`.
 *
 *   - `hatch-vertex-N`     : one grip per vertex of the outer boundary loop,
 *                            only emitted for frozen hatches. Dragging a vertex
 *                            moves that polygon corner by updating the shared
 *                            endpoint of the two adjacent frozen edges.
 *
 * The snapshot-based undo path works through the standard `ModifyGeometryCmd`
 * that GripManagerService commits at drag-end â€” `snapshotEntity` now captures
 * `boundarySpec` + `boundaries` deep clones for HATCH entities.
 */
function hatchGrips(ent: any): IGrip[] {
  const grips: IGrip[] = [];

  const b = typeof ent.bbox === 'function' ? ent.bbox() : null;
  if (!b) return grips;

  const bCx = b.x + b.w / 2;
  const bCy = b.y + b.h / 2;

  const spec = ent.boundarySpec;
  const isAssociative = spec ? spec.associative : ent.associative;

  // ─── Center grip — translate ──
  grips.push({
    key: 'hatch-center',
    entity: ent,
    type: 'center',
    x: bCx,
    y: bCy,
    onDrag: (wx: number, wy: number) => {
      const c = getDragContext();
      if (!c) return;
      const dx = wx - c.startWx;
      const dy = wy - c.startWy;
      // Restore to snapshot position then apply fresh delta
      if (c.snapshot['boundarySpec']) {
        ent.boundarySpec = JSON.parse(JSON.stringify(c.snapshot['boundarySpec']));
      }
      if (c.snapshot['boundaries']) {
        ent.boundaries = JSON.parse(JSON.stringify(c.snapshot['boundaries']));
      }
      
      // Moving the center grip explicitly breaks associativity
      ent.associative = false;
      if (ent.boundarySpec) ent.boundarySpec.associative = false;

      moveFrozenHatch(ent, dx, dy);
      ent.refreshCaches();
    },
    renderGuides: (ctx: CanvasRenderingContext2D, vm: ViewModelService) => {
      const c = getDragContext();
      if (!c) return;
      const liveBbox = typeof ent.bbox === 'function' ? ent.bbox() : null;
      if (!liveBbox) return;
      const from = vm.w2s(c.startWx, c.startWy);
      const to   = vm.w2s(liveBbox.x + liveBbox.w / 2, liveBbox.y + liveBbox.h / 2);
      ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
    },
  });

  // Emit boundary grips for non-associative hatches
  if (!isAssociative && spec?.loops) {
    let gripCount = 0;
    for (let loopIdx = 0; loopIdx < spec.loops.length; loopIdx++) {
      const loop = spec.loops[loopIdx];
      if (!loop.frozen || loop.frozen.length === 0) continue;

      const hasTrueCurves = loop.frozen.some(e => e.kind === 'ARC' || e.kind === 'ELLIPSE_ARC' || e.kind === 'SPLINE');
      const isComplexPoly = loop.frozen.length > 16 && loop.frozen.every(e => e.kind === 'POLYLINE_SEG');

      if (hasTrueCurves) {
        for (let edgeIdx = 0; edgeIdx < loop.frozen.length; edgeIdx++) {
          const edge = loop.frozen[edgeIdx];
          if (edge.kind === 'ARC' || edge.kind === 'ELLIPSE_ARC') {
            const cx = edge.center!.x;
            const cy = edge.center!.y;
            const r = edge.r ?? edge.rx ?? 1;
            
            // Full circle gets 4 quadrant grips
            if (Math.abs((edge.a1 ?? Math.PI * 2) - (edge.a0 ?? 0)) >= Math.PI * 2 - 1e-4) {
              const makeQuadrant = (px: number, py: number) => {
                grips.push({
                  key: `hatch-curve-${loopIdx}-${edgeIdx}-${gripCount++}`,
                  entity: ent, type: 'vertex', x: px, y: py,
                  onDrag: (wx, wy) => {
                    const newR = Math.hypot(wx - cx, wy - cy);
                    if (edge.kind === 'ARC') {
                      edge.r = newR;
                      edge.p0.x = cx + newR * Math.cos(edge.a0!);
                      edge.p0.y = cy + newR * Math.sin(edge.a0!);
                      edge.p1.x = cx + newR * Math.cos(edge.a1!);
                      edge.p1.y = cy + newR * Math.sin(edge.a1!);
                    } else {
                      const scale = newR / r;
                      edge.rx = (edge.rx ?? 1) * scale;
                      edge.ry = (edge.ry ?? 1) * scale;
                    }
                    ent.refreshCaches();
                  }
                });
              };
              makeQuadrant(cx + r, cy);
              makeQuadrant(cx - r, cy);
              makeQuadrant(cx, cy + r);
              makeQuadrant(cx, cy - r);
            } else {
              // Open arc gets endpoints
              grips.push({
                key: `hatch-curve-${loopIdx}-${edgeIdx}-p0`, entity: ent, type: 'endpoint', x: edge.p0.x, y: edge.p0.y,
                onDrag: (wx, wy) => { edge.p0.x = wx; edge.p0.y = wy; ent.refreshCaches(); }
              });
              grips.push({
                key: `hatch-curve-${loopIdx}-${edgeIdx}-p1`, entity: ent, type: 'endpoint', x: edge.p1.x, y: edge.p1.y,
                onDrag: (wx, wy) => { edge.p1.x = wx; edge.p1.y = wy; ent.refreshCaches(); }
              });
            }
          } else {
            // LINE or SPLINE endpoints
            grips.push({
              key: `hatch-curve-${loopIdx}-${edgeIdx}-p0`, entity: ent, type: 'endpoint', x: edge.p0.x, y: edge.p0.y,
              onDrag: (wx, wy) => { edge.p0.x = wx; edge.p0.y = wy; ent.refreshCaches(); }
            });
          }
        }
      } else {
        // Standard polygon (from topology engine): emit a grip for every vertex
        for (let edgeIdx = 0; edgeIdx < loop.frozen.length; edgeIdx++) {
          const edge = loop.frozen[edgeIdx];
          const prevEdge = edgeIdx === 0 ? loop.frozen[loop.frozen.length - 1] : loop.frozen[edgeIdx - 1];
          
          grips.push({
            key: `hatch-vertex-${loopIdx}-${edgeIdx}`, entity: ent, type: 'vertex', x: edge.p0.x, y: edge.p0.y,
            onDrag: (wx: number, wy: number) => {
              edge.p0.x = wx; edge.p0.y = wy;
              prevEdge.p1.x = wx; prevEdge.p1.y = wy;
              if (ent.boundaries && ent.boundaries[loopIdx]) {
                if (ent.boundaries[loopIdx][edgeIdx]) {
                  ent.boundaries[loopIdx][edgeIdx].start.x = wx;
                  ent.boundaries[loopIdx][edgeIdx].start.y = wy;
                }
                const prevLegacyIdx = edgeIdx === 0 ? ent.boundaries[loopIdx].length - 1 : edgeIdx - 1;
                if (ent.boundaries[loopIdx][prevLegacyIdx]) {
                  ent.boundaries[loopIdx][prevLegacyIdx].end.x = wx;
                  ent.boundaries[loopIdx][prevLegacyIdx].end.y = wy;
                }
              }
              ent.refreshCaches();
            }
          });
        }
      }
    }
  }

  return grips;
}

/**
 * LEADER grips â€” match the AutoCAD multileader contract:
 *   - `leader-tip`      : drag the arrow head (pts[0]).
 *   - `leader-bend-N`   : drag any intermediate vertex (pts[1..N-1]).
 *   - `leader-landing`  : drag the landing end. Cursor X relative to the
 *                         last vertex rewrites `landingLength` AND
 *                         `attachmentSide`; the text follows automatically
 *                         because `textInsertion()` is derived from the
 *                         landing end. So a single grip moves landing+text
 *                         together â€” the way AutoCAD's multileader behaves
 *                         when text is not independently offset.
 *
 * Snapshot keys for the landing grip (`landingLength`, `attachmentSide`)
 * are already captured by `snapshotEntity`, so undo/redo restore the full
 * geometry through the standard ModifyGeometryCmd pipeline.
 */
function leaderGrips(ent: any): IGrip[] {
  const out: IGrip[] = [];
  if (!Array.isArray(ent.pts) || ent.pts.length < 2) return out;

  // Arrow tip + every intermediate vertex (bends).
  for (let i = 0; i < ent.pts.length; i++) {
    const idx = i;
    out.push({
      key: idx === 0 ? 'leader-tip' : `leader-bend-${idx}`,
      entity: ent,
      type: idx === 0 ? 'endpoint' : 'vertex',
      x: ent.pts[idx].x,
      y: ent.pts[idx].y,
      onDrag: (wx, wy) => {
        ent.pts[idx].x = wx;
        ent.pts[idx].y = wy;
        ent.refreshCaches();
      },
    });
  }

  // Landing endpoint â€” computed from the last vertex + landingLength along
  // attachmentSide. Drag rewrites both fields so the text moves with the
  // landing automatically (textInsertion() is derived).
  const last = ent.pts[ent.pts.length - 1];
  const dir = ent.attachmentSide === 'right' ? 1 : -1;
  const landingEnd = { x: last.x + dir * (ent.landingLength ?? 0), y: last.y };
  out.push({
    key: 'leader-landing',
    entity: ent,
    type: 'endpoint',
    x: landingEnd.x,
    y: landingEnd.y,
    onDrag: (wx, _wy) => {
      const pts = ent.pts as { x: number; y: number }[];
      if (!pts?.length) return;
      const tail = pts[pts.length - 1];
      const dx = wx - tail.x;
      ent.attachmentSide = dx >= 0 ? 'right' : 'left';
      ent.landingLength = Math.max(0, Math.abs(dx));
      ent.refreshCaches();
    },
    renderGuides: (ctx, vm) => {
      const tail = ent.pts[ent.pts.length - 1];
      const a = vm.w2s(tail.x, tail.y);
      const newDir = ent.attachmentSide === 'right' ? 1 : -1;
      const b = vm.w2s(tail.x + newDir * ent.landingLength, tail.y);
      ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    },
  });

  if (ent.text && ent.text.length) {
    const ins = ent.textInsertion();
    const rAngle = ent.textRotationOverride != null ? ent.textRotationOverride : 0;
    const localX = (ent.attachmentSide === 'right' ? 1 : -1) * (ent.height * 2.5);
    const rotX = ins.x + localX * Math.cos(rAngle);
    const rotY = ins.y + localX * Math.sin(rAngle);
    out.push({
      key: 'leader-rotation',
      entity: ent,
      type: 'rotation',
      x: rotX,
      y: rotY,
      onDrag: (wx, wy) => {
        ent.textRotationOverride = Math.atan2(wy - ins.y, wx - ins.x);
        if (ent.attachmentSide === 'left') {
          ent.textRotationOverride = Math.atan2(ins.y - wy, ins.x - wx);
        }
        ent.refreshCaches();
      },
    });
  }

  return out;
}

function mleaderGrips(ent: any): IGrip[] {
  const out: IGrip[] = [];
  if (!Array.isArray(ent.leaderLines) || !ent.leaderLines.length) return out;

  for (let lineIdx = 0; lineIdx < ent.leaderLines.length; lineIdx++) {
    const line = ent.leaderLines[lineIdx];
    if (!line.pts || line.pts.length < 2) continue;
    
    // Arrow tip + intermediate vertices
    for (let ptIdx = 0; ptIdx < line.pts.length; ptIdx++) {
      out.push({
        key: ptIdx === 0 ? `mleader-tip-${lineIdx}` : `mleader-bend-${lineIdx}-${ptIdx}`,
        entity: ent,
        type: ptIdx === 0 ? 'endpoint' : 'vertex',
        x: line.pts[ptIdx].x,
        y: line.pts[ptIdx].y,
        onDrag: (wx, wy) => {
          ent.leaderLines[lineIdx].pts[ptIdx].x = wx;
          ent.leaderLines[lineIdx].pts[ptIdx].y = wy;
          ent.refreshCaches();
        },
      });
    }
  }

  if (ent.leaderLines[0] && ent.leaderLines[0].pts.length > 0) {
    const last = ent.leaderLines[0].pts[ent.leaderLines[0].pts.length - 1];
    const dir = ent.attachmentSide === 'right' ? 1 : -1;
    const landingEnd = { x: last.x + dir * ent.doglegLength, y: last.y };
    out.push({
      key: 'mleader-landing',
      entity: ent,
      type: 'endpoint',
      x: landingEnd.x,
      y: landingEnd.y,
      onDrag: (wx, _wy) => {
        const tail = ent.leaderLines[0].pts[ent.leaderLines[0].pts.length - 1];
        const dx = wx - tail.x;
        ent.attachmentSide = dx >= 0 ? 'right' : 'left';
        ent.doglegLength = Math.max(0, Math.abs(dx));
        ent.refreshCaches();
      },
      renderGuides: (ctx, vm) => {
        const tail = ent.leaderLines[0].pts[ent.leaderLines[0].pts.length - 1];
        const a = vm.w2s(tail.x, tail.y);
        const newDir = ent.attachmentSide === 'right' ? 1 : -1;
        const b = vm.w2s(tail.x + newDir * ent.doglegLength, tail.y);
        ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      },
    });

    if (ent.content && ent.content.length) {
      const s = typeof ent._resolveStyle === 'function' ? ent._resolveStyle(null) : {};
      const textHeight = ent.textHeight ?? s.textHeight ?? 2.5;
      const textOffset = ent.textOffset ?? s.textOffset ?? 1.0;
      const ins = { x: landingEnd.x + dir * textOffset, y: landingEnd.y };
      const rAngle = ent.textRotationOverride != null ? ent.textRotationOverride : 0;
      const localX = (ent.attachmentSide === 'right' ? 1 : -1) * (textHeight * 2.5);
      const rotX = ins.x + localX * Math.cos(rAngle);
      const rotY = ins.y + localX * Math.sin(rAngle);
      out.push({
        key: 'mleader-rotation',
        entity: ent,
        type: 'rotation',
        x: rotX,
        y: rotY,
        onDrag: (wx, wy) => {
          ent.textRotationOverride = Math.atan2(wy - ins.y, wx - ins.x);
          if (ent.attachmentSide === 'left') {
            ent.textRotationOverride = Math.atan2(ins.y - wy, ins.x - wx);
          }
          ent.refreshCaches();
        },
      });
    }
  }

  return out;
}

/**
 * DIMENSION grips â€” matches AutoCAD's linear dimension grip model:
 *
 *   `dim-p1`      : drag p1 (first extension-line origin).
 *   `dim-p2`      : drag p2 (second extension-line origin).
 *   `dim-line-mid`: drag the midpoint of the dimension line â€” moves
 *                   `dimLinePoint` so the dim-line shifts toward/away
 *                   from the measured points (changes offset + side).
 *   `dim-text`    : drag text position. Moving across the dim-line
 *                   automatically toggles `textFlipped` (snaps to the
 *                   nearest side, matching AutoCAD drag-text behaviour).
 *   `dim-flip`    : a secondary grip next to the text. A click (drag
 *                   of < 2 world units) instantly toggles `textFlipped`.
 *
 * All closures read drag-start state from `getDragContext()` so they
 * survive the per-tick `generate()` rebuild without losing delta data.
 */
function dimensionGrips(ent: any): IGrip[] {
  const out: IGrip[] = [];

  // â”€â”€ Compute the working frame â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const dx  = ent.p2.x - ent.p1.x;
  const dy  = ent.p2.y - ent.p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return out;
  const ux = dx / len, uy = dy / len;
  const nx = -uy,      ny =  ux;   // CCW perpendicular

  // Signed perpendicular offset of the dim-line from the p1-p2 axis.
  const ox = ent.dimLinePoint.x - ent.p1.x;
  const oy = ent.dimLinePoint.y - ent.p1.y;
  const signedOffset = ox * nx + oy * ny;
  const side = signedOffset >= 0 ? 1 : -1;
  const ex   = nx * side, ey = ny * side; // offset direction (toward dim-line)

  // Dim-line endpoints (world).
  const dimP1x = ent.p1.x + signedOffset * nx;
  const dimP1y = ent.p1.y + signedOffset * ny;
  const dimP2x = ent.p2.x + signedOffset * nx;
  const dimP2y = ent.p2.y + signedOffset * ny;

  // Dynamic sizing (matches DimensionEntity.draw()).
  const dynSize   = len > 0 ? Math.max(0.5, Math.min(100, len * 0.04)) : 2.5;
  const textOffset = ent.textOffset ?? dynSize * 0.6;
  const flipSign   = ent.textFlipped ? -1 : 1;

  // Text world position (for the text + flip grips).
  const midX      = (dimP1x + dimP2x) / 2;
  const midY      = (dimP1y + dimP2y) / 2;
  const textAlongOffset = ent.textAlongOffset ?? 0;
  
  // If placed 'above' (centered on line), perpendicular offset is 0.
  const isCentered = ent.textPlacement === 'above';
  const gripPerpOffset = isCentered ? 0 : textOffset;
  
  const textWx    = midX + textAlongOffset * ux + gripPerpOffset * flipSign * ex;
  const textWy    = midY + textAlongOffset * uy + gripPerpOffset * flipSign * ey;
  // Flip-grip sits slightly further from the text (toward the outside).
  const flipDist  = dynSize * 1.5;
  const flipGripX = textWx + flipDist * flipSign * ex;
  const flipGripY = textWy + flipDist * flipSign * ey;

  // â”€â”€ Dashed guide helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const dashedLine = (
    ctx: CanvasRenderingContext2D,
    vm: ViewModelService,
    ax: number, ay: number,
    bx: number, by: number,
  ): void => {
    const a = vm.w2s(ax, ay), b = vm.w2s(bx, by);
    ctx.strokeStyle = getActiveCanvasPalette().osnapHint;
    ctx.lineWidth   = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // â”€â”€ p1 grip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  out.push({
    key: 'dim-p1', entity: ent, type: 'extension-origin',
    x: ent.p1.x, y: ent.p1.y,
    onDrag: (wx, wy) => {
      ent.p1.x = wx; ent.p1.y = wy;
      // When anchor1 is set, detach it so the moved point stays manual.
      if (ent.anchor1) ent.anchor1 = null;
      ent.refreshCaches();
    },
    renderGuides: (ctx, vm) => dashedLine(ctx, vm, ent.p2.x, ent.p2.y, ent.p1.x, ent.p1.y),
  });

  // â”€â”€ p2 grip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  out.push({
    key: 'dim-p2', entity: ent, type: 'extension-origin',
    x: ent.p2.x, y: ent.p2.y,
    onDrag: (wx, wy) => {
      ent.p2.x = wx; ent.p2.y = wy;
      if (ent.anchor2) ent.anchor2 = null;
      ent.refreshCaches();
    },
    renderGuides: (ctx, vm) => dashedLine(ctx, vm, ent.p1.x, ent.p1.y, ent.p2.x, ent.p2.y),
  });

  // â”€â”€ Dim-line midpoint grip (changes offset / side) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const dimMidX = (dimP1x + dimP2x) / 2;
  const dimMidY = (dimP1y + dimP2y) / 2;
  out.push({
    key: 'dim-line-mid', entity: ent, type: 'dimension-line',
    x: dimMidX, y: dimMidY,
    onDrag: (wx, wy) => {
      // Project cursor onto the perpendicular axis from p1.
      const cux = wx - ent.p1.x;
      const cuy = wy - ent.p1.y;
      const proj = cux * nx + cuy * ny;
      // dimLinePoint is defined as: p1 + proj*n + 0*u (midpoint along u).
      ent.dimLinePoint.x = ent.p1.x + proj * nx;
      ent.dimLinePoint.y = ent.p1.y + proj * ny;
      ent.refreshCaches();
    },
    renderGuides: (ctx, vm) => {
      // Dashed perpendicular guide from p1-p2 axis to the dim line.
      const axisMidX = (ent.p1.x + ent.p2.x) / 2;
      const axisMidY = (ent.p1.y + ent.p2.y) / 2;
      dashedLine(ctx, vm, axisMidX, axisMidY, ent.dimLinePoint.x, ent.dimLinePoint.y);
    },
  });

  // â”€â”€ Text drag grip â€” moving text also snaps flip side â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  out.push({
    key: 'dim-text', entity: ent, type: 'text',
    x: textWx, y: textWy,
    onDrag: (wx, wy) => {
      const c = getDragContext();
      if (!c) return;
      // Project cursor onto the perpendicular axis relative to the
      // dimension mid-point to get the new text offset.
      const cdx = wx - midX;
      const cdy = wy - midY;
      // Recompute frame live (p1/p2 may have moved via another grip).
      const fdx = ent.p2.x - ent.p1.x;
      const fdy = ent.p2.y - ent.p1.y;
      const flen = Math.hypot(fdx, fdy);
      if (flen < 1e-9) return;
      const fnx = -fdy / flen, fny = fdx / flen;
      const fux = fdx / flen, fuy = fdy / flen;
      const fso = (ent.dimLinePoint.x - ent.p1.x) * fnx
                + (ent.dimLinePoint.y - ent.p1.y) * fny;
      const fSide = fso >= 0 ? 1 : -1;
      const fex = fnx * fSide, fey = fny * fSide;
      // Signed proj onto perpendicular (positive = same side as dim-line).
      const perp = cdx * fnx + cdy * fny;
      const along = cdx * fux + cdy * fuy;
      
      const sStyle = typeof ent._resolveStyle === 'function' ? ent._resolveStyle(null) : {};
      const tHeight = ent.textHeight ?? sStyle.textHeight ?? 2.5;
      const snapDist = tHeight * 0.8;

      const absPerp = Math.abs(perp);
      if (absPerp < snapDist) {
        ent.textPlacement = 'above'; // Note: 'above' means centered in this codebase
      } else {
        ent.textPlacement = 'auto';
        const newFlipped = perp * fSide < 0;
        ent.textFlipped = newFlipped;
        ent.textOffset = absPerp;
      }
      ent.textAlongOffset = along;
      ent.refreshCaches();
    },
    renderGuides: (ctx, vm) => dashedLine(ctx, vm, midX, midY, textWx, textWy),
  });

  // â”€â”€ Flip grip â€” click to toggle textFlipped â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Uses onDrag with a near-zero motion threshold so a simple click fires it.
  out.push({
    key: 'dim-flip', entity: ent, type: 'endpoint',
    x: flipGripX, y: flipGripY,
    onDrag: (wx, wy) => {
      const c = getDragContext();
      if (!c) return;
      // Only fire when the user hasn't moved more than 2 world units
      // (distinguishes a click from an accidental drag).
      const moved = Math.hypot(wx - c.startWx, wy - c.startWy);
      if (moved < 2) {
        ent.textFlipped = !ent.textFlipped;
        ent.refreshCaches();
      }
    },
  });

  const sStyle = typeof ent._resolveStyle === 'function' ? ent._resolveStyle(null) : {};
  const tHeight = ent.textHeight ?? sStyle.textHeight ?? 2.5;
  const dimAngle = Math.atan2(ent.p2.y - ent.p1.y, ent.p2.x - ent.p1.x);
  const rAngle = ent.textRotationOverride != null ? ent.textRotationOverride : dimAngle;
  const rotDist = tHeight * 2.0;
  const rotX = textWx + rotDist * Math.cos(rAngle);
  const rotY = textWy + rotDist * Math.sin(rAngle);
  
  out.push({
    key: 'dim-rotation',
    entity: ent,
    type: 'rotation',
    x: rotX,
    y: rotY,
    onDrag: (wx, wy) => {
      ent.textRotationOverride = Math.atan2(wy - textWy, wx - textWx);
      ent.refreshCaches();
    },
  });

  return out;
}

function joggedRadiusDimensionGrips(ent: any): IGrip[] {
  const out: IGrip[] = [];

  // Resolve style for dynamic sizing
  const sStyle = typeof ent._resolveStyle === 'function' ? ent._resolveStyle(null) : {};

  // 1. Override Center Grip
  out.push({
    key: 'dimjog-override-center', entity: ent, type: 'center',
    x: ent.overrideCenter.x, y: ent.overrideCenter.y,
    onDrag: (wx, wy) => {
      const dx = wx - ent.trueCenter.x;
      const dy = wy - ent.trueCenter.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-9) {
        const ux = dx / dist;
        const uy = dy / dist;
        const arcDist = Math.hypot(ent.arcPoint.x - ent.trueCenter.x, ent.arcPoint.y - ent.trueCenter.y);
        ent.arcPoint.x = ent.trueCenter.x + ux * arcDist;
        ent.arcPoint.y = ent.trueCenter.y + uy * arcDist;
      }
      ent.overrideCenter.x = wx; ent.overrideCenter.y = wy;
      ent.refreshCaches();
    },
  });

  // 2. Arc Point Grip
  out.push({
    key: 'dimjog-arc-point', entity: ent, type: 'endpoint',
    x: ent.arcPoint.x, y: ent.arcPoint.y,
    onDrag: (wx, wy) => {
      const dx = wx - ent.trueCenter.x;
      const dy = wy - ent.trueCenter.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-9) {
        const ux = dx / dist;
        const uy = dy / dist;
        const ocDist = Math.hypot(ent.overrideCenter.x - ent.trueCenter.x, ent.overrideCenter.y - ent.trueCenter.y);
        ent.overrideCenter.x = ent.trueCenter.x + ux * ocDist;
        ent.overrideCenter.y = ent.trueCenter.y + uy * ocDist;
      }
      ent.arcPoint.x = wx; ent.arcPoint.y = wy;
      if (ent.anchorArc) ent.anchorArc = null; // Detach if manually moved
      ent.refreshCaches();
    },
  });

  // 3. Jog Point Grip
  out.push({
    key: 'dimjog-jog-point', entity: ent, type: 'midpoint',
    x: ent.jogPoint.x, y: ent.jogPoint.y,
    onDrag: (wx, wy) => {
      ent.jogPoint.x = wx; ent.jogPoint.y = wy;
      ent.refreshCaches();
    },
  });

  // 4. Text Point Grip (if supported)
  if (ent.textPoint) {
    out.push({
      key: 'dimjog-text', entity: ent, type: 'text',
      x: ent.textPoint.x, y: ent.textPoint.y,
      onDrag: (wx, wy) => {
        ent.textPoint.x = wx; ent.textPoint.y = wy;
        ent.refreshCaches();
      },
    });
  }

  const tpWorld = ent.textPoint ? { x: ent.textPoint.x, y: ent.textPoint.y } : {
    x: ent.trueCenter.x + (ent.arcPoint.x - ent.trueCenter.x) * 0.5,
    y: ent.trueCenter.y + (ent.arcPoint.y - ent.trueCenter.y) * 0.5
  };
  const radialAngle = Math.atan2(ent.arcPoint.y - ent.trueCenter.y, ent.arcPoint.x - ent.trueCenter.x);
  const rAngle = ent.textRotationOverride != null ? ent.textRotationOverride : radialAngle;
  const tHeight = ent.textHeight ?? sStyle.textHeight ?? 2.5;
  const rotDist = tHeight * 2.0;
  const rotX = tpWorld.x + rotDist * Math.cos(rAngle);
  const rotY = tpWorld.y + rotDist * Math.sin(rAngle);

  out.push({
    key: 'dimjog-rotation',
    entity: ent,
    type: 'rotation',
    x: rotX,
    y: rotY,
    onDrag: (wx, wy) => {
      ent.textRotationOverride = Math.atan2(wy - tpWorld.y, wx - tpWorld.x);
      ent.refreshCaches();
    },
  });

  return out;
}

function splineGrips(ent: any): IGrip[] {
  const out: IGrip[] = [];
  if (!Array.isArray(ent.controlPoints)) return out;

  for (let i = 0; i < ent.controlPoints.length; i++) {
    const idx = i;
    out.push({
      key: `spline-cp-${idx}`,
      entity: ent,
      type: idx === 0 || idx === ent.controlPoints.length - 1 ? 'endpoint' : 'vertex',
      x: ent.controlPoints[idx].x,
      y: ent.controlPoints[idx].y,
      onDrag: (wx, wy) => {
        ent.controlPoints[idx].x = wx;
        ent.controlPoints[idx].y = wy;
        ent.refreshCaches();
      },
    });
  }
  return out;
}

function generateEntityGrips(ent: Entity): IGrip[] {
  const e = ent as any;
  switch (e.type) {
    case 'SPLINE':    return splineGrips(e);
    case 'LINE':      return lineGrips(e);
    case 'CIRCLE':    return circleGrips(e);
    case 'ARC':       return arcGrips(e);
    case 'POLYLINE':  return polylineGrips(e);
    case 'ELLIPSE':   return ellipseGrips(e);
    case 'IMAGE':     return imageGrips(e);
    case 'TABLE':     return tableGrips(e);
    case 'HATCH':     return hatchGrips(e);
    case 'LEADER':    return leaderGrips(e);
    case 'MLEADER':   return mleaderGrips(e);
    case 'DIMENSION': 
      if ('jogPoint' in e) return joggedRadiusDimensionGrips(e);
      return dimensionGrips(e);
    case 'POINT': case 'TEXT': return pointGrips(e);
    case 'INSERT':    return insertGrips(e);
    case 'XLINE':     return xlineGrips(e);
    default: return [];
  }
}

/** Port of GripManager from 30-grip-manager.js. */
@Injectable({ providedIn: 'root' })
export class GripManagerService {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private cmds = inject(CommandStackService);
  private theme = inject(ThemeService);

  constructor() {
    this.cmds.onAfterUndoRedo = () => {
      this.clear();
      this.generate();
    };
  }

  readonly visible = signal(false);
  grips: IGrip[] = [];
  hoveredGrip: IGrip | null = null;
  activeGrip: IGrip | null = null;
  dragging = false;
  private snapshot: Record<string, unknown> | null = null;
  private selectedEntity: Entity | null = null;

  /**
   * AutoCAD-style coincident grip group.
   * At beginDrag we collect every grip that sits at the same world
   * position as the primary grip (within COINCIDENT_TOL world units).
   * updateDrag fires all of them; commitDrag / cancelDrag act on all
   * affected entities so undo is atomic.
   */
  private coincidentGrips: IGrip[] = [];
  private coincidentSnapshots: Map<Entity, Record<string, unknown>> = new Map();

  /** 
   * Multi-grip selection via drag-select.
   * Format: `${entity.id}:${grip.key}`
   */
  selectedGripIds: Set<string> = new Set();

  /** Max world-unit distance for two grips to be treated as coincident. */
  private readonly COINCIDENT_TOL = 1e-4;

  /** Last vm.version() at which the stale-grip safety scan ran in render().
   *  doc.getFileOfEntity() is O(n_entities) per grip — gating on version
   *  avoids running it every RAF frame when no entities changed. */
  private _lastGripsCheckVersion = -1;

  /** Toggle grip-mode on/off. */
  setVisible(v: boolean): void {
    if (this.visible() === v) return;
    this.visible.set(v);
    if (v) this.generate();
    else this.clear();
    this.vm.markDirty();
  }

  clear(): void {
    this.grips = [];
    this.hoveredGrip = null;
    this.activeGrip = null;
    this.dragging = false;
    this.snapshot = null;
    this.selectedEntity = null;
    this.selectedGripIds.clear();
  }

  /** Rebuild grip list from current selection. Entities on frozen/locked layers
   *  do NOT contribute grips â€” matches AutoCAD's rule that locked-layer
   *  geometry can be selected but not grip-edited. */
  generate(): void {
    const out: IGrip[] = [];
    for (const file of this.doc.files) {
      if (file.locked) continue;
      const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);
      for (const ent of file.entities) {
        if (!ent.selected || !ent.visible) continue;
        const lay = file.layers.get(ent.layer);
        if (lay && (lay.frozen || lay.locked || !lay.visible)) continue;
        const fileGrips = generateEntityGrips(ent);
        for (const g of fileGrips) {
          const s = fileVm.w2s(g.x, g.y);
          const wPt = this.vm.s2w(s.x, s.y);
          const localOnDrag = g.onDrag;
          g.x = wPt.x;
          g.y = wPt.y;
          g.onDrag = (wwx, wwy) => {
            const ss = this.vm.w2s(wwx, wwy);
            const lPt = fileVm.s2w(ss.x, ss.y);
            localOnDrag(lPt.x, lPt.y);
          };
        }
        out.push(...fileGrips);
      }
    }
    this.grips = out;
  }

  /** Find grip at screen-space coords; returns null if none within tolerance. */
  getGripAt(sx: number, sy: number): IGrip | null {
    if (this.dragging) return null; // No new grip activation during drag
    const tol = 8;
    for (const g of this.grips) {
      const s = this.vm.w2s(g.x, g.y);
      if (Math.hypot(sx - s.x, sy - s.y) <= tol) return g;
    }
    return null;
  }

  setHover(g: IGrip | null): void {
    if (this.dragging) {
      this.hoveredGrip = null;
      return;
    }
    if (g === this.hoveredGrip) return;
    this.hoveredGrip = g;
    this.vm.markDirty();
  }

  /**
   * World coord of the cursor at the first updateDrag tick of the active drag.
   * Exposed publicly so the canvas can pass it as the snap/ortho/polar anchor
   * (snap.resolve + snap.render both expect a stable pivot â€” the grip's
   * current position would drift across ticks). Read-only consumers only.
   */
  dragStartWorld: { x: number; y: number } | null = null;

  beginDrag(grip: IGrip): void {
    this.activeGrip = grip;
    this.dragging = true;
    this.selectedEntity = grip.entity;
    this.snapshot = snapshotEntity(grip.entity);
    this.dragStartWorld = null;  // captured on the first updateDrag tick

    // â”€â”€ Multi-Grip / Coincident Grip Merge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // If the clicked grip wasn't already selected, it becomes the sole selection.
    const gripId = `${grip.entity.id}:${grip.key}`;
    if (!this.selectedGripIds.has(gripId)) {
      this.selectedGripIds.clear();
      this.selectedGripIds.add(gripId);
    }

    // Collect all explicitly selected grips + any grips coincident with them.
    const tol = this.COINCIDENT_TOL;
    const allSelectedAndCoincident = new Set<IGrip>();

    // First add all selected grips from the current grip list
    for (const g of this.grips) {
      if (this.selectedGripIds.has(`${g.entity.id}:${g.key}`)) {
        allSelectedAndCoincident.add(g);
      }
    }

    // Then find coincident grips for each
    const explicitlySelected = Array.from(allSelectedAndCoincident);
    for (const eg of explicitlySelected) {
      for (const g of this.grips) {
        if (!allSelectedAndCoincident.has(g) && Math.hypot(g.x - eg.x, g.y - eg.y) <= tol) {
          allSelectedAndCoincident.add(g);
        }
      }
    }

    // Remove the primary active grip from the list so we don't process it twice
    allSelectedAndCoincident.delete(grip);
    this.coincidentGrips = Array.from(allSelectedAndCoincident);

    // Snapshot every affected entity (primary already snapshotted above).
    this.coincidentSnapshots = new Map();
    this.coincidentSnapshots.set(grip.entity, this.snapshot);
    for (const g of this.coincidentGrips) {
      if (!this.coincidentSnapshots.has(g.entity)) {
        this.coincidentSnapshots.set(g.entity, snapshotEntity(g.entity));
      }
    }

    // ── Incremental preview: hide the affected entities from the static-layer
    // cache so the drag doesn't force a full-scene redraw each frame. They are
    // re-drawn live on the dynamic overlay by the canvas (see getDraggedEntities).
    // The static cache re-renders ONCE here (excluding them), then only blits
    // until commit — matching the move/rotate/scale ghost-preview architecture.
    this.vm.previewHiddenIds = new Set(
      Array.from(this.coincidentSnapshots.keys()).map((e: any) => e.id),
    );
    this.vm.markContentDirty();
  }

  updateDrag(wx: number, wy: number): void {
    if (!this.dragging || !this.activeGrip || !this.snapshot) return;
    // Capture the world cursor at the first tick — grip closures read this
    // through the module-level dragContext (see `IDragContext`).
    if (!this.dragStartWorld) this.dragStartWorld = { x: wx, y: wy };
    // Publish drag-start state to the module singleton so closures can
    // read it. We set it BEFORE invoking onDrag and clear it AFTER, so no
    // stale context leaks into other code paths.
    currentDragContext = {
      snapshot: this.snapshot,
      startWx: this.dragStartWorld.x,
      startWy: this.dragStartWorld.y,
    };
    try {
      this.activeGrip.onDrag(wx, wy);
    } finally {
      currentDragContext = null;
    }

    // Fire all coincident grips from other entities, each with its own
    // entity snapshot as the drag context.
    for (const cg of this.coincidentGrips) {
      const cgSnap = this.coincidentSnapshots.get(cg.entity);
      if (!cgSnap) continue;
      currentDragContext = {
        snapshot: cgSnap,
        startWx: this.dragStartWorld!.x,
        startWy: this.dragStartWorld!.y,
      };
      try {
        cg.onDrag(wx, wy);
      } finally {
        currentDragContext = null;
      }
    }

    // Refresh grip positions so they move with geometry. Closures are
    // stateless so it's safe to recreate them every tick.
    const key = this.activeGrip.key;
    const ent = this.activeGrip.entity;
    this.generate();
    const found = this.grips.find((g) => g.entity === ent && g.key === key);
    if (found) this.activeGrip = found;
    // Re-resolve coincident grips from the fresh grip list by their exact identity,
    // NOT by spatial distance. If we use distance here, dragging a grip across the
    // screen will cause it to magnetically 'grab' other nodes it passes over!
    if (this.activeGrip) {
      const newCoincident: IGrip[] = [];
      for (const cg of this.coincidentGrips) {
        const foundCg = this.grips.find((g) => g.entity === cg.entity && g.key === cg.key);
        if (foundCg) newCoincident.push(foundCg);
      }
      this.coincidentGrips = newCoincident;
    }
    // The dragged entities are excluded from the static cache (previewHiddenIds
    // set in beginDrag) and painted live on the dynamic overlay every frame,
    // so we only need a view-dirty flag here — NOT markContentDirty(), which
    // would invalidate the whole static cache and re-render every entity.
    this.vm.markDirty();
  }

  commitDrag(): void {
    if (!this.dragging || !this.selectedEntity || !this.snapshot) {
      this.vm.previewHiddenIds = null;
      this.dragging = false;
      this.activeGrip = null;
      this.dragStartWorld = null;
      this.coincidentGrips = [];
      this.coincidentSnapshots = new Map();
      return;
    }
    // Commit a ModifyGeometryCmd for every affected entity (primary + coincident).
    for (const [entity, before] of this.coincidentSnapshots) {
      const after = snapshotEntity(entity);
      const cmd = new ModifyGeometryCmd(entity, before, after, { markDirty: () => this.vm.markContentDirty() });
      // Don't execute â€” geometry is already live. Just record for undo.
      this.cmds.record(cmd);
    }
    // Stop hiding the dragged entities and fold their committed geometry back
    // into the static-layer cache (markContentDirty bumps the content epoch).
    this.vm.previewHiddenIds = null;
    this.dragging = false;
    this.activeGrip = null;
    this.snapshot = null;
    this.dragStartWorld = null;
    this.coincidentGrips = [];
    this.coincidentSnapshots = new Map();
    this.vm.markContentDirty();
  }

  cancelDrag(): void {
    if (!this.dragging || !this.selectedEntity || !this.snapshot) {
      this.vm.previewHiddenIds = null;
      this.dragging = false;
      this.activeGrip = null;
      this.dragStartWorld = null;
      this.coincidentGrips = [];
      this.coincidentSnapshots = new Map();
      return;
    }
    // Restore every affected entity from its snapshot.
    for (const [entity, snap] of this.coincidentSnapshots) {
      for (const k in snap) (entity as any)[k] = snap[k];
      entity.refreshCaches();
    }
    // Stop hiding the dragged entities — they're back in their pre-drag state
    // and must render through the static cache again.
    this.vm.previewHiddenIds = null;
    this.generate();
    this.dragging = false;
    this.activeGrip = null;
    this.snapshot = null;
    this.dragStartWorld = null;
    this.coincidentGrips = [];
    this.coincidentSnapshots = new Map();
    this.vm.markContentDirty();
  }

  render(ctx: CanvasRenderingContext2D): void {
    // -- Safety Check: Remove stale grips before rendering --
    // OPTIMISATION: doc.getFileOfEntity() is entities.includes() which is O(n_entities)
    // per grip. Gated on vm.version() so it only runs when content epoch changes
    // (entity removed / deselected), not on every RAF frame.
    if (this.grips.length > 0) {
      const currentVersion = this.vm.version();
      if (currentVersion !== this._lastGripsCheckVersion) {
        this._lastGripsCheckVersion = currentVersion;
        let hasStale = false;
        for (const g of this.grips) {
          if (!g.entity || !g.entity.selected || !this.doc.getFileOfEntity(g.entity)) {
            hasStale = true;
            break;
          }
        }
        if (hasStale) {
          this.grips = this.grips.filter(g => g.entity && g.entity.selected && !!this.doc.getFileOfEntity(g.entity));

          // If we cleared the active grip, cancel drag immediately
          if (this.activeGrip && !this.grips.includes(this.activeGrip)) {
            this.dragging = false;
            this.activeGrip = null;
            this.snapshot = null;
            this.dragStartWorld = null;
            this.coincidentGrips = [];
            this.coincidentSnapshots = new Map();
          }
        }
      }
    }

    if (!this.visible() || !this.grips.length) return;

    // â”€â”€â”€ Stretch guides for the active grip (drawn BEHIND the grip dots) â”€â”€
    // Each grip's optional `renderGuides` callback paints dashed extension
    // lines, alignment crosses, or any other stretch-preview hints. We only
    // paint the guides for the grip currently being dragged so the canvas
    // doesn't flood with overlays.
    if (this.dragging && this.activeGrip?.renderGuides) {
      ctx.save();
      try {
        this.activeGrip.renderGuides(ctx, this.vm);
      } catch (err) {
        // Guide painter exceptions must not break the render loop.
        // eslint-disable-next-line no-console
        console.error('Grip guide render error:', err);
      }
      ctx.restore();
    }

    // â”€â”€â”€ Grip handles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const SIZE = 8;
    const HALF = SIZE / 2;
    const palette = this.theme.canvas();
    ctx.save();
    for (const g of this.grips) {
      const s = this.vm.w2s(g.x, g.y);
      const isSelected = this.selectedGripIds.has(`${g.entity.id}:${g.key}`);
      
      let styleStroke: string;
      let styleFill: string | null = null;
      let lineWidth = 1.5;
      
      if (g === this.activeGrip || isSelected) {
        styleFill = palette.gripActive;
        styleStroke = palette.gripOutline;
      } else if (g === this.hoveredGrip) {
        styleFill = palette.gripHover;
        styleStroke = palette.gripOutline;
      } else {
        styleStroke = palette.gripIdle;
      }

      ctx.strokeStyle = styleStroke;
      ctx.lineWidth = lineWidth;
      if (styleFill) ctx.fillStyle = styleFill;

      if (g.type === 'rotation') {
        // Render a curved rotation arrow centered at s.x, s.y
        const r = SIZE * 0.75;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, -0.1, 1.4 * Math.PI);
        ctx.stroke();

        // Arrow head at 1.5 * Math.PI
        const ax = s.x;
        const ay = s.y - r;
        ctx.fillStyle = styleFill || styleStroke;
        ctx.beginPath();
        ctx.moveTo(ax - 2.5, ay - 3);
        ctx.lineTo(ax + 3, ay);
        ctx.lineTo(ax - 2.5, ay + 3);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.rect(s.x - HALF, s.y - HALF, SIZE, SIZE);
        if (styleFill) {
          ctx.fill();
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Dynamic-Input state shown under the cursor while a grip is being dragged.
   * Returns null when no drag is active. Pushed into DynamicInputService by
   * the canvas's syncDynamicInput so the same overlay used by drawing tools
   * also serves grip-stretch readouts (Principle 1 â€” one DI engine for all).
   *
   * Fields:
   *   - Dist  : world-units distance from drag-start to current cursor
   *   - Angle : degrees CCW (atan2), normalized
   *   - Î”X    : world-units cursor delta X
   *   - Î”Y    : world-units cursor delta Y
   *
   * The "current cursor" position is whatever was passed to the last
   * updateDrag() call â€” i.e., the post-snap world point â€” so the readout
   * reflects what the geometry will commit to, not the raw cursor.
   */
  /** Entities currently being grip-dragged (primary + coincident). Empty when
   *  no drag is active. The canvas paints these live on the dynamic overlay
   *  while they're hidden from the static-layer cache. */
  getDraggedEntities(): import('../models/entity.model').Entity[] {
    if (!this.dragging) return [];
    return Array.from(this.coincidentSnapshots.keys());
  }

  getDragDynamicState(): import('../models/tool.interface').IDynamicInputState | null {
    if (!this.dragging || !this.activeGrip || !this.dragStartWorld) return null;
    const ent = this.activeGrip.entity;
    const fmt = (n: number): string => {
      if (!Number.isFinite(n)) return '0';
      const s = n.toFixed(3);
      return s.replace(/\.?0+$/, '') || '0';
    };
    if (this.activeGrip.type === 'rotation') {
      const e = ent as any;
      let rotationVal = 0;
      if (e.type === 'TEXT') {
        rotationVal = (e['rotation'] || 0) * 180 / Math.PI;
      } else if (e.type === 'INSERT') {
        rotationVal = e.rotation || 0;
      } else if ('textRotationOverride' in e) {
        if (e['textRotationOverride'] != null) {
          rotationVal = e['textRotationOverride'] * 180 / Math.PI;
        } else {
          // Compute default angle
          if (e.type === 'DIMENSION') {
            if (e['jogPoint']) {
              rotationVal = Math.atan2(e['arcPoint'].y - e['trueCenter'].y, e['arcPoint'].x - e['trueCenter'].x) * 180 / Math.PI;
            } else {
              rotationVal = Math.atan2(e['p2'].y - e['p1'].y, e['p2'].x - e['p1'].x) * 180 / Math.PI;
            }
          } else {
            rotationVal = 0;
          }
        }
      }
      // Normalize to [0, 360)
      rotationVal = ((rotationVal % 360) + 360) % 360;
      return {
        wx: this.activeGrip.x,
        wy: this.activeGrip.y,
        primaryFieldKey: 'rotation',
        fields: [
          { key: 'rotation', label: 'Rotation', liveValue: rotationVal.toFixed(1), suffix: 'Â°', width: 140 },
        ],
      };
    }
    const dx = this.activeGrip.x - this.dragStartWorld.x;
    const dy = this.activeGrip.y - this.dragStartWorld.y;
    const dist = Math.hypot(dx, dy);
    const angDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    return {
      wx: this.activeGrip.x,
      wy: this.activeGrip.y,
      primaryFieldKey: 'dist',
      fields: [
        { key: 'dist', label: 'Dist', liveValue: fmt(dist), width: 70 },
        { key: 'angle', label: 'Angle', liveValue: fmt(angDeg), suffix: 'Â°', width: 60 },
        { key: 'dx', label: 'Î”X', liveValue: fmt(dx), width: 70 },
        { key: 'dy', label: 'Î”Y', liveValue: fmt(dy), width: 70 },
      ],
    };
  }
}
