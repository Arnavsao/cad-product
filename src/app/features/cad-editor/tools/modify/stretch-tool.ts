import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import type { DxfFile } from '../../core/models/layer.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService, createProxyVm } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { ModifyGeometryCmd, CompoundCmd, ICommand } from '../../core/models/command.model';
import { snapshotEntity } from '../geometry-utils';
import { beginDragPreview, endDragPreview } from '../drag-preview';
import { evalExpression, parseCadVector } from '../../core/utils/expression-parser';
import { formatLen } from '../draw/draw-utils';

/** Stretch: crossing-window picks entities, then move only the vertices inside the window. */
export class StretchTool implements ITool {
  readonly name = 'stretch';
  private windowStart: { sx: number; sy: number } | null = null;
  private windowCur: { sx: number; sy: number } | null = null;
  private window: { left: number; right: number; top: number; bottom: number } | null = null;
  private basePoint: IPoint | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  /** Each target carries a one-time `clone` used for the live preview so the
   *  real entity is never mutated (and its revision never bumped) during the
   *  drag. `base` is the pre-stretch snapshot â€” the "before" for undo and the
   *  reference the clone is stretched from. */
  private targets: { ent: Entity; file: DxfFile; clone: Entity; base: Record<string, unknown>; insideMask: boolean[] }[] = [];
  /** Net delta already applied to the preview clones, so each move only adds
   *  the incremental difference (allocation-free, no per-frame array rebuild). */
  private lastDx = 0;
  private lastDy = 0;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  onMouseDown(wx: number, wy: number, sx: number, sy: number): void {
    if (!this.window) {
      this.windowStart = { sx, sy };
      this.windowCur = { sx, sy };
      return;
    }
    if (!this.basePoint) {
      this.basePoint = { x: wx, y: wy };
      this.lastDx = 0;
      this.lastDy = 0;
      this.dyn.clearEdits();
      return;
    }
    const dx = wx - this.basePoint.x;
    const dy = wy - this.basePoint.y;
    this.applyDelta(dx, dy);
  }

