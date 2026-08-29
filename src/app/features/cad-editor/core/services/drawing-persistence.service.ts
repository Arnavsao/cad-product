import { Injectable, inject, signal } from '@angular/core';

import { DrawingStoreService } from './drawing-store.service';
import { AutosaveService } from './autosave.service';
import { DocumentManagerService } from './document-manager.service';
import { ExportService } from './export.service';
import { DxfImportService } from './dxf-import.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  QUOTA_EXCEEDED,
  newDrawingId,
  type StoredDrawing,
} from '../models/stored-drawing.model';

/**
 * Orchestrates SAVE / SAVEAS / OPEN against `DrawingStoreService`.
 *
 * `DrawingStoreService` is deliberately dumb — it only knows how to read and
 * write records. This service owns the editor-facing semantics:
 *
 *  - the tab-to-record binding, so QSAVE on an already-saved drawing
 *    overwrites in place instead of spawning a duplicate;
 *  - clearing the dirty flag and the autosave recovery record after a real
 *    save, so a saved drawing is not immediately re-snapshotted;
 *  - turning a stored DXF payload back into an open document tab.
 *
 * Storage format is DXF text — see `stored-drawing.model.ts` for why.
 */
@Injectable({ providedIn: 'root' })
export class DrawingPersistenceService {
  private store = inject(DrawingStoreService);
  private autosave = inject(AutosaveService);
  private docManager = inject(DocumentManagerService);
  private exporter = inject(ExportService);
  private importer = inject(DxfImportService);
  private notify = inject(NotificationService);

  /**
   * `DrawingDocument.tabId` → `StoredDrawing.id`.
   *
   * Held in memory only: it is a binding between an open tab and a stored
   * record, and tabs do not survive a reload. A reloaded drawing gets rebound
   * when it is opened through `openStored()`.
   */
  private tabToStored = new Map<string, string>();

  /** True while a save or open is in flight — the UI disables its buttons. */
  readonly busy = signal(false);

  /** Bumped after any store mutation so an open browser dialog re-lists. */
  readonly revision = signal(0);

  /** Whether persistence is usable at all (false in private mode / no IDB). */
  isAvailable(): boolean {
    return this.store.isAvailable();
  }

  /** The stored-record id bound to a tab, or null when never saved. */
  storedIdForTab(tabId: string | null): string | null {
    if (!tabId) return null;
    return this.tabToStored.get(tabId) ?? null;
  }

  /** True when the active document has been saved at least once. */
  activeHasStoredRecord(): boolean {
    return this.storedIdForTab(this.docManager.activeTabId) !== null;
  }

  /**
   * QSAVE / Ctrl+S. Overwrites the bound record when there is one; otherwise
   * falls back to a first save under the document's current name.
   *
   * Returns true on success. Never throws — failures surface as toasts.
   */
  async saveActive(): Promise<boolean> {
    const doc = this.docManager.activeDocument;
    if (!doc) return false;
    return this.writeActive(this.storedIdForTab(doc.tabId) ?? newDrawingId(), doc.file.name);
  }

  /**
   * SAVEAS. Always writes a NEW record under `name` and rebinds the tab to it,
   * leaving any previously saved record untouched.
   */
  async saveActiveAs(name: string): Promise<boolean> {
    const doc = this.docManager.activeDocument;
    if (!doc) return false;
    const clean = name.trim();
    if (!clean) {
      this.notify.error('Enter a name for the drawing.');
      return false;
    }
    // Keep the tab label in step with the saved name, the way AutoCAD renames
    // the document after Save As.
    doc.file.name = clean;
    return this.writeActive(newDrawingId(), clean);
  }

