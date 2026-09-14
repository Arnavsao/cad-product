import { Injectable, inject } from '@angular/core';
import type { IPoint, Entity, IBBox } from '../models/entity.model';
import { DocumentService } from './document.service';
import { SpatialIndexService } from './spatial-index.service';
import {
  findRegionContaining,
  findRegionContainingWithIslands,
  findAllRegions,
  findIntersectionPointsNear,
  type RegionResult,
} from '../utils/region-topology';
import { extractEdges, isSupportedSource, resetEdgeIds } from './topology/edge-extractor';
import { buildPlanarGraph } from './topology/planar-graph';
import { extractFaces } from './topology/face-extractor';
import { pickFaceContaining, collectDirectIslands } from './topology/point-location';
import type { IEdge, IFace } from './topology/types';
import { TopologyDebugService } from './topology-debug.service';

/** Why a pick-point query returned nothing — so the tool can stop, not retry. */
export type RegionRejection = 'none' | 'no-candidates' | 'not-enclosed' | 'too-complex' | 'no-face';

export interface IRegionQueryOpts {
  /**
   * World rectangle bounding the boundary set. AutoCAD's default boundary
   * set is "the current viewport"; the hatch tool passes exactly that, the
   * regen scheduler passes the hatch's own neighbourhood. Entities whose bbox
   * misses the window cannot take part in the boundary — which is also why
   * zooming in makes an over-complex pick tractable.
   */
  window?: IBBox | null;
}

export interface IRegionQueryReport {
  rejection: RegionRejection;
  candidateIds: number[];
  /** Tessellated edges the boundary set feeds (or would feed) the arrangement. */
  edgeCount: number;
}

/**
 * Per-query topology engine. Shared across hatch, snap, fill, and any future
 * tool that needs intersection nodes / closed-region detection.
 *
 * ## Face cache (Phase 7)
 *
 * The V2 modular pipeline (`findRegionAtWithIslandsV2`) is O(E²) in the
 * number of candidate edges for the intersection pass. On a typical drawing
 * with 20–100 boundary edges, this is fast (~1 ms). On complex drawings it
 * can take tens of milliseconds, which is noticeable during hover preview
 * (called on every `mousemove` tick).
 *
 * The cache stores the `IFace[]` result of `extractFaces(graph)` keyed by a
 * string derived from the sorted `(entityId, revision)` pairs of the candidate
 * entity set. If the user moves the mouse within the same entity neighborhood
 * without editing anything, the cache hits and we skip straight to
 * `pickFaceContaining` (O(F) where F ≪ E).
 *
 * Cache size 8 is enough for:
 *   - Multiple open drawings (typically < 4 distinct topology neighborhoods)
 *   - Rapid hover across a complex boundary (same entity set, different click)
 *   - Concurrent hatch + snap usage (different radius queries)
 *
 * The cache invalidates naturally: any entity edit bumps `entity.revision` →
 * cache key changes → compulsory miss → graph rebuilt. No explicit
 * invalidation is needed.
 */
interface IFaceCacheEntry {
  key: string;
  faces: IFace[];
  /** Monotonic timestamp used for LRU eviction. */
  usedAt: number;
}

@Injectable({ providedIn: 'root' })
export class TopologyService {
  private doc = inject(DocumentService);
  private spatial = inject(SpatialIndexService);
  private debug = inject(TopologyDebugService);

  private readonly _faceCache: IFaceCacheEntry[] = [];
  private _cacheAge = 0;
  private static readonly _CACHE_MAX = 8;

  /**
   * HPMAXLINES for boundary detection: the most tessellated edges one
   * pick-point query may feed into the planar arrangement. AutoCAD answers
   * "Hatch boundary too complex" rather than grinding; so do we. 8 000 edges
   * through the grid-accelerated arrangement is well under a frame budget
   * on a laptop; the old whole-drawing sets ran to tens of thousands.
   */
  static readonly MAX_BOUNDARY_EDGES = 8000;
  /** Ceiling for BHATCH over the whole drawing (`findAllRegions`). */
  static readonly MAX_BATCH_EDGES = 30000;

