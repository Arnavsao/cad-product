import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { hitTestAll } from '../select/select-tool';
import { formatLen } from '../draw/draw-utils';
import {
  chainLength,
  drawInfoLabel,
  entityArea,
  entityLength,
  formatArea,
  formatMeasure,
  polygonArea,
  polygonCentroid,
  polygonPerimeter,
  tessellateEntity,
} from './measure-geom';

/** Running accumulation mode, mirroring AutoCAD's AREA Add/Subtract. */
type AreaOp = 'none' | 'add' | 'subtract';

/**
 * AutoCAD-style AREA (inquiry) command tool.
 *
 * Phase flow:
 *   1. `first`  — pick the first corner of the measured polygon.
 *   2. `next`   — pick successive corners; the preview fills the polygon and
 *                 shows the running area + perimeter at its centroid.
 *                 Enter closes the polygon and reports Area and Perimeter.
 *   3. `object` — entered with option [O]; the next click picks a single
 *                 entity and reports its area and perimeter/circumference.
 *
 * Options [A]dd and [S]ubtract switch on AutoCAD's accumulation mode: every
 * subsequent polygon or object is added to / subtracted from a running total
 * that is shown in the preview label and reported on exit.
 *
 * Strictly read-only: nothing is added to the document and nothing is pushed
 * onto the command stack.
 */
export class AreaTool implements ITool {
  readonly name = 'area';

  /** Last reported area, in square drawing units (AutoCAD's AREA sysvar). */
  static lastArea = 0;
  /** Last reported perimeter, in drawing units (AutoCAD's PERIMETER sysvar). */
  static lastPerimeter = 0;

