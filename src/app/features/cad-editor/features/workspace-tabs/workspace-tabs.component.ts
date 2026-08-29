import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { LayoutManagerService } from '../../core/services/layout-manager.service';
import { PageSetupDialogService } from '../page-setup/page-setup-dialog.service';
import type { Layout } from '../../core/models/layout.model';

interface ITabContextMenu {
  visible: boolean;
  x: number;
  y: number;
  layoutId: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-workspace-tabs',
  standalone: true,
  imports: [FormsModule],
  styleUrl: './workspace-tabs.component.scss',
  template: `
    <div class="ws-tabs" role="tablist" aria-label="Workspace tabs">

      <!-- Tab items -->
      @for (layout of layoutMgr.layouts(); track layout.id) {
        <div
          class="ws-tab"
          [class.active]="layoutMgr.activeLayoutId() === layout.id"
          [class.model-tab]="layout.isModel"
          [attr.role]="'tab'"
          [attr.aria-selected]="layoutMgr.activeLayoutId() === layout.id"
          [attr.title]="layout.isModel ? 'Model Space' : layout.name"
          (click)="onTabClick(layout)"
          (dblclick)="onTabDblClick(layout, $event)"
          (contextmenu)="onTabRightClick(layout, $event)"
          (keydown.enter)="onTabClick(layout)"
          tabindex="0"
        >
          @if (renamingId === layout.id) {
            <!-- Inline rename input -->
            <input
              #renameInput
              class="ws-tab-rename"
              [(ngModel)]="renameValue"
              (blur)="commitRename()"
              (keydown.enter)="commitRename()"
              (keydown.escape)="cancelRename()"
              (click)="$event.stopPropagation()"
              maxlength="40"
              autofocus
            />
          } @else {
            <span class="ws-tab-label">{{ layout.name }}</span>
          }

          <!-- Mode indicator for active layout tab -->
          @if (layoutMgr.activeLayoutId() === layout.id && !layout.isModel) {
            <span
              class="ws-tab-mode"
              [class.pspace]="layoutMgr.workspaceMode() === 'PSPACE'"
              [class.mspace]="layoutMgr.workspaceMode() === 'MSPACE'"
              [title]="layoutMgr.workspaceMode() === 'MSPACE' ? 'Model Space (through viewport)' : 'Paper Space'"
            >{{ layoutMgr.workspaceMode() }}</span>
          }
        </div>
      }

      <!-- Add layout button -->
      <button
        class="ws-tab-add"
        type="button"
        title="New Layout (right-click for options)"
        (click)="addLayout()"
        aria-label="Add layout"
      >+</button>

    </div>

    <!-- Context menu -->
    @if (ctxMenu().visible) {
      <div
        class="ws-ctx-menu"
        [style.left.px]="ctxMenu().x"
        [style.top.px]="ctxMenu().y - 160"
        (click)="$event.stopPropagation()"
      >
        <button class="ws-ctx-item" type="button" (click)="ctxRename()">
          ✏ Rename
        </button>
        <button class="ws-ctx-item" type="button" (click)="ctxDuplicate()">
          ⊕ Duplicate
        </button>
        <button class="ws-ctx-item" type="button" (click)="ctxPageSetup()">
          📐 Page Setup…
        </button>
        <div class="ws-ctx-sep"></div>
        <button class="ws-ctx-item" type="button" (click)="ctxExportPdf()">
          ⬇ Export PDF
        </button>
        <div class="ws-ctx-sep"></div>
        <button
          class="ws-ctx-item danger"
          type="button"
          (click)="ctxDelete()"
          [disabled]="isOnlyLayout(ctxMenu().layoutId)"
        >✕ Delete</button>
      </div>
    }
  `,
})
export class WorkspaceTabsComponent {
  protected layoutMgr = inject(LayoutManagerService);
  protected pageSetupSvc = inject(PageSetupDialogService);

  protected renamingId: string | null = null;
  protected renameValue = '';

  protected ctxMenu = signal<ITabContextMenu>({
    visible: false, x: 0, y: 0, layoutId: '',
  });

  // ── Tab click handlers ────────────────────────────────────────────────────

  onTabClick(layout: Layout): void {
    if (this.renamingId) return; // let rename commit first
    this.layoutMgr.activateLayout(layout.id);
    this.hideCtx();
  }

  onTabDblClick(layout: Layout, e: MouseEvent): void {
    e.preventDefault();
    if (layout.isModel) return; // Model tab cannot be renamed via dblclick
    this.startRename(layout);
  }

  onTabRightClick(layout: Layout, e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (layout.isModel) return; // no ctx for Model
    this.ctxMenu.set({ visible: true, x: e.clientX, y: e.clientY, layoutId: layout.id });
  }

  addLayout(): void {
    const l = this.layoutMgr.createLayout();
    this.layoutMgr.activateLayout(l.id);
  }

  // ── Rename ────────────────────────────────────────────────────────────────

  private startRename(layout: Layout): void {
    this.renamingId  = layout.id;
    this.renameValue = layout.name;
    this.hideCtx();
  }

  commitRename(): void {
    if (this.renamingId) {
      this.layoutMgr.renameLayout(this.renamingId, this.renameValue);
      this.renamingId = null;
    }
  }

  cancelRename(): void {
    this.renamingId = null;
  }

  // ── Context menu actions ──────────────────────────────────────────────────

  ctxRename(): void {
    const id     = this.ctxMenu().layoutId;
    const layout = this.layoutMgr.layouts().find((l) => l.id === id);
    if (layout) this.startRename(layout);
    else this.hideCtx();
  }

  ctxDuplicate(): void {
    const id   = this.ctxMenu().layoutId;
    const copy = this.layoutMgr.duplicateLayout(id);
    this.layoutMgr.activateLayout(copy.id);
    this.hideCtx();
  }

  ctxDelete(): void {
    const id = this.ctxMenu().layoutId;
    if (this.isOnlyLayout(id)) return;
    this.layoutMgr.deleteLayout(id);
    this.hideCtx();
  }

  ctxPageSetup(): void {
    const id = this.ctxMenu().layoutId;
    this.layoutMgr.activateLayout(id);
    this.pageSetupSvc.open(id);
    this.hideCtx();
  }

  ctxExportPdf(): void {
    // Will be wired to ExportManagerService in Phase 6
    this.hideCtx();
  }

  isOnlyLayout(id: string): boolean {
    const nonModel = this.layoutMgr.layouts().filter((l) => !l.isModel);
    return nonModel.length <= 1 && nonModel[0]?.id === id;
  }

  private hideCtx(): void {
    this.ctxMenu.set({ visible: false, x: 0, y: 0, layoutId: '' });
  }

  @HostListener('document:click')
  onDocClick(): void {
    if (this.ctxMenu().visible) this.hideCtx();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.ctxMenu().visible) this.hideCtx();
    if (this.renamingId) this.cancelRename();
  }
}
