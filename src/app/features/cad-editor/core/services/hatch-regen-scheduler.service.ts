import { Injectable, inject } from '@angular/core';
import type { Entity } from '../models/entity.model';
import { HatchEntity } from '../models/entity-extended.model';
import { buildFrozenSpecFromResult } from '../models/hatch-boundary.model';
import { IHatchEdge } from '../models/entity-extended.model';
import { RegenerateHatchCmd } from '../models/command.model';
import { DocumentService } from './document.service';
import { ViewModelService } from './view-model.service';
import { CommandStackService } from './command-stack.service';
import { TopologyService } from './topology.service';
import { EntityDependencyService } from './entity-dependency.service';

/**
 * HatchRegenScheduler â€” the change-propagation engine for associative hatches.
 *
 * ## Lifecycle
 *
 * Instantiated eagerly by the canvas component (via `inject(HatchRegenScheduler)`).
 * Its constructor registers `DocumentService.preDrawHook` so `flushBeforeFrame()`
 * is called at the top of every render frame before any entity is drawn.
 *
 * ## What it does each frame
 *
 *   1. `syncRegistry` â€” scans the active file's entities. Registers new associative
 *      hatches with the dependency service; unregisters hatches that have been
 *      deleted or disassociated since the last frame.
 *   2. `deps.sync` â€” compares current entity revisions against cached snapshots
 *      to detect which hatches are stale.
 *   3. For each dirty hatch:
 *      - `host-modified`: the boundary entity moved or was reshaped. The rendered
 *        path is already correct (draw() resolves entity refs dynamically) â€” we
 *        just need to invalidate the bbox/snap-points cache so hit-testing and
 *        properties panels see the updated shape.
 *      - `host-deleted`: the boundary entity was removed. Try to re-detect a new
 *        closed region at the hatch's `seedPoint`. If found, replace the spec with
 *        a frozen polygon and disassociate. If not found, orphan the hatch (mark
 *        non-associative so the next draw() produces an empty path gracefully).
 *   4. Push a `RegenerateHatchCmd` via `commandStack.record()` for every mutated
 *      hatch so undo/redo can restore the prior spec.
 *
 * ## Why no command hooks
 *
 * Commands don't know about this service â€” adding callbacks to `IModifyEntitiesCmdHooks`
 * would spread knowledge of hatch associativity through every tool that touches
 * geometry. Instead, the scheduler pulls change information from the entity
 * `revision` counter that `refreshCaches()` already bumps universally.
 *
 * ## Undo story (Phase 4)
 *
 * Each regen is pushed as a standalone `RegenerateHatchCmd`. Undoing goes in
 * stack order: regen first, then the user's geometry edit. Both steps are
 * visible as separate undo entries. Phase 5 will bundle them atomically via
 * `CommandStackService.appendToTop()`.
 */
@Injectable({ providedIn: 'root' })
export class HatchRegenScheduler {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private cmds = inject(CommandStackService);
  private topology = inject(TopologyService);
  private deps = inject(EntityDependencyService);

  /** Set of hatch ids currently registered with the dependency service.
   *  Used by syncRegistry() to detect newly-added and freshly-deleted hatches. */
  private registeredIds = new Set<number>();

  /** Last vm.version() seen by flushBeforeFrame(). syncRegistry() only runs
   *  when this changes â€” skipping the O(n) entity scan on content-identical frames. */
  private _lastFlushVersion = -1;

  constructor() {
    // Wire ourselves into the render loop. The hook is called at the top of
    // DocumentService.drawAll() every frame, so our regens are always applied
    // before the first draw() call of the affected hatches.
    this.doc.preDrawHook = () => this.flushBeforeFrame();
  }

  /**
   * Main entry point â€” called once per render frame by DocumentService.drawAll().
   * Returns early if there are no associative hatches or nothing changed.
   */
  flushBeforeFrame(): void {
    const entities = this.doc.activeFile.entities;

    // ── Version gate for syncRegistry ──────────────────────────────────────
    // syncRegistry() creates a new Set and iterates every entity in the file
    // to find HatchEntity instances. On a 40 000-element highway drawing this
    // is pure overhead when nothing changed. Gate it on vm.version() so it only
    // runs when the content epoch actually increments (entity add/remove/modify).
    const currentVersion = this.vm.version();
    if (currentVersion !== this._lastFlushVersion) {
      this._lastFlushVersion = currentVersion;
      this.syncRegistry(entities);
    }

    if (this.registeredIds.size === 0) return;

    this.deps.sync(entities);
    const dirty = this.deps.drainDirty();
    if (dirty.length === 0) return;

    const hooks = { markDirty: () => this.vm.markContentDirty() };
    let needsRedraw = false;

    for (const { hatchId, reason } of dirty) {
      const hatch = entities.find((e: any) => e.id === hatchId) as HatchEntity | undefined;
      if (!(hatch instanceof HatchEntity) || !hatch.boundarySpec) continue;

      if (reason === 'host-modified') {
        const isAssociativeRegion = hatch.boundarySpec.associative && hatch.boundarySpec.loops?.some(l => l.frozen?.length);
        if (isAssociativeRegion && hatch.boundarySpec.seedPoint) {
          const seed = hatch.boundarySpec.seedPoint;
          const result =
            this.topology.findRegionAtWithIslandsV2(seed.x, seed.y) ??
            this.topology.findRegionAtWithIslands(seed.x, seed.y);
          if (result && result.polygon.length >= 3) {
            const newSpec = buildFrozenSpecFromResult(result, seed, hatch.boundarySpec.tolerance, hatch.boundarySpec.revision + 1);
            newSpec.associative = true;
            hatch.boundarySpec = newSpec;
            hatch.boundaryEntIds = result.entIds;
            if (hatch.boundaries) {
              hatch.boundaries = polygonToLegacyBoundaries(result.polygon, result.islands);
            }
            this.deps.unregister(hatchId);
            this.deps.register(hatchId, hatch.boundarySpec.contributingEntityIds, entities);
          }
        }

        // The draw() path resolves entity refs dynamically — no spec mutation
        // needed for single-entity associative hatches. We only need to bust the cached bbox.
        hatch.refreshCaches();
        // Bump spec.revision so any consumer that checks it sees the update.
        hatch.boundarySpec.revision++;
        needsRedraw = true;

      } else if (reason === 'host-deleted') {
        const mutated = this.handleHostDeleted(hatch, entities, hooks);
        needsRedraw = needsRedraw || mutated;
        // Un-register: it's either now frozen (no longer associative) or orphaned.
        this.deps.unregister(hatchId);
        this.registeredIds.delete(hatchId);
      }
    }

    if (needsRedraw) this.vm.markDirty();
  }

