import { Injectable } from '@angular/core';
import type { Entity, IPoint } from '../models/entity.model';

export interface IIntersection {
  t: number; // parameter on target (0..1)
  x: number;
  y: number;
}

interface ILineLike { x1: number; y1: number; x2: number; y2: number; type?: string; }
interface IArcLike { cx: number; cy: number; r: number; startAngle: number; endAngle: number; ccw?: boolean; type?: string; }
interface ICircleLike { cx: number; cy: number; r: number; type?: string; }

const norm360 = (v: number) => ((v % 360) + 360) % 360;

/**
 * Lightweight intersection math service used by Trim/Fillet/Hatch.
 * Mirrors the geometry routines in 34-tools-trim-fillet.js.
 */
@Injectable({ providedIn: 'root' })
export class IntersectionService {
  intersectLineLine(a: ILineLike, b: ILineLike): IIntersection[] {
    const dAx = a.x2 - a.x1;
    const dAy = a.y2 - a.y1;
    const dBx = b.x2 - b.x1;
    const dBy = b.y2 - b.y1;
    const det = dAx * dBy - dAy * dBx;
    if (Math.abs(det) < 1e-10) return [];
    const dx = b.x1 - a.x1;
    const dy = b.y1 - a.y1;
    const tA = (dx * dBy - dy * dBx) / det;
    const tB = (dx * dAy - dy * dAx) / det;
    if (tA < -0.001 || tA > 1.001 || tB < -0.001 || tB > 1.001) return [];
    const t = Math.max(0, Math.min(1, tA));
    return [{ t, x: a.x1 + tA * dAx, y: a.y1 + tA * dAy }];
  }

