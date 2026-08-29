import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { SplineEntity, catmullRomChain } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd } from '../../core/models/command.model';

/** Spline: multi-click fit points, Enter/Esc to commit. */
export class SplineTool implements ITool {
  readonly name = 'spline';
  private pts: IPoint[] = [];
  private cur: IPoint = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  onMouseDown(wx: number, wy: number): void {
    this.pts.push({ x: wx, y: wy });
    this.vm.markDirty();
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.pts.length) this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.pts.length) return;
    const all = [...this.pts, this.cur];
    const sampled = catmullRomChain(all, 16);
    ctx.save();
    ctx.beginPath();
    const first = this.vm.w2s(sampled[0].x, sampled[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < sampled.length; i++) {
      const p = this.vm.w2s(sampled[i].x, sampled[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 3]);
    ctx.stroke();

    // Control-point markers
    ctx.fillStyle = '#f0a030';
    for (const p of this.pts) {
      const s = this.vm.w2s(p.x, p.y);
      ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.restore();
  }

  getPhase(): string { return this.pts.length ? 'next' : 'first'; }

  getAnchor(): IPoint | null {
    return this.pts.length ? this.pts[this.pts.length - 1] : null;
  }

  private commit(): void {
    if (this.pts.length >= 2) {
      // Store control points; rendering goes through SplineEntity (currently polyline-of-controls);
      // future port can replace with proper De Boor / Catmull-Rom rendering.
      const e = new SplineEntity([...this.pts]);
      e.layer = this.doc.activeLayer;
      this.cmds.push(new AddEntityCmd(e, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    }
    this.pts = [];
    this.vm.markDirty();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      this.commit();
      this.tools.setTool('select');
    } else if (e.key === 'Escape') {
      this.pts = [];
      this.vm.markDirty();
      this.tools.setTool('select');
    } else if (e.key === 'Backspace' && this.pts.length) {
      this.pts.pop();
      this.vm.markDirty();
    }
  }

  deactivate(): void {
    this.pts = [];
    this.vm.markDirty();
  }
}
