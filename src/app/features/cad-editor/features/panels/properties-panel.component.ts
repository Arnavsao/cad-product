import { Component, computed, inject, signal, output , ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { Entity, IPropertySchema } from '../../core/models/entity.model';
import { DXF_ACI_COLORS } from '../../core/registries/aci-colors';
import { getSelectedEntities } from '../../tools/select/select-tool';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ModifyPropertiesCmd } from '../../core/models/command.model';
import { HATCH_PATTERNS } from '../../core/registries/hatch-patterns';
import { ColorPickerComponent } from '../shared/color-picker/color-picker.component';

interface GroupedSchema {
  category: string;
  rows: IPropertySchema[];
}

/**
 * Engineering symbol palette inserted at caret position in text inputs.
 */
const ENG_SYMBOLS: ReadonlyArray<string> = [
  '°', 'Ø', '±', '≈', '≠', '≤', '≥',
  '²', '³', '½', '¼', '¾',
  'α', 'β', 'γ', 'θ', 'π', 'Σ', 'Î”', 'μ', 'Ω',
  '→', 'â†', '↑', '↓',
  'â„„', 'Ã—', 'Ã·',
];

/** Standard DXF lineweight values in hundredths of mm. */
const LINEWEIGHT_OPTIONS: { value: number; label: string }[] = [
  { value: -1, label: 'ByLayer' },
  { value: -2, label: 'ByBlock' },
  { value: -3, label: 'Default' },
  { value: 0, label: '0.00 mm' },
  { value: 5, label: '0.05 mm' },
  { value: 9, label: '0.09 mm' },
  { value: 13, label: '0.13 mm' },
  { value: 15, label: '0.15 mm' },
  { value: 18, label: '0.18 mm' },
  { value: 20, label: '0.20 mm' },
  { value: 25, label: '0.25 mm' },
  { value: 30, label: '0.30 mm' },
  { value: 35, label: '0.35 mm' },
  { value: 40, label: '0.40 mm' },
  { value: 50, label: '0.50 mm' },
  { value: 53, label: '0.53 mm' },
  { value: 60, label: '0.60 mm' },
  { value: 70, label: '0.70 mm' },
  { value: 80, label: '0.80 mm' },
  { value: 90, label: '0.90 mm' },
  { value: 100, label: '1.00 mm' },
  { value: 106, label: '1.06 mm' },
  { value: 120, label: '1.20 mm' },
  { value: 140, label: '1.40 mm' },
  { value: 158, label: '1.58 mm' },
  { value: 200, label: '2.00 mm' },
  { value: 211, label: '2.11 mm' },
];

const LINETYPE_OPTIONS = [
  'BYLAYER', 'BYBLOCK', 'CONTINUOUS', 'DASHED', 'DOTTED',
  'DASHDOT', 'HIDDEN', 'CENTER', 'PHANTOM', 'DIVIDE',
];

const ENTITY_ICONS: Record<string, string> = {
  LINE: '╱',
  ARC: '⌒',
  CIRCLE: 'â—‹',
  POLYLINE: '⌇',
  TEXT: 'T',
  MTEXT: 'T',
  DIMENSION: '↔',
  HATCH: '▦',
  SPLINE: '∿',
  POINT: '·',
  INSERT: '⬢',
  ELLIPSE: '⬭',
  SOLID: '■',
  LEADER: '↗',
};

