import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { CircleEntity, LineEntity, ArcEntity, PolylineEntity, Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { evalExpression } from '../../core/utils/expression-parser';
import { formatLen } from './draw-utils';
import { hitTestAll } from '../select/select-tool';

export type CircleMode = 'radius' | 'diameter' | '2p' | '3p' | 'ttr' | 'ttt';

export class CircleTool implements ITool {
  readonly name = 'circle';
  private pts: IPoint[] = [];
  private cur: IPoint = { x: 0, y: 0 };

  // For ttr/ttt entity-picking modes
  private picked: Entity[] = [];
  private hovered: Entity | null = null;

  constructor(private injector: Injector, private mode: CircleMode = 'radius') {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  getCursor(): string {
    return 'crosshair';
  }

  getPhase(): string | null {
    if (this.mode === 'radius' || this.mode === 'diameter') {
      return this.pts.length === 0 ? 'center' : (this.mode === 'radius' ? 'radius' : 'diameter');
    }
    if (this.mode === '2p') return this.pts.length === 0 ? 'p1' : 'p2';
    if (this.mode === '3p') return this.pts.length === 0 ? 'p1' : (this.pts.length === 1 ? 'p2' : 'p3');
    if (this.mode === 'ttr') {
      if (this.picked.length === 0) return 'first-tangent';
      if (this.picked.length === 1) return 'second-tangent';
      return 'radius';
    }
    if (this.mode === 'ttt') {
      if (this.picked.length === 0) return 'first-tangent';
      if (this.picked.length === 1) return 'second-tangent';
      return 'third-tangent';
    }
    return null;
  }

  /** Maps the current runtime mode to the COMMAND_PROMPTS registry key. */
  getCommandId(): string {
    const map: Record<CircleMode, string> = {
      radius:   'circle',
      diameter: 'circle_dia',
      '2p':     'circle_2p',
      '3p':     'circle_3p',
      ttr:      'circle_ttr',
      ttt:      'circle_ttt',
    };
    return map[this.mode] ?? 'circle';
  }

  /**
   * Handle keyword options from the command bar / DYN chips / keyboard.
   * Mode-switch keys work only before any points are collected so the user
   * can change their mind without restarting the command.
   * 'D'/'R' (Diameter / Radius) swap the radiusâ†”diameter variant while
   * preserving the already-picked center point.
   */
  invokeOption(key: string): boolean {
    switch (key.toUpperCase()) {
      case '2': // 2-Point circle
        if (this.pts.length === 0) {
          this.mode = '2p'; this.dyn.clearEdits(); this.vm.markDirty(); return true;
        }
        return false;
      case '3': // 3-Point circle
        if (this.pts.length === 0) {
          this.mode = '3p'; this.dyn.clearEdits(); this.vm.markDirty(); return true;
        }
        return false;
      case 'T': // Tan, Tan, Radius
        if (this.pts.length === 0) {
          this.mode = 'ttr'; this.dyn.clearEdits(); this.vm.markDirty(); return true;
        }
        return false;
      case 'D': // Switch to Diameter (center already picked stays)
        if (this.mode === 'radius' && this.pts.length <= 1) {
          this.mode = 'diameter'; this.dyn.clearEdits(); this.vm.markDirty(); return true;
        }
        return false;
      case 'R': // Switch back to Radius
        if (this.mode === 'diameter' && this.pts.length <= 1) {
          this.mode = 'radius'; this.dyn.clearEdits(); this.vm.markDirty(); return true;
        }
        return false;
      default:
        return false;
    }
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, _e?: MouseEvent): void {
    if (this.mode === 'ttr' || this.mode === 'ttt') {
      if (!this.hovered) return;
      this.picked.push(this.hovered);

      if (this.mode === 'ttt' && this.picked.length === 3) {
        this.placeTtt();
      }
      this.vm.markDirty();
      return;
    }

    const pt = { x: wx, y: wy };
    this.pts.push(pt);
    this.dyn.clearEdits();

    const result = this.computeCircle();
    if (result && result.done) {
      if (result.r > 0.001) this.placeCircle(result.c, result.r);
      this.pts = [];
      this.dyn.clearEdits();
    }
    this.vm.markDirty();
  }

  private placeCircle(c: IPoint, r: number): void {
    const e = new CircleEntity(c.x, c.y, r);
    e.layer = this.doc.activeLayer;
    this.cmds.push(new AddEntityCmd(e, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number, _e?: MouseEvent): void {
    this.cur = { x: wx, y: wy };

    if (this.mode === 'ttr' || this.mode === 'ttt') {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      const candidate = hit ? hit.entity : null;
      const prev = this.hovered;
      // Don't re-hover already picked entities
      this.hovered = (candidate && !this.picked.includes(candidate)) ? candidate : null;
      if (this.hovered !== prev) this.vm.markDirty();
      else if (this.picked.length > 0) this.vm.markDirty(); // keep preview alive
      return;
    }

    if (this.pts.length > 0) this.vm.markDirty();
  }

  private computeCircle(): { c: IPoint, r: number, done: boolean } | null {
    if (this.mode === 'radius' || this.mode === 'diameter') {
      if (this.pts.length === 0) return null;
      const c = this.pts[0];
      const done = this.pts.length >= 2;
      const target = done ? this.pts[1] : this.cur;
      const liveDist = Math.hypot(target.x - c.x, target.y - c.y);
      let r = liveDist;

      if (!done) {
        const edited = this.dyn.editedValues()[this.mode];
        if (edited !== undefined) {
          const n = evalExpression(edited);
          if (n !== null && n > 0) r = this.mode === 'diameter' ? n / 2 : n;
        }
      }
      return { c, r, done };
    }

    if (this.mode === '2p') {
      if (this.pts.length === 0) return null;
      const p1 = this.pts[0];
      const done = this.pts.length >= 2;
      const p2 = done ? this.pts[1] : this.cur;
      const c = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const r = Math.hypot(p1.x - p2.x, p1.y - p2.y) / 2;
      return { c, r, done };
    }

    if (this.mode === '3p') {
      if (this.pts.length === 0) return null;
      if (this.pts.length === 1) {
        const p1 = this.pts[0];
        const p2 = this.cur;
        const c = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const r = Math.hypot(p1.x - p2.x, p1.y - p2.y) / 2;
        return { c, r, done: false };
      }
      const p1 = this.pts[0], p2 = this.pts[1];
      const done = this.pts.length >= 3;
      const p3 = done ? this.pts[2] : this.cur;
      const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
      if (Math.abs(D) < 1e-9) {
        const c = { x: (p1.x + p3.x) / 2, y: (p1.y + p3.y) / 2 };
        const r = Math.hypot(p1.x - p3.x, p1.y - p3.y) / 2;
        return { c, r, done };
      }
      const A2 = p1.x * p1.x + p1.y * p1.y;
      const B2 = p2.x * p2.x + p2.y * p2.y;
      const C2 = p3.x * p3.x + p3.y * p3.y;
      const cx = (A2 * (p2.y - p3.y) + B2 * (p3.y - p1.y) + C2 * (p1.y - p2.y)) / D;
      const cy = (A2 * (p3.x - p2.x) + B2 * (p1.x - p3.x) + C2 * (p2.x - p1.x)) / D;
      return { c: { x: cx, y: cy }, r: Math.hypot(p1.x - cx, p1.y - cy), done };
    }

    return null;
  }

  // â”€â”€ TTR placement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private getTtrPreview(): { c: IPoint; r: number } | null {
    if (this.picked.length < 2) return null;
    const p1 = primFromEntity(this.picked[0], this.cur);
    const p2 = primFromEntity(this.picked[1], this.cur);
    if (!p1 || !p2) return null;

    let R = Math.hypot(this.cur.x, this.cur.y); // fallback
    const edited = this.dyn.editedValues()['radius'];
    if (edited !== undefined) {
      const n = evalExpression(edited);
      if (n !== null && n > 0) R = n;
    } else {
      // Estimate R as distance from cursor to nearest picked entity
      R = Math.max(1, distToPrim(p1, this.cur), distToPrim(p2, this.cur));
    }

    const candidates = ttrCandidates(p1, p2, R);
    if (!candidates.length) return null;
    const best = pickNearest(candidates, this.cur);
    return best ? { c: best, r: R } : null;
  }

  private placeTtr(): void {
    const preview = this.getTtrPreview();
    if (!preview || preview.r < 0.001) return;
    this.placeCircle(preview.c, preview.r);
    this.reset();
  }

  private placeTtt(): void {
    if (this.picked.length < 3) return;
    const p1 = primFromEntity(this.picked[0], this.cur);
    const p2 = primFromEntity(this.picked[1], this.cur);
    const p3 = primFromEntity(this.picked[2], this.cur);
    if (!p1 || !p2 || !p3) { this.reset(); return; }

    const candidates = tttCandidates(p1, p2, p3, this.cur);
    if (!candidates.length) { this.reset(); return; }
    const best = candidates.reduce((b, x) => {
      const db = Math.hypot(b.c.x - this.cur.x, b.c.y - this.cur.y);
      const dx = Math.hypot(x.c.x - this.cur.x, x.c.y - this.cur.y);
      return dx < db ? x : b;
    });
    this.placeCircle(best.c, best.r);
    this.reset();
  }

  private reset(): void {
    this.picked = [];
    this.hovered = null;
    this.pts = [];
    this.dyn.clearEdits();
    this.vm.markDirty();
    this.tools.setTool('select');
  }

  // â”€â”€ Drawing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.mode === 'ttr' || this.mode === 'ttt') {
      // Highlight picked entities
      for (const e of this.picked) {
        e.drawHovered(ctx, this.vm, this.doc, 'selected');
      }
      // Hover glow
      if (this.hovered) {
        this.hovered.drawHovered(ctx, this.vm, this.doc, 'hover');
      }
      // TTR: live circle preview
      if (this.mode === 'ttr' && this.picked.length === 2) {
        const preview = this.getTtrPreview();
        if (preview && preview.r > 0.001) {
          const cs = this.vm.w2s(preview.c.x, preview.c.y);
          const rs = preview.r * this.vm.scale;
          ctx.save();
          ctx.beginPath();
          ctx.arc(cs.x, cs.y, rs, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(240,160,48,0.8)';
          ctx.lineWidth = 1;
          ctx.setLineDash([8, 4]);
          ctx.stroke();
          ctx.restore();
        }
      }
      return;
    }

    const res = this.computeCircle();
    if (!res) return;

    if (this.mode === '3p' && this.pts.length === 1) {
      const p1 = this.vm.w2s(this.pts[0].x, this.pts[0].y);
      const p2 = this.vm.w2s(this.cur.x, this.cur.y);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = 'rgba(240,160,48,0.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const c = this.vm.w2s(res.c.x, res.c.y);
    const r = res.r * this.vm.scale;
    if (r < 0.5) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.stroke();

    ctx.beginPath();
    if (this.mode === 'radius' || this.mode === 'diameter') {
      const p1 = this.vm.w2s(this.pts[0].x, this.pts[0].y);
      const angle = Math.atan2(this.cur.y - this.pts[0].y, this.cur.x - this.pts[0].x);
      const ex = this.pts[0].x + res.r * Math.cos(angle);
      const ey = this.pts[0].y + res.r * Math.sin(angle);
      const p2 = this.vm.w2s(ex, ey);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    } else if (this.mode === '2p' && this.pts.length === 1) {
      const p1 = this.vm.w2s(this.pts[0].x, this.pts[0].y);
      const p2 = this.vm.w2s(this.cur.x, this.cur.y);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (this.mode === 'radius' || this.mode === 'diameter') {
      if (this.pts.length !== 1) return null;
      const res = this.computeCircle();
      if (!res) return null;
      const val = this.mode === 'diameter' ? res.r * 2 : res.r;
      const label = this.mode === 'diameter' ? 'Diameter' : 'Radius';
      return {
        wx: this.cur.x, wy: this.cur.y,
        primaryFieldKey: this.mode,
        fields: [{ key: this.mode, label, liveValue: formatLen(val), width: 80 }],
      };
    }

    if (this.mode === 'ttr' && this.picked.length === 2) {
      const preview = this.getTtrPreview();
      return {
        wx: this.cur.x, wy: this.cur.y,
        primaryFieldKey: 'radius',
        fields: [{ key: 'radius', label: 'Radius', liveValue: preview ? formatLen(preview.r) : '', width: 80 }],
      };
    }

    return null;
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (this.mode === 'radius' || this.mode === 'diameter') {
      if (this.pts.length !== 1) return false;
      const val = evalExpression(values[this.mode] ?? '');
      if (val === null || val <= 0) return false;
      const r = this.mode === 'diameter' ? val / 2 : val;
      this.placeCircle(this.pts[0], r);
      this.pts = [];
      this.dyn.clearEdits();
      this.vm.markDirty();
      return true;
    }

    if (this.mode === 'ttr' && this.picked.length === 2) {
      const val = evalExpression(values['radius'] ?? '');
      if (val === null || val <= 0) return false;
      const p1 = primFromEntity(this.picked[0], this.cur);
      const p2 = primFromEntity(this.picked[1], this.cur);
      if (!p1 || !p2) return false;
      const candidates = ttrCandidates(p1, p2, val);
      if (!candidates.length) return false;
      const best = pickNearest(candidates, this.cur)!;
      this.placeCircle(best, val);
      this.reset();
      return true;
    }

    return false;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.mode === 'ttr' || this.mode === 'ttt') {
        if (this.picked.length > 0) { this.picked = []; this.vm.markDirty(); }
        else this.tools.setTool('select');
      } else {
        this.pts = [];
        this.dyn.clearEdits();
        this.vm.markDirty();
        this.tools.setTool('select');
      }
    }
    if ((e.key === 'Enter' || e.key === ' ') && this.mode !== 'ttr' && this.mode !== 'ttt') {
      this.pts = [];
      this.dyn.clearEdits();
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  getAnchor(): IPoint | null { return this.pts.length > 0 ? this.pts[this.pts.length - 1] : null; }

  deactivate(): void {
    this.pts = [];
    this.picked = [];
    this.hovered = null;
    this.dyn.clearEdits();
    this.dyn.setState(null);
    this.vm.markDirty();
  }
}

// â”€â”€ Geometry primitives â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface NLine { a: number; b: number; c: number; }
interface NCirc { cx: number; cy: number; r: number; }
type Prim = { kind: 'line'; l: NLine } | { kind: 'circle'; c: NCirc };

function primFromEntity(e: Entity, click: IPoint): Prim | null {
  if (e instanceof LineEntity) {
    const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const a = -dy / len, b = dx / len;
    return { kind: 'line', l: { a, b, c: -(a * e.x1 + b * e.y1) } };
  }
  if (e instanceof CircleEntity) return { kind: 'circle', c: { cx: e.cx, cy: e.cy, r: e.r } };
  if (e instanceof ArcEntity) return { kind: 'circle', c: { cx: e.cx, cy: e.cy, r: e.r } };
  if (e instanceof PolylineEntity && e.pts.length >= 2) {
    let bestDist = Infinity, bestI = 0;
    const n = e.pts.length;
    const segs = e.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      const mx = (e.pts[i].x + e.pts[j].x) / 2, my = (e.pts[i].y + e.pts[j].y) / 2;
      const d = Math.hypot(mx - click.x, my - click.y);
      if (d < bestDist) { bestDist = d; bestI = i; }
    }
    const j = (bestI + 1) % n;
    const dx = e.pts[j].x - e.pts[bestI].x, dy = e.pts[j].y - e.pts[bestI].y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const a = -dy / len, b = dx / len;
    return { kind: 'line', l: { a, b, c: -(a * e.pts[bestI].x + b * e.pts[bestI].y) } };
  }
  return null;
}

function distToPrim(p: Prim, pt: IPoint): number {
  if (p.kind === 'line') return Math.abs(p.l.a * pt.x + p.l.b * pt.y + p.l.c);
  return Math.abs(Math.hypot(pt.x - p.c.cx, pt.y - p.c.cy) - p.c.r);
}

function linesIntersect(l1: NLine, l2: NLine): IPoint | null {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-10) return null;
  return { x: (-l1.c * l2.b + l2.c * l1.b) / det, y: (-l1.a * l2.c + l2.a * l1.c) / det };
}

function lineCircPts(l: NLine, c: NCirc): IPoint[] {
  const dist = l.a * c.cx + l.b * c.cy + l.c;
  const h2 = c.r * c.r - dist * dist;
  if (h2 < -1e-9) return [];
  const fx = c.cx - l.a * dist, fy = c.cy - l.b * dist;
  if (h2 < 1e-9) return [{ x: fx, y: fy }];
  const h = Math.sqrt(h2);
  return [{ x: fx + l.b * h, y: fy - l.a * h }, { x: fx - l.b * h, y: fy + l.a * h }];
}

function circCircPts(c1: NCirc, c2: NCirc): IPoint[] {
  const dx = c2.cx - c1.cx, dy = c2.cy - c1.cy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > c1.r + c2.r + 1e-9 || d < Math.abs(c1.r - c2.r) - 1e-9) return [];
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
  const h2 = Math.max(0, c1.r * c1.r - a * a);
  const mx = c1.cx + a * dx / d, my = c1.cy + a * dy / d;
  if (h2 < 1e-9) return [{ x: mx, y: my }];
  const h = Math.sqrt(h2);
  return [{ x: mx + h * dy / d, y: my - h * dx / d }, { x: mx - h * dy / d, y: my + h * dx / d }];
}

function pickNearest(pts: IPoint[], cursor: IPoint): IPoint | null {
  if (!pts.length) return null;
  return pts.reduce((best, p) =>
    Math.hypot(p.x - cursor.x, p.y - cursor.y) < Math.hypot(best.x - cursor.x, best.y - cursor.y) ? p : best
  );
}

/** Fixed radius R, two primitives â†’ candidate circle centers. */
function ttrCandidates(p1: Prim, p2: Prim, R: number): IPoint[] {
  const getLoci = (p: Prim): Array<{ kind: 'line'; l: NLine } | { kind: 'circle'; c: NCirc }> => {
    if (p.kind === 'line') {
      return [
        { kind: 'line', l: { a: p.l.a, b: p.l.b, c: p.l.c + R } },
        { kind: 'line', l: { a: p.l.a, b: p.l.b, c: p.l.c - R } },
      ];
    }
    return [
      { kind: 'circle', c: { cx: p.c.cx, cy: p.c.cy, r: R + p.c.r } },
      { kind: 'circle', c: { cx: p.c.cx, cy: p.c.cy, r: Math.abs(R - p.c.r) } },
    ];
  };

  const pts: IPoint[] = [];
  for (const l1 of getLoci(p1)) {
    for (const l2 of getLoci(p2)) {
      if (l1.kind === 'line' && l2.kind === 'line')
        { const pt = linesIntersect(l1.l, l2.l); if (pt) pts.push(pt); }
      else if (l1.kind === 'line' && l2.kind === 'circle')
        pts.push(...lineCircPts(l1.l, l2.c));
      else if (l1.kind === 'circle' && l2.kind === 'line')
        pts.push(...lineCircPts(l2.l, l1.c));
      else if (l1.kind === 'circle' && l2.kind === 'circle')
        pts.push(...circCircPts(l1.c, l2.c));
    }
  }
  return pts;
}

/** Solves J*delta = rhs for a 3Ã—3 system via Gaussian elimination. */
function solve3x3(J: number[][], rhs: number[]): [number, number, number] | null {
  const M = J.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const f = M[row][col] / M[col][col];
      for (let c = col; c <= 3; c++) M[row][c] -= f * M[col][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** Newton iteration for Apollonius problem: find circle tangent to all 3 primitives. */
function apolloniusNewton(prims: Prim[], signs: number[], cursor: IPoint): { c: IPoint; r: number } | null {
  // Initial guess: centroid of entity centers, R â‰ˆ 10% of entity spread
  let cx = cursor.x, cy = cursor.y;
  let centerCount = 0;
  for (const p of prims) {
    if (p.kind === 'circle') { cx += p.c.cx; cy += p.c.cy; centerCount++; }
  }
  if (centerCount > 0) { cx /= (centerCount + 1); cy /= (centerCount + 1); }
  let R = 10;

  for (let iter = 0; iter < 60; iter++) {
    const f: number[] = [];
    const J: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const p = prims[i], s = signs[i];
      if (p.kind === 'line') {
        const dist = p.l.a * cx + p.l.b * cy + p.l.c;
        f.push(s * dist - R);
        J.push([s * p.l.a, s * p.l.b, -1]);
      } else {
        const d = Math.hypot(cx - p.c.cx, cy - p.c.cy);
        if (d < 1e-9) return null;
        f.push(d - s * p.c.r - R);
        J.push([(cx - p.c.cx) / d, (cy - p.c.cy) / d, -1]);
      }
    }
    const delta = solve3x3(J, f.map(v => -v));
    if (!delta) break;
    cx += delta[0]; cy += delta[1]; R += delta[2];
    if (Math.hypot(delta[0], delta[1]) < 1e-7 && Math.abs(delta[2]) < 1e-7) break;
  }
  return R > 0.001 ? { c: { x: cx, y: cy }, r: R } : null;
}

/** 3-lines fast analytical solver (angle bisectors). */
function apolloniusLines3(l1: NLine, l2: NLine, l3: NLine): Array<{ c: IPoint; r: number }> {
  const results: Array<{ c: IPoint; r: number }> = [];
  for (const s2 of [1, -1]) for (const s3 of [1, -1]) {
    const b12: NLine = { a: l1.a - s2 * l2.a, b: l1.b - s2 * l2.b, c: l1.c - s2 * l2.c };
    const b13: NLine = { a: l1.a - s3 * l3.a, b: l1.b - s3 * l3.b, c: l1.c - s3 * l3.c };
    const center = linesIntersect(b12, b13);
    if (!center) continue;
    const R = l1.a * center.x + l1.b * center.y + l1.c;
    if (Math.abs(R) > 0.001) results.push({ c: center, r: Math.abs(R) });
  }
  return results;
}

/** TTT: find circle tangent to three primitives, return candidates sorted by proximity to cursor. */
function tttCandidates(p1: Prim, p2: Prim, p3: Prim, cursor: IPoint): Array<{ c: IPoint; r: number }> {
  const prims = [p1, p2, p3];

  if (p1.kind === 'line' && p2.kind === 'line' && p3.kind === 'line') {
    return apolloniusLines3(p1.l, p2.l, p3.l);
  }

  // Numerical solver for all cases
  const raw: Array<{ c: IPoint; r: number }> = [];
  for (let mask = 0; mask < 8; mask++) {
    const signs = [(mask & 1) ? 1 : -1, (mask & 2) ? 1 : -1, (mask & 4) ? 1 : -1];
    const sol = apolloniusNewton(prims, signs, cursor);
    if (sol) raw.push(sol);
  }

  // Deduplicate (center within 0.01 units)
  const result: Array<{ c: IPoint; r: number }> = [];
  for (const s of raw) {
    if (!result.some(d => Math.hypot(d.c.x - s.c.x, d.c.y - s.c.y) < 0.01)) {
      result.push(s);
    }
  }
  return result;
}
