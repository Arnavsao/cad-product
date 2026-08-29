import { Injectable } from '@angular/core';
import type { AiAuditRecord } from '../models/ai-audit.model';

const IDB_DB = 'cad_ai_audit_v1';
const IDB_STORE = 'records';
const IDB_VERSION = 1;
const LOCAL_QUEUE_KEY = 'cad_ai_audit_queue_v1';
const MAX_LOCAL_RECORDS = 500;   // cap to avoid localStorage bloat

/**
 * AiAuditService — append-only, local-only audit log.
 *
 * Every resolved AI turn is written here so a user can review what the
 * assistant changed. Persistence strategy:
 *   1. Primary  — IndexedDB `cad_ai_audit_v1` (survives page reloads).
 *   2. Fallback — if IDB is unavailable, a capped queue in localStorage.
 *
 * The log deliberately never leaves the browser: CADOnline is a general-purpose
 * CAD product and the assistant's actions are the user's own drafting history,
 * not telemetry. (An earlier bridge-specific build mirrored records to a
 * backend endpoint; that was removed in 1.1.0.)
 */
@Injectable({ providedIn: 'root' })
export class AiAuditService {
  private db: IDBDatabase | null = null;

  constructor() {
    this._openIdb().catch(() => { /* IDB unavailable — fall back to localStorage */ });
  }

  /** Write a single audit record (queued to IDB, or localStorage fallback). */
  write(record: AiAuditRecord): void {
    this._writeLocal(record);
  }

  /** Return the last N records from local IDB (or localStorage fallback). */
  async readRecent(limit = 50): Promise<AiAuditRecord[]> {
    if (this.db) {
      return this._readIdb(limit);
    }
    return this._readLocalStorage(limit);
  }

  // ── Local persistence ──────────────────────────────────────────────────────

  private _writeLocal(record: AiAuditRecord): void {
    if (this.db) {
      const tx = this.db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(record);
    } else {
      this._appendLocalStorage(record);
    }
  }

  private _openIdb(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(); return; }
      const req = indexedDB.open(IDB_DB, IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          store.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve();
      };
      req.onerror = () => reject();
    });
  }

  private _readIdb(limit: number): Promise<AiAuditRecord[]> {
    return new Promise((resolve) => {
      if (!this.db) { resolve([]); return; }
      const records: AiAuditRecord[] = [];
      const tx = this.db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).index('ts').openCursor(null, 'prev');
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && records.length < limit) {
          records.push(cursor.value as AiAuditRecord);
          cursor.continue();
        } else {
          resolve(records);
        }
      };
      req.onerror = () => resolve([]);
    });
  }

  private _appendLocalStorage(record: AiAuditRecord): void {
    try {
      const raw = localStorage.getItem(LOCAL_QUEUE_KEY);
      const queue: AiAuditRecord[] = raw ? JSON.parse(raw) : [];
      queue.unshift(record);
      if (queue.length > MAX_LOCAL_RECORDS) queue.length = MAX_LOCAL_RECORDS;
      localStorage.setItem(LOCAL_QUEUE_KEY, JSON.stringify(queue));
    } catch { /* storage full — swallow */ }
  }

  private _readLocalStorage(limit: number): AiAuditRecord[] {
    try {
      const raw = localStorage.getItem(LOCAL_QUEUE_KEY);
      const queue: AiAuditRecord[] = raw ? JSON.parse(raw) : [];
      return queue.slice(0, limit);
    } catch {
      return [];
    }
  }
}
