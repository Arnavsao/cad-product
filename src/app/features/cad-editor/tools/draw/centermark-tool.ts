import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { ArcEntity, CircleEntity, LineEntity, type IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd, CompoundCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';
import { buildCenterMarkSegments, type CenterMarkSegment } from './centermark-geometry';

type CenterMarkSource = CircleEntity | ArcEntity;

/** Select a circle or arc and add an AutoCAD-style continuous center mark. */
export class CenterMarkTool implements ITool {
  readonly name = 'centermark';

  private hovered: CenterMarkSource | null = null;
  private preview: CenterMarkSegment[] = [];

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

  onMouseDown(_wx: number, _wy: number, sx: number, sy: number, event: MouseEvent): void {
    if (event.button !== 0) return;
    const source = this.pickSource(sx, sy);
    if (!source) return;

    const segments = buildCenterMarkSegments(source);
    if (!segments.length) return;

    const hooks = { markDirty: () => this.vm.markContentDirty() };
    const commands = segments.map((segment) => {
      const line = new LineEntity(segment.x1, segment.y1, segment.x2, segment.y2);
      line.layer = this.doc.activeLayer;
      line.lineType = 'CONTINUOUS';
      line.lineTypeScale = 1;
      return new AddEntityCmd(line, this.doc.activeFile, hooks);
    });

    this.cmds.push(new CompoundCmd(commands));
    this.tools.setTool('select');
  }

  onMouseMove(_wx: number, _wy: number, sx: number, sy: number): void {
    this.hovered = this.pickSource(sx, sy);
    this.preview = this.hovered ? buildCenterMarkSegments(this.hovered) : [];
    this.vm.markDirty();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      this.tools.setTool('select');
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.hovered) this.drawSourceHighlight(ctx, this.hovered);
    if (!this.preview.length) return;

    ctx.save();
    ctx.beginPath();
    for (const segment of this.preview) {
      const start = this.vm.w2s(segment.x1, segment.y1);
      const end = this.vm.w2s(segment.x2, segment.y2);
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
    }
    ctx.strokeStyle = 'rgba(240, 160, 48, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  getPhase(): string {
    return 'select';
  }

  getAnchor(): IPoint | null {
    return null;
  }

  getCursor(): string {
    return 'crosshair';
  }

  private pickSource(sx: number, sy: number): CenterMarkSource | null {
    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (!(hit?.entity instanceof CircleEntity || hit?.entity instanceof ArcEntity)) return null;
    return this.doc.activeFile.entities.includes(hit.entity) ? hit.entity : null;
  }

  private drawSourceHighlight(ctx: CanvasRenderingContext2D, source: CenterMarkSource): void {
    const center = this.vm.w2s(source.cx, source.cy);
    const radius = source.r * this.vm.scale;

    ctx.save();
    ctx.beginPath();
    if (source instanceof CircleEntity) {
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    } else {
      ctx.arc(
        center.x,
        center.y,
        radius,
        (-source.startAngle * Math.PI) / 180,
        (-source.endAngle * Math.PI) / 180,
        source.ccw,
      );
    }
    ctx.strokeStyle = 'rgba(90, 190, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  private reset(): void {
    this.hovered = null;
    this.preview = [];
    this.vm.markDirty();
  }
}