const ENTITY_NAMES: Record<string, string> = {
  LINE: 'Line',
  ARC: 'Arc',
  CIRCLE: 'Circle',
  POLYLINE: 'Polyline',
  TEXT: 'Text',
  MTEXT: 'Multiline Text',
  DIMENSION: 'Dimension',
  HATCH: 'Hatch',
  SPLINE: 'Spline',
  POINT: 'Point',
  INSERT: 'Block Reference',
  ELLIPSE: 'Ellipse',
  SOLID: 'Solid',
  LEADER: 'Leader',
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-properties-panel',
  standalone: true,
  imports: [FormsModule, ColorPickerComponent],
  template: `
    <div class="props-panel">
    
      <!-- â”€â”€ Entity header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
      @if (selectedEntities().length > 0) {
        <div class="entity-header">
          <div class="entity-icon-wrap">
            <span class="entity-icon">{{ entityIcon() }}</span>
          </div>
          <div class="entity-meta">
            @if (selectionFilterOptions().length > 1) {
              <select
                class="entity-filter-select"
                [value]="activeFilterType() ?? 'All'"
                (change)="onFilterChange($event)"
              >
                @for (opt of selectionFilterOptions(); track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            } @else {
              <div class="entity-type-name">{{ entityTypeName() }}</div>
            }
          </div>
          <button
            type="button"
            class="sym-toggle"
            [class.active]="paletteOpen()"
            [disabled]="!lastFocusedTextInput"
            title="Insert engineering symbol"
            (click)="togglePalette()"
          >Ω</button>
          <button
            type="button"
            class="drawer-close-btn"
            title="Close panel"
            (click)="closeDrawer.emit()"
          >✕</button>
        </div>
      } @else {
        <div class="entity-header empty-header">
          <div class="entity-icon-wrap muted">
            <span class="entity-icon">◈</span>
          </div>
          <div class="entity-meta">
            <div class="entity-type-name muted">No Selection</div>
          </div>
          <button
            type="button"
            class="drawer-close-btn"
            title="Close panel"
            (click)="closeDrawer.emit()"
          >✕</button>
        </div>
      }
    
    
      <!-- â”€â”€ Symbol palette â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
      @if (paletteOpen()) {
        <div class="symbol-palette">
          @for (sym of symbols; track sym) {
            <button
              type="button"
              class="symbol-btn"
              [disabled]="!lastFocusedTextInput"
              (mousedown)="onSymbolMouseDown($event, sym)"
            >{{ sym }}</button>
          }
        </div>
      }
    
      <!-- â”€â”€ Property groups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
      @if (selectedEntities().length > 0) {
        <div class="panel-body">
          @for (group of groups(); track group) {
            <div class="prop-group">
              <!-- Group header â€” click to collapse -->
              <div class="group-hdr" (click)="toggleGroup(group.category)">
                <span class="chevron">{{ isCollapsed(group.category) ? 'â–¶' : 'â–¼' }}</span>
                <span class="group-label">{{ group.category }}</span>
              </div>
              <!-- Group rows -->
              <div class="group-rows" [class.hidden]="isCollapsed(group.category)">
                @for (row of group.rows; track row) {
                  <div
                    class="prop-row"
                    [class.ro-row]="row.readOnly"
                    [class.full-row]="row.type === 'action-button'"
                    [class.clickable-row]="row.type === 'boolean' && !row.readOnly"
                    (click)="row.type === 'boolean' && !row.readOnly && toggleBoolDirect(row, !getValue(row))"
                    >
                    <!-- Label (hidden for action-button which spans full row) -->
                    @if (row.type !== 'action-button') {
                      <span
                        class="prop-label"
                        [title]="row.label"
                      >{{ row.label }}</span>
                    }
                    <!-- â”€â”€ Value controls â”€â”€â”€ -->
                    @switch (row.type) {
                      <!-- COLOR -->
                      @case ('color') {
                        <div class="color-cell">
                          <app-color-picker
                            [value]="hexForPicker(row)"
                            [mixed]="isMixedColor(row)"
                            [label]="colorLabel(row)"
                            (valueChange)="onColorCommitted(row, $event)">
                          </app-color-picker>
                          @if (row.key === 'colorNumber') {
                            <button
                              type="button"
                              class="bylayer-btn"
                              (click)="setColorByLayer(row)"
                              title="Reset to ByLayer"
                            >BL</button>
                          }
                        </div>
                      }
                      <!-- LAYER -->
                      @case ('layer') {
                        <select
                          [value]="getValue(row)"
                          [disabled]="!!row.readOnly"
                          (change)="setValue(row, $event)"
                          class="prop-select">
                          @for (l of layerNames(); track l) {
                            <option [value]="l">{{ l }}</option>
                          }
                        </select>
                      }
                      <!-- LINETYPE -->
                      @case ('linetype') {
                        <select
                          [value]="getValue(row)"
                          [disabled]="!!row.readOnly"
                          (change)="setValue(row, $event)"
                          class="prop-select">
                          @for (lt of linetypeOptions; track lt) {
                            <option [value]="lt">{{ formatLinetype(lt) }}</option>
                          }
                        </select>
                      }
                      <!-- LINEWEIGHT -->
                      @case ('lineweight') {
                        <select
                          [value]="getValue(row)"
                          [disabled]="!!row.readOnly"
                          (change)="setValue(row, $event)"
                          class="prop-select">
                          @for (lw of lineweightOptions; track lw) {
                            <option [value]="lw.value">{{ lw.label }}</option>
                          }
                        </select>
                      }
                      <!-- NUMBER -->
                      @case ('number') {
                        <div class="num-cell">
                          <input
                            type="number"
                            [step]="row.step ?? 1"
                            [value]="formatNumber(getValue(row))"
                            [disabled]="!!row.readOnly"
                            (change)="setValue(row, $event)"
                            class="prop-input num-input"
                            >
                            @if (row.suffix) {
                              <span class="num-suffix">{{ row.suffix }}</span>
                            }
                          </div>
                        }
                        <!-- BOOLEAN (checkbox) -->
                        @case ('boolean') {
                          <div class="checkbox-container">
                            <input
                              type="checkbox"
                              [checked]="!!getValue(row)"
                              [disabled]="!!row.readOnly"
                              (change)="setBool(row, $event)"
                              class="prop-checkbox"
                              >
                            </div>
                          }
                          <!-- TEXT-ROTATION -->
                          @case ('text-rotation') {
                            <div class="text-rotation-cell">
                              <select
                                [value]="getRotationSelectValue(row)"
                                [disabled]="!!row.readOnly"
                                (change)="onRotationSelectChange(row, $event)"
                                class="prop-select"
                                >
                                <option value="0">0°</option>
                                <option value="45">45°</option>
                                <option value="90">90°</option>
                                <option value="180">180°</option>
                                <option value="270">270°</option>
                                <option value="custom">Custom...</option>
                              </select>
                              @if (isRotationCustom(row)) {
                                <div class="num-cell">
                                  <input
                                    type="number"
                                    step="1"
                                    [value]="formatNumber(getValue(row))"
                                    [disabled]="!!row.readOnly"
                                    (change)="setValue(row, $event)"
                                    class="prop-input num-input"
                                    >
                                    @if (row.suffix) {
                                      <span class="num-suffix">{{ row.suffix }}</span>
                                    }
                                  </div>
                                }
                              </div>
                            }
                            <!-- DROPDOWN -->
                            @case ('dropdown') {
                              <select
                                [value]="getValue(row)"
                                [disabled]="!!row.readOnly"
                                (change)="setValue(row, $event)"
                                class="prop-select">
                                @for (opt of optionsFor(row); track opt) {
                                  <option [value]="opt">{{ opt }}</option>
                                }
                              </select>
                            }
                            <!-- READ-ONLY -->
                            @case ('read-only') {
                              <span class="ro-value">
                                {{ formatDisplay(getValue(row)) }}{{ row.suffix ?? '' }}
                              </span>
                            }
                            <!-- ACTION BUTTON -->
                            @case ('action-button') {
                              <button
                                type="button"
                                class="action-btn"
                                [disabled]="!!row.readOnly"
                                (click)="runAction(row)"
                              >{{ row.label }}</button>
                            }
                            <!-- TEXT (default) -->
                            @default {
                              <input
                                type="text"
                                [value]="getValue(row)"
                                [disabled]="!!row.readOnly"
                                (focus)="onTextFocus($event)"
                                (change)="setValue(row, $event)"
                                class="prop-input text-input"
                                >
                            }
                          }
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            } @else {
              <div class="empty-state">
                <div class="empty-hex">
                  <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-hex-icon">
                    <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                    <polyline points="2 17 12 22 22 17"></polyline>
                    <polyline points="2 12 12 17 22 12"></polyline>
                  </svg>
                </div>
                <p class="empty-hint">Select an entity<br>to view its properties</p>
              </div>
            }
    
            <!-- â”€â”€ Empty state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
    
          </div>
    `,
  styles: [`
    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Root container
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .props-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--cad-bg-panel-solid);
      color: var(--cad-text-primary);
      font-size: 12px;
      font-family: 'Inter', 'Segoe UI', sans-serif;
      overflow: hidden;
    }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Entity header
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .entity-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 9px;
      background: var(--cad-bg-panel);
      border-bottom: 1px solid var(--cad-border);
      flex-shrink: 0;
    }
    .entity-header.empty-header { opacity: 0.55; }

    .entity-icon-wrap {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: var(--cad-accent-tint);
      border: 1px solid var(--cad-border-bright);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .entity-icon-wrap.muted {
      background: var(--cad-bg-panel-solid);
      border-color: var(--cad-border);
    }
    .entity-icon {
      font-size: 15px;
      color: var(--cad-accent);
      line-height: 1;
    }
    .entity-icon-wrap.muted .entity-icon { color: var(--cad-text-dim); }

    .entity-meta { flex: 1; min-width: 0; }
    .entity-type-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--cad-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .entity-type-name.muted { color: var(--cad-text-dim); }
    .entity-count {
      font-size: 10px;
      color: var(--cad-accent);
      margin-top: 1px;
    }

    .entity-filter-select {
      width: 100%;
      background: transparent;
      color: var(--cad-text-primary);
      border: 1px solid var(--cad-border);
      border-radius: 4px;
      padding: 4px 24px 4px 8px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      outline: none;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='currentColor' opacity='0.5'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 8px center;
      transition: border-color 0.1s;
    }
    .entity-filter-select:hover,
    .entity-filter-select:focus {
      border-color: var(--cad-accent);
    }
    .entity-filter-select option {
      background: var(--cad-bg-panel-solid);
      color: var(--cad-text-primary);
      font-weight: normal;
    }

    /* Symbol palette toggle */
    .sym-toggle {
      width: 26px;
      height: 26px;
      flex-shrink: 0;
      background: var(--cad-bg-panel-solid);
      color: var(--cad-yellow);
      border: 1px solid var(--cad-border);
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0;
      transition: background 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sym-toggle:hover:not(:disabled) { background: var(--cad-bg-hover); border-color: var(--cad-text-dim); }
    .sym-toggle.active { background: var(--cad-accent-tint); color: var(--cad-yellow); border-color: var(--cad-yellow); }
    .sym-toggle:disabled { opacity: 0.3; cursor: not-allowed; }

    /* Close drawer button */
    .drawer-close-btn {
      width: 26px;
      height: 26px;
      flex-shrink: 0;
      background: transparent;
      color: var(--cad-text-secondary);
      border: 1px solid transparent;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .drawer-close-btn:hover {
      background: var(--cad-red);
      color: var(--cad-text-on-accent);
      border-color: var(--cad-red);
    }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Symbol palette
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .symbol-palette {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
      padding: 6px 10px;
      background: var(--cad-bg-panel);
      border-bottom: 1px solid var(--cad-border);
      flex-shrink: 0;
    }
    .symbol-btn {
      background: var(--cad-bg-panel-solid);
      color: var(--cad-text-primary);
      border: 1px solid var(--cad-border);
      height: 26px;
      padding: 0;
      cursor: pointer;
      font-size: 13px;
      font-family: 'Segoe UI Symbol', 'Apple Symbols', sans-serif;
      border-radius: 3px;
      transition: background 0.08s, color 0.08s;
    }
    .symbol-btn:hover:not(:disabled) { background: var(--cad-bg-hover); color: var(--cad-yellow); }
    .symbol-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Scrollable body
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .panel-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 12px;
    }
    .panel-body::-webkit-scrollbar { width: 4px; }
    .panel-body::-webkit-scrollbar-track { background: transparent; }
    .panel-body::-webkit-scrollbar-thumb { background: var(--cad-border); border-radius: 2px; }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Property groups
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .prop-group { border-bottom: 1px solid var(--cad-border); }

    .group-hdr {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px 5px;
      background: var(--cad-bg-panel);
      cursor: pointer;
      user-select: none;
      transition: background 0.1s;
    }
    .group-hdr:hover { background: var(--cad-bg-hover); }
    .chevron { font-size: 8px; color: var(--cad-text-dim); flex-shrink: 0; }
    .group-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: var(--cad-text-secondary);
    }

    .group-rows { }
    .group-rows.hidden { display: none; }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Individual property row
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .prop-row {
      display: grid;
      grid-template-columns: 104px 1fr;
      align-items: center;
      min-height: 28px;
      padding: 0 0 0 0;
      border-bottom: 1px solid var(--cad-bg-panel);
      transition: background 0.08s;
    }
    .prop-row:hover { background: var(--cad-bg-hover); }
    .prop-row.ro-row { opacity: 0.75; }
    .prop-row.full-row { grid-template-columns: 1fr; }

    .prop-row.clickable-row { cursor: pointer; }
    
    .prop-label {
      padding: 4px 10px 4px 14px;
      color: var(--cad-text-secondary);
      font-size: 11.5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      user-select: none;
    }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Base input / select
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .prop-input,
    .prop-select {
      width: 100%;
      background: transparent;
      color: var(--cad-text-primary);
      border: none;
      border-left: 1px solid var(--cad-border);
      padding: 4px 8px;
      font-size: 12px;
      font-family: inherit;
      min-width: 0;
      outline: none;
      height: 100%;
      transition: background 0.1s, border-color 0.1s;
      box-sizing: border-box;
    }
    .prop-input:focus,
    .prop-select:focus {
      background: var(--cad-bg-input);
      border-left-color: var(--cad-accent);
      color: var(--cad-text-primary);
    }
    .prop-input:disabled,
    .prop-select:disabled { opacity: 0.45; cursor: not-allowed; }

    .prop-select {
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='currentColor' opacity='0.5'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 8px center;
      padding-right: 24px;
      cursor: pointer;
    }
    .prop-select option {
      background: var(--cad-bg-panel-solid);
      color: var(--cad-text-primary);
    }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Number input with suffix
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .num-cell {
      display: flex;
      align-items: center;
      border-left: 1px solid var(--cad-border);
      min-width: 0;
      height: 100%;
    }
    .num-cell:focus-within { border-left-color: var(--cad-accent); background: var(--cad-bg-input); }
    .num-input {
      flex: 1;
      border: none;
      border-left: none !important;
      padding-right: 2px;
      text-align: right;
      -moz-appearance: textfield;
    }
    .num-input::-webkit-inner-spin-button,
    .num-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .num-suffix {
      padding: 0 8px 0 2px;
      color: var(--cad-text-dim);
      font-size: 11px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Text Rotation Custom Cell
       â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .text-rotation-cell {
      display: flex;
      align-items: center;
      height: 100%;
    }
    .text-rotation-cell select.prop-select {
      flex: 1;
      height: 100%;
    }
    .text-rotation-cell .num-cell {
      width: 90px;
      height: 100%;
      flex-shrink: 0;
    }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Color picker cell
       â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .color-cell {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px 4px 8px;
      border-left: 1px solid var(--cad-border);
      min-width: 0;
    }
    .swatch-wrap {
      position: relative;
      width: 22px;
      height: 18px;
      border-radius: 3px;
      border: 1px solid var(--cad-border);
      flex-shrink: 0;
      overflow: hidden;
      cursor: pointer;
    }
    .swatch {
      width: 100%;
      height: 100%;
    }
    .color-overlay {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      width: 100%;
      height: 100%;
      padding: 0;
      border: none;
    }
    .color-chip-label {
      flex: 1;
      font-size: 11.5px;
      color: var(--cad-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .bylayer-btn {
      flex-shrink: 0;
      background: var(--cad-bg-panel);
      color: var(--cad-text-secondary);
      border: 1px solid var(--cad-border);
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 5px;
      cursor: pointer;
      letter-spacing: 0.3px;
      transition: background 0.1s, color 0.1s;
    }
    .bylayer-btn:hover { background: var(--cad-bg-hover); color: var(--cad-accent); border-color: var(--cad-accent); }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Checkbox (boolean)
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .checkbox-container {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 4px 8px;
      border-left: 1px solid var(--cad-border);
      height: 100%;
    }
    .prop-checkbox {
      margin: 0;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      background-color: transparent;
      border: 1px solid var(--cad-border, #4a5568);
      border-radius: 2px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      background-position: center;
      background-repeat: no-repeat;
    }
    .prop-checkbox:checked {
      background-color: var(--cad-accent-tint);
      border-color: var(--cad-accent);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%2363b3ed'%3E%3Cpath d='M6 10.2L3.8 8l-.7.7L6 11.6 13 4.6l-.7-.7z'/%3E%3C/svg%3E");
    }
    .prop-checkbox:hover:not(:disabled) {
      border-color: var(--cad-accent);
      background-color: var(--cad-bg-hover);
    }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Read-only value
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .ro-value {
      display: block;
      padding: 4px 8px;
      color: var(--cad-text-secondary);
      font-variant-caps: all-small-caps;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Action button (full row)
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .action-btn {
      width: calc(100% - 20px);
      margin: 4px 10px;
      background: var(--cad-accent-tint);
      color: var(--cad-accent);
      border: 1px solid var(--cad-accent);
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 11.5px;
      font-family: inherit;
      cursor: pointer;
      text-align: center;
      letter-spacing: 0.3px;
      transition: background 0.12s, border-color 0.12s;
    }
    .action-btn:hover { background: var(--cad-accent); color: var(--cad-text-on-accent); border-color: var(--cad-accent); }
    .action-btn:disabled { opacity: 0.4; cursor: default; }

    /* â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
       Empty state
    â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â•  */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      gap: 10px;
    }
    .empty-hex {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 8px;
    }
    .empty-hex-icon {
      width: 40px;
      height: 40px;
      color: var(--cad-text-dim);
      opacity: 0.4;
    }
    .empty-hint {
      margin: 0;
      color: var(--cad-text-dim);
      font-size: 11px;
      text-align: center;
      line-height: 1.6;
    }
  `],
})
export class PropertiesPanelComponent {
  readonly closeDrawer = output<void>();

  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private cmds = inject(CommandStackService);

