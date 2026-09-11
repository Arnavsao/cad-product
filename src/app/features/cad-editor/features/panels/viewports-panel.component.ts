import { Component, computed, inject , ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { ViewportManagerService } from '../../core/services/viewport-manager.service';
import { ModelViewportService } from '../../core/services/model-viewport.service';
import { LayoutManagerService } from '../../core/services/layout-manager.service';
import { Viewport, VIEWPORT_SCALES, IViewportScale } from '../../core/models/viewport.model';
import { UiIconComponent } from '../../../../shared/ui/icon.component';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-viewports-panel',
  standalone: true,
  imports: [UiIconComponent, FormsModule, TranslocoDirective],
  template: `
    <div class="vp-panel" *transloco="let t">
      <div class="header-tools">
        <div class="split-presets">
          <span class="preset-label">{{ t('editor.ui.viewports.presetsLabel') }}</span>
          <button class="panel-btn" type="button" (click)="setSplit('1')" [title]="t('editor.ui.viewports.presetSingle')">1</button>
          <button class="panel-btn" type="button" (click)="setSplit('2-V')" [title]="t('editor.ui.viewports.presetTwoVertical')">2-V</button>
          <button class="panel-btn" type="button" (click)="setSplit('2-H')" [title]="t('editor.ui.viewports.presetTwoHorizontal')">2-H</button>
          <button class="panel-btn" type="button" (click)="setSplit('4')" [title]="t('editor.ui.viewports.presetFour')">4</button>
        </div>
        <button class="panel-btn primary-btn" type="button" (click)="newViewport()" [title]="t('editor.ui.viewports.newTooltip')">{{ t('editor.ui.viewports.new') }}</button>
      </div>
    
      @if (vps.version() !== null) {
        @for (vp of rows(); track trackVp($index, vp)) {
          <div class="vp-row" [class.active]="vp.active">
            <div class="vp-name-row">
              <button class="icon-btn" type="button" (click)="toggleActivate(vp)" [title]="vp.active ? t('editor.ui.viewports.deactivate') : t('editor.ui.viewports.activate')">{{ vp.active ? '●' : '○' }}</button>
              <button class="icon-btn" type="button" (click)="toggleVisible(vp)" [title]="vp.visible ? t('editor.ui.viewports.hide') : t('editor.ui.viewports.show')">{{ vp.visible ? '👁' : '∅' }}</button>
              <button class="icon-btn" type="button" (click)="toggleLock(vp)" [title]="vp.locked ? t('editor.ui.viewports.unlock') : t('editor.ui.viewports.lock')">@if (vp.locked) { <ui-icon name="lock" [size]="14" /> } @else { <ui-icon name="unlock" [size]="14" /> }</button>
              <input class="vp-name-input" type="text" [(ngModel)]="vp.name" (blur)="markDirty()" />
              <button class="icon-btn icon-del" type="button" (click)="remove(vp)" [title]="t('editor.ui.viewports.delete')"><ui-icon name="trash" [size]="14" /></button>
            </div>
            <div class="vp-meta">
              <span>{{ vp.w.toFixed(0) }} × {{ vp.h.toFixed(0) }} px</span>
              <span class="vp-zoom">{{ vp.camScale.toFixed(2) }}×</span>
            </div>
            <div class="vp-scales">
              <label>{{ t('editor.ui.viewports.scale') }}</label>
              <select [ngModel]="vp.scalePreset" (ngModelChange)="applyScale(vp, $event)">
                <option [ngValue]="null">{{ t('editor.ui.viewports.scaleFree') }}</option>
                @for (s of scales; track s) {
                  <option [ngValue]="s.label">{{ s.label }}</option>
                }
              </select>
            </div>
          </div>
        }
        @if (!rows().length) {
          <p class="empty">{{ t('editor.ui.viewports.empty', { button: t('editor.ui.viewports.new') }) }}</p>
        }
      }
    </div>
    `,
  styles: [`
    .vp-panel { display: flex; flex-direction: column; height: 100%; background: transparent; color: var(--cad-text-primary); font-size: 12px; overflow: auto; }
    .header-tools {
      display: flex; align-items: center; justify-content: space-between; gap: 6px;
      padding: 6px 10px; border-bottom: 1px solid var(--cad-border);
      background: var(--cad-bg-hover); flex-wrap: wrap;
    }
    .split-presets { display: flex; align-items: center; gap: 3px; }
    .preset-label { font-size: 10px; color: var(--cad-text-dim); margin-right: 2px; }
    .panel-btn {
      background: transparent; color: var(--cad-text-primary);
      border: 1px solid var(--cad-border); padding: 2px 6px;
      font-size: 11px; border-radius: 3px; cursor: pointer;
      &:hover { background: var(--cad-bg-hover); border-color: var(--cad-primary); }
      &.primary-btn { background: var(--cad-primary, #6366f1); color: #fff; border-color: var(--cad-primary, #6366f1); }
    }
    .vp-row {
      padding: 6px 10px;
      border-bottom: 1px solid var(--cad-border);
      &.active { background: var(--cad-accent-tint); }
    }
    .vp-name-row { display: grid; grid-template-columns: auto auto auto 1fr auto; gap: 4px; align-items: center; }
    .vp-name-input {
      background: transparent; color: var(--cad-text-primary);
      border: 1px solid transparent; padding: 1px 4px;
      font-size: 12px; border-radius: 3px; min-width: 0;
      &:hover, &:focus { border-color: var(--cad-border); background: var(--cad-bg-input); outline: none; }
    }
    .vp-meta {
      display: flex; justify-content: space-between;
      padding: 2px 4px 0;
      font-size: 10px; color: var(--cad-text-dim); font-variant-numeric: tabular-nums;
    }
    .vp-scales {
      display: flex; gap: 6px; align-items: center;
      padding: 4px 4px 0;
      label { font-size: 10px; color: var(--cad-text-dim); }
      select { background: var(--cad-bg-input); color: var(--cad-text-primary); border: 1px solid var(--cad-border); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
    }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 3px;
      background: transparent; color: var(--cad-text-secondary); border: none;
      cursor: pointer; padding: 0;
      &:hover { color: var(--cad-text-primary); }
      &.icon-del { color: var(--cad-red); }
    }
    .empty { padding: 20px 14px; text-align: center; color: var(--cad-text-dim); line-height: 1.5;
      kbd { background: var(--cad-bg-input); padding: 1px 4px; border-radius: 3px; border: 1px solid var(--cad-border); font-family: monospace; font-size: 11px; }
    }
  `],
})
export class ViewportsPanelComponent {
  protected vps = inject(ViewportManagerService);
  protected modelVps = inject(ModelViewportService);
  protected layoutMgr = inject(LayoutManagerService);
  private vm = inject(ViewModelService);
  private tools = inject(ToolManagerService);

