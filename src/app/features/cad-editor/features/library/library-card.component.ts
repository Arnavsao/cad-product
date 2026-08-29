import {
  Component, signal, inject, HostListener,
  output,
  ChangeDetectionStrategy,
  input
} from '@angular/core';

import type { ILibraryItem } from '../../core/models/library.model';
import { LibraryService } from '../../core/services/library.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-library-card',
  standalone: true,
  imports: [],
  template: `
    <div
      class="lib-card"
      draggable="true"
      [title]="item().name + ' — ' + item().category"
      (click)="clickInsert.emit(item())"
      (dragstart)="onDragStart($event)"
      (contextmenu)="onContextMenu($event)"
      (mouseenter)="hovered.set(true)"
      (mouseleave)="hovered.set(false); menuOpen.set(false)"
    >
      <!-- Thumbnail -->
      <div class="lib-card-thumb">
        <img
          [src]="item().thumbnail"
          [alt]="item().name"
          class="lib-card-img"
          loading="lazy"
        />
        @if (hovered()) {
          <div class="lib-card-overlay">
            <button class="lib-insert-btn" (click)="$event.stopPropagation(); clickInsert.emit(item())">
              ↗ Insert
            </button>
          </div>
        }
      </div>

      <!-- Info -->
      <div class="lib-card-info">
        <div class="lib-card-name" [title]="item().name">{{ item().name }}</div>
        <div class="lib-card-cat">{{ item().category }}</div>
      </div>

      <!-- Ellipsis menu -->
      <button
        class="lib-card-menu-btn"
        type="button"
        title="More options"
        (click)="$event.stopPropagation(); menuOpen.set(!menuOpen())"
      >⋯</button>

      <!-- Context dropdown -->
      @if (menuOpen()) {
        <div class="lib-card-dropdown" (click)="$event.stopPropagation()">
          <button class="lib-dd-item" (click)="emitAndClose('rename')">✏ Rename</button>
          <button class="lib-dd-item" (click)="emitAndClose('duplicate')">⊕ Duplicate</button>
          <button class="lib-dd-item" (click)="emitAndClose('favorite')">
            {{ item().category === 'Favorites' ? '★ Unfavorite' : '☆ Favorite' }}
          </button>
          <div class="lib-dd-sep"></div>
          <button class="lib-dd-item lib-dd-danger" (click)="emitAndClose('delete')">✕ Delete</button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; position: relative; }

    .lib-card {
      position: relative; border-radius: 8px;
      background: var(--cad-bg-panel-solid); border: 1px solid var(--cad-border);
      cursor: pointer; user-select: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      overflow: hidden;
      &:hover { border-color: var(--cad-accent); box-shadow: 0 0 0 2px var(--cad-accent-tint); }
    }
    .lib-card-thumb {
      width: 100%; aspect-ratio: 1;
      background: var(--cad-bg-input); position: relative; overflow: hidden;
    }
    .lib-card-img {
      width: 100%; height: 100%; object-fit: contain;
      display: block;
    }
    .lib-card-overlay {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      animation: lib-fade-in 0.1s ease;
    }
    @keyframes lib-fade-in { from { opacity: 0; } to { opacity: 1; } }
    .lib-insert-btn {
      background: var(--cad-accent); color: var(--cad-text-on-accent);
      border: none; border-radius: 5px;
      padding: 4px 10px; font-size: 11px; font-weight: 600;
      cursor: pointer;
      &:hover { filter: brightness(1.1); }
    }
    .lib-card-info {
      padding: 6px 8px 4px;
    }
    .lib-card-name {
      font-size: 11px; font-weight: 500; color: var(--cad-text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .lib-card-cat { font-size: 10px; color: var(--cad-text-dim); }

    .lib-card-menu-btn {
      position: absolute; top: 4px; right: 4px;
      background: rgba(0,0,0,0.5); border: none;
      color: #fff; border-radius: 4px; padding: 1px 5px;
      font-size: 14px; cursor: pointer; line-height: 1.4;
      opacity: 0; transition: opacity 0.1s;
      &:hover { background: rgba(0,0,0,0.7); }
    }
    .lib-card:hover .lib-card-menu-btn { opacity: 1; }

    .lib-card-dropdown {
      position: absolute; top: 28px; right: 4px; z-index: 100;
      background: var(--cad-bg-panel); border: 1px solid var(--cad-border);
      border-radius: 7px; box-shadow: var(--cad-shadow-panel);
      padding: 4px; min-width: 130px;
      animation: lib-dd-in 0.12s ease;
    }
    @keyframes lib-dd-in {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: none; }
    }
    .lib-dd-item {
      display: block; width: 100%; text-align: left;
      background: none; border: none; color: var(--cad-text-secondary);
      padding: 6px 10px; font-size: 12px; border-radius: 5px;
      cursor: pointer;
      &:hover { background: var(--cad-bg-hover); color: var(--cad-text-primary); }
    }
    .lib-dd-danger { color: var(--cad-red); &:hover { background: rgba(255,0,0,0.1); filter: brightness(1.2); } }
    .lib-dd-sep { height: 1px; background: var(--cad-border); margin: 4px 0; }
  `],
})
export class LibraryCardComponent {
  readonly item = input.required<ILibraryItem>();
  readonly clickInsert = output<ILibraryItem>();
  readonly action = output<{type: string, item: ILibraryItem}>();

  hovered = signal(false);
  protected menuOpen = signal(false);

  onDragStart(e: DragEvent): void {
    e.dataTransfer?.setData('text/plain', this.item().id);
    e.dataTransfer!.effectAllowed = 'copy';
  }

  onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    this.menuOpen.set(true);
  }

  emitAndClose(type: string): void {
    this.menuOpen.set(false);
    this.action.emit({ item: this.item(), type });
  }

  @HostListener('document:click')
  onDocClick(): void {
    if (this.menuOpen()) this.menuOpen.set(false);
  }
}
