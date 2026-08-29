import { Injectable, inject, Injector } from '@angular/core';
import type { Entity, IBBox, IPoint } from '../models/entity.model';
import { DocumentService } from './document.service';
import { DocumentManagerService } from './document-manager.service';
import { ViewModelService } from './view-model.service';

@Injectable({ providedIn: 'root' })
export class SpatialIndexService {
  public isReady = true;
  private isBuilding = false;

  private injector = inject(Injector);
  private vm = inject(ViewModelService);
  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get docManager() { return this.injector.get(DocumentManagerService) as DocumentManagerService; }

  /** Last vm.version() value at which ensureUpToDate() ran a full entity scan.
   *  If the version hasn't changed, the entity list is unchanged — skip the scan. */
  private _lastSyncedVersion = -1;

  private get cache() { return this.docManager.activeDocument?.spatialState.cache ?? new Map(); }
  private get buckets() { return this.docManager.activeDocument?.spatialState.buckets ?? new Map(); }

  private get syncedFileId() { return this.docManager.activeDocument?.spatialState.syncedFileId ?? null; }
  private set syncedFileId(v: string | null) { if (this.docManager.activeDocument) this.docManager.activeDocument.spatialState.syncedFileId = v; }

  private get syncedVersion() { return this.docManager.activeDocument?.spatialState.syncedVersion ?? -1; }
  private set syncedVersion(v: number) { if (this.docManager.activeDocument) this.docManager.activeDocument.spatialState.syncedVersion = v; }

  private get cellSize() { return this.docManager.activeDocument?.spatialState.cellSize ?? 0; }
  private set cellSize(v: number) { if (this.docManager.activeDocument) this.docManager.activeDocument.spatialState.cellSize = v; }

  private get bucketTouches() { return this.docManager.activeDocument?.spatialState.bucketTouches ?? 0; }
  private set bucketTouches(v: number) { if (this.docManager.activeDocument) this.docManager.activeDocument.spatialState.bucketTouches = v; }

  ensureUpToDate(): void {
    if (this.isBuilding) return;
    const file = this.doc.activeFile;
    const isNewFile = file.id !== this.syncedFileId;

    // ── Version gate ─────────────────────────────────────────────────────
    // vm.version() increments on every content change (entity add/remove/modify).
    // If it hasn't changed since the last call AND the file is the same, the
    // entity list is identical — skip the O(n) revision scan entirely.
    const currentVersion = this.vm.version();
    if (!isNewFile && currentVersion === this._lastSyncedVersion && this.isReady) {
      return;
    }
    this._lastSyncedVersion = currentVersion;
    // ──────────────────────────────────────────────────────────────────

    if (isNewFile) {
      this.cache.clear();
      this.buckets.clear();
      this.bucketTouches = 0;
      this.cellSize = 0;
      this.syncedFileId = file.id;
    }

    // Trigger async background build for large new files
    if (isNewFile && file.entities.length > 5000) {
      this.isBuilding = true;
      this.isReady = false;
      setTimeout(() => this.buildInBackground(file), 0);
      return;
    }

    let added = 0;
    let updated = 0;
    let removed = 0;

    const seen = new Set<number>();
    for (const e of file.entities) {
      seen.add(e.id);
      const cached = this.cache.get(e.id);
      if (cached && cached.revision === e.revision) continue;
      const b = typeof e.fastBbox === 'function' ? e.fastBbox() : (typeof e.bbox === 'function' ? e.bbox() : null);
      if (!b || !isFiniteBBox(b)) {
        if (cached) {
          this.removeFromBuckets(e.id, cached.bbox);
          this.cache.delete(e.id);
          removed++;
        }
        continue;
      }
      if (cached) {
        this.removeFromBuckets(e.id, cached.bbox);
        this.cache.set(e.id, { bbox: b, revision: e.revision });
        updated++;
      } else {
        this.cache.set(e.id, { bbox: b, revision: e.revision });
        added++;
      }
    }

    if (this.cache.size > seen.size) {
      for (const [id, rec] of this.cache) {
        if (!seen.has(id)) {
          this.removeFromBuckets(id, rec.bbox);
          this.cache.delete(id);
          removed++;
        }
      }
    }

    const churn = added + updated + removed;
    const needRebuild =
      this.cellSize === 0 ||
      (this.cache.size > 0 && churn * 4 > this.cache.size) ||
      (this.cache.size > 0 && this.bucketTouches > this.cache.size * 8);

    if (needRebuild) {
      this.rebuildGrid();
    } else {
      for (const e of file.entities) {
        const rec = this.cache.get(e.id);
        if (!rec) continue;
        if (!this.isInGrid(e.id, rec.bbox)) {
          this.addToBuckets(e.id, rec.bbox);
        }
      }
    }
    this.isReady = true;
  }

