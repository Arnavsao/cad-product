/**
 * JOIN tool â€” AutoCAD-grade interactive join for Lines and open Polylines.
 *
 * Entry workflows:
 *   Pre-select: select â‰¥ 2 entities with the Select tool, then run JOIN.
 *               Analysis and preview appear immediately on activate().
 *   Run-then-pick: activate JOIN with nothing selected, then click entities
 *               one by one. Each click re-analyses and updates the preview.
 *               Clicking a picked entity again removes it (toggle).
 *
 * Visual feedback (drawPreview):
 *   â€¢ Hover glow          â€” entity under cursor, not yet a candidate
 *   â€¢ 'selected' highlight â€” every entity in the candidate set
 *   â€¢ Dashed-orange path  â€” the resulting polyline for each valid chain
 *     with "â†¦ N â†’ 1" / "â†» N â†’ 1" badge
 *   â€¢ Red dashed outline  â€” rejected entities (branching / unsupported /
 *     closed / degenerate) with reason label (âŠ  reason)
 *   â€¢ Dim-orange dashed   â€” isolated entities (valid type, no neighbor yet)
 *
 * Commit:
 *   Enter / Space / right-click commit. Produces one PolylineEntity per
 *   valid chain. All deletions + additions are wrapped in a single
 *   CompoundCmd for one-step undo.
 *   Properties (layer, color, lineType, lineWeight) are inherited from the
 *   FIRST entity the user added to the candidate set that belongs to each
 *   chain (AutoCAD convention).
 *
 * Arcs:
 *   Arcs are classified as 'unsupported-type' and shown in red. Joining arcs
 *   requires PolylineEntity bulge support â€” see Phase 2 in the plan.
 */

