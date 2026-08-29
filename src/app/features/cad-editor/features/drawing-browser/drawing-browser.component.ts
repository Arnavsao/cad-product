import { ChangeDetectionStrategy, Component, OnInit, inject, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DrawingBrowserService } from './drawing-browser.service';
import { DrawingStoreService } from '../../core/services/drawing-store.service';
import { DrawingPersistenceService } from '../../core/services/drawing-persistence.service';
import { AutosaveService } from '../../core/services/autosave.service';
import { DocumentManagerService } from '../../core/services/document-manager.service';
import type { DrawingSummary, StoredDrawing } from '../../core/models/stored-drawing.model';

/**
 * "My Drawings" — the browser-storage file browser.
 *
 * Two faces, chosen by `DrawingBrowserService.mode()`:
 *  - `open` — list saved drawings; open / rename / duplicate / delete.
 *  - `save` — the same list plus a name field, for Save As.
 *
 * It also surfaces crash recovery: any autosave snapshot left behind by a tab
 * that closed without an explicit save is offered for restore at the top.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-drawing-browser',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="db-overlay" (click)="onOverlayClick($event)">
      <div class="db-modal" (click)="$event.stopPropagation()">

        <header class="db-header">
          <h2>{{ svc.mode() === 'save' ? 'Save Drawing As' : 'My Drawings' }}</h2>
          <button type="button" class="db-x" (click)="close()" title="Close (Esc)">×</button>
        </header>

        @if (!available()) {
          <div class="db-unavailable">
            Browser storage is unavailable — drawings cannot be saved here.
            Use <strong>Export</strong> to write a DXF file instead.
          </div>
        }

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
            <button
              type="button"
              class="db-btn primary"
              [disabled]="persist.busy() || !available() || !saveName.trim()"
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
              These drawings were autosaved but never saved explicitly — probably from a tab
              that closed unexpectedly.
            </p>
            @for (r of recovery(); track r.id) {
              <div class="db-row recovery">
                <span class="db-name" [title]="r.name">{{ r.name }}</span>
                <span class="db-meta">{{ relative(r.updatedAt) }}</span>
                <span class="db-meta">{{ size(r.byteSize) }}</span>
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
            [(ngModel)]="filter"
            placeholder="Search drawings…"
            autocomplete="off"
            spellcheck="false">
          <button type="button" class="db-btn" (click)="newDrawing()">+ New drawing</button>
        </div>

        <div class="db-list">
          @if (loading()) {
            <div class="db-empty">Loading…</div>
          } @else if (!visible().length) {
            <div class="db-empty">
              @if (filter.trim()) {
                No drawings match "{{ filter }}".
              } @else {
                No saved drawings yet. Use <strong>Save</strong> (Ctrl+S) to keep your work here.
              }
            </div>
          } @else {
            @for (d of visible(); track d.id) {
              <div class="db-row" [class.bound]="d.id === boundId()" (dblclick)="open(d)">
                @if (renamingId() === d.id) {
                  <input
                    type="text"
                    class="db-input rename"
                    [value]="d.name"
                    (blur)="commitRename(d, $any($event.target).value)"
                    (keydown.enter)="commitRename(d, $any($event.target).value)"
                    (keydown.escape)="renamingId.set(null)"
                    #renameInput>
                } @else {
                  <span class="db-name" [title]="d.name" (dblclick)="open(d)">{{ d.name }}</span>
                }
                <span class="db-meta">{{ relative(d.updatedAt) }}</span>
                <span class="db-meta">{{ size(d.byteSize) }}</span>
                <span class="db-actions">
                  <button type="button" class="db-btn" [disabled]="persist.busy()" (click)="open(d)">Open</button>
                  <button type="button" class="db-btn icon" title="Rename" (click)="startRename(d)">✎</button>
                  <button type="button" class="db-btn icon" title="Duplicate" (click)="duplicate(d)">⧉</button>
                  <button type="button" class="db-btn icon danger" title="Delete" (click)="remove(d)">🗑</button>
                </span>
              </div>
            }
          }
        </div>

        <footer class="db-footer">
          <span>{{ drawings().length }} drawing{{ drawings().length === 1 ? '' : 's' }}</span>
          @if (usage(); as u) {
            <span class="db-usage" [title]="'Browser storage used by this site'">
              {{ size(u.usage) }} of {{ size(u.quota) }} used
            </span>
          }
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
    .db-unavailable {
      padding: 8px 14px;
      background: rgba(255,180,60,0.12);
      border-bottom: 1px solid var(--cad-border, #2c3340);
      color: var(--cad-text-primary, #e0e4ea);
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
      &.rename { flex: 1 1 auto; }
    }
    .db-btn {
      background: transparent; color: var(--cad-text-primary, #e0e4ea);
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 3px; padding: 4px 10px; font-size: 11px; cursor: pointer;
      white-space: nowrap;
      &:hover:not(:disabled) { background: var(--cad-bg-hover, rgba(255,255,255,0.06)); border-color: var(--cad-accent, #4f8ef7); }
      &:disabled { opacity: 0.45; cursor: default; }
      &.primary { background: var(--cad-accent, #4f8ef7); border-color: var(--cad-accent, #4f8ef7); color: #fff; }
      &.icon { padding: 4px 7px; color: var(--cad-text-dim, #7f8694); }
      &.icon:hover:not(:disabled) { color: var(--cad-text-primary, #e0e4ea); }
      &.danger:hover:not(:disabled) { color: var(--cad-red, #ff6b6b); border-color: var(--cad-red, #ff6b6b); }
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
    .db-empty { padding: 28px 14px; text-align: center; color: var(--cad-text-dim, #7f8694); }
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
export class DrawingBrowserComponent implements OnInit {
  protected svc = inject(DrawingBrowserService);
  protected persist = inject(DrawingPersistenceService);
  private store = inject(DrawingStoreService);
  private autosave = inject(AutosaveService);
  private docManager = inject(DocumentManagerService);

  protected readonly drawings = signal<DrawingSummary[]>([]);
  protected readonly recovery = signal<StoredDrawing[]>([]);
  protected readonly usage = signal<{ usage: number; quota: number } | null>(null);
  protected readonly loading = signal(true);
  protected readonly renamingId = signal<string | null>(null);

  protected filter = '';
  protected saveName = '';

  constructor() {
    // Any store mutation from elsewhere (a Ctrl+S while the dialog is open)
    // bumps `revision`; re-list so the dialog never shows stale rows.
    effect(() => {
      this.persist.revision();
      if (this.svc.isOpen()) void this.refresh();
    });
  }

  ngOnInit(): void {
    this.saveName = this.docManager.activeDocument?.file.name ?? 'Drawing1';
    void this.refresh();
  }

  protected available(): boolean {
    return this.persist.isAvailable();
  }

  protected boundId(): string | null {
    return this.persist.storedIdForTab(this.docManager.activeTabId);
  }

  /** Name-filtered view of the stored list. */
  protected visible(): DrawingSummary[] {
    const q = this.filter.trim().toLowerCase();
    const all = this.drawings();
    return q ? all.filter((d) => d.name.toLowerCase().includes(q)) : all;
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const [list, rec, use] = await Promise.all([
        this.store.list(),
        this.autosave.getRecoveryRecords(),
        this.store.estimateUsage(),
      ]);
      this.drawings.set(list);
      this.recovery.set(rec);
      this.usage.set(use);
    } finally {
      this.loading.set(false);
    }
  }

  protected close(): void {
    this.svc.close();
  }

  protected onOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.close();
  }

  protected async confirmSave(): Promise<void> {
    const ok = await this.persist.saveActiveAs(this.saveName);
    if (ok) this.close();
  }

  protected async open(d: DrawingSummary): Promise<void> {
    const ok = await this.persist.openStored(d.id);
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

  protected startRename(d: DrawingSummary): void {
    this.renamingId.set(d.id);
    setTimeout(() => {
      const el = document.querySelector('.db-input.rename') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 0);
  }

  protected async commitRename(d: DrawingSummary, value: string): Promise<void> {
    if (this.renamingId() !== d.id) return; // already committed or cancelled
    this.renamingId.set(null);
    const clean = value.trim();
    if (!clean || clean === d.name) return;
    await this.persist.renameStored(d.id, clean);
    await this.refresh();
  }

  protected async duplicate(d: DrawingSummary): Promise<void> {
    await this.persist.duplicateStored(d.id);
    await this.refresh();
  }

  protected async remove(d: DrawingSummary): Promise<void> {
    if (!confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    await this.persist.deleteStored(d.id);
    await this.refresh();
  }

  /** "just now" / "6m ago" / "3h ago" / a date once it is older than a week. */
  protected relative(ts: number): string {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  /** Bytes → a short human string. */
  protected size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
}
