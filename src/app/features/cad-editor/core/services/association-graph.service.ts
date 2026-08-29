import { Injectable, inject } from '@angular/core';
import { DocumentService } from './document.service';
import { SpatialIndexService } from './spatial-index.service';
import { DimensionEntity } from '../models/entity-extended.model';
import type { Entity, IPoint } from '../models/entity.model';

/**
 * AssociationGraphService — the topological engine for Dimensions.
 *
 * Unlike AutoCAD which uses hard-pointer reactors, this service uses a
 * combination of lazy-pull (for Move/Stretch) and spatial auto-healing
 * (for Explode/Trim).
 *
 * ## Lifecycle
 * Hooked into `DocumentService.preDrawHook` alongside `HatchRegenScheduler`.
 *
 * ## How it works
 * Every frame, we scan all DimensionEntities:
 * 1. If an anchor is attached to a LIVE entity:
 *    We update `anchor.worldPt` to the current `snapPoints()[anchor.snapIndex]`.
 *    This ensures we always have the last known good world coordinate if the
 *    entity gets deleted/exploded later.
 * 2. If an anchor points to a MISSING entity (deleted, exploded, trimmed):
 *    We use the SpatialIndex to search for any entity that has a snap point
 *    exactly at the old `anchor.worldPt`.
 *    If found, we auto-heal the associative link by updating `entityId` and
 *    `snapIndex` to the new entity. This seamlessly handles Explode (blocks/polylines)
 *    and Polyline splitting (trim in middle), without needing explicit topological
 *    event broadcasting from every command.
 */
@Injectable({ providedIn: 'root' })
export class AssociationGraphService {
  private doc = inject(DocumentService);
  private spatial = inject(SpatialIndexService);

  constructor() {
    // We register on the preDrawHook. Since HatchRegenScheduler might also
    // use it, we must ensure we don't overwrite its hook.
    // DocumentService.preDrawHook is currently a single function.
    // We can wrap it.
    const existingHook = this.doc.preDrawHook;
    this.doc.preDrawHook = () => {
      existingHook?.();
      this.syncDimensions();
    };
  }

  /**
   * Run the spatial auto-healing and state-tracking pass for all dimensions.
   */
  syncDimensions(): void {
    const file = this.doc.activeFile;
    if (!file) return;
    const entities = file.entities;

    // Fast lookup map for alive entities
    const entityMap = new Map<number, Entity>();
    for (const e of entities) entityMap.set(e.id, e);

    let needsRedraw = false;

    for (const ent of entities) {
      if (!(ent instanceof DimensionEntity)) continue;

      let healed = false;
      if (ent.anchor1) {
        healed = this.syncAnchor(ent.anchor1, entityMap, entities) || healed;
      }
      if (ent.anchor2) {
        healed = this.syncAnchor(ent.anchor2, entityMap, entities) || healed;
      }

      if (healed) {
        ent.refreshCaches();
        needsRedraw = true;
      }
    }

    if (needsRedraw) {
      // It will be drawn immediately after this hook returns, but if anything
      // relies on dirty flag, we bump version.
      this.doc.bump();
    }
  }

  private syncAnchor(
    anchor: { entityId: number; snapIndex: number; worldPt?: IPoint },
    entityMap: Map<number, Entity>,
    allEntities: Entity[],
  ): boolean {
    const target = entityMap.get(anchor.entityId);

    // 1. Entity is ALIVE
    if (target && typeof target.snapPoints === 'function') {
      const pts = target.snapPoints();
      const pt = pts[anchor.snapIndex];
      if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
        // Track the current world coordinate so we can heal later if it dies.
        anchor.worldPt = { x: pt.x, y: pt.y };
      }
      return false; // No healing was needed
    }

    // 2. Entity is DEAD (or not snappable). The dimension is an orphan.
    // If we don't have a last known world point, we can't heal it.
    if (!anchor.worldPt) return false;

    // Try to auto-heal by finding any entity with a snap point at the exact worldPt.
    // Use a tiny tolerance (floating point drift).
    const TOL = 1e-4;
    const { x, y } = anchor.worldPt;

    // Use spatial index to find candidates
    const candidateIds = new Set(
      this.spatial.queryBox({ x: x - TOL, y: y - TOL, w: TOL * 2, h: TOL * 2 })
    );

    for (const id of candidateIds) {
      const candidate = entityMap.get(id);
      if (!candidate || typeof candidate.snapPoints !== 'function') continue;

      const pts = candidate.snapPoints();
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        if (Math.hypot(pt.x - x, pt.y - y) <= TOL) {
          // Found a match! Heal the anchor.
          anchor.entityId = candidate.id;
          anchor.snapIndex = i;
          // We return true to indicate the dimension was healed and needs cache bust.
          return true;
        }
      }
    }

    // Could not heal (e.g. user completely deleted the geometry). It remains an orphan.
    return false;
  }
}
