import type { IPoint } from './entity.model';
import type { IEntityAnchor } from './entity-anchor.model';
import type { RegionResult } from '../utils/region-topology';

/**
 * The boundary spec that an associative hatch carries.
 *
 * This is the Phase 3 successor to `HatchEntity.boundaries` (raw edge loops)
 * + `HatchEntity.boundaryEntIds` (flat list of contributing ids). Where the
 * old representation chose between "fully baked geometry" and "just a list of
 * entity ids, no traversal info," this spec is BOTH descriptive enough to
 * regenerate the loop after a boundary edit AND self-describing enough to
 * render without the host entities when they go away (`disassociate` →
 * freeze to `IFrozenEdge`s).
 *
 * The spec is the contract between:
 *   - hatch-tool / DXF import (produce)
 *   - HatchEntity.draw / bbox / properties (consume)
 *   - the dependency graph and regen scheduler (watch + rebuild)
 *
 * Existing legacy fields on HatchEntity remain populated alongside this spec
 * for one release. New consumers should read `boundarySpec` and ignore the
 * legacy fields when the spec is present.
 */
export interface IHatchBoundarySpec {
  /** True iff this hatch tracks its hosts via anchors and regenerates on
   *  host edits. When false, every loop has been frozen to `IFrozenEdge[]`. */
  associative: boolean;

  /** `loops[0]` is the outer boundary. Subsequent entries are direct islands. */
  loops: IBoundaryLoop[];

  /** Flat union of every entity id referenced across all loops' anchors.
   *  Empty when fully frozen. The dependency graph indexes hatches by this. */
  contributingEntityIds: number[];

  /** Original click that produced this spec — used as the reseed point when
   *  a boundary entity is deleted and the hatch tries to re-detect its
   *  region from whatever geometry remains. */
  seedPoint: IPoint;

  /** Topology tolerance active when the spec was produced. Stored so a
   *  later regen uses the same tolerance the user picked, not whatever the
   *  global default became. */
  tolerance: number;

  /** Monotonic counter — bumped by every regen. Lets consumers detect
   *  "spec changed shape since last frame" with O(1) revision compare,
   *  matching the pattern Entity.revision uses. */
  revision: number;
}

/**
 * A single closed loop of the hatch boundary. Either anchored (tracks hosts)
 * or frozen (carries baked geometry); never both. The `role` tag identifies
 * outer vs. island for DXF export and renderer fill ordering.
 *
 * Invariant: when `associative` on the parent spec is true, every loop has
 * `anchors` set and `frozen` unset. When `associative` is false, every loop
 * has `frozen` set and `anchors` unset. Mixed mode is not permitted — a
 * partial disassociate freezes ALL loops, so the spec stays consistent.
 */
export interface IBoundaryLoop {
  role: 'outer' | 'island';
  anchors?: IEntityAnchor[];
  frozen?: IFrozenEdge[];
  /** Cached signed area at last regen (positive = CCW outer / inner ring;
   *  negative = degenerate or backwards-traversed, which the regen
   *  scheduler will repair). Diagnostic only — not load-bearing. */
  signedArea: number;
  /** Stable signature over (entity id, t-range, reversed) tuples — used
   *  by the regen scheduler to detect "same loop, different geometry"
   *  vs. "completely different topology" without diffing edge-by-edge. */
  signature: string;
}

/**
 * A baked, host-independent edge. Stored in `IBoundaryLoop.frozen` after a
 * hatch is disassociated — either explicitly by the user or implicitly
 * because all its host entities were deleted.
 *
 * The `kind` field mirrors the topology pipeline's `EdgeKind` so a frozen
 * loop renders through the same Path2D code-paths as a live curve.
 */
export interface IFrozenEdge {
  kind: 'LINE' | 'ARC' | 'ELLIPSE_ARC' | 'SPLINE' | 'POLYLINE_SEG';
  p0: IPoint;
  p1: IPoint;
  /** Optional curve fields — populated per-kind. */
  center?: IPoint;
  r?: number;
  rx?: number;
  ry?: number;
  rot?: number;
  a0?: number;
  a1?: number;
  ccw?: boolean;
}