  readonly hatchPatternNames = Object.keys(HATCH_PATTERNS);
  readonly lineweightOptions = LINEWEIGHT_OPTIONS;
  readonly linetypeOptions = LINETYPE_OPTIONS;

  /* â”€â”€ Computed selections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  readonly activeFilterType = signal<string | null>(null);

  selectedEntities = computed(() => {
    this.vm.version();
    return getSelectedEntities(this.doc);
  });

  selectionFilterOptions = computed(() => {
    const sel = this.selectedEntities();
    if (sel.length === 0) return [];
    
    const counts = new Map<string, number>();
    for (const e of sel) {
      counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    }
    
    if (sel.length === 1) {
      const type = sel[0].type;
      const name = ENTITY_NAMES[type] ?? type;
      return [{ value: type, label: name }];
    }
    
    const options = [{ value: 'All', label: `All (${sel.length})` }];
    for (const [type, count] of counts.entries()) {
      const name = ENTITY_NAMES[type] ?? type;
      options.push({ value: type, label: `${name} (${count})` });
    }
    return options;
  });

  filteredEntities = computed(() => {
    const sel = this.selectedEntities();
    const filter = this.activeFilterType();
    if (!filter || filter === 'All') return sel;
    const filtered = sel.filter(e => e.type === filter);
    return filtered.length > 0 ? filtered : sel;
  });

  onFilterChange(ev: Event): void {
    const target = ev.target as HTMLSelectElement;
    this.activeFilterType.set(target.value);
  }

  groups = computed<GroupedSchema[]>(() => {
    const sel = this.filteredEntities();
    if (!sel.length) return [];
    
    // Start with the schema of the first entity
    let schema = sel[0].getPropertiesSchema();
    
    // If multiple entities are selected, find the intersection of their schemas
    for (let i = 1; i < sel.length; i++) {
      const nextSchema = sel[i].getPropertiesSchema();
      const nextKeys = new Set(nextSchema.map(r => r.key));
      schema = schema.filter(r => nextKeys.has(r.key));
    }
    
    const byCat = new Map<string, IPropertySchema[]>();
    for (const row of schema) {
      const cat = row.category ?? 'General';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(row);
    }
    return Array.from(byCat.entries()).map(([category, rows]) => ({ category, rows }));
  });

  entityTypeName = computed(() => {
    const sel = this.filteredEntities();
    if (!sel.length) return 'No Selection';
    if (sel.length > 1) {
      const types = new Set(sel.map(e => e.type));
      if (types.size === 1) {
        const t: string = types.values().next().value as string;
        return ENTITY_NAMES[t] ?? t;
      }
      return `${sel.length} Objects`;
    }
    return ENTITY_NAMES[sel[0].type] ?? sel[0].type;
  });

  entityIcon = computed(() => {
    const sel = this.filteredEntities();
    if (!sel.length) return '◈';
    const types = new Set(sel.map(e => e.type));
    if (types.size > 1) return '◈';
    return ENTITY_ICONS[sel[0].type] ?? 'â¬¡';
  });

  /* â”€â”€ Layer names â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  layerNames(): string[] {
    return Array.from(this.doc.activeFile.layers.keys());
  }

  /* â”€â”€ Dropdown options â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  optionsFor(row: IPropertySchema): string[] {
    if (row.options?.length) return this._withCurrentValue(row, row.options);
    switch (row.key) {
      case 'patternType': return this._withCurrentValue(row, ['Predefined', 'User-defined', 'Custom']);
      case 'hatchStyle': return this._withCurrentValue(row, ['Normal', 'Outer', 'Ignore']);
      case 'pattern': return this._withCurrentValue(row, this.hatchPatternNames);
      default: return [];
    }
  }

  /**
   * Ensure the currently-selected entity's value for this row is present in the
   * dropdown options. DXF hatches can carry pattern names (e.g. "AR-CONC") or
   * other enum values that aren't in the built-in registry — without this the
   * native <select> would render blank because no <option> matches the value.
   */
  private _withCurrentValue(row: IPropertySchema, base: string[]): string[] {
    const sel = this.filteredEntities();
    if (!sel.length) return base;
    const cur = sel[0].getEffectivePropertyValue(row.key, this.doc);
    if (typeof cur === 'string' && cur && !base.includes(cur)) {
      return [cur, ...base];
    }
    return base;
  }

