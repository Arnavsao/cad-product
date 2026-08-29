import { Injectable } from '@angular/core';
import {
  DRAWING_DB_NAME,
  DRAWING_DB_VERSION,
  DRAWING_INDEX_UPDATED,
  DRAWING_STORE,
  DrawingSummary,
  QUOTA_EXCEEDED,
  RECOVERY_INDEX_TAB,
  RECOVERY_STORE,
  StoredDrawing,
  StoredDrawingInput,
  newDrawingId,
} from '../models/stored-drawing.model';

/**
 * Promise-based IndexedDB wrapper for persisted drawings.
 *
 * Design decisions:
 *  - **Raw IndexedDB, no `idb`/`dexie`.** The surface we need is small (two
 *    key-value stores, two indexes, a cursor scan) and a wrapper library would
 *    add a runtime dependency to a build that currently has none.
 *  - **IndexedDB, not localStorage.** DXF payloads are megabyte-scale strings;
 *    localStorage is a synchronous ~5 MB bucket that would block the render
 *    thread on every autosave.
 *  - **Failures are warnings, not exceptions.** Persistence is a background
 *    concern — private-browsing modes, disabled storage and corrupt databases
 *    must degrade to "no autosave", never to a broken editor. Every method
 *    catches and `console.warn`s, following `DrawingTransferService`'s style.
 *    The single exception is a quota overflow on `save()`, which the user has
 *    to be told about; it rethrows an `Error` whose `name` is `'QuotaExceeded'`.
 */
@Injectable({ providedIn: 'root' })
export class DrawingStoreService {
  /** Memoised open handle. Reset to null on failure so the next call retries. */
  private dbPromise: Promise<IDBDatabase> | null = null;

  // ── availability ────────────────────────────────────────────────────────

