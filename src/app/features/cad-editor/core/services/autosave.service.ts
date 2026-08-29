import { Injectable, inject, signal } from '@angular/core';
import type { DrawingDocument } from '../models/document.model';
import { StoredDrawing, recoveryIdForTab } from '../models/stored-drawing.model';
import { CommandStackService } from './command-stack.service';
import { DocumentManagerService } from './document-manager.service';
import { DrawingStoreService } from './drawing-store.service';
import { ExportService } from './export.service';

/** How often a tick runs, unless overridden via `setIntervalMs()`. */
const DEFAULT_INTERVAL_MS = 30_000;

/** Autosave lifecycle, surfaced to the UI. */
export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Debounced autosave + crash recovery.
 *
 * Design decisions:
 *  - **Interval tick is the real safety net.** `beforeunload` is best-effort —
 *    browsers routinely cut async work short on unload, and a tab killed by the
 *    OS never fires it at all. The periodic tick is what actually guarantees a
 *    recoverable snapshot exists; the unload/visibility hooks only shrink the
 *    worst-case window.
 *  - **Undo depth as the change detector.** Serialising a large drawing to DXF
 *    is O(entities) and can take tens of milliseconds. Comparing each document's
 *    undo-stack depth against the depth captured at its last snapshot means an
 *    idle tab costs one integer compare per tick instead of a full re-serialise.
 *  - **Yield between documents.** With several tabs open, back-to-back
 *    serialisation would blow a single frame budget. Each document's pass is
 *    separated by a `setTimeout(0)` so the browser can paint and handle input
 *    in between. A `running` flag drops any tick that overlaps a slow pass.
 *  - **Signals only.** The app runs `provideZonelessChangeDetection()`, so
 *    writing `status` / `lastSavedAt` is the sole mechanism that refreshes the
 *    save indicator. Nothing here relies on zone.js patching `setInterval`.
 *  - **Never throws.** An autosave failure sets `status` to `'error'` and logs;
 *    it must never surface as an exception in the editor.
 */
@Injectable({ providedIn: 'root' })
export class AutosaveService {
  private store = inject(DrawingStoreService);
  private docManager = inject(DocumentManagerService);
  private exporter = inject(ExportService);
  private cmds = inject(CommandStackService);

  // ── reactive state (bind the UI to these) ───────────────────────────────

  /** Master switch. Set to false to suspend snapshots without stopping the timer. */
  readonly enabled = signal(true);

  /** Current tick period in ms. Change it through `setIntervalMs()`. */
  readonly intervalMs = signal(DEFAULT_INTERVAL_MS);

  /** Epoch ms of the last successful snapshot pass, or null if none yet. */
  readonly lastSavedAt = signal<number | null>(null);

  /** Lifecycle for the save indicator. */
  readonly status = signal<AutosaveStatus>('idle');

  // ── internals ───────────────────────────────────────────────────────────

  private timer: ReturnType<typeof setInterval> | null = null;

  /** Guards against a tick firing while the previous pass is still working. */
  private running = false;

  /** tabId → undo-stack depth captured at that tab's last snapshot. */
  private savedDepths = new Map<string, number>();

