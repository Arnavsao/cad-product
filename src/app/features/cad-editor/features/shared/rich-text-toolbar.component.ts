import {
  Component, Input, output, ChangeDetectionStrategy,
  input
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ColorPickerComponent } from './color-picker/color-picker.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-rich-text-toolbar',
  standalone: true,
  imports: [FormsModule, ColorPickerComponent],
  template: `
    <div class="te-toolbar" (mousedown)="$event.stopPropagation()">
      <select class="te-select" [ngModel]="font()" (ngModelChange)="fontChange.emit($event)">
        <option value="Arial">Arial</option>
        <option value="Helvetica">Helvetica</option>
        <option value="Times New Roman">Times New Roman</option>
        <option value="Courier New">Courier New</option>
        <option value="Georgia">Georgia</option>
        <option value="Verdana">Verdana</option>
        <option value="Tahoma">Tahoma</option>
        <option value="monospace">Monospace</option>
      </select>
    
      <input class="te-input-num" type="number" step="0.5" min="0.001"
        [ngModel]="fontSize()" (ngModelChange)="fontSizeChange.emit($event)" title="Text Height">
    
        <div class="te-sep"></div>
    
        <button class="te-btn" [class.active]="bold()" (click)="boldChange.emit(!bold())" title="Bold"><b>B</b></button>
        <button class="te-btn" [class.active]="italic()" (click)="italicChange.emit(!italic())" title="Italic"><i>I</i></button>
        <button class="te-btn" [class.active]="underline()" (click)="underlineChange.emit(!underline())" title="Underline"><u>U</u></button>
        <button class="te-btn" [class.active]="strikethrough()" (click)="strikethroughChange.emit(!strikethrough())" title="Strikethrough"><s>S</s></button>
    
        @if (showAlign()) {
          <div class="te-sep"></div>
          <button class="te-btn" [class.active]="align() === 'left'" (click)="alignChange.emit('left')" title="Align Left">⫷</button>
          <button class="te-btn" [class.active]="align() === 'center'" (click)="alignChange.emit('center')" title="Align Center">≡</button>
          <button class="te-btn" [class.active]="align() === 'right'" (click)="alignChange.emit('right')" title="Align Right">⫸</button>
        }
    
        @if (showValign()) {
          <div class="te-sep"></div>
          <button class="te-btn" [class.active]="valign() === 'top'" (click)="valignChange.emit('top')" title="Align Top">⇡</button>
          <button class="te-btn" [class.active]="valign() === 'middle'" (click)="valignChange.emit('middle')" title="Align Middle">⇕</button>
          <button class="te-btn" [class.active]="valign() === 'bottom'" (click)="valignChange.emit('bottom')" title="Align Bottom">⇣</button>
        }
    
        <div class="te-sep"></div>
    
        <app-color-picker
          title="Text Color"
          [value]="textColor()"
          [label]="'Text'"
          (valueChange)="textColorChange.emit($event)">
        </app-color-picker>
    
        @if (showBgColor()) {
          <app-color-picker
            title="Background Color"
            [value]="bgColor()"
            [label]="'Fill'"
            (valueChange)="bgColorChange.emit($event)">
          </app-color-picker>
        }
    
        <!-- Content projection slot for specific controls (like Table's +R, +C) -->
        <ng-content></ng-content>
    
        @if (symbols() && symbols().length > 0) {
          <div class="te-sep"></div>
          <div class="te-dropdown">
            <button class="te-btn" (click)="symbolMenuOpen = !symbolMenuOpen" title="Insert Symbol">Ω</button>
            @if (symbolMenuOpen) {
              <div class="te-dropdown-menu">
                @for (sym of symbols(); track sym) {
                  <button class="te-sym" (click)="insertSymbol(sym, $event)">{{ sym }}</button>
                }
              </div>
            }
          </div>
        }
      </div>
    `,
  styles: [`
    .te-toolbar {
      position: relative;
      background: var(--cad-bg-panel-solid, #1f2428);
      border: 1px solid var(--cad-border, #4a5568);
      border-radius: 4px;
      box-shadow: var(--cad-shadow-float);
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      z-index: 1010;
      pointer-events: auto;
      white-space: nowrap;
      height: var(--cad-toolbar-h, 68px);
      box-sizing: border-box;
    }
    .te-select, .te-input-num {
      background: var(--cad-bg-base, #1a202c);
      border: 1px solid var(--cad-border, #4a5568);
      color: var(--cad-text-primary, #e2e8f0);
      padding: 2px 4px;
      border-radius: 2px;
      font-size: 11px;
      outline: none;
    }
    .te-input-num { width: 46px; }
    .te-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--cad-text-primary, #cbd5e0);
      padding: 2px 6px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.2;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 24px;
    }
    .te-btn:hover { background: var(--cad-bg-hover, #4a5568); }
    .te-btn.active { background: var(--cad-accent-tint); border-color: var(--cad-accent); color: var(--cad-accent); }
    
    .te-sep { width: 1px; height: 16px; background: var(--cad-border, #4a5568); margin: 0 2px; }
    
    .te-color-picker {
      position: relative;
      width: 18px;
      height: 18px;
      border: 1px solid var(--cad-border, #4a5568);
      border-radius: 2px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .te-color-icon { font-size: 12px; font-weight: bold; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    .te-color-picker input[type="color"] {
      position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
    }
    
    .te-dropdown { position: relative; }
    .te-dropdown-menu {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      background: var(--cad-bg-panel-solid, #2d3748);
      border: 1px solid var(--cad-border, #4a5568);
      border-radius: 2px;
      box-shadow: var(--cad-shadow-float);
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 2px;
      padding: 4px;
      z-index: 1020;
    }
    .te-sym {
      width: 26px; height: 26px; padding: 0;
      display: flex; align-items: center; justify-content: center;
      font-family: 'Segoe UI Symbol', sans-serif;
      background: transparent;
      color: var(--cad-text-primary, #e2e8f0);
      border: 1px solid transparent;
      border-radius: 2px;
      cursor: pointer;
    }
    .te-sym:hover { background: var(--cad-bg-hover, #4a5568); }
  `]
})
export class RichTextToolbarComponent {
  readonly font = input('Arial');
  readonly fontChange = output<string>();

  readonly fontSize = input(2.5);
  readonly fontSizeChange = output<number>();

  readonly bold = input(false);
  readonly boldChange = output<boolean>();
  
  readonly italic = input(false);
  readonly italicChange = output<boolean>();
  
  readonly underline = input(false);
  readonly underlineChange = output<boolean>();

  readonly strikethrough = input(false);
  readonly strikethroughChange = output<boolean>();

  readonly showAlign = input(true);
  readonly align = input('left'); 
  readonly alignChange = output<string>();

  readonly showValign = input(false);
  readonly valign = input('middle'); 
  readonly valignChange = output<string>();

  readonly textColor = input('#ffffff');
  readonly textColorChange = output<string>();

  readonly showBgColor = input(false);
  readonly bgColor = input('#000000');
  readonly bgColorChange = output<string>();

  readonly symbols = input<string[]>([]);
  readonly symbolInsert = output<string>();

  symbolMenuOpen = false;

insertSymbol(sym: string, e: Event) {
    e.stopPropagation();
    e.preventDefault();
    this.symbolInsert.emit(sym);
    this.symbolMenuOpen = false;
  }
}