  /** Outcome of the most recent pick-point query. */
  lastQuery: IRegionQueryReport = { rejection: 'none', candidateIds: [], edgeCount: 0 };

  /**
   * Find the smallest CCW closed face containing the click in world coords.
   * Returns the ordered polygon vertices, or null if no closed face surrounds the click.
   */
  findRegionAt(worldX: number, worldY: number): IPoint[] | null {
    return findRegionContaining(this.doc.activeFile.entities, worldX, worldY);
  }

  /** Same as `findRegionAt` but against an explicit entity list (e.g. a single file). */
  findRegionAtIn(entities: Entity[], worldX: number, worldY: number): IPoint[] | null {
    return findRegionContaining(entities, worldX, worldY);
  }

  /** Return every closed CCW face in the active file's planar arrangement. */
  /**
   * Every closed face in the drawing (BHATCH). Refused over
   * `MAX_BATCH_EDGES`: the whole-drawing arrangement is the one place the
   * boundary set cannot be narrowed, so the budget is the only guard.
   */
  findAllRegions(): IPoint[][] {
    const entities = this.doc.activeFile.entities;
    let estimate = 0;
    for (const e of entities) if (isSupportedSource(e)) estimate += estimateEdgeCount(e);
    if (estimate > TopologyService.MAX_BATCH_EDGES) {
      this.lastQuery = { rejection: 'too-complex', candidateIds: [], edgeCount: estimate };
      return [];
    }
    return findAllRegions(entities);
  }

  /**
   * Return entity-entity intersection points within `worldRadius` of (worldX, worldY).
   * Each point is a place where two distinct source entities cross.
   *
   * Uses the spatial index to narrow the candidate set to entities whose bbox
   * intersects the search disk. For dense drawings this avoids tessellating
   * thousands of entities just to discard them on a per-pair bbox check.
   */
  findIntersectionsNear(worldX: number, worldY: number, worldRadius: number): IPoint[] {
    const candidateIds = new Set(
      this.spatial.queryBox({
        x: worldX - worldRadius,
        y: worldY - worldRadius,
        w: worldRadius * 2,
        h: worldRadius * 2,
      }),
    );
    return findIntersectionPointsNear(
      this.doc.activeFile.entities,
      worldX,
      worldY,
      worldRadius,
      { candidateIds },
    );
  }

  /**
   * Like `findRegionAt` but also returns inner island holes.
   * Used by the hatch tool for donut / concentric shape fill.
   */
  findRegionAtWithIslands(worldX: number, worldY: number, opts: IRegionQueryOpts = {}): RegionResult | null {
    return this.findRegionForPick(worldX, worldY, opts);
  }

  /**
   * Pick-point region query as tools should call it: V2 first; when V2 built
   * an arrangement but found no face, try V1 over the SAME boundary set for
   * parity. When V2 refused (nothing encloses the point, or the set is over
   * budget) answer null at once — the old "V1 over the whole drawing"
   * fallback was the second copy of the memory bomb.
   */
  findRegionForPick(worldX: number, worldY: number, opts: IRegionQueryOpts = {}): RegionResult | null {
    const v2 = this.findRegionAtWithIslandsV2(worldX, worldY, opts);
    if (v2) return v2;
    if (this.lastQuery.rejection !== 'no-face') return null;
    return findRegionContainingWithIslands(
      this.doc.activeFile.entities, worldX, worldY,
      { candidateIds: new Set(this.lastQuery.candidateIds) },
    );
  }

  /* ─── Phase 2: modular pipeline (opt-in) ───────────────────────────────────
   *
   * The V2 entries run the same kind of arrangement → face extraction the V1
   * path does, but through the new modular pipeline under
   * `core/services/topology/*`. Outputs are RegionResult-compatible so the
   * hatch tool can switch over without changing its result-handling code.
   *
   * V2 is currently OPT-IN. The legacy methods above remain the default until
   * we have a parity test corpus that confirms the new pipeline produces
   * equivalent regions on real drawings. See the Phase 2 testing plan in
   * the architecture document.
   */