  /**
   * Serialise the active document and upsert it under `storedId`.
   *
   * Serialisation is synchronous and can be slow on a large drawing, so it is
   * pushed off the current frame first — otherwise the click that triggered
   * the save visibly janks before the toast appears.
   */
  private async writeActive(storedId: string, name: string): Promise<boolean> {
    const doc = this.docManager.activeDocument;
    if (!doc) return false;

    if (!this.store.isAvailable()) {
      this.notify.error('Browser storage is unavailable — use Export to save this drawing to a file.');
      return false;
    }

    this.busy.set(true);
    try {
      await new Promise((r) => setTimeout(r, 0));
      const dxf = this.exporter.buildDxfString(doc.file);

      await this.store.save({ id: storedId, name, dxf });

      this.tabToStored.set(doc.tabId, storedId);

      // Clear the dirty flag and drop this tab's recovery snapshot — an
      // explicitly saved drawing has nothing left to recover.
      this.docManager.saveDocument(doc.tabId);
      this.autosave.markClean(doc.tabId);

      this.revision.update((v) => v + 1);
      this.notify.success(`Saved "${name}".`);
      return true;
    } catch (e) {
      if (e instanceof Error && e.name === QUOTA_EXCEEDED) {
        this.notify.error(
          'Not enough browser storage to save this drawing. Delete older drawings, or export to a file.',
          8000,
        );
      } else {
        console.error('Save failed:', e);
        this.notify.error('Could not save the drawing.');
      }
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Open a stored drawing in a new tab.
   *
   * `DxfImportService.loadDxfDataAsync` builds the `DxfFile` and opens the tab
   * itself (via `AddFileCmd` → `DocumentManagerService.openDocument`), so this
   * must NOT also call `openDocument`. Because that path goes through the
   * command stack the open is undoable — and it marks the new tab dirty, which
   * is wrong for a drawing that was just loaded from storage, so the flag is
   * cleared afterwards.
   */
  async openStored(id: string): Promise<boolean> {
    this.busy.set(true);
    try {
      const rec = await this.store.get(id);
      if (!rec) {
        this.notify.error('That drawing is no longer in storage.');
        return false;
      }
      return await this.openPayload(rec.dxf, rec.name, id);
    } catch (e) {
      console.error('Open failed:', e);
      this.notify.error('Could not open the drawing.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Restore an autosave snapshot into a new tab. The restored tab is left
   * DIRTY and unbound on purpose: it is recovered work the user has not
   * committed anywhere, so it should keep prompting to be saved.
   */
  async restoreRecovery(rec: StoredDrawing): Promise<boolean> {
    this.busy.set(true);
    try {
      const ok = await this.openPayload(rec.dxf, rec.name, null);
      if (ok) {
        const restored = this.docManager.activeDocument;
        if (restored) restored.isDirty = true;
        await this.store.deleteRecovery(rec.id);
      }
      return ok;
    } catch (e) {
      console.error('Recovery failed:', e);
      this.notify.error('Could not restore the recovered drawing.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Shared open path. `bindStoredId` is the record to bind the resulting tab
   * to, or null to leave it unbound (recovery).
   */
  private async openPayload(dxf: string, name: string, bindStoredId: string | null): Promise<boolean> {
    // `loadDxfDataAsync` resolves with -1 when the payload parses to nothing;
    // only a transport/worker failure rejects. Treat both as a failed open.
    const count = await this.importer.loadDxfDataAsync(dxf, name);
    if (count <= 0) {
      this.notify.error(`"${name}" could not be read — the stored drawing may be corrupt.`);
      return false;
    }

    const opened = this.docManager.activeDocument;
    if (opened) {
      if (bindStoredId) {
        this.tabToStored.set(opened.tabId, bindStoredId);
        this.docManager.saveDocument(opened.tabId);
        this.autosave.markClean(opened.tabId);
      }
    }

    this.notify.success(`Opened "${name}".`);
    return true;
  }

  /** Delete a stored drawing and unbind any tab that pointed at it. */
  async deleteStored(id: string): Promise<void> {
    await this.store.delete(id);
    for (const [tabId, storedId] of this.tabToStored) {
      if (storedId === id) this.tabToStored.delete(tabId);
    }
    this.revision.update((v) => v + 1);
  }

  /** Rename a stored drawing; keeps an open bound tab's label in step. */
  async renameStored(id: string, name: string): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    await this.store.rename(id, clean);

    for (const [tabId, storedId] of this.tabToStored) {
      if (storedId !== id) continue;
      const doc = this.docManager.documents().find((d) => d.tabId === tabId);
      if (doc) doc.file.name = clean;
    }
    this.revision.update((v) => v + 1);
  }

  /** Duplicate a stored drawing under "<name> (copy)". */
  async duplicateStored(id: string): Promise<void> {
    await this.store.duplicate(id);
    this.revision.update((v) => v + 1);
  }
}
