import { Component, inject, signal , ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { LibraryService } from '../../core/services/library.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { InsertLibraryItemTool } from '../../tools/block/insert-library-item.tool';
import { LibraryCardComponent } from './library-card.component';
import type { ILibraryItem } from '../../core/models/library.model';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-library-panel',
  standalone: true,
  imports: [FormsModule, LibraryCardComponent],
  template: `
    <div class="lib-panel">

      <!-- Search bar -->
      <div class="lib-search-row">
        <div class="lib-search-wrap">
          <span class="lib-search-icon">⌕</span>
          <input
            id="lib-search-input"
            class="lib-search-input"
            type="text"
            placeholder="Search library…"
            [(ngModel)]="searchQuery"
            (ngModelChange)="library.searchQuery.set($event)"
          />
          @if (searchQuery) {
            <button class="lib-search-clear" type="button" (click)="clearSearch()">✕</button>
          }
        </div>
      </div>

      <!-- Category pills -->
      <div class="lib-cats">
        <button
          class="lib-cat-pill"
          [class.active]="!library.activeCategory()"
          (click)="library.activeCategory.set(null)"
        >All</button>
        @for (cat of library.categories(); track cat.name) {
          @if (itemsByCategory(cat.name) > 0 || !library.searchQuery()) {
            <button
              class="lib-cat-pill"
              [class.active]="library.activeCategory() === cat.name"
              (click)="library.activeCategory.set(cat.name)"
              [title]="cat.name"
            >{{ cat.icon }} {{ cat.name }} <span class="lib-cat-count">{{ itemsByCategory(cat.name) }}</span></button>
          }
        }
      </div>

      <!-- Item grid -->
      <div class="lib-grid-container">
        @if (library.filteredItems().length) {
          <div class="lib-grid">
            @for (item of library.filteredItems(); track item.id) {
              <app-library-card
                [item]="item"
                (clickInsert)="onInsert($event)"
                (action)="onCardAction($event)"
              ></app-library-card>
            }
          </div>
        } @else {
          <div class="lib-empty">
            @if (library.items().length === 0) {
              <div class="lib-empty-title">Library is empty</div>
              <div class="lib-empty-hint">Select entities, right-click and choose<br><strong>Add to Library</strong> to save your first component.</div>
            } @else {
              <div class="lib-empty-icon">⌕</div>
              <div class="lib-empty-title">No results</div>
              <div class="lib-empty-hint">Try a different search term or category.</div>
            }
          </div>
        }
      </div>

      <!-- Rename modal (inline) -->
      @if (renamingItem()) {
        <div class="lib-rename-overlay" (click)="cancelRename()">
          <div class="lib-rename-box" (click)="$event.stopPropagation()">
            <div class="lib-rename-title">Rename Component</div>
            <input
              class="lib-rename-input"
              type="text"
              [(ngModel)]="renameValue"
              maxlength="80"
              (keydown.enter)="confirmRename()"
              (keydown.escape)="cancelRename()"
              #renameInput
            />
            <div class="lib-rename-actions">
              <button class="lib-btn lib-btn-sm lib-btn-secondary" (click)="cancelRename()">Cancel</button>
              <button class="lib-btn lib-btn-sm lib-btn-primary" (click)="confirmRename()">Rename</button>
            </div>
          </div>
        </div>
      }

    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
    }
    .lib-panel {
      display: flex; flex-direction: column; flex: 1; min-height: 0;
      background: transparent; color: var(--cad-text-primary);
      font-size: 12px;
    }
    /* Search */
    .lib-search-row { padding: 10px 10px 6px; }
    .lib-search-wrap {
      display: flex; align-items: center;
      background: var(--cad-bg-input); border: 1px solid var(--cad-border);
      border-radius: 7px; padding: 0 8px; gap: 6px;
      &:focus-within { border-color: var(--cad-accent); }
    }
    .lib-search-icon { color: var(--cad-text-dim); font-size: 15px; }
    .lib-search-input {
      flex: 1; background: none; border: none; outline: none;
      color: var(--cad-text-primary); font-size: 12px; padding: 7px 0;
      font-family: inherit;
      &::placeholder { color: var(--cad-text-dim); }
    }
    .lib-search-clear {
      background: none; border: none; color: var(--cad-text-dim); cursor: pointer;
      font-size: 12px; padding: 2px; &:hover { color: var(--cad-text-primary); }
    }
    /* Category pills */
    .lib-cats {
      display: flex; flex-wrap: nowrap; gap: 4px;
      padding: 4px 10px 8px; overflow-x: auto;
      scrollbar-width: none;
      &::-webkit-scrollbar { display: none; }
    }
    .lib-cat-pill {
      flex-shrink: 0; background: var(--cad-bg-panel); border: 1px solid var(--cad-border);
      color: var(--cad-text-secondary); border-radius: 20px; padding: 3px 10px;
      font-size: 11px; cursor: pointer; white-space: nowrap;
      transition: all 0.15s;
      &:hover { border-color: var(--cad-accent); color: var(--cad-accent); }
      &.active { background: var(--cad-accent); color: var(--cad-text-on-accent); border-color: var(--cad-accent); font-weight: 600; }
    }
    .lib-cat-count {
      display: inline-block; background: var(--cad-bg-hover);
      border-radius: 10px; padding: 0 4px; font-size: 10px; margin-left: 2px;
    }
    /* Grid */
    .lib-grid-container { flex: 1; overflow-y: auto; padding: 4px 10px 10px; }
    .lib-grid {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;
    }
    /* Empty state */
    .lib-empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 40px 20px; text-align: center; color: var(--cad-text-dim); gap: 8px;
    }
    .lib-empty-icon { font-size: 36px; opacity: 0.3; }
    .lib-empty-title { font-size: 13px; font-weight: 600; color: var(--cad-text-secondary); }
    .lib-empty-hint { font-size: 11px; line-height: 1.6; }
    /* Rename modal */
    .lib-rename-overlay {
      position: absolute; inset: 0; background: var(--cad-bg-overlay);
      display: flex; align-items: center; justify-content: center; z-index: 50;
    }
    .lib-rename-box {
      background: var(--cad-bg-panel-solid); border: 1px solid var(--cad-border);
      border-radius: 8px; padding: 16px; width: 260px;
      display: flex; flex-direction: column; gap: 10px;
      box-shadow: var(--cad-shadow-panel);
    }
    .lib-rename-title { font-size: 13px; font-weight: 600; color: var(--cad-text-primary); }
    .lib-rename-input {
      background: var(--cad-bg-input); border: 1px solid var(--cad-border);
      color: var(--cad-text-primary); border-radius: 6px; padding: 6px 10px;
      font-size: 13px; font-family: inherit; width: 100%; box-sizing: border-box;
      outline: none; &:focus { border-color: var(--cad-accent); }
    }
    .lib-rename-actions { display: flex; gap: 6px; justify-content: flex-end; }
    .lib-btn { border: none; border-radius: 5px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
    .lib-btn-sm { padding: 4px 10px; font-size: 11px; }
    .lib-btn-primary { background: #5eead4; color: #0e0e1c; font-weight: 600; &:hover { background: #7af0de; } }
    .lib-btn-secondary {
      background: transparent; color: #aaa; border: 1px solid #2a2a40;
      &:hover { background: #1e1e30; color: #e2e2f0; }
    }
  `],
})
export class LibraryPanelComponent {
  protected library = inject(LibraryService);
  private tools = inject(ToolManagerService);

