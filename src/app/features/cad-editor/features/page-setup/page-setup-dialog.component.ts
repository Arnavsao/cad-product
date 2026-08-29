import { CommonModule } from '@angular/common';
/**
 * Page Setup Dialog
 *
 * AutoCAD-style Page Setup — configures paper size, orientation, scale,
 * margins, plot style, and DPI for the currently active Layout.
 *
 * Opened by:
 *   - Typing PAGESETUP at the command line
 *   - Right-clicking a layout tab → Page Setup...
 *   - Via PageSetupDialogService.open(layoutId)
 */
import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageSetupDialogService } from './page-setup-dialog.service';
import { LayoutManagerService } from '../../core/services/layout-manager.service';
import {
  getPaperSizeMm,
  SCALE_PRESETS,
  QUALITY_PRESETS,
  type PlotPaper,
  type PlotOrientation,
  type PlotScale,
  type PlotStyle,
} from '../../core/models/plot-options.model';
import type { IPageSetup } from '../../core/models/layout.model';
import { defaultPageSetup } from '../../core/models/layout.model';
import { PAPER_REGISTRY } from '../../core/models/plot-registry.model';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-page-setup-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (dialogSvc.isOpen()) {
      <div class="ps-overlay" (click)="onOverlayClick($event)">
        <div class="ps-dialog" role="dialog" aria-modal="true" aria-label="Page Setup">

          <!-- Header -->
          <div class="ps-header">
            <span class="ps-icon">📐</span>
            <span class="ps-title">Page Setup — {{ layoutName() }}</span>
            <button class="ps-close" type="button" (click)="cancel()" aria-label="Close">✕</button>
          </div>

          <!-- Body -->
          <div class="ps-body">

            <!-- Paper size -->
            <div class="ps-row">
              <label class="ps-label">Paper Size</label>
              <select class="ps-select" [(ngModel)]="form.paper" (ngModelChange)="onPaperChange()">
                @for (p of papers; track p.key) {
                  <option [value]="p.key">{{ p.label }}</option>
                }
              </select>
            </div>

            <!-- Custom paper dimensions -->
            @if (form.paper === 'Custom') {
              <div class="ps-row ps-row-double">
                <label class="ps-label">Width (mm)</label>
                <input class="ps-input" type="number" [(ngModel)]="form.customPaperMm!.w" min="10" max="5000" step="1"/>
                <label class="ps-label">Height (mm)</label>
                <input class="ps-input" type="number" [(ngModel)]="form.customPaperMm!.h" min="10" max="5000" step="1"/>
              </div>
            }

            <!-- Orientation -->
            <div class="ps-row">
              <label class="ps-label">Orientation</label>
              <div class="ps-toggle-group">
                <button
                  type="button"
                  class="ps-toggle"
                  [class.active]="form.orientation === 'portrait'"
                  (click)="form.orientation = 'portrait'"
                >⬆ Portrait</button>
                <button
                  type="button"
                  class="ps-toggle"
                  [class.active]="form.orientation === 'landscape'"
                  (click)="form.orientation = 'landscape'"
                >➡ Landscape</button>
              </div>
            </div>

            <!-- Resolved paper size preview -->
            <div class="ps-size-preview">
              {{ resolvedMm().w | number:'1.0-0' }} × {{ resolvedMm().h | number:'1.0-0' }} mm
              <span class="ps-size-note">({{ resolvedIn().w | number:'1.1-2' }}" × {{ resolvedIn().h | number:'1.1-2' }}")</span>
            </div>

            <div class="ps-divider"></div>

            <!-- Scale -->
            <div class="ps-row">
              <label class="ps-label">Plot Scale</label>
              <select class="ps-select" [(ngModel)]="scaleLabel" (ngModelChange)="onScaleLabelChange($event)">
                <option value="fit">Fit to page</option>
                @for (s of scalePresets; track s.label) {
                  <option [value]="s.label">{{ s.label }}</option>
                }
                <option value="custom">Custom…</option>
              </select>
            </div>

            @if (scaleLabel === 'custom') {
              <div class="ps-row">
                <label class="ps-label">World / mm</label>
                <input class="ps-input ps-input-sm" type="number" [(ngModel)]="customScaleValue" min="0.001" max="100000" step="0.001"/>
              </div>
            }

            <div class="ps-divider"></div>

            <!-- Margins -->
            <div class="ps-row ps-row-label-top">
              <label class="ps-label">Margins (mm)</label>
              <div class="ps-margin-grid">
                <span></span>
                <div class="ps-margin-item">
                  <label>Top</label>
                  <input class="ps-input ps-input-xs" type="number" [(ngModel)]="form.margins.top" min="0" max="100" step="1"/>
                </div>
                <span></span>
                <div class="ps-margin-item">
                  <label>Left</label>
                  <input class="ps-input ps-input-xs" type="number" [(ngModel)]="form.margins.left" min="0" max="100" step="1"/>
                </div>
                <div class="ps-margin-item">
                  <label style="color:#555">—</label>
                  <div class="ps-margin-paper">
                    <span>{{ form.paper }}</span>
                  </div>
                </div>
                <div class="ps-margin-item">
                  <label>Right</label>
                  <input class="ps-input ps-input-xs" type="number" [(ngModel)]="form.margins.right" min="0" max="100" step="1"/>
                </div>
                <span></span>
                <div class="ps-margin-item">
                  <label>Bottom</label>
                  <input class="ps-input ps-input-xs" type="number" [(ngModel)]="form.margins.bottom" min="0" max="100" step="1"/>
                </div>
                <span></span>
              </div>
            </div>

            <div class="ps-divider"></div>

            <!-- Plot style -->
            <div class="ps-row">
              <label class="ps-label">Plot Style</label>
              <select class="ps-select" [(ngModel)]="form.plotStyle">
                <option value="color">Color</option>
                <option value="monochrome">Monochrome</option>
                <option value="grayscale">Grayscale</option>
              </select>
            </div>

            <!-- DPI -->
            <div class="ps-row">
              <label class="ps-label">Resolution</label>
              <select class="ps-select" [(ngModel)]="form.dpi">
                @for (q of qualityPresets; track q.label) {
                  <option [value]="q.dpi">{{ q.label }}</option>
                }
              </select>
            </div>

            <div class="ps-divider"></div>

            <!-- Save as named preset -->
            <div class="ps-row">
              <label class="ps-label">Setup Name</label>
              <input
                class="ps-input ps-input-flex"
                type="text"
                [(ngModel)]="setupName"
                placeholder="(optional) Save as named setup"
                maxlength="64"
              />
            </div>

          </div>

          <!-- Footer -->
          <div class="ps-footer">
            <button class="ps-btn ps-btn-ghost" type="button" (click)="cancel()">Cancel</button>
            @if (setupName.trim()) {
              <button class="ps-btn ps-btn-secondary" type="button" (click)="savePreset()">Save Preset</button>
            }
            <button class="ps-btn ps-btn-primary" type="button" (click)="apply()">Apply</button>
          </div>

        </div>
      </div>
    }
  `,
  styles: [`
    .ps-overlay {
      position: fixed; inset: 0; z-index: 5000;
      background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
    }
    .ps-dialog {
      width: 480px; max-height: 90vh;
      background: #1e1e22;
      border: 1px solid #3a3a3d;
      border-radius: 10px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.7);
      display: flex; flex-direction: column;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      color: #c0c0c4;
      overflow: hidden;
    }
    .ps-header {
      display: flex; align-items: center; gap: 8px;
      padding: 14px 18px;
      border-bottom: 1px solid #2d2d30;
      background: #252528;
      flex-shrink: 0;
    }
    .ps-icon { font-size: 16px; }
    .ps-title { flex: 1; font-size: 13px; font-weight: 600; color: #e0e0e4; }
    .ps-close {
      background: none; border: none; color: #888; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px;
      &:hover { background: #3a3a3d; color: #e0e0e4; }
    }
    .ps-body { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
    .ps-divider { height: 1px; background: #2d2d30; margin: 4px 0; }
    .ps-row { display: flex; align-items: center; gap: 10px; min-height: 28px; }
    .ps-row-double { flex-wrap: wrap; }
    .ps-row-label-top { align-items: flex-start; }
    .ps-label { flex-shrink: 0; width: 110px; font-size: 11px; color: #888; }
    .ps-select {
      flex: 1; background: #2a2a2e; border: 1px solid #3a3a3d; border-radius: 5px;
      color: #c8c8cc; font-size: 11px; padding: 4px 8px; outline: none;
      &:focus { border-color: #499bea; }
    }
    .ps-input {
      background: #2a2a2e; border: 1px solid #3a3a3d; border-radius: 5px;
      color: #c8c8cc; font-size: 11px; padding: 4px 8px; outline: none;
      &:focus { border-color: #499bea; }
    }
    .ps-input-sm  { width: 80px; }
    .ps-input-xs  { width: 52px; text-align: center; }
    .ps-input-flex { flex: 1; }
    .ps-toggle-group { display: flex; gap: 4px; }
    .ps-toggle {
      padding: 4px 12px; background: #2a2a2e; border: 1px solid #3a3a3d;
      border-radius: 5px; color: #888; font-size: 11px; cursor: pointer;
      &.active { background: #499bea20; border-color: #499bea; color: #499bea; }
      &:hover:not(.active) { background: #333337; }
    }
    .ps-size-preview {
      font-size: 12px; color: #aaa; text-align: center;
      background: #252528; border-radius: 5px; padding: 6px; margin: 0 0 2px;
    }
    .ps-size-note { font-size: 10px; color: #666; }
    .ps-margin-grid {
      display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; align-items: center;
    }
    .ps-margin-item { display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .ps-margin-item label { font-size: 9px; color: #666; }
    .ps-margin-paper {
      width: 48px; height: 36px; background: #2a2a2e; border: 1px solid #3a3a3d;
      border-radius: 2px; display: flex; align-items: center; justify-content: center;
      font-size: 8px; color: #555;
    }
    .ps-footer {
      display: flex; justify-content: flex-end; align-items: center; gap: 8px;
      padding: 12px 18px; border-top: 1px solid #2d2d30; flex-shrink: 0;
    }
    .ps-btn {
      padding: 6px 16px; border-radius: 6px; border: none; font-size: 12px;
      cursor: pointer; font-family: inherit;
    }
    .ps-btn-ghost   { background: transparent; color: #888; &:hover { color: #c8c8cc; } }
    .ps-btn-secondary { background: #2a2a2e; border: 1px solid #3a3a3d; color: #c8c8cc; &:hover { border-color: #499bea; } }
    .ps-btn-primary  { background: #499bea; color: #fff; font-weight: 600; &:hover { background: #5aaaf5; } }
  `],
})
export class PageSetupDialogComponent implements OnInit {
  protected dialogSvc   = inject(PageSetupDialogService);
  protected layoutMgr   = inject(LayoutManagerService);

  // ── Data ──────────────────────────────────────────────────────────────────

  readonly papers = [
    ...PAPER_REGISTRY.map(p => ({
      key: p.key,
      label: `${p.key} (${p.wMm}×${p.hMm} mm)`,
    })),
    { key: 'Custom', label: 'Custom…' }
  ];

  readonly scalePresets = [
    { label: '1:1',    worldPerMm: 1     },
    { label: '1:2',    worldPerMm: 2     },
    { label: '1:5',    worldPerMm: 5     },
    { label: '1:10',   worldPerMm: 10    },
    { label: '1:20',   worldPerMm: 20    },
    { label: '1:50',   worldPerMm: 50    },
    { label: '1:100',  worldPerMm: 100   },
    { label: '1:200',  worldPerMm: 200   },
    { label: '1:500',  worldPerMm: 500   },
    { label: '1:1000', worldPerMm: 1000  },
    { label: '2:1',    worldPerMm: 0.5   },
    { label: '5:1',    worldPerMm: 0.2   },
  ];

  readonly qualityPresets = [
    { label: 'Screen (96 DPI)',    dpi: 96  },
    { label: 'Standard (150 DPI)', dpi: 150 },
    { label: 'Print (300 DPI)',    dpi: 300 },
    { label: 'High (600 DPI)',     dpi: 600 },
  ];

  // Form state — edited locally, committed on Apply.
  form: IPageSetup = defaultPageSetup();
  setupName = '';
  scaleLabel = 'fit';
  customScaleValue = 100;

  readonly layoutName = computed(() => {
    const id = this.dialogSvc.targetLayoutId();
    return this.layoutMgr.layouts().find((l) => l.id === id)?.name ?? 'Layout';
  });

  readonly resolvedMm = computed(() => {
    const mm = getPaperSizeMm(this.form.paper, this.form.customPaperMm);
    if (this.form.orientation === 'landscape') {
      return { w: Math.max(mm.w, mm.h), h: Math.min(mm.w, mm.h) };
    }
    return { w: Math.min(mm.w, mm.h), h: Math.max(mm.w, mm.h) };
  });

  readonly resolvedIn = computed(() => ({
    w: this.resolvedMm().w / 25.4,
    h: this.resolvedMm().h / 25.4,
  }));

  ngOnInit(): void {
    // Watch for dialog open and load the layout's current settings.
    // Angular signals don't have a native effect here without injection context,
    // so we read on getter.
  }

  // ── Initialise form from the target layout ────────────────────────────────

  get currentForm(): IPageSetup {
    const id = this.dialogSvc.targetLayoutId();
    const layout = this.layoutMgr.layouts().find((l) => l.id === id);
    return layout?.pageSetup ?? defaultPageSetup();
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  onPaperChange(): void {
    if (this.form.paper === 'Custom' && !this.form.customPaperMm) {
      this.form.customPaperMm = { w: 420, h: 297 };
    }
  }

  onScaleLabelChange(label: string): void {
    this.scaleLabel = label;
    if (label === 'fit') {
      this.form.scale = 'fit';
    } else if (label === 'custom') {
      this.form.scale = this.customScaleValue;
    } else {
      const preset = this.scalePresets.find((s) => s.label === label);
      if (preset) this.form.scale = preset.worldPerMm;
    }
  }

  apply(): void {
    const id = this.dialogSvc.targetLayoutId();
    if (id) {
      const setup: IPageSetup = {
        ...this.form,
        margins: { ...this.form.margins },
        customPaperMm: this.form.customPaperMm ? { ...this.form.customPaperMm } : undefined,
      };
      if (this.setupName.trim()) setup.name = this.setupName.trim();
      this.layoutMgr.applyPageSetup(id, setup);
    }
    this.dialogSvc.close();
  }

  savePreset(): void {
    const setup: IPageSetup = {
      ...this.form,
      name: this.setupName.trim() || undefined,
      margins: { ...this.form.margins },
    };
    this.layoutMgr.savePageSetup(setup);
    this.apply();
  }

  cancel(): void {
    this.dialogSvc.close();
  }

  onOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.cancel();
  }

  // Initialise form from current layout settings when dialog opens.
  protected get isOpen(): boolean {
    const open = this.dialogSvc.isOpen();
    if (open) {
      const id = this.dialogSvc.targetLayoutId();
      const layout = this.layoutMgr.layouts().find((l) => l.id === id);
      if (layout) {
        this.form = {
          ...layout.pageSetup,
          margins: { ...layout.pageSetup.margins },
          customPaperMm: layout.pageSetup.customPaperMm ? { ...layout.pageSetup.customPaperMm } : undefined,
        };
        this.setupName = layout.pageSetup.name ?? '';
        if (this.form.scale === 'fit') {
          this.scaleLabel = 'fit';
        } else if (typeof this.form.scale === 'number') {
          const preset = this.scalePresets.find((s) => s.worldPerMm === this.form.scale);
          this.scaleLabel = preset?.label ?? 'custom';
          if (!preset) this.customScaleValue = this.form.scale;
        }
      }
    }
    return open;
  }
}