  /**
   * Find the smallest CCW face containing (worldX, worldY) using the modular
   * pipeline. Returns a RegionResult (outer polygon + islands + entIds), or
   * null if no closed face surrounds the click.
   *
   * The extracted face list is cached keyed by the entity-revision fingerprint
   * of the candidate set. Repeated calls with the same neighborhood (e.g.,
   * hover preview moving across the same region) skip the O(E²) graph rebuild
   * and go directly to O(F) point-location.
   */
  findRegionAtWithIslandsV2(worldX: number, worldY: number, opts: IRegionQueryOpts = {}): RegionResult | null {
    const dbg = this.debug.enabled;
    const click = { x: worldX, y: worldY };
    if (dbg) this.debug.log(`V2 enter @ (${worldX.toFixed(2)}, ${worldY.toFixed(2)})`);

    const set = this.boundarySet(worldX, worldY, opts.window ?? null);
    if (!set) {
      if (dbg) {
        this.debug.log(`V2 exit: ${this.lastQuery.rejection} (${this.lastQuery.edgeCount} edges)`);
        this.debug.capture({ click, candidateIds: this.lastQuery.candidateIds, faces: [], pickedFaceId: -1, islandFaceIds: [] });
      }
      return null;
    }
    const { entities, edges } = set;

    // Cache lookup — skip the arrangement if this boundary set is unchanged.
    const cacheKey = this._facesCacheKey(entities);
    let faces = this._getCachedFaces(cacheKey);
    if (!faces) {
      const graph = buildPlanarGraph(edges);
      faces = extractFaces(graph);
      this._setCachedFaces(cacheKey, faces);
      if (dbg) this.debug.log(`V2 graph built: ${edges.length} edges → ${faces.length} faces`);
    } else if (dbg) {
      this.debug.log(`V2 cache hit: ${faces.length} faces`);
    }

    const outer = pickFaceContaining(faces, worldX, worldY);
    if (!outer) {
      this.lastQuery = { ...this.lastQuery, rejection: 'no-face' };
      if (dbg) {
        this.debug.log(`V2 exit: no CCW face contains click (out of ${faces.length} faces)`);
        this.debug.capture({ click, candidateIds: this.lastQuery.candidateIds, faces, pickedFaceId: -1, islandFaceIds: [] });
      }
      return null;
    }

    const islandFaces = collectDirectIslands(faces, outer, worldX, worldY);
    const allEntIds = new Set<number>(outer.contributingEntityIds);
    for (const isl of islandFaces) {
      for (const id of isl.contributingEntityIds) allEntIds.add(id);
    }

    if (dbg) {
      this.debug.log(
        `V2 success: picked face #${outer.id} area=${outer.signedArea.toFixed(2)} ` +
          `ents=${Array.from(outer.contributingEntityIds).join(',')} islands=${islandFaces.length}`,
      );
      this.debug.capture({
        click,
        candidateIds: this.lastQuery.candidateIds,
        faces,
        pickedFaceId: outer.id,
        islandFaceIds: islandFaces.map((f) => f.id),
      });
    }

    return {
      polygon: outer.polygon,
      islands: islandFaces.map((f) => f.polygon),
      entIds: Array.from(allEntIds),
    };
  }

