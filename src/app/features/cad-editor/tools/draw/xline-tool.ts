import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { LineEntity } from '../../core/models/entity.model';
import { XLineEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';
import { evalExpression } from '../../core/utils/expression-parser';

enum XLineMode {
  POINT  = 'point',
  HOR    = 'hor',
  VER    = 'ver',
  ANG    = 'ang',
  BISECT = 'bisect',
  OFFSET = 'offset',
}

/** Construction line (XLINE) — base+direction or Hor/Ver/Ang/Bisect/Offset sub-modes. */
export class XLineTool implements ITool {
  readonly name: string = 'xline';

  private mode: XLineMode = XLineMode.POINT;
  private cur: IPoint = { x: 0, y: 0 };

  // POINT mode
  private base: IPoint | null = null;

  // ANG mode â€” angle in radians; null until user types it
  private angAngle: number | null = null;

  // BISECT mode
  private bisectVertex: IPoint | null = null;
  private bisectP1: IPoint | null = null;

  // OFFSET mode
  private offsetSource: { angle: number; refX: number; refY: number } | null = null;
  private offsetDist: number | null = null;

  constructor(private injector: Injector) {}

  private get doc()   { return this.injector.get(DocumentService)    as DocumentService; }
  private get vm()    { return this.injector.get(ViewModelService)    as ViewModelService; }
  private get cmds()  { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService)  as ToolManagerService; }
  private get dyn()   { return this.injector.get(DynamicInputService) as DynamicInputService; }

  activate(): void  { this.fullReset(); }
  deactivate(): void { this.fullReset(); }

  // â”€â”€â”€ Option dispatch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  invokeOption(key: string): boolean {
    switch (key) {
      case 'H': this.switchMode(XLineMode.HOR);    return true;
      case 'V': this.switchMode(XLineMode.VER);    return true;
      case 'A': this.switchMode(XLineMode.ANG);    return true;
      case 'B': this.switchMode(XLineMode.BISECT); return true;
      case 'O': this.switchMode(XLineMode.OFFSET); return true;
      default:  return false;
    }
  }

  private switchMode(m: XLineMode): void {
    this.mode = m;
    this.base = null;
    this.angAngle = null;
    this.bisectVertex = null;
    this.bisectP1 = null;
    this.offsetSource = null;
    this.offsetDist = null;
    this.dyn.clearEdits();
    this.vm.markDirty();
  }

  // â”€â”€â”€ Phase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getPhase(): string {
    switch (this.mode) {
      case XLineMode.POINT:
        return this.base ? 'through' : 'first';
      case XLineMode.HOR:
        return 'hor-point';
      case XLineMode.VER:
        return 'ver-point';
      case XLineMode.ANG:
        return this.angAngle === null ? 'ang-angle' : 'ang-point';
      case XLineMode.BISECT:
        if (!this.bisectVertex) return 'bisect-vertex';
        if (!this.bisectP1)     return 'bisect-angle1';
        return 'bisect-angle2';
      case XLineMode.OFFSET:
        if (!this.offsetSource)        return 'offset-pick';
        if (this.offsetDist === null)  return 'offset-dist';
        return 'offset-side';
    }
  }

  getAnchor(): IPoint | null {
    if (this.mode === XLineMode.POINT)  return this.base;
    if (this.mode === XLineMode.BISECT) return this.bisectVertex ?? this.bisectP1;
    return null;
  }

  // â”€â”€â”€ Dynamic input (ANG angle + OFFSET distance) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getDynamicInputState(): IDynamicInputState | null {
    if (this.mode === XLineMode.ANG && this.angAngle === null) {
      return {
        wx: this.cur.x, wy: this.cur.y,
        primaryFieldKey: 'angle',
        fields: [{ key: 'angle', label: 'Angle', liveValue: '0', suffix: 'Â°', width: 90 }],
      };
    }
    if (this.mode === XLineMode.OFFSET && this.offsetSource && this.offsetDist === null) {
      return {
        wx: this.cur.x, wy: this.cur.y,
        primaryFieldKey: 'dist',
        fields: [{ key: 'dist', label: 'Offset dist', liveValue: '', width: 100 }],
      };
    }
    return null;
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (this.mode === XLineMode.ANG && this.angAngle === null) {
      const n = evalExpression((values['angle'] ?? '').trim());
      if (n === null) return false;
      this.angAngle = (n * Math.PI) / 180;
      this.dyn.clearEdits();
      this.vm.markDirty();
      return true;
    }
    if (this.mode === XLineMode.OFFSET && this.offsetSource && this.offsetDist === null) {
      const n = evalExpression((values['dist'] ?? '').trim());
      if (n === null || n <= 0) return false;
      this.offsetDist = n;
      this.dyn.clearEdits();
      this.vm.markDirty();
      return true;
    }
    return false;
  }

  // â”€â”€â”€ Mouse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;
    switch (this.mode) {
      case XLineMode.POINT:  this.handlePoint(wx, wy);           break;
      case XLineMode.HOR:    this.placeXLine(wx, wy, 0);         break;
      case XLineMode.VER:    this.placeXLine(wx, wy, Math.PI/2); break;
      case XLineMode.ANG:    this.handleAng(wx, wy);             break;
      case XLineMode.BISECT: this.handleBisect(wx, wy);          break;
      case XLineMode.OFFSET: this.handleOffset(wx, wy, sx, sy);  break;
    }
    this.vm.markDirty();
  }

  // â”€â”€â”€ Mode handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private handlePoint(wx: number, wy: number): void {
    if (!this.base) {
      this.base = { x: wx, y: wy };
      return;
    }
    const angle = Math.atan2(wy - this.base.y, wx - this.base.x);
    this.placeXLine(this.base.x, this.base.y, angle);
    // Keep base â€” user can pick more through-points (AutoCAD pattern)
  }

  private handleAng(wx: number, wy: number): void {
    if (this.angAngle === null) return; // angle not entered yet
    this.placeXLine(wx, wy, this.angAngle);
  }

  private handleBisect(wx: number, wy: number): void {
    if (!this.bisectVertex) { this.bisectVertex = { x: wx, y: wy }; return; }
    if (!this.bisectP1)     { this.bisectP1     = { x: wx, y: wy }; return; }
    // Compute angular bisector of two arms from vertex
    const v  = this.bisectVertex;
    const p1 = this.bisectP1;
    const d1x = p1.x - v.x, d1y = p1.y - v.y;
    const d2x = wx   - v.x, d2y = wy   - v.y;
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-9 || l2 < 1e-9) return;
    const bx = d1x/l1 + d2x/l2;
    const by = d1y/l1 + d2y/l2;
    this.placeXLine(v.x, v.y, Math.atan2(by, bx));
    // Reset for next bisector
    this.bisectVertex = null;
    this.bisectP1     = null;
  }

  private handleOffset(wx: number, wy: number, sx: number, sy: number): void {
    // Phase 1: pick a source line entity
    if (!this.offsetSource) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (!hit) return;
      const ent = hit.entity;
      let angle: number, refX: number, refY: number;
      if (ent instanceof LineEntity) {
        angle = Math.atan2(ent.y2 - ent.y1, ent.x2 - ent.x1);
        refX = ent.x1; refY = ent.y1;
      } else if (ent instanceof XLineEntity) {
        angle = ent.angle; refX = ent.x; refY = ent.y;
      } else { return; }
      this.offsetSource = { angle, refX, refY };
      return;
    }
    // Phase 2: distance entered via commitDynamicInput â€” wait for it
    if (this.offsetDist === null) return;
    // Phase 3: click to choose side
    const { angle, refX, refY } = this.offsetSource;
    const perpX = -Math.sin(angle);
    const perpY =  Math.cos(angle);
    const dot  = (wx - refX) * perpX + (wy - refY) * perpY;
    const sign = dot >= 0 ? 1 : -1;
    this.placeXLine(refX + perpX * sign * this.offsetDist, refY + perpY * sign * this.offsetDist, angle);
    // Reset for another offset from same or new source
    this.offsetSource = null;
    this.offsetDist   = null;
  }

  private placeXLine(bx: number, by: number, angle: number): void {
    const e = new XLineEntity(bx, by, angle);
    e.layer = this.doc.activeLayer;
    this.cmds.push(new AddEntityCmd(e, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
  }

  // â”€â”€â”€ Preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  drawPreview(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([6, 4]);

    switch (this.mode) {
      case XLineMode.POINT:
        if (this.base)
          this.strokeInfiniteLine(ctx, this.base.x, this.base.y,
            Math.atan2(this.cur.y - this.base.y, this.cur.x - this.base.x));
        break;
      case XLineMode.HOR:
        this.strokeInfiniteLine(ctx, this.cur.x, this.cur.y, 0);
        break;
      case XLineMode.VER:
        this.strokeInfiniteLine(ctx, this.cur.x, this.cur.y, Math.PI / 2);
        break;
      case XLineMode.ANG:
        if (this.angAngle !== null)
          this.strokeInfiniteLine(ctx, this.cur.x, this.cur.y, this.angAngle);
        break;
      case XLineMode.BISECT:
        this.drawBisectPreview(ctx);
        break;
      case XLineMode.OFFSET:
        this.drawOffsetPreview(ctx);
        break;
    }
    ctx.restore();
  }

  private drawBisectPreview(ctx: CanvasRenderingContext2D): void {
    const v = this.bisectVertex;
    if (!v) return;
    const vs = this.vm.w2s(v.x, v.y);
    const cs = this.vm.w2s(this.cur.x, this.cur.y);
    // First arm (vertex â†’ p1)
    if (this.bisectP1) {
      const p1s = this.vm.w2s(this.bisectP1.x, this.bisectP1.y);
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(vs.x, vs.y); ctx.lineTo(p1s.x, p1s.y); ctx.stroke();
    }
    // Second arm (vertex â†’ cursor)
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(vs.x, vs.y); ctx.lineTo(cs.x, cs.y); ctx.stroke();
    // Bisector preview when both arms are defined
    if (this.bisectP1) {
      const p1 = this.bisectP1;
      const d1x = p1.x - v.x, d1y = p1.y - v.y;
      const d2x = this.cur.x - v.x, d2y = this.cur.y - v.y;
      const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
      if (l1 > 1e-9 && l2 > 1e-9) {
        ctx.setLineDash([8, 4]);
        ctx.strokeStyle = 'rgba(240,160,48,1)';
        this.strokeInfiniteLine(ctx, v.x, v.y,
          Math.atan2(d1y/l1 + d2y/l2, d1x/l1 + d2x/l2));
      }
    }
  }

  private drawOffsetPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.offsetSource || this.offsetDist === null) return;
    const { angle, refX, refY } = this.offsetSource;
    const perpX = -Math.sin(angle);
    const perpY =  Math.cos(angle);
    const dot  = (this.cur.x - refX) * perpX + (this.cur.y - refY) * perpY;
    const sign = dot >= 0 ? 1 : -1;
    this.strokeInfiniteLine(ctx,
      refX + perpX * sign * this.offsetDist,
      refY + perpY * sign * this.offsetDist,
      angle);
  }

  private strokeInfiniteLine(ctx: CanvasRenderingContext2D, bx: number, by: number, angle: number): void {
    const L  = 1e6;
    const dx = Math.cos(angle) * L;
    const dy = Math.sin(angle) * L;
    const a  = this.vm.w2s(bx - dx, by - dy);
    const b  = this.vm.w2s(bx + dx, by + dy);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // â”€â”€â”€ Keyboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      const wasIdle = this.isIdle();
      this.switchMode(XLineMode.POINT);
      if (wasIdle) this.tools.setTool('select');
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      this.switchMode(XLineMode.POINT);
      this.tools.setTool('select');
      e.preventDefault();
    }
  }

  private isIdle(): boolean {
    return this.mode === XLineMode.POINT && !this.base;
  }

  private fullReset(): void {
    this.mode = XLineMode.POINT;
    this.base = null;
    this.angAngle = null;
    this.bisectVertex = null;
    this.bisectP1 = null;
    this.offsetSource = null;
    this.offsetDist = null;
    this.vm.markDirty();
  }
}

/** XL-H — Horizontal construction line. Single click places it immediately. */
export class XLineHorTool extends XLineTool {
  override readonly name = 'xline_hor';

  override activate(): void {
    super.activate();
    // Start directly in horizontal mode — no mode-select prompt needed.
    this.invokeOption('H');
  }
}

/** XL-V — Vertical construction line. Single click places it immediately. */
export class XLineVerTool extends XLineTool {
  override readonly name = 'xline_ver';

  override activate(): void {
    super.activate();
    // Start directly in vertical mode — no mode-select prompt needed.
    this.invokeOption('V');
  }
}
