import { Injectable } from '@angular/core';
import type { HatchEntity, IHatchEdge } from '../models/entity-extended.model';
import type { ViewModelLike, DocLike } from '../models/entity.model';
import { HATCH_PATTERNS, resolveHatchPattern } from '../registries/hatch-patterns';
import { planPatternFamilies, intersectRects, type IFamilyPlan } from './hatch-pattern-geometry';
import { traceFrozenLoopToPath, frozenLoopToPolygon } from '../models/hatch-boundary.model';

/** Utility polygon type for island detection math */
interface IPolygonLoop {
  pts: { x: number; y: number }[];
  depth: number;
  isExternal: boolean;
  // Store the raw path data so we can build a Path2D easily
  pathBuilder: (path: Path2D) => void;
}

@Injectable({
  providedIn: 'root'
})
export class HatchRendererService {
  /**
   * Draws the given HatchEntity onto the canvas.
   * Handles island detection (Normal/Outer/Ignore), solid fills, gradients, and pattern rendering.
   */
  static drawHatch(
    ctx: CanvasRenderingContext2D,
    vm: ViewModelLike,
    doc: DocLike,
    hatch: HatchEntity,
    color: string
  ): void {
    // 1. Resolve and categorize boundary loops
    const loops = this.buildIslandHierarchy(hatch, vm, doc);
    if (!loops || loops.length === 0) return;

    // 2. Filter loops based on hatchStyle
    // Normal: alternate depths (default canvas evenodd handles this, so we keep all loops)
    // Outer: only keep depth 0 (outermost) and depth 1 (first island hole). Discard depth >= 2.
    // Ignore: keep only depth 0 (outermost). Discard all others.
    let activeLoops = loops;
    if (hatch.hatchStyle === 'Outer') {
      activeLoops = loops.filter(l => l.depth <= 1);
    } else if (hatch.hatchStyle === 'Ignore') {
      activeLoops = loops.filter(l => l.depth === 0);
    }

    // 3. Build the final Path2D
    const path = new Path2D();
    for (const loop of activeLoops) {
      loop.pathBuilder(path);
      // Ensure the loop is closed so evenodd fill rule works correctly
      path.closePath();
    }

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    if (hatch.transparency > 0) ctx.globalAlpha = 1 - hatch.transparency / 100;

    // 4. Background Color Fill
    if (hatch.backgroundColor && hatch.backgroundColor !== 'none' && hatch.backgroundColor !== 'transparent') {
      ctx.save();
      // Assume DXF_ACI_COLORS resolution is handled by caller or we just use it if it's a string
      ctx.fillStyle = typeof hatch.backgroundColor === 'string' ? hatch.backgroundColor : '#ffffff';
      ctx.fill(path, 'evenodd');
      ctx.restore();
    }

    const b = hatch.bbox();

    // 5. Solid / Gradient / Pattern
    if (hatch.isSolid) {
      if (hatch.gradientType && b && b.w > 0 && b.h > 0) {
        ctx.fillStyle = this.createGradient(ctx, vm, hatch, b);
      }
      ctx.fill(path, 'evenodd');
    } else {
      ctx.clip(path, 'evenodd');
      if (b && b.w > 0 && b.h > 0) this.drawPattern(ctx, vm, hatch, b, path);
    }
  }

  // ---- Island Detection Math ----

