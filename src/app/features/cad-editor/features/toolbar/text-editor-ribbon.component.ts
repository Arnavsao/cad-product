import { Component, inject , ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { TextEditorService } from '../text-editor/text-editor.service';
import { TableEditorService } from '../table-editor/table-editor.service';
import { ColorPickerComponent } from '../shared/color-picker/color-picker.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-text-editor-ribbon',
  standalone: true,
  imports: [FormsModule, ColorPickerComponent],
  template: `
    @if (f; as s) {
      <div class="text-ribbon" (mousedown)="$event.stopPropagation()">
        <!-- ═══ STYLE PANEL ═══ -->
        <div class="te-panel">
          <div class="te-panel-body te-panel-row">
            <div class="te-field-group">
              <label class="te-field-label">Font</label>
              <select class="te-select te-font-select" [ngModel]="s.font" (ngModelChange)="s.setFont($event)" title="Font Family">
                @for (fn of fonts; track fn) {
                  <option [value]="fn">{{ fn }}</option>
                }
              </select>
            </div>
            <div class="te-field-group">
              <label class="te-field-label">Height</label>
              <input class="te-input-num" type="number" step="0.5" min="0.001"
                [ngModel]="s.height"
                (change)="s.setHeight(+$any($event.target).value)"
                title="Text Height">
              </div>
              @if (!s.isTable) {
                <div class="te-field-group">
                  <label class="te-field-label">Width×</label>
                  <input class="te-input-num" type="number" step="0.05" min="0.1" max="5"
                    [ngModel]="s.widthFactor"
                    (change)="s.setWidthFactor(+$any($event.target).value)"
                    title="Width Factor (1.0 = normal)">
                  </div>
                }
                @if (!s.isTable) {
                  <div class="te-field-group">
                    <label class="te-field-label">Oblique°</label>
                    <input class="te-input-num" type="number" step="1" min="-85" max="85"
                      [ngModel]="s.obliqueAngle"
                      (change)="s.setObliqueAngle(+$any($event.target).value)"
                      title="Oblique Angle (degrees)">
                    </div>
                  }
                </div>
                <div class="te-panel-label">Style</div>
              </div>
              <div class="te-sep"></div>
              <!-- ═══ FORMATTING PANEL ═══ -->
              <div class="te-panel">
                <div class="te-panel-body te-panel-row">
                  <button class="te-btn" [class.active]="s.bold"
                    (click)="s.setBold(!s.bold)" title="Bold">
                    <b>B</b>
                  </button>
                  <button class="te-btn" [class.active]="s.italic"
                    (click)="s.setItalic(!s.italic)" title="Italic">
                    <i>I</i>
                  </button>
                  <button class="te-btn" [class.active]="s.underline"
                    (click)="s.setUnderline(!s.underline)" title="Underline">
                    <u>U</u>
                  </button>
                  <button class="te-btn" [class.active]="s.overline"
                    (click)="s.setOverline(!s.overline)" title="Overline">
                    <span style="text-decoration:overline">O</span>
                  </button>
                  <button class="te-btn" [class.active]="s.strikethrough"
                    (click)="s.setStrikethrough(!s.strikethrough)" title="Strikethrough">
                    <s>S</s>
                  </button>
                  <div class="te-sep-v"></div>
                  <app-color-picker
                    [value]="s.textColor"
                    [label]="'Color'"
                    (valueChange)="s.setTextColor($event)"
                    title="Text Color">
                  </app-color-picker>
                  <div class="te-sep-v"></div>
                  <button class="te-btn" title="Toggle UPPERCASE / lowercase" (click)="cycleCase(s)">
                    <span style="font-size:10px;letter-spacing:-0.5px;font-weight:600">Aa</span>
                  </button>
                  @if (!s.isTable) {
                    <div class="te-sep-v"></div>
                  }
                  @if (!s.isTable) {
                    <div class="te-field-group">
                      <label class="te-field-label te-label-hide-small">Spacing</label>
                      <input class="te-input-num" type="number" step="0.1" min="-5" max="20"
                        [ngModel]="s.charSpacing"
                        (change)="s.setCharSpacing(+$any($event.target).value)"
                        title="Character Spacing">
                      </div>
                    }
                    @if (s.isTable) {
                      <div class="te-sep-v"></div>
                    }
                    @if (s.isTable) {
                      <app-color-picker
                        [value]="s.backgroundColor"
                        [label]="'Bg'"
                        (valueChange)="s.setBackgroundColor($event)"
                        title="Cell Background Color">
                      </app-color-picker>
                    }
                  </div>
                  <div class="te-panel-label">Formatting</div>
                </div>
                <div class="te-sep"></div>
                <!-- ═══ PARAGRAPH PANEL ═══ -->
                @if (!s.isLeader) {
                  <div class="te-panel">
                    <div class="te-panel-body te-panel-row">
                      <button class="te-btn" [class.active]="s.horiz === 'left'"
                        (click)="s.setHoriz('left')" title="Align Left">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.5"/><rect x="1" y="5.5" width="8" height="1.5" rx="0.5"/><rect x="1" y="9" width="10" height="1.5" rx="0.5"/></svg>
                      </button>
                      <button class="te-btn" [class.active]="s.horiz === 'center'"
                        (click)="s.setHoriz('center')" title="Align Center">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.5"/><rect x="3" y="5.5" width="8" height="1.5" rx="0.5"/><rect x="2" y="9" width="10" height="1.5" rx="0.5"/></svg>
                      </button>
                      <button class="te-btn" [class.active]="s.horiz === 'right'"
                        (click)="s.setHoriz('right')" title="Align Right">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.5"/><rect x="5" y="5.5" width="8" height="1.5" rx="0.5"/><rect x="3" y="9" width="10" height="1.5" rx="0.5"/></svg>
                      </button>
                      <div class="te-sep-v"></div>
                      <button class="te-btn" [class.active]="s.vert === 'top'"
                        (click)="s.setVert('top')" title="Top">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="12" height="1.5" rx="0.5"/><rect x="3" y="4" width="3" height="8" rx="0.5"/><rect x="8" y="4" width="3" height="8" rx="0.5"/></svg>
                      </button>
                      <button class="te-btn" [class.active]="s.vert === 'middle'"
                        (click)="s.setVert('middle')" title="Middle">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="6.25" width="12" height="1.5" rx="0.5"/><rect x="3" y="1" width="3" height="12" rx="0.5"/><rect x="8" y="1" width="3" height="12" rx="0.5"/></svg>
                      </button>
                      <button class="te-btn" [class.active]="s.vert === 'bottom'"
                        (click)="s.setVert('bottom')" title="Bottom">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="11.5" width="12" height="1.5" rx="0.5"/><rect x="3" y="2" width="3" height="8" rx="0.5"/><rect x="8" y="2" width="3" height="8" rx="0.5"/></svg>
                      </button>
                      @if (!s.isTable) {
                        <div class="te-sep-v"></div>
                      }
                      @if (!s.isTable) {
                        <div class="te-field-group">
                          <label class="te-field-label te-label-hide-small">Line Spc</label>
                          <select class="te-select-sm"
                            [ngModel]="s.lineSpacing"
                            (ngModelChange)="s.setLineSpacing(+$event)"
                            title="Line Spacing">
                            <option [value]="1.0">1.0×</option>
                            <option [value]="1.2">1.2×</option>
                            <option [value]="1.5">1.5×</option>
                            <option [value]="2.0">2.0×</option>
                            <option [value]="2.5">2.5×</option>
                          </select>
                        </div>
                      }
                      @if (!s.isTable) {
                        <div class="te-sep-v"></div>
                      }
                      @if (!s.isTable) {
                        <div class="te-dropdown" (mouseleave)="bulletsOpen = false">
                          <button class="te-btn" (click)="bulletsOpen = !bulletsOpen" title="Bullets &amp; Numbering" style="margin-top: 10px;">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="2" cy="3.5" r="1.3"/><rect x="5" y="2.5" width="8" height="2" rx="0.5"/><circle cx="2" cy="7" r="1.3"/><rect x="5" y="6" width="6" height="2" rx="0.5"/><circle cx="2" cy="10.5" r="1.3"/><rect x="5" y="9.5" width="7" height="2" rx="0.5"/></svg>
                            <span style="font-size:9px;margin-left:1px">▾</span>
                          </button>
                          @if (bulletsOpen) {
                            <div class="te-dropdown-menu">
                              <div class="te-menu-label">Insert Prefix</div>
                              <button class="te-menu-item" (click)="s.toggleListType(''); bulletsOpen = false">None</button>
                              <div class="te-sep"></div>
                              <button class="te-menu-item" (click)="s.toggleListType('• '); bulletsOpen = false">&bull; Bulleted</button>
                              <button class="te-menu-item" (click)="s.toggleListType('1. '); bulletsOpen = false">1. Numbered</button>
                              <button class="te-menu-item" (click)="s.toggleListType('a. '); bulletsOpen = false">a. Lowercase</button>
                              <button class="te-menu-item" (click)="s.toggleListType('A. '); bulletsOpen = false">A. Uppercase</button>
                            </div>
                          }
                        </div>
                      }
                    </div>
                    <div class="te-panel-label">Paragraph</div>
                  </div>
                }
                @if (!s.isLeader) {
                  <div class="te-sep"></div>
                }
                <!-- ═══ TABLE PANEL ═══ -->
                @if (s.isTable) {
                  <div class="te-panel">
                    <div class="te-panel-body te-panel-row">
                      <button class="te-btn" (click)="s.insertRow()" title="Insert Row Above/Below">
                        <span style="font-weight:600;font-size:12px">+R</span>
                      </button>
                      <button class="te-btn" (click)="s.deleteRow()" title="Delete Row">
                        <span style="font-weight:600;font-size:12px;color:#ef4444">-R</span>
                      </button>
                      <div class="te-sep-v"></div>
                      <button class="te-btn" (click)="s.insertCol()" title="Insert Column Left/Right">
                        <span style="font-weight:600;font-size:12px">+C</span>
                      </button>
                      <button class="te-btn" (click)="s.deleteCol()" title="Delete Column">
                        <span style="font-weight:600;font-size:12px;color:#ef4444">-C</span>
                      </button>
                    </div>
                    <div class="te-panel-label">Table Cells</div>
                  </div>
                }
                @if (s.isTable) {
                  <div class="te-sep"></div>
                }
                <!-- ═══ INSERT PANEL ═══ -->
                <div class="te-panel">
                  <div class="te-panel-body te-panel-row-wrap">
                    <div class="te-dropdown" (mouseleave)="symbolMenuOpen = false">
                      <button class="te-btn-tall" (click)="symbolMenuOpen = !symbolMenuOpen" title="Insert Symbol">
                        <span class="te-icon-xl">&#937;</span>
                        <span class="te-btn-sub">Symbol</span>
                      </button>
                      @if (symbolMenuOpen) {
                        <div class="te-dropdown-menu te-sym-grid">
                          <div class="te-menu-label te-span-all">Engineering</div>
                          @for (sym of engineeringSymbols; track sym) {
                            <button class="te-sym-btn" [title]="sym.name"
                            (click)="insertSymbol(sym.char); symbolMenuOpen = false">{{ sym.char }}</button>
                          }
                          <div class="te-menu-label te-span-all">Greek</div>
                          @for (sym of greekSymbols; track sym) {
                            <button class="te-sym-btn" [title]="sym.name"
                            (click)="insertSymbol(sym.char); symbolMenuOpen = false">{{ sym.char }}</button>
                          }
                          <div class="te-menu-label te-span-all">Math</div>
                          @for (sym of mathSymbols; track sym) {
                            <button class="te-sym-btn" [title]="sym.name"
                            (click)="insertSymbol(sym.char); symbolMenuOpen = false">{{ sym.char }}</button>
                          }
                        </div>
                      }
                    </div>
                    @if (!s.isTable) {
                      <div class="te-dropdown" (mouseleave)="maskMenuOpen = false">
                        <button class="te-btn-tall" (click)="maskMenuOpen = !maskMenuOpen" title="Background Mask">
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="2" y="2" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="4" width="12" height="12" rx="1" opacity="0.3"/><text x="10" y="14" text-anchor="middle" font-size="8" font-weight="bold">M</text></svg>
                          <span class="te-btn-sub">Mask</span>
                        </button>
                        @if (maskMenuOpen) {
                          <div class="te-dropdown-menu te-mask-menu">
                            <div class="te-menu-label">Background Mask</div>
                            <label class="te-menu-check" style="white-space: nowrap;">
                              <input type="checkbox"
                                [checked]="s.backgroundMask"
                                (change)="s.setBackgroundMask($any($event.target).checked)">
                                Enable Mask
                              </label>
                              @if (s.backgroundMask) {
                                <div class="te-menu-item-group">
                                  <label class="te-field-label-m">Border Offset</label>
                                  <input type="number" class="te-input-sm" step="0.1" min="1" max="5"
                                    [ngModel]="s.maskOffset"
                                    (change)="s.setMaskOffset(+$any($event.target).value)">
                                    <label class="te-field-label-m" style="margin-top:4px; margin-bottom: 2px;">Mask Color</label>
                                    <app-color-picker
                                      [value]="s.backgroundColor"
                                      [label]="''"
                                      (valueChange)="s.setBackgroundColor($event)"
                                      title="Mask Color">
                                    </app-color-picker>
                                  </div>
                                }
                              </div>
                            }
                          </div>
                        }
                        <div class="te-dropdown" (mouseleave)="findMenuOpen = false">
                          <button class="te-btn-tall" (click)="findMenuOpen = !findMenuOpen" title="Find &amp; Replace">
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="8" cy="8" r="5" stroke-width="1.5"/><line x1="12" y1="12" x2="17" y2="17" stroke-width="2"/></svg>
                            <span class="te-btn-sub">Find</span>
                          </button>
                          @if (findMenuOpen) {
                            <div class="te-dropdown-menu te-find-menu">
                              <div class="te-menu-label">Find &amp; Replace</div>
                              <input class="te-find-input" type="text" placeholder="Find..." [(ngModel)]="findText">
                              <input class="te-find-input" type="text" placeholder="Replace with..." [(ngModel)]="replaceText">
                              <div class="te-find-actions">
                                <button class="te-find-btn" (click)="doFindReplace(s, false)">Replace</button>
                                <button class="te-find-btn te-find-btn-all" (click)="doFindReplace(s, true)">All</button>
                              </div>
                            </div>
                          }
                        </div>
                      </div>
                      <div class="te-panel-label">Insert</div>
                    </div>
                    <div class="te-sep"></div>
                    <!-- ═══ OPTIONS PANEL ═══ -->
                    @if (!s.isTable) {
                      <div class="te-panel">
                        <div class="te-panel-body te-panel-row">
                          <div class="te-field-group">
                            <label class="te-field-label te-label-hide-small">Type</label>
                            <label class="te-menu-check" style="white-space:nowrap;margin-top:4px;">
                              <input type="checkbox"
                                [checked]="s.annotative"
                                (change)="s.setAnnotative($any($event.target).checked)">
                                <span class="te-label-hide-small">Annotative</span>
                              </label>
                            </div>
                            <div class="te-field-group">
                              <label class="te-field-label te-label-hide-small">Rotation°</label>
                              <input class="te-input-num" type="number" step="15"
                                [ngModel]="s.rotation"
                                (change)="s.setRotation(+$any($event.target).value)"
                                title="Text Rotation (degrees)">
                              </div>
                            </div>
                            <div class="te-panel-label">Options</div>
                          </div>
                        }
                        @if (!s.isTable) {
                          <div class="te-sep"></div>
                        }
                        <!-- ═══ CLOSE ═══ -->
                        <div class="te-panel te-panel-close">
                          <div class="te-panel-body te-panel-row" style="gap:2px">
                            <button class="te-close-btn" (click)="s.commit()" title="Close Text Editor (Save)">
                              <span class="te-close-check">&#10004;</span>
                            </button>
                            <button class="te-close-btn cancel" (click)="s.cancel()" title="Cancel (Esc)">
                              <span class="te-cancel-cross">&#10006;</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    }
    `,
  styles: [`
    :host { display: contents; }
    .text-ribbon {
      display: flex;
      align-items: stretch;
      padding: 0 6px;
      background: var(--cad-bg-panel, #252a31);
      border-bottom: 1px solid var(--cad-border, #3b4049);
      height: var(--cad-toolbar-h, 68px);
      box-sizing: border-box;
      user-select: none;
      flex-wrap: nowrap;
      overflow: visible;
      font-family: var(--cad-font-ui, 'Inter', system-ui, sans-serif);
    }
    .te-panel {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      padding: 6px 6px 2px 6px;
      min-width: 0;
      position: relative;
    }
    .te-panel-body {
      flex: 1;
      display: flex;
    }
    .te-panel-col {
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 4px;
    }
    .te-panel-row {
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .te-panel-row-wrap {
      flex-direction: row;
      align-items: center;
      gap: 3px;
    }
    .te-panel-label {
      display: none;
      font-size: 9.5px;
      color: var(--cad-text-secondary, #8b929c);
      text-align: center;
      padding: 2px 0 1px;
      font-weight: 500;
      letter-spacing: 0.3px;
      border-top: 1px solid var(--cad-border, #3b4049);
      margin-top: 3px;
    }
    .te-sep {
      width: 1px;
      align-self: stretch;
      background: var(--cad-border, #3b4049);
      margin: 6px 3px;
      opacity: 0.7;
    }
    .te-sep-v {
      width: 1px;
      height: 18px;
      background: var(--cad-border, #3b4049);
      opacity: 0.7;
    }
    .te-btn-row {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .te-row { display: flex; align-items: center; }
    .gap4 { gap: 6px; }
    .te-field-group {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .te-field-label {
      font-size: 9px;
      color: var(--cad-text-secondary, #8b929c);
      line-height: 1;
    }
    .te-field-label-m {
      font-size: 9px;
      color: var(--cad-text-secondary, #8b929c);
      margin-bottom: 2px;
      display: block;
    }
    .te-select, .te-select-sm {
      background: var(--cad-bg-base, #1f2428);
      border: 1px solid var(--cad-border, #3b4049);
      color: var(--cad-text-primary, #d4d8de);
      padding: 3px 5px;
      border-radius: 3px;
      font-size: 12px;
      outline: none;
    }
    .te-select { width: 150px; }
    .te-select-sm { width: 72px; font-size: 11px; }
    .te-input-num, .te-input-sm {
      background: var(--cad-bg-base, #1f2428);
      border: 1px solid var(--cad-border, #3b4049);
      color: var(--cad-text-primary, #d4d8de);
      padding: 3px 5px;
      border-radius: 3px;
      font-size: 11px;
      outline: none;
    }
    .te-input-num { width: 56px; }
    .te-input-sm { width: 100%; }
    .te-select:focus,.te-select-sm:focus,.te-input-num:focus,.te-input-sm:focus {
      border-color: var(--cad-accent, #499bea);
    }
    .te-btn:not(.active) {
      color: var(--cad-icon-color, #ffffff);
    }
    .te-btn {
      background: transparent;
      border: 1px solid transparent;
      padding: 3px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 24px;
      transition: background 0.1s, border-color 0.1s;
    }
    .te-btn:hover {
      background: var(--cad-bg-hover, rgba(255,255,255,0.06));
      border-color: var(--cad-border, #3b4049);
    }
    .te-btn.active {
      background: rgba(73,155,234,0.18);
      border-color: rgba(73,155,234,0.5);
      color: var(--cad-accent, #499bea);
    }
    .te-btn-tall:not(.active) {
      color: var(--cad-icon-color, #ffffff);
    }
    .te-btn-tall {
      background: transparent;
      border: 1px solid transparent;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-width: 44px;
      height: 100%;
      max-height: 62px;
      transition: background 0.1s, border-color 0.1s;
    }
    .te-btn-tall:hover {
      background: var(--cad-bg-hover, rgba(255,255,255,0.06));
      border-color: var(--cad-border, #3b4049);
    }
    .te-icon-xl { font-size: 20px; line-height: 1; }
    .te-btn-sub { font-size: 9.5px; color: var(--cad-text-secondary, #8b929c); line-height: 1; }
    .te-checkbox-label {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--cad-text-primary, #d4d8de);
      cursor: pointer;
    }
    .te-checkbox-label input[type=checkbox] {
      accent-color: var(--cad-accent, #499bea);
      cursor: pointer;
    }
    .te-dropdown { position: relative; display: inline-flex; }
    .te-dropdown-menu {
      position: absolute;
      top: 100%;
      left: 0;
      background: var(--cad-bg-panel-solid, #2a2f38);
      border: 1px solid var(--cad-border, #3b4049);
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      border-radius: 5px;
      padding: 6px;
      z-index: 2000;
      min-width: 160px;
    }
    .te-menu-label {
      font-size: 9.5px;
      font-weight: 600;
      color: var(--cad-text-secondary, #8b929c);
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 4px;
      padding: 0 2px;
    }
    .te-span-all { grid-column: 1 / -1; margin-top: 4px; }
    .te-menu-item {
      display: block;
      width: 100%;
      text-align: left;
      background: transparent;
      border: none;
      color: var(--cad-text-primary, #d4d8de);
      padding: 5px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    .te-menu-item:hover { background: var(--cad-bg-hover, rgba(255,255,255,0.06)); }
    .te-menu-check {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--cad-text-primary, #d4d8de);
      padding: 4px 4px;
      cursor: pointer;
    }
    .te-menu-check input { accent-color: var(--cad-accent, #499bea); }
    .te-menu-item-group {
      padding: 6px 4px 2px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .te-sym-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 2px;
      min-width: 210px;
    }
    .te-sym-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--cad-text-primary, #d4d8de);
      padding: 5px 2px;
      cursor: pointer;
      border-radius: 3px;
      font-size: 15px;
      text-align: center;
      transition: background 0.1s;
    }
    .te-sym-btn:hover {
      background: var(--cad-bg-hover, rgba(255,255,255,0.08));
      border-color: var(--cad-border, #3b4049);
    }
    .te-mask-menu { min-width: 190px; }
    .te-find-menu { min-width: 230px; }
    .te-find-input {
      display: block;
      width: 100%;
      background: var(--cad-bg-base, #1f2428);
      border: 1px solid var(--cad-border, #3b4049);
      color: var(--cad-text-primary, #d4d8de);
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 12px;
      outline: none;
      margin-bottom: 4px;
    }
    .te-find-input:focus { border-color: var(--cad-accent, #499bea); }
    .te-find-actions { display: flex; gap: 4px; margin-top: 2px; }
    .te-find-btn {
      flex: 1;
      background: var(--cad-bg-base, #1f2428);
      border: 1px solid var(--cad-border, #3b4049);
      color: var(--cad-text-primary, #d4d8de);
      padding: 4px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .te-find-btn:hover { background: var(--cad-bg-hover, rgba(255,255,255,0.06)); }
    .te-find-btn-all { color: var(--cad-accent, #499bea); }
    .te-close-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--cad-text-primary, #d4d8de);
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 6px;
      height: 100%;
      max-height: 62px;
      transition: background 0.15s, border-color 0.15s;
    }
    .te-close-btn:hover {
      background: rgba(16,185,129,0.12);
      border-color: rgba(16,185,129,0.35);
    }
    .te-close-btn.cancel:hover {
      background: rgba(239,68,68,0.12);
      border-color: rgba(239,68,68,0.35);
    }
    .te-close-check { font-size: 22px; color: #10b981; line-height: 1; }
    .te-cancel-cross { font-size: 22px; color: #ef4444; line-height: 1; }
    ::ng-deep .te-panel app-color-picker .cp-wrapper { margin: 0; }
    
    /* Responsive Text Ribbon: Hide labels on small screens */
    @media (max-width: 1550px) {
      .te-label-hide-small { display: none !important; }
      ::ng-deep .te-panel app-color-picker .cp-label { display: none; }
      
      .te-btn-tall .te-btn-sub { display: none; }
      .te-btn-tall { padding: 4px; min-width: 28px; }
    }
  `]
})
export class TextEditorRibbonComponent {
  svc = inject(TextEditorService);
  tableSvc = inject(TableEditorService);
  readonly PI = Math.PI;
  symbolMenuOpen = false;
  bulletsOpen = false;
  maskMenuOpen = false;
  findMenuOpen = false;
  findText = '';
  replaceText = '';
  fonts = [
    'Arial', 'Helvetica', 'Times New Roman', 'Courier New',
    'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'monospace'
  ];
  engineeringSymbols = [
    { char: '°', name: 'Degree' },
    { char: '±', name: 'Plus/Minus' },
    { char: 'Ø', name: 'Diameter' },
    { char: '△', name: 'Delta' },
    { char: '⌀', name: 'Diameter Sign' },
    { char: '⊕', name: 'Centerline' },
    { char: '\u00A0', name: 'Non-breaking Space' },
    { char: '‰', name: 'Per Mille' },
    { char: '#', name: 'Number sign' },
  ];
  greekSymbols = [
    { char: 'Ω', name: 'Omega' }, { char: 'μ', name: 'Mu' },
    { char: 'Δ', name: 'Delta' }, { char: 'α', name: 'Alpha' },
    { char: 'β', name: 'Beta' }, { char: 'π', name: 'Pi' },
    { char: 'σ', name: 'Sigma' }, { char: 'θ', name: 'Theta' },
    { char: 'λ', name: 'Lambda' }, { char: 'φ', name: 'Phi' },
    { char: 'ρ', name: 'Rho' }, { char: 'ε', name: 'Epsilon' },
  ];
  mathSymbols = [
    { char: '²', name: 'Squared' }, { char: '³', name: 'Cubed' },
    { char: '≤', name: 'Less/Equal' }, { char: '≥', name: 'Greater/Equal' },
    { char: '≈', name: 'Approx' }, { char: '≠', name: 'Not Equal' },
    { char: '√', name: 'Sqrt' }, { char: '∞', name: 'Infinity' },
    { char: '∑', name: 'Sum' }, { char: '∫', name: 'Integral' },
    { char: '∏', name: 'Product' }, { char: '∇', name: 'Nabla' },
  ];
  insertSymbol(sym: string): void {
    if (this.tableSvc.state()) this.tableSvc.insertSymbolRequested.next(sym);
    else this.svc.insertSymbolRequested.next(sym);
  }

