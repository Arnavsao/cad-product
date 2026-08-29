import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { PolylineEntity, IPoint, arcGeomFromBulge } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { evalExpression, parseCadVector } from '../../core/utils/expression-parser';
import { formatLen, formatAngleDeg } from './draw-utils';

/** Polyline vertex with optional bulge for arc segments */
interface PolylineVertex extends IPoint {
  bulge?: number; // 0 or undefined = line, non-zero = arc
}

/** Drawing mode for polyline segment */
enum SegmentMode {
  LINE = 'line',
  ARC = 'arc',
}

/** Arc geometry computed for preview and commit */
interface ArcGeom {
  cx: number; cy: number; r: number;
  startA: number; endA: number; ccw: boolean;
}

export class PolylineTool implements ITool {
  readonly name = 'polyline';
  private vertices: PolylineVertex[] = [];
  private cur: IPoint = { x: 0, y: 0 };
  private mode: SegmentMode = SegmentMode.LINE;
  private waitingForOption = false;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  onMouseDown(wx: number, wy: number): void {
    if (this.waitingForOption) return;

    const next = this.vertices.length ? this.previewEnd() : { x: wx, y: wy };

    if (this.mode === SegmentMode.ARC && this.vertices.length > 0) {
      const lastPt = this.vertices[this.vertices.length - 1];
      const tangent = this.lastTangent();
      this.vertices[this.vertices.length - 1].bulge = this.tangentArcBulge(lastPt, next, tangent);
    }

    this.vertices.push({ x: next.x, y: next.y, bulge: 0 });
    this.dyn.clearEdits();
    this.vm.markDirty();
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.vertices.length) this.vm.markDirty();
  }

  private commit(closed: boolean): void {
    if (this.vertices.length < 2) return;

    const pts = this.vertices.map(v => ({ x: v.x, y: v.y }));
    const entity = new PolylineEntity(pts, closed);
    entity.layer = this.doc.activeLayer;

    // Attach bulge values â€” only if at least one arc segment exists
    const hasBulge = this.vertices.some(v => v.bulge && Math.abs(v.bulge) > 1e-9);
    if (hasBulge) {
      entity.bulges = this.vertices.map(v => v.bulge ?? 0);
    }

    this.cmds.push(new AddEntityCmd(entity, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));

    this.vertices = [];
    this.mode = SegmentMode.LINE;
    this.waitingForOption = false;
    this.dyn.clearEdits();
    this.vm.markDirty();
  }

  // â”€â”€ Arc geometry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Get the tangent direction of the last committed segment.
   * Used to draw the next arc tangent to the previous geometry (AutoCAD behaviour).
   */
  private lastTangent(): IPoint {
    if (this.vertices.length >= 2) {
      const prev = this.vertices[this.vertices.length - 2];
      const last = this.vertices[this.vertices.length - 1];
      const dx = last.x - prev.x;
      const dy = last.y - prev.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-9) return { x: dx / len, y: dy / len };
    }
    // No previous segment: default to horizontal
    return { x: 1, y: 0 };
  }

  /**
   * Compute a circular arc from `start` to `end` that is tangent to `tangent`
   * at the start point.  Returns null when start and end are collinear with
   * the tangent (i.e. the arc degenerates to a straight line).
   *
   * Math:  the centre lies on the line `start + t * n` where n âŠ¥ tangent,
   *        AND on the perpendicular bisector of the chord startâ†’end.
   *   âŸ¹  t = â€“(|chord|Â²) / (2 Â· chord Â· n)
   */
  private tangentArcGeom(start: IPoint, end: IPoint, tangent: IPoint): ArcGeom | null {
    // Normal to tangent (pointing left of travel direction)
    const nx = -tangent.y;
    const ny =  tangent.x;

    const dx = start.x - end.x;
    const dy = start.y - end.y;
    const denom = 2 * (dx * nx + dy * ny);

    if (Math.abs(denom) < 1e-9) return null; // degenerate: straight line

    const t = -(dx * dx + dy * dy) / denom;
    const cx = start.x + t * nx;
    const cy = start.y + t * ny;
    const r  = Math.hypot(cx - start.x, cy - start.y);

    const startA = Math.atan2(start.y - cy, start.x - cx);
    const endA   = Math.atan2(end.y   - cy, end.x   - cx);
    // t > 0  â†”  centre is to the left of the tangent direction  â†”  CCW arc
    const ccw = t > 0;

    return { cx, cy, r, startA, endA, ccw };
  }

  /** Convert a tangent arc to an AutoCAD bulge value. */
  private tangentArcBulge(start: IPoint, end: IPoint, tangent: IPoint): number {
    const arc = this.tangentArcGeom(start, end, tangent);
    if (!arc) return 0;

    let startA = arc.startA;
    let endA   = arc.endA;
    let sweep: number;

    if (arc.ccw) {
      sweep = endA - startA;
      if (sweep <= 0) sweep += 2 * Math.PI;
    } else {
      sweep = startA - endA;
      if (sweep <= 0) sweep += 2 * Math.PI;
      sweep = -sweep; // CW â†’ negative sweep
    }

    return Math.tan(sweep / 4); // AutoCAD bulge formula
  }

  // â”€â”€ Canvas drawing helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Stroke an arc segment on the canvas from `start` to `end` using a DXF bulge.
   * The canvas arc() call uses negated world angles to account for the y-axis flip.
   */
  private strokeArcSegment(ctx: CanvasRenderingContext2D, start: IPoint, end: IPoint, bulge: number): void {
    if (Math.abs(bulge) < 1e-9) {
      const p = this.vm.w2s(end.x, end.y);
      ctx.lineTo(p.x, p.y);
      return;
    }
    const g = arcGeomFromBulge(start, end, bulge);
    if (!g) {
      const p = this.vm.w2s(end.x, end.y);
      ctx.lineTo(p.x, p.y);
      return;
    }
    this.canvasArc(ctx, g);
  }

  /**
   * Stroke a tangent arc preview from `start` to `end`.
   * Uses the last committed segment's direction as the tangent at `start`.
   */
  private strokeTangentArc(ctx: CanvasRenderingContext2D, start: IPoint, end: IPoint): void {
    const tangent = this.lastTangent();
    const g = this.tangentArcGeom(start, end, tangent);
    if (!g) {
      const p = this.vm.w2s(end.x, end.y);
      ctx.lineTo(p.x, p.y);
      return;
    }
    this.canvasArc(ctx, g);
  }

  /** Draw a circular arc on the canvas using pre-computed ArcGeom. */
  private canvasArc(ctx: CanvasRenderingContext2D, g: ArcGeom): void {
    const centerS = this.vm.w2s(g.cx, g.cy);
    const startS  = this.vm.w2s(
      g.cx + g.r * Math.cos(g.startA),
      g.cy + g.r * Math.sin(g.startA),
    );
    // Screen radius derived from transformed points avoids scale ambiguity
    const rScreen = Math.hypot(startS.x - centerS.x, startS.y - centerS.y);
    // Negate world angles to flip y-axis for canvas; CCW world = CCW in negated angles
    ctx.arc(centerS.x, centerS.y, rScreen, -g.startA, -g.endA, g.ccw);
  }

  // â”€â”€ Preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private lastAnchor(): IPoint | null {
    return this.vertices.length ? this.vertices[this.vertices.length - 1] : null;
  }

  private effectiveLengthAngle(): { length: number; angleDeg: number } {
    const anchor = this.lastAnchor();
    if (!anchor) return { length: 0, angleDeg: 0 };
    const dx = this.cur.x - anchor.x;
    const dy = this.cur.y - anchor.y;
    let length   = Math.hypot(dx, dy);
    let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    const edits  = this.dyn.editedValues();
    const el = edits['length'];
    if (el !== undefined) { const n = evalExpression(el); if (n !== null && n > 0) length = n; }
    const ea = edits['angle'];
    if (ea !== undefined) { const n = evalExpression(ea); if (n !== null) angleDeg = n; }
    return { length, angleDeg };
  }

  private previewEnd(): IPoint {
    const anchor = this.lastAnchor();
    if (!anchor) return this.cur;
    const { length, angleDeg } = this.effectiveLengthAngle();
    if (length <= 0) return this.cur;
    const rad = angleDeg * Math.PI / 180;
    return { x: anchor.x + length * Math.cos(rad), y: anchor.y + length * Math.sin(rad) };
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.vertices.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();

    // Committed segments
    const first = this.vm.w2s(this.vertices[0].x, this.vertices[0].y);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < this.vertices.length; i++) {
      const prev = this.vertices[i - 1];
      const curr = this.vertices[i];
      if (prev.bulge && Math.abs(prev.bulge) > 1e-9) {
        this.strokeArcSegment(ctx, prev, curr, prev.bulge);
      } else {
        const p = this.vm.w2s(curr.x, curr.y);
        ctx.lineTo(p.x, p.y);
      }
    }

    // Live preview segment to cursor
    if (!this.waitingForOption) {
      const lastVert = this.vertices[this.vertices.length - 1];
      const end = this.previewEnd();

      if (this.mode === SegmentMode.ARC) {
        this.strokeTangentArc(ctx, lastVert, end);
      } else {
        const tail = this.vm.w2s(end.x, end.y);
        ctx.lineTo(tail.x, tail.y);
      }
    }

    ctx.stroke();

    // Control-point dots
    ctx.setLineDash([]);
    ctx.fillStyle = '#f0a030';
    for (const p of this.vertices) {
      const s = this.vm.w2s(p.x, p.y);
      ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.restore();
  }

  // â”€â”€ Dynamic input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getDynamicInputState(): IDynamicInputState | null {
    if (this.waitingForOption) {
      return {
        wx: 0, wy: 0,
        primaryFieldKey: 'opt',
        fields: [{
          key: 'opt',
          label: `Enter option [[L]ine/[A]rc/[C]lose/[U]ndo] (Mode: ${this.mode.toUpperCase()})`,
          liveValue: '',
          width: 200,
        }],
      };
    }

    if (!this.lastAnchor()) return null;
    const { length, angleDeg } = this.effectiveLengthAngle();
    const end = this.previewEnd();
    const modeLabel = this.mode === SegmentMode.ARC ? ' (Arc)' : '';

    return {
      wx: end.x, wy: end.y,
      primaryFieldKey: 'length',
      fields: [
        { key: 'length', label: `Length${modeLabel}`, liveValue: formatLen(length),       width: 80 },
        { key: 'angle',  label: 'Angle',               liveValue: formatAngleDeg(angleDeg), suffix: 'Â°', width: 60 },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (this.waitingForOption) {
      const opt = (values['opt'] || '').toLowerCase().trim();
      if      (opt === 'l') { this.mode = SegmentMode.LINE; }
      else if (opt === 'a') { this.mode = SegmentMode.ARC; }
      else if (opt === 'c') { this.waitingForOption = false; this.commit(true); this.tools.setTool('select'); return true; }
      else if (opt === 'u') { if (this.vertices.length > 0) this.vertices.pop(); }
      else                  { return false; }
      this.waitingForOption = false;
      this.dyn.clearEdits();
      this.vm.markDirty();
      return true;
    }

    const anchor = this.lastAnchor();
    if (!anchor) return false;

    const lengthRaw = (values['length'] ?? '').trim().toLowerCase();

    // Single-character option shortcuts
    if (lengthRaw.length === 1) {
      const char = lengthRaw;
      if      (char === 'a') { this.mode = SegmentMode.ARC;  this.dyn.clearEdits(); this.vm.markDirty(); return true; }
      else if (char === 'l') { this.mode = SegmentMode.LINE; this.dyn.clearEdits(); this.vm.markDirty(); return true; }
      else if (char === 'u') { if (this.vertices.length > 0) { this.vertices.pop(); this.dyn.clearEdits(); this.vm.markDirty(); } return true; }
      else if (char === 'c') { this.commit(true); this.tools.setTool('select'); return true; }
    }

    // Parse coordinate / polar input
    const vec = parseCadVector(lengthRaw);
    let endpoint: IPoint;

    if (vec) {
      if (vec.kind === 'cartesian' && vec.dx !== undefined && vec.dy !== undefined) {
        endpoint = { x: anchor.x + vec.dx, y: anchor.y + vec.dy };
      } else if (vec.kind === 'polar' && vec.length !== undefined && vec.angleDeg !== undefined) {
        const rad = vec.angleDeg * Math.PI / 180;
        endpoint = { x: anchor.x + vec.length * Math.cos(rad), y: anchor.y + vec.length * Math.sin(rad) };
      } else {
        return false;
      }
    } else {
      endpoint = this.previewEnd();
    }

    if (Math.hypot(endpoint.x - anchor.x, endpoint.y - anchor.y) < 1e-9) return false;

    if (this.mode === SegmentMode.ARC && this.vertices.length > 0) {
      const tangent = this.lastTangent();
      this.vertices[this.vertices.length - 1].bulge = this.tangentArcBulge(anchor, endpoint, tangent);
    }

    this.vertices.push({ x: endpoint.x, y: endpoint.y, bulge: 0 });
    this.dyn.clearEdits();
    this.vm.markDirty();
    return true;
  }

  // â”€â”€ Keyboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      if (this.waitingForOption) {
        this.waitingForOption = false;
        this.dyn.clearEdits();
        this.vm.markDirty();
      } else {
        this.commit(false);
        this.tools.setTool('select');
      }
    } else if (e.key === 'Escape') {
      this.vertices = [];
      this.mode = SegmentMode.LINE;
      this.waitingForOption = false;
      this.dyn.clearEdits();
      this.vm.markDirty();
      this.tools.setTool('select');
    } else if ((e.key === 'c' || e.key === 'C') && !this.waitingForOption) {
      this.commit(true);
      this.tools.setTool('select');
    } else if ((e.key === 'u' || e.key === 'U') && !this.waitingForOption && this.vertices.length > 0) {
      this.vertices.pop();
      this.dyn.clearEdits();
      this.vm.markDirty();
    } else if ((e.key === 'l' || e.key === 'L') && !this.waitingForOption && this.vertices.length > 0) {
      this.mode = SegmentMode.LINE;
      this.dyn.clearEdits();
      this.vm.markDirty();
    } else if ((e.key === 'a' || e.key === 'A') && !this.waitingForOption && this.vertices.length > 0) {
      this.mode = SegmentMode.ARC;
      this.dyn.clearEdits();
      this.vm.markDirty();
    } else if (e.key === 'Tab' && this.vertices.length > 0) {
      this.waitingForOption = !this.waitingForOption;
      this.dyn.clearEdits();
      this.vm.markDirty();
    }
  }

  getAnchor(): IPoint | null { return this.lastAnchor(); }

  getPhase(): string | null {
    return this.vertices.length ? 'next' : 'first';
  }

  invokeOption(key: string): boolean {
    switch (key.toUpperCase()) {
      case 'L': this.mode = SegmentMode.LINE; this.dyn.clearEdits(); this.vm.markDirty(); return true;
      case 'A': this.mode = SegmentMode.ARC;  this.dyn.clearEdits(); this.vm.markDirty(); return true;
      case 'C': this.commit(true); this.tools.setTool('select'); return true;
      case 'U':
        if (this.vertices.length > 0) { this.vertices.pop(); this.dyn.clearEdits(); this.vm.markDirty(); }
        return true;
      default: return false;
    }
  }

  deactivate(): void {
    this.vertices = [];
    this.mode = SegmentMode.LINE;
    this.waitingForOption = false;
    this.dyn.clearEdits();
    this.dyn.setState(null);
    this.vm.markDirty();
  }
}
