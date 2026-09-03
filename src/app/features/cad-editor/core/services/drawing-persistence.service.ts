import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { last } from 'rxjs/operators';

import type { AccessLevel } from '../../../../core/api/api.models';
import { DrawingsApiService } from '../../../../core/api/drawings-api.service';
import { ApiError } from '../../../../core/services/http-manager.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { UiDialogService } from '../../../../shared/ui/dialog/ui-dialog.service';
import { DrawingBrowserService } from '../../features/drawing-browser/drawing-browser.service';
import type { DrawingDocument } from '../models/document.model';
import { QUOTA_EXCEEDED, type StoredDrawing } from '../models/stored-drawing.model';
import { AutosaveService } from './autosave.service';
import { DocumentManagerService } from './document-manager.service';
import { DrawingStoreService } from './drawing-store.service';
import { DxfImportService } from './dxf-import.service';
import { ExportService } from './export.service';
import { ThumbnailService } from './thumbnail.service';

/**
 * Largest payload `PUT /drawings/:id/content` accepts inline. Anything bigger
 * goes through the presign → storage PUT → complete handshake instead.
 */
const MAX_INLINE_BYTES = 5 * 1024 * 1024;

/** Hard ceiling for a cloud save of any kind (matches the server's upload cap). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Cloud save lifecycle, surfaced in the editor header. */
export type CloudState = 'clean' | 'dirty' | 'saving' | 'saved' | 'offline' | 'conflict' | 'readonly';

/** What an open tab is bound to on the server. */
export interface RemoteBinding {
  id: string;
  /** `currentVersion` as of the last successful read/write — the `If-Match` value. */
  version: number;
  name: string;
  folderId: string | null;
  /**
   * Workspace the drawing lives in: `null` for personal, an org id otherwise.
   * Save As and the conflict "Save as copy" default to it, so forking an org
   * drawing at the root no longer silently lands in the personal workspace.
   */
  organizationId: string | null;
  /**
   * What the caller may do with this drawing. Defaulted to `manage` when the
   * server does not send it (an API older than the sharing release), which is
   * the behaviour that predates read-only access: anything you could open you
   * could also save.
   */
  access: AccessLevel;
}

/**
 * Cloud-first persistence for the editor: SAVE / SAVE AS / OPEN against the
 * CADOnline API, with IndexedDB demoted to an offline cache.
 *
 * Design decisions:
 *
 *  - **Cloud saves are explicit** (Ctrl+S, the header button, the close
 *    prompts) — there is deliberately no periodic push. Every `PUT …/content`
 *    mints a new server-side version, so a 30-second timer would burn storage
 *    and bandwidth and would make 409s unpredictable when the same drawing is
 *    open in two tabs. Crash safety is `AutosaveService`'s job: it keeps a
 *    local recovery snapshot on the same cadence as before.
 *
 *  - **Optimistic concurrency, not last-write-wins.** Each binding remembers
 *    the version it loaded and sends it as `If-Match`. The server answers 409
 *    `VERSION_CONFLICT` rather than clobbering a newer save, and the user picks
 *    Overwrite / Save as copy / Reload. Force-saving simply omits `If-Match`.
 *
 *  - **Offline degrades to the cache, and stays there.** A network failure
 *    writes the DXF to IndexedDB with `pendingSync: true` and says so. Replay
 *    is manual (press Ctrl+S again) because an automatic background replay
 *    would push a stale payload over whatever happened server-side while the
 *    user was away — exactly the conflict the version check exists to prevent.
 *
 *  - **View-only access is a prompt, not a lock.** A drawing reached through a
 *    `view` share (or owned by an org where the caller is a viewer) still opens
 *    in a fully working editor — tools stay live, because half-disabling a CAD
 *    editor is worse than letting someone draw and then telling them where the
 *    result can go. Every save path instead funnels into one "save a copy"
 *    dialog, and a server 403 is mapped to the same dialog so a permission that
 *    changed while the tab was open behaves identically.
 *
 *  - **The `drawings` object store is keyed by the remote id.** It is now a
 *    read-through cache of cloud drawings plus the offline queue, not a
 *    separate local library; the dashboard owns file management (rename,
 *    duplicate, delete), so none of that lives here any more.
 */
