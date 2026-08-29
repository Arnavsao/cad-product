import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { formatLen, formatAngleDeg } from '../draw/draw-utils';
import { drawInfoLabel, formatMeasure } from './measure-geom';

/** Snapshot of the most recent DIST measurement (AutoCAD keeps this in DISTANCE). */
export interface IDistResult {
  distance: number;
  dx: number;
  dy: number;
  angleDeg: number;
  from: IPoint;
  to: IPoint;
  /** Set when the measurement came from Multiple-point mode. */
  totalOfChain?: number;
}

/**
 * AutoCAD-style DIST (inquiry) command tool.
 *
 * Phase flow:
 *   1. `first`    — pick the first point (object snap applies via the host).
 *   2. `second`   — rubber-band measuring line; the click reports Δ, ΔX, ΔY
 *                  and the XY-plane angle, then returns to SELECT.
 *   3. `multiple` — entered with option [M]. Successive clicks accumulate a
 *                  running total across the chain; Enter reports the total.
 *
 * Strictly read-only: nothing is added to the document and nothing is pushed
 * onto the command stack.
 */
export class DistTool implements ITool {
  readonly name = 'dist';

  /** Last completed measurement — AutoCAD's DISTANCE system variable analogue. */
  static lastResult: IDistResult | null = null;

  private p1: IPoint | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  private hasCursor = false;

  /** Multiple-point mode ([M]) accumulates distance across a chain of picks. */
  private multiple = false;
  private chain: IPoint[] = [];
  private chainTotal = 0;

  constructor(private injector: Injector) {}

  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get notify() { return this.injector.get(NotificationService) as NotificationService; }

  activate(): void {
    this.reset();
    const last = this.vm.lastCursorWorld;
    if (last && Number.isFinite(last.x) && Number.isFinite(last.y)) {
      this.cur = { x: last.x, y: last.y };
    }
  }

