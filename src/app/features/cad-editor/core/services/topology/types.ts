import type { IPoint, IBBox } from '../../models/entity.model';

/**
 * Phase 2 topology types — the curve-native DCEL.
 *
 * Lifetime: a planar graph is built per query (no persistent state yet — that
 * lands with the cache layer in Phase 7). Callers should not retain references
 * across calls; ids are graph-local.
 *
 * Why these types live in their own module:
 *   - Edge / HalfEdge / Vertex / Face form a tightly-coupled cluster used by
 *     the entire topology pipeline (edge-extractor → intersection →
 *     planar-graph → face-extractor → point-location).
 *   - Keeping them out of the public service module avoids leaking internals
 *     to call sites that should only see `RegionResult`.
 */

/**
 * Edge classification. Phase 2 tessellates curves into LINE / POLYLINE_SEG
 * (so the intersection pass can stay closed-form line-line for now), but
 * each segment retains a parametric reference back to the source curve via
 * `IEdgeSource.t0/t1`. Phase 2.5 will replace ARC/ELLIPSE_ARC tessellation
 * with curve-native intersection — when that lands, those kinds become
 * first-class without changing the graph construction code.
 */
export type EdgeKind =
  | 'LINE'         // straight line segment from a LINE entity
  | 'POLYLINE_SEG' // straight segment from a POLYLINE entity
  | 'ARC'          // (reserved for Phase 2.5 — currently tessellated to POLYLINE_SEG)
  | 'CIRCLE'       // (reserved for Phase 2.5)
  | 'ELLIPSE_ARC'  // (reserved for Phase 2.5)
  | 'SPLINE';      // (reserved for Phase 3+)

/**
 * Anchor-ready back-reference from a graph edge to the entity geometry that
 * produced it.
 *
 *   - `entityId` is the source entity in the document.
 *   - `subIndex` disambiguates which sub-curve of a compound host:
 *       POLYLINE       → segment index (start vertex)
 *       composite SPLINE → which span
 *       all others     → 0
 *   - `t0`, `t1` are the natural-parameter range of THIS edge over its
 *     sub-curve, in [0, 1]. For an undivided edge they are 0 and 1; after
 *     intersection-splitting they narrow to the surviving sub-range.
 *   - `blockPath` is the chain of nested INSERT entity ids (outermost first)
 *     that this edge was reached through. Empty for direct-file entities.
 *
 * This shape is intentionally identical to `IEntityAnchor` so hatch boundary
 * specs (Phase 3) can be built by lifting `IEdgeSource` records straight out
 * of the graph without translation.
 */
export interface IEdgeSource {
  entityId: number;
  subIndex: number;
  t0: number;
  t1: number;
  blockPath?: number[];
}

/**
 * A single undirected curve in the planar arrangement.
 *
 * Each IEdge spawns exactly two half-edges (forward + twin) in the DCEL.
 * Geometry fields are populated based on `kind`:
 *
 *   LINE / POLYLINE_SEG → p0, p1
 *   ARC                 → center, r, a0, a1, ccw                (Phase 2.5)
 *   CIRCLE              → center, r                              (Phase 2.5)
 *   ELLIPSE_ARC         → center, rx, ry, rot, a0, a1, ccw       (Phase 2.5)
 *
 * `bbox` is a tight axis-aligned bbox of the curve segment, cached for
 * intersection prefiltering and face-bbox accumulation.
 */
export interface IEdge {
  id: number;
  kind: EdgeKind;
  source: IEdgeSource;
  p0: IPoint;
  p1: IPoint;
  /**
   * Entity ids of OTHER edges that were coincident with this one (same two
   * endpoints) and merged into it during graph construction. A shared wall
   * between two adjacent regions exists as two overlapping segments from two
   * different entities; the planar graph keeps a single edge so the two faces
   * are properly separated, and records the dropped entity ids here so face
   * extraction can still attribute the boundary to every contributing entity
   * (associativity). Undefined when no coincident edges were merged.
   */
  coincidentEntityIds?: number[];
  // Curve-specific fields — present only for the matching kinds. Phase 2 only
  // populates them for documentation / Phase 2.5 readiness; they're not read
  // by the current line-line intersection path.
  center?: IPoint;
  r?: number;
  rx?: number;
  ry?: number;
  rot?: number;
  a0?: number;
  a1?: number;
  ccw?: boolean;
  bbox: IBBox;
}

/**
 * A directed traversal of an IEdge.
 *
 *   - `reversed=false` walks the edge from p0 → p1 in natural parameterization.
 *   - `reversed=true` walks p1 → p0.
 *
 * `outgoingAngle` is the tangent direction at the half-edge's origin, used
 * for CCW ordering at vertices. For LINE / POLYLINE_SEG this is the chord
 * angle; for curves (Phase 2.5) it's the analytical tangent.
 */
export interface IHalfEdge {
  id: number;
  edge: IEdge;
  reversed: boolean;
  origin: IVertex;
  twin: IHalfEdge;
  next: IHalfEdge | null;
  prev: IHalfEdge | null;
  face: IFace | null;
  outgoingAngle: number;
}

/**
 * A quantized vertex in the arrangement. `x, y` are pre-quantization — for
 * geometric continuity — but the vertex-coalesce key uses `quantKey()` from
 * `tolerance.ts`. `outgoing` is sorted CCW by `outgoingAngle` at graph
 * finalization, which is what makes the face-walk's "prev of twin in
 * outgoing list" rule produce well-formed face boundaries.
 */
export interface IVertex {
  id: number;
  x: number;
  y: number;
  outgoing: IHalfEdge[];
}

/**
 * A closed face in the arrangement.
 *
 *   - `signedArea > 0` → CCW interior face (a candidate hatch region).
 *   - `signedArea < 0` → CW outer face (the unbounded face is the unique
 *     CW face that encloses all interior faces).
 *
 * `contributingEntityIds` is the set of source entities whose edges form
 * this face's boundary. Used by the hatch tool to decide whether a face
 * came from a single entity (→ associative single-source hatch) or multiple
 * (→ multi-entity associative hatch).
 */
export interface IFace {
  id: number;
  halfEdges: IHalfEdge[];
  polygon: IPoint[];
  signedArea: number;
  bbox: IBBox;
  contributingEntityIds: Set<number>;
}

/**
 * The whole arrangement. Maps for O(1) lookup; arrays would be fine too but
 * Maps make incremental update (Phase 7) easier when it lands.
 */
export interface IPlanarGraph {
  vertices: Map<number, IVertex>;
  edges: Map<number, IEdge>;
  halfEdges: Map<number, IHalfEdge>;
  faces: Map<number, IFace>;
}