import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { PolylineEntity, type Entity, type IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import {
  AddEntityCmd,
  DeleteEntityCmd,
  CompoundCmd,
} from '../../core/models/command.model';
import { hitTestAll, getSelectedEntities } from '../select/select-tool';
import { analyzeJoin, JOIN_TOLERANCE, type IAnalysisResult, type RejectionReason } from './join-core';

export class JoinTool implements ITool {
  readonly name = 'join';

  /** World-unit gap tolerance. Endpoints within this distance are merged. */
  readonly tolerance = JOIN_TOLERANCE;

  /** Ordered pick list â€” index 0 is the "source" entity for property inheritance. */
  private candidates: Entity[] = [];
  /** Entity currently under the cursor (not yet in candidates). */
  private hovered: Entity | null = null;
  /** Latest analysis result; recomputed after every candidate change. */
  private analysis: IAnalysisResult | null = null;

  constructor(private injector: Injector) {}

  private get doc()   { return this.injector.get(DocumentService) as DocumentService; }
  private get vm()    { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds()  { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  // â”€â”€â”€ Lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  activate(): void {
    this.candidates = [];
    this.hovered = null;
    this.analysis = null;

    // Pre-select workflow: seed from current selection and analyse immediately.
    const sel = getSelectedEntities(this.doc);
    if (sel.length > 0) {
      this.candidates = [...sel];
      this.reanalyze();
      
      if (sel.length >= 2) {
        // Auto-commit immediately if there are multiple pre-selected entities.
        // Defer to next tick so ToolManager completes activation first.
        setTimeout(() => this.commit(), 0);
        return;
      }
    }
    this.vm.markDirty();
  }

  deactivate(): void {
    this.reset();
  }

  // â”€â”€â”€ Mouse events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  onMouseMove(_wx: number, _wy: number, sx: number, sy: number): void {
    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    const next = hit?.entity ?? null;
    if (next !== this.hovered) {
      this.hovered = next;
      this.vm.markDirty();
    }
  }

  onMouseDown(_wx: number, _wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;

    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (!hit) return;

    const ent = hit.entity;
    const idx = this.candidates.indexOf(ent);
    if (idx !== -1) {
      // Toggle off: remove from candidates
      this.candidates.splice(idx, 1);
    } else {
      // Toggle on: add to candidates (first added = source entity)
      this.candidates.push(ent);
    }

    this.reanalyze();
    this.vm.markDirty();
  }

  // â”€â”€â”€ Keyboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cancel();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      this.commit();
      e.preventDefault();
    }
  }

  /**
   * Delegate DI-overlay Enter to commit() so the join fires whether the user
   * presses Enter directly or through the dynamic-input overlay.
   */
  commitDynamicInput(_values: Record<string, string>): boolean {
    this.commit();
    return true;
  }

  getCursor(): string {
    return 'crosshair';
  }

  getPhase(): string {
    return this.candidates.length ? 'join' : 'select';
  }

  getAnchor(): IPoint | null {
    return null;
  }

  // â”€â”€â”€ Preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  drawPreview(ctx: CanvasRenderingContext2D): void {
    // Build quick-lookup maps from the latest analysis.
    const inChainSet = new Set<Entity>(
      this.analysis?.validChains.flatMap((c) => c.sourceEntities) ?? [],
    );
    const rejectedMap = new Map<Entity, RejectionReason>(
      this.analysis?.rejected.map((r) => [r.entity, r.reason]) ?? [],
    );

    // 1. Hover glow â€” entity under cursor that is NOT yet a candidate
    if (this.hovered && !this.candidates.includes(this.hovered)) {
      this.hovered.drawHovered(ctx, this.vm, this.doc, 'hover');
    }

    // 2. Per-candidate highlights
    for (const ent of this.candidates) {
      const reason = rejectedMap.get(ent);
      if (reason) {
        this.drawRejectedEntity(ctx, ent, reason);
      } else {
        // Valid candidate (in a chain OR will be once more are added)
        ent.drawHovered(ctx, this.vm, this.doc, 'selected');
      }
    }

    // 3. Dashed-orange result path for each valid chain
    if (this.analysis?.validChains.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(240,160,48,0.95)';
      ctx.fillStyle   = 'rgba(240,160,48,0.95)';
      ctx.lineWidth   = 2.5;
      ctx.setLineDash([8, 4]);

      for (const chain of this.analysis.validChains) {
        const { points: pts, closed, sourceEntities } = chain;
        if (pts.length < 2) continue;

        ctx.beginPath();
        const p0 = this.vm.w2s(pts[0].x, pts[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < pts.length; i++) {
          const p = this.vm.w2s(pts[i].x, pts[i].y);
          ctx.lineTo(p.x, p.y);
        }
        if (closed) ctx.closePath();
        ctx.stroke();

        // Badge
        ctx.setLineDash([]);
        ctx.font = '11px monospace';
        const tag = `${closed ? 'â†» ' : 'â†¦ '}${sourceEntities.length} â†’ 1`;
        ctx.fillText(tag, p0.x + 6, p0.y - 6);
        ctx.setLineDash([8, 4]);
      }
      ctx.restore();
    }

    // 4. Status hint when no candidates have been added yet
    if (this.candidates.length === 0) {
      ctx.save();
      ctx.font      = '12px sans-serif';
      ctx.fillStyle = 'rgba(240,160,48,0.65)';
      ctx.fillText('JOIN  â€”  click entities to select, Enter to commit', 14, 24);
      ctx.restore();
    }
  }

  // â”€â”€â”€ Commit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private commit(): void {
    if (!this.analysis?.validChains.length) {
      this.cancel();
      return;
    }

    const hooks = { markDirty: () => this.vm.markContentDirty() };
    const subCmds: Array<DeleteEntityCmd | AddEntityCmd> = [];

    for (const chain of this.analysis.validChains) {
      if (chain.sourceEntities.length < 2 || chain.points.length < 2) continue;

      // Property source: the first CANDIDATE that participates in this chain.
      // This respects pick order, not walk order (AutoCAD convention).
      const source =
        this.candidates.find((c) => chain.sourceEntities.includes(c)) ??
        chain.sourceEntities[0];

      const newPoly = new PolylineEntity(
        chain.points.map((p: any) => ({ x: p.x, y: p.y })),
        chain.closed,
      );
      newPoly.layer        = source.layer;
      newPoly.colorNumber  = source.colorNumber;
      if (source.color != null) newPoly.color = source.color;
      newPoly.lineType     = source.lineType;
      newPoly.lineWeight   = source.lineWeight;
      newPoly.lineTypeScale = source.lineTypeScale;

      for (const src of chain.sourceEntities) {
        const file = this.doc.getFileOfEntity(src);
        if (!file) continue;
        subCmds.push(new DeleteEntityCmd(src, file, hooks));
      }

      const targetFile =
        this.doc.getFileOfEntity(chain.sourceEntities[0]) ?? this.doc.activeFile;
      subCmds.push(new AddEntityCmd(newPoly, targetFile, hooks));
    }

    if (subCmds.length) {
      this.cmds.push(new CompoundCmd(subCmds));
    }

    this.reset();
    this.tools.setTool('select');
  }

  private cancel(): void {
    this.reset();
    this.tools.setTool('select');
  }

  private reset(): void {
    this.candidates = [];
    this.hovered    = null;
    this.analysis   = null;
    this.vm.markDirty();
  }

  // â”€â”€â”€ Internal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private reanalyze(): void {
    if (this.candidates.length === 0) {
      this.analysis = null;
      return;
    }
    this.analysis = analyzeJoin(this.candidates, this.tolerance);
  }

  /**
   * Draw a red (or dim-orange for isolated) dashed outline around a rejected
   * entity, plus a âŠ  reason label near its bounding box.
   */
  private drawRejectedEntity(
    ctx: CanvasRenderingContext2D,
    ent: Entity,
    reason: RejectionReason,
  ): void {
    const isIsolated = reason === 'isolated';

    ctx.save();
    ctx.strokeStyle  = isIsolated ? 'rgba(240,160,48,0.45)' : 'rgba(220,50,50,0.9)';
    ctx.lineWidth    = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.globalAlpha  = isIsolated ? 0.6 : 0.95;
    ent.draw(ctx, this.vm, this.doc);
    ctx.restore();

    // Label
    const b = ent.bbox?.();
    if (b) {
      const labelS = this.vm.w2s(b.x + b.w / 2, b.y + b.h);
      ctx.save();
      ctx.font      = '10px monospace';
      ctx.fillStyle = isIsolated ? 'rgba(240,160,48,0.85)' : 'rgba(220,50,50,0.9)';
      ctx.fillText(
        isIsolated ? '? no neighbor' : `âŠ  ${reason}`,
        labelS.x + 4,
        labelS.y - 4,
      );
      ctx.restore();
    }
  }
}
