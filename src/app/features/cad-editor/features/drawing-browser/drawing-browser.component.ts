import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DrawingsApiService } from '../../../../core/api/drawings-api.service';
import { FoldersApiService } from '../../../../core/api/folders-api.service';
import type { DrawingSummaryDto, FolderDto } from '../../../../core/api/api.models';
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
 * "My Drawings" — the in-editor file dialog, now backed by the API.
 *
 * It stays a modal rather than becoming a dashboard route: the editor is
 * multi-document, and navigating away to pick a file would tear down tools,
 * autosave and every other open tab.
 *
 * Two faces, chosen by `DrawingBrowserService.mode()`:
 *  - `open` — search the account's drawings and open one in a new tab.
 *  - `save` — name + destination folder for Save As.
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
            <label for="db-folder">Folder</label>
            <select id="db-folder" class="db-input select" [(ngModel)]="saveFolderId">
              <option [ngValue]="null">My Drawings</option>
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
              } @else {
                No drawings in your account yet. Use <strong>Save</strong> (Ctrl+S) to keep your work.
              }
            </div>
          } @else {
            @for (d of drawings(); track d.id) {
              <div class="db-row" [class.bound]="d.id === boundId()" (dblclick)="open(d)">
                <span class="db-name" [title]="d.name">{{ d.name }}</span>
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
      &.select { flex: 0 1 180px; }
    }
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
  private api = inject(DrawingsApiService);
  private foldersApi = inject(FoldersApiService);
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
  }

  ngOnDestroy(): void {
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
  }

  protected boundId(): string | null {
    return this.persist.remoteIdForTab(this.docManager.activeTabId);
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
        this.api.list({ q: q || undefined, sort: 'updated', limit: 50 }),
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
   * Root-level folders only: the dialog is a quick destination picker, not a
   * file manager, and the dashboard is where a full tree belongs.
   */
  private async loadFolders(): Promise<void> {
    try {
      this.folders.set(await this.foldersApi.list());
    } catch {
      this.folders.set([]); // saving to "My Drawings" still works
    }
  }

  protected close(saved = false): void {
    this.svc.close(saved);
  }

  protected onOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.close();
  }

  protected async confirmSave(): Promise<void> {
    const ok = await this.persist.saveActiveAs(this.saveName, this.saveFolderId);
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
