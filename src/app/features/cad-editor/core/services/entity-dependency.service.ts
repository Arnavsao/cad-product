import { Injectable } from '@angular/core';
import type { Entity } from '../models/entity.model';

/**
 * Why this service exists and what it is NOT:
 *
 *   - It is NOT an event bus.  Tools / commands do NOT push change events here.
 *   - It is NOT a change-detection mechanism for rendering.
 *
 * It is a lightweight revision-snapshot cache whose sole job is:
 *
 *   1. For every registered associative hatch, remember the `entity.revision`
 *      of each contributing entity at the last successful sync.
 *   2. On `sync()`, compare current revisions against the snapshots and mark
 *      any hatch whose hosts changed as dirty — with a reason code.
 *   3. Expose the dirty list via `drainDirty()`.
 *
 * `HatchRegenScheduler` drives the sync/drain cycle once per frame (via the
 * `DocumentService.preDrawHook`). Nothing else should call `sync()` directly.
 *
 * ## Lifetime of an entry
 *
 *   - Added lazily by the scheduler in `syncRegistry()` whenever it finds a
 *     new associative HatchEntity.
 *   - Updated by `sync()` whenever revision snapshots are refreshed.
 *   - Removed by the scheduler via `unregister()` when a hatch is deleted or
 *     disassociated (spec.associative → false).
 *
 * No Angular DI is needed here beyond the service decorator — this service
 * holds plain data structures and has no injected dependencies.
 */

export type DirtyReason = 'host-modified' | 'host-deleted';

export interface IDirtyHatch {
  hatchId: number;
  reason: DirtyReason;
}

interface IDependencyEntry {
  /** Entity id → revision at last successful sync. */
  hostRevisions: Map<number, number>;
  dirty: boolean;
  dirtyReason: DirtyReason | 'none';
}

@Injectable({ providedIn: 'root' })
export class EntityDependencyService {
  /** Primary index: hatchId → dependency state. */
  private entries = new Map<number, IDependencyEntry>();

  /** Reverse index: hostEntityId → Set of hatchIds that reference it. */
  private byHost = new Map<number, Set<number>>();

  /**
   * Register an associative hatch. Safe to call multiple times for the same
   * id — repeated calls are no-ops so the scheduler can call this unconditionally
   * on every frame for every associative hatch without cost.
   *
   * `initialEntityIds` are the contributing entity ids from `spec.contributingEntityIds`.
   * We look up their current revisions from `entities` to seed the snapshot.
   */
  register(hatchId: number, contributingEntityIds: number[], entities: Entity[]): void {
    if (this.entries.has(hatchId)) return;

    const entityMap = buildEntityMap(entities);
    const hostRevisions = new Map<number, number>();
    for (const id of contributingEntityIds) {
      const e = entityMap.get(id);
      hostRevisions.set(id, e ? e.revision : -1);
    }

    this.entries.set(hatchId, { hostRevisions, dirty: false, dirtyReason: 'none' });

    for (const id of contributingEntityIds) {
      if (!this.byHost.has(id)) this.byHost.set(id, new Set());
      this.byHost.get(id)!.add(hatchId);
    }
  }

  /** Remove all tracking data for a hatch (called when it is deleted or disassociated). */
  unregister(hatchId: number): void {
    const entry = this.entries.get(hatchId);
    if (!entry) return;
    for (const hostId of entry.hostRevisions.keys()) {
      const set = this.byHost.get(hostId);
      if (set) {
        set.delete(hatchId);
        if (set.size === 0) this.byHost.delete(hostId);
      }
    }
    this.entries.delete(hatchId);
  }

  /**
   * Walk all registered entries and detect stale revision snapshots.
   *
   * Called by `HatchRegenScheduler.flushBeforeFrame()` once per frame.
   * Cost: O(total contributing-entity references across all associative hatches).
   * In practice: total entries * average-entities-per-hatch. For 100 hatches
   * each with 4 boundary entities → 400 map lookups per frame.
   */
  sync(entities: Entity[]): void {
    if (this.entries.size === 0) return;
    const entityMap = buildEntityMap(entities);

    for (const [hatchId, entry] of this.entries) {
      if (entry.dirty) continue; // already flagged — keep reason, don't overwrite

      for (const [hostId, lastRevision] of entry.hostRevisions) {
        const current = entityMap.get(hostId);
        if (!current) {
          entry.dirty = true;
          entry.dirtyReason = 'host-deleted';
          break;
        }
        if (current.revision !== lastRevision) {
          entry.dirty = true;
          entry.dirtyReason = 'host-modified';
          // Update snapshot eagerly so we don't re-dirty on the same revision.
          entry.hostRevisions.set(hostId, current.revision);
          // Keep scanning — other hosts may also have changed but we only need
          // one hit to dirty the hatch; skip the rest for efficiency.
          break;
        }
      }

      void hatchId; // used as map key — suppress lint
    }
  }

  /**
   * Return all dirty entries and reset their dirty flags.
   * The scheduler calls this immediately after `sync()`.
   */
  drainDirty(): IDirtyHatch[] {
    const out: IDirtyHatch[] = [];
    for (const [hatchId, entry] of this.entries) {
      if (!entry.dirty) continue;
      out.push({ hatchId, reason: entry.dirtyReason as DirtyReason });
      entry.dirty = false;
      entry.dirtyReason = 'none';
    }
    return out;
  }

  /**
   * Force a hatch to be treated as newly registered on the next sync. Called
   * after an undo/redo restores a hatch spec whose contributing entity ids
   * may have changed — clearing the snapshot prevents the stale revision from
   * causing a spurious re-dirty on the next frame.
   */
  invalidate(hatchId: number): void {
    this.entries.delete(hatchId);
    // The scheduler will re-register it on the next flushBeforeFrame().
    for (const [hostId, set] of this.byHost) {
      set.delete(hatchId);
      if (set.size === 0) this.byHost.delete(hostId);
    }
  }

  /** True if a hatch id is currently tracked. */
  has(hatchId: number): boolean {
    return this.entries.has(hatchId);
  }

  /** Snapshot of contributing entity ids for a tracked hatch. Diagnostic only. */
  getHostIds(hatchId: number): number[] {
    const entry = this.entries.get(hatchId);
    if (!entry) return [];
    return Array.from(entry.hostRevisions.keys());
  }
}

function buildEntityMap(entities: Entity[]): Map<number, Entity> {
  const m = new Map<number, Entity>();
  for (const e of entities) m.set(e.id, e);
  return m;
}