  /**
   * Choose the entities allowed to form the boundary around (x, y) and
   * extract their edges — or return null with `lastQuery.rejection` set.
   *
   * Modelled on AutoCAD's HATCH: the default boundary set is the current
   * viewport (`window`), the boundary is found by flooding out from the pick
   * point, and a set that would exceed HPMAXLINES is refused. The code this
   * replaces did the opposite — a pick in open space swept every entity
   * within ±1 000 000 units into one arrangement; on a real sheet that was
   * the whole drawing, tens of thousands of tessellated edges through an
   * all-pairs intersection pass, and a renderer that ran out of memory on
   * the first hover ("Aw, Snap!", error code 5).
   *
   *   1. Candidates: supported entities whose bbox meets the window.
   *   2. Enclosure test: four axis-aligned rays from the pick point; each
   *      must cross some candidate, else nothing can enclose the point and
   *      we stop — the common hover-over-nothing case, now an O(n) scan.
   *      The nearest crossing on each ray lies on the enclosing loop.
   *   3. Boundary set: the connected component of those hits (within the
   *      window) plus everything overlapping its extent — the islands.
   *   4. Budget: refuse over `MAX_BOUNDARY_EDGES`. Zooming in shrinks the
   *      window and with it the set, exactly as it does in AutoCAD.
   */
  private boundarySet(x: number, y: number, window: IBBox | null): { entities: Entity[]; edges: IEdge[] } | null {
    const file = this.doc.activeFile;
    const box: IBBox = window ?? { x: x - 1e6, y: y - 1e6, w: 2e6, h: 2e6 };
    const reject = (rejection: RegionRejection, candidateIds: number[] = [], edgeCount = 0): null => {
      this.lastQuery = { rejection, candidateIds, edgeCount };
      return null;
    };

    // 1. In-window candidates (bbox scan while the spatial index is still building).
    const ids = this.spatial.queryBox(box);
    let inView: Entity[];
    if (ids) {
      const idSet = new Set(ids);
      inView = file.entities.filter((e: Entity) => idSet.has(e.id) && isSupportedSource(e));
    } else {
      inView = file.entities.filter((e: Entity) => isSupportedSource(e) && boxesIntersect(safeBBox(e), box));
    }
    if (!inView.length) return reject('no-candidates');

    // 2. Enclosure test.
    resetEdgeIds();
    const edgeCache = new Map<number, IEdge[]>();
    const edgesOf = (e: Entity): IEdge[] => {
      let v = edgeCache.get(e.id);
      if (!v) { v = extractEdges(e); edgeCache.set(e.id, v); }
      return v;
    };
    const seeds = new Set<number>();
    for (const dir of AXIS_RAYS) {
      let bestDist = Infinity, bestId = -1;
      for (const e of inView) {
        const b = safeBBox(e);
        if (!b) continue;
        const lower = rayBoxDistance(x, y, dir, b);
        if (lower === null || lower >= bestDist) continue;
        for (const ed of edgesOf(e)) {
          const d = raySegmentDistance(x, y, dir, ed.p0, ed.p1);
          if (d !== null && d < bestDist) { bestDist = d; bestId = e.id; }
        }
      }
      if (bestId < 0) return reject('not-enclosed');
      seeds.add(bestId);
    }

    // 3. Boundary set: the loop's connected component plus what lies within its extent.
    const inViewIds = new Set(inView.map((e) => e.id));
    const byId = new Map(inView.map((e) => [e.id, e] as const));
    const component = (this.spatial.queryConnectedComponent(seeds, COMPONENT_GAP) ?? Array.from(seeds))
      .filter((id) => inViewIds.has(id));
    const candidateIds = new Set<number>(component);
    let ux = Infinity, uy = Infinity, ux2 = -Infinity, uy2 = -Infinity;
    for (const id of component) {
      const b = safeBBox(byId.get(id)!);
      if (!b) continue;
      if (b.x < ux) ux = b.x;
      if (b.y < uy) uy = b.y;
      if (b.x + b.w > ux2) ux2 = b.x + b.w;
      if (b.y + b.h > uy2) uy2 = b.y + b.h;
    }
    if (Number.isFinite(ux)) {
      const extent: IBBox = { x: ux, y: uy, w: ux2 - ux, h: uy2 - uy };
      const overlapping = this.spatial.queryBox(extent)
        ?? inView.filter((e) => boxesIntersect(safeBBox(e), extent)).map((e) => e.id);
      for (const id of overlapping) if (inViewIds.has(id)) candidateIds.add(id);
    }
    const entities = inView.filter((e) => candidateIds.has(e.id));

    // 4. Budget — estimate first, so a hopeless set costs no tessellation.
    let estimate = 0;
    for (const e of entities) estimate += estimateEdgeCount(e);
    if (estimate > TopologyService.MAX_BOUNDARY_EDGES) return reject('too-complex', Array.from(candidateIds), estimate);
    const edges: IEdge[] = [];
    for (const e of entities) for (const ed of edgesOf(e)) edges.push(ed);
    if (edges.length > TopologyService.MAX_BOUNDARY_EDGES) return reject('too-complex', Array.from(candidateIds), edges.length);
    if (edges.length < 3) return reject('no-candidates', Array.from(candidateIds), edges.length);

    this.lastQuery = { rejection: 'none', candidateIds: Array.from(candidateIds), edgeCount: edges.length };
    return { entities, edges };
  }