@Injectable({ providedIn: 'root' })
export class DrawingPersistenceService {
  private store = inject(DrawingStoreService);
  private autosave = inject(AutosaveService);
  private docManager = inject(DocumentManagerService);
  private exporter = inject(ExportService);
  private importer = inject(DxfImportService);
  private notify = inject(NotificationService);
  private api = inject(DrawingsApiService);
  private dialog = inject(UiDialogService);
  private router = inject(Router);
  private browser = inject(DrawingBrowserService);
  private thumbnails = inject(ThumbnailService);

  /**
   * `DrawingDocument.tabId` → the drawing it is bound to on the server.
   *
   * In memory only: tabs do not survive a reload, and the URL (`/editor/:id`)
   * is what re-establishes the binding on the next visit through `openRemote`.
   */
  private tabToRemote = new Map<string, RemoteBinding>();

  /** Bumped on every `tabToRemote` mutation so `cloudState` re-evaluates. */
  private bindings = signal(0);

  /** Transient phase of the current operation; 'idle' defers to the dirty flag. */
  private phase = signal<'idle' | 'saving' | 'offline' | 'conflict'>('idle');

  /** True while a save or open is in flight — the UI disables its buttons. */
  readonly busy = signal(false);

  /** Bumped after any store/cloud mutation so an open browser dialog re-lists. */
  readonly revision = signal(0);

  /** Epoch ms of the last successful cloud save, or null if none this session. */
  readonly lastCloudSaveAt = signal<number | null>(null);

  /**
   * What the header shows. Derived rather than assigned so that simply drawing
   * a line (which flips `isDirty` and re-emits the documents signal) moves the
   * label to "Unsaved changes" without persistence having to observe edits.
   *
   * `readonly` outranks `dirty` deliberately: on a view-only drawing "Unsaved
   * changes" reads as a promise that Ctrl+S will honour it, when in fact the
   * only way out is a copy. The transient phases still win, so an in-flight
   * "save a copy" of a view-only drawing shows "Saving…".
   */
  readonly cloudState = computed<CloudState>(() => {
    const phase = this.phase();
    if (phase !== 'idle') return phase;

    // Track both signals so tab switches and edits re-evaluate.
    const docs = this.docManager.documents();
    const activeId = this.docManager.activeTabId;
    const doc = docs.find((d) => d.tabId === activeId);
    if (!doc) return 'clean';

    this.bindings();
    const bound = this.tabToRemote.get(doc.tabId);
    if (bound?.access === 'view') return 'readonly';
    if (doc.isDirty) return 'dirty';

    if (!bound) return 'clean';
    return this.lastCloudSaveAt() !== null ? 'saved' : 'clean';
  });

  constructor() {
    // Close prompts used to call `DocumentManagerService.saveDocument()`, which
    // only cleared the dirty flag — answering "Yes" silently threw the drawing
    // away. Route it at the real save instead, and let a failed save veto the
    // close.
    this.docManager.setSaveHandler((tabId) => this.saveTab(tabId));
  }

  // ── bindings ────────────────────────────────────────────────────────────

  /** Whether the local offline cache is usable (false in private mode / no IDB). */
  isAvailable(): boolean {
    return this.store.isAvailable();
  }

  /** The server binding for a tab, or null when the tab was never saved. */
  remoteForTab(tabId: string | null): RemoteBinding | null {
    if (!tabId) return null;
    this.bindings();
    return this.tabToRemote.get(tabId) ?? null;
  }

  /** The remote drawing id bound to a tab, or null. */
  remoteIdForTab(tabId: string | null): string | null {
    return this.remoteForTab(tabId)?.id ?? null;
  }

  /** True when the active document is bound to a cloud drawing. */
  activeIsBound(): boolean {
    return this.remoteForTab(this.docManager.activeTabId) !== null;
  }