  private static buildIslandHierarchy(hatch: HatchEntity, vm: ViewModelLike, doc: DocLike): IPolygonLoop[] | null {
    const loops: IPolygonLoop[] = [];

    // Extract loops from boundarySpec (Phase 3+) or legacy boundaries
    if (hatch.boundarySpec) {
      // Render from frozen loops if they exist (even if associative = true, which happens for region hatches
      // whose frozen loops are dynamically updated by HatchRegenScheduler on host modification).
      const hasFrozenLoops = hatch.boundarySpec.loops?.some(l => l.frozen?.length);
      
      if (!hatch.boundarySpec.associative || hasFrozenLoops) {
        for (const specLoop of hatch.boundarySpec.loops) {
          if (!specLoop.frozen?.length) continue;
          // Sample curves so island-containment math sees the true shape.
          const pts = frozenLoopToPolygon(specLoop.frozen);
          loops.push({
            pts,
            depth: 0,
            isExternal: false,
            pathBuilder: (path: Path2D) => traceFrozenLoopToPath(path, specLoop.frozen!, vm),
          });
        }
      } else if (doc?.entities) {
        const bEnts = hatch.boundarySpec.contributingEntityIds
          .map((id: number) => (doc.entities as any).find((e: any) => e.id === id))
          .filter(Boolean);
        for (const e of bEnts) {
          const pts = this.extractEntityPolygon(e);
          if (pts.length > 2) {
            loops.push({
              pts,
              depth: 0,
              isExternal: false,
              pathBuilder: (path: Path2D) => this.addEntityToPath(path, e, vm)
            });
          }
        }
      }
    } else {
      // Legacy path
      const hasEnts = hatch.boundaryEntIds.length > 0;
      const hasBounds = hatch.boundaries?.length > 0;
      if (!hasEnts && !hasBounds) return null;

      if (hatch.associative && hasEnts && doc?.entities) {
        const bEnts = hatch.boundaryEntIds
          .map((id) => (doc.entities as any).find((e: any) => e.id === id))
          .filter(Boolean);
        for (const e of bEnts) {
          const pts = this.extractEntityPolygon(e);
          if (pts.length > 2) {
            loops.push({
              pts,
              depth: 0,
              isExternal: false,
              pathBuilder: (path: Path2D) => this.addEntityToPath(path, e, vm)
            });
          }
        }
      }

      if (hasBounds) {
        for (const bLoop of hatch.boundaries) {
          if (!bLoop?.length) continue;
          const pts: { x: number; y: number }[] = [];
          for (const edge of bLoop) {
            if (edge.start) pts.push(edge.start);
          }
          if (pts.length > 2) {
            loops.push({
              pts,
              depth: 0,
              isExternal: false,
              pathBuilder: (path: Path2D) => {
                let started = false;
                for (const edge of bLoop) {
                  this.addEdgeToPath(path, edge, vm, () => started, () => { started = true; });
                }
              }
            });
          }
        }
      }
    }

    if (loops.length === 0) return null;

    // Calculate containment depth for each loop
    for (let i = 0; i < loops.length; i++) {
      for (let j = 0; j < loops.length; j++) {
        if (i === j) continue;
        if (this.polygonContainsPolygon(loops[j].pts, loops[i].pts)) {
          loops[i].depth++;
        }
      }
    }

    return loops;
  }