  private mode: 'polygon' | 'object' = 'polygon';
  private op: AreaOp = 'none';
  private pts: IPoint[] = [];
  private cur: IPoint = { x: 0, y: 0 };
  private hasCursor = false;
  private runningTotal = 0;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
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

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e && e.button !== 0) return;

    if (this.mode === 'object') {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (!hit) {
        this.notify.warning('No object found at that point.');
        return;
      }
      this.reportObject(hit.entity);
      return;
    }

    this.pts.push({ x: wx, y: wy });
    this.vm.markDirty();
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    this.hasCursor = true;
    if (this.pts.length || this.mode === 'object') this.vm.markDirty();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.reset();
      this.tools.setTool('select');
      return;
    }
    if (e.key !== 'Enter') return;

    if (this.mode === 'polygon' && this.pts.length >= 3) {
      this.reportPolygon();
      this.pts = [];
      if (this.op === 'none') {
        this.finish();
      } else {
        this.vm.markDirty();
      }
      return;
    }

    // Enter with nothing pending — report the accumulated total and leave.
    if (this.op !== 'none') this.reportTotal();
    this.finish();
  }

  invokeOption(key: string): boolean {
    const k = (key || '').toUpperCase();
    if (k === 'O') {
      this.mode = 'object';
      this.pts = [];
      this.vm.markDirty();
      return true;
    }
    if (k === 'A') {
      this.op = 'add';
      this.vm.markDirty();
      return true;
    }
    if (k === 'S') {
      this.op = 'subtract';
      this.vm.markDirty();
      return true;
    }
    return false;
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.mode === 'object') {
      if (this.hasCursor && this.op !== 'none') {
        const s = this.vm.w2s(this.cur.x, this.cur.y);
        drawInfoLabel(ctx, s.x, s.y, [
          `Mode ${this.op === 'add' ? 'ADD' : 'SUBTRACT'} (object)`,
          `Total area ${formatArea(this.runningTotal)}`,
        ]);
      }
      return;
    }

    if (!this.pts.length) return;

    const ring = this.hasCursor ? [...this.pts, this.cur] : [...this.pts];

    ctx.save();
    ctx.setLineDash([]);

    // Translucent fill of the polygon under construction.
    if (ring.length >= 3) {
      ctx.beginPath();
      const s0 = this.vm.w2s(ring[0].x, ring[0].y);
      ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < ring.length; i++) {
        const s = this.vm.w2s(ring[i].x, ring[i].y);
        ctx.lineTo(s.x, s.y);
      }
      ctx.closePath();
      ctx.fillStyle = this.op === 'subtract' ? 'rgba(232,86,86,0.16)' : 'rgba(99,179,237,0.18)';
      ctx.fill();
    }

    // Committed edges (solid) then the rubber-band edge (dashed).
    ctx.strokeStyle = 'rgba(240,160,48,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const c0 = this.vm.w2s(this.pts[0].x, this.pts[0].y);
    ctx.moveTo(c0.x, c0.y);
    for (let i = 1; i < this.pts.length; i++) {
      const s = this.vm.w2s(this.pts[i].x, this.pts[i].y);
      ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();

    if (this.hasCursor) {
      const from = this.vm.w2s(this.pts[this.pts.length - 1].x, this.pts[this.pts.length - 1].y);
      const to = this.vm.w2s(this.cur.x, this.cur.y);
      const back = this.vm.w2s(this.pts[0].x, this.pts[0].y);
      ctx.setLineDash([8, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      if (this.pts.length >= 2) ctx.lineTo(back.x, back.y);
      ctx.stroke();
    }

    // Vertex markers.
    ctx.setLineDash([]);
    ctx.fillStyle = '#63b3ed';
    for (const p of this.pts) {
      const s = this.vm.w2s(p.x, p.y);
      ctx.fillRect(s.x - 2.5, s.y - 2.5, 5, 5);
    }

    ctx.setLineDash([]);
    ctx.restore();

    const area = ring.length >= 3 ? polygonArea(ring) : 0;
    const perim = ring.length >= 3 ? polygonPerimeter(ring) : chainLength(ring);
    const centroid = polygonCentroid(ring);
    const cs = this.vm.w2s(centroid.x, centroid.y);

    const lines = [
      `Area      ${formatArea(area)}`,
      `Perimeter ${formatMeasure(perim)}`,
    ];
    if (this.op !== 'none') {
      const signed = this.op === 'subtract' ? -area : area;
      lines.push(`Mode ${this.op === 'add' ? 'ADD' : 'SUBTRACT'}`);
      lines.push(`Total     ${formatArea(this.runningTotal + signed)}`);
    }
    drawInfoLabel(ctx, cs.x, cs.y, lines);
  }

  getAnchor(): IPoint | null {
    return this.pts.length ? this.pts[this.pts.length - 1] : null;
  }

  getPhase(): string | null {
    if (this.mode === 'object') return 'object';
    return this.pts.length ? 'next' : 'first';
  }

  getCommandId(): string { return 'area'; }

  getCursor(): string { return this.mode === 'object' ? 'pickbox' : 'crosshair'; }

  getStatusText(): string {
    const suffix = this.op === 'none' ? '' : ` — ${this.op === 'add' ? 'ADD' : 'SUBTRACT'} mode, total ${formatArea(this.runningTotal)}`;
    return this.mode === 'object'
      ? `AREA (Object) — select an object${suffix}`
      : `AREA — pick corner points, Enter to close${suffix}`;
  }

  /** Read-only live readout — AREA never accepts typed geometry. */
  getDynamicInputState(): IDynamicInputState | null {
    if (this.mode === 'object' || !this.pts.length) return null;
    const ring = this.hasCursor ? [...this.pts, this.cur] : [...this.pts];
    const area = ring.length >= 3 ? polygonArea(ring) : 0;
    const perim = ring.length >= 3 ? polygonPerimeter(ring) : chainLength(ring);
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      fields: [
        { key: 'area', label: 'Area', liveValue: formatArea(area), readonly: true, width: 120 },
        { key: 'perimeter', label: 'Perimeter', liveValue: formatLen(perim), readonly: true, width: 110 },
      ],
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private reportPolygon(): void {
    const area = polygonArea(this.pts);
    const perim = polygonPerimeter(this.pts);
    this.accumulate(area);
    this.publish('AREA', [
      `Area = ${formatArea(area)}, Perimeter = ${formatMeasure(perim)}`,
      `Vertices = ${this.pts.length}`,
    ], area, perim);
  }

  private reportObject(ent: Entity): void {
    const area = entityArea(ent);
    const len = entityLength(ent);
    const lengthLabel = ent.type === 'CIRCLE' ? 'Circumference' : 'Perimeter';

    if (area === null && len === null) {
      this.notify.warning(`${ent.type} has no measurable area or length.`);
      return;
    }

    if (area !== null) this.accumulate(area);

    const lines = [
      `Object = ${ent.type} (handle ${ent.handle ?? ent.id})`,
      `Area = ${area === null ? 'n/a' : formatArea(area)}, ` +
      `${lengthLabel} = ${len === null ? 'n/a' : formatMeasure(len)}`,
    ];
    // Fallback outline point count is useful when the area came from tessellation.
    const pts = tessellateEntity(ent);
    if (pts) lines.push(`Outline points = ${pts.length}`);

    this.publish('AREA (Object)', lines, area ?? 0, len ?? 0);

    if (this.op === 'none') this.finish();
  }

  private reportTotal(): void {
    this.publish('AREA (Total)', [
      `Total area = ${formatArea(this.runningTotal)}`,
    ], this.runningTotal, AreaTool.lastPerimeter);
  }

  private accumulate(area: number): void {
    if (this.op === 'add') this.runningTotal += area;
    else if (this.op === 'subtract') this.runningTotal -= area;
  }

  /**
   * AutoCAD's AREA echoes into the text window. NotificationService only
   * carries a single-line toast, so the full report goes to `console.info`
   * and a condensed line goes to the toast.
   */
  private publish(title: string, lines: string[], area: number, perimeter: number): void {
    AreaTool.lastArea = area;
    AreaTool.lastPerimeter = perimeter;
    const full = lines.join('\n');
    console.info(`[${title}]\n${full}`);
    const totalSuffix = this.op === 'none' ? '' : `   Total = ${formatArea(this.runningTotal)}`;
    this.notify.info(lines[0] + totalSuffix, 6000);
  }

  private finish(): void {
    this.reset();
    this.tools.setTool('select');
  }

  private reset(): void {
    this.mode = 'polygon';
    this.op = 'none';
    this.pts = [];
    this.hasCursor = false;
    this.runningTotal = 0;
  }
}
