import { Component, effect, inject, signal , ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InsertBlockDialogService, IInsertBlockParams } from './insert-block-dialog.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-insert-block-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (svc.isOpen()) {
      <div class="block-dialog-overlay" (click)="svc.cancel()">
        <div class="block-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="insert-block-title" (click)="$event.stopPropagation()">
          <div id="insert-block-title" class="title">Insert Block</div>

          <div class="form-grid">
            <label>Block</label>
            <div class="field">
              <select [(ngModel)]="config.blockName" class="sel">
                @for (n of filteredNames(); track n) {
                  <option [value]="n">{{ n }}</option>
                }
              </select>
            </div>

            <label>Filter</label>
            <div class="field">
              <input type="text" [(ngModel)]="filter" placeholder="Search..." (ngModelChange)="onFilterChange()" />
            </div>

            <label>Scale X</label>
            <div class="field">
              <input type="number" [(ngModel)]="config.scaleX" step="0.1"
                     (ngModelChange)="onScaleXChange()" />
            </div>

            <label>Scale Y</label>
            <div class="field">
              <input type="number" [(ngModel)]="config.scaleY" step="0.1"
                     [disabled]="config.uniformScale" />
            </div>

            <label>Uniform</label>
            <div class="field">
              <label class="checkbox">
                <input type="checkbox" [(ngModel)]="config.uniformScale"
                       (ngModelChange)="onUniformChange()" />
                Uniform Scale
              </label>
            </div>

            <label>Rotation</label>
            <div class="field">
              <input type="number" [(ngModel)]="config.rotation" step="1" />
              <span class="suffix">°</span>
            </div>
          </div>

          <div class="actions">
            <button class="btn primary" type="button" (click)="ok()" [disabled]="!config.blockName">OK</button>
            <button class="btn" type="button" (click)="svc.cancel()">Cancel</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .block-dialog-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 9000;
    }
    .block-dialog-panel {
      background: var(--cad-bg-panel, #1e1e2e); color: var(--cad-text-primary, #cdd6f4);
      border: 1px solid var(--cad-border, #45475a); border-radius: 8px;
      padding: 20px; min-width: 360px; max-width: 460px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .title { font-size: 15px; font-weight: 600; margin-bottom: 16px; }
    .form-grid {
      display: grid; grid-template-columns: 80px 1fr; gap: 10px 12px; align-items: center;
      label { font-size: 12px; color: var(--cad-text-dim, #a6adc8); }
    }
    .field {
      display: flex; align-items: center; gap: 4px;
      input[type="text"], input[type="number"] {
        background: var(--cad-bg-input, #181825); border: 1px solid var(--cad-border, #45475a);
        color: var(--cad-text-primary, #cdd6f4); padding: 5px 8px; border-radius: 4px;
        font-size: 12px; width: 100%;
        &:focus { outline: none; border-color: #89b4fa; }
        &:disabled { opacity: 0.4; }
      }
      .sel {
        background: var(--cad-bg-input, #181825); border: 1px solid var(--cad-border, #45475a);
        color: var(--cad-text-primary, #cdd6f4); padding: 5px 8px; border-radius: 4px;
        font-size: 12px; width: 100%;
        &:focus { outline: none; border-color: #89b4fa; }
      }
      .suffix { font-size: 11px; color: var(--cad-text-dim, #a6adc8); }
    }
    .checkbox {
      display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;
      input { margin: 0; accent-color: #89b4fa; }
    }
    .actions {
      display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px;
      .btn {
        background: var(--cad-bg-hover, #313244); color: var(--cad-text-primary, #cdd6f4);
        border: 1px solid var(--cad-border, #45475a); padding: 6px 18px;
        border-radius: 4px; cursor: pointer; font-size: 12px;
        &:hover { background: var(--cad-bg-input, #181825); }
        &.primary { background: #89b4fa; color: #1e1e2e; border-color: #89b4fa; font-weight: 600; }
        &.primary:hover { background: #74c7ec; }
        &:disabled { opacity: 0.4; cursor: default; }
      }
    }
  `],
})
export class InsertBlockDialogComponent {
  protected svc = inject(InsertBlockDialogService);

  config: IInsertBlockParams = { blockName: '', scaleX: 1, scaleY: 1, rotation: 0, uniformScale: true };
  filter = '';
  filteredNames = signal<string[]>([]);

  constructor() {
    effect(() => {
      if (this.svc.isOpen()) {
        this.config = { ...this.svc.config() };
        this.filter = '';
        this.filteredNames.set(this.svc.blockNames());
      }
    });
  }

  onFilterChange(): void {
    const q = this.filter.toLowerCase();
    const all = this.svc.blockNames();
    this.filteredNames.set(q ? all.filter((n) => n.toLowerCase().includes(q)) : all);
  }

  onScaleXChange(): void {
    if (this.config.uniformScale) this.config.scaleY = this.config.scaleX;
  }

  onUniformChange(): void {
    if (this.config.uniformScale) this.config.scaleY = this.config.scaleX;
  }

  ok(): void {
    if (!this.config.blockName) return;
    this.svc.commit({ ...this.config });
  }
}
