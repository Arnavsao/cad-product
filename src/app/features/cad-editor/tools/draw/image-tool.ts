import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { ImageEntity } from '../../core/models/image-entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd } from '../../core/models/command.model';

/**
 * Image insert tool.
 *
 * Flow:
 *   1. activate() spawns a transient `<input type="file">`, accepts PNG/JPG/SVG/WEBP.
 *   2. On file selection, the file is loaded as a data URL and stashed.
 *   3. The image starts following the cursor (live preview at natural pixel size,
 *      treating 1 px = 1 world unit).
 *   4. Click â†’ entity committed at the click point via AddEntityCmd.
 *   5. Esc / Enter â†’ cancel placement.
 *
 * Image sizing default: natural pixel dimensions as world units. The user can
 * rescale afterwards via the properties panel (ScaleX / ScaleY) or by dragging
 * grips (corners scale uniformly, edge midpoints stretch one axis).
 */
export class ImageTool implements ITool {
  readonly name = 'image';
  static isProgrammaticQueue = false;

  private pendingSrc: string | null = null;
  private pendingFileName = '';
  private cur: IPoint = { x: 0, y: 0 };
  private naturalW = 0;
  private naturalH = 0;
  private previewImg: HTMLImageElement | null = null;
  private onPlacedCallback?: () => void;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  activate(): void {
    if (this.pendingSrc || ImageTool.isProgrammaticQueue) return;
    this._openPicker();
  }

  private _openPicker(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg,image/svg+xml,image/webp,image/gif';
    input.style.display = 'none';
    document.body.appendChild(input);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        this.tools.setTool('select');
        return;
      }
      this.loadFromFile(file);
    });
    // 'cancel' fires when user dismisses the picker in browsers that support it.
    input.addEventListener('cancel', () => {
      cleanup();
      this.tools.setTool('select');
    });
    input.click();
  }

  /**
   * Programmatically load an image file, bypassing the picker.
   * Optionally supply a callback invoked when the user either places
   * the image or cancels the operation.
   */
  loadFromFile(file: File, onPlaced?: () => void): void {
    ImageTool.isProgrammaticQueue = true;
    this.onPlacedCallback = onPlaced;
    this.pendingFileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      this.pendingSrc = src;
      // Probe natural pixel size for the default world dimensions.
      const probe = new Image();
      probe.onload = () => {
        this.previewImg = probe;
        this.naturalW = probe.naturalWidth || probe.width || 100;
        this.naturalH = probe.naturalHeight || probe.height || 100;
        ImageTool.isProgrammaticQueue = false;
        this.vm.markDirty();
      };
      probe.onerror = () => {
        this.naturalW = 100; this.naturalH = 100;
        ImageTool.isProgrammaticQueue = false;
        this.vm.markDirty();
      };
      probe.src = src;
    };
    reader.onerror = () => {
      this.pendingSrc = null;
      ImageTool.isProgrammaticQueue = false;
      this.tools.setTool('select');
      if (this.onPlacedCallback) this.onPlacedCallback();
      this.onPlacedCallback = undefined;
    };
    reader.readAsDataURL(file);
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.pendingSrc && this.naturalW) this.vm.markDirty();
  }

  private getPlacementSize(): { w: number; h: number } {
    if (!this.naturalW || !this.naturalH) return { w: 0, h: 0 };
    const viewportW = (this.vm.canvasWidth > 0 && this.vm.scale > 0) ? (this.vm.canvasWidth / this.vm.scale) : 0;
    const viewportH = (this.vm.canvasHeight > 0 && this.vm.scale > 0) ? (this.vm.canvasHeight / this.vm.scale) : 0;
    
    let targetDim = 100;
    if (viewportW > 0 && viewportH > 0) {
      targetDim = Math.min(viewportW, viewportH) * 0.25;
    }
    
    let w: number;
    let h: number;
    const aspectRatio = this.naturalW / this.naturalH;
    if (aspectRatio >= 1) {
      w = targetDim;
      h = w / aspectRatio;
    } else {
      h = targetDim;
      w = h * aspectRatio;
    }
    return { w, h };
  }

  onMouseDown(wx: number, wy: number, _sx: number, _sy: number, e: MouseEvent): void {
    if (e.button !== 0 || !this.pendingSrc || !this.naturalW) return;
    const { w, h } = this.getPlacementSize();
    const ent = new ImageEntity(this.pendingSrc, wx, wy, w, h);
    ent.fileName = this.pendingFileName;
    ent.layer = this.doc.activeLayer;
    this.cmds.push(new AddEntityCmd(ent, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    this.pendingSrc = null;
    this.pendingFileName = '';
    this.naturalW = this.naturalH = 0;
    this.previewImg = null;
    ImageTool.isProgrammaticQueue = false;
    
    // Call the callback before resetting tool to 'select' so queue can proceed
    const cb = this.onPlacedCallback;
    this.onPlacedCallback = undefined;
    
    if (cb) {
      cb();
    } else {
      this.tools.setTool('select');
    }
  }

  getPhase(): string { return 'place'; }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.pendingSrc || !this.naturalW) return;
    const { w, h } = this.getPlacementSize();
    const a = this.vm.w2s(this.cur.x, this.cur.y);
    const b = this.vm.w2s(this.cur.x + w, this.cur.y + h);
    
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const sw = Math.abs(b.x - a.x);
    const sh = Math.abs(b.y - a.y);

    ctx.save();
    if (this.previewImg && this.previewImg.complete) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.previewImg, left, top, sw, sh);
    }
    ctx.strokeStyle = 'rgba(240, 160, 48, 0.85)';
    ctx.fillStyle = 'rgba(240, 160, 48, 0.05)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.fillRect(left, top, sw, sh);
    ctx.strokeRect(left, top, sw, sh);
    ctx.restore();
  }

  getAnchor(): IPoint | null { return this.pendingSrc ? this.cur : null; }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.pendingSrc = null;
      this.pendingFileName = '';
      this.naturalW = this.naturalH = 0;
      
      const cb = this.onPlacedCallback;
      this.onPlacedCallback = undefined;
      
      if (cb) {
        cb();
      } else {
        this.tools.setTool('select');
      }
    }
  }

  deactivate(): void {
    this.pendingSrc = null;
    this.pendingFileName = '';
    this.naturalW = this.naturalH = 0;
  }
}
