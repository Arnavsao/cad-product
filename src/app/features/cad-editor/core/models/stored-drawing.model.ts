/**
 * Persistence model for drawings stored in the browser.
 *
 * Design decision: the payload is **DXF text**, not a bespoke JSON graph.
 * The editor already ships a battle-tested writer (`ExportService.buildDxfString`)
 * and reader (`DxfImportService.loadDxfDataAsync`) that round-trip layers,
 * blocks, dimstyles, linetypes and every entity type. Reusing them gives full
 * fidelity for free and keeps the stored format portable — a saved drawing is
 * a real DXF file that any CAD package can open — instead of coupling storage
 * to the private shape of 20+ entity classes.
 */

/** IndexedDB database name shared by every persistence feature in the editor. */
export const DRAWING_DB_NAME = 'aagento-cad';

/** Bump this (and add an upgrade branch) whenever the schema changes. */
export const DRAWING_DB_VERSION = 1;

/** Object store holding drawings the user explicitly saved. */
export const DRAWING_STORE = 'drawings';

/** Object store holding autosave / crash-recovery snapshots. */
export const RECOVERY_STORE = 'recovery';

/** Index on `drawings.updatedAt` — used to list newest-first without a sort. */
export const DRAWING_INDEX_UPDATED = 'by_updated';

/** Index on `recovery.tabId` — used to find the snapshot for an open tab. */
export const RECOVERY_INDEX_TAB = 'by_tab';

/** A drawing persisted to IndexedDB, payload included. */
export interface StoredDrawing {
  /** Stable uuid. Recovery records use the derived id `recovery-<tabId>`. */
  id: string;
  /** Display name, e.g. `Drawing1`. Mirrors `DxfFile.name`. */
  name: string;
  /** Full DXF text — the payload. */
  dxf: string;
  /** Optional `data:image/png` preview for the drawing browser. */
  thumbnail?: string;
  /** Epoch ms of the first write. */
  createdAt: number;
  /** Epoch ms of the most recent write. */
  updatedAt: number;
  /** `dxf.length`, denormalised so the UI can show a size without the payload. */
  byteSize: number;
  /** True for autosave / crash-recovery records. */
  isRecovery?: boolean;
  /** The `DrawingDocument.tabId` this snapshot came from (recovery only). */
  tabId?: string;

  // ── cloud mirror fields (drawings store only) ──────────────────────────
  //
  // Since the cloud-first rewrite the `drawings` store is an **offline cache
  // keyed by the remote drawing id** rather than a standalone library, so
  // `id === remoteId` for every record written by `DrawingPersistenceService`.
  // `remoteId` is kept as its own field anyway: it makes the intent explicit
  // at the call site and lets a future migration re-key the store without
  // having to guess which ids were remote. No new index is needed for any of
  // this, so `DRAWING_DB_VERSION` deliberately stays at 1 — bumping it would
  // block the upgrade behind every other open tab for zero benefit.

  /** The server-side `DrawingDto.id` this cache entry mirrors. */
  remoteId?: string;
  /** `DrawingDto.currentVersion` as of the last successful sync — the `If-Match` value. */
  version?: number;
  /**
   * True when this copy is NEWER than the server's because the save happened
   * offline. Surfaced as a "waiting to sync" hint; replay is manual (Ctrl+S
   * again) by design — see `DrawingPersistenceService`.
   */
  pendingSync?: boolean;
}

/**
 * A stored drawing minus its payload. `DrawingStoreService.list()` returns
 * these so listing 200 drawings never pulls 200 DXF strings into memory.
 */
export interface DrawingSummary extends Omit<StoredDrawing, 'dxf'> {}

/**
 * What a caller must supply to `save()` / `putRecovery()`. `id` may be omitted
 * for a brand-new drawing (the store mints one); the audit fields
 * (`createdAt` / `updatedAt` / `byteSize`) are always stamped by the store.
 */
export type StoredDrawingInput =
  Omit<StoredDrawing, 'id' | 'createdAt' | 'updatedAt' | 'byteSize'> & Partial<StoredDrawing>;

/** Error name thrown by `DrawingStoreService.save()` when the disk quota is full. */
export const QUOTA_EXCEEDED = 'QuotaExceeded';

/**
 * uuid v4 with a fallback for insecure origins / older engines, where
 * `crypto.randomUUID` is not exposed.
 */
export function newDrawingId(): string {
  try {
    const c = typeof crypto !== 'undefined' ? crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    if (c && typeof c.getRandomValues === 'function') {
      const b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const hex: string[] = [];
      for (let i = 0; i < 16; i++) hex.push(b[i].toString(16).padStart(2, '0'));
      return (
        hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' +
        hex.slice(10, 16).join('')
      );
    }
  } catch {
    /* fall through to the non-crypto path */
  }
  return 'dwg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 11);
}

/** Derive the stable recovery-record id for a document tab. */
export function recoveryIdForTab(tabId: string): string {
  return 'recovery-' + tabId;
}