  intersectLineArc(line: ILineLike, arc: IArcLike): IIntersection[] {
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const fx = line.x1 - arc.cx;
    const fy = line.y1 - arc.cy;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - arc.r * arc.r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return [];
    const sq = Math.sqrt(disc);
    const results: IIntersection[] = [];
    for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
      if (t < -0.001 || t > 1.001) continue;
      const px = line.x1 + t * dx;
      const py = line.y1 + t * dy;
      const ang = (Math.atan2(py - arc.cy, px - arc.cx) * 180) / Math.PI;
      const sa = norm360(arc.startAngle);
      const ea = norm360(arc.endAngle);
      const isCcw = arc.ccw !== false; // default true
      const sweep = isCcw ? ((ea - sa + 360) % 360 || 360) : ((sa - ea + 360) % 360 || 360);
      const ta = isCcw ? ((norm360(ang) - sa + 360) % 360) : ((sa - norm360(ang) + 360) % 360);
      if (ta <= sweep + 1) results.push({ t: Math.max(0, Math.min(1, t)), x: px, y: py });
    }
    return results;
  }

  intersectLineCircle(line: ILineLike, circle: ICircleLike): IIntersection[] {
    return this.intersectLineArc(line, { cx: circle.cx, cy: circle.cy, r: circle.r, startAngle: 0, endAngle: 359.999 });
  }

  intersectCircleCircle(c1: ICircleLike, c2: ICircleLike): IPoint[] {
    const dx = c2.cx - c1.cx;
    const dy = c2.cy - c1.cy;
    const d = Math.hypot(dx, dy);
    if (d > c1.r + c2.r) return [];
    if (d < Math.abs(c1.r - c2.r)) return [];
    if (d === 0 && c1.r === c2.r) return [];
    const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
    const px = c1.cx + (a / d) * dx;
    const py = c1.cy + (a / d) * dy;
    if (h === 0) return [{ x: px, y: py }];
    const rx = -(h / d) * dy;
    const ry = (h / d) * dx;
    return [
      { x: px + rx, y: py + ry },
      { x: px - rx, y: py - ry },
    ];
  }

  intersectCircleLine(circle: ICircleLike, line: ILineLike): IIntersection[] {
    const hits = this.intersectLineCircle(line, circle);
    // return param on the CIRCLE (0 to 1 based on 360 sweep)
    return hits.map(h => {
      const ang = (Math.atan2(h.y - circle.cy, h.x - circle.cx) * 180) / Math.PI;
      const t = (norm360(ang) / 360);
      return { t: Math.max(0, Math.min(1, t)), x: h.x, y: h.y };
    });
  }

  /** Get all intersection t-params on the target entity caused by `edge`. */
  getIntersections(target: Entity, edge: Entity): IIntersection[] {
    if (target === edge) return [];
    const t = target as any;
    const e = edge as any;

    // Decompose polyline edges
    if (e.type === 'POLYLINE') {
      if (!e.pts || e.pts.length < 2) return [];
      const hits: IIntersection[] = [];
      for (let i = 0; i < e.pts.length - 1; i++) {
        const seg = { x1: e.pts[i].x, y1: e.pts[i].y, x2: e.pts[i + 1].x, y2: e.pts[i + 1].y, type: 'LINE' };
        hits.push(...this.getIntersections(target, seg as any));
      }
      if (e.closed) {
        const last = e.pts.length - 1;
        const seg = { x1: e.pts[last].x, y1: e.pts[last].y, x2: e.pts[0].x, y2: e.pts[0].y, type: 'LINE' };
        hits.push(...this.getIntersections(target, seg as any));
      }
      return hits;
    }

    if (e.type === 'XLINE') {
      const dx = Math.cos(e.angle || 0) * 1e6;
      const dy = Math.sin(e.angle || 0) * 1e6;
      const fakeLine = { x1: e.x - dx, y1: e.y - dy, x2: e.x + dx, y2: e.y + dy, type: 'LINE' };
      return this.getIntersections(target, fakeLine as any);
    }

    if (t.type === 'LINE' && e.type === 'LINE') return this.intersectLineLine(t, e);
    if (t.type === 'LINE' && e.type === 'ARC') return this.intersectLineArc(t, e);
    if (t.type === 'LINE' && e.type === 'CIRCLE') return this.intersectLineCircle(t, e);

    if (t.type === 'CIRCLE') {
      if (e.type === 'LINE') return this.intersectCircleLine(t, e);
      let pts: IPoint[] = [];
      if (e.type === 'CIRCLE') pts = this.intersectCircleCircle(t, e);
      else if (e.type === 'ARC') pts = this.intersectCircleCircle(t, e).filter(p => this.isPointOnArc(p, e));
      return pts.map(p => {
        const ang = (Math.atan2(p.y - t.cy, p.x - t.cx) * 180) / Math.PI;
        return { t: norm360(ang) / 360, x: p.x, y: p.y };
      });
    }

    if (t.type === 'ARC') {
      let hits: IIntersection[] = [];
      if (e.type === 'LINE') {
        hits = this.intersectLineArc(e, t);
      } else {
        let pts: IPoint[] = [];
        if (e.type === 'CIRCLE') pts = this.intersectCircleCircle(t, e);
        else if (e.type === 'ARC') pts = this.intersectCircleCircle(t, e).filter(p => this.isPointOnArc(p, e));
        hits = pts.map(p => ({ t: 0, x: p.x, y: p.y })); // t computed below
      }

      const results: IIntersection[] = [];
      for (const h of hits) {
        const ang = (Math.atan2(h.y - t.cy, h.x - t.cx) * 180) / Math.PI;
        const sa = norm360(t.startAngle);
        const ea = norm360(t.endAngle);
        const isCcw = t.ccw !== false;
        const sweep = isCcw ? ((ea - sa + 360) % 360 || 360) : ((sa - ea + 360) % 360 || 360);
        const ta = isCcw ? ((norm360(ang) - sa + 360) % 360) : ((sa - norm360(ang) + 360) % 360);
        if (ta <= sweep + 1) { // 1 degree tolerance
          results.push({ t: Math.max(0, Math.min(1, ta / sweep)), x: h.x, y: h.y });
        }
      }
      return results;
    }

    return [];
  }

  private isPointOnArc(p: IPoint, arc: IArcLike): boolean {
    const ang = norm360((Math.atan2(p.y - arc.cy, p.x - arc.cx) * 180) / Math.PI);
    const sa = norm360(arc.startAngle);
    const ea = norm360(arc.endAngle);
    const isCcw = arc.ccw !== false;
    const sweep = isCcw ? ((ea - sa + 360) % 360 || 360) : ((sa - ea + 360) % 360 || 360);
    const ta = isCcw ? ((ang - sa + 360) % 360) : ((sa - ang + 360) % 360);
    return ta <= sweep + 1;
  }
}
