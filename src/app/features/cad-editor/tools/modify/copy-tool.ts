import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DrawOrderService } from '../../core/services/draw-order.service';
import { CadClipboardService } from '../../core/services/cad-clipboard.service';
import { PasteEntitiesCmd } from '../../core/models/command.model';
import { moveEntityInPlace } from '../geometry-utils';
import { hitTestAll, getSelectedEntities } from '../select/select-tool';
import { formatLen, formatAngleDeg } from '../draw/draw-utils';
import { evalExpression, parseCadVector } from '../../core/utils/expression-parser';

/**
 * AutoCAD-style COPY command tool.
 *
 * Phase flow:
 *   1. `select`  â€” crossing/window selection if nothing pre-selected.
 *   2. `base`    â€” pick base point; snapping applies.
 *   3. `second`  â€” cursor-tracking ghost; each left-click places a copy
 *                  (AutoCAD multi-paste behaviour). Enter/Esc ends.
 *
 * The tool also serves COPYBASE (basePointFirst=true), which reverses the order:
 *   1. `base`    â€” pick base point first.
 *   2. `select`  â€” select objects.
 *   3. `second`  â€” place copies.
 *
 * On each placement, a fresh clone-set is pasted through CadClipboardService,
 * keeping the undo stack clean (one PasteEntitiesCmd per placement).
 */
export class CopyTool implements ITool {
  readonly name = 'copy';

  /**
   * Set to true (and stage `pendingBasePoint`) when activated via COPYBASE so
   * the tool asks for the base point before entity selection.
   */
  static basePointFirst = false;
  static pendingBasePoint: IPoint | null = null;

  private targets: Entity[] = [];
  private basePoint: IPoint | null = null;
  private previewEnts: Entity[] = [];
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
    if (CopyTool.basePointFirst && CopyTool.pendingBasePoint) {
      // COPYBASE: base point already picked by the command; go straight to selection.
      this.basePoint = CopyTool.pendingBasePoint;
      CopyTool.pendingBasePoint = null;
      CopyTool.basePointFirst = false;
      this.targets = getSelectedEntities(this.doc);
      if (this.targets.length) {
        this.initPreview();
      }
    } else {
      CopyTool.basePointFirst = false;
      this.targets = getSelectedEntities(this.doc);
    }
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;

