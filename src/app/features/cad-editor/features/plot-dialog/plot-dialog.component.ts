import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  HostListener,
  computed,
  effect,
  inject,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlotDialogService, PlotDialogTab } from './plot-dialog.service';
import { PlotWindowPickService } from './plot-window-pick.service';
import { ExportManagerService } from '../../core/services/export/export-manager.service';
import { PlotRendererService } from '../../core/services/export/plot-renderer.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  IPlotOptions,
  PlotFormat,
  QUALITY_PRESETS,
  SCALE_PRESETS,
  RESOLUTION_PRESETS,
  FORMAT_META,
  VECTOR_FORMATS,
  RASTER_FORMATS,
  defaultPlotOptions,
  defaultPlotOffset,
} from '../../core/models/plot-options.model';
import {
  PAPER_REGISTRY,
  SCALE_REGISTRY,
  PLOTTER_REGISTRY,
  PLOT_STYLE_REGISTRY,
  getPaperByKey,
  getPaperGroups,
  PlotDevice,
  PaperCategory,
  ScaleDefinition,
} from '../../core/models/plot-registry.model';

/**
 * Professional AutoCAD-style Plot / Export dialog.
 *
 * Architecture:
 *  - Registry-driven: all papers, scales, plotters, CTBs come from typed registries
 *  - Tabbed layout: Plotter/Paper | Plot Area/Scale | Style/Quality | Advanced | Page Setups
 *  - Right panel: always-visible live preview with AutoCAD-like overlay
 *  - Sheet info panel: paper size, printable area, scale, utilisation, estimated file size
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-plot-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
@if (svc.isOpen()) {
  <div class="pd-overlay" (click)="onOverlayClick($event)">
    <div class="pd-dialog" (click)="$event.stopPropagation()">
      <!-- ── Header ──────────────────────────────────────────────────────────── -->
      <div class="pd-header">
        <span class="pd-header-title">
          {{ headerTitle() }}
          <span class="pd-badge" [class.pd-badge-vector]="isVector()" [class.pd-badge-raster]="isRaster()">
            {{ formatBadge() }}
          </span>
        </span>
        <div class="pd-header-right">
          <span class="pd-plotter-name">{{ plotterDisplayName() }}</span>
          <button class="pd-close" (click)="cancel()" title="Close (Esc)">&#x2715;</button>
        </div>
      </div>
      <!-- ── Body ────────────────────────────────────────────────────────────── -->
      <div class="pd-body">
        <!-- ════════ COLUMN 1 ════════ -->
        <div class="pd-col">
          <!-- Page Setup -->
          <fieldset class="pd-fieldset">
            <legend>Page setup</legend>
            <div class="pd-group">
              <div class="pd-row">
                <input class="pd-input-text" style="flex:1" type="text" [(ngModel)]="newSetupName"
                  placeholder="Name..." maxlength="60"
                  (keydown.enter)="saveSetup()">
                  <button class="pd-btn pd-btn-primary" (click)="saveSetup()" [disabled]="!newSetupName.trim()" style="margin-left:6px">Save</button>
                </div>
                @if (pageSetupCount() > 0) {
                  <div style="margin-top:4px">
                    <div class="pd-setup-list">
                      @for (s of svc.pageSetups(); track s) {
                        <div class="pd-setup-item">
                          <div class="pd-setup-info" (click)="loadSetup(s.name)" title="Click to apply">
                            <span class="pd-setup-name">{{ s.name }}</span>
                          </div>
                          <button class="pd-setup-delete" (click)="deleteSetup(s.name)" title="Delete">✕</button>
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            </fieldset>
            <!-- Printer / Plotter -->
            <fieldset class="pd-fieldset">
              <legend>Printer/plotter</legend>
              <div class="pd-group">
                <label class="pd-label">Name</label>
                <select class="pd-select" [(ngModel)]="opts.plotterKey" (ngModelChange)="onPlotterChange()">
                  @for (grp of plotterGroups; track grp) {
                    <optgroup [label]="grp.label">
                      @for (d of grp.devices; track d) {
                        <option [value]="d.key" [disabled]="!d.available">
                          {{ d.name }}{{ !d.available ? ' (coming soon)' : '' }}
                        </option>
                      }
                    </optgroup>
                  }
                </select>
              </div>
              <div class="pd-group" style="margin-top:6px" [class.pd-disabled]="isExchange()">
                <label class="pd-label">Background Color</label>
                <select class="pd-select" [(ngModel)]="opts.background" (ngModelChange)="touch()" [disabled]="isExchange()">
                  <option value="white">White (for print)</option>
                  <option value="dark">Dark</option>
                  <option value="transparent" [disabled]="opts.format !== 'png'">Transparent (PNG only)</option>
                </select>
              </div>
            </fieldset>
            <!-- Paper Size -->
            <fieldset class="pd-fieldset" [class.pd-disabled]="isExchange()">
              <legend>Paper size</legend>
              <div class="pd-group">
                <div class="pd-row">
                  <div style="flex:1">
                    <select class="pd-select" [(ngModel)]="opts.paper" (ngModelChange)="touch()" [disabled]="isExchange()">
                      @for (cat of paperCategories; track cat) {
                        <optgroup [label]="cat">
                          @for (p of papersByCategory(cat); track p) {
                            <option [value]="p.key">
                              {{ p.label }} ({{ formatPaperSize(p) }})
                            </option>
                          }
                        </optgroup>
                      }
                      <option value="Custom">Custom...</option>
                    </select>
                  </div>
                  <div class="pd-unit-toggle">
                    <button class="pd-unit-btn" [class.active]="opts.paperUnits === 'mm'" (click)="setPaperUnits('mm')">mm</button>
                    <button class="pd-unit-btn" [class.active]="opts.paperUnits === 'inches'" (click)="setPaperUnits('inches')">in</button>
                  </div>
                </div>
                <!-- Custom paper size inputs -->
                @if (opts.paper === 'Custom') {
                  <div class="pd-custom-paper" style="margin-top:4px">
                    <div class="pd-row">
                      <div class="pd-field">
                        <label class="pd-label">Width</label>
                        <div class="pd-row">
                          <input class="pd-num" type="number" min="10" [(ngModel)]="customW" (ngModelChange)="onCustomPaperChange()" style="width:70px">
                          <span class="pd-unit">{{ opts.paperUnits }}</span>
                        </div>
                      </div>
                      <div class="pd-field" style="margin-left:10px">
                        <label class="pd-label">Height</label>
                        <div class="pd-row">
                          <input class="pd-num" type="number" min="10" [(ngModel)]="customH" (ngModelChange)="onCustomPaperChange()" style="width:70px">
                          <span class="pd-unit">{{ opts.paperUnits }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              </div>
            </fieldset>
            <!-- Plot Area & Offset -->
            <fieldset class="pd-fieldset" [class.pd-disabled]="isExchange()">
              <legend>Plot area & offset</legend>
              <div class="pd-group">
                <label class="pd-label">What to plot</label>
                <div class="pd-row">
                  <select class="pd-select" style="flex:1" [(ngModel)]="opts.area" (ngModelChange)="touch()" [disabled]="isExchange()">
                    <option value="extents">Drawing Extents</option>
                    <option value="display">Display (current view)</option>
                    <option value="window">Window</option>
                    <option value="selection">Selected Objects</option>
                    <option value="limits">Drawing Limits</option>
                    <option value="layout">Layout Extents</option>
                  </select>
                  @if (opts.area === 'window') {
                    <button class="pd-btn pd-btn-pick" (click)="pickWindow()" [disabled]="isExchange()">Pick&lt;</button>
                  }
                </div>
              </div>
              <div class="pd-group" style="margin-top:10px">
                <label class="pd-check">
                  <input type="checkbox" [(ngModel)]="opts.plotOffset.center" (ngModelChange)="onCenterPlotChange()" [disabled]="isExchange()">
                  Center the plot
                </label>
                <div class="pd-row" style="margin-top:4px" [class.pd-disabled]="opts.plotOffset.center">
                  <div class="pd-field">
                    <div class="pd-row">
                      <span class="pd-label" style="width:12px">X:</span>
                      <input class="pd-num" style="width:55px" type="number" step="0.5"
                        [(ngModel)]="opts.plotOffset.x" (ngModelChange)="touch()"
                        [disabled]="opts.plotOffset.center || isExchange()">
                        <span class="pd-unit">mm</span>
                      </div>
                    </div>
                    <div class="pd-field" style="margin-left:10px">
                      <div class="pd-row">
                        <span class="pd-label" style="width:12px">Y:</span>
                        <input class="pd-num" style="width:55px" type="number" step="0.5"
                          [(ngModel)]="opts.plotOffset.y" (ngModelChange)="touch()"
                          [disabled]="opts.plotOffset.center || isExchange()">
                          <span class="pd-unit">mm</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </fieldset>
              </div>
              <!-- ════════ COLUMN 2 ════════ -->
              <div class="pd-col">
                <!-- Plot Scale -->
                <fieldset class="pd-fieldset" [class.pd-disabled]="isExchange()">
                  <legend>Plot scale</legend>
                  <div class="pd-group">
                    <label class="pd-label">Scale Preset</label>
                    <select class="pd-select" [ngModel]="scaleKey()" (ngModelChange)="onScalePreset($event)" [disabled]="isExchange()">
                      @for (grp of scaleGroups; track grp) {
                        <optgroup [label]="grp.label">
                          @for (s of grp.scales; track s) {
                            <option [value]="s.label">{{ s.label }}</option>
                          }
                        </optgroup>
                      }
                    </select>
                    <!-- Custom scale inputs -->
                    @if (scaleKey() === 'Custom…') {
                      <div class="pd-custom-scale" style="margin-top:4px">
                        <div class="pd-scale-row">
                          <input class="pd-num" style="width:55px" type="number" min="0.001" step="1" [(ngModel)]="customScalePaper" (ngModelChange)="onCustomScaleChange()">
                          <span class="pd-unit">{{ opts.paperUnits }}</span>
                          <span class="pd-scale-eq">=</span>
                          <input class="pd-num" style="width:55px" type="number" min="0.001" step="1" [(ngModel)]="customScaleWorld" (ngModelChange)="onCustomScaleChange()">
                          <span class="pd-unit">units</span>
                        </div>
                      </div>
                    }
                    <label class="pd-check" style="margin-top:6px">
                      <input type="checkbox" [(ngModel)]="opts.scaleLineweights" (ngModelChange)="touch()" [disabled]="isExchange()">
                      Scale lineweights
                    </label>
                  </div>
                </fieldset>
                <!-- Style & Quality -->
                <fieldset class="pd-fieldset">
                  <legend>Plot style & quality</legend>
                  <div class="pd-group" [class.pd-disabled]="isExchange()">
                    <label class="pd-label">Plot style table (pen assignments)</label>
                    <select class="pd-select" [(ngModel)]="opts.plotStyleKey" (ngModelChange)="onPlotStyleChange()" [disabled]="isExchange()">
                      @for (s of plotStyleRegistry; track s) {
                        <option [value]="s.key">{{ s.label }}</option>
                      }
                    </select>
                  </div>
                  <div class="pd-group" style="margin-top:6px" [class.pd-disabled]="isExchange()">
                    <label class="pd-label">Quality (DPI)</label>
                    <select class="pd-select" [(ngModel)]="opts.dpi" (ngModelChange)="touch()" [disabled]="isExchange()">
                      @for (q of qualityPresets; track q) {
                        <option [ngValue]="q.dpi">{{ q.label }} ({{ q.dpi }} dpi)</option>
                      }
                    </select>
                  </div>
                  <div class="pd-group" style="margin-top:6px">
                    <label class="pd-label">Drawing orientation</label>
                    <div class="pd-orientation">
                      <label class="pd-ori-opt" [class.active]="opts.orientation === 'portrait'">
                        <input type="radio" name="ori" value="portrait" [(ngModel)]="opts.orientation" (ngModelChange)="touch()" [disabled]="isExchange()">
                        Portrait
                      </label>
                      <label class="pd-ori-opt" [class.active]="opts.orientation === 'landscape'">
                        <input type="radio" name="ori" value="landscape" [(ngModel)]="opts.orientation" (ngModelChange)="touch()" [disabled]="isExchange()">
                        Landscape
                      </label>
                    </div>
                  </div>
                </fieldset>
                <!-- Advanced Settings / Plot options -->
                <fieldset class="pd-fieldset">
                  <legend>Plot options</legend>
                  <div class="pd-group" [class.pd-disabled]="isExchange()">
                    <label class="pd-check"><input type="checkbox" [(ngModel)]="opts.plotLineweights" (ngModelChange)="touch()" [disabled]="isExchange()"> Plot object lineweights</label>
                    <label class="pd-check"><input type="checkbox" [(ngModel)]="opts.plotTransparency" (ngModelChange)="touch()" [disabled]="isExchange()"> Plot transparency</label>
                    <label class="pd-check"><input type="checkbox" [(ngModel)]="opts.plotStamp" (ngModelChange)="touch()" [disabled]="isExchange()"> Plot stamp on</label>
                    @if (opts.plotStamp && !isExchange()) {
                      <input class="pd-input-text" type="text" maxlength="80" [(ngModel)]="opts.plotStampLabel" (ngModelChange)="touch()" placeholder="Optional stamp label..." style="margin-top:4px">
                    }
                  </div>
                  @if (opts.format === 'pdf') {
                    <hr class="pd-divider" style="margin:8px 0">
                    <div class="pd-group">
                      <label class="pd-check"><input type="checkbox" [(ngModel)]="opts.pdfOptions.preserveVectors" (ngModelChange)="touch()"> Preserve vectors</label>
                      <label class="pd-check"><input type="checkbox" [(ngModel)]="opts.pdfOptions.searchableText" (ngModelChange)="touch()"> Searchable text</label>
                      <label class="pd-check"><input type="checkbox" [(ngModel)]="opts.pdfOptions.embedFonts" (ngModelChange)="touch()"> Embed fonts</label>
                      <label class="pd-check"><input type="checkbox" [(ngModel)]="opts.pdfOptions.exportLayers" (ngModelChange)="touch()"> Export layers</label>
                    </div>
                  }
                  @if (isRaster()) {
                    <hr class="pd-divider" style="margin:8px 0">
                    <div class="pd-group">
                      <label class="pd-label">Anti-Aliasing</label>
                      <select class="pd-select" [(ngModel)]="opts.rasterOptions.antiAlias" (ngModelChange)="touch()">
                        <option value="off">Off</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High (recommended)</option>
                      </select>
                    </div>
                    <div class="pd-group" style="margin-top:6px">
                      <label class="pd-label">Color Depth</label>
                      <select class="pd-select" [(ngModel)]="opts.rasterOptions.colorDepth" (ngModelChange)="touch()">
                        <option value="8bit">8-bit</option>
                        <option value="16bit">16-bit</option>
                        <option value="24bit">24-bit</option>
                        <option value="32bit">32-bit (alpha)</option>
                      </select>
                    </div>
                  }
                  @if (opts.format === 'dxf') {
                    <div class="pd-group" style="margin-top:6px">
                      <hr class="pd-divider" style="margin:4px 0 8px 0">
                      <label class="pd-label">DXF Version</label>
                      <select class="pd-select" [(ngModel)]="opts.dxfVersion" (ngModelChange)="touch()">
                        <option value="R12">R12 (wide compatibility)</option>
                        <option value="R2000">R2000 (recommended)</option>
                        <option value="R2013">R2013 (planned)</option>
                      </select>
                    </div>
                  }
                </fieldset>
              </div>
              <!-- ════════ COLUMN 3: PREVIEW ════════ -->
              <div class="pd-col-preview">
                <div class="pd-preview-header">
                  <span class="pd-preview-title">Plot Preview</span>
                  <div class="pd-preview-controls">
                    @if (geomInfo(); as g) {
                      <span class="pd-preview-badge">
                        {{ paperLabel() }} {{ opts.orientation === 'landscape' ? 'Landscape' : 'Portrait' }} · {{ formatScale(g.ratio) }}
                      </span>
                    }
                    <button class="pd-prev-ctrl" (click)="zoomPreviewFit()" title="Fit to preview">⊡</button>
                    <button class="pd-prev-ctrl" (click)="onPreviewFull()" title="Open full preview">⤢</button>
                  </div>
                </div>
                <div class="pd-preview-wrap" #previewWrap>
                  <canvas #previewCanvas class="pd-preview-canvas"></canvas>
                  @if (!previewHasContent) {
                    <div class="pd-preview-empty">
                      <div>Nothing to plot in this area.</div>
                    </div>
                  }
                  @if (windowPickService.isPicking()) {
                    <div class="pd-pick-hint">
                      Click two corners on the canvas to define the plot window...
                    </div>
                  }
                  <!-- Page shadow effect -->
                  @if (previewHasContent) {
                    <div class="pd-page-shadow"></div>
                  }
                </div>
                <!-- Sheet Information Panel -->
                @if (geomInfo(); as g) {
                  <div class="pd-sheet-info">
                    <div class="pd-sheet-grid">
                      <div class="pd-sheet-item">
                        <span class="pd-sheet-label">Paper</span>
                        <span>{{ g.paperW | number:'1.0-1' }} × {{ g.paperH | number:'1.0-1' }} mm</span>
                      </div>
                      <div class="pd-sheet-item">
                        <span class="pd-sheet-label">Scale</span>
                        <span>{{ formatScale(g.ratio) }}</span>
                      </div>
                      <div class="pd-sheet-item">
                        <span class="pd-sheet-label">Drawing Area</span>
                        <span>{{ g.worldW | number:'1.1-1' }} × {{ g.worldH | number:'1.1-1' }} units</span>
                      </div>
                      <div class="pd-sheet-item">
                        <span class="pd-sheet-label">Sheet Use</span>
                        <span [class.pd-util-high]="g.utilPct > 90" [class.pd-util-low]="g.utilPct < 30">
                          {{ g.utilPct | number:'1.0-0' }}%
                        </span>
                      </div>
                      <div class="pd-sheet-item">
                        <span class="pd-sheet-label">Resolution</span>
                        <span>{{ opts.dpi }} dpi</span>
                      </div>
                      <div class="pd-sheet-item">
                        <span class="pd-sheet-label">Plot Style</span>
                        <span>{{ plotStyleShortName() }}</span>
                      </div>
                    </div>
                  </div>
                } @else {
                  @if (isExchange()) {
                    <div class="pd-sheet-info">
                      <span class="pd-exchange-note">
                        {{ opts.format.toUpperCase() }} exports the full model — no sheet layout applied.
                        @if (opts.format === 'dxf') {
                          <span>Version: {{ opts.dxfVersion }}</span>
                        }
                        Opens in AutoCAD, BricsCAD, DraftSight, NanoCAD.
                      </span>
                    </div>
                  }
                }
              </div>
            </div>
            <!-- ── Footer ──────────────────────────────────────────────────────────── -->
            <div class="pd-footer">
              <div class="pd-footer-left">
                <span class="pd-footer-hint">Enter = Confirm &nbsp;·&nbsp; Esc = Cancel</span>
                <button class="pd-btn pd-btn-sm pd-btn-secondary" (click)="resetToDefaults()" title="Reset all settings to defaults">↺ Defaults</button>
              </div>
              <div class="pd-footer-actions">
                <button class="pd-btn pd-btn-secondary" (click)="onPreviewFull()" [disabled]="isExchange()">Preview...</button>
                <button class="pd-btn pd-btn-print" (click)="onBrowserPrint()" [disabled]="isExchange()">Print</button>
                <button class="pd-btn pd-btn-primary" (click)="commit()">{{ actionVerb() }}</button>
                <button class="pd-btn" (click)="cancel()">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      }
`,
  styles: [`
    /* ── Base ── */
    .pd-overlay { position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2000;display:flex;align-items:center;justify-content:center;font-family:var(--cad-font-ui,'Segoe UI',system-ui,sans-serif);color:var(--cad-text-primary,#d4d4d4); }
    .pd-dialog { background:var(--cad-bg-panel-solid,#1e2026);border:1px solid var(--cad-border,#3a3f4b);border-radius:6px;box-shadow:0 16px 64px rgba(0,0,0,.7);width:1060px;max-width:98vw;max-height:94vh;display:flex;flex-direction:column; }

    /* ── Header ── */
    .pd-header { background:var(--cad-bg-header,#141619);padding:8px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--cad-border,#3a3f4b);flex-shrink:0;border-radius:6px 6px 0 0; }
    .pd-header-title { display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600; }
    .pd-header-right { display:flex;align-items:center;gap:12px; }
    .pd-plotter-name { font-size:11px;color:var(--cad-accent,#5ab0ff);opacity:.8; }
    .pd-badge { font-size:10px;font-weight:700;letter-spacing:.4px;padding:1px 6px;border-radius:3px;text-transform:uppercase; }
    .pd-badge-vector { background:#1a3a5c;color:#5ab0ff;border:1px solid #2c5282; }
    .pd-badge-raster { background:#1c3a1c;color:#5adb5a;border:1px solid #2a5a2a; }
    .pd-close { background:none;border:none;color:var(--cad-text-dim,#888);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px; }
    .pd-close:hover { color:var(--cad-text-primary,#d4d4d4); }

    /* ── Body ── */
    .pd-body { display:flex;gap:12px;flex:1;overflow:hidden;min-height:0;padding:12px; }
    .pd-col { width:320px;overflow-y:auto;display:flex;flex-direction:column;gap:14px;padding-right:10px; }
    .pd-col::-webkit-scrollbar { width:6px; }
    .pd-col::-webkit-scrollbar-thumb { background:var(--cad-border,#3a3f4b);border-radius:3px; }
    .pd-col-preview { flex:1;display:flex;flex-direction:column;min-width:0; }

    /* ── Fieldsets ── */
    .pd-fieldset { border:1px solid var(--cad-border,#3a3f4b);border-radius:4px;padding:12px 14px 14px;margin:0;background:var(--cad-bg-panel-solid,#1e2026); }
    .pd-fieldset legend { font-size:10.5px;color:var(--cad-accent,#5ab0ff);padding:0 4px;font-weight:600;text-transform:uppercase;letter-spacing:.3px; }

    .pd-divider { border:none;border-top:1px solid var(--cad-border,#3a3f4b);margin:2px 0; }

    /* ── Controls ── */
    .pd-group { display:flex;flex-direction:column;gap:6px; }
    .pd-group.pd-disabled { opacity:.5;pointer-events:none; }
    .pd-label { font-size:10.5px;color:var(--cad-text-dim,#888);font-weight:500; }
    .pd-select { background:var(--cad-bg-input,#252830);border:1px solid var(--cad-border,#3a3f4b);color:var(--cad-text-primary,#d4d4d4);padding:4px 6px;border-radius:3px;font-family:inherit;font-size:11.5px;width:100%; }
    .pd-select:focus { border-color:var(--cad-accent,#5ab0ff);outline:none; }
    .pd-select:disabled { opacity:.5; }
    .pd-num { background:var(--cad-bg-input,#252830);border:1px solid var(--cad-border,#3a3f4b);color:var(--cad-text-primary,#d4d4d4);padding:3px 5px;border-radius:3px;font-family:inherit;font-size:11.5px; }
    .pd-num:focus { border-color:var(--cad-accent,#5ab0ff);outline:none; }
    .pd-input-text { background:var(--cad-bg-input,#252830);border:1px solid var(--cad-border,#3a3f4b);color:var(--cad-text-primary,#d4d4d4);padding:3px 6px;border-radius:3px;font-family:inherit;font-size:11.5px;width:100%;box-sizing:border-box; }
    .pd-input-text:focus { border-color:var(--cad-accent,#5ab0ff);outline:none; }
    .pd-row { display:flex;align-items:center;gap:6px; }
    .pd-field { display:flex;flex-direction:column;gap:2px; }
    .pd-sep,.pd-unit { font-size:10.5px;color:var(--cad-text-dim,#888);white-space:nowrap; }
    .pd-check { display:flex;align-items:center;justify-content:flex-start;gap:6px;font-size:11.5px;cursor:pointer;margin:0;color:var(--cad-text-secondary,#aaa);width:max-content;white-space:nowrap; }
    .pd-check input[type="checkbox"] {
      width: 14px !important;
      height: 14px !important;
      padding: 0 !important;
      margin: 0 !important;
      background: none !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      flex-shrink: 0;
      accent-color: var(--cad-accent,#5ab0ff);
    }
    .pd-hint { font-size:9.5px;color:var(--cad-text-dim,#888); }
    .pd-hint-warn { color:#f0a050; }
    .pd-device-desc { font-size:9.5px;color:var(--cad-text-dim,#888);line-height:1.3; }
    .pd-slider { width:100%;accent-color:var(--cad-accent,#5ab0ff); }

    /* ── Paper dims ── */
    .pd-paper-dims { display:flex;align-items:center;gap:6px;font-size:10px;color:var(--cad-text-secondary,#aaa);background:var(--cad-bg-canvas,#101215);border:1px solid var(--cad-border,#3a3f4b);border-radius:3px;padding:3px 6px; }
    .pd-dims-label { color:var(--cad-text-dim,#888); }
    .pd-dims-sep { color:var(--cad-border,#3a3f4b); }
    .pd-custom-paper { background:var(--cad-bg-canvas,#101215);border:1px solid var(--cad-border,#3a3f4b);border-radius:3px;padding:6px; }

    /* ── Unit toggle ── */
    .pd-unit-toggle { display:flex;border:1px solid var(--cad-border,#3a3f4b);border-radius:3px;overflow:hidden; }
    .pd-unit-btn { background:var(--cad-bg-input,#252830);border:none;color:var(--cad-text-dim,#888);padding:4px 8px;font-size:10.5px;font-family:inherit;cursor:pointer; }
    .pd-unit-btn.active { background:var(--cad-accent,#1a6fc4);color:#fff; }

    /* ── Orientation ── */
    .pd-orientation { display:flex;gap:6px;width:100%; }
    .pd-ori-opt { display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;padding:4px 8px;border-radius:3px;border:1px solid var(--cad-border,#3a3f4b);background:var(--cad-bg-input,#252830);flex:1;justify-content:center;color:var(--cad-text-secondary,#aaa); }
    .pd-ori-opt.active { border-color:var(--cad-accent,#5ab0ff);color:var(--cad-accent,#5ab0ff);background:rgba(90,176,255,.1); }
    .pd-ori-opt input { display:none; }

    /* ── Scale ── */
    .pd-custom-scale { background:var(--cad-bg-canvas,#101215);border:1px solid var(--cad-border,#3a3f4b);border-radius:3px;padding:6px;display:flex;flex-direction:column;gap:4px; }
    .pd-scale-row { display:flex;align-items:center;gap:4px; }
    .pd-scale-eq { font-size:12px;color:var(--cad-text-dim,#888);padding:0 2px; }

    /* ── Buttons ── */
    .pd-btn { background:var(--cad-bg-panel-solid,#1e2026);border:1px solid var(--cad-border,#3a3f4b);color:var(--cad-text-primary,#d4d4d4);padding:4px 10px;border-radius:3px;font-size:11.5px;cursor:pointer;font-family:inherit; }
    .pd-btn:hover:not(:disabled) { background:var(--cad-bg-hover,#2a2f3a); }
    .pd-btn:disabled { opacity:.4;cursor:not-allowed; }
    .pd-btn-sm { padding:2px 6px;font-size:10.5px; }
    .pd-btn-primary { background:var(--cad-accent,#1a6fc4);color:#fff;border-color:var(--cad-accent,#1a6fc4);font-weight:600;min-width:80px; }
    .pd-btn-primary:hover:not(:disabled) { background:var(--cad-accent-dim,#155ea8); }
    .pd-btn-pick { background:rgba(255,0,255,.12);border-color:#ff00ff;color:#ff00ff;padding:3px 8px;font-size:10.5px;font-weight:700; }
    .pd-btn-print { background:rgba(90,220,90,.1);border-color:#5adc5a;color:#5adc5a; }
    .pd-btn-secondary { color:var(--cad-text-secondary,#aaa); }
    .pd-btn-danger { background:rgba(220,50,50,.12);border-color:#dc3232;color:#dc6060; }
    .pd-btn-danger:hover:not(:disabled) { background:rgba(220,50,50,.25); }

    /* ── Preview ── */
    .pd-preview-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-shrink:0; }
    .pd-preview-title { font-size:9.5px;font-weight:700;letter-spacing:.6px;color:var(--cad-text-dim,#888);text-transform:uppercase; }
    .pd-preview-controls { display:flex;align-items:center;gap:6px; }
    .pd-preview-badge { font-size:10.5px;color:var(--cad-accent,#5ab0ff); }
    .pd-prev-ctrl { background:none;border:1px solid var(--cad-border,#3a3f4b);color:var(--cad-text-dim,#888);border-radius:3px;padding:1px 5px;font-size:12px;cursor:pointer; }
    .pd-prev-ctrl:hover { color:var(--cad-text-primary,#d4d4d4);border-color:var(--cad-text-dim,#888); }
    .pd-preview-wrap { flex:1;background:var(--cad-bg-canvas,#101215);border:1px solid var(--cad-border,#3a3f4b);border-radius:3px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;min-height:260px;padding:12px; }
    .pd-preview-canvas { background:white;box-shadow:4px 6px 20px rgba(0,0,0,.7),0 0 0 1px rgba(120,140,170,0.4);max-width:100%;max-height:100%;position:relative;z-index:1; }
    .pd-preview-empty { position:absolute;display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--cad-text-dim,#888);font-size:11.5px; }
    .pd-pick-hint { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);color:#ff00ff;font-size:12px;font-weight:600;border-radius:3px;z-index:10; }
    .pd-page-shadow { position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,.3) 100%);z-index:0; }

    /* ── Sheet Info ── */
    .pd-sheet-info { margin-top:6px;flex-shrink:0;background:var(--cad-bg-canvas,#101215);border:1px solid var(--cad-border,#3a3f4b);border-radius:3px;padding:6px 10px; }
    .pd-sheet-grid { display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px 12px; }
    .pd-sheet-item { display:flex;flex-direction:column;gap:1px; }
    .pd-sheet-label { font-size:9px;color:var(--cad-text-dim,#888);text-transform:uppercase;letter-spacing:.4px; }
    .pd-sheet-item > span:last-child { font-size:10.5px;color:var(--cad-text-secondary,#aaa); }
    .pd-util-high { color:#f06060;font-weight:600; }
    .pd-util-low  { color:#f0a040; }
    .pd-exchange-note { font-size:10.5px;color:var(--cad-text-dim,#888);line-height:1.4; }

    /* ── Page Setups persists ── */
    .pd-setup-list { display:flex;flex-direction:column;gap:3px;max-height:110px;overflow-y:auto;border:1px solid var(--cad-border,#3a3f4b);border-radius:3px;padding:3px;background:var(--cad-bg-input,#252830); }
    .pd-setup-item { display:flex;align-items:center;justify-content:space-between;padding:3px 6px;border-radius:2px;cursor:pointer; }
    .pd-setup-item:hover { background:rgba(255,255,255,.05); }
    .pd-setup-info { display:flex;flex-direction:column;flex:1;min-width:0; }
    .pd-setup-name { font-size:11px;font-weight:600;color:var(--cad-accent,#5ab0ff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .pd-setup-meta { font-size:9.5px;color:var(--cad-text-dim,#888); }
    .pd-setup-delete { background:none;border:none;color:var(--cad-text-dim,#888);cursor:pointer;font-size:10px;padding:0 4px; }
    .pd-setup-delete:hover { color:#ff6b6b; }
    .pd-quick-setups { display:flex;flex-wrap:wrap;gap:4px; }
    .pd-quick-btn { background:var(--cad-bg-input,#252830);border:1px solid var(--cad-border,#3a3f4b);color:var(--cad-text-secondary,#aaa);padding:3px 6px;border-radius:3px;font-size:10px;cursor:pointer;font-family:inherit; }
    .pd-quick-btn:hover { border-color:var(--cad-accent,#5ab0ff);color:var(--cad-accent,#5ab0ff); }

    /* ── Footer ── */
    .pd-footer { padding:8px 14px;border-top:1px solid var(--cad-border,#3a3f4b);display:flex;align-items:center;justify-content:space-between;background:var(--cad-bg-panel,#191c22);flex-shrink:0;border-radius:0 0 6px 6px; }
    .pd-footer-left { display:flex;align-items:center;gap:10px; }
    .pd-footer-hint { font-size:9.5px;color:var(--cad-text-dim,#888);letter-spacing:.3px; }
    .pd-footer-actions { display:flex;gap:6px;align-items:center; }
  `],
})
export class PlotDialogComponent implements AfterViewInit, OnDestroy {
  @ViewChild('previewCanvas') previewCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewWrap')   previewWrap!: ElementRef<HTMLDivElement>;

  readonly svc              = inject(PlotDialogService);
  readonly windowPickService = inject(PlotWindowPickService);
  private readonly exportMgr = inject(ExportManagerService);
  private readonly renderer  = inject(PlotRendererService);
  private readonly toolMgr   = inject(ToolManagerService);
  private readonly notify    = inject(NotificationService);

  opts: IPlotOptions;
  customW = 210;
  customH = 297;
  customScalePaper = 1;
  customScaleWorld = 100;
  newSetupName = '';

  readonly qualityPresets    = QUALITY_PRESETS;
  readonly resolutionPresets = RESOLUTION_PRESETS;
  readonly paperCategories: PaperCategory[] = ['ISO', 'ANSI', 'ARCH', 'Engineering', 'Other'];
  readonly plotStyleRegistry = PLOT_STYLE_REGISTRY;

  /** Plotter groups for the device selector optgroups. */
  readonly plotterGroups = [
    { label: 'PDF Plotters', devices: PLOTTER_REGISTRY.filter(d => d.outputType === 'pdf') },
    { label: 'Vector',       devices: PLOTTER_REGISTRY.filter(d => d.outputType === 'svg') },
    { label: 'Raster',       devices: PLOTTER_REGISTRY.filter(d => ['png','jpg'].includes(d.outputType)) },
    { label: 'CAD Exchange', devices: PLOTTER_REGISTRY.filter(d => ['dxf','dwg'].includes(d.outputType)) },
    { label: 'System',       devices: PLOTTER_REGISTRY.filter(d => d.outputType === 'browser') },
  ];

  /** Scale groups for the scale selector optgroups. */
  readonly scaleGroups = [
    { label: 'Fit',      scales: SCALE_REGISTRY.filter(s => s.category === 'Fit') },
    { label: 'Metric',   scales: SCALE_REGISTRY.filter(s => s.category === 'Metric') },
    { label: 'Imperial', scales: SCALE_REGISTRY.filter(s => s.category === 'Imperial') },
    { label: 'Custom',   scales: SCALE_REGISTRY.filter(s => s.category === 'Custom') },
  ];

  /** Quick setup templates. */
  readonly quickSetups = [
    { label: 'A1 Landscape PDF',   plotterKey: 'DWGToPDF',    paper: 'A1',  orientation: 'landscape', scale: 'fit' as const, plotStyleKey: 'acad_color' },
    { label: 'A3 Mono Print',      plotterKey: 'DWGToPDF',    paper: 'A3',  orientation: 'landscape', scale: 'fit' as const, plotStyleKey: 'monochrome' },
    { label: 'A4 Portrait',        plotterKey: 'DWGToPDF',    paper: 'A4',  orientation: 'portrait',  scale: 'fit' as const, plotStyleKey: 'acad_color' },
    { label: 'ANSI D Sheet',       plotterKey: 'DWGToPDF',    paper: 'ANSI_D', orientation: 'landscape', scale: 'fit' as const, plotStyleKey: 'acad_color' },
    { label: 'PNG 4K Export',      plotterKey: 'PNGPlotter',  paper: 'A3',  orientation: 'landscape', scale: 'fit' as const, plotStyleKey: 'acad_color' },
    { label: 'DXF Exchange',       plotterKey: 'DXFExport',   paper: 'A4',  orientation: 'landscape', scale: 'fit' as const, plotStyleKey: 'acad_color' },
  ];

  previewHasContent = true;

  readonly geomInfo = computed(() => {
    void this.svc.options();
    const geom = this.renderer.computeGeometry(this.opts, 96);
    if (!geom) return null;
    const worldW = geom.world.maxX - geom.world.minX;
    const worldH = geom.world.maxY - geom.world.minY;
    const printW = Math.max(1, geom.paperMm.w - 2 * this.opts.margin);
    const printH = Math.max(1, geom.paperMm.h - 2 * this.opts.margin);
    const usedW = worldW / geom.worldPerMm;
    const usedH = worldH / geom.worldPerMm;
    const utilPct = Math.min(100, (usedW * usedH) / (printW * printH) * 100);
    return { paperW: geom.paperMm.w, paperH: geom.paperMm.h, ratio: geom.worldPerMm, worldW, worldH, utilPct };
  });

  readonly pageSetupCount = computed(() => this.svc.pageSetups().length);

  expandedSections = {
    setup: false,
    plotter: true,
    paper: true,
    area: true,
    scale: true,
    style: false,
    advanced: false
  };

  toggleSection(section: 'setup' | 'plotter' | 'paper' | 'area' | 'scale' | 'style' | 'advanced'): void {
    this.expandedSections[section] = !this.expandedSections[section];
  }

  constructor() {
    this.opts = this.svc.options();
    // Expose plotter registry globally for the service's computed label.
    (window as any).__plotRegistry = PLOTTER_REGISTRY;

    effect(() => {
      if (this.svc.isOpen()) {
        this.opts = { ...this.svc.options() };
        // Ensure new fields have defaults if loading from old saved options.
        if (!this.opts.plotterKey) this.opts.plotterKey = 'DWGToPDF';
        if (!this.opts.plotOffset) this.opts.plotOffset = defaultPlotOffset();
        if (!this.opts.pdfOptions) this.opts.pdfOptions = { preserveVectors: true, searchableText: true, embedFonts: true, exportLayers: false, compressionLevel: 2 };
        if (!this.opts.rasterOptions) this.opts.rasterOptions = { antiAlias: 'high', colorDepth: '24bit', pngCompression: 'balanced', jpgQuality: 0.92 };
        if (!this.opts.plotStyleKey) this.opts.plotStyleKey = 'acad_color';
        if (!this.opts.paperUnits) this.opts.paperUnits = 'mm';
        if (this.opts.scaleLineweights === undefined) this.opts.scaleLineweights = true;

        this.customW = this.opts.customPaperMm?.w ?? 210;
        this.customH = this.opts.customPaperMm?.h ?? 297;
        if (typeof this.opts.scale === 'number') {
          this.customScaleWorld = this.opts.scale;
          this.customScalePaper = 1;
        }
        queueMicrotask(() => this.drawPreview());
      }
    });
  }

  ngAfterViewInit(): void { if (this.svc.isOpen()) this.drawPreview(); }
  ngOnDestroy(): void {}

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if (!this.svc.isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancel(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.commit(); }
  }

  // ── State helpers ────────────────────────────────────────────────────────

  isExchange(): boolean { return this.opts.format === 'dxf' || this.opts.format === 'dwg'; }
  isRaster():   boolean { return (RASTER_FORMATS as ReadonlyArray<PlotFormat>).includes(this.opts.format); }
  isVector():   boolean { return (VECTOR_FORMATS as ReadonlyArray<PlotFormat>).includes(this.opts.format); }
  isBrowser():  boolean { return this.opts.format === 'browser'; }

  headerTitle(): string {
    if (this.isExchange()) return 'Export — Model Exchange';
    if (this.isBrowser()) return 'Print — System Printer';
    return 'Plot — ' + (this.opts.plotterKey ?? 'Model');
  }

  actionVerb(): string {
    if (this.opts.format === 'pdf' || this.opts.format === 'browser') return 'Plot to PDF';
    if (this.opts.format === 'svg') return 'Export SVG';
    if (this.opts.format === 'dxf') return 'Export DXF';
    if (this.opts.format === 'dwg') return 'Export DWG';
    return 'Export ' + this.opts.format.toUpperCase();
  }

  formatBadge(): string {
    const meta = FORMAT_META[this.opts.format];
    return meta ? (meta.vector ? 'VECTOR' : 'RASTER') : '';
  }

  setTab(tab: PlotDialogTab): void { this.svc.setTab(tab); }

  // ── Plotter / Device ─────────────────────────────────────────────────────

  plotterDisplayName(): string {
    return PLOTTER_REGISTRY.find(d => d.key === this.opts.plotterKey)?.name ?? this.opts.plotterKey;
  }

  plotterDescription(): string {
    return PLOTTER_REGISTRY.find(d => d.key === this.opts.plotterKey)?.description ?? '';
  }

  onPlotterChange(): void {
    const dev = PLOTTER_REGISTRY.find(d => d.key === this.opts.plotterKey);
    if (!dev) return;
    // Set the format from the device.
    if (dev.format !== 'browser') {
      this.opts.format = dev.format as PlotFormat;
    }
    // Fix background if device doesn't support transparency.
    if (!dev.supportsTransparency && this.opts.background === 'transparent') {
      this.opts.background = 'white';
    }
    this.touch();
  }

  // ── Paper ────────────────────────────────────────────────────────────────

  papersByCategory(cat: PaperCategory) {
    return PAPER_REGISTRY.filter(p => p.category === cat);
  }

  formatPaperSize(p: { wMm: number; hMm: number }): string {
    if (this.opts.paperUnits === 'inches') {
      return `${(p.wMm / 25.4).toFixed(1)}" × ${(p.hMm / 25.4).toFixed(1)}"`;
    }
    return `${p.wMm} × ${p.hMm} mm`;
  }

  setPaperUnits(u: 'mm' | 'inches'): void {
    this.opts.paperUnits = u;
    this.touch();
  }

  currentPaperDims(): { w: number; h: number; pw: number; ph: number } | null {
    const p = this.opts.paper === 'Custom'
      ? this.opts.customPaperMm ?? { w: 210, h: 297 }
      : (getPaperByKey(this.opts.paper) ? { w: getPaperByKey(this.opts.paper)!.wMm, h: getPaperByKey(this.opts.paper)!.hMm } : null);
    if (!p) return null;
    const landscape = this.opts.orientation === 'landscape';
    const rawW = landscape ? Math.max(p.w, p.h) : Math.min(p.w, p.h);
    const rawH = landscape ? Math.min(p.w, p.h) : Math.max(p.w, p.h);
    const m = this.opts.margin ?? 10;
    const div = this.opts.paperUnits === 'inches' ? 25.4 : 1;
    return { w: rawW / div, h: rawH / div, pw: Math.max(0, rawW - 2*m) / div, ph: Math.max(0, rawH - 2*m) / div };
  }

  paperLabel(): string {
    if (this.opts.paper === 'Custom') return 'Custom';
    return getPaperByKey(this.opts.paper)?.label ?? this.opts.paper;
  }

  onCustomPaperChange(): void {
    const div = this.opts.paperUnits === 'inches' ? 25.4 : 1;
    this.opts.customPaperMm = { w: this.customW * div, h: this.customH * div };
    this.touch();
  }

  // ── Scale ────────────────────────────────────────────────────────────────

  scaleKey(): string {
    if (this.opts.scale === 'fit') return 'Fit to Page';
    if (typeof this.opts.scale === 'number') {
      const m = SCALE_REGISTRY.find(s => typeof s.value === 'number' && Math.abs((s.value as number) - (this.opts.scale as number)) < 0.001);
      return m ? m.label : 'Custom…';
    }
    return 'Fit to Page';
  }

  onScalePreset(label: string): void {
    const entry = SCALE_REGISTRY.find(s => s.label === label);
    if (!entry) return;
    if (entry.value === 'fit') { this.opts.scale = 'fit'; }
    else if (entry.value === null) { /* custom — keep current numeric scale */ }
    else { this.opts.scale = entry.value as number; }
    this.touch();
  }

  onCustomScaleChange(): void {
    const ratio = this.customScaleWorld / Math.max(0.001, this.customScalePaper);
    if (Number.isFinite(ratio) && ratio > 0) {
      this.opts.scale = ratio;
      this.touch();
    }
  }

  // ── Plot Offset ───────────────────────────────────────────────────────────

  onCenterPlotChange(): void {
    this.opts.centerDrawing = this.opts.plotOffset.center;
    this.touch();
  }

  // ── Plot Style ────────────────────────────────────────────────────────────

  plotStyleDescription(): string {
    return PLOT_STYLE_REGISTRY.find(s => s.key === this.opts.plotStyleKey)?.description ?? '';
  }

  plotStyleShortName(): string {
    return PLOT_STYLE_REGISTRY.find(s => s.key === this.opts.plotStyleKey)?.filename ?? this.opts.plotStyleKey;
  }

  onPlotStyleChange(): void {
    const style = PLOT_STYLE_REGISTRY.find(s => s.key === this.opts.plotStyleKey);
    if (style) this.opts.plotStyle = style.colorMode;
    this.touch();
  }

  // ── Resolution / Quality ─────────────────────────────────────────────────

  resolutionKey(): string {
    const px = this.opts.rasterLongEdgePx ?? null;
    return (RESOLUTION_PRESETS.find(r => r.longEdgePx === px) ?? RESOLUTION_PRESETS[0]).label;
  }

  onResolutionPreset(label: string): void {
    const p = RESOLUTION_PRESETS.find(r => r.label === label);
    this.opts.rasterLongEdgePx = p?.longEdgePx ?? undefined;
    this.touch();
  }

  // ── Page Setups ───────────────────────────────────────────────────────────

  saveSetup(): void {
    const name = this.newSetupName.trim();
    if (!name) return;
    this.svc.savePageSetup(name);
    this.newSetupName = '';
  }

  loadSetup(name: string): void {
    this.svc.loadPageSetup(name);
    this.opts = { ...this.svc.options() };
    this.touch();
  }

  deleteSetup(name: string): void { this.svc.deletePageSetup(name); }

  applyQuickSetup(q: typeof this.quickSetups[0]): void {
    this.opts.plotterKey = q.plotterKey;
    this.opts.paper = q.paper;
    this.opts.orientation = q.orientation as any;
    this.opts.scale = q.scale;
    this.opts.plotStyleKey = q.plotStyleKey;
    const dev = PLOTTER_REGISTRY.find(d => d.key === q.plotterKey);
    if (dev) this.opts.format = dev.format as PlotFormat;
    this.touch();
  }

  formatDate(iso: string): string {
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return iso; }
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  formatScale(ratio: number): string {
    if (!Number.isFinite(ratio) || ratio <= 0) return '---';
    if (ratio < 1) return '1:' + (1 / ratio).toFixed(2);
    if (Math.abs(ratio - 1) < 0.0001) return '1:1';
    return '1:' + (ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(2));
  }

  resetToDefaults(): void {
    this.opts = defaultPlotOptions();
    this.touch();
  }

  pickWindow(): void {
    this.svc.isOpen.set(false);
    this.windowPickService.startPicking((bounds) => {
      if (bounds) {
        this.opts.windowBounds = bounds;
        this.touch();
      }
      this.svc.isOpen.set(true);
    });
    this.toolMgr.setTool('plot_window');
  }

  touch(): void {
    this.svc.options.set({ ...this.opts });
    queueMicrotask(() => this.drawPreview());
  }

  commit(): void {
    this.svc.options.set({ ...this.opts });
    if (this.isBrowser()) { this.exportMgr.browserPrint(this.opts); return; }
    const ok = this.exportMgr.plot(this.opts);
    if (ok) {
      this.svc.close();
    }
  }

  cancel(): void { this.svc.close(); }
  onOverlayClick(_e: MouseEvent): void { this.cancel(); }

  onBrowserPrint(): void { if (!this.isExchange()) this.exportMgr.browserPrint(this.opts); }

  onPreviewFull(): void {
    const out = this.renderer.renderToCanvas(this.opts, 150);
    if (!out) return;
    const dataUrl = out.canvas.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (!win) return;

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Plot Preview - ${this.opts.format.toUpperCase()} (${this.opts.paper})</title>
  <style>
    body { margin: 0; padding: 20px; background: #101215; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: sans-serif; color: #fff; box-sizing: border-box; }
    .header { margin-bottom: 12px; font-size: 13px; color: #8a99a8; display: flex; gap: 20px; background: #1a1e24; padding: 8px 16px; border-radius: 6px; }
    .preview-box { box-shadow: 0 12px 40px rgba(0,0,0,0.8); border-radius: 4px; overflow: hidden; background: #fff; max-width: 96vw; max-height: 88vh; }
    img { display: block; max-width: 100%; max-height: 88vh; object-fit: contain; }
  </style>
</head>
<body>
  <div class="header">
    <span>Format: <strong>${this.opts.format.toUpperCase()}</strong></span>
    <span>Paper: <strong>${this.opts.paper}</strong></span>
    <span>Scale: <strong>${this.opts.scale === 'fit' ? 'Fit to paper' : '1:' + this.opts.scale}</strong></span>
    <span>Quality: <strong>150 DPI (Fast & Crisp)</strong></span>
  </div>
  <div class="preview-box">
    <img src="${dataUrl}" alt="High-Res Plot Preview" />
  </div>
</body>
</html>`);
    win.document.close();
  }

  zoomPreviewFit(): void { this.drawPreview(); }

  // ── Preview Rendering ─────────────────────────────────────────────────────

  private drawPreview(): void {
    const canvas = this.previewCanvas?.nativeElement;
    const wrap   = this.previewWrap?.nativeElement;
    if (!canvas || !wrap) return;

    if (this.isExchange()) {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = 420; canvas.height = 280;
      ctx.fillStyle = '#13161d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#3a3f4b'; ctx.fillRect(40, 30, canvas.width - 80, canvas.height - 60);
      ctx.fillStyle = '#5ab0ff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(this.opts.format.toUpperCase() + ' Export', canvas.width / 2, canvas.height / 2 - 16);
      ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
      ctx.fillText('Full model export — no sheet layout', canvas.width / 2, canvas.height / 2 + 4);
      if (this.opts.format === 'dxf') {
        ctx.fillText('Version: ' + (this.opts.dxfVersion || 'R2000'), canvas.width / 2, canvas.height / 2 + 22);
      }
      this.previewHasContent = true;
      return;
    }

    const out = this.renderer.renderToCanvas(this.opts, 96);
    if (!out) {
      this.previewHasContent = false;
      canvas.width = 420; canvas.height = 280;
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.fillStyle = '#13161d'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    this.previewHasContent = true;

    const wrapRect = wrap.getBoundingClientRect();
    const maxW = Math.max(100, wrapRect.width - 40);
    const maxH = Math.max(80,  wrapRect.height - 40);
    const aspect = out.canvas.width / out.canvas.height;
    let dispW = maxW, dispH = maxW / aspect;
    if (dispH > maxH) { dispH = maxH; dispW = maxH * aspect; }

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);
    canvas.style.width  = dispW + 'px';
    canvas.style.height = dispH + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(out.canvas, 0, 0, canvas.width, canvas.height);
    this.drawPreviewOverlay(ctx, canvas.width, canvas.height, out.geom.paperMm);
  }

  private drawPreviewOverlay(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    paperMm: { w: number; h: number },
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const lw  = Math.max(1, dpr);
    ctx.save();

    // 1. Page boundary
    ctx.lineWidth = lw * 1.5;
    ctx.strokeStyle = 'rgba(120,140,170,0.9)';
    ctx.setLineDash([]);
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    // 2. Printable area (margins)
    const fracW = paperMm.w > 0 ? this.opts.margin / paperMm.w : 0;
    const fracH = paperMm.h > 0 ? this.opts.margin / paperMm.h : 0;
    const ix = fracW * w, iy = fracH * h;
    if (ix > 0 || iy > 0) {
      ctx.strokeStyle = 'rgba(80,160,255,0.7)';
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.lineWidth = lw;
      ctx.strokeRect(ix, iy, w - 2 * ix, h - 2 * iy);
    }

    // 3. Drawing extents box (fit mode)
    if (this.opts.scale === 'fit') {
      ctx.strokeStyle = 'rgba(255,160,60,0.4)';
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.strokeRect(ix + 1, iy + 1, w - 2 * ix - 2, h - 2 * iy - 2);
    }

    // 4. Plot offset indicator (when not centered)
    if (!this.opts.plotOffset?.center && (this.opts.plotOffset?.x || this.opts.plotOffset?.y)) {
      const ox = (this.opts.plotOffset.x / (paperMm.w || 1)) * w;
      const oy = (this.opts.plotOffset.y / (paperMm.h || 1)) * h;
      ctx.strokeStyle = 'rgba(255,200,0,0.7)';
      ctx.setLineDash([]);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(ix + ox - 5*dpr, iy + oy);
      ctx.lineTo(ix + ox + 5*dpr, iy + oy);
      ctx.moveTo(ix + ox, iy + oy - 5*dpr);
      ctx.lineTo(ix + ox, iy + oy + 5*dpr);
      ctx.stroke();
    }

    // 5. Centre crosshair
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.025;
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,70,70,0.6)';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // 6. Corner registration marks
    const mk = 7 * dpr;
    ctx.strokeStyle = 'rgba(120,140,170,0.55)';
    ctx.lineWidth = lw;
    for (const [mx, my] of [[0,0],[w,0],[0,h],[w,h]] as [number,number][]) {
      const sx = mx === 0 ? 1 : -1, sy = my === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(mx + sx * 1.5, my + sy * mk); ctx.lineTo(mx + sx * 1.5, my + sy * 1.5);
      ctx.lineTo(mx + sx * mk, my + sy * 1.5); ctx.stroke();
    }

    // 7. Scale label
    const g = this.geomInfo();
    if (g) {
      const label = this.paperLabel() + ' · ' + this.formatScale(g.ratio);
      ctx.fillStyle = 'rgba(90,176,255,0.85)';
      ctx.font = `bold ${10 * dpr}px 'Segoe UI',sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(label, w - 6, h - 5);
    }

    ctx.restore();
  }
}