  formatLinetype(lt: string): string {
    const map: Record<string, string> = {
      BYLAYER: 'ByLayer', BYBLOCK: 'ByBlock', CONTINUOUS: 'Continuous',
      DASHED: 'Dashed', DOTTED: 'Dotted', DASHDOT: 'Dash Dot',
      HIDDEN: 'Hidden', CENTER: 'Center', PHANTOM: 'Phantom', DIVIDE: 'Divide',
    };
    return map[lt] ?? lt;
  }

  /* â”€â”€ Value accessors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  getValue(row: IPropertySchema): unknown {
    const sel = this.filteredEntities();
    if (!sel.length) return '';
    if (row.value !== undefined) return row.value;
    const first = sel[0];
    const v = first.getEffectivePropertyValue(row.key, this.doc);
    if (sel.length === 1) return v ?? '';
    for (const e of sel) {
      if (e.getEffectivePropertyValue(row.key, this.doc) !== v) return '*VARIES*';
    }
    return v ?? '';
  }

  formatNumber(v: unknown): string {
    if (typeof v !== 'number') return String(v ?? '');
    return v.toFixed(3);
  }

  formatDisplay(v: unknown): string {
    if (typeof v === 'number') return v.toFixed(3);
    return String(v ?? '');
  }

  /* â”€â”€ Color helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  private get _firstEntity(): any {
    return this.filteredEntities()[0] as any ?? null;
  }

  resolvedSwatchColor(row: IPropertySchema): string {
    const e = this._firstEntity;
    if (!e) return '#404040';
    if (row.key === 'colorNumber') {
      if (e.color) return e.color;
      const cn: number = e.colorNumber ?? 256;
      if (cn === 256) {
        // ByLayer â€” resolve from layer
        const lay = this.doc.activeFile?.layers?.get(e.layer);
        return lay?.color ?? '#555';
      }
      if (cn === 0) return '#ffffff'; // ByBlock (white stand-in)
      if (cn >= 1 && cn < 256) return DXF_ACI_COLORS[cn] ?? '#404040';
      return '#404040';
    } else {
      const val = this.getValue(row);
      return typeof val === 'string' && val ? val : '#404040';
    }
  }

  colorLabel(row: IPropertySchema): string {
    const e = this._firstEntity;
    if (!e) return '';
    if (row.key === 'colorNumber') {
      if (e.color) return e.color;
      const cn: number = e.colorNumber ?? 256;
      if (cn === 256) return 'ByLayer';
      if (cn === 0) return 'ByBlock';
      if (cn >= 1 && cn < 256) return `ACI ${cn}`;
      return 'ByLayer';
    } else {
      const val = this.getValue(row);
      return typeof val === 'string' && val ? val : '';
    }
  }

  hexForPicker(row: IPropertySchema): string {
    const c = this.resolvedSwatchColor(row);
    // Ensure it's a valid 6-char hex for <input type="color">
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    if (/^#[0-9a-fA-F]{3}$/.test(c)) {
      return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    return '#808080';
  }

  onColorPicked(row: IPropertySchema, ev: Event): void {
    const hex = (ev.target as HTMLInputElement).value;
    if (row.key === 'colorNumber') {
      this.applyKey('color', hex);
    } else {
      this.applyKey(row.key, hex);
    }
  }

  /**
   * Multi-selection detection for the color row. When more than one entity
   * is selected, return true if their resolved colors disagree. The
   * ColorPicker shows a "Varies" trigger label in this state.
   */
  isMixedColor(row: IPropertySchema): boolean {
    const ents = this.filteredEntities();
    if (ents.length < 2) return false;
    const first = this._entityColorHex(ents[0], row);
    for (let i = 1; i < ents.length; i++) {
      if (this._entityColorHex(ents[i], row) !== first) return true;
    }
    return false;
  }