    // Phase 1: collect targets if still empty.
    if (!this.targets.length) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit) {
        hit.entity.selected = true;
        this.targets = [hit.entity];
        this.vm.markContentDirty();
      }
      return;
    }

    // Phase 2: pick base point.
    if (!this.basePoint) {
      this.basePoint = { x: wx, y: wy };
      this.initPreview();
      return;
    }

    // Phase 3: place a copy at the clicked point.
    this.placeCopy(wx, wy);
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    this.hasCursor = true;
    if (this.basePoint && this.previewEnts.length) {
      this.translatePreview(wx, wy);
    }
    this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.basePoint || !this.hasCursor || !this.previewEnts.length) return;
    const file = this.doc.activeFile;
    ctx.save();
    ctx.globalAlpha = 0.45;
    for (const e of this.previewEnts) {
      e.draw(ctx, this.vm as any, file);
    }
    ctx.restore();

    // Rubber-band line from base to cursor.
    const a = this.vm.w2s(this.basePoint.x, this.basePoint.y);
    const b = this.vm.w2s(this.cur.x, this.cur.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // Crosshair at cursor.
    const s = this.vm.w2s(this.cur.x, this.cur.y);
    ctx.strokeStyle = '#63b3ed';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(s.x - 8, s.y); ctx.lineTo(s.x + 8, s.y);
    ctx.moveTo(s.x, s.y - 8); ctx.lineTo(s.x, s.y + 8);
    ctx.stroke();
    ctx.restore();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter') {
      this.cleanup();
      this.tools.setTool('select');
    }
  }

  getAnchor(): IPoint | null { return this.basePoint; }

  getPhase(): string | null {
    if (!this.targets.length) return 'select';
    if (!this.basePoint) return 'base';
    return 'second';
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.basePoint) return null;
    const dx = this.cur.x - this.basePoint.x;
    const dy = this.cur.y - this.basePoint.y;
    const length = Math.hypot(dx, dy);

    return {
      wx: this.cur.x,
      wy: this.cur.y,
      primaryFieldKey: 'length',
      fields: [
        { key: 'length', label: 'Distance', liveValue: formatLen(length), width: 100 },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (!this.basePoint) return false;
    const lenRaw = values['length'] ?? '';
    const vec = parseCadVector(lenRaw);
    let dx: number | null = null;
    let dy: number | null = null;

    if (vec && vec.kind === 'cartesian' && vec.dx !== undefined && vec.dy !== undefined) {
      dx = vec.dx; dy = vec.dy;
    } else if (vec && vec.kind === 'polar' && vec.length !== undefined && vec.angleDeg !== undefined) {
      const rad = vec.angleDeg * Math.PI / 180;
      dx = vec.length * Math.cos(rad);
      dy = vec.length * Math.sin(rad);
    } else {
      const length = evalExpression(lenRaw);
      if (length !== null) {
        const rad = Math.atan2(this.cur.y - this.basePoint.y, this.cur.x - this.basePoint.x);
        dx = length * Math.cos(rad);
        dy = length * Math.sin(rad);
      }
    }
    if (dx === null || dy === null) return false;
    this.placeCopy(this.basePoint.x + dx, this.basePoint.y + dy);
    return true;
  }

  invokeOption(key: string): boolean {
    if (key === 'D' && !this.basePoint) {
      // Displacement mode â€” for now treat as regular base pick via Enter.
      return true;
    }
    return false;
  }

  deactivate(): void {
    this.cleanup();
  }

  // â”€â”€â”€ Private â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private initPreview(): void {
    if (!this.basePoint || !this.targets.length) return;

    // Copy targets into clipboard with the explicitly-chosen base point.
    this.cadClipboard.copy(this.targets, this.basePoint);

    // Build preview entities centred on the base point (offset = 0 initially).
    this.previewEnts = this.targets.map((src) => {
      const c = src.clone();
      c.selected = false;
      c.layer = this.doc.activeLayer;
      c.refreshCaches();
      return c;
    });
    this.lastAppliedOffset = { x: this.basePoint.x, y: this.basePoint.y };

    // Seed cursor.
    const last = this.vm.lastCursorWorld;
    if (last && isFinite(last.x) && isFinite(last.y)) {
      this.cur = { x: last.x, y: last.y };
      this.hasCursor = true;
      this.translatePreview(last.x, last.y);
    }
    this.vm.markDirty();
  }

  private translatePreview(targetX: number, targetY: number): void {
    const dx = targetX - this.lastAppliedOffset.x;
    const dy = targetY - this.lastAppliedOffset.y;
    if (dx === 0 && dy === 0) return;
    for (const e of this.previewEnts) {
      moveEntityInPlace(e, dx, dy);
    }
    this.lastAppliedOffset = { x: targetX, y: targetY };
  }

  private placeCopy(wx: number, wy: number): void {
    if (!this.cadClipboard.payload || !this.targets.length) return;

    this.translatePreview(wx, wy);

    const file = this.doc.activeFile;

    // Import layers/blocks from the clipboard into the target file.
    this.cadClipboard.ensureLayersExist(file);
    this.cadClipboard.ensureBlocksExist(file);
    this.cadClipboard.ensureDimStylesExist(file);

    // Build a fresh clone batch at the current cursor position.
    const placed = this.cadClipboard.buildPasteEntities({ x: wx, y: wy });
    if (!placed?.length) return;

    for (const f of this.doc.files) for (const ent of f.entities) ent.selected = false;
    for (const ent of placed) ent.selected = true;

    this.drawOrder.assignInitial(placed, file.entities);
    this.cmds.push(new PasteEntitiesCmd(placed, file, { markDirty: () => this.vm.markContentDirty() }));

    // Reset preview position back to the BASE POINT so the next placement
    // starts from base again (standard AutoCAD multi-copy behaviour).
    this.lastAppliedOffset = { x: this.basePoint!.x, y: this.basePoint!.y };
    for (const e of this.previewEnts) {
      const srcE = this.targets[this.previewEnts.indexOf(e)];
      // Rebuild preview from original clones.
      if (srcE) {
        const newClone = srcE.clone();
        newClone.selected = false;
        Object.assign(e, newClone);
      }
    }
  }

  private cleanup(): void {
    this.previewEnts = [];
    this.targets = [];
    this.basePoint = null;
    this.hasCursor = false;
    this.vm.markDirty();
  }
}
