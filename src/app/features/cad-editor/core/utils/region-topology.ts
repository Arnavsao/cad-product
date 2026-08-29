import type { IPoint, Entity } from '../models/entity.model';

/**
 * Pick-point hatch region solver (planar arrangement / DCEL-style).
 *
 * Given a list of entities and a click point, finds the smallest CCW closed
 * face in the planar arrangement of all candidate edges that contains the click.
 *
 * Pipeline:
 *   1. bbox-prefilter candidate entities near the click point
 *   2. tessellate each entity into line segments
 *   3. pairwise segment intersections; split each segment at every intersection
 *   4. build a planar graph: nodes (quantized vertices) + half-edges (sorted CCW per node)
 *   5. traverse faces via "next = the half-edge immediately CCW after twin at the destination"
 *   6. pick the smallest positive-area face whose interior contains the click
 *
 * Limitations:
 *   - No nested-island subtraction (smallest CCW face is returned as-is).
 *   - O(n²) intersection cost; bbox prefilter limits the candidate set.
 *   - 4-decimal vertex quantization; near-coincident edges may collapse or split incorrectly.
 *   - 32-segment arc tessellation; tight curve gaps can leak.
 */

const EPS = 1e-6;
const QUANT_DECIMALS = 4;

interface Seg {
  a: IPoint;
  b: IPoint;
  entId?: number;
}

/**
 * Optional pre-filter override. When `candidateIds` is provided, the inline
 * bbox prefilter is skipped and only entities whose id is in the set (and
 * whose type is in `SUPPORTED_TYPES`) are considered. Used by callers that
 * already narrowed the candidate set via `SpatialIndexService` — saves a
 * second O(n) bbox scan inside this module.
 */
export interface ITopologyOpts {
  candidateIds?: ReadonlySet<number>;
}

export function findRegionContaining(
  entities: Entity[],
  clickX: number,
  clickY: number,
  opts?: ITopologyOpts,
): IPoint[] | null {
  const candidates = resolveCandidates(entities, clickX, clickY, opts);
  if (!candidates.length) return null;

  const segs: Seg[] = [];
  for (const e of candidates) {
    for (const s of entityToSegments(e)) segs.push(s);
  }
  if (segs.length < 3) return null;

  const split = splitAtIntersections(segs);
  if (split.length < 3) return null;

  const graph = buildPlanarGraph(split);
  if (!graph.halfEdges.length) return null;

  const faces = traverseFaces(graph);
  // Unwrap the Face's polygon — legacy callers expect just the boundary
  // points. Use `findRegionContainingWithIslands` if you need entIds too.
  const face = pickFaceContaining(faces, clickX, clickY);
  return face ? face.polygon : null;
}

/**
 * Return all closed CCW faces in the planar arrangement of the given entities.
 * No prefilter (whole drawing). O(n²) in segment count — caller is responsible
 * for choosing a sensibly bounded entity set.
 */
export function findAllRegions(entities: Entity[]): IPoint[][] {
  const candidates: Entity[] = [];
  for (const e of entities) {
    if (e && SUPPORTED_TYPES.has((e as any).type)) candidates.push(e);
  }
  if (!candidates.length) return [];

  const segs: Seg[] = [];
  for (const e of candidates) for (const s of entityToSegments(e)) segs.push(s);
  if (segs.length < 3) return [];

  const split = splitAtIntersections(segs);
  if (split.length < 3) return [];

  const graph = buildPlanarGraph(split);
  if (!graph.halfEdges.length) return [];

  const faces = traverseFaces(graph);
  // `signedArea` operates on the polygon points; `Face` wraps polygon +
  // entIds, so reach into `.polygon` for both the area check and the
  // returned point array.
  return faces.filter((f) => signedArea(f.polygon) > EPS).map((f) => f.polygon);
}

/**
 * Return all entity-entity intersection points within `worldRadius` of (worldX, worldY).
 * Each point is the location where two source entities cross — the same crossings the
 * topology solver promotes to graph nodes.
 */