  /**
   * Color picker commit handler. Routes through the existing `applyKey`
   * pipeline so the change goes onto the command stack and propagates to
   * every selected entity in a single undoable step.
   */
  onColorCommitted(row: IPropertySchema, hex: string): void {
    if (row.key === 'colorNumber') {
      this.applyKey('color', hex);
    } else {
      this.applyKey(row.key, hex);
    }
  }

  /** Resolve the displayed hex for a given entity + row, used by mixed-detection. */
  private _entityColorHex(e: any, row: IPropertySchema): string {
    if (row.key === 'colorNumber') {
      if (e.color) return String(e.color).toLowerCase();
      const cn: number = e.colorNumber ?? 256;
      if (cn === 256) {
        const lay = this.doc.activeFile?.layers?.get(e.layer);
        return (lay?.color ?? '#555').toLowerCase();
      }
      if (cn >= 1 && cn < 256) return (DXF_ACI_COLORS[cn] ?? '#404040').toLowerCase();
      return '#ffffff';
    }
    const v = (e as any)[row.key];
    return typeof v === 'string' ? v.toLowerCase() : '#404040';
  }

  setColorByLayer(row: IPropertySchema): void {
    if (row.key === 'colorNumber') {
      this.applyKey('colorNumber', 256);
    }
  }