/**
 * Build the signature string for a loop. Stable across runs and processes
 * for the same boundary topology — two hatches that walk the same edges
 * in the same direction will produce identical signatures.
 *
 * Format: `entityId:subIndex:t0:t1:reversed` joined by `|`, with anchor
 * arrays sorted lexicographically by entityId then subIndex then t0 first.
 * The sort makes the signature invariant to traversal start point — useful
 * when the regen scheduler is deciding whether a regenerated loop is "the
 * same loop, edited" or "a new loop entirely."
 */
/**
 * Build a non-associative (frozen) boundary spec from a topology result.
 *
 * Shared between `hatch-tool.ts` (placement) and `HatchRegenScheduler`
 * (re-detection after host-entity deletion / boundary change).
 */
export function buildFrozenSpec(
  polygon: IPoint[],
  islands: IPoint[][],
  entIds: number[],
  seedPoint: IPoint,
  tolerance = 1e-4,
  baseRevision = 0,
): IHatchBoundarySpec {
  const buildLoop = (pts: IPoint[], role: 'outer' | 'island'): IBoundaryLoop => {
    const frozen: IFrozenEdge[] = pts.map((p, i) => ({
      kind: 'POLYLINE_SEG' as const,
      p0: { x: p.x, y: p.y },
      p1: { x: pts[(i + 1) % pts.length].x, y: pts[(i + 1) % pts.length].y },
    }));
    const loop: IBoundaryLoop = { role, frozen, signedArea: 0, signature: '' };
    loop.signature = loopSignature(loop);
    return loop;
  };
  return {
    associative: false,
    loops: [buildLoop(polygon, 'outer'), ...islands.map((isl) => buildLoop(isl, 'island'))],
    contributingEntityIds: [...entIds],
    seedPoint: { x: seedPoint.x, y: seedPoint.y },
    tolerance,
    revision: baseRevision,
  };
}

/** Overload accepting a `RegionResult` directly. */
export function buildFrozenSpecFromResult(
  result: RegionResult,
  seedPoint: IPoint,
  tolerance = 1e-4,
  baseRevision = 0,
): IHatchBoundarySpec {
  return buildFrozenSpec(result.polygon, result.islands, result.entIds, seedPoint, tolerance, baseRevision);
}

/**
 * Build a non-associative (frozen) boundary spec from pre-computed frozen
 * loops. Unlike `buildFrozenSpec` (which only accepts flat point polygons and
 * emits straight POLYLINE_SEG edges), this preserves true curve edges — ARC /
 * ELLIPSE_ARC / SPLINE — so a hatch whose boundary is a circle, arc, or ellipse
 * renders as a smooth curve rather than a chain of tiny line segments.
 */
export function buildFrozenSpecFromFrozenLoops(
  outer: IFrozenEdge[],
  islands: IFrozenEdge[][],
  entIds: number[],
  seedPoint: IPoint,
  tolerance = 1e-4,
  baseRevision = 0,
): IHatchBoundarySpec {
  const mk = (frozen: IFrozenEdge[], role: 'outer' | 'island'): IBoundaryLoop => {
    const loop: IBoundaryLoop = { role, frozen, signedArea: 0, signature: '' };
    loop.signature = loopSignature(loop);
    return loop;
  };
  return {
    associative: false,
    loops: [mk(outer, 'outer'), ...islands.map((isl) => mk(isl, 'island'))],
    contributingEntityIds: [...entIds],
    seedPoint: { x: seedPoint.x, y: seedPoint.y },
    tolerance,
    revision: baseRevision,
  };
}

/** Sample a world-space circular arc into points (both ends inclusive). */
function sampleArcPoints(center: IPoint, r: number, a0: number, a1: number, ccw: boolean, segments: number): IPoint[] {
  let sweep = a1 - a0;
  if (ccw && sweep < 0) sweep += Math.PI * 2;
  if (!ccw && sweep > 0) sweep -= Math.PI * 2;
  if (Math.abs(sweep) < 1e-9) sweep = Math.PI * 2 * (ccw ? 1 : -1);
  const n = Math.max(2, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * segments));
  const out: IPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + sweep * (i / n);
    out.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return out;
}

