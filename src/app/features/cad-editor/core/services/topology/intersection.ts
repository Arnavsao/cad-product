import type { IPoint } from '../../models/entity.model';
import type { IEdge } from './types';
import { EPS_GEOM } from './tolerance';

/**
 * Edge-edge intersection.
 *
 * Phase 2 supports LINE↔LINE only (and equivalently any pair where both edges
 * tessellated to POLYLINE_SEG, which in Phase 2 means every pair). The
 * function still dispatches by edge kind so Phase 2.5 can drop curve-curve
 * routines in without changing the call site in `planar-graph.ts`.
 *
 * Returned points are intersections in world coordinates. The `t` parameters
 * are positions along each edge in [0, 1] — used by the planar graph builder
 * to split edges in place and update `IEdgeSource.t0/t1` accordingly.
 */

export interface IIntersection {
  point: IPoint;
  /** Parameter along `a` in [0, 1]. */
  tA: number;
  /** Parameter along `b` in [0, 1]. */
  tB: number;
}

/**
 * Top-level dispatch. Both kinds linear → closed-form line/line; otherwise
 * delegates to (currently unimplemented) curve routines. Returns an empty
 * array when no intersection exists, or up to two points for cases that
 * generically have two roots (line/circle, circle/circle — Phase 2.5).
 */
export function intersectEdges(a: IEdge, b: IEdge): IIntersection[] {
  // Cheap bbox cull — early-out for the common non-crossing case.
  if (!bboxesOverlap(a, b)) return [];

  // Phase 2: every edge is linear, so we can short-circuit straight to the
  // line/line solver regardless of nominal kind.
  return intersectLineLine(a, b);
}

/**
 * Closed-form line-segment / line-segment intersection.
 *
 * Solves
 *      A + tA·(B − A)  =  C + tB·(D − C)
 * for (tA, tB) and returns the crossing if both lie in (0, 1) — strictly
 * interior, so coincident endpoints do not register as intersections (the
 * vertex coalesce in the planar graph handles those).
 *
 * Determinant noise floor is `EPS_GEOM`; below that the two lines are
 * declared parallel and no intersection is reported (no special handling of
 * collinear-overlapping segments — that case is handled by the topology
 * pipeline as a degenerate that gets coalesced at vertex-build time).
 */
function intersectLineLine(a: IEdge, b: IEdge): IIntersection[] {
  const x1 = a.p0.x, y1 = a.p0.y, x2 = a.p1.x, y2 = a.p1.y;
  const x3 = b.p0.x, y3 = b.p0.y, x4 = b.p1.x, y4 = b.p1.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < EPS_GEOM) return [];

  const tA = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const tB = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  if (tA <= EPS_GEOM || tA >= 1 - EPS_GEOM) return [];
  if (tB <= EPS_GEOM || tB >= 1 - EPS_GEOM) return [];

  return [{
    point: { x: x1 + tA * (x2 - x1), y: y1 + tA * (y2 - y1) },
    tA,
    tB,
  }];
}

function bboxesOverlap(a: IEdge, b: IEdge): boolean {
  if (a.bbox.x + a.bbox.w < b.bbox.x - EPS_GEOM) return false;
  if (a.bbox.x > b.bbox.x + b.bbox.w + EPS_GEOM) return false;
  if (a.bbox.y + a.bbox.h < b.bbox.y - EPS_GEOM) return false;
  if (a.bbox.y > b.bbox.y + b.bbox.h + EPS_GEOM) return false;
  return true;
}
