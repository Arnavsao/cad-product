import type { IPoint, IBBox } from '../../models/entity.model';
import type {
  IEdge,
  IEdgeSource,
  IHalfEdge,
  IVertex,
  IPlanarGraph,
} from './types';
import { intersectEdges } from './intersection';
import { quantKey, quantize, EPS_GEOM, QUANT_DECIMALS } from './tolerance';

/**
 * Build the planar arrangement from a flat edge list.
 *
 * Pipeline:
 *   1. Pairwise intersect all edges; collect the split parameters per edge.
 *   2. Slice each edge at its splits → a longer flat list of sub-edges,
 *      each carrying a narrowed `IEdgeSource.t0/t1` over the parent curve.
 *   3. Coalesce endpoints to graph vertices via quantized keys.
 *   4. Emit two half-edges (forward + twin) per sub-edge and record them in
 *      the destination vertex's outgoing list.
 *   5. Sort outgoing half-edges CCW by tangent angle at each vertex.
 *   6. Walk the "next" rule (prev-of-twin in outgoing list) to populate
 *      `next` / `prev` pointers on every half-edge.
 *
 * Faces are NOT extracted here — that's `face-extractor.ts`. This module
 * stops once the half-edge graph is complete and consistent.
 */

interface IEdgeFactory {
  next: number;
}

export function buildPlanarGraph(rawEdges: IEdge[]): IPlanarGraph {
  // 1 + 2 — intersect and split.
  const subEdges = splitAtIntersections(rawEdges);

  // 3 + 4 — build vertices and half-edges.
  const graph: IPlanarGraph = {
    vertices: new Map(),
    edges: new Map(),
    halfEdges: new Map(),
    faces: new Map(),
  };
  const vertexByKey = new Map<string, IVertex>();
  let nextVertexId = 0;
  let nextHalfEdgeId = 0;

  const factory: IEdgeFactory = { next: 0 };

  const getVertex = (p: IPoint): IVertex => {
    const key = quantKey(p);
    const existing = vertexByKey.get(key);
    if (existing) return existing;
    const v: IVertex = {
      id: nextVertexId++,
      x: quantize(p.x),
      y: quantize(p.y),
      outgoing: [],
    };
    vertexByKey.set(key, v);
    graph.vertices.set(v.id, v);
    return v;
  };

  // Dedupe coincident edges by their unordered vertex pair. A wall shared by
  // two adjacent regions arrives as two overlapping segments from two
  // entities; collinear overlaps are NOT split by the intersection pass, so
  // without this they would become two parallel graph edges between the same
  // vertices — a degenerate multigraph that corrupts the CCW `next` rule and
  // merges the two faces into one. Keeping a single edge per vertex pair makes
  // the shared wall a proper face separator (two half-edges, one per side).
  const edgeByVertexPair = new Map<string, IEdge>();

  for (const e of subEdges) {
    const v0 = getVertex(e.p0);
    const v1 = getVertex(e.p1);
    if (v0 === v1) continue; // collapsed to a point — drop

    const pairKey = v0.id < v1.id ? `${v0.id}|${v1.id}` : `${v1.id}|${v0.id}`;
    const existingEdge = edgeByVertexPair.get(pairKey);
    if (existingEdge) {
      // Coincident with an already-emitted edge: keep one graph edge, but
      // remember this entity so face associativity stays correct.
      const dupId = e.source.entityId;
      if (
        dupId !== existingEdge.source.entityId &&
        !(existingEdge.coincidentEntityIds ?? []).includes(dupId)
      ) {
        (existingEdge.coincidentEntityIds ??= []).push(dupId);
      }
      continue;
    }

    // Re-key the edge so ids are graph-local and sequential.
    e.id = factory.next++;
    graph.edges.set(e.id, e);
    edgeByVertexPair.set(pairKey, e);

    const fwdAngle = Math.atan2(e.p1.y - e.p0.y, e.p1.x - e.p0.x);
    const bwdAngle = Math.atan2(e.p0.y - e.p1.y, e.p0.x - e.p1.x);

    const fwd: IHalfEdge = {
      id: nextHalfEdgeId++,
      edge: e,
      reversed: false,
      origin: v0,
      twin: null as unknown as IHalfEdge, // patched below
      next: null,
      prev: null,
      face: null,
      outgoingAngle: fwdAngle,
    };
    const bwd: IHalfEdge = {
      id: nextHalfEdgeId++,
      edge: e,
      reversed: true,
      origin: v1,
      twin: fwd,
      next: null,
      prev: null,
      face: null,
      outgoingAngle: bwdAngle,
    };
    fwd.twin = bwd;

    graph.halfEdges.set(fwd.id, fwd);
    graph.halfEdges.set(bwd.id, bwd);
    v0.outgoing.push(fwd);
    v1.outgoing.push(bwd);
  }

  // 5 — sort outgoing half-edges CCW at every vertex.
  for (const v of graph.vertices.values()) {
    v.outgoing.sort((a, b) => a.outgoingAngle - b.outgoingAngle);
  }

  // 6 — set next/prev via the canonical planar-arrangement rule:
  //   at a vertex, after arriving via h_in, the next outgoing half-edge is
  //   the one immediately CLOCKWISE from h_in.twin in the CCW outgoing list
  //   — equivalently `outgoing[(idx(twin) - 1 + n) % n]`. That choice keeps
  //   the face being walked on the LEFT of the traversal direction, which
  //   is the standard DCEL convention.
  for (const h of graph.halfEdges.values()) {
    const twin = h.twin;
    const destOutgoing = twin.origin.outgoing;
    const n = destOutgoing.length;
    if (n === 0) continue;
    const idx = destOutgoing.indexOf(twin);
    if (idx < 0) continue;
    const nxt = destOutgoing[(idx - 1 + n) % n];
    h.next = nxt;
    nxt.prev = h;
  }

  return graph;
}

