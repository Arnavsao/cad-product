import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { IPoint, Entity } from '../../core/models/entity.model';
import { LeaderEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { ModifyGeometryCmd, CompoundCmd } from '../../core/models/command.model';
import { snapshotEntity } from '../geometry-utils';
import { hitTestAll } from '../select/select-tool';

/**
 * MLEADERALIGN â€” Align multiple leader landing ends to a common Y.
 *
 * Workflow (mirrors AutoCAD MLEADERALIGN):
 *   1. Click each leader to add it to the selection set.
 *      Press Enter / Space to finish selection.
 *   2. Click a reference leader â€” all others shift vertically so their
 *      landing Y matches the reference leader's landing Y.
 *
 * The arrowhead tip of each leader stays fixed; only the bend (last pts
 * point) shifts to pull the landing to the new Y.
 */
export class LeaderAlignTool implements ITool {
  readonly name = 'leader_align';

  private phase: 'pick-leaders' | 'pick-reference' = 'pick-leaders';
  private selected: LeaderEntity[] = [];
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

    if (this.phase === 'pick-leaders') {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (!hit || !(hit.entity instanceof LeaderEntity)) return;
      const ent = hit.entity as LeaderEntity;
      const idx = this.selected.indexOf(ent);
      if (idx >= 0) {
        this.selected.splice(idx, 1);
      } else {
        this.selected.push(ent);
      }
      this.vm.markDirty();
      return;
    }

    if (this.phase === 'pick-reference') {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (!hit || !(hit.entity instanceof LeaderEntity)) return;
      const refY = (hit.entity as LeaderEntity).landingEnd().y;
      this.commitAlign(refY);
    }
  }

  private commitAlign(refY: number): void {
    const hooks = { markDirty: () => this.vm.markContentDirty() };
    const cmds: ModifyGeometryCmd[] = [];

    for (const ent of this.selected) {
      const lastPt = ent.pts[ent.pts.length - 1];
      const dy = refY - lastPt.y;
      if (Math.abs(dy) < 1e-9) continue;

      const before = snapshotEntity(ent);
      ent.pts = ent.pts.map((p: IPoint, i: number) => {
        // Keep tip (pts[0]) fixed; shift all intermediate + bend points
        if (i === 0) return p;
        return { x: p.x, y: p.y + dy };
      });
      const after = snapshotEntity(ent);
      cmds.push(new ModifyGeometryCmd(ent, before, after, hooks));
    }

    if (cmds.length > 0) {
      this.cmds.push(cmds.length === 1 ? cmds[0] : new CompoundCmd(cmds));
    }
    this.reset();
    this.tools.setTool('select');
  }

  getPhase(): string { return this.phase; }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    for (const ent of this.selected) {
      (ent as any).drawHovered?.(ctx, this.vm, this.doc, 'selected');
    }
    if (this.hovered && !this.selected.includes(this.hovered as LeaderEntity)) {
      (this.hovered as any).drawHovered?.(ctx, this.vm, this.doc, 'hover');
    }
  }

  getCursor(): string { return 'crosshair'; }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.reset();
      this.tools.setTool('select');
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && this.phase === 'pick-leaders') {
      if (this.selected.length >= 2) {
        this.phase = 'pick-reference';
        this.vm.markDirty();
      } else if (this.selected.length === 0) {
        this.tools.setTool('select');
      }
    }
  }

  private reset(): void {
    this.phase = 'pick-leaders';
    this.selected = [];
    this.hovered = null;
    this.vm.markDirty();
  }

  deactivate(): void { this.reset(); }
}
