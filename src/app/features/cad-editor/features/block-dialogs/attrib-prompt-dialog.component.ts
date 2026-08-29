import { Component, inject , ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { AttribPromptDialogService } from './attrib-prompt-dialog.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-attrib-prompt-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (dialog.isOpen()) {
      <div class="attrib-overlay" (click)="dialog.cancel()">
        <div class="attrib-dialog" (click)="$event.stopPropagation()">
          <h3>Block Attributes — {{ dialog.blockName() }}</h3>
          <div class="attrib-fields">
            @for (def of promptDefs(); track def.tag) {
              <label class="attrib-field">
                <span class="attrib-tag">{{ def.tag }}</span>
                @if (def.prompt) {
                  <span class="attrib-prompt">{{ def.prompt }}</span>
                }
                <input type="text" [value]="values.get(def.tag) ?? def.defaultValue"
                  (input)="values.set(def.tag, $any($event.target).value)" />
                </label>
              }
            </div>
            <div class="attrib-actions">
              <button class="btn primary" type="button" (click)="onOk()">OK</button>
              <button class="btn" type="button" (click)="dialog.cancel()">Cancel</button>
            </div>
          </div>
        </div>
      }
    `,
  styles: [`
    .attrib-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
    }
    .attrib-dialog {
      background: var(--cad-bg-surface, #1e1e2e); color: var(--cad-text-primary, #cdd6f4);
      border: 1px solid var(--cad-border, #45475a); border-radius: 6px;
      padding: 20px; min-width: 340px; max-width: 480px;
    }
    h3 { margin: 0 0 16px; font-size: 14px; }
    .attrib-fields { display: flex; flex-direction: column; gap: 10px; }
    .attrib-field { display: flex; flex-direction: column; gap: 2px; }
    .attrib-tag { font-weight: 600; font-size: 12px; }
    .attrib-prompt { font-size: 11px; color: var(--cad-text-dim, #a6adc8); }
    .attrib-field input {
      background: var(--cad-bg-input, #313244); color: var(--cad-text-primary);
      border: 1px solid var(--cad-border); border-radius: 3px;
      padding: 4px 8px; font-size: 12px; outline: none;
      &:focus { border-color: var(--cad-accent); }
    }
    .attrib-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    .btn {
      padding: 5px 16px; border-radius: 4px; cursor: pointer; font-size: 12px;
      background: transparent; color: var(--cad-text-primary);
      border: 1px solid var(--cad-border);
      &:hover { background: var(--cad-bg-hover); }
      &.primary { background: var(--cad-accent); color: var(--cad-text-on-accent); border-color: var(--cad-accent); }
      &.primary:hover { background: var(--cad-accent-dim); border-color: var(--cad-accent-dim); }
    }
  `],
})
export class AttribPromptDialogComponent {
  protected dialog = inject(AttribPromptDialogService);
  values = new Map<string, string>();

  promptDefs() {
    return this.dialog.attDefs().filter(d => !d.constant);
  }

  onOk(): void {
    this.dialog.commit(this.values);
    this.values = new Map();
  }
}
