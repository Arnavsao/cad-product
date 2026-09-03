import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DrawingsApiService } from '../../../../core/api/drawings-api.service';
import { FoldersApiService } from '../../../../core/api/folders-api.service';
import { MeService } from '../../../../core/api/me.service';
import { WorkspaceService } from '../../../../core/api/workspace.service';
import type { DrawingSummaryDto, FolderDto, ListDrawingsQuery, OrgSummaryDto } from '../../../../core/api/api.models';
import { ApiError } from '../../../../core/services/http-manager.service';
import { FileSizePipe } from '../../../../shared/ui/pipes/file-size.pipe';
import { RelativeTimePipe } from '../../../../shared/ui/pipes/relative-time.pipe';
import { DrawingBrowserService } from './drawing-browser.service';
import { DrawingPersistenceService } from '../../core/services/drawing-persistence.service';
import { AutosaveService } from '../../core/services/autosave.service';
import { DocumentManagerService } from '../../core/services/document-manager.service';
import type { StoredDrawing } from '../../core/models/stored-drawing.model';

/** Search keystrokes are cheap; `GET /drawings?q=` is not. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Sentinels for the browse `<select>`, whose options are "a workspace" *or*
 * "everything shared with me" — two different query shapes behind one control.
 * `''` (rather than `null`) so the option values stay plain strings and the
 * select needs no `[ngValue]`.
 */
const PERSONAL = '';
const SHARED = 'shared';