  setSplit(type: '1' | '2-V' | '2-H' | '4'): void {
    if (this.layoutMgr.isModelSpace()) {
      if (type === '1') this.modelVps.applyConfig('Single');
      else if (type === '2-V') this.modelVps.applyConfig('Two: Vertical');
      else if (type === '2-H') this.modelVps.applyConfig('Two: Horizontal');
      else if (type === '4') this.modelVps.applyConfig('Four: Equal');
    } else {
      this.vps.splitScreen(type);
    }
  }

  scales = VIEWPORT_SCALES;

  rows = computed(() => {
    this.vps.version();
    return this.vps.viewports;
  });

  trackVp = (_i: number, vp: Viewport) => vp.id;

  newViewport(): void {
    this.tools.setTool('viewport');
  }

  toggleActivate(vp: Viewport): void {
    if (vp.active) this.vps.deactivateAll();
    else this.vps.activate(vp.id);
  }

  toggleVisible(vp: Viewport): void {
    vp.visible = !vp.visible;
    this.vm.markDirty();
    this.vps.bump();
  }

  toggleLock(vp: Viewport): void {
    vp.locked = !vp.locked;
    this.vps.bump();
  }

  remove(vp: Viewport): void {
    this.vps.remove(vp.id);
  }

  applyScale(vp: Viewport, label: string | null): void {
    if (!label) {
      vp.scalePreset = null;
      this.vm.markDirty();
      return;
    }
    const preset = this.scales.find((s) => s.label === label);
    if (preset) vp.applyScale(preset);
    this.vm.markDirty();
    this.vps.bump();
  }

  markDirty(): void {
    this.vps.bump();
  }
}
