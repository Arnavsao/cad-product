import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { DimensionEntity } from '../../core/models/entity-extended.model';
import type { IDimAnchor } from '../../core/models/dimension-style.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { SnappingService } from '../../core/services/snapping.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { formatLen } from './draw-utils';

/**
 * Linear dimension tool: p1 â†’ p2 â†’ dim-line location.
 *
 * Associativity: at each of the first two clicks we look at SnappingService.current.
 * If the cursor snapped to a single-entity snap point (endpoint/midpoint/center),
 * we capture the source entity id + snap-point index as an `IDimAnchor` and stamp
 * it onto the resulting DimensionEntity. Subsequent edits to the source entity
 * (move, stretch, grip-drag, undo, redo) propagate to the dimension on its next
 * render. Click in empty space â†’ no anchor â†’ static dimension at those coords.
 */
export class DimensionTool implements ITool {
  readonly name = 'dimension';
  private p1: IPoint | null = null;
  private p2: IPoint | null = null;
  private anchor1: IDimAnchor | null = null;
  private anchor2: IDimAnchor | null = null;
  private cur: IPoint = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get snap() { return this.injector.get(SnappingService) as SnappingService; }

  onMouseDown(wx: number, wy: number): void {
    if (!this.p1) {
      this.p1 = { x: wx, y: wy };
      this.anchor1 = this._captureAnchor();
      return;
    }
    if (!this.p2) {
      this.p2 = { x: wx, y: wy };
      this.anchor2 = this._captureAnchor();
      return;
    }
    // Third click = dim-line location (preserves side info, not just distance).
    this.cur = { x: wx, y: wy };
    const mode = this._getSmartMode(this.p1, this.p2, this.cur);
    const dim = new DimensionEntity(this.p1, this.p2, { x: wx, y: wy });
    if (mode === 'horizontal') dim.rotation = 0;
    else if (mode === 'vertical') dim.rotation = Math.PI / 2;
    
    dim.layer = this.doc.activeLayer;
    dim.styleName = this.doc.activeFile.activeDimStyleName || 'Standard';
    if (this.anchor1) dim.anchor1 = this.anchor1;
    if (this.anchor2) dim.anchor2 = this.anchor2;
    this.cmds.push(new AddEntityCmd(dim, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    this._reset();
    this.vm.markDirty();
  }

  /** Read SnappingService.current and convert into an IDimAnchor when applicable. */
  private _captureAnchor(): IDimAnchor | null {
    const s = this.snap.current;
    if (!s) return null;
    if (typeof s.entityId !== 'number' || typeof s.snapIndex !== 'number') return null;
    return { entityId: s.entityId, snapIndex: s.snapIndex };
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.p1) this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.p1) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.fillStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;

    if (!this.p2) {
      // Phase 1: rubber-band line from p1 to current cursor (the second extension origin).
      const a = this.vm.w2s(this.p1.x, this.p1.y);
      const b = this.vm.w2s(this.cur.x, this.cur.y);
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      // Phase 2: render a live DimensionEntity preview at the cursor's dim-line position.
      const mode = this._getSmartMode(this.p1, this.p2, this.cur);
      const preview = new DimensionEntity(this.p1, this.p2, { x: this.cur.x, y: this.cur.y });
      if (mode === 'horizontal') preview.rotation = 0;
      else if (mode === 'vertical') preview.rotation = Math.PI / 2;
      
      ctx.setLineDash([]);
      preview.draw(ctx, this.vm, this.doc);
    }
    ctx.restore();
  }

  getPhase(): string {
    if (!this.p1) return 'first-ext';
    if (!this.p2) return 'second-ext';
    return 'dim-line';
  }

  getAnchor(): IPoint | null { return this.p2 ?? this.p1; }

  /**
   * Read-only placement readout. Each click captures geometry directly, so DI
   * here is informational â€” full editing happens via the properties panel
   * after the dimension is created (double-click â†’ Properties).
   *
   *   Phase 1 (p1 set): show distance from p1 to cursor.
   *   Phase 2 (p2 set): show measured Length + perpendicular Offset from the
   *                     p1-p2 axis to the cursor's dim-line position.
   */
  getDynamicInputState(): IDynamicInputState | null {
    if (!this.p1) return null;
    if (!this.p2) {
      const d = Math.hypot(this.cur.x - this.p1.x, this.cur.y - this.p1.y);
      return {
        wx: this.cur.x,
        wy: this.cur.y,
        fields: [
          { key: 'distance', label: 'Distance', liveValue: formatLen(d), readonly: true, width: 80 },
        ],
      };
    }
    
    const mode = this._getSmartMode(this.p1, this.p2, this.cur);
    const dim = new DimensionEntity(this.p1, this.p2, { x: this.cur.x, y: this.cur.y });
    if (mode === 'horizontal') dim.rotation = 0;
    else if (mode === 'vertical') dim.rotation = Math.PI / 2;
    
    if (dim.length < 1e-9) return null;
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      fields: [
        { key: 'length', label: 'Length', liveValue: formatLen(dim.length), readonly: true, width: 80 },
        { key: 'offset', label: 'Offset', liveValue: formatLen(dim.offset), readonly: true, width: 80 },
      ],
    };
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this._reset();
      this.vm.markDirty();
      this.tools.setTool('select');
      return;
    }
  }

  deactivate(): void { this._reset(); }



  private _getSmartMode(p1: IPoint, p2: IPoint, cur: IPoint): 'aligned' | 'horizontal' | 'vertical' {
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const cx = cur.x - mid.x;
    const cy = cur.y - mid.y;
    if (Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9) return 'aligned';
    
    const phi = Math.atan2(cy, cx);
    const theta = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const perp = theta + Math.PI / 2;

    const angDist = (a: number, b: number) => {
      let diff = Math.abs(a - b) % Math.PI;
      if (diff > Math.PI / 2) diff = Math.PI - diff;
      return diff;
    };

    const distAligned = angDist(phi, perp);
    const distHorizDim = angDist(phi, Math.PI / 2);
    const distVertDim = angDist(phi, 0);

    const minDist = Math.min(distAligned, distHorizDim, distVertDim);
    
    // Slight bias for aligned to make it feel "sticky" to the slanted line
    if (distAligned < minDist + 0.15) return 'aligned';

    if (minDist === distHorizDim) return 'horizontal';
    if (minDist === distVertDim) return 'vertical';
    return 'aligned';
  }

  private _reset(): void {
    this.p1 = null;
    this.p2 = null;
    this.anchor1 = null;
    this.anchor2 = null;
  }
}
