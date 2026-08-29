import {
  Component, inject, signal, OnInit, effect,
  ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { LibraryService } from '../../core/services/library.service';
import { SaveToLibraryModalService } from './save-to-library-modal.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-save-to-library-modal',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (modal.state().open) {
      <div class="lib-modal-overlay" (click)="onOverlayClick($event)">
        <div class="lib-modal" role="dialog" aria-modal="true" aria-label="Save to Library">

          <div class="lib-modal-header">
            <span class="lib-modal-title">Save to Library</span>
            <button class="lib-modal-close" type="button" (click)="close()" title="Close">✕</button>
          </div>

          <div class="lib-modal-body">

            <!-- Thumbnail preview -->
            <div class="lib-thumb-row">
              <div class="lib-thumb-preview">
                @if (thumbnail()) {
                  <img [src]="thumbnail()" alt="Preview" width="80" height="80" />
                } @else {
                  <div class="lib-thumb-placeholder">⬡</div>
                }
              </div>
              <div class="lib-entity-count">
                {{ modal.state().entities.length }} entity{{ modal.state().entities.length === 1 ? '' : 'ies' }} selected
              </div>
            </div>

            <!-- Name -->
            <div class="lib-field">
              <label class="lib-label" for="lib-name">Component Name *</label>
              <input
                id="lib-name"
                class="lib-input"
                type="text"
                [(ngModel)]="name"
                placeholder="e.g. North Arrow"
                maxlength="80"
                autofocus
              />
            </div>

            <!-- Category -->
            <div class="lib-field">
              <label class="lib-label" for="lib-category">Category</label>
              <select id="lib-category" class="lib-input" [(ngModel)]="category">
                @for (cat of library.categories(); track cat.name) {
                  <option [value]="cat.name">{{ cat.icon }} {{ cat.name }}</option>
                }
              </select>
            </div>

            <!-- Description -->
            <div class="lib-field">
              <label class="lib-label" for="lib-desc">Description (optional)</label>
              <textarea
                id="lib-desc"
                class="lib-input lib-textarea"
                [(ngModel)]="description"
                placeholder="What is this component for?"
                rows="2"
              ></textarea>
            </div>

            <!-- Tags -->
            <div class="lib-field">
              <label class="lib-label" for="lib-tags">Tags (comma-separated)</label>
              <input
                id="lib-tags"
                class="lib-input"
                type="text"
                [(ngModel)]="tagsRaw"
                placeholder="north arrow, orientation, symbol"
              />
            </div>

          </div>

          <div class="lib-modal-footer">
            <button class="lib-btn lib-btn-secondary" type="button" (click)="close()">Cancel</button>
            <button
              class="lib-btn lib-btn-primary"
              type="button"
              [disabled]="!name.trim() || saving()"
              (click)="save()"
            >
              {{ saving() ? 'Saving…' : '⊕ Save to Library' }}
            </button>
          </div>

        </div>
      </div>
    }
  `,
  styles: [`
    .lib-modal-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(2px);
      display: flex; align-items: center; justify-content: center;
    }
    .lib-modal {
      width: 380px; max-width: 95vw;
      background: var(--cad-bg-panel-solid); border: 1px solid var(--cad-border);
      border-radius: 10px; overflow: hidden;
      box-shadow: var(--cad-shadow-float);
      animation: lib-modal-in 0.18s cubic-bezier(.2,.9,.4,1);
    }
    @keyframes lib-modal-in {
      from { opacity: 0; transform: translateY(-12px) scale(0.97); }
      to   { opacity: 1; transform: none; }
    }
    .lib-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px 10px;
      border-bottom: 1px solid var(--cad-border-soft);
    }
    .lib-modal-title { font-size: 14px; font-weight: 600; color: var(--cad-text-primary); }
    .lib-modal-close {
      background: none; border: none; cursor: pointer;
      color: var(--cad-text-dim); font-size: 14px; padding: 2px 6px; border-radius: 4px;
      &:hover { background: var(--cad-bg-hover); color: var(--cad-text-primary); }
    }
    .lib-modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
    .lib-thumb-row { display: flex; align-items: center; gap: 14px; }
    .lib-thumb-preview {
      width: 80px; height: 80px; flex-shrink: 0;
      border-radius: 8px; overflow: hidden; border: 1px solid var(--cad-border);
      background: var(--cad-bg-input); display: flex; align-items: center; justify-content: center;
      img { width: 80px; height: 80px; object-fit: contain; }
    }
    .lib-thumb-placeholder { font-size: 28px; color: var(--cad-accent); opacity: 0.5; }
    .lib-entity-count { font-size: 12px; color: var(--cad-text-secondary); }
    .lib-field { display: flex; flex-direction: column; gap: 4px; }
    .lib-label { font-size: 11px; font-weight: 500; color: var(--cad-text-dim); }
    .lib-input {
      background: var(--cad-bg-input); border: 1px solid var(--cad-border);
      color: var(--cad-text-primary); border-radius: 6px; padding: 6px 10px;
      font-size: 13px; font-family: inherit; width: 100%; box-sizing: border-box;
      outline: none; transition: border-color 0.15s;
      &:focus { border-color: var(--cad-accent); }
    }
    .lib-textarea { resize: vertical; min-height: 48px; }
    .lib-modal-footer {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 12px 18px 14px; border-top: 1px solid var(--cad-border-soft);
    }
    .lib-btn {
      padding: 6px 16px; border-radius: 6px; font-size: 13px;
      font-weight: 500; cursor: pointer; border: none; transition: all 0.15s;
    }
    .lib-btn-secondary {
      background: transparent; color: var(--cad-text-secondary); border: 1px solid var(--cad-border);
      &:hover { background: var(--cad-bg-hover); color: var(--cad-text-primary); }
    }
    .lib-btn-primary {
      background: var(--cad-accent); color: var(--cad-text-on-accent);
      &:hover:not(:disabled) { filter: brightness(1.1); }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }
  `],
})
export class SaveToLibraryModalComponent implements OnInit {
  protected modal = inject(SaveToLibraryModalService);
  protected library = inject(LibraryService);

  name = '';
  category = 'Symbols';
  description = '';
  tagsRaw = '';
  thumbnail = signal<string>('');
  saving = signal(false);

  constructor() {
    // Regenerate thumbnail whenever the modal opens with new entities.
    effect(() => {
      const { open, entities } = this.modal.state();
      if (open && entities.length) {
        this.thumbnail.set('');
        this.library.generateThumbnail(entities).then(t => this.thumbnail.set(t));
      }
    });
  }

  ngOnInit(): void { }

  async save(): Promise<void> {
    if (!this.name.trim() || this.saving()) return;
    this.saving.set(true);
    try {

      const tags = this.tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
      await this.library.saveToLibrary(this.modal.state().entities, {
        name: this.name.trim(),
        category: this.category,
        description: this.description.trim() || undefined,
        tags,
      });
      this.reset();
      this.modal.close();
    } finally {
      this.saving.set(false);
    }
  }

  close(): void {
    this.reset();
    this.modal.close();
  }

  onOverlayClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('lib-modal-overlay')) {
      this.close();
    }
  }

  private reset(): void {
    this.name = '';
    this.category = 'Symbols';
    this.description = '';
    this.tagsRaw = '';
    this.thumbnail.set('');
  }
}