  private async buildInBackground(file: any): Promise<void> {
    try {
      let i = 0;
      for (const e of file.entities) {
        const b = typeof e.fastBbox === 'function' ? e.fastBbox() : (typeof e.bbox === 'function' ? e.bbox() : null);
        if (b && isFiniteBBox(b)) {
          this.cache.set(e.id, { bbox: b, revision: e.revision });
        }
        i++;
        if (i % 2000 === 0) {
          await new Promise(r => setTimeout(r, 0));
          if (file.id !== this.syncedFileId) return; // User switched files
        }
      }

      this.cellSize = 0;
      this.buckets.clear();
      this.bucketTouches = 0;

      const dims: number[] = [];
      for (const { bbox } of this.cache.values()) {
        dims.push(Math.max(bbox.w, bbox.h, 1e-6));
      }
      dims.sort((a, b) => a - b);
      const median = dims[Math.floor(dims.length / 2)] || 1;
      this.cellSize = Math.max(median * 4, 1e-6);

      let j = 0;
      for (const [id, rec] of this.cache) {
        this.addToBuckets(id, rec.bbox);
        j++;
        if (j % 2000 === 0) {
          await new Promise(r => setTimeout(r, 0));
          if (file.id !== this.syncedFileId) return; // Cancelled
        }
      }
    } finally {
      this.isBuilding = false;
      if (file.id === this.syncedFileId) {
        this.isReady = true;
        const vm = this.injector.get(ViewModelService);
        if (vm) vm.markDirty();
      }
    }
  }

  invalidate(): void {
    this.cache.clear();
    this.buckets.clear();
    this.bucketTouches = 0;
    this.cellSize = 0;
    this.syncedFileId = null;
  }

  queryBox(b: IBBox): number[] | null {
    this.ensureUpToDate();
    if (!this.isReady) return null;
    return this.queryBoxInternal(b.x, b.y, b.x + b.w, b.y + b.h);
  }

  queryPoint(x: number, y: number, expand = 0): number[] | null {
    this.ensureUpToDate();
    if (!this.isReady) return null;
    return this.queryBoxInternal(x - expand, y - expand, x + expand, y + expand);
  }

  queryRay(origin: IPoint, dir: IPoint, maxDist = Infinity): number[] | null {
    this.ensureUpToDate();
    if (!this.isReady) return null;
    const xLo = dir.x >= 0 ? origin.x : origin.x - maxDist;
    const xHi = dir.x >= 0 ? origin.x + maxDist : origin.x;
    const yLo = dir.y >= 0 ? origin.y : origin.y - maxDist;
    const yHi = dir.y >= 0 ? origin.y + maxDist : origin.y;
    return this.queryBoxInternal(xLo, yLo, xHi, yHi);
  }

  queryConnectedComponent(seedIds: Iterable<number>, gap: number): number[] | null {
    this.ensureUpToDate();
    if (!this.isReady) return null;
    const accepted = new Set<number>(seedIds);
    let frontier = new Set<number>(accepted);

    while (frontier.size) {
      const next = new Set<number>();
      for (const id of frontier) {
        const rec = this.cache.get(id);
        if (!rec) continue;
        const bb = rec.bbox;
        const found = this.queryBoxInternal(
          bb.x - gap,
          bb.y - gap,
          bb.x + bb.w + gap,
          bb.y + bb.h + gap,
        );
        for (const fid of found) {
          if (!accepted.has(fid)) {
            accepted.add(fid);
            next.add(fid);
          }
        }
      }
      frontier = next;
    }
    return Array.from(accepted);
  }

