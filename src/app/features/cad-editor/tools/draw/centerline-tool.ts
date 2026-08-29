import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { LineEntity, type IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';
import { buildCenterlineSegment, type CenterlineSegment } from './centerline-geometry';

/** Select two line entities and create a continuous line between them. */
export class CenterlineTool implements ITool {
  readonly name = 'centerline';

  private first: LineEntity | null = null;
  private firstPick: IPoint | null = null;
  private hovered: LineEntity | null = null;
  private preview: CenterlineSegment | null = null;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  activate(): void {
    this.reset();
  }

  deactivate(): void {
    this.reset();
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, event: MouseEvent): void {
    if (event.button !== 0) return;
    const line = this.pickLine(sx, sy);
    if (!line) return;

    if (!this.first) {
      this.first = line;
      this.firstPick = { x: wx, y: wy };
      this.hovered = null;
      this.preview = null;
      this.vm.markDirty();
      return;
    }

    if (line === this.first || !this.firstPick) return;
    const geometry = buildCenterlineSegment(this.first, line, this.firstPick, { x: wx, y: wy });
    if (!geometry) return;

    const centerline = new LineEntity(geometry.x1, geometry.y1, geometry.x2, geometry.y2);
    centerline.layer = this.doc.activeLayer;
    centerline.lineType = 'CENTER';
    centerline.lineTypeScale = 1;
    this.cmds.push(new AddEntityCmd(
      centerline,
      this.doc.activeFile,
      { markDirty: () => this.vm.markContentDirty() },
    ));
    this.tools.setTool('select');
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number): void {
    if (!this.first || !this.firstPick) return;
    const line = this.pickLine(sx, sy);
    this.hovered = line && line !== this.first ? line : null;
    this.preview = this.hovered
      ? buildCenterlineSegment(this.first, this.hovered, this.firstPick, { x: wx, y: wy })
      : null;
    this.vm.markDirty();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      this.tools.setTool('select');
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.first) this.drawSourceHighlight(ctx, this.first, 'rgba(240, 160, 48, 0.95)');
    if (this.hovered) this.drawSourceHighlight(ctx, this.hovered, 'rgba(90, 190, 255, 0.9)');
    if (!this.preview) return;

    const start = this.vm.w2s(this.preview.x1, this.preview.y1);
    const end = this.vm.w2s(this.preview.x2, this.preview.y2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = 'rgba(240, 160, 48, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([12, 4, 3, 4]);
    ctx.stroke();
    ctx.restore();
  }

  getPhase(): string {
    return this.first ? 'second' : 'first';
  }

  getAnchor(): IPoint | null {
    return null;
  }

  getCursor(): string {
    return 'crosshair';
  }

  private pickLine(sx: number, sy: number): LineEntity | null {
    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (!hit?.entity) return null;
    const ent = hit.entity;
    if (ent.type === 'LINE' || ent instanceof LineEntity) {
      return ent as LineEntity;
    }
    return null;
  }

  private drawSourceHighlight(ctx: CanvasRenderingContext2D, line: LineEntity, color: string): void {
    const start = this.vm.w2s(line.x1, line.y1);
    const end = this.vm.w2s(line.x2, line.y2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  private reset(): void {
    this.first = null;
    this.firstPick = null;
    this.hovered = null;
    this.preview = null;
    this.vm.markDirty();
  }
}
