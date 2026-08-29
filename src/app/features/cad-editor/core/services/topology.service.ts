import { Injectable, inject } from '@angular/core';
import type { IPoint, Entity } from '../models/entity.model';
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
  findAllRegions(): IPoint[][] {
    return findAllRegions(this.doc.activeFile.entities);
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
  findRegionAtWithIslands(worldX: number, worldY: number): RegionResult | null {
    return findRegionContainingWithIslands(this.doc.activeFile.entities, worldX, worldY);
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
  findRegionAtWithIslandsV2(worldX: number, worldY: number): RegionResult | null {
    this.debug.log(`V2 enter @ (${worldX.toFixed(2)}, ${worldY.toFixed(2)})`);
    const candidateIds = new Set(
      this.spatial.queryConnectedComponent(
        this.spatial.queryPoint(worldX, worldY, 0),
        1,
      ),
    );
    if (candidateIds.size === 0) {
      for (const id of this.spatial.queryBox({
        x: worldX - 1e6, y: worldY - 1e6, w: 2e6, h: 2e6,
      })) {
        candidateIds.add(id);
      }
    }
    this.debug.log(`V2 candidates: ${candidateIds.size}`, Array.from(candidateIds));

    const entities = this.doc.activeFile.entities.filter(
      (e: any) => candidateIds.has(e.id) && isSupportedSource(e),
    );
    if (entities.length === 0) {
      this.debug.log('V2 exit: no supported entities in candidate set');
      this.debug.capture({
        click: { x: worldX, y: worldY },
        candidateIds: Array.from(candidateIds),
        faces: [],
        pickedFaceId: -1,
        islandFaceIds: [],
      });
      return null;
    }

    // Cache lookup — skip graph rebuild if entities haven't changed.
    const cacheKey = this._facesCacheKey(entities);
    let faces = this._getCachedFaces(cacheKey);

    if (!faces) {
      resetEdgeIds();
      const rawEdges: IEdge[] = [];
      for (const e of entities) {
        for (const ed of extractEdges(e)) rawEdges.push(ed);
      }
      if (rawEdges.length < 3) {
        this.debug.log(`V2 exit: only ${rawEdges.length} raw edges (need 3+)`);
        this.debug.capture({
          click: { x: worldX, y: worldY },
          candidateIds: Array.from(candidateIds),
          faces: [],
          pickedFaceId: -1,
          islandFaceIds: [],
        });
        return null;
      }

      const graph = buildPlanarGraph(rawEdges);
      faces = extractFaces(graph);
      this._setCachedFaces(cacheKey, faces);
      this.debug.log(`V2 graph built: ${rawEdges.length} edges → ${faces.length} faces`);
    } else {
      this.debug.log(`V2 cache hit: ${faces.length} faces`);
    }

    const outer = pickFaceContaining(faces, worldX, worldY);
    if (!outer) {
      this.debug.log(`V2 exit: no CCW face contains click (out of ${faces.length} faces)`);
      this.debug.capture({
        click: { x: worldX, y: worldY },
        candidateIds: Array.from(candidateIds),
        faces,
        pickedFaceId: -1,
        islandFaceIds: [],
      });
      return null;
    }

    const islandFaces = collectDirectIslands(faces, outer, worldX, worldY);

    const allEntIds = new Set<number>(outer.contributingEntityIds);
    for (const isl of islandFaces) {
      for (const id of isl.contributingEntityIds) allEntIds.add(id);
    }

    this.debug.log(
      `V2 success: picked face #${outer.id} area=${outer.signedArea.toFixed(2)} ` +
        `ents=${Array.from(outer.contributingEntityIds).join(',')} islands=${islandFaces.length}`,
    );
    this.debug.capture({
      click: { x: worldX, y: worldY },
      candidateIds: Array.from(candidateIds),
      faces,
      pickedFaceId: outer.id,
      islandFaceIds: islandFaces.map((f) => f.id),
    });

    return {
      polygon: outer.polygon,
      islands: islandFaces.map((f) => f.polygon),
      entIds: Array.from(allEntIds),
    };
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