  private readonly onVisibilityChange = (): void => {
    // Tab is being backgrounded — often the last event before it is discarded.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void this.saveNow();
    }
  };

  private readonly onBeforeUnload = (): void => {
    // Best effort only: browsers may terminate the page before these async
    // IndexedDB writes commit. Deliberately not awaited — blocking unload is
    // not possible here — which is exactly why the interval tick above exists.
    void this.saveNow();
  };

  // ── public API ──────────────────────────────────────────────────────────

  /** Begin periodic autosaving. Idempotent — calling it twice is a no-op. */
  start(): void {
    if (this.timer !== null) return;
    if (!this.store.isAvailable()) {
      console.warn('[AutosaveService] IndexedDB unavailable; autosave disabled.');
      return;
    }

    this.timer = setInterval(() => {
      void this.runPass(false);
    }, this.intervalMs());

    try {
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.onVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', this.onBeforeUnload);
      }
    } catch (e) {
      console.warn('[AutosaveService] could not attach lifecycle listeners', e);
    }
  }

  /** Stop periodic autosaving and detach the lifecycle hooks. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', this.onBeforeUnload);
      }
    } catch {
      /* ignore */
    }
  }

  /** Change the tick period, restarting the timer if it is already running. */
  setIntervalMs(ms: number): void {
    const next = Math.max(1000, Math.floor(ms) || DEFAULT_INTERVAL_MS);
    if (next === this.intervalMs()) return;
    this.intervalMs.set(next);
    if (this.timer !== null) {
      this.stop();
      this.start();
    }
  }

  /**
   * Force a snapshot pass right now, ignoring the "nothing changed since the
   * last snapshot" check. Resolves once the pass finishes (or immediately if
   * one is already in flight).
   */
  async saveNow(): Promise<void> {
    await this.runPass(true);
  }

  /** True when a previous session left unsaved work behind. */
  async hasRecovery(): Promise<boolean> {
    try {
      const records = await this.store.listRecovery();
      return records.length > 0;
    } catch (e) {
      console.warn('[AutosaveService] hasRecovery failed', e);
      return false;
    }
  }

  /** Every recovery snapshot, newest first, DXF payloads included. */
  async getRecoveryRecords(): Promise<StoredDrawing[]> {
    try {
      return await this.store.listRecovery();
    } catch (e) {
      console.warn('[AutosaveService] getRecoveryRecords failed', e);
      return [];
    }
  }

  /** Throw away every recovery snapshot — the "discard recovered work" action. */
  async discardRecovery(): Promise<void> {
    try {
      await this.store.clearRecovery();
    } catch (e) {
      console.warn('[AutosaveService] discardRecovery failed', e);
    }
  }

  /**
   * Tell autosave that a tab's work has been persisted elsewhere (an explicit
   * user save). Records the tab's current undo depth so the next tick skips it,
   * and drops its now-stale recovery snapshot.
   */
  markClean(tabId: string): void {
    if (!tabId) return;
    const doc = this.docManager.documents().find(d => d.tabId === tabId);
    this.savedDepths.set(tabId, doc ? this.depthOf(doc) : 0);
    void this.store.deleteRecovery(recoveryIdForTab(tabId));
  }

  /** Forget all tracked state (e.g. after restoring a recovery session). */
  reset(): void {
    this.savedDepths.clear();
  }

  // ── the pass ────────────────────────────────────────────────────────────

  /**
   * One autosave pass. Collects the documents that need a snapshot, then walks
   * them one at a time yielding to the event loop in between.
   *
   * @param force snapshot every dirty document, even one whose undo depth is
   *              unchanged since its last snapshot.
   */
  private async runPass(force: boolean): Promise<void> {
    if (this.running) return;               // a slow pass is still going
    if (!force && !this.enabled()) return;  // paused by the user
    if (!this.store.isAvailable()) return;

    let pending: DrawingDocument[] = [];
    try {
      pending = this.docManager.documents().filter(doc => this.needsSnapshot(doc, force));
    } catch (e) {
      console.warn('[AutosaveService] could not enumerate documents', e);
      return;
    }
    // Nothing to do — leave `status` alone so the indicator doesn't flicker.
    if (pending.length === 0) return;

    this.running = true;
    const previousStatus = this.status();
    this.status.set('saving');

    let wrote = 0;
    let failed = false;

    try {
      for (let i = 0; i < pending.length; i++) {
        if (i > 0) {
          // Yield between documents so a multi-tab pass never occupies one
          // long frame — DXF serialisation of a big drawing is not cheap.
          await new Promise<void>(r => setTimeout(r, 0));
        }
        const ok = await this.snapshot(pending[i]);
        if (ok) wrote++;
        else failed = true;
      }
    } catch (e) {
      console.warn('[AutosaveService] autosave pass failed', e);
      failed = true;
    } finally {
      this.running = false;
    }

    if (wrote > 0) {
      this.lastSavedAt.set(Date.now());
      this.status.set(failed ? 'error' : 'saved');
    } else if (failed) {
      this.status.set('error');
    } else {
      this.status.set(previousStatus);
    }
  }

  /** Serialise one document to DXF and write its recovery record. */
  private async snapshot(doc: DrawingDocument): Promise<boolean> {
    try {
      const dxf = this.exporter.buildDxfString(doc.file);
      await this.store.putRecovery({
        id: recoveryIdForTab(doc.tabId),
        tabId: doc.tabId,
        name: doc.file.name,
        dxf,
        isRecovery: true,
      });
      this.savedDepths.set(doc.tabId, this.depthOf(doc));
      return true;
    } catch (e) {
      // Includes the QuotaExceeded rethrow from the store: autosave logs it and
      // reports 'error' rather than interrupting the user mid-drawing.
      console.warn(`[AutosaveService] could not snapshot "${doc?.file?.name}"`, e);
      return false;
    }
  }

  /** A document is worth snapshotting when it is dirty and has actually moved. */
  private needsSnapshot(doc: DrawingDocument, force: boolean): boolean {
    if (!doc || !doc.file || !doc.tabId) return false;
    if (!doc.isDirty) return false;
    if (force) return true;
    const last = this.savedDepths.get(doc.tabId);
    return last === undefined || last !== this.depthOf(doc);
  }

  /**
   * Undo-stack depth for a document. `CommandStackService.getDepth()` only ever
   * reports the *active* document, so background tabs are read straight off
   * their own `cmdState` — the same array `getDepth()` looks at.
   */
  private depthOf(doc: DrawingDocument): number {
    try {
      if (doc.tabId === this.docManager.activeTabId) return this.cmds.getDepth();
      return doc.cmdState?.stack?.length ?? 0;
    } catch {
      return 0;
    }
  }
}