  protected searchQuery = '';
  protected renamingItem = signal<ILibraryItem | null>(null);
  protected renameValue = '';

  protected itemsByCategory(cat: string): number {
    return this.library.items().filter(i => i.category === cat).length;
  }

  protected clearSearch(): void {
    this.searchQuery = '';
    this.library.searchQuery.set('');
  }

  protected onInsert(item: ILibraryItem): void {
    InsertLibraryItemTool.pendingItem = item;
    this.tools.setTool('insert_library_item');
  }

  protected onCardAction(ev: { item: ILibraryItem; type: string }): void {
    const { item, type } = ev;
    switch (type) {
      case 'rename':
        this.renamingItem.set(item);
        this.renameValue = item.name;
        break;
      case 'duplicate':
        this.library.duplicateItem(item.id);
        break;
      case 'favorite':
        this.library.toggleFavorite(item.id);
        break;
      case 'delete':
        if (confirm(`Delete "${item.name}" from library?`)) {
          this.library.deleteItem(item.id);
        }
        break;
    }
  }

  protected confirmRename(): void {
    const item = this.renamingItem();
    if (!item || !this.renameValue.trim()) return;
    this.library.updateItem(item.id, { name: this.renameValue.trim() });
    this.renamingItem.set(null);
  }

  protected cancelRename(): void {
    this.renamingItem.set(null);
  }
}
