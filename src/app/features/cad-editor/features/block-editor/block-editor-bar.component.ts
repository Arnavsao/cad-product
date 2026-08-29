import {
  Component, inject, ChangeDetectionStrategy
} from '@angular/core';
import { BlockEditorService } from '../../core/services/block-editor.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-block-editor-bar',
  standalone: true,
  template: `
    @if (blockEditor.isActive()) {
      <div class="bedit-bar">
        <span class="bedit-label">
          <!-- Editing Block: <strong>{{ blockEditor.editingBlockName() }}</strong> -->
        </span>
        <div class="bedit-actions">
          <button class="bedit-btn save" type="button" (click)="blockEditor.save()">Save Block</button>
          <button class="bedit-btn discard" type="button" (click)="blockEditor.discard()">Discard</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .bedit-bar {
      position: absolute; top: 0; left: 0; right: 0; z-index: 50;
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 16px;
      background: var(--cad-bg-hover, #1e1e2e);
      border-bottom: 2px solid #f9e2af;
      color: var(--cad-text-primary, #cdd6f4);
      font-size: 13px;
    }
    .bedit-label { font-size: 13px; }
    .bedit-label strong { color: #f9e2af; }
    .bedit-actions { display: flex; gap: 8px; }
    .bedit-btn {
      padding: 4px 14px; border-radius: 4px; font-size: 12px;
      cursor: pointer; border: 1px solid transparent;
    }
    .bedit-btn.save {
      background: #a6e3a1; color: #1e1e2e; border-color: #a6e3a1;
      &:hover { background: #94d89a; }
    }
    .bedit-btn.discard {
      background: transparent; color: #f38ba8; border-color: #f38ba8;
      &:hover { background: rgba(243, 139, 168, 0.1); }
    }
  `],
})
export class BlockEditorBarComponent {
  protected blockEditor = inject(BlockEditorService);
}