  cycleCase(f: any): void {
    const t: string = f.text || '';
    if (!t) return;
    const isUpper = t === t.toUpperCase();
    f.setText(isUpper ? t.toLowerCase() : t.toUpperCase());
  }

  doFindReplace(f: any, replaceAll: boolean): void {
    if (!this.findText) return;
    const t: string = f.text || '';
    const updated = replaceAll
      ? t.split(this.findText).join(this.replaceText)
      : t.replace(this.findText, this.replaceText);
    f.setText(updated);
  }

  obliqueToDisplay(ent: any): number {
    if (!ent) return 0;
    const rad = ent.obliqueAngle ?? 0;
    return Math.round(rad * 180 / this.PI);
  }

  rotToDisplay(ent: any): number {
    if (!ent) return 0;
    const rad = ent.rotation ?? 0;
    return Math.round(rad * 180 / this.PI);
  }

  get f() {
    const isTable = !!this.tableSvc.state();
    const ent = isTable ? this.tableSvc.state()?.entity : this.svc.state()?.entity;
    if (!ent) return null;

    const cellText = isTable && this.tableSvc.state()?.editingCell
      ? (this.tableSvc.state()?.editingCell![0] === 0 && ent.titleRow
          ? ent.titleText : ent.cells[this.tableSvc.state()?.editingCell![0]][this.tableSvc.state()?.editingCell![1]]?.text)
      : ent.text;

    const t = this.tableSvc;
    const x = this.svc;

    return {
      isTable,
      isLeader: !isTable && x.isLeader(ent),
      
      text: isTable ? cellText : ent.text,
      setText: (v: string) => {
        if (isTable) {
          const cell = t.state()?.editingCell;
          if (cell) t.setCellText(cell[0], cell[1], v);
        } else {
          x.updateProp(ent, 'text', v);
        }
      },

      font: isTable ? t.getActiveFont() : ent.font,
      setFont: (v: string) => isTable ? t.setFont(v) : x.updateProp(ent, 'font', v),
      
      height: isTable ? t.getActiveFontSize() : ent.height,
      setHeight: (v: number) => isTable ? t.setFontSize(v) : x.updateProp(ent, 'height', v),
      
      widthFactor: (ent as any).widthFactor ?? 1,
      setWidthFactor: (v: number) => !isTable && x.updateProp(ent, 'widthFactor', v),
      
      obliqueAngle: this.obliqueToDisplay(ent),
      setObliqueAngle: (v: number) => !isTable && x.updateProp(ent, 'obliqueAngle', v * this.PI / 180),
      
      rotation: this.rotToDisplay(ent),
      setRotation: (v: number) => !isTable && x.updateProp(ent, 'rotation', v * this.PI / 180),
      
      annotative: (ent as any).annotative,
      setAnnotative: (v: boolean) => !isTable && x.updateProp(ent, 'annotative', v),
      
      charSpacing: (ent as any).charSpacing ?? 0,
      setCharSpacing: (v: number) => !isTable && x.updateProp(ent, 'charSpacing', v),
      
      lineSpacing: (ent as any).lineSpacing ?? 1.2,
      setLineSpacing: (v: number) => !isTable && x.updateProp(ent, 'lineSpacing', v),
      
      bold: isTable ? t.getActiveBool('bold') : ent.bold,
      setBold: (v: boolean) => isTable ? t.toggleBool('bold') : x.updateProp(ent, 'bold', v),
      
      italic: isTable ? t.getActiveBool('italic') : ent.italic,
      setItalic: (v: boolean) => isTable ? t.toggleBool('italic') : x.updateProp(ent, 'italic', v),
      
      underline: isTable ? t.getActiveBool('underline') : ent.underline,
      setUnderline: (v: boolean) => isTable ? t.toggleBool('underline') : x.updateProp(ent, 'underline', v),
      
      overline: isTable ? t.getActiveBool('overline') : ent.overline,
      setOverline: (v: boolean) => isTable ? t.toggleBool('overline') : x.updateProp(ent, 'overline', v),
      
      strikethrough: isTable ? t.getActiveBool('strikethrough') : ent.strikethrough,
      setStrikethrough: (v: boolean) => isTable ? t.toggleBool('strikethrough') : x.updateProp(ent, 'strikethrough', v),
      
      horiz: isTable ? t.getActiveAlign() : x.getHoriz(ent),
      setHoriz: (v: string) => isTable ? t.setAlign(v) : x.setHoriz(ent, v),
      
      vert: isTable ? t.getActiveValign() : x.getVert(ent),
      setVert: (v: string) => isTable ? t.setValign(v) : x.setVert(ent, v),
      
      textColor: isTable ? t.getActiveTextColor() : x.getTextColor(ent),
      setTextColor: (v: string) => isTable ? t.setTextColor(v) : x.setTextColor(ent, v),
      
      backgroundMask: (ent as any).backgroundMask,
      setBackgroundMask: (v: boolean) => !isTable && x.updateProp(ent, 'backgroundMask', v),
      
      maskOffset: (ent as any).maskOffset ?? 1.5,
      setMaskOffset: (v: number) => !isTable && x.updateProp(ent, 'maskOffset', v),
      
      backgroundColor: isTable ? t.getActiveBgColor() : ((ent as any).backgroundColor || '#1a202c'),
      setBackgroundColor: (v: string) => isTable ? t.setBgColor(v) : x.updateProp(ent, 'backgroundColor', v),
      
      toggleListType: (v: string) => x.toggleListTypeRequested.next(v),
      
      commit: () => isTable ? t.commit() : x.commit(),
      cancel: () => isTable ? t.cancel() : x.cancel(),
      
      insertRow: () => t.insertRow(),
      insertCol: () => t.insertCol(),
      deleteRow: () => t.deleteRow(),
      deleteCol: () => t.deleteCol()
    };
  }
}