  /**
   * The caller's access to the drawing a tab is bound to. An unbound tab is
   * local work nobody else can restrict, so it answers `manage`.
   */
  accessForTab(tabId: string | null): AccessLevel {
    return this.remoteForTab(tabId)?.access ?? 'manage';
  }

  /** True when the active tab is bound to a drawing the caller may only view. */
  activeIsReadOnly(): boolean {
    return this.accessForTab(this.docManager.activeTabId) === 'view';
  }

  /** The tab currently showing `drawingId`, or null when it is not open. */
  tabForRemoteId(drawingId: string): string | null {
    this.bindings();
    for (const [tabId, bound] of this.tabToRemote) {
      if (bound.id === drawingId) return tabId;
    }
    return null;
  }

  /** True when any open document has unsaved edits (drives the deactivate guard). */
  anyDirty(): boolean {
    return this.docManager.documents().some((d) => d.isDirty);
  }

  // ── saving ──────────────────────────────────────────────────────────────

  /**
   * QSAVE / Ctrl+S on the active document. An unbound drawing has no server
   * record yet, so it falls through to Save As (which resolves once the dialog
   * is done, so callers can treat this as "did the drawing get saved?").
   */
  async saveActive(): Promise<boolean> {
    const doc = this.docManager.activeDocument;
    if (!doc) return false;

    const bound = this.tabToRemote.get(doc.tabId);
    if (!bound) return this.browser.openAndWait('save');
    if (bound.access === 'view') return this.offerSaveCopy(doc, bound);

    return this.pushToCloud(doc, bound, false);
  }

  /**
   * Save a specific tab. Used by the tab context menu, the close prompt and
   * `saveAll()`. Serialisation reads `doc.file` directly, so a background tab
   * saves without being activated — except when it is unbound, where Save As
   * needs it in front of the user.
   */
  async saveTab(tabId: string): Promise<boolean> {
    const doc = this.docManager.documents().find((d) => d.tabId === tabId);
    if (!doc) return false;

    const bound = this.tabToRemote.get(tabId);
    if (!bound) {
      if (this.docManager.activeTabId !== tabId) this.docManager.activateDocument(tabId);
      return this.browser.openAndWait('save');
    }
    if (bound.access === 'view') return this.offerSaveCopy(doc, bound);

    return this.pushToCloud(doc, bound, false);
  }

  /**
   * Save every dirty document, stopping at the first failure — the unsaved
   * changes guard needs "did everything reach the cloud?", and continuing past
   * a cancelled Save As would surprise the user with more dialogs.
   */
  async saveAll(): Promise<boolean> {
    for (const doc of [...this.docManager.documents()]) {
      if (!doc.isDirty) continue;
      const ok = await this.saveTab(doc.tabId);
      if (!ok) return false;
    }
    return true;
  }