  resolve(ids: Iterable<number>): Entity[] {
    const file = this.doc.activeFile;
    const idSet = new Set(ids);
    const out: Entity[] = [];
    for (const e of file.entities) {
      if (idSet.has(e.id)) out.push(e);
    }
    return out;
  }

  private cellKey(cx: number, cy: number): number {
    return ((cy + 0x8000) << 16) | (cx + 0x8000);
  }

  private rebuildGrid(): void {
    this.buckets.clear();
    this.bucketTouches = 0;

    if (this.cache.size === 0) {
      this.cellSize = 0;
      return;
    }

    const dims: number[] = [];
    for (const { bbox } of this.cache.values()) {
      dims.push(Math.max(bbox.w, bbox.h, 1e-6));
    }
    dims.sort((a, b) => a - b);
    const median = dims[Math.floor(dims.length / 2)] || 1;
    this.cellSize = Math.max(median * 4, 1e-6);

    for (const [id, rec] of this.cache) {
      this.addToBuckets(id, rec.bbox);
    }
  }

  private addToBuckets(id: number, b: IBBox): void {
    const cs = this.cellSize;
    if (cs <= 0) return;
    const cx0 = Math.floor(b.x / cs);
    const cy0 = Math.floor(b.y / cs);
    const cx1 = Math.floor((b.x + b.w) / cs);
    const cy1 = Math.floor((b.y + b.h) / cs);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = this.cellKey(cx, cy);
        let bucket = this.buckets.get(k);
        if (!bucket) { bucket = []; this.buckets.set(k, bucket); }
        bucket.push(id);
        this.bucketTouches++;
      }
    }
  }

  private removeFromBuckets(id: number, b: IBBox): void {
    const cs = this.cellSize;
    if (cs <= 0) return;
    const cx0 = Math.floor(b.x / cs);
    const cy0 = Math.floor(b.y / cs);
    const cx1 = Math.floor((b.x + b.w) / cs);
    const cy1 = Math.floor((b.y + b.h) / cs);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = this.cellKey(cx, cy);
        const bucket = this.buckets.get(k);
        if (!bucket) continue;
        const idx = bucket.indexOf(id);
        if (idx >= 0) {
          bucket.splice(idx, 1);
          this.bucketTouches--;
          if (bucket.length === 0) this.buckets.delete(k);
        }
      }
    }
  }

  private isInGrid(id: number, b: IBBox): boolean {
    const cs = this.cellSize;
    if (cs <= 0) return false;
    const cx = Math.floor(b.x / cs);
    const cy = Math.floor(b.y / cs);
    const bucket = this.buckets.get(this.cellKey(cx, cy));
    return !!bucket && bucket.indexOf(id) >= 0;
  }

  private queryBoxInternal(xMin: number, yMin: number, xMax: number, yMax: number): number[] {
    const out: number[] = [];
    const cs = this.cellSize;

    if (cs <= 0 || this.cache.size === 0) return out;

    const cx0 = Math.floor(xMin / cs);
    const cy0 = Math.floor(yMin / cs);
    const cx1 = Math.floor(xMax / cs);
    const cy1 = Math.floor(yMax / cs);
    const cellCount = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

    if (!Number.isFinite(cellCount) || cellCount > this.cache.size) {
      for (const [id, rec] of this.cache) {
        const bb = rec.bbox;
        if (bb.x + bb.w < xMin) continue;
        if (bb.x > xMax) continue;
        if (bb.y + bb.h < yMin) continue;
        if (bb.y > yMax) continue;
        out.push(id);
      }
      return out;
    }

    const seen = new Set<number>();
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this.buckets.get(this.cellKey(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const id = bucket[i];
          if (seen.has(id)) continue;
          seen.add(id);
          const rec = this.cache.get(id);
          if (!rec) continue;
          const bb = rec.bbox;
          if (bb.x + bb.w < xMin) continue;
          if (bb.x > xMax) continue;
          if (bb.y + bb.h < yMin) continue;
          if (bb.y > yMax) continue;
          out.push(id);
        }
      }
    }
    return out;
  }
}

function isFiniteBBox(b: IBBox): boolean {
  return Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h);
}
