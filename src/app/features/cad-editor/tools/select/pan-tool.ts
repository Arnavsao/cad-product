import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { ViewModelService } from '../../core/services/view-model.service';

/** Pan tool — supports left-click dragging to pan the viewport. */
export class PanTool implements ITool {
  readonly name = 'pan';
  private isPanning = false;
  private panStart = { sx: 0, sy: 0, px: 0, py: 0 };

  constructor(private injector: Injector) {}

  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return; // Left click only
    this.isPanning = true;
    this.panStart = { sx: e.clientX, sy: e.clientY, px: this.vm.panX, py: this.vm.panY };
    e.preventDefault();
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (!this.isPanning) return;
    this.vm.panX = this.panStart.px + (e.clientX - this.panStart.sx);
    this.vm.panY = this.panStart.py + (e.clientY - this.panStart.sy);
    this.vm.markDirty();
    this.vm.markGridDirty();
  }

  onMouseUp(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;
    this.isPanning = false;
  }

  deactivate(): void {
    this.isPanning = false;
  }
}
