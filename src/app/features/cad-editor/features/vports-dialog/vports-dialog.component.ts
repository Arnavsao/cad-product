import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VportsDialogService } from './vports-dialog.service';
import {
  IViewportConfigPreset,
  VIEWPORT_CONFIG_PRESETS,
  ViewportConfigType
} from '../../core/models/viewport-config.model';
import { ModelViewportService } from '../../core/services/model-viewport.service';
import { LayoutManagerService } from '../../core/services/layout-manager.service';
import { ViewportManagerService } from '../../core/services/viewport-manager.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-vports-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './vports-dialog.component.html',
  styleUrls: ['./vports-dialog.component.scss']
})
export class VportsDialogComponent implements AfterViewInit {
  protected dialogSvc = inject(VportsDialogService);
  protected modelVps = inject(ModelViewportService);
  protected layoutMgr = inject(LayoutManagerService);
  protected paperVps = inject(ViewportManagerService);

  @ViewChild('previewCanvas') previewCanvasRef!: ElementRef<HTMLCanvasElement>;

  readonly activeTab = signal<'new' | 'named'>('new');
  readonly presets = VIEWPORT_CONFIG_PRESETS;
  readonly selectedPreset = signal<IViewportConfigPreset>(VIEWPORT_CONFIG_PRESETS[9]); // 'Four: Equal' default

  applyTo = 'Display';
  setup = '2D';
  changeViewTo = '*Current*';
  visualStyle = '2D Wireframe';

  ngAfterViewInit(): void {
    this.renderPreview();
  }

  selectPreset(preset: IViewportConfigPreset): void {
    this.selectedPreset.set(preset);
    this.renderPreview();
  }

  onOverlayClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('vports-overlay')) {
      this.close();
    }
  }

  close(): void {
    this.dialogSvc.close();
  }

  confirm(): void {
    const preset = this.selectedPreset();
    if (this.layoutMgr.isModelSpace()) {
      this.modelVps.applyConfig(preset.name);
    } else {
      // Apply to paper space viewports panel
      const name = preset.name;
      if (name.includes('Four')) this.paperVps.splitScreen('4');
      else if (name.includes('Two: Vertical')) this.paperVps.splitScreen('2-V');
      else if (name.includes('Two: Horizontal')) this.paperVps.splitScreen('2-H');
      else this.paperVps.splitScreen('1');
    }
    this.close();
  }

  renderPreview(): void {
    setTimeout(() => {
      const canvas = this.previewCanvasRef?.nativeElement;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = (canvas.width = canvas.parentElement?.clientWidth || 360);
      const h = (canvas.height = canvas.parentElement?.clientHeight || 200);

      // Background
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, w, h);

      const preset = this.selectedPreset();
      const gap = 3;

      for (let i = 0; i < preset.tiles.length; i++) {
        const t = preset.tiles[i];
        const tx = t.x * w + gap;
        const ty = t.y * h + gap;
        const tw = t.w * w - gap * 2;
        const th = t.h * h - gap * 2;

        // Tile fill
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(tx, ty, tw, th);

        // Tile border
        ctx.strokeStyle = i === 0 ? '#3b82f6' : '#475569';
        ctx.lineWidth = i === 0 ? 2 : 1;
        ctx.strokeRect(tx, ty, tw, th);

        // Tile text
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (tw > 60 && th > 30) {
          ctx.fillText(`View: *Current*`, tx + tw / 2, ty + th / 2 - 8);
          ctx.font = '10px Segoe UI, sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.fillText(this.visualStyle, tx + tw / 2, ty + th / 2 + 8);
        } else {
          ctx.fillText(t.label || 'Top', tx + tw / 2, ty + th / 2);
        }
      }
    }, 10);
  }
}
