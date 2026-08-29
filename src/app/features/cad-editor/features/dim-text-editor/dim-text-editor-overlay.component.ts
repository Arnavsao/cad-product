import { Component, ChangeDetectionStrategy, ViewChild, ElementRef, HostListener, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DimTextEditorService } from './dim-text-editor.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-dim-text-editor-overlay',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (svc.state(); as s) {
      <div class="dim-te-overlay"
        [style.left.px]="s.clickSx"
        [style.top.px]="s.clickSy">
        
        <input 
          #editInput
          type="text"
          class="dim-te-input"
          [value]="getInitialValue(s)"
          (keydown)="onKey($event)"
          (blur)="commit()"
          spellcheck="false"
          autocomplete="off" />
      </div>
    }
  `,
  styles: [`
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 50; /* ensure it's above canvas */
    }
    
    .dim-te-overlay {
      position: absolute;
      pointer-events: auto;
      transform: translate(-50%, -50%); /* center on click */
      background: var(--cad-bg-overlay, #1e2733);
      border: 1px solid var(--cad-yellow, #f0a030);
      border-radius: 4px;
      padding: 4px;
      box-shadow: var(--cad-shadow-float);
      display: flex;
    }
    
    .dim-te-input {
      background: var(--cad-bg-input, rgba(0,0,0,0.2));
      border: 1px solid transparent;
      outline: none;
      color: var(--cad-text-primary, #ffffff);
      font-family: var(--cad-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: 12px;
      padding: 4px 6px;
      min-width: 120px;
      text-align: center;
      caret-color: var(--cad-yellow, #f0a030);
      border-radius: 2px;
    }
    
    .dim-te-input:focus {
      border-color: rgba(255, 255, 255, 0.2);
    }
  `]
})
export class DimTextEditorOverlayComponent {
  protected svc = inject(DimTextEditorService);

  @ViewChild('editInput') editInput?: ElementRef<HTMLInputElement>;

  constructor() {
    effect(() => {
      if (this.svc.state()) {
        setTimeout(() => {
          if (this.editInput?.nativeElement) {
            this.editInput.nativeElement.focus();
            this.editInput.nativeElement.select();
          }
        });
      }
    });
  }

  getInitialValue(s: any): string {
    const override = s.entity.textOverride;
    if (!override || override === '<>') {
      return s.measuredText || '<>';
    }
    if (s.measuredText && override.includes('<>')) {
      return override.replace('<>', s.measuredText);
    }
    return override;
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.svc.cancel();
    }
  }

  commit(): void {
    const val = this.editInput?.nativeElement.value;
    if (val !== undefined) {
      this.svc.commit(val === '<>' ? null : val);
    }
  }
}
