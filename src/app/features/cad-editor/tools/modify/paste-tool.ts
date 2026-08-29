import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DrawOrderService } from '../../core/services/draw-order.service';
import { CadClipboardService } from '../../core/services/cad-clipboard.service';
import { PasteEntitiesCmd } from '../../core/models/command.model';
import { moveEntityInPlace } from '../geometry-utils';

/** Which paste variant is active. */
export type PasteMode = 'pasteclip' | 'pasteblock';

/**
 * AutoCAD-style PASTECLIP / PASTEBLOCK placement tool.
 *
 * Activated by:
 *   Ctrl+V / PASTECLIP  â†’ mode='pasteclip' (default)
 *   Ctrl+Alt+V / PASTEBLOCK â†’ mode='pasteblock'
 *
 * The tool reads the payload from `CadClipboardService`, renders a translucent
 * ghost anchored at the cursor using the payload's `basePoint` as the handle,
 * and commits on left-click / Enter / right-click.
 *
 * PASTEORIG (Ctrl+Shift+V) is handled *without* this tool â€” it's an instant
 * command that calls `CadClipboardService.pasteOriginal()` directly.
 *
 * Legacy compatibility: `PasteTool.pendingClipboard` (bare Entity[]) is still
 * supported for external callers that haven't migrated to the new service yet;
 * in that case the entities are wrapped into a minimal payload on activate().
 */
export class PasteTool implements ITool {
  readonly name = 'paste';

  // â”€â”€ Legacy shim â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /** @deprecated Use CadClipboardService.copy() instead. */
  static pendingClipboard: Entity[] | null = null;

  // â”€â”€ Mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static mode: PasteMode = 'pasteclip';

  // â”€â”€ Preview state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /** Live clone batch â€” positioned at `lastAppliedOffset`. */
  private previewEnts: Entity[] = [];
  /** World coords the preview is currently anchored at. */
  private lastAppliedOffset: IPoint = { x: 0, y: 0 };
  private cur: IPoint = { x: 0, y: 0 };
  private hasCursor = false;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get drawOrder() { return this.injector.get(DrawOrderService) as DrawOrderService; }
  private get cadClipboard() { return this.injector.get(CadClipboardService) as CadClipboardService; }

  activate(): void {
    // â”€â”€ Legacy shim: wrap bare Entity[] into the new service â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (PasteTool.pendingClipboard?.length) {
      const ents = PasteTool.pendingClipboard;
      PasteTool.pendingClipboard = null;
      this.cadClipboard.copy(ents); // stores into service with bbox centre as basePoint
    }

    const clip = this.cadClipboard.payload;
    if (!clip?.entities.length) {
      this.tools.setTool('select');
      return;
    }

    // Build the initial preview: clones of the payload's entities, shifted so
    // the payload basePoint is at world origin (0,0). Each mouse move then
    // translates by (cursor - lastAppliedOffset).
    this.previewEnts = clip.entities.map((src) => {
      const c = src.clone();
      moveEntityInPlace(c, -clip.basePoint.x, -clip.basePoint.y);
      c.selected = false;
      c.layer = this.doc.activeLayer;
      c.refreshCaches();
      return c;
    });
    this.lastAppliedOffset = { x: 0, y: 0 };

    // Pre-position at last known cursor so the ghost appears immediately.
    const last = this.vm.lastCursorWorld;
    if (last && isFinite(last.x) && isFinite(last.y)) {
      this.cur = { x: last.x, y: last.y };
      this.hasCursor = true;
      this.translatePreview(last.x, last.y);
    }
    this.vm.markDirty();
  }

  // â”€â”€â”€ Mouse events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    this.hasCursor = true;
    this.translatePreview(wx, wy);
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number, _sx: number, _sy: number, e: MouseEvent): void {
    // Left click â†’ commit. Right-click is handled via confirmAtCursor() from
    // the host's context-menu handler so the browser's right-button-down
    // doesn't also fire a commit before the context menu appears.
    if (e.button !== 0) return;
    this.commitPlacement(wx, wy);
  }

  /** Right-click hook called by the host's contextmenu handler. */
  confirmAtCursor(): void {
    if (!this.hasCursor || !this.previewEnts.length) {
      this.tools.setTool('select');
      return;
    }
    this.commitPlacement(this.cur.x, this.cur.y);
  }

  // â”€â”€â”€ Keyboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.previewEnts = [];
      this.hasCursor = false;
      this.vm.markDirty();
      this.tools.setTool('select');
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (!this.hasCursor) return;
      this.commitPlacement(this.cur.x, this.cur.y);
    }
  }

  // â”€â”€â”€ Preview drawing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.hasCursor || !this.previewEnts.length) return;
    const file = this.doc.activeFile;

    ctx.save();
    ctx.globalAlpha = 0.5;
    for (const e of this.previewEnts) {
      e.draw(ctx, this.vm as any, file);
    }
    ctx.restore();

    // Crosshair marker at insertion point.
    const s = this.vm.w2s(this.cur.x, this.cur.y);
    ctx.save();
    ctx.strokeStyle = '#63b3ed';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(s.x - 8, s.y); ctx.lineTo(s.x + 8, s.y);
    ctx.moveTo(s.x, s.y - 8); ctx.lineTo(s.x, s.y + 8);
    ctx.stroke();
    ctx.restore();
  }

  // â”€â”€â”€ Tool metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Paste has no meaningful "from" anchor so ortho/polar don't engage â€”
   * matches AutoCAD PASTECLIP behaviour. OSnap and grid still apply.
   */
  getPhase(): string { return 'insert'; }

  getAnchor(): IPoint | null { return null; }

  deactivate(): void {
    this.previewEnts = [];
    this.hasCursor = false;
    this.vm.markDirty();
  }

  // â”€â”€â”€ Private helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private translatePreview(targetX: number, targetY: number): void {
    const dx = targetX - this.lastAppliedOffset.x;
    const dy = targetY - this.lastAppliedOffset.y;
    if (dx === 0 && dy === 0) return;
    for (const e of this.previewEnts) {
      moveEntityInPlace(e, dx, dy);
    }
    this.lastAppliedOffset = { x: targetX, y: targetY };
  }

  private commitPlacement(wx: number, wy: number): void {
    if (!this.previewEnts.length) {
      this.tools.setTool('select');
      return;
    }
    // Ensure the preview is at the final cursor position.
    this.translatePreview(wx, wy);

    const file = this.doc.activeFile;
    const mode = PasteTool.mode;
    PasteTool.mode = 'pasteclip'; // reset for next invocation

    // Import missing resources.
    this.cadClipboard.ensureLayersExist(file);
    this.cadClipboard.ensureBlocksExist(file);
    this.cadClipboard.ensureDimStylesExist(file);

    if (mode === 'pasteblock') {
      // PASTEBLOCK: wrap preview into a block definition at the insertion point.
      const placed = [...this.previewEnts];
      this.previewEnts = [];
      this.hasCursor = false;
      // Delegate to CadClipboardService which calls CreateBlockCmd.
      this.cadClipboard.pasteAsBlock({ x: wx, y: wy });
    } else {
      // PASTECLIP (default): insert entities directly.
      const placed = this.previewEnts;
      this.previewEnts = [];
      this.hasCursor = false;

      // Deselect all; select newly pasted batch.
      for (const f of this.doc.files) for (const ent of f.entities) ent.selected = false;
      for (const ent of placed) ent.selected = true;

      this.drawOrder.assignInitial(placed, file.entities);
      this.cmds.push(new PasteEntitiesCmd(placed, file, { markDirty: () => this.vm.markContentDirty() }));
    }

    this.tools.setTool('select');
  }
}
