import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../../environments/environment';
import type { AiAuditRecord } from '../models/ai-audit.model';

const IDB_DB = 'cad_ai_audit_v1';
const IDB_STORE = 'records';
const IDB_VERSION = 1;
const LOCAL_QUEUE_KEY = 'cad_ai_audit_queue_v1';
const MAX_LOCAL_RECORDS = 500;   // cap to avoid localStorage bloat

/**
 * AiAuditService — append-only audit log.
 *
 * Every resolved AI turn is written here.  Persistence strategy:
 *   1. Primary  — POST to the backend (`/api/v1/ai/audit`), fire-and-forget.
 *   2. Fallback — IndexedDB `cad_ai_audit_v1` (survives page reloads).
 *   3. Overflow — if IDB is unavailable, a capped queue in localStorage.
 *
 * The backend call is a best-effort fire-and-forget (no await, no retry) so
 * it never blocks the UI.  Local storage is always written first, providing
 * an offline-capable audit trail that can be replayed later.
 */
@Injectable({ providedIn: 'root' })
export class AiAuditService {
  private http = inject(HttpClient);
  private db: IDBDatabase | null = null;

  constructor() {
    this._openIdb().catch(() => { /* IDB unavailable — fall back to localStorage */ });
  }

  /**
   * Write a single audit record.
   * Local write is synchronous-like (queued to IDB); backend POST is async.
   */
  write(record: AiAuditRecord): void {
    this._writeLocal(record);
    this._postBackend(record);
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

  // ── Backend POST ───────────────────────────────────────────────────────────

  private _postBackend(record: AiAuditRecord): void {
    if (!environment.apiUrl) return; // no backend configured — local queue only
    const url = `${environment.apiUrl.replace(/\/+$/, '')}/ai/audit`;
    // Fire-and-forget — don't let a backend failure surface to the user.
    this.http.post(url, record).subscribe({
      error: () => { /* intentionally silent */ },
    });
  }
}
