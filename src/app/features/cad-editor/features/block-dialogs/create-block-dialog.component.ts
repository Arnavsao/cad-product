import { Component, effect, inject, signal , ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CreateBlockDialogService, ICreateBlockResult } from './create-block-dialog.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-create-block-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (svc.isOpen()) {
      <div class="block-dialog-overlay" (click)="svc.cancel()">
        <div class="block-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="create-block-title" (click)="$event.stopPropagation()">
          <div id="create-block-title" class="title">Create Block</div>

          <div class="form-grid">
            <label>Name</label>
            <div class="field">
              <input type="text" [(ngModel)]="name" (keydown.enter)="ok()"
                     [class.invalid]="nameError()" autofocus />
              @if (nameError()) {
                <span class="error">{{ nameError() }}</span>
              }
            </div>

            <label>Base Point</label>
            <div class="field radio-group">
              <label class="radio">
                <input type="radio" name="bp" value="pick" [(ngModel)]="basePointMode" /> Pick on screen
              </label>
              <label class="radio">
                <input type="radio" name="bp" value="origin" [(ngModel)]="basePointMode" /> Use origin (0, 0)
              </label>
            </div>

            <label>Description</label>
            <div class="field">
              <input type="text" [(ngModel)]="description" placeholder="Optional" />
            </div>
          </div>

          <div class="actions">
            <button class="btn primary" type="button" (click)="ok()" [disabled]="!!nameError()">OK</button>
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
      display: grid; grid-template-columns: 90px 1fr; gap: 10px 12px; align-items: start;
      label { font-size: 12px; padding-top: 6px; color: var(--cad-text-dim, #a6adc8); }
    }
    .field {
      display: flex; flex-direction: column; gap: 4px;
      input[type="text"] {
        background: var(--cad-bg-input, #181825); border: 1px solid var(--cad-border, #45475a);
        color: var(--cad-text-primary, #cdd6f4); padding: 5px 8px; border-radius: 4px; font-size: 12px;
        &.invalid { border-color: #f38ba8; }
        &:focus { outline: none; border-color: #89b4fa; }
      }
    }
    .radio-group { display: flex; flex-direction: column; gap: 6px; }
    .radio {
      display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;
      input { margin: 0; accent-color: #89b4fa; }
    }
    .error { color: #f38ba8; font-size: 11px; }
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
export class CreateBlockDialogComponent {
  protected svc = inject(CreateBlockDialogService);

  name = '';
  basePointMode: 'pick' | 'origin' = 'pick';
  description = '';

  nameError = signal<string>('');

  constructor() {
    effect(() => {
      if (this.svc.isOpen()) {
        this.name = this.svc.suggestedName();
        this.basePointMode = 'pick';
        this.description = '';
        this.nameError.set('');
      }
    });
  }

  private validate(): boolean {
    const trimmed = this.name.trim();
    if (!trimmed) { this.nameError.set('Name is required'); return false; }
    if (trimmed.startsWith('*')) { this.nameError.set('Name cannot start with *'); return false; }
    if (this.svc.existingNames().includes(trimmed)) {
      this.nameError.set(`"${trimmed}" already exists`);
      return false;
    }
    this.nameError.set('');
    return true;
  }

  ok(): void {
    if (!this.validate()) return;
    const result: ICreateBlockResult = {
      name: this.name.trim(),
      basePointMode: this.basePointMode,
      description: this.description.trim(),
    };
    this.svc.commit(result);
  }
}