  private applyDelta(dx: number, dy: number): boolean {
    if (!this.basePoint) return false;
    // The real entities were never touched during the drag (only their clones
    // were). Apply the stretch once and record one atomic, batched undo step.
    const commands: ICommand[] = [];
    for (const t of this.targets) {
      this.applyStretch({ ent: t.ent, insideMask: t.insideMask }, dx, dy);
      const after = snapshotEntity(t.ent);
      commands.push(new ModifyGeometryCmd(t.ent, t.base, after, { markDirty: () => this.vm.markContentDirty() }));
    }
    if (commands.length) {
      this.cmds.record(new CompoundCmd(commands));
      this.vm.markDirty();
    }
    this.cleanup();
    this.dyn.clearEdits();
    this.tools.setTool('select');
    return true;
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.windowStart && !this.window) {
      this.windowCur = { sx, sy };
      this.vm.markDirty();
      return;
    }
    if (this.window && this.basePoint) {
      const dx = wx - this.basePoint.x;
      const dy = wy - this.basePoint.y;
      // Move the preview clones by the incremental delta only â€” no array
      // rebuild, and the real entities (and their caches) stay untouched.
      const incX = dx - this.lastDx;
      const incY = dy - this.lastDy;
      if (incX !== 0 || incY !== 0) {
        for (const t of this.targets) {
          this.applyStretch({ ent: t.clone, insideMask: t.insideMask }, incX, incY);
        }
        this.lastDx = dx;
        this.lastDy = dy;
      }
      this.vm.markDirty();
    }
  }

  onMouseUp(_wx: number, _wy: number, sx: number, sy: number): void {
    if (this.windowStart && !this.window) {
      // Commit crossing window
      const left = Math.min(this.windowStart.sx, sx);
      const right = Math.max(this.windowStart.sx, sx);
      const top = Math.min(this.windowStart.sy, sy);
      const bottom = Math.max(this.windowStart.sy, sy);
      this.window = { left, right, top, bottom };

      // Collect entities + per-vertex mask of which control points are inside the window
      this.targets = [];
      for (const file of this.doc.files) {
        if (!file.visible || file.locked) continue;
        const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);
        for (const ent of file.entities) {
          if (!ent.visible) continue;
          const lay = file.layers.get(ent.layer);
          if (lay && (lay.frozen || !lay.visible || lay.locked)) continue;
          const vertices = this.collectVertices(ent);
          if (!vertices.length) continue;
          const insideMask = vertices.map((p: any) => {
            const s = fileVm.w2s(p.x, p.y);
            return s.x >= left && s.x <= right && s.y >= top && s.y <= bottom;
          });
          if (insideMask.some((v) => v)) {
            const clone = ent.clone();
            clone.selected = true;
            this.targets.push({ ent, file, clone, base: snapshotEntity(ent), insideMask });
          }
        }
      }
      this.windowStart = null;
      this.windowCur = null;
      if (!this.targets.length) this.cleanup();
      else beginDragPreview(this.vm, this.targets.map((t) => t.ent));
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.windowStart && this.windowCur) {
      const x1 = this.windowStart.sx;
      const y1 = this.windowStart.sy;
      const x2 = this.windowCur.sx;
      const y2 = this.windowCur.sy;
      ctx.save();
      ctx.setLineDash([6, 3]);
      ctx.strokeStyle = 'rgba(104,211,145,0.6)';
      ctx.fillStyle = 'rgba(104,211,145,0.08)';
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.restore();
    }
    // Ghost of the stretched selection â€” drawn from the one-time clones so the
    // real entities stay untouched during the drag.
    for (const t of this.targets) {
      const fileVm = createProxyVm(this.vm, t.file.x, t.file.y, t.file.scale, t.file.scale, t.file.rotation);
      ctx.save();
      t.clone.draw(ctx, fileVm, t.file);
      t.clone.drawSelected(ctx, fileVm, t.file);
      ctx.restore();
    }
    if (this.basePoint) {
      const a = this.vm.w2s(this.basePoint.x, this.basePoint.y);
      const b = this.vm.w2s(this.cur.x, this.cur.y);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(240,160,48,0.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.restore();
    }
  }

  getAnchor(): IPoint | null { return this.basePoint; }

  getPhase(): string {
    if (!this.window) return 'select';
    if (!this.basePoint) return 'base';
    return 'second';
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.basePoint) return null;
    const dx = this.cur.x - this.basePoint.x;
    const dy = this.cur.y - this.basePoint.y;
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      primaryFieldKey: 'dx',
      fields: [
        { key: 'dx', label: 'Î”X', liveValue: formatLen(dx), width: 70 },
        { key: 'dy', label: 'Î”Y', liveValue: formatLen(dy), width: 70 },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (!this.basePoint) return false;
    const vec = parseCadVector(values['dx'] ?? '');
    let dx: number | null = null;
    let dy: number | null = null;
    if (vec && vec.kind === 'cartesian' && vec.dx !== undefined && vec.dy !== undefined) {
      dx = vec.dx; dy = vec.dy;
    } else if (vec && vec.kind === 'polar' && vec.length !== undefined && vec.angleDeg !== undefined) {
      const rad = vec.angleDeg * Math.PI / 180;
      dx = vec.length * Math.cos(rad);
      dy = vec.length * Math.sin(rad);
    } else {
      const x = evalExpression(values['dx'] ?? '');
      const y = evalExpression(values['dy'] ?? '');
      if (x !== null) dx = x;
      if (y !== null) dy = y;
    }
    if (dx === null || dy === null) return false;
    return this.applyDelta(dx, dy);
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.cleanup();
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  deactivate(): void {
    this.cleanup();
  }

  private cleanup(): void {
    endDragPreview(this.vm);
    this.windowStart = null;
    this.windowCur = null;
    this.window = null;
    this.basePoint = null;
    this.targets = [];
    this.lastDx = 0;
    this.lastDy = 0;
  }

  /** Return mutable vertex list for an entity (or empty if not stretchable). */
  private collectVertices(e: Entity): IPoint[] {
    const ent = e as any;
    switch (ent.type) {
      case 'LINE': return [{ x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 }];
      case 'POLYLINE': case 'LEADER': return ent.pts;
      case 'POINT': case 'TEXT': case 'XLINE': case 'INSERT':
        return [{ x: ent.x, y: ent.y }];
      case 'CIRCLE': case 'ARC': case 'ELLIPSE':
        return [{ x: ent.cx, y: ent.cy }];
      default: return [];
    }
  }

  private applyStretch(t: { ent: Entity; insideMask: boolean[] }, dx: number, dy: number): void {
    const ent = t.ent as any;
    switch (ent.type) {
      case 'LINE': {
        if (t.insideMask[0]) { ent.x1 += dx; ent.y1 += dy; }
        if (t.insideMask[1]) { ent.x2 += dx; ent.y2 += dy; }
        break;
      }
      case 'POLYLINE': case 'LEADER': {
        for (let i = 0; i < ent.pts.length; i++) {
          if (t.insideMask[i]) { ent.pts[i].x += dx; ent.pts[i].y += dy; }
        }
        break;
      }
      case 'CIRCLE': case 'ARC': case 'ELLIPSE': {
        if (t.insideMask[0]) { ent.cx += dx; ent.cy += dy; }
        break;
      }
      case 'POINT': case 'TEXT': case 'XLINE': case 'INSERT': {
        if (t.insideMask[0]) { ent.x += dx; ent.y += dy; }
        break;
      }
    }
    t.ent.refreshCaches();
  }
}
