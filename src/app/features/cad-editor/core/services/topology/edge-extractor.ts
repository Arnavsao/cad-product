import type { Entity, IPoint, IBBox } from '../../models/entity.model';
import type { IEdge, IEdgeSource, EdgeKind } from './types';

/**
 * Convert an entity into the linear edges that participate in the planar
 * arrangement.
 *
 * Each produced IEdge records, via its `source` field, exactly which part of
 * which entity it came from — including the natural-parameter sub-range
 * `[t0, t1]` over the parent curve. After the planar graph is built and
 * intersected (and edges split at crossings), these sub-ranges narrow
 * accordingly, and the surviving slivers can be lifted directly into
 * `IEntityAnchor` records for associative hatch boundaries (Phase 3).
 *
 * Phase 2 deliberately tessellates curves into straight-line edges:
 *
 *   - The current production behavior tessellates arcs at 32–64 segments;
 *     parity with that requires producing equivalent linear edges.
 *   - The line-line intersection in the next module is closed-form and
 *     well-tested; jumping straight to curve-curve intersection would mix
 *     two correctness risks into one diff.
 *
 * Phase 2.5 replaces this with curve-native edges whose `kind` stays ARC /
 * ELLIPSE_ARC / SPLINE. When that lands, the only file that changes is this
 * one — the rest of the pipeline already carries the kind through.
 *
 * The chosen tessellation densities match the old `region-topology.ts`
 * (`ARC_SEGS = 32`, doubled for full circles / ellipses) so any face that
 * the old code detected is recoverable by the new code.
 */

const SUPPORTED_TYPES = new Set(['LINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE']);
const ARC_SEGS = 32;

let _edgeIdCounter = 0;
function nextEdgeId(): number {
  return _edgeIdCounter++;
}

/** Reset the global edge id counter. Call at the start of each graph build
 *  so ids are predictable and graph-local. */
export function resetEdgeIds(): void {
  _edgeIdCounter = 0;
}

export function isSupportedSource(e: Entity): boolean {
  return SUPPORTED_TYPES.has((e as any).type);
}

/**
 * Top-level dispatch. Returns an empty array for unsupported types — callers
 * should filter via `isSupportedSource` before invoking if they want to
 * fail loudly instead.
 */
export function extractEdges(e: Entity): IEdge[] {
  switch ((e as any).type) {
    case 'LINE':     return extractLine(e as any);
    case 'POLYLINE': return extractPolyline(e as any);
    case 'CIRCLE':   return extractCircle(e as any);
    case 'ARC':      return extractArc(e as any);
    case 'ELLIPSE':  return extractEllipse(e as any);
    default:         return [];
  }
}

/* -------------------------------------------------------------------------- */
/*  Per-entity extractors                                                      */
/* -------------------------------------------------------------------------- */

function extractLine(e: { id: number; x1: number; y1: number; x2: number; y2: number }): IEdge[] {
  const p0 = { x: e.x1, y: e.y1 };
  const p1 = { x: e.x2, y: e.y2 };
  return [makeLinearEdge('LINE', p0, p1, { entityId: e.id, subIndex: 0, t0: 0, t1: 1 })];
}

function extractPolyline(e: { id: number; pts: IPoint[]; closed?: boolean }): IEdge[] {
  const pts = e.pts ?? [];
  const out: IEdge[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push(
      makeLinearEdge('POLYLINE_SEG', pts[i], pts[i + 1], {
        entityId: e.id,
        subIndex: i,
        t0: 0,
        t1: 1,
      }),
    );
  }
  if (e.closed && pts.length > 2) {
    out.push(
      makeLinearEdge('POLYLINE_SEG', pts[pts.length - 1], pts[0], {
        entityId: e.id,
        subIndex: pts.length - 1,
        t0: 0,
        t1: 1,
      }),
    );
  }
  return out;
}

function extractCircle(e: { id: number; cx: number; cy: number; r: number }): IEdge[] {
  const total = ARC_SEGS * 2;
  return tessellate(total, (i) => {
    const t = (i / total) * Math.PI * 2;
    return { x: e.cx + e.r * Math.cos(t), y: e.cy + e.r * Math.sin(t) };
  }, e.id, /*subIndex*/ 0, /*kind*/ 'CIRCLE');
}

function extractArc(e: {
  id: number;
  cx: number; cy: number; r: number;
  startAngle: number; endAngle: number; ccw?: boolean;
}): IEdge[] {
  const sa = (e.startAngle * Math.PI) / 180;
  const ea = (e.endAngle * Math.PI) / 180;
  let sweep = ea - sa;
  const ccw = e.ccw !== false;
  if (ccw) {
    if (sweep <= 0) sweep += Math.PI * 2;
  } else {
    if (sweep >= 0) sweep -= Math.PI * 2;
  }
  const segs = Math.max(8, Math.ceil((ARC_SEGS * Math.abs(sweep)) / (Math.PI * 2)));
  return tessellate(segs, (i) => {
    const t = sa + sweep * (i / segs);
    return { x: e.cx + e.r * Math.cos(t), y: e.cy + e.r * Math.sin(t) };
  }, e.id, 0, 'ARC');
}

function extractEllipse(e: {
  id: number;
  cx: number; cy: number;
  rx: number; ry: number;
  rotation?: number;
}): IEdge[] {
  const rot = e.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const total = ARC_SEGS * 2;
  return tessellate(total, (i) => {
    const t = (i / total) * Math.PI * 2;
    const lx = e.rx * Math.cos(t);
    const ly = e.ry * Math.sin(t);
    return { x: e.cx + lx * cos - ly * sin, y: e.cy + lx * sin + ly * cos };
  }, e.id, 0, 'ELLIPSE_ARC');
}

/* -------------------------------------------------------------------------- */
/*  Linear-edge factory                                                        */
/* -------------------------------------------------------------------------- */

function makeLinearEdge(kind: EdgeKind, p0: IPoint, p1: IPoint, source: IEdgeSource): IEdge {
  return {
    id: nextEdgeId(),
    kind,
    source,
    p0,
    p1,
    bbox: linearBBox(p0, p1),
  };
}

function linearBBox(p0: IPoint, p1: IPoint): IBBox {
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  return { x, y, w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) };
}

/**
 * Common tessellation core for curves. `sample(i)` returns the i-th point on
 * the curve; the returned edges connect consecutive samples. Source records
 * carry the t-range over the parent curve so Phase 3 anchors line up.
 */
function tessellate(
  segs: number,
  sample: (i: number) => IPoint,
  entityId: number,
  subIndex: number,
  curveKind: EdgeKind,
): IEdge[] {
  const out: IEdge[] = [];
  let prev = sample(0);
  for (let i = 1; i <= segs; i++) {
    const next = sample(i);
    out.push({
      id: nextEdgeId(),
      // Phase 2 tessellates → POLYLINE_SEG (so intersection stays linear);
      // the *intended* curve kind is stashed on `source.blockPath` slot via
      // a future field. For now we encode it implicitly by not exposing it
      // on the edge — the source.entityId is enough to recover the curve in
      // Phase 3 anchor resolution.
      kind: 'POLYLINE_SEG',
      source: {
        entityId,
        subIndex,
        t0: (i - 1) / segs,
        t1: i / segs,
      },
      p0: prev,
      p1: next,
      bbox: linearBBox(prev, next),
    });
    prev = next;
  }
  // Mark unused to silence noUnusedParameters when curveKind is reserved
  // for Phase 2.5 use. Keeping it in the signature documents intent.
  void curveKind;
  return out;
}