/**
 * "My Drawings" — the in-editor file dialog, now backed by the API.
 *
 * It stays a modal rather than becoming a dashboard route: the editor is
 * multi-document, and navigating away to pick a file would tear down tools,
 * autosave and every other open tab.
 *
 * Two faces, chosen by `DrawingBrowserService.mode()`:
 *  - `open` — search the account's drawings and open one in a new tab.
 *  - `save` — name + destination workspace + folder for Save As.
 *
 * Design decisions:
 *
 *  - **Workspace is an explicit field, not an ambient mode.** The editor can be
 *    opened straight from a link, so there is no dashboard state to inherit;
 *    Save As defaults to the workspace of the drawing in front of the user
 *    (`RemoteBinding.organizationId`) and says so, instead of quietly saving an
 *    org drawing into the caller's personal files.
 *
 *  - **One list, one target.** The rows always show whatever workspace the
 *    dialog is currently pointed at — the Save-As picker in `save` mode, the
 *    browse picker in `open` mode. Saving is where a name clash bites (409
 *    `NAME_TAKEN`), so the list has to be the destination's list.
 *
 *  - **Viewer orgs are dropped from the Save-As picker only.** A viewer may
 *    open and browse an org's drawings, so `open` lists every org; saving there
 *    would be a guaranteed 403, so it is not offered.
 *
 * File management (rename, duplicate, move, delete) deliberately lives in the
 * dashboard only; this dialog is for getting in and out of a drawing. Crash
 * recovery stays here and stays local — those snapshots never left the browser.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-drawing-browser',
  standalone: true,
  imports: [FormsModule, RelativeTimePipe, FileSizePipe],
  template: `
    <div class="db-overlay" (click)="onOverlayClick($event)">
      <div class="db-modal" (click)="$event.stopPropagation()">

        <header class="db-header">
          <h2>{{ svc.mode() === 'save' ? 'Save Drawing As' : 'My Drawings' }}</h2>
          <button type="button" class="db-x" (click)="close()" title="Close (Esc)">×</button>
        </header>

        @if (svc.mode() === 'save') {
          <div class="db-saverow">
            <label for="db-name">Name</label>
            <input
              id="db-name"
              type="text"
              class="db-input"
              [(ngModel)]="saveName"
              (keydown.enter)="confirmSave()"
              placeholder="Drawing name"
              autocomplete="off"
              spellcheck="false">
            <label for="db-workspace">Workspace</label>
            <select
              id="db-workspace"
              class="db-input select"
              [ngModel]="saveOrgId()"
              (ngModelChange)="onSaveWorkspaceChange($event)">
              <option [ngValue]="null">Personal</option>
              @for (o of savableOrgs(); track o.id) {
                <option [ngValue]="o.id">{{ o.name }}</option>
              }
            </select>
            <label for="db-folder">Folder</label>
            <select id="db-folder" class="db-input select" [(ngModel)]="saveFolderId">
              <option [ngValue]="null">{{ saveOrgId() === null ? 'My Drawings' : 'Workspace root' }}</option>
              @for (f of folders(); track f.id) {
                <option [ngValue]="f.id">{{ f.name }}</option>
              }
            </select>
            <button
              type="button"
              class="db-btn primary"
              [disabled]="persist.busy() || !saveName.trim()"
              (click)="confirmSave()">Save</button>
          </div>
        }

        @if (recovery().length) {
          <section class="db-recovery">
            <div class="db-recovery-head">
              <span class="db-recovery-title">Unsaved work recovered</span>
              <button type="button" class="db-link" (click)="discardRecovery()">Discard all</button>
            </div>
            <p class="db-recovery-note">
              These drawings were autosaved in this browser but never saved to your account —
              probably from a tab that closed unexpectedly.
            </p>
            @for (r of recovery(); track r.id) {
              <div class="db-row recovery">
                <span class="db-name" [title]="r.name">{{ r.name }}</span>
                <span class="db-meta">{{ r.updatedAt | relativeTime }}</span>
                <span class="db-meta">{{ r.byteSize | fileSize }}</span>
                <span class="db-actions">
                  <button type="button" class="db-btn" [disabled]="persist.busy()" (click)="restore(r)">Restore</button>
                </span>
              </div>
            }
          </section>
        }

        <div class="db-toolbar">
          <input
            type="text"
            class="db-input search"
            [ngModel]="query()"
            (ngModelChange)="onQueryChange($event)"
            placeholder="Search your drawings…"
            autocomplete="off"
            spellcheck="false">
          @if (svc.mode() !== 'save') {
            <select
              class="db-input select"
              aria-label="Where to look"
              [ngModel]="browseTarget()"
              (ngModelChange)="onBrowseChange($event)">
              <option value="">Personal</option>
              @for (o of workspace.organizations(); track o.id) {
                <option [value]="o.id">{{ o.name }}</option>
              }
              <option value="shared">Shared with me</option>
            </select>
          }
          <button type="button" class="db-btn" (click)="newDrawing()">+ New drawing</button>
        </div>

        <div class="db-list">
          @if (loading()) {
            <div class="db-empty">Loading…</div>
          } @else if (error(); as msg) {
            <div class="db-empty">
              {{ msg }}
              <div><button type="button" class="db-btn" (click)="refresh()">Retry</button></div>
            </div>
          } @else if (!drawings().length) {
            <div class="db-empty">
              @if (query().trim()) {
                No drawings match "{{ query() }}".
              } @else if (browsingShared()) {
                Nothing has been shared with you yet.
              } @else {
                No drawings in this workspace yet. Use <strong>Save</strong> (Ctrl+S) to keep your work.
              }
            </div>
          } @else {
            @for (d of drawings(); track d.id) {
              <div class="db-row" [class.bound]="d.id === boundId()" (dblclick)="open(d)">
                <span class="db-name" [title]="d.name">{{ d.name }}</span>
                @if (browsingShared()) {
                  <span class="db-meta">
                    {{ d.organizationName ?? 'Shared with you' }}{{ d.access === 'view' ? ' · view only' : '' }}
                  </span>
                }
                <span class="db-meta">{{ d.updatedAt | relativeTime }}</span>
                <span class="db-meta">{{ d.byteSize | fileSize }}</span>
                <span class="db-actions">
                  <button type="button" class="db-btn" [disabled]="persist.busy()" (click)="open(d)">Open</button>
                </span>
              </div>
            }
          }
        </div>

        <footer class="db-footer">
          <span>{{ drawings().length }} drawing{{ drawings().length === 1 ? '' : 's' }}{{ hasMore() ? '+' : '' }}</span>
          <span class="db-spacer"></span>
          <button type="button" class="db-btn" (click)="close()">Close</button>
        </footer>

      </div>
    </div>
  `,
  styles: [`
    .db-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.45);
      display: flex; align-items: center; justify-content: center;
    }
    .db-modal {
      width: min(760px, 92vw);
      max-height: 82vh;
      display: flex; flex-direction: column;
      background: var(--cad-bg-panel-solid, #1f2530);
      color: var(--cad-text-primary, #e0e4ea);
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: var(--cad-radius, 6px);
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
      font-size: 12px;
      overflow: hidden;
    }
    .db-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--cad-border, #2c3340);
      background: var(--cad-bg-hover, rgba(255,255,255,0.04));
      h2 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }
    }
    .db-x {
      background: transparent; border: none; cursor: pointer;
      color: var(--cad-text-dim, #7f8694); font-size: 20px; line-height: 1;
      padding: 0 4px;
      &:hover { color: var(--cad-text-primary, #e0e4ea); }
    }
    .db-saverow, .db-toolbar {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--cad-border, #2c3340);
      label { color: var(--cad-text-dim, #7f8694); }
    }
    .db-input {
      flex: 1; min-width: 0;
      background: var(--cad-bg-input, #181825);
      color: var(--cad-text-primary, #e0e4ea);
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 3px; padding: 5px 8px; font-size: 12px; outline: none;
      &:focus { border-color: var(--cad-accent, #4f8ef7); }
      &::placeholder { color: var(--cad-text-dim, #7f8694); }
      &.select { flex: 0 1 160px; }
    }
    /* Name + workspace + folder + button no longer fit one line on a narrow modal. */
    .db-saverow { flex-wrap: wrap; }
    .db-btn {
      background: transparent; color: var(--cad-text-primary, #e0e4ea);
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 3px; padding: 4px 10px; font-size: 11px; cursor: pointer;
      white-space: nowrap;
      &:hover:not(:disabled) { background: var(--cad-bg-hover, rgba(255,255,255,0.06)); border-color: var(--cad-accent, #4f8ef7); }
      &:disabled { opacity: 0.45; cursor: default; }
      &.primary { background: var(--cad-accent, #4f8ef7); border-color: var(--cad-accent, #4f8ef7); color: #fff; }
    }
    .db-link {
      background: none; border: none; padding: 0; cursor: pointer;
      color: var(--cad-text-dim, #7f8694); font-size: 11px; text-decoration: underline;
      &:hover { color: var(--cad-text-primary, #e0e4ea); }
    }
    .db-recovery {
      padding: 10px 14px;
      border-bottom: 1px solid var(--cad-border, #2c3340);
      background: rgba(80,180,120,0.08);
    }
    .db-recovery-head { display: flex; align-items: center; justify-content: space-between; }
    .db-recovery-title { font-weight: 600; }
    .db-recovery-note { margin: 4px 0 8px; color: var(--cad-text-dim, #7f8694); font-size: 11px; }
    .db-list { flex: 1; overflow-y: auto; min-height: 120px; }
    .db-row {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 14px;
      border-bottom: 1px solid var(--cad-border, #2c3340);
      &:hover { background: var(--cad-bg-hover, rgba(255,255,255,0.05)); }
      &.bound { box-shadow: inset 3px 0 0 var(--cad-accent, #4f8ef7); }
      &.recovery { border-bottom: none; padding: 5px 0; }
    }
    .db-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .db-meta {
      flex: 0 0 auto; color: var(--cad-text-dim, #7f8694); font-size: 11px;
      font-family: var(--cad-font-mono, ui-monospace, monospace);
    }
    .db-actions { flex: 0 0 auto; display: flex; gap: 4px; }
    .db-empty { padding: 28px 14px; text-align: center; color: var(--cad-text-dim, #7f8694); display: grid; gap: 10px; }
    .db-footer {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 14px;
      border-top: 1px solid var(--cad-border, #2c3340);
      background: var(--cad-bg-hover, rgba(255,255,255,0.04));
      color: var(--cad-text-dim, #7f8694); font-size: 11px;
    }
    .db-spacer { flex: 1; }
  `],
})
export class DrawingBrowserComponent implements OnInit, OnDestroy {
  protected svc = inject(DrawingBrowserService);
  protected persist = inject(DrawingPersistenceService);
  protected workspace = inject(WorkspaceService);
  private api = inject(DrawingsApiService);
  private foldersApi = inject(FoldersApiService);
  private me = inject(MeService);
  private autosave = inject(AutosaveService);
  private docManager = inject(DocumentManagerService);

  protected readonly drawings = signal<DrawingSummaryDto[]>([]);
  protected readonly folders = signal<FolderDto[]>([]);
  protected readonly recovery = signal<StoredDrawing[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  /** True when the server had more rows than this page — the count gets a "+". */
  protected readonly hasMore = signal(false);

  /** Destination workspace for Save As: `null` = personal, else an org id. */
  protected readonly saveOrgId = signal<string | null>(null);

  /** What `open` mode is listing: `''` personal, `'shared'`, or an org id. */
  protected readonly browseTarget = signal<string>(PERSONAL);

  /** Orgs Save As may target — a viewer cannot write, so it is not offered. */
  protected readonly savableOrgs = computed<OrgSummaryDto[]>(() =>
    this.workspace.organizations().filter((o) => o.role !== 'viewer'),
  );

  /** True while the rows on screen are other people's shares. */
  protected readonly browsingShared = computed(
    () => this.svc.mode() !== 'save' && this.browseTarget() === SHARED,
  );

  protected saveName = '';
  protected saveFolderId: string | null = null;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Discards the response of a search that was superseded while in flight. */
  private requestSeq = 0;

  constructor() {
    // Any save from elsewhere (a Ctrl+S while the dialog is open) bumps
    // `revision`; re-list so the dialog never shows stale rows.
    effect(() => {
      this.persist.revision();
      if (this.svc.isOpen()) void this.refresh();
    });
  }

  ngOnInit(): void {
    this.saveName = this.docManager.activeDocument?.file.name ?? 'Drawing1';
    void this.refresh();
    void this.loadFolders();
    void this.loadWorkspaces();
  }

  ngOnDestroy(): void {
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
  }

  protected boundId(): string | null {
    return this.persist.remoteIdForTab(this.docManager.activeTabId);
  }

  /**
   * Fill the workspace pickers, then point them at the drawing in front of the
   * user.
   *
   * `WorkspaceService` is normally hydrated by the dashboard shell, but the
   * editor is reachable directly (`/editor/:id`, a share link, an embed), so
   * this falls back to the cached `/me` — `MeService.load()` dedupes, so the
   * common case costs nothing.
   */
  private async loadWorkspaces(): Promise<void> {
    try {
      if (!this.workspace.organizations().length) {
        this.workspace.hydrate(await this.me.load());
      }
    } catch {
      /* No org list: Personal still works, which is where most drawings live. */
    }
    this.applyBoundWorkspace();
  }

  /**
   * Default both pickers to the bound drawing's workspace. Falls back to
   * personal for an org the caller can only view (nothing could be saved
   * there) or one they are no longer a member of.
   */
  private applyBoundWorkspace(): void {
    const orgId = this.persist.remoteForTab(this.docManager.activeTabId)?.organizationId ?? null;
    if (orgId === null) return; // already the default for both pickers

    if (this.savableOrgs().some((o) => o.id === orgId)) this.saveOrgId.set(orgId);

    const browsable = this.workspace.organizations().some((o) => o.id === orgId);
    if (browsable) this.browseTarget.set(orgId);

    // Only the two states that changed the listing warrant a second request.
    if (this.svc.mode() === 'save' ? this.saveOrgId() === orgId : browsable) {
      void this.loadFolders();
      void this.refresh();
    }
  }

  /** Save As destination changed: its folders and its rows both have to follow. */
  protected onSaveWorkspaceChange(orgId: string | null): void {
    if (orgId === this.saveOrgId()) return;
    this.saveOrgId.set(orgId);
    // The old folder id belongs to the old workspace; the server would 404 it.
    this.saveFolderId = null;
    void this.loadFolders();
    void this.refresh();
  }

  /** Browse picker changed (`open` mode): re-list from the new workspace/scope. */
  protected onBrowseChange(target: string): void {
    if (target === this.browseTarget()) return;
    this.browseTarget.set(target);
    void this.refresh();
  }

  /**
   * The workspace or scope the listing should ask for. Save mode follows the
   * destination picker so the rows are the names a save could clash with;
   * open mode follows the browse picker.
   */
  private listTarget(): Pick<ListDrawingsQuery, 'organizationId' | 'scope'> {
    if (this.svc.mode() === 'save') return { organizationId: this.saveOrgId() };

    const target = this.browseTarget();
    if (target === SHARED) return { scope: 'shared' };
    return { organizationId: target === PERSONAL ? null : target };
  }

  protected onQueryChange(value: string): void {
    this.query.set(value);
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.refresh(), SEARCH_DEBOUNCE_MS);
  }

  protected async refresh(): Promise<void> {
    const seq = ++this.requestSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const q = this.query().trim();
      const [page, rec] = await Promise.all([
        this.api.list({ q: q || undefined, sort: 'updated', limit: 50, ...this.listTarget() }),
        this.autosave.getRecoveryRecords(),
      ]);
      if (seq !== this.requestSeq) return; // superseded by a newer search
      this.drawings.set(page.items);
      this.hasMore.set(page.nextCursor !== null);
      this.recovery.set(rec);
    } catch (e) {
      if (seq !== this.requestSeq) return;
      this.drawings.set([]);
      this.hasMore.set(false);
      this.error.set(
        e instanceof ApiError && e.isNetworkError
          ? "You're offline — your drawings will be listed again once you reconnect."
          : 'Could not load your drawings.',
      );
    } finally {
      if (seq === this.requestSeq) this.loading.set(false);
    }
  }

  /**
   * Root-level folders of the Save-As destination workspace only: the dialog is
   * a quick destination picker, not a file manager, and the dashboard is where
   * a full tree belongs.
   */
  private async loadFolders(): Promise<void> {
    const orgId = this.saveOrgId();
    try {
      const list = await this.foldersApi.list(null, orgId);
      if (orgId !== this.saveOrgId()) return; // the picker moved on while we waited
      this.folders.set(list);
    } catch {
      this.folders.set([]); // saving to the workspace root still works
    }
  }

  protected close(saved = false): void {
    this.svc.close(saved);
  }

  protected onOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.close();
  }

  protected async confirmSave(): Promise<void> {
    // Both are sent: the server ignores `organizationId` when a folder is
    // given (the folder already fixes the workspace), and needs it when the
    // destination is a workspace root.
    const ok = await this.persist.saveActiveAs(this.saveName, this.saveFolderId, this.saveOrgId());
    if (ok) this.close(true);
  }

  protected async open(d: DrawingSummaryDto): Promise<void> {
    const ok = await this.persist.openRemote(d.id);
    if (ok) this.close();
  }

  protected async restore(r: StoredDrawing): Promise<void> {
    const ok = await this.persist.restoreRecovery(r);
    if (ok) this.close();
  }

  protected async discardRecovery(): Promise<void> {
    if (!confirm('Discard all recovered drawings? This cannot be undone.')) return;
    await this.autosave.discardRecovery();
    await this.refresh();
  }

  protected newDrawing(): void {
    this.docManager.createDocument();
    this.close();
  }
}