export function findIntersectionPointsNear(
  entities: Entity[],
  worldX: number,
  worldY: number,
  worldRadius: number,
  opts?: ITopologyOpts,
): IPoint[] {
  // Prefilter: only entities whose bbox intersects the search disk. When the
  // caller has already narrowed via SpatialIndexService, honor that set and
  // skip the redundant bbox scan.
  const idFilter = opts?.candidateIds;
  const candidates: Entity[] = [];
  for (const e of entities) {
    if (!e || !SUPPORTED_TYPES.has((e as any).type)) continue;
    if (idFilter && !idFilter.has(e.id)) continue;
    if (idFilter) {
      candidates.push(e);
      continue;
    }
    if (typeof e.bbox !== 'function') continue;
    const b = e.bbox();
    if (!b) continue;
    if (worldX < b.x - worldRadius || worldX > b.x + b.w + worldRadius) continue;
    if (worldY < b.y - worldRadius || worldY > b.y + b.h + worldRadius) continue;
    candidates.push(e);
  }
  if (candidates.length < 2) return [];

  // Tessellate per entity, track which source the segment belongs to.
  const buckets: Seg[][] = candidates.map((e: any) => entityToSegments(e));

  const out: IPoint[] = [];
  const r2 = worldRadius * worldRadius;
  const seen = new Set<string>();
  for (let i = 0; i < buckets.length; i++) {
    for (let j = i + 1; j < buckets.length; j++) {
      for (const sa of buckets[i]) {
        for (const sb of buckets[j]) {
          const pt = segmentIntersection(sa, sb);
          if (!pt) continue;
          const dx = pt.x - worldX;
          const dy = pt.y - worldY;
          if (dx * dx + dy * dy > r2) continue;
          const key = `${pt.x.toFixed(QUANT_DECIMALS)},${pt.y.toFixed(QUANT_DECIMALS)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(pt);
        }
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  1. Candidate prefilter                                                     */
/* -------------------------------------------------------------------------- */

const SUPPORTED_TYPES = new Set(['LINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE']);

/**
 * Narrow the input entity array to topology-relevant candidates.
 *
 * Three modes:
 *   - `opts.candidateIds` provided → trust the caller's filter; only enforce
 *     the SUPPORTED_TYPES check. This is the SpatialIndexService path.
 *   - else → fall back to the inline bbox-near-click prefilter (the historic
 *     behavior, preserved for callers that haven't migrated yet).
 */
function resolveCandidates(
  entities: Entity[],
  cx: number,
  cy: number,
  opts?: ITopologyOpts,
): Entity[] {
  if (opts?.candidateIds) {
    const idFilter = opts.candidateIds;
    const out: Entity[] = [];
    for (const e of entities) {
      if (!e || !SUPPORTED_TYPES.has((e as any).type)) continue;
      if (idFilter.has(e.id)) out.push(e);
    }
    return out;
  }
  return prefilterCandidates(entities, cx, cy);
}

function prefilterCandidates(entities: Entity[], cx: number, cy: number): Entity[] {
  const out: Entity[] = [];
  for (const e of entities) {
    if (!e || !SUPPORTED_TYPES.has((e as any).type)) continue;
    if (typeof e.bbox !== 'function') continue;
    const b = e.bbox();
    if (!b) continue;
    const margin = Math.max(b.w, b.h, 1);
    if (cx >= b.x - margin && cx <= b.x + b.w + margin &&
        cy >= b.y - margin && cy <= b.y + b.h + margin) {
      out.push(e);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  2. Tessellation                                                            */
/* -------------------------------------------------------------------------- */

const ARC_SEGS = 32;

function entityToSegments(e: any): Seg[] {
  const out: Seg[] = [];
  switch (e.type) {
    case 'LINE':
      out.push({ a: { x: e.x1, y: e.y1 }, b: { x: e.x2, y: e.y2 }, entId: e.id });
      break;
    case 'POLYLINE': {
      const pts: IPoint[] = e.pts ?? [];
      for (let i = 0; i < pts.length - 1; i++) {
        out.push({ a: pts[i], b: pts[i + 1], entId: e.id });
      }
      if (e.closed && pts.length > 2) {
        out.push({ a: pts[pts.length - 1], b: pts[0], entId: e.id });
      }
      break;
    }
    case 'CIRCLE': {
      let prev = { x: e.cx + e.r, y: e.cy };
      for (let i = 1; i <= ARC_SEGS * 2; i++) {
        const t = (i / (ARC_SEGS * 2)) * Math.PI * 2;
        const next = { x: e.cx + e.r * Math.cos(t), y: e.cy + e.r * Math.sin(t) };
        out.push({ a: prev, b: next, entId: e.id });
        prev = next;
      }
      break;
    }
    case 'ARC': {
      const sa = (e.startAngle * Math.PI) / 180;
      const ea = (e.endAngle * Math.PI) / 180;
      let sweep = ea - sa;
      if (e.ccw !== false) {
        if (sweep <= 0) sweep += Math.PI * 2;
      } else {
        if (sweep >= 0) sweep -= Math.PI * 2;
      }
      const segs = Math.max(8, Math.ceil(ARC_SEGS * Math.abs(sweep) / (Math.PI * 2)));
      let prev = { x: e.cx + e.r * Math.cos(sa), y: e.cy + e.r * Math.sin(sa) };
      for (let i = 1; i <= segs; i++) {
        const t = sa + sweep * (i / segs);
        const next = { x: e.cx + e.r * Math.cos(t), y: e.cy + e.r * Math.sin(t) };
        out.push({ a: prev, b: next, entId: e.id });
        prev = next;
      }
      break;
    }
    case 'ELLIPSE': {
      const cos = Math.cos(e.rotation ?? 0);
      const sin = Math.sin(e.rotation ?? 0);
      const sample = (t: number): IPoint => {
        const lx = e.rx * Math.cos(t);
        const ly = e.ry * Math.sin(t);
        return { x: e.cx + lx * cos - ly * sin, y: e.cy + lx * sin + ly * cos };
      };
      const total = ARC_SEGS * 2;
      let prev = sample(0);
      for (let i = 1; i <= total; i++) {
        const t = (i / total) * Math.PI * 2;
        const next = sample(t);
        out.push({ a: prev, b: next, entId: e.id });
        prev = next;
      }
      break;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  3. Pairwise intersection + segment splitting                               */
/* -------------------------------------------------------------------------- */

function segmentIntersection(s1: Seg, s2: Seg): IPoint | null {
  const x1 = s1.a.x, y1 = s1.a.y;
  const x2 = s1.b.x, y2 = s1.b.y;
  const x3 = s2.a.x, y3 = s2.a.y;
  const x4 = s2.b.x, y4 = s2.b.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < EPS) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

function paramAlong(s: Seg, p: IPoint): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return (p.x - s.a.x) / dx;
  return (p.y - s.a.y) / dy;
}

/**
 * If `p` lies on the interior of segment `s` — within half a vertex-quant cell
 * perpendicular distance and strictly between the endpoints — return its
 * parameter t∈(0,1); otherwise null. Lets the splitter subdivide collinear
 * partial overlaps that `segmentIntersection` reports as null. The tolerance
 * matches the vertex grid so the split point and the endpoint that triggered
 * it coalesce to the same node.
 */
function pointOnSegParam(s: Seg, p: IPoint): number | null {
  const ax = s.a.x, ay = s.a.y;
  const dx = s.b.x - ax, dy = s.b.y - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return null;
  const t = ((p.x - ax) * dx + (p.y - ay) * dy) / len2;
  if (t <= EPS || t >= 1 - EPS) return null;
  const qx = ax + t * dx, qy = ay + t * dy;
  const perp2 = (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy);
  const tol = 0.5 * Math.pow(10, -QUANT_DECIMALS);
  if (perp2 > tol * tol) return null;
  return t;
}

function lerp(a: IPoint, b: IPoint, t: number): IPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function splitAtIntersections(segments: Seg[]): Seg[] {
  const splits: number[][] = segments.map(() => []);
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const pt = segmentIntersection(segments[i], segments[j]);
      if (pt) {
        const ti = paramAlong(segments[i], pt);
        const tj = paramAlong(segments[j], pt);
        if (ti > EPS && ti < 1 - EPS) splits[i].push(ti);
        if (tj > EPS && tj < 1 - EPS) splits[j].push(tj);
      }
      // Collinear-overlap subdivision: `segmentIntersection` returns null for
      // parallel/collinear pairs, so two segments that share part of the same
      // line never get split at the overlap ends. Project each segment's
      // endpoints onto the other and split where an endpoint lands on the
      // opposing segment's interior; the coincident sub-segments are merged in
      // buildPlanarGraph so the shared run collapses to a single wall.
      const a0 = pointOnSegParam(segments[i], segments[j].a);
      if (a0 !== null) splits[i].push(a0);
      const a1 = pointOnSegParam(segments[i], segments[j].b);
      if (a1 !== null) splits[i].push(a1);
      const b0 = pointOnSegParam(segments[j], segments[i].a);
      if (b0 !== null) splits[j].push(b0);
      const b1 = pointOnSegParam(segments[j], segments[i].b);
      if (b1 !== null) splits[j].push(b1);
    }
  }
  const out: Seg[] = [];
  for (let i = 0; i < segments.length; i++) {
    const params = [0, ...splits[i], 1].sort((a, b) => a - b);
    const dedup: number[] = [];
    for (const p of params) {
      if (!dedup.length || Math.abs(p - dedup[dedup.length - 1]) > EPS) dedup.push(p);
    }
    for (let k = 0; k < dedup.length - 1; k++) {
      const a = lerp(segments[i].a, segments[i].b, dedup[k]);
      const b = lerp(segments[i].a, segments[i].b, dedup[k + 1]);
      if (Math.hypot(b.x - a.x, b.y - a.y) > EPS) {
        out.push({ a, b, entId: segments[i].entId });
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  4. Planar graph (DCEL-lite)                                                */
/* -------------------------------------------------------------------------- */

interface PlanarGraph {
  nodes: { x: number; y: number; outgoing: number[] }[];
  halfEdges: { from: number; to: number; twin: number; angle: number; entId?: number; extraEntIds?: number[] }[];
}

function buildPlanarGraph(segments: Seg[]): PlanarGraph {
  const nodes: { x: number; y: number; outgoing: number[] }[] = [];
  // Local array type must include `entId?: number` so the pushed records
  // (which carry the source-entity id for island detection) typecheck. The
  // shape matches the `PlanarGraph.halfEdges` field's declared type.
  const halfEdges: { from: number; to: number; twin: number; angle: number; entId?: number; extraEntIds?: number[] }[] = [];
  const nodeMap = new Map<string, number>();

  /**
   * Vertex coalescing — quantize to QUANT_DECIMALS and use the nodeMap for
   * O(1) lookup. Order-independent: two near-identical points produced by
   * different intersection paths get the same node id every time. The old
   * version did a linear scan with floating tolerance, which could fuse
   * different pairs depending on iteration order — that's what made dense
   * arrangements (overlapping rectangles, circle+rect+line clusters)
   * occasionally produce broken topology and the wrong enclosing face.
   */
  const quantKey = (p: IPoint): string =>
    `${p.x.toFixed(QUANT_DECIMALS)},${p.y.toFixed(QUANT_DECIMALS)}`;

  const getNode = (p: IPoint): number => {
    const key = quantKey(p);
    const existing = nodeMap.get(key);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    nodes.push({ x: p.x, y: p.y, outgoing: [] });
    nodeMap.set(key, id);
    return id;
  };

  // Dedupe coincident segments by their unordered node pair. A wall shared by
  // two adjacent regions arrives as two overlapping segments from two
  // entities; collinear overlaps are not split, so without this they become
  // two parallel half-edge pairs between the same nodes — a degenerate
  // multigraph that corrupts the CCW face walk and merges the two faces into
  // one. Keep a single half-edge pair per node pair so the shared wall stays
  // a proper face separator; remember the dropped entity id for associativity.
  const halfEdgeByNodePair = new Map<string, number>();

  for (const s of segments) {
    const na = getNode(s.a);
    const nb = getNode(s.b);
    if (na === nb) continue;
    const pairKey = na < nb ? `${na}|${nb}` : `${nb}|${na}`;
    const existing = halfEdgeByNodePair.get(pairKey);
    if (existing !== undefined) {
      const he = halfEdges[existing];
      const dupId = s.entId;
      if (dupId !== undefined && dupId !== he.entId && !(he.extraEntIds ?? []).includes(dupId)) {
        (he.extraEntIds ??= []).push(dupId);
      }
      continue;
    }
    const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
    const h = halfEdges.length;
    halfEdges.push({ from: na, to: nb, twin: h + 1, angle: ang, entId: s.entId });
    halfEdges.push({ from: nb, to: na, twin: h, angle: Math.atan2(s.a.y - s.b.y, s.a.x - s.b.x), entId: s.entId });
    halfEdgeByNodePair.set(pairKey, h);
    nodes[na].outgoing.push(h);
    nodes[nb].outgoing.push(h + 1);
  }

  // Sort outgoing half-edges at each node by ascending angle (CCW from +X).
  for (const n of nodes) {
    n.outgoing.sort((a, b) => halfEdges[a].angle - halfEdges[b].angle);
  }

  return { nodes, halfEdges };
}

/* -------------------------------------------------------------------------- */
/*  5. Face traversal                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Standard DCEL face walk: at each step, jump via the twin to the destination
 * node, then take the outgoing edge IMMEDIATELY CCW after the twin in the
 * sorted incidence list. That keeps the face we're tracing on the LEFT.
 */
interface Face {
  polygon: IPoint[];
  entIds: Set<number>;
}

function traverseFaces(graph: PlanarGraph): Face[] {
  const { nodes, halfEdges } = graph;
  const visited = new Array<boolean>(halfEdges.length).fill(false);
  const faces: Face[] = [];

  const nextOf = (h: number): number => {
    const twin = halfEdges[h].twin;
    const at = halfEdges[twin].from;
    const list = nodes[at].outgoing;
    const idx = list.indexOf(twin);
    if (idx < 0) return -1;
    return list[(idx - 1 + list.length) % list.length];
  };

  for (let start = 0; start < halfEdges.length; start++) {
    if (visited[start]) continue;
    const polygon: IPoint[] = [];
    const entIds = new Set<number>();
    let cur = start;
    let guard = 0;
    while (!visited[cur] && guard++ < halfEdges.length + 4) {
      visited[cur] = true;
      const fromNode = nodes[halfEdges[cur].from];
      polygon.push({ x: fromNode.x, y: fromNode.y });
      if (halfEdges[cur].entId !== undefined) entIds.add(halfEdges[cur].entId!);
      if (halfEdges[cur].extraEntIds) {
        for (const id of halfEdges[cur].extraEntIds!) entIds.add(id);
      }
      const nxt = nextOf(cur);
      if (nxt < 0 || nxt === start) break;
      cur = nxt;
    }
    if (polygon.length >= 3) faces.push({ polygon, entIds });
  }

  return faces;
}

/* -------------------------------------------------------------------------- */
/*  6. Region selection                                                        */
/* -------------------------------------------------------------------------- */

function signedArea(poly: IPoint[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a / 2;
}

export function pointInPolygon(poly: IPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].y, yj = poly[j].y;
    if ((yi > y) !== (yj > y)) {
      const xi = poly[i].x, xj = poly[j].x;
      const xCross = xi + (xj - xi) * (y - yi) / (yj - yi + 1e-30);
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

function pickFaceContaining(faces: Face[], cx: number, cy: number): Face | null {
  let best: Face | null = null;
  let bestArea = Infinity;
  for (const f of faces) {
    const area = signedArea(f.polygon);
    if (area <= EPS) continue; // CW or degenerate
    if (!pointInPolygon(f.polygon, cx, cy)) continue;
    if (area < bestArea) {
      bestArea = area;
      best = f;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/*  7. Island detection (for donut / concentric shapes)                        */
/* -------------------------------------------------------------------------- */

/** Result with outer boundary and inner holes (islands). */
export interface RegionResult {
  polygon: IPoint[];
  islands: IPoint[][];
  entIds: number[];
}

/**
 * Like `findRegionContaining`, but also returns inner holes (islands).
 *
 * After finding the outer boundary, scans all other positive-area faces for
 * ones that lie entirely inside the outer boundary but do NOT contain the
 * click point. These are "islands" — inner boundaries that should be
 * subtracted via even-odd fill.
 *
 * Only direct (first-level) islands are kept: if island A contains island B,
 * only A is returned. This prevents nested islands from incorrectly toggling
 * the fill state back on.
 */
export function findRegionContainingWithIslands(
  entities: Entity[],
  clickX: number,
  clickY: number,
  opts?: ITopologyOpts,
): RegionResult | null {
  const candidates = resolveCandidates(entities, clickX, clickY, opts);
  if (!candidates.length) return null;

  const segs: Seg[] = [];
  for (const e of candidates) {
    for (const s of entityToSegments(e)) segs.push(s);
  }
  if (segs.length < 3) return null;

  const split = splitAtIntersections(segs);
  if (split.length < 3) return null;

  const graph = buildPlanarGraph(split);
  if (!graph.halfEdges.length) return null;

  const faces = traverseFaces(graph);
  const outer = pickFaceContaining(faces, clickX, clickY);
  if (!outer) return null;

  // Collect candidate islands: CCW faces inside the outer boundary that
  // don't contain the click point.
  const candidateIslands: Face[] = [];
  for (const f of faces) {
    if (f === outer) continue;
    const area = signedArea(f.polygon);
    if (area <= EPS) continue; // skip CW / degenerate
    if (pointInPolygon(f.polygon, clickX, clickY)) continue; // contains click — not an island
    // Check if this face is inside the outer boundary
    if (f.polygon.length > 0 && pointInPolygon(outer.polygon, f.polygon[0].x, f.polygon[0].y)) {
      candidateIslands.push(f);
    }
  }

  // Keep only direct islands (not nested inside another island).
  // If island A contains island B, drop B so even-odd fill doesn't toggle back.
  const islands = candidateIslands.filter(c =>
    !candidateIslands.some(other => other !== c && pointInPolygon(other.polygon, c.polygon[0].x, c.polygon[0].y)),
  );

  const allEntIds = new Set<number>(outer.entIds);
  for (const isl of islands) {
    isl.entIds.forEach(id => allEntIds.add(id));
  }

  return { 
    polygon: outer.polygon, 
    islands: islands.map(i => i.polygon),
    entIds: Array.from(allEntIds)
  };
}