/** Sample a world-space elliptic arc into points (both ends inclusive). */
function sampleEllipsePoints(center: IPoint, rx: number, ry: number, rot: number, a0: number, a1: number, ccw: boolean, segments: number): IPoint[] {
  let sweep = a1 - a0;
  if (ccw && sweep < 0) sweep += Math.PI * 2;
  if (!ccw && sweep > 0) sweep -= Math.PI * 2;
  if (Math.abs(sweep) < 1e-9) sweep = Math.PI * 2 * (ccw ? 1 : -1);
  const n = Math.max(2, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * segments));
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const out: IPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + sweep * (i / n);
    const lx = rx * Math.cos(a), ly = ry * Math.sin(a);
    out.push({ x: center.x + lx * cos - ly * sin, y: center.y + lx * sin + ly * cos });
  }
  return out;
}

/** Minimal view-model contract needed to trace a frozen loop onto a canvas path. */
export interface IFrozenTraceVm {
  w2s(x: number, y: number): { x: number; y: number };
  scale: number;
}

/**
 * Trace a frozen boundary loop into a screen-space `Path2D`, emitting real
 * `arc()` / `ellipse()` calls for curved edges so they stay smooth at any zoom
 * instead of degrading into visible line segments.
 *
 * The canvas Y-axis points down while world Y points up, so angles and the
 * rotation are negated and the sweep direction (`anticlockwise`) uses the
 * edge's stored `ccw` flag — matching the convention used elsewhere for
 * rendering ARC / ELLIPSE entities.
 */
export function traceFrozenLoopToPath(path: Path2D, frozen: IFrozenEdge[], vm: IFrozenTraceVm): void {
  if (!frozen.length) return;
  const s0 = vm.w2s(frozen[0].p0.x, frozen[0].p0.y);
  path.moveTo(s0.x, s0.y);
  for (const edge of frozen) {
    if (edge.kind === 'ARC' && edge.center && edge.r != null && edge.a0 != null && edge.a1 != null) {
      const c = vm.w2s(edge.center.x, edge.center.y);
      path.arc(c.x, c.y, edge.r * vm.scale, -edge.a0, -edge.a1, edge.ccw !== false);
    } else if (edge.kind === 'ELLIPSE_ARC' && edge.center && edge.rx != null && edge.ry != null) {
      const c = vm.w2s(edge.center.x, edge.center.y);
      path.ellipse(c.x, c.y, edge.rx * vm.scale, edge.ry * vm.scale, -(edge.rot ?? 0), -(edge.a0 ?? 0), -(edge.a1 ?? Math.PI * 2), edge.ccw !== false);
    } else {
      const s1 = vm.w2s(edge.p1.x, edge.p1.y);
      path.lineTo(s1.x, s1.y);
    }
  }
}

/**
 * Flatten a frozen boundary loop into world-space polygon points, sampling
 * curved edges. Used for island-containment tests, bbox computation, hit
 * testing, and PDF tessellation — anywhere a straight polygon is needed.
 */
export function frozenLoopToPolygon(frozen: IFrozenEdge[], segments = 24): IPoint[] {
  const pts: IPoint[] = [];
  for (const edge of frozen) {
    if (edge.kind === 'ARC' && edge.center && edge.r != null && edge.a0 != null && edge.a1 != null) {
      const sp = sampleArcPoints(edge.center, edge.r, edge.a0, edge.a1, edge.ccw !== false, segments);
      for (let k = 0; k < sp.length - 1; k++) pts.push(sp[k]);
    } else if (edge.kind === 'ELLIPSE_ARC' && edge.center && edge.rx != null && edge.ry != null) {
      const sp = sampleEllipsePoints(edge.center, edge.rx, edge.ry, edge.rot ?? 0, edge.a0 ?? 0, edge.a1 ?? Math.PI * 2, edge.ccw !== false, segments);
      for (let k = 0; k < sp.length - 1; k++) pts.push(sp[k]);
    } else {
      pts.push(edge.p0);
    }
  }
  return pts;
}

/**
 * Convert a normalized DXF hatch boundary loop (array of edge objects produced
 * by the DXF hatch handler) into curve-preserving `IFrozenEdge`s. LINE / ARC /
 * ELLIPSE edges keep their exact geometry; polyline / spline vertex runs become
 * straight `POLYLINE_SEG` edges (splines are already tessellated on import).
 */