  deactivate(): void {
    this.reset();
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number, _sx: number, _sy: number, e: MouseEvent): void {
    if (e && e.button !== 0) return;
    const pt: IPoint = { x: wx, y: wy };

    if (this.multiple) {
      if (this.chain.length) {
        const prev = this.chain[this.chain.length - 1];
        this.chainTotal += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      }
      this.chain.push(pt);
      this.p1 = pt;
      this.vm.markDirty();
      return;
    }

    if (!this.p1) {
      this.p1 = pt;
      this.vm.markDirty();
      return;
    }

    this.reportSegment(this.p1, pt);
    this.reset();
    this.tools.setTool('select');
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    this.hasCursor = true;
    if (this.p1) this.vm.markDirty();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.reset();
      this.tools.setTool('select');
      return;
    }
    if (e.key === 'Enter') {
      if (this.multiple && this.chain.length >= 2) this.reportChain();
      this.reset();
      this.tools.setTool('select');
    }
  }

  invokeOption(key: string): boolean {
    const k = (key || '').toUpperCase();
    if (k === 'M') {
      this.multiple = true;
      this.chain = this.p1 ? [this.p1] : [];
      this.chainTotal = 0;
      this.vm.markDirty();
      return true;
    }
    return false;
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.p1 || !this.hasCursor) return;

    ctx.save();

    // Already-measured chain segments (Multiple mode).
    if (this.multiple && this.chain.length > 1) {
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(240,160,48,0.65)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const s0 = this.vm.w2s(this.chain[0].x, this.chain[0].y);
      ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < this.chain.length; i++) {
        const s = this.vm.w2s(this.chain[i].x, this.chain[i].y);
        ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
    }

    const a = this.vm.w2s(this.p1.x, this.p1.y);
    const b = this.vm.w2s(this.cur.x, this.cur.y);

    // Live dashed measuring line.
    ctx.setLineDash([8, 4]);
    ctx.strokeStyle = 'rgba(240,160,48,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // Endpoint ticks.
    ctx.setLineDash([]);
    ctx.strokeStyle = '#63b3ed';
    ctx.beginPath();
    ctx.moveTo(a.x - 5, a.y); ctx.lineTo(a.x + 5, a.y);
    ctx.moveTo(a.x, a.y - 5); ctx.lineTo(a.x, a.y + 5);
    ctx.moveTo(b.x - 5, b.y); ctx.lineTo(b.x + 5, b.y);
    ctx.moveTo(b.x, b.y - 5); ctx.lineTo(b.x, b.y + 5);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.restore();

    const m = this.metrics();
    const lines = [
      `Δ  ${formatMeasure(m.distance)}`,
      `ΔX ${formatMeasure(m.dx)}   ΔY ${formatMeasure(m.dy)}`,
      `Angle ${formatAngleDeg(m.angleDeg)}°`,
    ];
    if (this.multiple) {
      lines.push(`Total ${formatMeasure(this.chainTotal + m.distance)}`);
    }
    drawInfoLabel(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2, lines);
  }

  getAnchor(): IPoint | null { return this.p1; }

  getPhase(): string | null {
    if (this.multiple) return 'multiple';
    return this.p1 ? 'second' : 'first';
  }

  getCommandId(): string { return 'dist'; }

  getStatusText(): string {
    return this.multiple
      ? 'DIST (Multiple) — click points to accumulate distance, Enter to total'
      : 'DIST — specify two points; [M] for multiple-point mode';
  }

  getCursor(): string { return 'crosshair'; }

  /** Read-only live readout — DIST never accepts typed geometry. */
  getDynamicInputState(): IDynamicInputState | null {
    if (!this.p1) return null;
    const m = this.metrics();
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      fields: [
        { key: 'distance', label: 'Distance', liveValue: formatLen(m.distance), readonly: true, width: 96 },
        { key: 'angle', label: 'Angle', suffix: '°', liveValue: formatAngleDeg(m.angleDeg), readonly: true, width: 72 },
        { key: 'dx', label: 'ΔX', liveValue: formatLen(m.dx), readonly: true, width: 80 },
        { key: 'dy', label: 'ΔY', liveValue: formatLen(m.dy), readonly: true, width: 80 },
      ],
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private metrics(): { distance: number; dx: number; dy: number; angleDeg: number } {
    if (!this.p1) return { distance: 0, dx: 0, dy: 0, angleDeg: 0 };
    const dx = this.cur.x - this.p1.x;
    const dy = this.cur.y - this.p1.y;
    return {
      distance: Math.hypot(dx, dy),
      dx,
      dy,
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  }

  private reportSegment(from: IPoint, to: IPoint): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    DistTool.lastResult = { distance, dx, dy, angleDeg, from, to };

    const text =
      `Distance = ${formatMeasure(distance)}, ` +
      `Angle in XY Plane = ${formatAngleDeg(angleDeg)}°, ` +
      `Angle from XY Plane = 0°\n` +
      `Delta X = ${formatMeasure(dx)},  Delta Y = ${formatMeasure(dy)},  Delta Z = 0.0000`;

    // AutoCAD echoes DIST into the text window; the console is the stand-in here.
    console.info('[DIST]\n' + text);
    this.notify.info(
      `Distance = ${formatMeasure(distance)}   Angle = ${formatAngleDeg(angleDeg)}°   ` +
      `ΔX = ${formatMeasure(dx)}   ΔY = ${formatMeasure(dy)}`,
      6000,
    );
  }

  private reportChain(): void {
    const from = this.chain[0];
    const to = this.chain[this.chain.length - 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    DistTool.lastResult = {
      distance: this.chainTotal,
      dx,
      dy,
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
      from,
      to,
      totalOfChain: this.chainTotal,
    };

    const text =
      `Points = ${this.chain.length}\n` +
      `Total distance = ${formatMeasure(this.chainTotal)}\n` +
      `Delta X (first→last) = ${formatMeasure(dx)},  Delta Y = ${formatMeasure(dy)}`;
    console.info('[DIST · Multiple]\n' + text);
    this.notify.info(
      `Total distance = ${formatMeasure(this.chainTotal)} over ${this.chain.length} points`,
      6000,
    );
  }

  private reset(): void {
    this.p1 = null;
    this.multiple = false;
    this.chain = [];
    this.chainTotal = 0;
    this.hasCursor = false;
  }
}
