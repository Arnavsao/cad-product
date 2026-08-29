import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import {
  LineEntity,
  CircleEntity,
  ArcEntity,
  PolylineEntity,
  IPoint,
} from '../../core/models/entity.model';
import { EllipseEntity, XLineEntity, SplineEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd, DeleteEntityCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';
import { evalExpression } from '../../core/utils/expression-parser';
import {
  pointToSegmentDistance,
  pointToArcDistance,
  signedArea,
  pointInPolygon,
} from '../geometry-utils';
import { formatLen } from '../draw/draw-utils';

/** Entity types currently supported by the offset operation. */
type OffsetSource = LineEntity | CircleEntity | ArcEntity | PolylineEntity | EllipseEntity | XLineEntity | SplineEntity;

/**
 * AutoCAD-style OFFSET tool.
 *
 *   Phase 1 â€” pick source entity. Hover highlight on candidates. DI is
 *             hidden so the source-pick UX stays clean.
 *
 *   Phase 2 â€” cursor controls BOTH side and magnitude. The Dynamic Input
 *             panel below the cursor shows "Offset Distance" with the live
 *             value, matching Rect / Line / Circle UX. Distance is whichever
 *             the user typed into the DI field; if the field is empty, the
 *             distance is derived from the cursor's perpendicular distance
 *             to the source. Either way the preview updates every frame.
 *             Click commits; the tool loops back to source-pick.
 *
 *   For closed shapes (rectangles, closed polylines, circles, ellipses) the
 *   tool detects whether the cursor is INSIDE or OUTSIDE the shape and
 *   offsets the entire boundary accordingly â€” moving every edge / radius in
 *   the same direction. This relies on `signedArea` to pick orientation
 *   and `pointInPolygon` (both in `geometry-utils`) so the algorithm works
 *   uniformly on freshly drawn rectangles, closed polylines, and DXF-
 *   imported geometry of the same kinds.
 *
 *   `Esc` un-picks (or exits if already idle).
 *
 *   Preview is fully transient: a fresh entity object is constructed inside
 *   drawPreview each frame and discarded immediately â€” never inserted into
 *   `file.entities` until the commit click pushes AddEntityCmd.
 */
export class OffsetTool implements ITool {
  readonly name = 'offset';

  /**
   * Last numeric distance committed via the DI field. Seed for new sessions;
   * subsequent commits update it. Used to default the field's live value
   * before the cursor is over a source curve.
   */
  private static lastDistance = 10;

  private picked: OffsetSource | null = null;
  private hover: OffsetSource | null = null;
  private cur: IPoint = { x: 0, y: 0 };

  /** Through mode: cursor click becomes the through-point; distance is inferred. */
  private throughMode = false;
  /** Erase mode: source entity is removed after each offset commit. */
  private eraseMode = false;
  /** Multiple mode: tool stays in side-pick phase after each commit, same source. */
  private multipleMode = false;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  activate(): void {
    this.picked = null;
    this.hover = null;
    this.throughMode = false;
    this.eraseMode = false;
    this.multipleMode = false;
    this.dyn.clearEdits();
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number): void {
    this.cur = { x: wx, y: wy };

    if (!this.picked) {
      // Phase 1: refresh the hover candidate so the user sees what they'd pick.
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      this.hover = hit && this.isOffsetable(hit.entity) ? (hit.entity as OffsetSource) : null;
    }
    this.vm.markDirty();
  }

  getDynamicInputState(): IDynamicInputState | null {
    // DI is hidden during source pick and in through mode (distance comes from click point).
    if (!this.picked || this.throughMode) return null;
    const d = this.resolveDistance();
    return {
      wx: this.cur.x, wy: this.cur.y,
      primaryFieldKey: 'distance',
      fields: [
        { key: 'distance', label: 'Offset Distance', liveValue: formatLen(d), width: 110 },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    // Enter (or Space) in DI commits the offset at the typed distance + the
    // cursor's current side. Same effect as a left click â€” gives keyboard
    // users a parity path. Empty / invalid input keeps the field open and
    // lets cursor mode take over.
    if (!this.picked) return false;
    const raw = values['distance'] ?? '';
    const typed = evalExpression(raw);
    const d = typed !== null && Number.isFinite(typed) && typed > 0
      ? typed
      : Math.max(0, this.perpDistanceTo(this.picked, this.cur.x, this.cur.y));
    if (d <= 1e-9) return false;
    this.commitOffsetAt(d);
    return true;
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;

    if (!this.picked) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit && this.isOffsetable(hit.entity)) {
        this.picked = hit.entity as OffsetSource;
        this.hover = null;
        this.vm.markDirty();
      }
      return;
    }

    // Through mode: click point IS the through-point; distance is inferred.
    if (this.throughMode) {
      const d = this.perpDistanceTo(this.picked, wx, wy);
      if (d <= 1e-9) return;
      this.commitOffsetAt(d);
      return;
    }

    const d = this.resolveDistance();
    if (d <= 1e-9) return;
    this.commitOffsetAt(d);
  }

  /**
   * Shared commit path used by both onMouseDown (click) and commitDynamicInput
   * (Enter/Space inside DI). Pushes AddEntityCmd, updates lastDistance, and
   * loops the tool back to source-pick â€” the same chained behavior AutoCAD's
   * OFFSET uses.
   */
  private commitOffsetAt(d: number): void {
    if (!this.picked) return;
    const offset = this.computeOffset(this.picked, this.cur.x, this.cur.y, d);
    if (offset) {
      offset.layer = this.picked.layer;
      offset.colorNumber = this.picked.colorNumber;
      offset.lineType = this.picked.lineType;
      offset.lineWeight = this.picked.lineWeight;
      const file = this.doc.getFileOfEntity(this.picked) ?? this.doc.activeFile;
      this.cmds.push(new AddEntityCmd(offset, file, { markDirty: () => this.vm.markContentDirty() }));
      if (this.eraseMode) {
        const src = this.picked; // capture before resetting
        this.cmds.push(new DeleteEntityCmd(src, file, { markDirty: () => this.vm.markContentDirty() }));
      }
      OffsetTool.lastDistance = d;
    }
    if (this.multipleMode) {
      // Stay in side-pick phase â€” keep picked, reset DI edits only.
      this.dyn.clearEdits();
    } else {
      this.picked = null;
      this.hover = null;
      this.dyn.clearEdits();
    }
    this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    // Phase 1 hover: dim ghost of the entity the user would pick.
    if (!this.picked && this.hover) {
      ctx.save();
      ctx.strokeStyle = 'rgba(240,160,48,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      this.hover.draw(ctx, this.vm, this.doc);
      ctx.restore();
      return;
    }

    if (!this.picked) return;

    const d = this.resolveDistance();
    if (d <= 1e-9) return;

    const offset = this.computeOffset(this.picked, this.cur.x, this.cur.y, d);
    if (offset) {
      ctx.save();
      ctx.strokeStyle = 'rgba(240,160,48,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      offset.draw(ctx, this.vm, this.doc);
      ctx.restore();
    }
    // Distance readout lives in the DI panel below the cursor â€” no floating
    // canvas label here, matching Rect/Line/Circle.
  }

  /**
   * Resolve the current offset distance from the typed DI value when present
   * and parseable, otherwise from the cursor's perpendicular distance to the
   * source. This single function drives BOTH the preview render and the
   * commit path so the displayed value and the resulting geometry can never
   * disagree.
   */
  private resolveDistance(): number {
    if (!this.picked) return OffsetTool.lastDistance;
    const raw = this.dyn.editedValues()['distance'];
    if (raw !== undefined && raw !== '') {
      const n = evalExpression(raw);
      if (n !== null && Number.isFinite(n) && n > 0) return n;
    }
    return Math.max(0, this.perpDistanceTo(this.picked, this.cur.x, this.cur.y));
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.picked) {
        this.picked = null;
        this.hover = null;
        this.dyn.clearEdits();
        this.vm.markDirty();
        return;
      }
      this.tools.setTool('select');
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !this.picked) {
      // AutoCAD: Enter at the "Select object" prompt exits the command.
      this.tools.setTool('select');
    }
  }

  getPhase(): string | null {
    return this.picked ? 'side' : 'select';
  }

  invokeOption(key: string): boolean {
    switch (key) {
      case 'T':
        this.throughMode = !this.throughMode;
        if (this.throughMode) this.dyn.clearEdits();
        this.vm.markDirty();
        return true;
      case 'E':
        this.eraseMode = !this.eraseMode;
        return true;
      case 'M':
        this.multipleMode = !this.multipleMode;
        return true;
      case 'U':
        // Undo the last offset while in multiple mode.
        if (this.multipleMode && this.picked) {
          this.cmds.undo();
          this.vm.markDirty();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  // â”€â”€ Type guards + geometry helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private isOffsetable(ent: unknown): ent is OffsetSource {
    return ent instanceof LineEntity
      || ent instanceof CircleEntity
      || ent instanceof ArcEntity
      || ent instanceof PolylineEntity
      || ent instanceof EllipseEntity
      || ent instanceof XLineEntity
      || (ent as any).type === 'SPLINE';
  }

  /**
   * Perpendicular distance from a world point to the supported source curve.
   * Uses the shared `pointToSegmentDistance` / `pointToArcDistance` helpers so
   * the algorithm matches what TrimTool uses for cut detection.
   */
  private perpDistanceTo(source: OffsetSource, px: number, py: number): number {
    if (source instanceof LineEntity) {
      return pointToSegmentDistance(
        px, py,
        { x: source.x1, y: source.y1 },
        { x: source.x2, y: source.y2 },
      );
    }
    if (source instanceof CircleEntity) {
      return Math.abs(Math.hypot(px - source.cx, py - source.cy) - source.r);
    }
    if (source instanceof ArcEntity) {
      return pointToArcDistance(px, py, source.cx, source.cy, source.r,
        source.startAngle, source.endAngle, source.ccw);
    }
    if (source instanceof EllipseEntity) {
      return this.ellipseRadialDelta(source, px, py);
    }
    if (source instanceof XLineEntity) {
      // Perpendicular distance from (px, py) to the infinite line through
      // (source.x, source.y) at angle source.angle.
      const cos = Math.cos(source.angle);
      const sin = Math.sin(source.angle);
      // Cross product of the unit direction with the vector from base to point.
      return Math.abs((px - source.x) * sin - (py - source.y) * cos);
    }
    // POLYLINE / SPLINE: minimum perpendicular distance across all segments.
    const pts = (source as any).type === 'SPLINE' ? (source as any).controlPoints : (source as any).pts;
    let best = Infinity;
    const isClosed = source instanceof PolylineEntity ? source.closed : false;
    const last = isClosed ? pts.length : pts.length - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const d = pointToSegmentDistance(px, py, a, b);
      if (d < best) best = d;
    }
    return Number.isFinite(best) ? best : 0;
  }

  /**
   * Approximate "perpendicular distance" from a world point to an ellipse:
   * polar radius of the ellipse at the cursor's angle, subtracted from the
   * cursor's local radial distance. This is the same heuristic AutoCAD-Lite
   * implementations use to drive a Through-mode ellipse offset that "feels"
   * proportional â€” it is NOT a true mathematical offset distance (a true
   * offset curve of an ellipse is a higher-order curve), but for picking a
   * sensible scale factor it works well.
   */
  private ellipseRadialDelta(ent: EllipseEntity, px: number, py: number): number {
    const cos = Math.cos(ent.rotation);
    const sin = Math.sin(ent.rotation);
    // Cursor in ellipse-local frame (un-rotated around the center).
    const lx = (px - ent.cx) * cos + (py - ent.cy) * sin;
    const ly = -(px - ent.cx) * sin + (py - ent.cy) * cos;
    const rho = Math.hypot(lx, ly);
    const theta = Math.atan2(ly, lx);
    const rTheta = (ent.rx * ent.ry)
      / Math.hypot(ent.ry * Math.cos(theta), ent.rx * Math.sin(theta));
    return Math.abs(rho - rTheta);
  }

  /**
   * Build the offset entity at distance `d` on the side that contains (sideX,
   * sideY). Never mutates the source. Returns null when the offset would
   * collapse (e.g. negative circle radius).
   */
  private computeOffset(
    source: OffsetSource,
    sideX: number,
    sideY: number,
    d: number,
  ): OffsetSource | null {
    if (source instanceof LineEntity) {
      const dx = source.x2 - source.x1;
      const dy = source.y2 - source.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return null;
      let nx = -dy / len;
      let ny = dx / len;
      const midX = (source.x1 + source.x2) / 2;
      const midY = (source.y1 + source.y2) / 2;
      const sideDot = (sideX - midX) * nx + (sideY - midY) * ny;
      if (sideDot < 0) { nx = -nx; ny = -ny; }
      return new LineEntity(source.x1 + nx * d, source.y1 + ny * d, source.x2 + nx * d, source.y2 + ny * d);
    }

    if (source instanceof XLineEntity) {
      // The normal to an XLINE (angle Î¸) is perpendicular: (âˆ’sin Î¸, cos Î¸).
      // Determine which side of the line the cursor is on via the sign of the
      // signed distance: positive â†’ left-normal side; negative â†’ right-normal.
      const cos = Math.cos(source.angle);
      const sin = Math.sin(source.angle);
      // Left-normal (ccw 90Â° rotation of direction)
      let nx = -sin;
      let ny = cos;
      // Signed distance from the base point to the cursor along the normal:
      const signedDist = (sideX - source.x) * nx + (sideY - source.y) * ny;
      if (signedDist < 0) { nx = -nx; ny = -ny; }
      // New base point shifted by d along the chosen normal, keeping same angle.
      return new XLineEntity(source.x + nx * d, source.y + ny * d, source.angle);
    }

    if (source instanceof CircleEntity) {
      const distToCenter = Math.hypot(sideX - source.cx, sideY - source.cy);
      const newR = distToCenter > source.r ? source.r + d : source.r - d;
      if (newR < 1e-9) return null;
      return new CircleEntity(source.cx, source.cy, newR);
    }

    if (source instanceof ArcEntity) {
      const distToCenter = Math.hypot(sideX - source.cx, sideY - source.cy);
      const newR = distToCenter > source.r ? source.r + d : source.r - d;
      if (newR < 1e-9) return null;
      return new ArcEntity(source.cx, source.cy, newR, source.startAngle, source.endAngle, source.ccw);
    }

    if (source instanceof EllipseEntity) {
      // Uniform rx/ry shift driven by inside/outside test in local coords.
      // Not a true mathematical offset (which is a higher-order curve), but
      // gives a stable, AutoCAD-Lite-style result: cursor inside â†’ ellipse
      // shrinks; cursor outside â†’ ellipse grows. Both axes shift by the same
      // `d` so the result remains an ellipse (the shape is approximately
      // parallel to the original).
      const cos = Math.cos(source.rotation);
      const sin = Math.sin(source.rotation);
      const lx = (sideX - source.cx) * cos + (sideY - source.cy) * sin;
      const ly = -(sideX - source.cx) * sin + (sideY - source.cy) * cos;
      const localDistSq = (lx * lx) / (source.rx * source.rx)
        + (ly * ly) / (source.ry * source.ry);
      const outward = localDistSq >= 1;
      const newRx = outward ? source.rx + d : source.rx - d;
      const newRy = outward ? source.ry + d : source.ry - d;
      if (newRx < 1e-9 || newRy < 1e-9) return null;
      return new EllipseEntity(
        source.cx, source.cy, newRx, newRy,
        source.rotation, source.startAngle, source.endAngle,
      );
    }

    // â”€â”€ POLYLINE / SPLINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Closed polylines use orientation + point-in-polygon so every segment's
    // offset goes the same direction (outward when cursor is outside, inward
    // when inside). Open polylines/splines fall back to nearest-segment side
    // detection because they have no well-defined interior. Adjacent offset
    // segments are intersected to produce mitered corner vertices.
    const pts = (source as any).type === 'SPLINE' ? (source as any).controlPoints : (source as any).pts;
    const isClosed = source instanceof PolylineEntity ? source.closed : false;
    if (pts.length < 2) return null;
    const N = pts.length;
    const segCount = isClosed ? N : N - 1;

    // Step 1 â€” establish a per-segment normal sign convention.
    //
    // Closed: signedArea > 0 â†’ CCW (in y-up math coords). For CCW polygons
    // the right-hand normal (rotate direction 90Â° CW = (dy, -dx)/len) points
    // OUTWARD from the interior. CW polygons (area < 0) use the left-hand
    // normal. We then flip every segment's outward direction when the cursor
    // is INSIDE the polygon, producing a clean inward offset.
    //
    // Open: pick the cursor side via the nearest segment's normal (cursor
    // dot-product with the segment's left-normal). All segments then offset
    // toward the cursor's side relative to their own perpendicular.
    let orientation = 1;
    let inside = false;
    let offsetToLeft = true;
    if (isClosed) {
      orientation = signedArea(pts) >= 0 ? 1 : -1;
      inside = pointInPolygon(sideX, sideY, pts);
    } else {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < segCount; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % N];
        const dd = pointToSegmentDistance(sideX, sideY, a, b);
        if (dd < bestDist) { bestDist = dd; bestIdx = i; }
      }
      const sa = pts[bestIdx];
      const sb = pts[(bestIdx + 1) % N];
      const sdx = sb.x - sa.x;
      const sdy = sb.y - sa.y;
      const slen = Math.hypot(sdx, sdy);
      if (slen < 1e-9) return null;
      const nx = -sdy / slen;
      const ny = sdx / slen;
      offsetToLeft = ((sideX - sa.x) * nx + (sideY - sa.y) * ny) >= 0;
    }

    // Step 2 â€” build each segment's offset endpoints.
    const offsetSegment = (i: number) => {
      const a = pts[i];
      const b = pts[(i + 1) % N];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return null;

      let outwardX: number;
      let outwardY: number;
      if (isClosed) {
        if (orientation > 0) {
          // CCW: right-normal (dy, -dx)/len points outward.
          outwardX = dy / len;
          outwardY = -dx / len;
        } else {
          // CW: left-normal (-dy, dx)/len points outward.
          outwardX = -dy / len;
          outwardY = dx / len;
        }
        if (inside) { outwardX = -outwardX; outwardY = -outwardY; }
      } else {
        // Open: pick the segment's perpendicular toward the cursor-side
        // reference. Each segment independently aligns with that reference.
        let lnx = -dy / len;
        let lny = dx / len;
        if (!offsetToLeft) { lnx = -lnx; lny = -lny; }
        outwardX = lnx;
        outwardY = lny;
      }

      const ox = outwardX * d;
      const oy = outwardY * d;
      return {
        ax: a.x + ox, ay: a.y + oy,
        bx: b.x + ox, by: b.y + oy,
        dx, dy,
      };
    };

    const segs: ({ ax: number; ay: number; bx: number; by: number; dx: number; dy: number } | null)[] = [];
    for (let i = 0; i < segCount; i++) segs.push(offsetSegment(i));

    // Step 3 â€” corner vertices = intersection of adjacent offset segments.
    const intersect = (s1: NonNullable<typeof segs[number]>, s2: NonNullable<typeof segs[number]>): IPoint | null => {
      const denom = s1.dx * s2.dy - s1.dy * s2.dx;
      if (Math.abs(denom) < 1e-9) return null;
      const t = ((s2.ax - s1.ax) * s2.dy - (s2.ay - s1.ay) * s2.dx) / denom;
      return { x: s1.ax + s1.dx * t, y: s1.ay + s1.dy * t };
    };

    const newPts: IPoint[] = [];
    for (let i = 0; i < N; i++) {
      if (!isClosed && i === 0) {
        const s = segs[0];
        if (!s) return null;
        newPts.push({ x: s.ax, y: s.ay });
        continue;
      }
      if (!isClosed && i === N - 1) {
        const s = segs[N - 2];
        if (!s) return null;
        newPts.push({ x: s.bx, y: s.by });
        continue;
      }
      const prevIdx = (i - 1 + segCount) % segCount;
      const curIdx = i % segCount;
      const sp = segs[prevIdx];
      const sc = segs[curIdx];
      if (!sp || !sc) continue;
      const x = intersect(sp, sc);
      if (x) newPts.push(x);
      else newPts.push({ x: sp.bx, y: sp.by });
    }

    if (newPts.length < 2) return null;
    if ((source as any).type === 'SPLINE') {
      return new SplineEntity(newPts, (source as any).knots, (source as any).degree);
    }
    return new PolylineEntity(newPts, isClosed);
  }

  deactivate(): void {
    this.picked = null;
    this.hover = null;
    this.dyn.clearEdits();
    this.dyn.setState(null);
    // OffsetTool.lastDistance is static and persists across re-activations,
    // matching AutoCAD's <last> default for the next session.
  }
}