export function dxfEdgeLoopToFrozen(edges: any[]): IFrozenEdge[] {
  const frozen: IFrozenEdge[] = [];
  for (const edge of edges) {
    if (!edge) continue;
    if (edge.type === 'ARC' && edge.center && typeof edge.radius === 'number') {
      const ccw = edge.isCcw !== false;
      // AutoCAD stores a clockwise edge's angles mirrored (negated); taken at
      // face value a 60° sliver sweeps the other 300° and fills the drawing.
      const a0 = ccw ? (edge.startAngle ?? 0) : -(edge.startAngle ?? 0);
      const a1 = ccw ? (edge.endAngle ?? Math.PI * 2) : -(edge.endAngle ?? Math.PI * 2);
      frozen.push({
        kind: 'ARC',
        p0: { x: edge.center.x + edge.radius * Math.cos(a0), y: edge.center.y + edge.radius * Math.sin(a0) },
        p1: { x: edge.center.x + edge.radius * Math.cos(a1), y: edge.center.y + edge.radius * Math.sin(a1) },
        center: { x: edge.center.x, y: edge.center.y },
        r: edge.radius, a0, a1, ccw,
      });
    } else if (edge.type === 'ELLIPSE' && edge.center && (edge.majorAxisEndPoint || edge.majorAxis)) {
      const ma = edge.majorAxisEndPoint ?? edge.majorAxis;
      const rx = Math.hypot(ma.x, ma.y);
      const ry = rx * (edge.axisRatio ?? 1);
      const rot = Math.atan2(ma.y, ma.x);
      const ccw = edge.isCcw !== false;
      // Hatch ellipse edges store *true* angles measured from the major axis,
      // not the parametric angles the ellipse equation wants — and, as with
      // arcs, a clockwise edge's angles arrive mirrored. Convert both here so
      // `at()` and the renderers can treat a0/a1 as parameters.
      const toParam = (trueAngle: number) => Math.atan2(rx * Math.sin(trueAngle), ry * Math.cos(trueAngle));
      const sgn = ccw ? 1 : -1;
      const t0 = edge.startAngle ?? 0;
      const t1 = edge.endAngle ?? Math.PI * 2;
      const a0 = toParam(sgn * t0);
      // A full ellipse (0 → 360) would collapse to a zero sweep through atan2;
      // keep it whole.
      const a1 = Math.abs(t1 - t0) >= Math.PI * 2 - 1e-9 ? a0 + sgn * Math.PI * 2 : toParam(sgn * t1);
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const at = (a: number) => {
        const lx = rx * Math.cos(a), ly = ry * Math.sin(a);
        return { x: edge.center.x + lx * cos - ly * sin, y: edge.center.y + lx * sin + ly * cos };
      };
      frozen.push({ kind: 'ELLIPSE_ARC', p0: at(a0), p1: at(a1), center: { x: edge.center.x, y: edge.center.y }, rx, ry, rot, a0, a1, ccw });
    } else if (edge.start && edge.end) {
      frozen.push({ kind: 'LINE', p0: { x: edge.start.x, y: edge.start.y }, p1: { x: edge.end.x, y: edge.end.y } });
    } else if (Array.isArray(edge.vertices) && edge.vertices.length >= 2) {
      const vs = edge.vertices;
      for (let i = 0; i < vs.length; i++) {
        const v0 = vs[i];
        const v1 = vs[(i + 1) % vs.length];
        frozen.push({ kind: 'POLYLINE_SEG', p0: { x: v0.x, y: v0.y }, p1: { x: v1.x, y: v1.y } });
      }
    }
  }
  return frozen;
}

export function loopSignature(loop: IBoundaryLoop): string {
  if (loop.frozen) {
    return loop.frozen
      .map((f) => `${f.kind}@${f.p0.x.toFixed(4)},${f.p0.y.toFixed(4)}→${f.p1.x.toFixed(4)},${f.p1.y.toFixed(4)}`)
      .join('|');
  }
  if (!loop.anchors) return '';
  const sorted = [...loop.anchors].sort((a, b) =>
    a.entityId !== b.entityId
      ? a.entityId - b.entityId
      : a.subIndex !== b.subIndex
        ? a.subIndex - b.subIndex
        : a.t0 - b.t0,
  );
  return sorted
    .map((a) => `${a.entityId}:${a.subIndex}:${a.t0.toFixed(6)}:${a.t1.toFixed(6)}:${a.reversed ? 'R' : 'F'}`)
    .join('|');
}