  /* â”€â”€â”€ Registry sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  /**
   * Reconcile the registered-id set against the current entity list.
   *
   *   - New associative hatches â†’ register with dependency service.
   *   - Hatches that disappeared (deleted or disassociated) â†’ unregister.
   */
  private syncRegistry(entities: Entity[]): void {
    const currentIds = new Set<number>();

    for (const e of entities) {
      if (!(e instanceof HatchEntity)) continue;
      if (!e.boundarySpec?.associative) continue;
      currentIds.add(e.id);
      if (!this.registeredIds.has(e.id)) {
        this.deps.register(e.id, e.boundarySpec.contributingEntityIds, entities);
        this.registeredIds.add(e.id);
      }
    }

    // Unregister ids that are no longer in the file or no longer associative.
    for (const id of this.registeredIds) {
      if (!currentIds.has(id)) {
        this.deps.unregister(id);
        this.registeredIds.delete(id);
      }
    }
  }

  /* â”€â”€â”€ Host-deleted handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  /**
   * A contributing entity was removed from the file. Attempt to re-detect a
   * closed region at the hatch's seed point using the remaining geometry.
   *
   *   - Re-detected: replace with a new frozen spec, disassociate.
   *   - Not found: orphan â€” mark non-associative so draw() stops trying to
   *     resolve the deleted entity ref (produces an empty, harmless path).
   *
   * Pushes a `RegenerateHatchCmd` so the transformation is undoable.
   */
  private handleHostDeleted(
    hatch: HatchEntity,
    entities: Entity[],
    hooks: { markDirty(): void },
  ): boolean {
    const spec = hatch.boundarySpec!;
    const seed = spec.seedPoint;

    const result =
      this.topology.findRegionAtWithIslandsV2(seed.x, seed.y) ??
      this.topology.findRegionAtWithIslands(seed.x, seed.y);

    const oldSpec = spec;
    const oldAssociative = hatch.associative;
    const oldBoundaryEntIds = [...hatch.boundaryEntIds];

    if (result && result.polygon.length >= 3) {
      // Re-detected a valid region without the deleted entity.
      const newSpec = buildFrozenSpecFromResult(result, seed, spec.tolerance, spec.revision + 1);
      hatch.boundarySpec = newSpec;
      hatch.associative = false;
      hatch.boundaryEntIds = [];
      // Update legacy boundaries so DXF export + old rendering path stay correct.
      hatch.boundaries = polygonToLegacyBoundaries(result.polygon, result.islands);
    } else {
      // Can't find a replacement region â€” orphan: freeze with no geometry.
      spec.associative = false;
      spec.revision++;
      hatch.associative = false;
      hatch.boundaryEntIds = [];
    }

    hatch.refreshCaches();

    // Attach to the top of the undo stack atomically with whatever user command
    // triggered the host deletion (typically DeleteEntityCmd). A single undo
    // then reverses both the delete and the hatch disassociation together.
    this.cmds.appendToTop(
      new RegenerateHatchCmd(
        hatch,
        oldSpec,
        oldAssociative,
        oldBoundaryEntIds,
        hatch.boundarySpec,
        hatch.associative,
        hooks,
      ),
    );

    return true;
  }
}

/* â”€â”€â”€ Utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/**
 * Convert a topology polygon + islands back into the legacy `IHatchEdge[][]`
 * format so export.service and older rendering paths stay in sync.
 */
function polygonToLegacyBoundaries(polygon: { x: number; y: number }[], islands: { x: number; y: number }[][]): IHatchEdge[][] {
  const toEdges = (pts: { x: number; y: number }[]): IHatchEdge[] =>
    pts.map((p, i) => ({
      type: 'LINE',
      start: { x: p.x, y: p.y },
      end:   { x: pts[(i + 1) % pts.length].x, y: pts[(i + 1) % pts.length].y },
    }));
  return [toEdges(polygon), ...islands.map(toEdges)];
}