  /**
   * SAVE AS — create a brand-new cloud drawing from the active document and
   * rebind the tab to it. The URL is rewritten in place: `/editor` and
   * `/editor/:id` are one route (see `editorMatcher`), so `replaceUrl` binds
   * the address to the new drawing without remounting the editor and tearing
   * down tools, autosave and every other open tab.
   *
   * @param folderId destination folder, or null for the workspace root.
   * @param organizationId destination workspace — null for personal, an org id
   *        otherwise. The server ignores it when `folderId` is given (the
   *        folder already decides the workspace), so callers may pass both.
   */
  async saveActiveAs(
    name: string,
    folderId: string | null = null,
    organizationId: string | null = null,
  ): Promise<boolean> {
    const doc = this.docManager.activeDocument;
    if (!doc) return false;

    const clean = name.trim();
    if (!clean) {
      this.notify.error('Enter a name for the drawing.');
      return false;
    }

    this.busy.set(true);
    this.phase.set('saving');
    try {
      const dxf = await this.serialise(doc);
      const bytes = byteLength(dxf);
      if (bytes > MAX_UPLOAD_BYTES) {
        this.tooLarge(bytes);
        return false;
      }

      // Keep the tab label in step with the saved name, the way AutoCAD
      // renames the document after Save As.
      doc.file.name = clean;

      // Oversized payloads cannot ride along in the JSON create body; make the
      // drawing first (server blank template) and push the real content
      // through the staged-upload path.
      const inline = bytes <= MAX_INLINE_BYTES;
      const created = await this.api.create({
        name: clean,
        folderId,
        organizationId,
        ...(inline ? { initialDxf: dxf } : {}),
      });

      const bound: RemoteBinding = {
        id: created.id,
        version: created.currentVersion,
        name: created.name,
        folderId: created.folderId,
        organizationId: created.organizationId,
        access: created.access ?? 'manage',
      };
      this.bind(doc.tabId, bound);

      if (!inline) {
        const result = await this.uploadLarge(bound.id, dxf, bytes, bound.version);
        bound.version = result.version;
      }

      await this.afterSaved(doc, bound, dxf);
      this.notify.success(`Saved "${bound.name}".`);

      if (this.docManager.activeTabId === doc.tabId) {
        void this.router.navigate(['/editor', bound.id], { replaceUrl: true });
      }
      return true;
    } catch (e) {
      return this.handleSaveFailure(e, doc, null);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Serialise `doc` and write it over its bound drawing.
   *
   * @param force omit `If-Match`, i.e. deliberately overwrite whatever version
   *              the server currently holds (the "Overwrite" conflict answer).
   */
  private async pushToCloud(doc: DrawingDocument, bound: RemoteBinding, force: boolean): Promise<boolean> {
    this.busy.set(true);
    this.phase.set('saving');
    let dxf = '';
    try {
      dxf = await this.serialise(doc);
      const bytes = byteLength(dxf);
      if (bytes > MAX_UPLOAD_BYTES) {
        this.tooLarge(bytes);
        return false;
      }

      const ifMatch = force ? null : bound.version;
      const result =
        bytes <= MAX_INLINE_BYTES
          ? await this.api.putContent(bound.id, dxf, ifMatch)
          : await this.uploadLarge(bound.id, dxf, bytes, ifMatch);

      bound.version = result.version;
      this.bindings.update((v) => v + 1);
      await this.afterSaved(doc, bound, dxf);
      this.notify.success(`Saved "${bound.name}".`);
      return true;
    } catch (e) {
      return this.handleSaveFailure(e, doc, bound, dxf);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Staged upload for a payload too large for the inline `PUT`: reserve a
   * staging key, push the bytes straight to storage (no bearer token — the URL
   * is presigned), then ask the API to commit it as the next version. The
   * `If-Match` check happens at commit time, so a conflict is still detected.
   */
  private async uploadLarge(id: string, dxf: string, bytes: number, ifMatch: number | null) {
    const presigned = await this.api.presignContent(id, bytes);
    const blob = new Blob([dxf], { type: 'text/plain; charset=utf-8' });
    await firstValueFrom(this.api.uploadToStorage(presigned.uploadUrl, blob, 'text/plain; charset=utf-8').pipe(last()));
    return this.api.completeContent(id, presigned.key, bytes, ifMatch);
  }

  /**
   * Branch a save failure into conflict / offline / everything else.
   *
   * @param bound null for a Save As (there is nothing to conflict with yet).
   */
  private async handleSaveFailure(
    e: unknown,
    doc: DrawingDocument,
    bound: RemoteBinding | null,
    dxf = '',
  ): Promise<boolean> {
    if (bound && e instanceof ApiError && e.status === 409) {
      return this.resolveConflict(doc, bound, dxf, e);
    }
    if (e instanceof ApiError && e.status === 403) {
      return this.handleForbidden(doc, bound);
    }
    if (isOffline(e)) {
      return this.cacheOffline(doc, bound, dxf);
    }

    console.error('Cloud save failed:', e);
    this.phase.set('idle');
    this.notify.error(e instanceof ApiError ? e.message : 'Could not save the drawing.');
    return false;
  }

  /**
   * 409 `VERSION_CONFLICT` — someone saved this drawing after we loaded it.
   * Four honest choices; nothing is decided for the user, because each option
   * loses something different.
   */
  private async resolveConflict(
    doc: DrawingDocument,
    bound: RemoteBinding,
    dxf: string,
    error: ApiError,
  ): Promise<boolean> {
    this.phase.set('conflict');

    const serverVersion = readCurrentVersion(error);
    const choice = await this.dialog.choose({
      title: 'This drawing changed elsewhere',
      message:
        `"${bound.name}" was saved from another tab or device after you opened it` +
        (serverVersion !== null ? ` (server is now at version ${serverVersion}, you have ${bound.version})` : '') +
        '. Choose how to continue — your edits are still here either way.',
      actions: [
        { id: 'overwrite', label: 'Overwrite', variant: 'danger' },
        { id: 'reload', label: 'Reload latest', variant: 'secondary' },
        { id: 'copy', label: 'Save as copy', variant: 'primary' },
      ],
    });

    switch (choice) {
      case 'overwrite':
        return this.pushToCloud(doc, bound, true);

      case 'copy': {
        // Fork the tab onto a fresh drawing so neither side's work is lost.
        // The copy stays in the source folder *and* the source workspace — a
        // conflict copy of an org drawing belongs next to the drawing it forked
        // from, not in the author's personal files.
        const previousActive = this.docManager.activeTabId;
        if (previousActive !== doc.tabId) this.docManager.activateDocument(doc.tabId);
        return this.saveActiveAs(`${bound.name} (conflict copy)`, bound.folderId, bound.organizationId);
      }

      case 'reload':
        return this.openRemote(bound.id, { replaceTab: doc.tabId });

      default:
        // Cancelled: leave the tab dirty and the state visibly conflicted.
        this.notify.warning('Save cancelled — this drawing is still out of date with the server.', 6000);
        return false;
    }
  }

  /**
   * The one exit from a view-only drawing: fork the edits into a new drawing in
   * the caller's own files, where they certainly may write.
   *
   * The copy goes to My Drawings root (`folderId` and `organizationId` both
   * null) rather than beside the original: the folder the original sits in
   * belongs to whoever shared it, so it is the one place the caller is *known*
   * not to have write access to.
   */
  private async offerSaveCopy(doc: DrawingDocument, bound: RemoteBinding): Promise<boolean> {
    this.phase.set('idle');

    const choice = await this.dialog.choose({
      title: `View only — "${bound.name}"`,
      message: 'This drawing is view-only — Save a copy to My Drawings?',
      actions: [{ id: 'copy', label: 'Save a copy', variant: 'primary' }],
      cancelLabel: 'Cancel',
    });
    if (choice !== 'copy') return false;

    // `saveActiveAs` works on the active document, so a background tab (close
    // prompt, Save all) has to come forward first.
    if (this.docManager.activeTabId !== doc.tabId) this.docManager.activateDocument(doc.tabId);
    return this.saveActiveAs(`${bound.name} (copy)`, null, null);
  }

  /**
   * 403 `FORBIDDEN` — the server refused the write. Either the binding was
   * created before the sharing release (no `access` to go on) or the caller's
   * permission was downgraded while the tab was open. Believe the server,
   * remember it on the binding so the header stops advertising Ctrl+S, and
   * offer the same copy as the read-only path.
   */
  private async handleForbidden(doc: DrawingDocument, bound: RemoteBinding | null): Promise<boolean> {
    if (!bound) {
      // A Save As, i.e. the *destination* workspace refused the create. There
      // is nothing to fork here — the user has to pick somewhere else.
      this.phase.set('idle');
      this.notify.error('You do not have permission to save into that workspace.', 7000);
      return false;
    }

    bound.access = 'view';
    this.bindings.update((v) => v + 1);
    return this.offerSaveCopy(doc, bound);
  }

  /**
   * No network. Keep the work in IndexedDB flagged `pendingSync` and tell the
   * user how to push it: pressing Ctrl+S again once the connection is back
   * runs the normal versioned save, conflict checks included.
   */
  private async cacheOffline(doc: DrawingDocument, bound: RemoteBinding | null, dxf: string): Promise<boolean> {
    this.phase.set('offline');
    try {
      const payload = dxf || (await this.serialise(doc));
      await this.store.save({
        id: bound?.id ?? `offline-${doc.tabId}`,
        remoteId: bound?.id,
        version: bound?.version,
        name: bound?.name ?? doc.file.name,
        dxf: payload,
        pendingSync: true,
      });
      this.revision.update((v) => v + 1);
      this.notify.warning(
        `You're offline — "${doc.file.name}" was saved locally. Press Ctrl+S again when you're back online.`,
        9000,
      );
    } catch (e) {
      if (e instanceof Error && e.name === QUOTA_EXCEEDED) {
        this.notify.error(
          'You are offline and this browser is out of storage — use Export to write a DXF file before closing the tab.',
          9000,
        );
      } else {
        console.error('Offline cache failed:', e);
        this.notify.error('You are offline and the drawing could not be cached — use Export to write a DXF file.', 9000);
      }
    }
    // Not saved to the cloud, so the tab stays dirty and the caller sees false.
    return false;
  }

  /** Post-save bookkeeping shared by every successful write path. */
  private async afterSaved(doc: DrawingDocument, bound: RemoteBinding, dxf: string): Promise<void> {
    // Clear the dirty flag and drop this tab's recovery snapshot — an
    // explicitly saved drawing has nothing left to recover.
    this.docManager.saveDocument(doc.tabId);
    this.autosave.markClean(doc.tabId);

    this.lastCloudSaveAt.set(Date.now());
    this.phase.set('idle');
    this.revision.update((v) => v + 1);

    await this.cache(bound, dxf);
    this.thumbnails.scheduleThumbnail(bound.id, doc.tabId);
  }

  /** Mirror a known-synced payload into the offline cache. Never throws. */
  private async cache(bound: RemoteBinding, dxf: string): Promise<void> {
    try {
      await this.store.save({
        id: bound.id,
        remoteId: bound.id,
        version: bound.version,
        name: bound.name,
        dxf,
        pendingSync: false,
      });
    } catch (e) {
      // A full disk must not fail a save that already reached the cloud.
      console.warn('[DrawingPersistenceService] offline cache write failed', e);
    }
  }

  // ── opening ─────────────────────────────────────────────────────────────

  /**
   * Open a cloud drawing in a tab.
   *
   * @param opts.replaceTab close this tab once the fresh copy is open (the
   *        "Reload latest" answer to a conflict).
   */
  async openRemote(id: string, opts: { replaceTab?: string } = {}): Promise<boolean> {
    if (!id) return false;

    // Already open: just bring it forward rather than opening a second tab on
    // the same drawing, which would immediately conflict with itself.
    const existingTab = this.tabForRemoteId(id);
    if (existingTab && existingTab !== opts.replaceTab) {
      this.docManager.activateDocument(existingTab);
      return true;
    }

    this.busy.set(true);
    try {
      const dto = await this.api.get(id);
      const dxf = await this.api.fetchContent(dto.downloadUrl);

      const bound: RemoteBinding = {
        id: dto.id,
        version: dto.currentVersion,
        name: dto.name,
        folderId: dto.folderId,
        organizationId: dto.organizationId,
        access: dto.access ?? 'manage',
      };
      const ok = await this.openPayload(dxf, dto.name, bound, opts.replaceTab);
      if (ok) await this.cache(bound, dxf);
      return ok;
    } catch (e) {
      return this.handleOpenFailure(e, id, opts.replaceTab);
    } finally {
      this.busy.set(false);
    }
  }

  private async handleOpenFailure(e: unknown, id: string, replaceTab?: string): Promise<boolean> {
    if (e instanceof ApiError && e.status === 404) {
      this.notify.error('That drawing no longer exists, or you do not have access to it.', 7000);
      void this.router.navigateByUrl('/dashboard');
      return false;
    }

    // Anything else (offline, 5xx): fall back to the cached copy if we have
    // one, clearly labelled, so the user can keep working on the plane.
    const cached = await this.store.get(id);
    if (cached) {
      // The cache never recorded a workspace or an access level, and guessing
      // `view` here would block the offline save of a drawing the user owns.
      // `manage` is the optimistic answer; the server's 403 corrects it.
      const bound: RemoteBinding = {
        id,
        version: cached.version ?? 0,
        name: cached.name,
        folderId: null,
        organizationId: null,
        access: 'manage',
      };
      const ok = await this.openPayload(cached.dxf, cached.name, bound, replaceTab);
      if (ok) {
        this.phase.set('offline');
        this.notify.warning(
          `Offline — opened the local copy of "${cached.name}". Changes will not reach the cloud until you reconnect.`,
          9000,
        );
      }
      return ok;
    }

    console.error('Open failed:', e);
    this.notify.error(e instanceof ApiError ? e.message : 'Could not open the drawing.');
    return false;
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
   * Shared open path. `bound` is the drawing to bind the resulting tab to, or
   * null to leave it unbound (recovery).
   */
  private async openPayload(
    dxf: string,
    name: string,
    bound: RemoteBinding | null,
    replaceTab?: string,
  ): Promise<boolean> {
    // `loadDxfDataAsync` resolves with -1 when the payload could not be read
    // and with the entity count otherwise. Zero is NOT a failure: a brand-new
    // cloud drawing is a valid, empty DXF, and testing `<= 0` here used to
    // make every blank drawing impossible to open.
    const count = await this.importer.loadDxfDataAsync(dxf, name);
    if (count < 0) {
      this.notify.error(`"${name}" could not be read — the file may be corrupt.`);
      return false;
    }

    const opened = this.docManager.activeDocument;
    if (!opened) return false;

    // Reload-latest: drop the stale tab now that its replacement is up.
    if (replaceTab && replaceTab !== opened.tabId) {
      this.unbind(replaceTab);
      await this.docManager.closeDocument(replaceTab, true);
    }

    // Retire the untouched `Drawing1` the editor boots with.
    this.docManager.closeBlankDocuments(opened.tabId);

    if (bound) {
      this.bind(opened.tabId, bound);
      // The import went through the undoable `AddFileCmd`, which marks the new
      // tab dirty — wrong for a drawing that was just loaded unmodified.
      this.docManager.saveDocument(opened.tabId);
      this.autosave.markClean(opened.tabId);
      this.phase.set('idle');
    }

    this.notify.success(`Opened "${name}".`);
    return true;
  }

  // ── internals ───────────────────────────────────────────────────────────

  private bind(tabId: string, bound: RemoteBinding): void {
    this.tabToRemote.set(tabId, bound);
    this.bindings.update((v) => v + 1);
  }

  private unbind(tabId: string): void {
    if (this.tabToRemote.delete(tabId)) this.bindings.update((v) => v + 1);
  }

  /**
   * Serialise a document to DXF off the current frame. Serialisation is
   * synchronous and O(entities); running it inline would visibly jank the
   * click or keystroke that started the save before any feedback appears.
   */
  private async serialise(doc: DrawingDocument): Promise<string> {
    await new Promise((r) => setTimeout(r, 0));
    return this.exporter.buildDxfString(doc.file);
  }

  private tooLarge(bytes: number): void {
    this.phase.set('idle');
    this.notify.error(
      `This drawing is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB cloud limit — ` +
        'use Plot → Export to write it to a DXF file instead.',
      9000,
    );
  }
}

/** UTF-8 byte length — DXF text can carry non-ASCII in names and MTEXT. */
function byteLength(text: string): number {
  return new Blob([text]).size;
}

/** True for a request that never reached the server (dropped connection, offline). */
function isOffline(e: unknown): boolean {
  if (e instanceof ApiError && e.status === 0) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Pull `currentVersion` out of a 409 envelope when the server supplies it. */
function readCurrentVersion(e: ApiError): number | null {
  const body = e.body;
  if (!body || typeof body !== 'object') return null;
  const direct = (body as { currentVersion?: unknown })['currentVersion'];
  if (typeof direct === 'number') return direct;
  const data = (body as { data?: unknown })['data'];
  if (data && typeof data === 'object') {
    const nested = (data as { currentVersion?: unknown })['currentVersion'];
    if (typeof nested === 'number') return nested;
  }
  return null;
}
