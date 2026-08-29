import { Component, HostListener, inject , ChangeDetectionStrategy
} from '@angular/core';

import { SymbolPickerService } from './symbol-picker.service';
import { SafeHtmlPipe } from '../../shared/components/safe-html.pipe';

/**
 * Modal picker for engineering symbols. Replaces the old `window.prompt`
 * text-only flow with a visual grid: each tile renders the symbol as an
 * inline SVG preview, the block name, and a one-line description.
 *
 * Wiring:
 *   - Backdrop click → cancel
 *   - Esc key       → cancel
 *   - Tile click    → svc.select(name) → resolves the open() promise
 *   - × button      → cancel
 *
 * The overlay is mounted once in cad-editor.html and shows whenever
 * `SymbolPickerService.isOpen()` is true.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-symbol-picker',
  standalone: true,
  imports: [SafeHtmlPipe],
  template: `
    @if (svc.isOpen()) {
      <div class="sp-backdrop" (mousedown)="onBackdropMouseDown($event)">
        <div class="sp-dialog" (mousedown)="$event.stopPropagation()">
          <div class="sp-header">
            <h3>Insert Engineering Symbol</h3>
            <button type="button" class="sp-close" (click)="svc.cancel()" title="Cancel (Esc)">×</button>
          </div>
          <div class="sp-grid">
            @for (s of svc.catalog; track s) {
              <button
                type="button"
                class="sp-card"
                (click)="svc.select(s.name)"
                [title]="s.label + ' — ' + s.desc">
                <div class="sp-preview" [innerHTML]="s.svg | safeHtml"></div>
                <div class="sp-name">{{ s.label }}</div>
                <div class="sp-desc">{{ s.desc }}</div>
              </button>
            }
          </div>
        </div>
      </div>
    }
    `,
  styles: [`
    .sp-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }
    .sp-dialog {
      background: var(--cad-bg-panel-solid, #1f2026);
      border: 1px solid var(--cad-border, #3a3b40);
      border-radius: 8px;
      box-shadow: var(--cad-shadow-float);
      width: 480px;
      max-width: calc(100vw - 32px);
      color: var(--cad-text-primary, #e6e6e6);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--cad-border, #3a3b40);
      background: var(--cad-bg-hover);
    }
    .sp-header h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .sp-close {
      background: transparent;
      border: none;
      color: var(--cad-text-secondary, #b8b8b8);
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .sp-close:hover {
      background: var(--cad-bg-hover);
      color: var(--cad-text-primary);
    }
    .sp-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      padding: 14px;
    }
    .sp-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 14px 12px;
      background: var(--cad-bg-base, #18191c);
      border: 1px solid var(--cad-border, #3a3b40);
      border-radius: 6px;
      color: inherit;
      cursor: pointer;
      font-family: inherit;
      text-align: center;
      transition: background-color 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
    }
    .sp-card:hover {
      background: var(--cad-accent-tint);
      border-color: var(--cad-accent);
      transform: translateY(-1px);
    }
    .sp-card:active {
      transform: translateY(0);
      background: var(--cad-accent-tint);
    }
    .sp-preview {
      width: 56px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--cad-text-primary, #e6e6e6);
    }
    .sp-preview ::ng-deep svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .sp-name {
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .sp-desc {
      font-size: 11px;
      color: var(--cad-text-secondary, #9ea0a6);
      line-height: 1.3;
    }
  `],
})
export class SymbolPickerOverlayComponent {
  protected svc = inject(SymbolPickerService);

  /**
   * Backdrop click cancels. Stops propagation if the click came through
   * the dialog itself (handled at the dialog div), so this only fires for
   * clicks on the dark outer area.
   */
  onBackdropMouseDown(_e: MouseEvent): void {
    this.svc.cancel();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(e: Event): void {
    if (!this.svc.isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    this.svc.cancel();
  }
}
