import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { Entity } from '../../core/models/entity.model';
import { LeaderEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DeleteMultipleCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';

/**
 * MLEADERREMOVE â€” Remove a leader entity.
 *
 * Workflow (mirrors AutoCAD MLEADERREMOVE):
 *   Hover a LeaderEntity to highlight it, then click to delete.
 *   Supports undo via DeleteMultipleCmd.
 */
export class LeaderRemoveTool implements ITool {
  readonly name = 'leader_remove';

  private hovered: Entity | null = null;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  onMouseMove(_wx: number, _wy: number, sx: number, sy: number): void {
    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    const prev = this.hovered;
    this.hovered = (hit?.entity instanceof LeaderEntity) ? hit.entity : null;
    if (this.hovered !== prev) this.vm.markDirty();
  }

  onMouseDown(_wx: number, _wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;
    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (!hit || !(hit.entity instanceof LeaderEntity)) return;
    this.cmds.push(new DeleteMultipleCmd(
      [hit.entity],
      (en) => this.doc.getFileOfEntity(en),
      { markDirty: () => this.vm.markContentDirty() },
    ));
    this.hovered = null;
    this.tools.setTool('select');
  }

  getPhase(): string { return 'pick'; }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.hovered) {
      (this.hovered as any).drawHovered?.(ctx, this.vm, this.doc, 'hover');
    }
  }

  getCursor(): string { return 'crosshair'; }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter') {
      this.hovered = null;
      this.tools.setTool('select');
    }
  }

  deactivate(): void {
    this.hovered = null;
    this.vm.markDirty();
  }
}