  /**
   * Discard all cached face lists. Call after a bulk import or when you
   * know the entire drawing has changed. Not normally needed — entity
   * `revision` bumps cause cache misses automatically.
   */
  clearTopologyCache(): void {
    this._faceCache.length = 0;
  }

  /* ─── Cache internals ───────────────────────────────────────────────────── */

  /** Stable fingerprint: sorted `entityId:revision` pairs joined by `|`. */
  private _facesCacheKey(entities: Entity[]): string {
    return entities
      .map((e: any) => `${e.id}:${e.revision}`)
      .sort()
      .join('|');
  }

  private _getCachedFaces(key: string): IFace[] | null {
    const entry = this._faceCache.find((e: any) => e.key === key);
    if (!entry) return null;
    entry.usedAt = ++this._cacheAge; // touch for LRU
    return entry.faces;
  }

  private _setCachedFaces(key: string, faces: IFace[]): void {
    if (this._faceCache.length >= TopologyService._CACHE_MAX) {
      // Evict the entry with the smallest (oldest) usedAt timestamp.
      let minIdx = 0;
      for (let i = 1; i < this._faceCache.length; i++) {
        if (this._faceCache[i].usedAt < this._faceCache[minIdx].usedAt) minIdx = i;
      }
      this._faceCache.splice(minIdx, 1);
    }
    this._faceCache.push({ key, faces, usedAt: ++this._cacheAge });
  }
}

/* ─── Boundary-set helpers ─────────────────────────────────────────────────── */

const AXIS_RAYS: readonly IPoint[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
/** Bbox gap (world units) that still counts as "touching" when flooding the boundary. */
const COMPONENT_GAP = 1;

function safeBBox(e: Entity): IBBox | null {
  const b = typeof e.bbox === 'function' ? e.bbox() : null;
  return b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h) ? b : null;
}

function boxesIntersect(a: IBBox | null, b: IBBox): boolean {
  if (!a) return false;
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

/** Distance along an axis ray from (x, y) to where it first meets `b`; null if it never does. */
function rayBoxDistance(x: number, y: number, dir: IPoint, b: IBBox): number | null {
  if (dir.x !== 0) {
    if (y < b.y || y > b.y + b.h) return null;
    if (dir.x > 0) return b.x + b.w < x ? null : Math.max(0, b.x - x);
    return b.x > x ? null : Math.max(0, x - (b.x + b.w));
  }
  if (x < b.x || x > b.x + b.w) return null;
  if (dir.y > 0) return b.y + b.h < y ? null : Math.max(0, b.y - y);
  return b.y > y ? null : Math.max(0, y - (b.y + b.h));
}

/**
 * Distance along an axis ray from (x, y) to its crossing with segment p0–p1;
 * null when the segment does not straddle the ray line, lies along it (the
 * other rays decide those), or crosses behind the origin.
 */
function raySegmentDistance(x: number, y: number, dir: IPoint, p0: IPoint, p1: IPoint): number | null {
  if (dir.x !== 0) {
    const a = p0.y - y, b = p1.y - y;
    if ((a > 0 && b > 0) || (a < 0 && b < 0) || a === b) return null;
    const t = a / (a - b);
    const d = (p0.x + t * (p1.x - p0.x) - x) * dir.x;
    return d >= 0 ? d : null;
  }
  const a = p0.x - x, b = p1.x - x;
  if ((a > 0 && b > 0) || (a < 0 && b < 0) || a === b) return null;
  const t = a / (a - b);
  const d = (p0.y + t * (p1.y - p0.y) - y) * dir.y;
  return d >= 0 ? d : null;
}

/** Upper bound on the edges `extractEdges` produces, without producing them. */
function estimateEdgeCount(e: Entity): number {
  const a = e as any;
  switch (a.type) {
    case 'LINE': return 1;
    case 'POLYLINE': return Math.max(0, (a.pts?.length ?? 0) - (a.closed ? 0 : 1));
    case 'CIRCLE':
    case 'ELLIPSE': return 64;
    case 'ARC': return 32;
    default: return 0;
  }
}