  /* â”€â”€ Setters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  setValue(row: IPropertySchema, ev: Event): void {
    if (row.readOnly) return;
    const target = ev.target as HTMLInputElement | HTMLSelectElement;
    let raw: unknown = target.value;
    if (row.type === 'number') {
      const n = parseFloat(target.value);
      if (Number.isNaN(n)) return;
      raw = n;
    } else if (row.type === 'color') {
      const trimmed = target.value.trim();
      if (trimmed.startsWith('#')) raw = trimmed;
      else {
        const n = parseInt(trimmed, 10);
        if (!Number.isNaN(n)) { this.applyKey('colorNumber', n); return; }
        raw = trimmed;
      }
    }
    this.applyKey(row.key, raw);
  }

  setBool(row: IPropertySchema, ev: Event): void {
    if (row.readOnly) return;
    const target = ev.target as HTMLInputElement;
    this.applyKey(row.key, target.checked);
  }

  toggleBoolDirect(row: IPropertySchema, newValue: boolean): void {
    if (row.readOnly) return;
    this.applyKey(row.key, newValue);
  }

  runAction(row: IPropertySchema): void {
    if (row.readOnly) return;
    this.applyKey(row.key, row.value ?? null);
  }

  /* â”€â”€ Collapsible groups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  private readonly _collapsed = signal<Set<string>>(new Set());

  toggleGroup(cat: string): void {
    this._collapsed.update(s => {
      const next = new Set(s);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  isCollapsed(cat: string): boolean {
    return this._collapsed().has(cat);
  }

  /* â”€â”€ Engineering symbol palette â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  readonly symbols = ENG_SYMBOLS;
  readonly paletteOpen = signal(false);
  lastFocusedTextInput: HTMLInputElement | null = null;

  customRotations = new Set<string>();

  private _rowCustomKey(row: IPropertySchema): string {
    const first = this.filteredEntities()[0];
    return first ? `${first.id}_${row.key}` : '';
  }

  getRotationSelectValue(row: IPropertySchema): string {
    const key = this._rowCustomKey(row);
    if (this.customRotations.has(key)) return 'custom';
    const val = this.getValue(row);
    if (val === null || val === undefined) return '0';
    const num = Math.round(Number(val));
    if ([0, 45, 90, 180, 270].includes(num)) {
      return String(num);
    }
    return 'custom';
  }

  isRotationCustom(row: IPropertySchema): boolean {
    const key = this._rowCustomKey(row);
    if (this.customRotations.has(key)) return true;
    const val = this.getValue(row);
    if (val === null || val === undefined) return false;
    const num = Math.round(Number(val));
    return ![0, 45, 90, 180, 270].includes(num);
  }

  onRotationSelectChange(row: IPropertySchema, ev: Event): void {
    const val = (ev.target as HTMLSelectElement).value;
    const key = this._rowCustomKey(row);
    if (val === 'custom') {
      this.customRotations.add(key);
    } else {
      this.customRotations.delete(key);
      const fakeEv = { target: { value: val } } as unknown as Event;
      this.setValue(row, fakeEv);
    }
  }

  togglePalette(): void { this.paletteOpen.update(v => !v); }

  onTextFocus(ev: FocusEvent): void {
    const t = ev.target as HTMLInputElement | null;
    if (t && t.tagName === 'INPUT') this.lastFocusedTextInput = t;
  }

  onSymbolMouseDown(ev: MouseEvent, sym: string): void {
    ev.preventDefault();
    const input = this.lastFocusedTextInput;
    if (!input || !input.isConnected) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = input.value.slice(0, start) + sym + input.value.slice(end);
    const pos = start + sym.length;
    input.selectionStart = input.selectionEnd = pos;
    input.focus();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* â”€â”€ Command dispatch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  private applyKey(key: string, value: unknown): void {
    const sel = this.filteredEntities();
    if (!sel.length) return;
    const oldValues = sel.map((e: Entity) => ({ id: e.id, value: (e as any)[key] }));
    this.cmds.push(new ModifyPropertiesCmd(sel, key, value, oldValues, {
      markDirty: () => this.vm.markContentDirty(),
    }));
  }
}