/* -------------------------------------------------------------------------- */
/*  Intersection + edge splitting                                              */
/* -------------------------------------------------------------------------- */

/**
 * Apply pairwise intersection to a raw edge list and return the subdivided
 * sub-edge list. Each output edge preserves its parent's `IEdgeSource`,
 * with `t0` / `t1` narrowed to the surviving sub-range.
 *
 * Complexity is O(n²) in raw edge count (matches the current production
 * behavior). Phase 7 swaps in an R-tree pair-prune; the call shape doesn't
 * change.
 */
function splitAtIntersections(edges: IEdge[]): IEdge[] {
  const splits: number[][] = edges.map(() => []);

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const hits = intersectEdges(edges[i], edges[j]);
      for (const h of hits) {
        splits[i].push(h.tA);
        splits[j].push(h.tB);
      }
      // T-junction + collinear-overlap subdivision. The closed-form line/line
      // solver only reports STRICTLY interior crossings, so it misses two
      // cases that both leave a wall un-subdivided (and therefore merge the
      // faces on either side — the "overlapping rectangles hatch as one blob"
      // symptom):
      //   • T-junctions      — one edge's endpoint sits on the body of another
      //                        (the solver discards the hit at parameter 0/1).
      //   • collinear overlap — two edges share part of the same line, so the
      //                        determinant is ~0 and no hit is reported.
      // Project each edge's endpoints onto the other and split wherever an
      // endpoint lies on the opposing edge's interior. Coincident sub-edges
      // produced by collinear overlaps are merged later in buildPlanarGraph.
      const a0 = endpointParamOnEdge(edges[i], edges[j].p0);
      if (a0 !== null) splits[i].push(a0);
      const a1 = endpointParamOnEdge(edges[i], edges[j].p1);
      if (a1 !== null) splits[i].push(a1);
      const b0 = endpointParamOnEdge(edges[j], edges[i].p0);
      if (b0 !== null) splits[j].push(b0);
      const b1 = endpointParamOnEdge(edges[j], edges[i].p1);
      if (b1 !== null) splits[j].push(b1);
    }
  }

  const out: IEdge[] = [];
  for (let i = 0; i < edges.length; i++) {
    const params = [0, ...splits[i], 1].sort((a, b) => a - b);
    const dedup: number[] = [];
    for (const p of params) {
      if (!dedup.length || Math.abs(p - dedup[dedup.length - 1]) > 1e-9) dedup.push(p);
    }
    const parent = edges[i];
    for (let k = 0; k < dedup.length - 1; k++) {
      const ta = dedup[k];
      const tb = dedup[k + 1];
      const a = lerp(parent.p0, parent.p1, ta);
      const b = lerp(parent.p0, parent.p1, tb);
      if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-9) continue;
      out.push({
        id: -1, // re-keyed by buildPlanarGraph
        kind: parent.kind,
        source: narrowSource(parent.source, ta, tb),
        p0: a,
        p1: b,
        bbox: linearBBox(a, b),
      });
    }
  }
  return out;
}

/**
 * Perpendicular tolerance for "does this endpoint lie on that edge?" Tied to
 * the vertex-quantization grid (half a quant cell) so that a split made at the
 * projection point and the foreign endpoint that triggered it always coalesce
 * to the SAME graph vertex — otherwise the T-stem would dangle a fraction away
 * from the wall it is supposed to meet.
 */
const ON_EDGE_PERP_TOL = 0.5 * Math.pow(10, -QUANT_DECIMALS);

/**
 * If `p` lies on the INTERIOR of the linear `edge` — within
 * `ON_EDGE_PERP_TOL` perpendicular distance and strictly between the
 * endpoints — return its parameter t∈(0,1) along the edge; otherwise null.
 *
 * Returning null at the endpoints (t≈0 / t≈1) avoids spawning zero-length
 * slivers when a foreign endpoint coincides with this edge's own vertex.
 */
function endpointParamOnEdge(edge: IEdge, p: IPoint): number | null {
  const ax = edge.p0.x, ay = edge.p0.y;
  const dx = edge.p1.x - ax, dy = edge.p1.y - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS_GEOM) return null;
  const t = ((p.x - ax) * dx + (p.y - ay) * dy) / len2;
  if (t <= EPS_GEOM || t >= 1 - EPS_GEOM) return null;
  const qx = ax + t * dx, qy = ay + t * dy;
  const perp2 = (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy);
  if (perp2 > ON_EDGE_PERP_TOL * ON_EDGE_PERP_TOL) return null;
  return t;
}

function lerp(a: IPoint, b: IPoint, t: number): IPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Map a child sub-range `[ta, tb]` (in parent-edge local parameters) into the
 * source curve's natural parameterization, preserving the original
 * entityId / subIndex / blockPath. This is what makes Phase 3 anchor
 * resolution exact — the surviving edges remember which arc of their host
 * they represent.
 */
function narrowSource(src: IEdgeSource, ta: number, tb: number): IEdgeSource {
  const span = src.t1 - src.t0;
  return {
    entityId: src.entityId,
    subIndex: src.subIndex,
    t0: src.t0 + span * ta,
    t1: src.t0 + span * tb,
    blockPath: src.blockPath ? [...src.blockPath] : undefined,
  };
}

function linearBBox(p0: IPoint, p1: IPoint): IBBox {
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  return { x, y, w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) };
}
