import { Injector } from '@angular/core';
import { ITool, IDynamicInputState, IDynamicField } from '../../core/models/tool.interface';
import type { Entity, IPoint, IBBox } from '../../core/models/entity.model';
import { LineEntity, CircleEntity, ArcEntity, PolylineEntity } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DrawOrderService } from '../../core/services/draw-order.service';
import { PasteEntitiesCmd } from '../../core/models/command.model';
import { moveEntityInPlace, rotateEntityInPlace } from '../geometry-utils';
import { hitTestAll, getSelectedEntities } from '../select/select-tool';
import { formatLen, formatAngleDeg } from '../draw/draw-utils';
import { evalExpression } from '../../core/utils/expression-parser';

export type ArrayMode = 'rect' | 'polar' | 'path';

/** Hard ceiling on generated copies so a fat-fingered count cannot hang the app. */
const MAX_COPIES = 5000;
/** Tessellation resolution for ARC / CIRCLE path curves. */
const CURVE_SEGMENTS = 64;
const ACCENT = 'rgba(240,160,48,0.85)';

/**
 * AutoCAD-style ARRAY command tool — one class, three modes
 * (`ARRAYRECT`, `ARRAYPOLAR`, `ARRAYPATH`), selected via the constructor
 * `mode` argument the same way ArcTool switches construction methods.
 *
 * Phase flow:
 *   rect:   `select` → `config`
 *              1. `select` — click entities (skipped when a selection already
 *                 exists); Enter/Space closes the selection set.
 *              2. `config` — dragging the cursor away from the source-set
 *                 bounding-box corner drives row/column spacing; DYN fields
 *                 (rows / cols / rowSpacing / colSpacing) override the drag.
 *
 *   polar:  `select` → `center` → `config`
 *              2. `center` — pick the rotation centre.
 *              3. `config` — `count` items swept over `angle` (fill angle);
 *                 every copy is rotated as well as revolved (rotateItems=true).
 *
 *   path:   `select` → `path` → `config`
 *              2. `path`   — click a LINE / POLYLINE / ARC / CIRCLE to follow.
 *              3. `config` — `count` items divided evenly over the whole path
 *                 arc-length, aligned to the path tangent by default.
 *
 * All modes preview translucent ghosts plus a dashed mode-specific guide, and
 * commit through a SINGLE PasteEntitiesCmd so the whole array is one undo step.
 */
export class ArrayTool implements ITool {
  readonly name = 'array';

  private targets: Entity[] = [];
  private selectionDone = false;
  private previewEnts: Entity[] = [];
  private cur: IPoint = { x: 0, y: 0 };
  private hasCursor = false;
  /** Field key primed by invokeOption(), auto-focused by the DYN overlay. */
  private activeField: string | null = null;

  // ─── Rectangular params ────────────────────────────────────────────────────
  private rows = 3;
  private cols = 4;
  private rowSpacing = 10;
  private colSpacing = 10;
  /** Lower-left corner of the source set's union bbox — the drag origin. */
  private baseCorner: IPoint | null = null;
  /** Once spacing is typed, cursor drags stop clobbering it. */
  private spacingTyped = false;

  // ─── Polar params ──────────────────────────────────────────────────────────
  private center: IPoint | null = null;
  private count = 6;
  private fillAngle = 360;

  // ─── Path params ───────────────────────────────────────────────────────────
  private pathEnt: Entity | null = null;
  private pathPts: IPoint[] = [];
  private pathClosed = false;
  private aligned = true;

  /** Union-bbox centre of the source set; the handle used by polar + path. */
  private basePoint: IPoint | null = null;