  /** False under SSR, or in browsers/modes where IndexedDB is not exposed. */
  isAvailable(): boolean {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
      return false;
    }
  }

  // ── drawings store ──────────────────────────────────────────────────────

  /**
   * Upsert a drawing. Stamps `updatedAt`, preserves `createdAt` from any
   * existing record (or stamps it on first write) and recomputes `byteSize`.
   * Returns the record as written, or `null` when storage is unavailable.
   *
   * @throws Error with `name === 'QuotaExceeded'` when the origin is out of
   *         disk quota. This is the only failure this class rethrows.
   */
  async save(record: StoredDrawingInput): Promise<StoredDrawing> {
    const stamped = this.stamp(record, false);
    await this.put(DRAWING_STORE, stamped);
    return stamped;
  }

  /** Read one drawing including its payload. `null` if missing or unreadable. */
  async get(id: string): Promise<StoredDrawing | null> {
    if (!id) return null;
    try {
      const db = await this.open();
      const tx = db.transaction(DRAWING_STORE, 'readonly');
      const value = await this.req<StoredDrawing | undefined>(
        tx.objectStore(DRAWING_STORE).get(id) as IDBRequest<StoredDrawing | undefined>,
      );
      return value ?? null;
    } catch (e) {
      console.warn('[DrawingStoreService] get failed', e);
      return null;
    }
  }

  /**
   * List every saved drawing, newest first, **without the DXF payloads**.
   *
   * Walks the `by_updated` index backwards with a cursor and strips `dxf` from
   * each record as it goes, so at most one payload is referenced at a time and
   * the returned array stays small even with hundreds of megabyte drawings.
   */
  async list(): Promise<DrawingSummary[]> {
    try {
      const db = await this.open();
      const tx = db.transaction(DRAWING_STORE, 'readonly');
      const index = tx.objectStore(DRAWING_STORE).index(DRAWING_INDEX_UPDATED);
      const out: DrawingSummary[] = [];
      await new Promise<void>((resolve, reject) => {
        const cursorReq = index.openCursor(null, 'prev');
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            resolve();
            return;
          }
          const value = cursor.value as StoredDrawing;
          if (value) {
            const { dxf, ...summary } = value;
            void dxf; // dropped on purpose — see the doc comment above
            out.push(summary as DrawingSummary);
          }
          cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error ?? new Error('cursor failed'));
      });
      return out;
    } catch (e) {
      console.warn('[DrawingStoreService] list failed', e);
      return [];
    }
  }

  /** Remove a drawing. Silently succeeds if the id is unknown. */
  async delete(id: string): Promise<void> {
    if (!id) return;
    try {
      const db = await this.open();
      const tx = db.transaction(DRAWING_STORE, 'readwrite');
      tx.objectStore(DRAWING_STORE).delete(id);
      await this.done(tx);
    } catch (e) {
      console.warn('[DrawingStoreService] delete failed', e);
    }
  }

  /** Rename a drawing in place, refreshing `updatedAt`. No-op if not found. */
  async rename(id: string, name: string): Promise<void> {
    if (!id) return;
    try {
      const existing = await this.get(id);
      if (!existing) return;
      existing.name = name;
      existing.updatedAt = Date.now();
      await this.put(DRAWING_STORE, existing);
    } catch (e) {
      if (this.isQuotaError(e)) throw e;
      console.warn('[DrawingStoreService] rename failed', e);
    }
  }

  /** Copy a drawing under a new id, named `"<name> (copy)"`. */
  async duplicate(id: string): Promise<StoredDrawing | null> {
    try {
      const existing = await this.get(id);
      if (!existing) return null;
      const copy: StoredDrawing = {
        ...existing,
        id: newDrawingId(),
        name: `${existing.name} (copy)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await this.put(DRAWING_STORE, copy);
      return copy;
    } catch (e) {
      if (this.isQuotaError(e)) throw e;
      console.warn('[DrawingStoreService] duplicate failed', e);
      return null;
    }
  }

  /** Bytes used / available for this origin, or `null` if unsupported. */
  async estimateUsage(): Promise<{ usage: number; quota: number } | null> {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
      const est = await navigator.storage.estimate();
      return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    } catch (e) {
      console.warn('[DrawingStoreService] estimateUsage failed', e);
      return null;
    }
  }

  // ── recovery store ──────────────────────────────────────────────────────

  /**
   * Upsert a crash-recovery snapshot. Same stamping rules as `save()`, but the
   * record lands in the `recovery` store and is flagged `isRecovery`.
   */
  async putRecovery(record: StoredDrawingInput): Promise<StoredDrawing> {
    const stamped = this.stamp(record, true);
    await this.put(RECOVERY_STORE, stamped);
    return stamped;
  }

  /**
   * Every recovery snapshot, payloads included — the recovery set is bounded
   * by the number of open tabs, so loading it whole is cheap.
   */
  async listRecovery(): Promise<StoredDrawing[]> {
    try {
      const db = await this.open();
      const tx = db.transaction(RECOVERY_STORE, 'readonly');
      const all = await this.req<StoredDrawing[]>(
        tx.objectStore(RECOVERY_STORE).getAll() as IDBRequest<StoredDrawing[]>,
      );
      return (all ?? []).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    } catch (e) {
      console.warn('[DrawingStoreService] listRecovery failed', e);
      return [];
    }
  }

  /** Drop one recovery snapshot (e.g. after the user restores or dismisses it). */
  async deleteRecovery(id: string): Promise<void> {
    if (!id) return;
    try {
      const db = await this.open();
      const tx = db.transaction(RECOVERY_STORE, 'readwrite');
      tx.objectStore(RECOVERY_STORE).delete(id);
      await this.done(tx);
    } catch (e) {
      console.warn('[DrawingStoreService] deleteRecovery failed', e);
    }
  }

  /** Empty the recovery store — the "discard recovered work" action. */
  async clearRecovery(): Promise<void> {
    try {
      const db = await this.open();
      const tx = db.transaction(RECOVERY_STORE, 'readwrite');
      tx.objectStore(RECOVERY_STORE).clear();
      await this.done(tx);
    } catch (e) {
      console.warn('[DrawingStoreService] clearRecovery failed', e);
    }
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** Fill in id + audit fields for an incoming record. */
  private stamp(record: StoredDrawingInput, recovery: boolean): StoredDrawing {
    const now = Date.now();
    const dxf = record.dxf ?? '';
    return {
      ...record,
      id: record.id || newDrawingId(),
      name: record.name ?? 'Untitled',
      dxf,
      createdAt: record.createdAt ?? now,
      updatedAt: now,
      byteSize: dxf.length,
      isRecovery: recovery ? true : record.isRecovery,
    };
  }

  /**
   * Write one record, preserving the stored `createdAt` when the id already
   * exists. Read + write happen in a single `readwrite` transaction so two
   * concurrent autosaves cannot interleave.
   */
  private async put(storeName: string, record: StoredDrawing): Promise<void> {
    if (!this.isAvailable()) {
      console.warn('[DrawingStoreService] IndexedDB unavailable; drawing not persisted.');
      return;
    }
    try {
      const db = await this.open();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const prior = await this.req<StoredDrawing | undefined>(
        store.get(record.id) as IDBRequest<StoredDrawing | undefined>,
      );
      if (prior?.createdAt) record.createdAt = prior.createdAt;
      store.put(record);
      await this.done(tx);
    } catch (e) {
      if (this.isQuotaError(e)) {
        console.warn('[DrawingStoreService] storage quota exceeded while saving', e);
        const err = new Error(
          'Not enough browser storage left to save this drawing. Delete some saved drawings and try again.',
        );
        err.name = QUOTA_EXCEEDED;
        throw err;
      }
      console.warn('[DrawingStoreService] save failed', e);
    }
  }

  /** True for a DOMException raised because the origin ran out of quota. */
  private isQuotaError(e: unknown): boolean {
    const err = e as { name?: string; code?: number } | null;
    if (!err) return false;
    return err.name === 'QuotaExceededError' || err.name === QUOTA_EXCEEDED || err.code === 22;
  }

  /** Adapt a single `IDBRequest` to a promise. */
  private req<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
    });
  }

  /** Resolve when a transaction commits; reject if it aborts or errors. */
  private done(tx: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  /** Lazily open (and memoise) the database, creating stores on first run. */
  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (!this.isAvailable()) {
      return Promise.reject(new Error('IndexedDB is not available in this environment.'));
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const openReq = indexedDB.open(DRAWING_DB_NAME, DRAWING_DB_VERSION);

      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains(DRAWING_STORE)) {
          const s = db.createObjectStore(DRAWING_STORE, { keyPath: 'id' });
          s.createIndex(DRAWING_INDEX_UPDATED, 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(RECOVERY_STORE)) {
          const s = db.createObjectStore(RECOVERY_STORE, { keyPath: 'id' });
          s.createIndex(RECOVERY_INDEX_TAB, 'tabId', { unique: false });
        }
      };

      // Another tab holds an older version open and blocks the upgrade.
      openReq.onblocked = () => {
        console.warn(
          '[DrawingStoreService] Database upgrade blocked by another open tab. ' +
            'Close other tabs of this app to enable saving.',
        );
      };

      openReq.onsuccess = () => {
        const db = openReq.result;
        // A newer tab requested an upgrade: let go so it can proceed.
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            /* ignore */
          }
          this.dbPromise = null;
        };
        resolve(db);
      };

      openReq.onerror = () => reject(openReq.error ?? new Error('Failed to open IndexedDB'));
    });

    // Don't cache a rejected handle — allow a later call to retry cleanly.
    this.dbPromise.catch(() => {
      this.dbPromise = null;
    });

    return this.dbPromise;
  }
}