  private static pointInPolygon(point: { x: number; y: number }, vs: { x: number; y: number }[]): boolean {
    const x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i].x, yi = vs[i].y;
      const xj = vs[j].x, yj = vs[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private static polygonContainsPolygon(outer: { x: number; y: number }[], inner: { x: number; y: number }[]): boolean {
    // Check if at least one point of 'inner' is inside 'outer'
    // For robust containment, all points should be inside, but testing the first valid point is usually enough for well-formed hatches.
    if (!inner.length || !outer.length) return false;
    return this.pointInPolygon(inner[0], outer);
  }

  private static extractEntityPolygon(e: any): { x: number; y: number }[] {
    if (!e) return [];
    if (e.type === 'POLYLINE') return e.pts || [];
    if (e.type === 'CIRCLE' || e.type === 'ARC') {
      const pts = [];
      const segments = 64;
      const start = e.startAngle ?? 0;
      const end = e.endAngle ?? (Math.PI * 2);
      let sweep = end - start;
      if (sweep < 0 && e.type === 'ARC') sweep += Math.PI * 2;
      if (e.type === 'CIRCLE') sweep = Math.PI * 2;
      for (let i = 0; i <= segments; i++) {
        const theta = start + (i / segments) * sweep;
        pts.push({ x: e.cx + e.r * Math.cos(theta), y: e.cy + e.r * Math.sin(theta) });
      }
      return pts;
    }
    if (e.type === 'ELLIPSE') {
      const pts = [];
      const segments = 64;
      const start = e.startAngle ?? 0;
      const end = e.endAngle ?? (Math.PI * 2);
      let sweep = end - start;
      if (sweep < 0) sweep += Math.PI * 2;
      const cosRot = Math.cos(e.rotation || 0);
      const sinRot = Math.sin(e.rotation || 0);
      for (let i = 0; i <= segments; i++) {
        const theta = start + (i / segments) * sweep;
        const px = e.rx * Math.cos(theta);
        const py = e.ry * Math.sin(theta);
        pts.push({
          x: e.cx + px * cosRot - py * sinRot,
          y: e.cy + px * sinRot + py * cosRot
        });
      }
      return pts;
    }
    if (e.type === 'LINE') return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
    return []; // For splines, we rely on topology mode
  }

  // ---- Gradient Generation ----

  private static createGradient(ctx: CanvasRenderingContext2D, vm: ViewModelLike, hatch: HatchEntity, bbox: any): CanvasGradient {
    const sMin = vm.w2s(bbox.x, bbox.y + bbox.h);
    const sMax = vm.w2s(bbox.x + bbox.w, bbox.y);
    const x0 = Math.min(sMin.x, sMax.x);
    const y0 = Math.min(sMin.y, sMax.y);
    const w = Math.abs(sMax.x - sMin.x);
    const h = Math.abs(sMax.y - sMin.y);

    const c1 = hatch.gradientColor1 || '#ffffff';
    const c2 = hatch.gradientColor2 || '#000000';

    // Simplistic handling of linear vs radial based on AutoCAD gradient names
    const isRadial = hatch.gradientType?.includes('cylinder') || hatch.gradientType?.includes('spherical');

    let grad: CanvasGradient;
    if (isRadial) {
      const cx = x0 + w / 2;
      const cy = y0 + h / 2;
      const r = Math.max(w, h) / 2;
      grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    } else {
      const angle = (hatch.gradientAngle || 0) * Math.PI / 180;
      const cx = x0 + w / 2;
      const cy = y0 + h / 2;
      const r = Math.max(w, h) / 2;
      grad = ctx.createLinearGradient(
        cx - Math.cos(angle) * r,
        cy + Math.sin(angle) * r,
        cx + Math.cos(angle) * r,
        cy - Math.sin(angle) * r
      );
    }

    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    return grad;
  }

  // ---- Geometry Builders ----

  private static addEntityToPath(path: Path2D, e: any, vm: ViewModelLike): void {
    if (!e) return;
    if (e.type === 'LINE') {
      const p1 = vm.w2s(e.x1, e.y1), p2 = vm.w2s(e.x2, e.y2);
      path.moveTo(p1.x, p1.y); path.lineTo(p2.x, p2.y);
    } else if (e.type === 'POLYLINE') {
      if (!e.pts?.length) return;
      const p0 = vm.w2s(e.pts[0].x, e.pts[0].y);
      path.moveTo(p0.x, p0.y);
      for (let i = 1; i < e.pts.length; i++) {
        const p = vm.w2s(e.pts[i].x, e.pts[i].y);
        path.lineTo(p.x, p.y);
      }
      if (e.closed) path.closePath();
    } else if (e.type === 'CIRCLE') {
      const c = vm.w2s(e.cx, e.cy);
      const r = e.r * vm.scale;
      path.moveTo(c.x + r, c.y);
      path.arc(c.x, c.y, r, 0, Math.PI * 2);
    } else if (e.type === 'ARC') {
      const c = vm.w2s(e.cx, e.cy);
      path.arc(c.x, c.y, e.r * vm.scale, (-e.startAngle * Math.PI) / 180, (-e.endAngle * Math.PI) / 180, true);
    } else if (e.type === 'ELLIPSE') {
      const c = vm.w2s(e.cx, e.cy);
      path.ellipse(c.x, c.y, e.rx * vm.scale, e.ry * vm.scale, -e.rotation, -e.startAngle, -e.endAngle, true);
    } else if (e.type === 'SPLINE') {
      if (!e.controlPoints?.length) return;
      const p0 = vm.w2s(e.controlPoints[0].x, e.controlPoints[0].y);
      path.moveTo(p0.x, p0.y);
      for (let i = 1; i < e.controlPoints.length; i++) {
        const p = vm.w2s(e.controlPoints[i].x, e.controlPoints[i].y);
        path.lineTo(p.x, p.y);
      }
    }
  }

  private static addEdgeToPath(path: Path2D, edge: IHatchEdge, vm: ViewModelLike, isStarted: () => boolean, markStarted: () => void): void {
    const move = (p: { x: number; y: number }) => {
      const s = vm.w2s(p.x, p.y);
      if (!isStarted()) { path.moveTo(s.x, s.y); markStarted(); }
      else path.lineTo(s.x, s.y);
    };
    if (edge.start) {
      move(edge.start);
      if (edge.end) move(edge.end);
      return;
    }
    if (Array.isArray(edge.vertices) && edge.vertices.length) {
      for (const v of edge.vertices) move(v);
      return;
    }
    if (edge.center && typeof edge.radius === 'number') {
      // Simplistic arc fallback since we extracted tessellateArc
      const s = vm.w2s(edge.center.x, edge.center.y);
      path.arc(s.x, s.y, edge.radius * vm.scale, 0, Math.PI * 2);
      return;
    }
  }

  // ---- Pattern Rendering ----

  /**
   * Stroke the pattern families inside the boundary, which the caller has
   * already set as the clip. Geometry comes from `planPatternFamilies` (shared
   * with the PDF exporter); this method only maps world segments through
   * `vm.w2s` and sets canvas dash state.
   *
   * `path` is the boundary: a family the planner decides is too dense to draw
   * as lines is painted as a translucent fill of it instead.
   *
   * DXF-embedded definitions (`customPatternLines`, normalised at import to
   * unscaled / unrotated / along-perpendicular form) take precedence over the
   * registry, so patterns CADO does not ship still draw as the file defines.
   */
  private static drawPattern(
    ctx: CanvasRenderingContext2D,
    vm: ViewModelLike,
    hatch: HatchEntity,
    bbox: { x: number; y: number; w: number; h: number },
    path: Path2D,
  ): void {
    const lines = hatch.customPatternLines?.length
      ? hatch.customPatternLines
      : (resolveHatchPattern(hatch.pattern) ?? HATCH_PATTERNS['ANSI31']).lines;
    if (!lines.length) return;

    // Only the visible part of the boundary needs lines. A block's insertVm
    // has no notion of the screen (its s2w answers in the parent's space), so
    // it falls back to the boundary bbox.
    const visible = typeof vm.visibleWorldRect === 'function' ? vm.visibleWorldRect() : null;
    const clip = intersectRects(bbox, visible);
    if (!clip) return;

    const ppu = vm.cumulativeScale ?? vm.scale ?? 1;
    const xf = {
      scale: hatch.scale || 1,
      angleDeg: hatch.angle || 0,
      originX: hatch.originX || 0,
      originY: hatch.originY || 0,
    };
    let plans = planPatternFamilies(lines, xf, { clip, pixelsPerUnit: ppu });
    if (hatch.doubleHatch) {
      plans = plans.concat(planPatternFamilies(lines, { ...xf, angleDeg: xf.angleDeg + 90 }, { clip, pixelsPerUnit: ppu }));
    }
    this.strokePlans(ctx, vm, plans, path, ppu);
  }

  private static strokePlans(
    ctx: CanvasRenderingContext2D,
    vm: ViewModelLike,
    plans: IFamilyPlan[],
    path: Path2D,
    ppu: number,
  ): void {
    const baseAlpha = ctx.globalAlpha;
    for (const fam of plans) {
      if (fam.mode === 'fill') {
        ctx.globalAlpha = baseAlpha * fam.fillAlpha;
        ctx.fill(path, 'evenodd');
        continue;
      }
      // fillAlpha < 1 here means a dashed family collapsed to continuous lines
      // because its dashes were sub-pixel; the alpha keeps its ink density.
      ctx.globalAlpha = baseAlpha * fam.fillAlpha;
      // A zero-length dash only paints with round caps — that is how a .pat
      // dot becomes a dot on screen.
      ctx.lineCap = fam.hasDots ? 'round' : 'butt';
      if (fam.dash) {
        ctx.setLineDash(fam.dash.map((v) => v * ppu));
        ctx.lineDashOffset = fam.dashOffset * ppu;
      } else {
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
      // Every segment starts on a period boundary of its own line, so one
      // subpath per line and one stroke per family gives the right phase.
      ctx.beginPath();
      for (const s of fam.segments) {
        const a = vm.w2s(s.x1, s.y1);
        const b = vm.w2s(s.x2, s.y2);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = baseAlpha;
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.lineCap = 'butt';
  }
}
