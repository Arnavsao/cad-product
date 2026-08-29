import { Injectable } from '@angular/core';
import type { HatchEntity, IHatchEdge } from '../models/entity-extended.model';
import type { ViewModelLike, DocLike } from '../models/entity.model';
import { HATCH_PATTERNS } from '../registries/hatch-patterns';
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
      if (b && b.w > 0 && b.h > 0) {
        if (hatch.pattern === 'HEX' || hatch.pattern === 'HONEY') {
          this.drawHexagonalPattern(ctx, vm, hatch, b);
        } else if (hatch.pattern === 'GRAVEL') {
          this.drawGravelPattern(ctx, vm, hatch, b);
        } else if (hatch.pattern === 'AR-CONC' || hatch.pattern === 'AR-CONC') {
          // AR-CONC (concrete aggregate): always use the stone renderer.
          // The DXF’s customPatternLines define the mathematical pattern, but at
          // typical engineering-drawing zoom those fine lines (0.25" pattern units
          // at scale 2.5) collapse into an illegible dense mesh — exactly image 1.
          // AutoCAD compensates with rasterised LOD; we replicate that visual by
          // rendering deterministic triangular/quad stone shapes instead.
          this.drawArConcStones(ctx, vm, hatch, b);
        } else {
          this.drawPattern(ctx, vm, hatch, b);
        }
      }
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

  private static drawPattern(ctx: CanvasRenderingContext2D, vm: ViewModelLike, hatch: HatchEntity, bbox: any): void {
    // If the hatch carries DXF-embedded custom pattern definition lines,
    // use those directly instead of the built-in registry.
    if (hatch.customPatternLines && hatch.customPatternLines.length > 0) {
      this.drawCustomPatternLines(ctx, vm, hatch, bbox);
      return;
    }
    this.drawPatternPass(ctx, vm, hatch, bbox, hatch.angle || 0);
    if (hatch.doubleHatch) {
      this.drawPatternPass(ctx, vm, hatch, bbox, (hatch.angle || 0) + 90);
    }
  }

  private static drawPatternPass(ctx: CanvasRenderingContext2D, vm: ViewModelLike, hatch: HatchEntity, bbox: any, currentAngle: number): void {
    // Support both hyphenated ('AR-SAND') and underscored ('AR_SAND') keys
    const normalizedKey = hatch.pattern?.replace(/-/g, '_');
    const pat = HATCH_PATTERNS[hatch.pattern] ?? HATCH_PATTERNS[normalizedKey] ?? HATCH_PATTERNS['ANSI31'];
    const scale = Math.max(0.01, hatch.scale || 1);
    const globalAngleRad = (currentAngle * Math.PI) / 180;

    const diag = Math.hypot(bbox.w, bbox.h) * 2 + 4;
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    // Budget guard: prevent runaway rendering (reduced to 2000 to fix zoom-out lag)
    const MAX_LINES = 2000;

    for (const lineDef of pat.lines) {
      ctx.beginPath();
      const rad = (lineDef.angle * Math.PI) / 180 + globalAngleRad;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      let x0 = lineDef.x0 * scale;
      let y0 = lineDef.y0 * scale;
      if (globalAngleRad !== 0) {
        const rx0 = x0 * Math.cos(globalAngleRad) - y0 * Math.sin(globalAngleRad);
        const ry0 = x0 * Math.sin(globalAngleRad) + y0 * Math.cos(globalAngleRad);
        x0 = rx0; y0 = ry0;
      }
      x0 += (hatch.originX || 0);
      y0 += (hatch.originY || 0);

      const spacing = lineDef.dy * scale;
      const shift = lineDef.dx * scale;

      if (spacing < 0.001) {
        const lx1 = cx - cosA * diag, ly1 = cy - sinA * diag;
        const lx2 = cx + cosA * diag, ly2 = cy + sinA * diag;
        const sp1 = vm.w2s(lx1, ly1), sp2 = vm.w2s(lx2, ly2);
        ctx.moveTo(sp1.x, sp1.y);
        ctx.lineTo(sp2.x, sp2.y);
      } else {
        const centerNormalDist = (cx - x0) * (-sinA) + (cy - y0) * cosA;
        const halfRange = diag / 2;

        let startI = Math.floor((centerNormalDist - halfRange) / spacing) - 1;
        let endI = Math.ceil((centerNormalDist + halfRange) / spacing) + 1;

        // Budget guard: if the range exceeds MAX_LINES, skip every Nth line
        const lineCount = endI - startI + 1;
        const step = lineCount > MAX_LINES ? Math.ceil(lineCount / MAX_LINES) : 1;

        for (let i = startI; i <= endI; i += step) {
          const perpDist = i * spacing;
          const shiftDist = i * shift;
          const px = x0 - sinA * perpDist + cosA * shiftDist;
          const py = y0 + cosA * perpDist + sinA * shiftDist;

          const parallelDist = (cx - px) * cosA + (cy - py) * sinA;
          const lineCx = px + parallelDist * cosA;
          const lineCy = py + parallelDist * sinA;

          const lx1 = lineCx - cosA * diag, ly1 = lineCy - sinA * diag;
          const lx2 = lineCx + cosA * diag, ly2 = lineCy + sinA * diag;
          const sp1 = vm.w2s(lx1, ly1), sp2 = vm.w2s(lx2, ly2);
          ctx.moveTo(sp1.x, sp1.y);
          ctx.lineTo(sp2.x, sp2.y);
          if ((window as any).__hatchLinesRendered !== undefined) (window as any).__hatchLinesRendered++;
        }
      }

      if (lineDef.dashArray?.length) {
        ctx.setLineDash(lineDef.dashArray.map((v: number) => Math.abs(v) * scale * vm.scale));
        ctx.lineDashOffset = -(diag * vm.scale);
      } else {
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }

      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  /**
   * Render pattern using DXF-embedded custom pattern definition lines.
   * The hatch entity carries its own line definitions (angle, origin, offset, dashes)
   * parsed directly from the DXF file, so this bypasses the built-in registry.
   */
  private static drawCustomPatternLines(ctx: CanvasRenderingContext2D, vm: ViewModelLike, hatch: HatchEntity, bbox: any): void {
    const scale = Math.max(0.01, hatch.scale || 1);
    const globalAngleRad = ((hatch.angle || 0) * Math.PI) / 180;
    const diag = Math.hypot(bbox.w, bbox.h) * 2 + 4;
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const MAX_LINES = 2000;

    for (const lineDef of hatch.customPatternLines!) {
      ctx.beginPath();
      const rad = (lineDef.angle * Math.PI) / 180 + globalAngleRad;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      let x0 = lineDef.x0 * scale;
      let y0 = lineDef.y0 * scale;
      if (globalAngleRad !== 0) {
        const rx0 = x0 * Math.cos(globalAngleRad) - y0 * Math.sin(globalAngleRad);
        const ry0 = x0 * Math.sin(globalAngleRad) + y0 * Math.cos(globalAngleRad);
        x0 = rx0; y0 = ry0;
      }
      x0 += (hatch.originX || 0);
      y0 += (hatch.originY || 0);

      const spacing = Math.abs(lineDef.dy) * scale;
      const shift = lineDef.dx * scale;

      if (spacing < 0.001) {
        const lx1 = cx - cosA * diag, ly1 = cy - sinA * diag;
        const lx2 = cx + cosA * diag, ly2 = cy + sinA * diag;
        const sp1 = vm.w2s(lx1, ly1), sp2 = vm.w2s(lx2, ly2);
        ctx.moveTo(sp1.x, sp1.y);
        ctx.lineTo(sp2.x, sp2.y);
      } else {
        const centerNormalDist = (cx - x0) * (-sinA) + (cy - y0) * cosA;
        const halfRange = diag / 2;
        let startI = Math.floor((centerNormalDist - halfRange) / spacing) - 1;
        let endI = Math.ceil((centerNormalDist + halfRange) / spacing) + 1;
        const lineCount = endI - startI + 1;
        const step = lineCount > MAX_LINES ? Math.ceil(lineCount / MAX_LINES) : 1;

        for (let i = startI; i <= endI; i += step) {
          const perpDist = i * spacing;
          const shiftDist = i * shift;
          const px = x0 - sinA * perpDist + cosA * shiftDist;
          const py = y0 + cosA * perpDist + sinA * shiftDist;

          const parallelDist = (cx - px) * cosA + (cy - py) * sinA;
          const lineCx = px + parallelDist * cosA;
          const lineCy = py + parallelDist * sinA;

          const lx1 = lineCx - cosA * diag, ly1 = lineCy - sinA * diag;
          const lx2 = lineCx + cosA * diag, ly2 = lineCy + sinA * diag;
          const sp1 = vm.w2s(lx1, ly1), sp2 = vm.w2s(lx2, ly2);
          ctx.moveTo(sp1.x, sp1.y);
          ctx.lineTo(sp2.x, sp2.y);
          if ((window as any).__hatchLinesRendered !== undefined) (window as any).__hatchLinesRendered++;
        }
      }

      if (lineDef.dashArray?.length) {
        ctx.setLineDash(lineDef.dashArray.map((v: number) => Math.abs(v) * scale * vm.scale));
        ctx.lineDashOffset = -(diag * vm.scale);
      } else {
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  private static drawHexagonalPattern(ctx: CanvasRenderingContext2D, vm: ViewModelLike, hatch: HatchEntity, bbox: any): void {
    const scale = Math.max(0.01, hatch.scale || 1) * 10;
    const globalAngleRad = (hatch.angle || 0) * Math.PI / 180;
    const isHoney = hatch.pattern === 'HONEY';
    const radius = isHoney ? scale * 0.5 : scale * 1.2;
    const hexWidth = radius * 2;
    const hexHeight = Math.sqrt(3) * radius;
    const hSpacing = hexWidth * 0.75;
    const vSpacing = hexHeight;

    let uMinX = Infinity, uMaxX = -Infinity, uMinY = Infinity, uMaxY = -Infinity;
    const corners = [
      { x: bbox.x, y: bbox.y }, { x: bbox.x + bbox.w, y: bbox.y },
      { x: bbox.x, y: bbox.y + bbox.h }, { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
    ];
    for (const pt of corners) {
      const urx = pt.x * Math.cos(-globalAngleRad) - pt.y * Math.sin(-globalAngleRad);
      const ury = pt.x * Math.sin(-globalAngleRad) + pt.y * Math.cos(-globalAngleRad);
      uMinX = Math.min(uMinX, urx); uMaxX = Math.max(uMaxX, urx);
      uMinY = Math.min(uMinY, ury); uMaxY = Math.max(uMaxY, ury);
    }

    const startC = Math.floor(uMinX / hSpacing) - 1;
    const endC = Math.ceil(uMaxX / hSpacing) + 1;
    let startR = Math.floor(uMinY / vSpacing) - 1;
    let endR = Math.ceil(uMaxY / vSpacing) + 1;

    // Budget guard
    const maxCells = 50000;
    const numCells = (endC - startC + 1) * (endR - startR + 1);
    let step = 1;
    if (numCells > maxCells) {
      step = Math.ceil(Math.sqrt(numCells / maxCells));
    }

    ctx.beginPath();
    for (let c = startC; c <= endC; c += step) {
      for (let r = startR; r <= endR; r += step) {
        let cx = c * hSpacing;
        let cy = r * vSpacing;
        if (Math.abs(c) % 2 === 1) cy += vSpacing / 2;
        const drawRadius = isHoney ? radius : radius * 0.8;

        for (let i = 0; i <= 6; i++) {
          const theta = (i * 60) * Math.PI / 180;
          const vx = cx + drawRadius * Math.cos(theta);
          const vy = cy + drawRadius * Math.sin(theta);
          const rvx = vx * Math.cos(globalAngleRad) - vy * Math.sin(globalAngleRad);
          const rvy = vx * Math.sin(globalAngleRad) + vy * Math.cos(globalAngleRad);
          const spt = vm.w2s(rvx, rvy);
          if (i === 0) ctx.moveTo(spt.x, spt.y);
          else ctx.lineTo(spt.x, spt.y);
        }
      }
    }
    ctx.setLineDash([]);
    ctx.stroke();
  }

  private static drawArConcStones(ctx: CanvasRenderingContext2D, vm: ViewModelLike, hatch: HatchEntity, bbox: any): void {
    // Concrete aggregate pattern — scattered triangular / quad stone shapes with
    // lots of open space between them, matching AutoCAD’s on-screen LOD rendering
    // of AR-CONC at typical engineering-drawing zoom levels.
    const scale = Math.max(0.01, hatch.scale || 1) * 10;
    const globalAngleRad = (hatch.angle || 0) * Math.PI / 180;
    const stoneBase = scale;          // base stone radius in world units
    const gridSize = stoneBase * 3.5; // cell size; keeps stones well-separated

    // Iterate over the full bbox in rotated space. The canvas clip (set by the
    // caller) handles pixel-level culling — we must NOT use vm.s2w() for culling
    // here because when drawn through an InsertEntity, vm is insertVm whose s2w()
    // returns parent-world coordinates while bbox is in block-local coordinates.
    let uMinX = Infinity, uMaxX = -Infinity, uMinY = Infinity, uMaxY = -Infinity;
    for (const pt of [
      { x: bbox.x, y: bbox.y }, { x: bbox.x + bbox.w, y: bbox.y },
      { x: bbox.x, y: bbox.y + bbox.h }, { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
    ]) {
      const urx = pt.x * Math.cos(-globalAngleRad) - pt.y * Math.sin(-globalAngleRad);
      const ury = pt.x * Math.sin(-globalAngleRad) + pt.y * Math.cos(-globalAngleRad);
      uMinX = Math.min(uMinX, urx); uMaxX = Math.max(uMaxX, urx);
      uMinY = Math.min(uMinY, ury); uMaxY = Math.max(uMaxY, ury);
    }

    let startC = Math.floor(uMinX / gridSize) - 1;
    let endC = Math.ceil(uMaxX / gridSize) + 1;
    let startR = Math.floor(uMinY / gridSize) - 1;
    let endR = Math.ceil(uMaxY / gridSize) + 1;

    // Adaptive LOD: cap total cells.
    const cellCount = (endC - startC) * (endR - startR);
    if (cellCount > 2000) {
      const lodFactor = Math.ceil(Math.sqrt(cellCount / 2000));
      const ag = gridSize * lodFactor;
      startC = Math.floor(uMinX / ag) - 1; endC = Math.ceil(uMaxX / ag) + 1;
      startR = Math.floor(uMinY / ag) - 1; endR = Math.ceil(uMaxY / ag) + 1;
    }

    const mulberry32 = (a: number) => () => {
      let t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    ctx.beginPath();
    for (let c = startC; c <= endC; c++) {
      for (let r = startR; r <= endR; r++) {
        const seed = (Math.imul(c, 31337) ^ Math.imul(r, 1103515245)) >>> 0;
        const rand = mulberry32(seed);

        // ~55 % of cells contain a stone — realistic aggregate packing density.
        if (rand() > 0.55) continue;

        const pcx = (c + 0.1 + rand() * 0.8) * gridSize;
        const pcy = (r + 0.1 + rand() * 0.8) * gridSize;

        // Mostly triangles (crushed aggregate), occasionally quads.
        const numSides = rand() < 0.7 ? 3 : 4;
        const baseAngle = rand() * Math.PI * 2;          // random orientation
        const baseRadius = stoneBase * (0.45 + rand() * 0.55);

        const points: { x: number; y: number }[] = [];
        for (let k = 0; k < numSides; k++) {
          const theta = baseAngle + (k / numSides) * Math.PI * 2;
          // Crushed aggregate = angular, irregular edges.
          const pr = baseRadius * (0.55 + rand() * 0.8);
          const vx = pcx + pr * Math.cos(theta);
          const vy = pcy + pr * Math.sin(theta);
          const rvx = vx * Math.cos(globalAngleRad) - vy * Math.sin(globalAngleRad);
          const rvy = vx * Math.sin(globalAngleRad) + vy * Math.cos(globalAngleRad);
          points.push(vm.w2s(rvx, rvy));
        }

        if (points.length >= 3) {
          ctx.moveTo(points[0].x, points[0].y);
          for (let k = 1; k < points.length; k++) ctx.lineTo(points[k].x, points[k].y);
          ctx.closePath();
        }
      }
    }
    ctx.setLineDash([]);
    ctx.stroke();
  }

  private static drawGravelPattern(ctx: CanvasRenderingContext2D, vm: ViewModelLike, hatch: HatchEntity, bbox: any): void {
    const scale = Math.max(0.01, hatch.scale || 1) * 10;
    const globalAngleRad = (hatch.angle || 0) * Math.PI / 180;
    const gridSize = scale * 2.5;

    // Iterate over the full bbox in rotated space. The canvas clip (set by the
    // caller) handles pixel-level culling — we must NOT use vm.s2w() for culling
    // here because when drawn through an InsertEntity, vm is insertVm whose s2w()
    // returns parent-world coordinates while bbox is in block-local coordinates.
    let uMinX = Infinity, uMaxX = -Infinity, uMinY = Infinity, uMaxY = -Infinity;
    for (const pt of [
      { x: bbox.x, y: bbox.y }, { x: bbox.x + bbox.w, y: bbox.y },
      { x: bbox.x, y: bbox.y + bbox.h }, { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
    ]) {
      const urx = pt.x * Math.cos(-globalAngleRad) - pt.y * Math.sin(-globalAngleRad);
      const ury = pt.x * Math.sin(-globalAngleRad) + pt.y * Math.cos(-globalAngleRad);
      uMinX = Math.min(uMinX, urx); uMaxX = Math.max(uMaxX, urx);
      uMinY = Math.min(uMinY, ury); uMaxY = Math.max(uMaxY, ury);
    }

    let startC = Math.floor(uMinX / gridSize) - 1;
    let endC = Math.ceil(uMaxX / gridSize) + 1;
    let startR = Math.floor(uMinY / gridSize) - 1;
    let endR = Math.ceil(uMaxY / gridSize) + 1;
    if ((endC - startC) * (endR - startR) > 2000) {
      // Adaptive LOD: increase grid size to reduce cell count instead of
      // silently returning nothing. This keeps gravel visible at zoom-out.
      const cellCount = (endC - startC) * (endR - startR);
      const lodFactor = Math.ceil(Math.sqrt(cellCount / 2000));
      const adjustedGridSize = gridSize * lodFactor;
      startC = Math.floor(uMinX / adjustedGridSize) - 1;
      endC = Math.ceil(uMaxX / adjustedGridSize) + 1;
      startR = Math.floor(uMinY / adjustedGridSize) - 1;
      endR = Math.ceil(uMaxY / adjustedGridSize) + 1;
    }

    const mulberry32 = (a: number) => () => {
      let t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    ctx.beginPath();
    for (let c = startC; c <= endC; c++) {
      for (let r = startR; r <= endR; r++) {
        const seed = (Math.imul(c, 31337) ^ Math.imul(r, 1103515245)) >>> 0;
        const rand = mulberry32(seed);

        const cx = (c + 0.1 + rand() * 0.8) * gridSize;
        const cy = (r + 0.1 + rand() * 0.8) * gridSize;
        const numPoints = 6 + Math.floor(rand() * 6);
        const baseRadius = scale * (0.4 + rand() * 0.6);
        const randomness = 0.5;

        const points: { x: number; y: number }[] = [];
        for (let i = 0; i < numPoints; i++) {
          const theta = (i / numPoints) * Math.PI * 2;
          const radialNoise = 1.0 + (rand() - 0.5) * randomness;
          const pr = baseRadius * radialNoise;
          const vx = cx + pr * Math.cos(theta);
          const vy = cy + pr * Math.sin(theta);
          const rvx = vx * Math.cos(globalAngleRad) - vy * Math.sin(globalAngleRad);
          const rvy = vx * Math.sin(globalAngleRad) + vy * Math.cos(globalAngleRad);
          points.push(vm.w2s(rvx, rvy));
        }
        if (points.length > 2) {
          ctx.moveTo((points[0].x + points[points.length - 1].x) / 2, (points[0].y + points[points.length - 1].y) / 2);
          for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;
            ctx.quadraticCurveTo(p1.x, p1.y, mx, my);
          }
        }
      }
    }
    ctx.setLineDash([]);
    ctx.stroke();
  }
}
