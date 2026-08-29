import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { IPoint, Entity } from '../../core/models/entity.model';
import { LeaderEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';

/**
 * MLEADERADD â€” Add a new leader arm to an existing leader entity.
 *
 * Workflow (mirrors AutoCAD MLEADERADD):
 *   1. Hover + click an existing LeaderEntity.
 *   2. Click the new arrowhead location.
 *
 * The new arm auto-lands at the same endpoint as the selected leader,
 * inheriting its text, height, layer, and style.
 */
export class LeaderAddTool implements ITool {
  readonly name = 'leader_add';

  private phase: 'pick-leader' | 'pick-tip' = 'pick-leader';
  private target: LeaderEntity | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  private hovered: Entity | null = null;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  onMouseMove(wx: number, wy: number, sx: number, sy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.phase === 'pick-leader') {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      const prev = this.hovered;
      this.hovered = (hit?.entity instanceof LeaderEntity) ? hit.entity : null;
      if (this.hovered !== prev) this.vm.markDirty();
    } else {
      this.vm.markDirty();
    }
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;

    if (this.phase === 'pick-leader') {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (!hit || !(hit.entity instanceof LeaderEntity)) return;
      this.target = hit.entity as LeaderEntity;
      this.phase = 'pick-tip';
      this.hovered = null;
      this.vm.markDirty();
      return;
    }

    if (this.phase === 'pick-tip' && this.target) {
      this.commitAddLeader(wx, wy);
    }
  }

  private commitAddLeader(tipX: number, tipY: number): void {
    const orig = this.target!;
    const dir = orig.attachmentSide === 'right' ? 1 : -1;
    const origLanding = orig.landingEnd();
    // New arm's bend: same Y as landing, offset back by landingLength
    const bend: IPoint = { x: origLanding.x - dir * orig.landingLength, y: origLanding.y };

    const lead = new LeaderEntity([{ x: tipX, y: tipY }, bend], orig.text, orig.height);
    lead.layer = orig.layer;
    lead.color = orig.color;
    lead.lineType = orig.lineType;
    lead.attachmentSide = orig.attachmentSide;
    lead.landingLength = orig.landingLength;
    lead.arrowSize = orig.arrowSize;
    (lead as any).arrowType = (orig as any).arrowType;

    this.cmds.push(new AddEntityCmd(lead, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    this.reset();
    this.tools.setTool('select');
  }

  getPhase(): string { return this.phase; }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'pick-leader' && this.hovered) {
      (this.hovered as any).drawHovered?.(ctx, this.vm, this.doc, 'hover');
      return;
    }

    if (this.phase === 'pick-tip' && this.target) {
      (this.target as any).drawHovered?.(ctx, this.vm, this.doc, 'selected');

      const orig = this.target;
      const dir = orig.attachmentSide === 'right' ? 1 : -1;
      const landing = orig.landingEnd();
      const bend: IPoint = { x: landing.x - dir * orig.landingLength, y: landing.y };

      const tip = this.vm.w2s(this.cur.x, this.cur.y);
      const sBend = this.vm.w2s(bend.x, bend.y);
      const sLanding = this.vm.w2s(landing.x, landing.y);

      ctx.save();
      ctx.strokeStyle = 'rgba(240,160,48,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(sBend.x, sBend.y);
      ctx.lineTo(sLanding.x, sLanding.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  getCursor(): string { return 'crosshair'; }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter') {
      this.reset();
      this.tools.setTool('select');
    }
  }

  private reset(): void {
    this.phase = 'pick-leader';
    this.target = null;
    this.hovered = null;
    this.vm.markDirty();
  }

  deactivate(): void { this.reset(); }
}
