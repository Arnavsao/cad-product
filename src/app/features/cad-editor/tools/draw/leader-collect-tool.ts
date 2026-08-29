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
 * MLEADERCOLLECT â€” Stack multiple leader landing ends into a vertical column.
 *
 * Workflow (mirrors AutoCAD MLEADERCOLLECT):
 *   1. Click each leader to add it to the selection set.
 *      Press Enter / Space to finish selection.
 *   2. All selected leaders are repositioned so their landing ends form a
 *      vertical column at the first leader's landing X, spaced by
 *      1.5 Ã— text height. The arrowhead tips remain fixed.
 *
 * This collects leaders into a tidy stack â€” useful when multiple annotations
 * point to nearby geometry and their labels need to be grouped together.
 */
export class LeaderCollectTool implements ITool {
  readonly name = 'leader_collect';

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
  }

  private commitCollect(): void {
    if (this.selected.length < 2) return;

    const ref = this.selected[0];
    const refLanding = ref.landingEnd();
    const refDir = ref.attachmentSide === 'right' ? 1 : -1;
    // Bend X shared by all collected leaders
    const targetBendX = refLanding.x - refDir * ref.landingLength;
    const spacing = ref.height * 1.5;

    const hooks = { markDirty: () => this.vm.markContentDirty() };
    const cmds: ModifyGeometryCmd[] = [];

    for (let i = 1; i < this.selected.length; i++) {
      const ent = this.selected[i];
      const targetY = refLanding.y - i * spacing;
      const lastPt = ent.pts[ent.pts.length - 1];
      const dy = targetY - lastPt.y;
      const dx = targetBendX - lastPt.x;

      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;

      const before = snapshotEntity(ent);
      // Shift all points except the arrowhead tip (pts[0])
      ent.pts = ent.pts.map((p: IPoint, idx: number) => {
        if (idx === 0) return p;
        return { x: p.x + dx, y: p.y + dy };
      });
      // Inherit stack reference's attachment style so landings line up
      ent.attachmentSide = ref.attachmentSide;
      ent.landingLength = ref.landingLength;
      const after = snapshotEntity(ent);
      cmds.push(new ModifyGeometryCmd(ent, before, after, hooks));
    }

    if (cmds.length > 0) {
      this.cmds.push(cmds.length === 1 ? cmds[0] : new CompoundCmd(cmds));
    }
    this.reset();
    this.tools.setTool('select');
  }

  getPhase(): string { return 'pick'; }

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
    if (e.key === 'Enter' || e.key === ' ') {
      if (this.selected.length >= 2) {
        this.commitCollect();
      } else {
        this.reset();
        this.tools.setTool('select');
      }
    }
  }

  private reset(): void {
    this.selected = [];
    this.hovered = null;
    this.vm.markDirty();
  }

  deactivate(): void { this.reset(); }
}
