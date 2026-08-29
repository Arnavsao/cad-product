/**
 * Layout Manager Dialog
 *
 * AutoCAD-style LAYOUT command UI — shows all layouts in a list with
 * Create / Rename / Duplicate / Delete / Set Active controls.
 *
 * Opened by:
 *   - Typing LAYOUT at the command line
 *   - Via LayoutManagerDialogService.open()
 */
import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { LayoutManagerDialogService } from './layout-manager-dialog.service';
import { LayoutManagerService } from '../../core/services/layout-manager.service';
import { PageSetupDialogService } from '../page-setup/page-setup-dialog.service';
import type { Layout } from '../../core/models/layout.model';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-layout-manager-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (dialogSvc.isOpen()) {
      <div class="lm-overlay" (click)="onOverlayClick($event)">
        <div class="lm-dialog" role="dialog" aria-modal="true" aria-label="Layout Manager">

          <!-- Header -->
          <div class="lm-header">
            <span class="lm-icon">📋</span>
            <span class="lm-title">Layout Manager</span>
            <button class="lm-close" type="button" (click)="close()" aria-label="Close">✕</button>
          </div>

          <!-- Layout list -->
          <div class="lm-list">
            @for (layout of layoutMgr.layouts(); track layout.id) {
              <div
                class="lm-item"
                [class.active]="layoutMgr.activeLayoutId() === layout.id"
                [class.selected]="selectedId() === layout.id"
                (click)="select(layout)"
                (dblclick)="activate(layout)"
              >
                <span class="lm-item-icon">{{ layout.isModel ? '🔧' : '📄' }}</span>
                <span class="lm-item-name">{{ layout.name }}</span>
                <span class="lm-item-paper">
                  {{ layout.pageSetup.paper }}
                  {{ layout.pageSetup.orientation === 'landscape' ? '↔' : '↕' }}
                </span>
                @if (layoutMgr.activeLayoutId() === layout.id) {
                  <span class="lm-item-badge">Active</span>
                }
              </div>
            }
          </div>

          <!-- Toolbar -->
          <div class="lm-toolbar">
            <button class="lm-btn" type="button" (click)="createLayout()" title="New Layout">
              ＋ New
            </button>
            <button class="lm-btn" type="button"
              [disabled]="!selectedId() || isSelectedModel()"
              (click)="startRename()" title="Rename">
              ✏ Rename
            </button>
            <button class="lm-btn" type="button"
              [disabled]="!selectedId() || isSelectedModel()"
              (click)="duplicateSelected()" title="Duplicate">
              ⊕ Duplicate
            </button>
            <button class="lm-btn" type="button"
              [disabled]="!selectedId() || isSelectedModel()"
              (click)="openPageSetup()" title="Page Setup">
              📐 Page Setup
            </button>
            <button class="lm-btn lm-btn-danger" type="button"
              [disabled]="!selectedId() || isSelectedModel() || isOnlyLayout()"
              (click)="deleteSelected()" title="Delete">
              ✕ Delete
            </button>
          </div>

          <!-- Rename inline form -->
          @if (renaming()) {
            <div class="lm-rename-row">
              <label class="lm-rename-label">New name:</label>
              <input
                class="lm-rename-input"
                type="text"
                [(ngModel)]="renameValue"
                (keydown.enter)="commitRename()"
                (keydown.escape)="renaming.set(false)"
                maxlength="40"
                autofocus
              />
              <button class="lm-btn lm-btn-sm" type="button" (click)="commitRename()">OK</button>
              <button class="lm-btn lm-btn-sm" type="button" (click)="renaming.set(false)">Cancel</button>
            </div>
          }

          <!-- Footer -->
          <div class="lm-footer">
            <div class="lm-footer-info">
              {{ layoutMgr.layouts().length }} layout(s) —
              Active: <strong>{{ layoutMgr.activeLayout().name }}</strong>
            </div>
            <button class="lm-btn lm-btn-primary" type="button"
              [disabled]="!selectedId()"
              (click)="activate(selectedLayout())">
              Set Active
            </button>
            <button class="lm-btn lm-btn-ghost" type="button" (click)="close()">Close</button>
          </div>

        </div>
      </div>
    }
  `,
  styles: [`
    .lm-overlay {
      position: fixed; inset: 0; z-index: 5000;
      background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
    }
    .lm-dialog {
      width: 520px; max-height: 85vh;
      background: #1e1e22;
      border: 1px solid #3a3a3d; border-radius: 10px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.7);
      display: flex; flex-direction: column;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      color: #c0c0c4; overflow: hidden;
    }
    .lm-header {
      display: flex; align-items: center; gap: 8px;
      padding: 14px 18px; border-bottom: 1px solid #2d2d30;
      background: #252528; flex-shrink: 0;
    }
    .lm-icon { font-size: 16px; }
    .lm-title { flex: 1; font-size: 13px; font-weight: 600; color: #e0e0e4; }
    .lm-close {
      background: none; border: none; color: #888; cursor: pointer; font-size: 14px;
      padding: 2px 6px; border-radius: 4px;
      &:hover { background: #3a3a3d; color: #e0e0e4; }
    }
    .lm-list {
      flex: 1; overflow-y: auto; padding: 8px 12px;
      display: flex; flex-direction: column; gap: 3px;
    }
    .lm-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; border-radius: 6px; cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.1s, border-color 0.1s;
      &:hover { background: #252528; }
      &.selected { background: #252528; border-color: #3a3a3d; }
      &.active { border-color: #499bea40; }
    }
    .lm-item-icon { font-size: 14px; flex-shrink: 0; }
    .lm-item-name { flex: 1; font-size: 12px; color: #e0e0e4; }
    .lm-item-paper { font-size: 10px; color: #666; }
    .lm-item-badge {
      font-size: 9px; font-weight: 700; letter-spacing: 0.04em;
      padding: 2px 6px; border-radius: 3px;
      background: rgba(73,155,234,0.15); color: #499bea;
      border: 1px solid rgba(73,155,234,0.3);
    }
    .lm-toolbar {
      display: flex; gap: 6px; padding: 8px 12px;
      border-top: 1px solid #2d2d30; flex-shrink: 0; flex-wrap: wrap;
    }
    .lm-rename-row {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; background: #252528;
      border-top: 1px solid #2d2d30;
    }
    .lm-rename-label { font-size: 11px; color: #888; flex-shrink: 0; }
    .lm-rename-input {
      flex: 1; background: #2a2a2e; border: 1px solid #499bea; border-radius: 5px;
      color: #e0e0e4; font-size: 11px; padding: 4px 8px; outline: none;
    }
    .lm-footer {
      display: flex; align-items: center; gap: 8px; padding: 12px 16px;
      border-top: 1px solid #2d2d30; flex-shrink: 0;
    }
    .lm-footer-info { flex: 1; font-size: 10px; color: #666; }
    .lm-btn {
      padding: 5px 12px; border-radius: 5px; border: 1px solid #3a3a3d;
      background: #2a2a2e; color: #c0c0c4; font-size: 11px; cursor: pointer;
      font-family: inherit; transition: background 0.1s;
      &:hover:not(:disabled) { background: #333337; color: #e0e0e4; }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }
    .lm-btn-sm     { padding: 3px 8px; font-size: 10px; }
    .lm-btn-danger { color: #e05555; border-color: #e0555540;
      &:hover:not(:disabled) { background: rgba(224,85,85,0.12); } }
    .lm-btn-primary { background: #499bea; border-color: #499bea; color: #fff; font-weight: 600;
      &:hover:not(:disabled) { background: #5aaaf5; } }
    .lm-btn-ghost   { background: transparent; border: none; color: #888;
      &:hover { color: #c8c8cc; } }
  `],
})
export class LayoutManagerDialogComponent {
  protected dialogSvc  = inject(LayoutManagerDialogService);
  protected layoutMgr  = inject(LayoutManagerService);
  protected pageSetup  = inject(PageSetupDialogService);

  protected selectedId = signal<string | null>(null);
  protected renaming   = signal(false);
  protected renameValue = '';

  // ── Helpers ───────────────────────────────────────────────────────────────

  protected selectedLayout(): Layout | null {
    const id = this.selectedId();
    return this.layoutMgr.layouts().find((l) => l.id === id) ?? null;
  }

  protected isSelectedModel(): boolean {
    return this.selectedLayout()?.isModel ?? false;
  }

  protected isOnlyLayout(): boolean {
    const nonModel = this.layoutMgr.layouts().filter((l) => !l.isModel);
    return nonModel.length <= 1 && nonModel[0]?.id === this.selectedId();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  select(layout: Layout): void {
    this.selectedId.set(layout.id);
  }

  activate(layout: Layout | null): void {
    if (!layout) return;
    this.layoutMgr.activateLayout(layout.id);
  }

  createLayout(): void {
    const l = this.layoutMgr.createLayout();
    this.selectedId.set(l.id);
    this.layoutMgr.activateLayout(l.id);
  }

  startRename(): void {
    const layout = this.selectedLayout();
    if (!layout || layout.isModel) return;
    this.renameValue = layout.name;
    this.renaming.set(true);
  }

  commitRename(): void {
    const id = this.selectedId();
    if (id && this.renameValue.trim()) {
      this.layoutMgr.renameLayout(id, this.renameValue.trim());
    }
    this.renaming.set(false);
  }

  duplicateSelected(): void {
    const id = this.selectedId();
    if (!id) return;
    const copy = this.layoutMgr.duplicateLayout(id);
    this.selectedId.set(copy.id);
  }

  deleteSelected(): void {
    const id = this.selectedId();
    if (!id || this.isSelectedModel() || this.isOnlyLayout()) return;
    this.layoutMgr.deleteLayout(id);
    this.selectedId.set(null);
  }

  openPageSetup(): void {
    const id = this.selectedId();
    if (!id) return;
    this.layoutMgr.activateLayout(id);
    this.close();
    this.pageSetup.open(id);
  }

  close(): void {
    this.dialogSvc.close();
  }

  onOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.close();
  }
}