  constructor(private injector: Injector, private mode: ArrayMode = 'rect') {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get drawOrder() { return this.injector.get(DrawOrderService) as DrawOrderService; }

  activate(): void {
    this.targets = getSelectedEntities(this.doc);
    if (this.targets.length) this.finishSelection();
  }

  // ─── Phase / prompt plumbing ───────────────────────────────────────────────

  getCommandId(): string {
    if (this.mode === 'polar') return 'arraypolar';
    if (this.mode === 'path') return 'arraypath';
    return 'arrayrect';
  }

  getPhase(): string | null {
    if (!this.selectionDone) return 'select';
    if (this.mode === 'polar' && !this.center) return 'center';
    if (this.mode === 'path' && !this.pathEnt) return 'path';
    return 'config';
  }

  getCursor(): string {
    return this.getPhase() === 'select' || this.getPhase() === 'path' ? 'pickbox' : 'crosshair';
  }

  getAnchor(): IPoint | null {
    if (this.mode === 'polar') return this.center;
    if (this.mode === 'rect') return this.baseCorner;
    return this.basePoint;
  }

  // ─── Input ─────────────────────────────────────────────────────────────────

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;

    // Phase 1 — build the selection set by picking.
    if (!this.selectionDone) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit && !this.targets.includes(hit.entity)) {
        hit.entity.selected = true;
        this.targets.push(hit.entity);
        this.vm.markContentDirty();
      }
      return;
    }

    // Phase 2 — mode-specific reference pick.
    if (this.mode === 'polar' && !this.center) {
      this.center = { x: wx, y: wy };
      this.rebuildPreview();
      this.vm.markDirty();
      return;
    }
    if (this.mode === 'path' && !this.pathEnt) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit && this.tessellatePath(hit.entity)) {
        this.pathEnt = hit.entity;
        this.rebuildPreview();
        this.vm.markDirty();
      }
      return;
    }

    // Phase 3 — a click in `config` accepts the current parameters.
    this.commit();
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    this.hasCursor = true;

    if (this.mode === 'rect' && this.selectionDone && !this.spacingTyped && this.baseCorner) {
      this.deriveSpacingFromCursor();
      this.rebuildPreview();
    }
    this.vm.markDirty();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
      this.tools.setTool('select');
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;

    if (!this.selectionDone) {
      if (this.targets.length) this.finishSelection();
      return;
    }
    if (this.getPhase() === 'config') this.commit();
  }

  // ─── Dynamic input ─────────────────────────────────────────────────────────

  getDynamicInputState(): IDynamicInputState | null {
    if (this.getPhase() !== 'config') return null;

    let fields: IDynamicField[];
    let primary: string;

    if (this.mode === 'rect') {
      primary = 'cols';
      fields = [
        { key: 'rows', label: 'Rows', liveValue: String(this.rows), width: 56 },
        { key: 'cols', label: 'Cols', liveValue: String(this.cols), width: 56 },
        { key: 'rowSpacing', label: 'Row sp', liveValue: formatLen(this.rowSpacing), width: 90 },
        { key: 'colSpacing', label: 'Col sp', liveValue: formatLen(this.colSpacing), width: 90 },
      ];
    } else if (this.mode === 'polar') {
      primary = 'count';
      fields = [
        { key: 'count', label: 'Items', liveValue: String(this.count), width: 56 },
        { key: 'angle', label: 'Fill', liveValue: formatAngleDeg(this.fillAngle), suffix: '°', width: 70 },
      ];
    } else {
      primary = 'count';
      fields = [
        { key: 'count', label: 'Items', liveValue: String(this.count), width: 56 },
        { key: 'length', label: 'Path len', liveValue: formatLen(this.pathLength()), readonly: true, width: 90 },
      ];
    }

    return {
      wx: this.cur.x,
      wy: this.cur.y,
      primaryFieldKey: this.activeField && fields.some((f) => f.key === this.activeField)
        ? this.activeField
        : primary,
      fields,
    };
  }

  /**
   * Parse typed field values and refresh the ghost preview WITHOUT committing —
   * placement is always reserved for Enter (or a left-click) so the user can
   * keep tuning parameters.
   */
  commitDynamicInput(values: Record<string, string>): boolean {
    if (this.getPhase() !== 'config') return false;
    let touched = false;

    const num = (key: string): number | null => {
      const raw = values[key];
      if (raw === undefined || raw === null || raw.trim() === '') return null;
      return evalExpression(raw);
    };

    if (this.mode === 'rect') {
      const r = num('rows');
      const c = num('cols');
      const rs = num('rowSpacing');
      const cs = num('colSpacing');
      if (r !== null) { this.rows = this.clampCount(r); touched = true; }
      if (c !== null) { this.cols = this.clampCount(c); touched = true; }
      if (rs !== null) { this.rowSpacing = rs; this.spacingTyped = true; touched = true; }
      if (cs !== null) { this.colSpacing = cs; this.spacingTyped = true; touched = true; }
    } else if (this.mode === 'polar') {
      const n = num('count');
      const a = num('angle');
      if (n !== null) { this.count = this.clampCount(n); touched = true; }
      if (a !== null) { this.fillAngle = a; touched = true; }
    } else {
      const n = num('count');
      if (n !== null) { this.count = this.clampCount(n); touched = true; }
    }

    if (!touched) return false;
    this.activeField = null;
    this.rebuildPreview();
    this.vm.markDirty();
    return true;
  }

  invokeOption(key: string): boolean {
    const k = (key || '').toUpperCase();
    if (this.getPhase() !== 'config') return false;

    if (this.mode === 'rect') {
      if (k === 'R') { this.activeField = 'rows'; return true; }
      if (k === 'C') { this.activeField = 'cols'; return true; }
      if (k === 'S') { this.activeField = 'colSpacing'; this.spacingTyped = true; return true; }
      return false;
    }
    if (this.mode === 'polar') {
      if (k === 'C') { this.activeField = 'count'; return true; }
      if (k === 'A' || k === 'F') { this.activeField = 'angle'; return true; }
      return false;
    }
    // path
    if (k === 'C') { this.activeField = 'count'; return true; }
    if (k === 'A') {
      this.aligned = !this.aligned;
      this.rebuildPreview();
      this.vm.markDirty();
      return true;
    }
    return false;
  }

  // ─── Preview rendering ─────────────────────────────────────────────────────

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.getPhase() === 'select') return;
    const file = this.doc.activeFile;

    if (this.previewEnts.length) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      for (const e of this.previewEnts) {
        e.draw(ctx, this.vm as any, file);
      }
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);

    if (this.mode === 'rect') this.drawRectGuide(ctx);
    else if (this.mode === 'polar') this.drawPolarGuide(ctx);
    else this.drawPathGuide(ctx);

    ctx.restore();
  }

  deactivate(): void {
    this.cleanup();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private finishSelection(): void {
    this.selectionDone = true;
    const bb = this.unionBBox(this.targets);
    this.baseCorner = bb ? { x: bb.x, y: bb.y } : { x: 0, y: 0 };
    this.basePoint = bb ? { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 } : { x: 0, y: 0 };
    this.colSpacing = bb && bb.w > 1e-9 ? bb.w * 1.2 : 10;
    this.rowSpacing = bb && bb.h > 1e-9 ? bb.h * 1.2 : 10;

    const last = this.vm.lastCursorWorld;
    if (last && isFinite(last.x) && isFinite(last.y)) {
      this.cur = { x: last.x, y: last.y };
      this.hasCursor = true;
    }
    this.rebuildPreview();
    this.vm.markDirty();
  }

  private clampCount(v: number): number {
    if (!isFinite(v)) return 1;
    return Math.max(1, Math.min(MAX_COPIES, Math.round(v)));
  }

  private unionBBox(ents: Entity[]): IBBox | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of ents) {
      const b = e.bbox();
      if (!b) continue;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    if (!isFinite(minX) || !isFinite(minY)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** Rectangular mode: cursor offset from the bbox corner drives spacing. */
  private deriveSpacingFromCursor(): void {
    if (!this.baseCorner || !this.hasCursor) return;
    const dx = this.cur.x - this.baseCorner.x;
    const dy = this.cur.y - this.baseCorner.y;
    const cSpan = this.cols > 1 ? this.cols - 1 : 1;
    const rSpan = this.rows > 1 ? this.rows - 1 : 1;
    if (Math.abs(dx) > 1e-9) this.colSpacing = dx / cSpan;
    if (Math.abs(dy) > 1e-9) this.rowSpacing = dy / rSpan;
  }

  /** Clone the source set, apply `xform`, and append to `out` (respecting MAX_COPIES). */
  private emitCopy(out: Entity[], xform: (clone: Entity) => void): boolean {
    if (out.length + this.targets.length > MAX_COPIES) return false;
    for (const src of this.targets) {
      const c = src.clone();
      c.selected = false;
      xform(c);
      c.refreshCaches();
      out.push(c);
    }
    return true;
  }

  /** Regenerate `previewEnts` from the source set for the current parameters. */
  private rebuildPreview(): void {
    this.previewEnts = this.buildCopies();
  }

  private buildCopies(): Entity[] {
    if (!this.targets.length) return [];
    if (this.mode === 'rect') return this.buildRect();
    if (this.mode === 'polar') return this.buildPolar();
    return this.buildPath();
  }

  private buildRect(): Entity[] {
    const out: Entity[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r === 0 && c === 0) continue; // source stays put
        const dx = c * this.colSpacing;
        const dy = r * this.rowSpacing;
        if (!this.emitCopy(out, (e) => moveEntityInPlace(e, dx, dy))) return out;
      }
    }
    return out;
  }

  private polarStepDeg(): number {
    const full = Math.abs(this.fillAngle) >= 359.999;
    const divisor = full ? this.count : Math.max(1, this.count - 1);
    return this.fillAngle / divisor;
  }

  private buildPolar(): Entity[] {
    if (!this.center) return [];
    const out: Entity[] = [];
    const cx = this.center.x;
    const cy = this.center.y;
    const stepRad = (this.polarStepDeg() * Math.PI) / 180;
    for (let i = 1; i < this.count; i++) {
      const rad = stepRad * i;
      // Rotating about the centre both revolves AND spins each item, matching
      // AutoCAD's rotateItems=yes default.
      if (!this.emitCopy(out, (e) => rotateEntityInPlace(e, cx, cy, rad))) return out;
    }
    return out;
  }

  private buildPath(): Entity[] {
    if (!this.basePoint || this.pathPts.length < 2) return [];
    const cum = this.cumulativeLengths();
    const total = cum[cum.length - 1];
    if (!(total > 1e-9)) return [];

    const spans = this.pathClosed ? this.count : Math.max(1, this.count - 1);
    const step = total / spans;
    const baseTangent = this.tangentAt(0, cum);
    const bx = this.basePoint.x;
    const by = this.basePoint.y;

    const out: Entity[] = [];
    for (let i = 0; i < this.count; i++) {
      const d = Math.min(i * step, total);
      const p = this.pointAt(d, cum);
      const rad = this.aligned ? this.tangentAt(d, cum) - baseTangent : 0;
      const dx = p.x - bx;
      const dy = p.y - by;
      const ok = this.emitCopy(out, (e) => {
        if (rad !== 0) rotateEntityInPlace(e, bx, by, rad);
        moveEntityInPlace(e, dx, dy);
      });
      if (!ok) return out;
    }
    return out;
  }

  // ─── Path sampling ─────────────────────────────────────────────────────────

  /**
   * Approximate `ent` as a polyline in `pathPts`. LINE uses its endpoints,
   * POLYLINE its vertices (honouring `closed`), ARC / CIRCLE tessellate into
   * CURVE_SEGMENTS chords. Returns false for unsupported entity types.
   */
  private tessellatePath(ent: Entity): boolean {
    const pts: IPoint[] = [];
    let closed = false;

    if (ent instanceof LineEntity) {
      pts.push({ x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 });
    } else if (ent instanceof PolylineEntity) {
      for (const p of ent.pts) pts.push({ x: p.x, y: p.y });
      closed = !!ent.closed;
      if (closed && pts.length > 1) pts.push({ x: pts[0].x, y: pts[0].y });
    } else if (ent instanceof ArcEntity) {
      const sweep = ent.getSweep();
      for (let i = 0; i <= CURVE_SEGMENTS; i++) {
        const a = ((ent.startAngle + (sweep * i) / CURVE_SEGMENTS) * Math.PI) / 180;
        pts.push({ x: ent.cx + ent.r * Math.cos(a), y: ent.cy + ent.r * Math.sin(a) });
      }
    } else if (ent instanceof CircleEntity) {
      closed = true;
      for (let i = 0; i <= CURVE_SEGMENTS; i++) {
        const a = (2 * Math.PI * i) / CURVE_SEGMENTS;
        pts.push({ x: ent.cx + ent.r * Math.cos(a), y: ent.cy + ent.r * Math.sin(a) });
      }
    } else {
      // Fall back to a generic vertex list when the entity carries one.
      const raw = ent['pts'] ?? ent['vertices'];
      if (!Array.isArray(raw) || raw.length < 2) return false;
      for (const p of raw) pts.push({ x: p.x, y: p.y });
      closed = !!ent['closed'];
      if (closed) pts.push({ x: pts[0].x, y: pts[0].y });
    }

    if (pts.length < 2) return false;
    this.pathPts = pts;
    this.pathClosed = closed;
    return true;
  }

  /** Cumulative arc-length at each tessellation vertex (index 0 === 0). */
  private cumulativeLengths(): number[] {
    const cum: number[] = [0];
    for (let i = 1; i < this.pathPts.length; i++) {
      const a = this.pathPts[i - 1];
      const b = this.pathPts[i];
      cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    return cum;
  }

  private pathLength(): number {
    if (this.pathPts.length < 2) return 0;
    const cum = this.cumulativeLengths();
    return cum[cum.length - 1];
  }

  /** Segment index + local parameter for arc-length `d`. */
  private locate(d: number, cum: number[]): { i: number; t: number } {
    const total = cum[cum.length - 1];
    const target = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const segLen = cum[i] - cum[i - 1];
    const t = segLen > 1e-12 ? (target - cum[i - 1]) / segLen : 0;
    return { i, t };
  }

  /** Linear interpolation along the tessellated path at arc-length `d`. */
  private pointAt(d: number, cum: number[]): IPoint {
    const { i, t } = this.locate(d, cum);
    const a = this.pathPts[i - 1];
    const b = this.pathPts[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /** Tangent direction (radians) of the segment containing arc-length `d`. */
  private tangentAt(d: number, cum: number[]): number {
    const { i } = this.locate(d, cum);
    const a = this.pathPts[i - 1];
    const b = this.pathPts[i];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  // ─── Guides ────────────────────────────────────────────────────────────────

  private drawRectGuide(ctx: CanvasRenderingContext2D): void {
    if (!this.baseCorner) return;
    const w = (this.cols - 1) * this.colSpacing;
    const h = (this.rows - 1) * this.rowSpacing;
    const a = this.vm.w2s(this.baseCorner.x, this.baseCorner.y);
    const b = this.vm.w2s(this.baseCorner.x + w, this.baseCorner.y + h);
    ctx.beginPath();
    ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.stroke();

    // Row / column axes out of the drag corner.
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, a.y);
    ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, b.y);
    ctx.stroke();
  }

  private drawPolarGuide(ctx: CanvasRenderingContext2D): void {
    if (!this.center || !this.basePoint) return;
    const c = this.vm.w2s(this.center.x, this.center.y);
    const rWorld = Math.hypot(this.basePoint.x - this.center.x, this.basePoint.y - this.center.y);
    const rPx = rWorld * this.vm.scale;
    if (rPx > 0.5) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, rPx, 0, Math.PI * 2);
      ctx.stroke();
    }
    const b = this.vm.w2s(this.basePoint.x, this.basePoint.y);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  private drawPathGuide(ctx: CanvasRenderingContext2D): void {
    if (this.pathPts.length < 2) return;
    ctx.beginPath();
    for (let i = 0; i < this.pathPts.length; i++) {
      const s = this.vm.w2s(this.pathPts[i].x, this.pathPts[i].y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();

    // Division markers.
    const cum = this.cumulativeLengths();
    const total = cum[cum.length - 1];
    if (!(total > 1e-9)) return;
    const spans = this.pathClosed ? this.count : Math.max(1, this.count - 1);
    const step = total / spans;
    ctx.setLineDash([]);
    ctx.fillStyle = ACCENT;
    for (let i = 0; i < this.count && i <= MAX_COPIES; i++) {
      const p = this.pointAt(Math.min(i * step, total), cum);
      const s = this.vm.w2s(p.x, p.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ─── Commit ────────────────────────────────────────────────────────────────

  private commit(): void {
    // Rebuild from the source entities so the committed geometry is never the
    // same object graph the preview mutated.
    const placed = this.buildCopies();
    if (!placed.length) {
      this.cleanup();
      this.tools.setTool('select');
      return;
    }

    const file = this.doc.activeFile;
    for (const e of placed) {
      e.selected = false;
      e.refreshCaches();
    }
    this.drawOrder.assignInitial(placed, file.entities);
    this.cmds.push(new PasteEntitiesCmd(placed, file, { markDirty: () => this.vm.markContentDirty() }));

    this.cleanup();
    this.tools.setTool('select');
  }

  private cleanup(): void {
    this.previewEnts = [];
    this.targets = [];
    this.selectionDone = false;
    this.baseCorner = null;
    this.basePoint = null;
    this.center = null;
    this.pathEnt = null;
    this.pathPts = [];
    this.pathClosed = false;
    this.spacingTyped = false;
    this.activeField = null;
    this.hasCursor = false;
    this.vm.markDirty();
  }
}
