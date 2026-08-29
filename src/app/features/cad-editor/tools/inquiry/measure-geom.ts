import type { Entity, IPoint } from '../../core/models/entity.model';
import { arcGeomFromBulge } from '../../core/models/entity.model';
import { catmullRomChain } from '../../core/models/entity-extended.model';
import { signedArea } from '../geometry-utils';

/**
 * Pure measurement helpers shared by the inquiry tools (DIST / AREA / ID / LIST).
 *
 * Nothing in this module touches Angular, the DocumentService, or the command
 * stack — every export is a side-effect-free function over entity geometry so
 * the inquiry tools stay strictly read-only.
 *
 * The one non-geometry export is `drawInfoLabel`, a canvas-only text-badge
 * painter kept here (rather than duplicated four times) because all four
 * inquiry tools render the same style of on-canvas readout. It has no Angular
 * dependency either.
 */

const TWO_PI = Math.PI * 2;
const EPS = 1e-9;

/* ── Tessellation ───────────────────────────────────────────────────────── */

/**
 * Approximate an entity as a polyline of world-space points.
 *
 * Returns `null` for entity types that carry no meaningful outline
 * (TEXT, INSERT, dimensions, …). For closed shapes (CIRCLE, closed POLYLINE,
 * full ELLIPSE) the returned ring is NOT duplicated at the end — the first
 * point is implicitly connected to the last by the polygon helpers.
 *
 * `segments` is the sample count used for a full circle / ellipse; partial
 * sweeps get a proportional share (minimum 2 samples).
 */
export function tessellateEntity(e: Entity, segments = 96): IPoint[] | null {
  if (!e) return null;
  const seg = Math.max(8, Math.round(segments));

  switch (e.type) {
    case 'LINE': {
      const l = e as any;
      return [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }];
    }

    case 'CIRCLE': {
      const c = e as any;
      const out: IPoint[] = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * TWO_PI;
        out.push({ x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) });
      }
      return out;
    }

    case 'ARC': {
      const a = e as any;
      const sweepDeg = typeof a.getSweep === 'function' ? a.getSweep() : (a.endAngle - a.startAngle);
      const startRad = (a.startAngle * Math.PI) / 180;
      const sweepRad = (sweepDeg * Math.PI) / 180;
      const n = Math.max(2, Math.ceil((Math.abs(sweepRad) / TWO_PI) * seg));
      const out: IPoint[] = [];
      for (let i = 0; i <= n; i++) {
        const t = startRad + sweepRad * (i / n);
        out.push({ x: a.cx + a.r * Math.cos(t), y: a.cy + a.r * Math.sin(t) });
      }
      return out;
    }

    case 'POLYLINE':
    case 'LWPOLYLINE':
      return tessellatePolyline(e as any, seg);

    case 'ELLIPSE': {
      const el = e as any;
      const sweep = ellipseSweep(el);
      const n = Math.max(2, Math.ceil((Math.abs(sweep) / TWO_PI) * seg));
      const cos = Math.cos(el.rotation ?? 0);
      const sin = Math.sin(el.rotation ?? 0);
      const out: IPoint[] = [];
      const closed = Math.abs(Math.abs(sweep) - TWO_PI) < 1e-6;
      const count = closed ? n : n + 1;
      for (let i = 0; i < count; i++) {
        const t = (el.startAngle ?? 0) + sweep * (i / n);
        const lx = el.rx * Math.cos(t);
        const ly = el.ry * Math.sin(t);
        out.push({ x: el.cx + lx * cos - ly * sin, y: el.cy + lx * sin + ly * cos });
      }
      return out;
    }

    case 'SPLINE': {
      const s = e as any;
      const src: IPoint[] = (s.fitPoints?.length ? s.fitPoints : s.controlPoints) ?? [];
      if (src.length < 2) return src.length ? src.map((p: IPoint) => ({ x: p.x, y: p.y })) : null;
      return catmullRomChain(src, 16);
    }

    default:
      return null;
  }
}

/** Walk a polyline's vertices, expanding any non-zero bulge into arc samples. */
function tessellatePolyline(p: any, seg: number): IPoint[] | null {
  const pts: IPoint[] = p.pts ?? [];
  if (pts.length < 2) return pts.length ? [{ x: pts[0].x, y: pts[0].y }] : null;

  const out: IPoint[] = [{ x: pts[0].x, y: pts[0].y }];
  const segCount = p.closed ? pts.length : pts.length - 1;

  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % pts.length;
    const bulge = p.bulges?.[i] ?? 0;
    if (Math.abs(bulge) > EPS) {
      const g = arcGeomFromBulge(pts[i], pts[j], bulge);
      if (g) {
        let sweep = g.endA - g.startA;
        if (g.ccw) { while (sweep <= 0) sweep += TWO_PI; } else { while (sweep >= 0) sweep -= TWO_PI; }
        const n = Math.max(2, Math.ceil((Math.abs(sweep) / TWO_PI) * seg));
        for (let k = 1; k <= n; k++) {
          const t = g.startA + sweep * (k / n);
          out.push({ x: g.cx + g.r * Math.cos(t), y: g.cy + g.r * Math.sin(t) });
        }
        continue;
      }
    }
    out.push({ x: pts[j].x, y: pts[j].y });
  }

  // For a closed ring the walk lands back on the start point — drop the dupe.
  if (p.closed && out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) out.pop();
  }
  return out;
}

/** Signed angular sweep of an ELLIPSE, in radians (full ellipse → 2π). */
function ellipseSweep(el: any): number {
  const sa = el.startAngle ?? 0;
  const ea = el.endAngle ?? TWO_PI;
  let sweep = ea - sa;
  if (Math.abs(sweep) < EPS) return TWO_PI;
  if (Math.abs(sweep) > TWO_PI) sweep = Math.sign(sweep) * TWO_PI;
  return sweep;
}

/* ── Length ─────────────────────────────────────────────────────────────── */

/**
 * Total length / perimeter of an entity in drawing units.
 * Returns `null` when the type has no meaningful length (TEXT, INSERT, …).
 */
export function entityLength(e: Entity): number | null {
  if (!e) return null;

  switch (e.type) {
    case 'LINE': {
      const l = e as any;
      return Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
    }

    case 'CIRCLE':
      return TWO_PI * (e as any).r;

    case 'ARC': {
      const a = e as any;
      const sweepDeg = typeof a.getSweep === 'function' ? a.getSweep() : (a.endAngle - a.startAngle);
      return (Math.abs(sweepDeg) * Math.PI) / 180 * a.r;
    }

    case 'POLYLINE':
    case 'LWPOLYLINE': {
      const p = e as any;
      const pts: IPoint[] = p.pts ?? [];
      if (pts.length < 2) return 0;
      let len = 0;
      const segCount = p.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < segCount; i++) {
        const j = (i + 1) % pts.length;
        const bulge = p.bulges?.[i] ?? 0;
        if (Math.abs(bulge) > EPS) {
          const g = arcGeomFromBulge(pts[i], pts[j], bulge);
          if (g) {
            // Included angle of a bulge arc is exactly 4·atan(bulge).
            len += Math.abs(4 * Math.atan(bulge)) * g.r;
            continue;
          }
        }
        len += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
      }
      return len;
    }

    case 'ELLIPSE': {
      const el = e as any;
      const full = ramanujanPerimeter(el.rx, el.ry);
      const sweep = Math.abs(ellipseSweep(el));
      return full * (sweep / TWO_PI);
    }

    case 'SPLINE': {
      const pts = tessellateEntity(e, 96);
      if (!pts || pts.length < 2) return 0;
      return polylineLength(pts);
    }

    case 'HATCH': {
      const loops = hatchLoops(e as any);
      if (!loops) return null;
      let len = 0;
      for (const loop of loops) len += polygonPerimeter(loop);
      return len;
    }

    default:
      return null;
  }
}

/** Ramanujan's second approximation for the perimeter of a full ellipse. */
function ramanujanPerimeter(a: number, b: number): number {
  const ra = Math.abs(a);
  const rb = Math.abs(b);
  if (ra < EPS && rb < EPS) return 0;
  const h = ((ra - rb) * (ra - rb)) / ((ra + rb) * (ra + rb));
  return Math.PI * (ra + rb) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Open-chain length of a point list (does NOT close the ring). */
function polylineLength(pts: IPoint[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return len;
}

/* ── Area ───────────────────────────────────────────────────────────────── */

/**
 * Enclosed area of an entity in square drawing units.
 * Returns `null` when the entity is not closed or has no area concept.
 */
export function entityArea(e: Entity): number | null {
  if (!e) return null;

  switch (e.type) {
    case 'CIRCLE': {
      const c = e as any;
      return Math.PI * c.r * c.r;
    }

    case 'ARC': {
      // AutoCAD reports the circular-segment area (chord ↔ arc) for an ARC.
      const a = e as any;
      const sweepDeg = typeof a.getSweep === 'function' ? a.getSweep() : (a.endAngle - a.startAngle);
      const theta = Math.abs((sweepDeg * Math.PI) / 180);
      return 0.5 * a.r * a.r * (theta - Math.sin(theta));
    }

    case 'POLYLINE':
    case 'LWPOLYLINE': {
      const p = e as any;
      if (!p.closed) return null;
      const pts = tessellateEntity(e, 96);
      if (!pts || pts.length < 3) return null;
      return Math.abs(signedArea(pts));
    }

    case 'ELLIPSE': {
      const el = e as any;
      const sweep = Math.abs(ellipseSweep(el));
      if (Math.abs(sweep - TWO_PI) > 1e-6) {
        // Elliptical arc — close it through the centre and shoelace the fan.
        const pts = tessellateEntity(e, 96);
        if (!pts || pts.length < 3) return null;
        return Math.abs(signedArea([...pts, { x: el.cx, y: el.cy }]));
      }
      return Math.PI * Math.abs(el.rx) * Math.abs(el.ry);
    }

    case 'SPLINE': {
      const pts = tessellateEntity(e, 96);
      if (!pts || pts.length < 3) return null;
      const first = pts[0];
      const last = pts[pts.length - 1];
      // Only meaningful when the spline effectively closes on itself.
      if (Math.hypot(last.x - first.x, last.y - first.y) > 1e-6) return null;
      return Math.abs(signedArea(pts));
    }

    case 'HATCH': {
      const loops = hatchLoops(e as any);
      if (!loops || !loops.length) return null;
      // Outer loop minus islands, matching AutoCAD's reported hatch area.
      let total = Math.abs(signedArea(loops[0]));
      for (let i = 1; i < loops.length; i++) total -= Math.abs(signedArea(loops[i]));
      return Math.max(0, total);
    }

    default:
      return null;
  }
}

/**
 * Best-effort extraction of a hatch's boundary loops as point rings.
 * Prefers the Phase 3 `boundarySpec` (frozen edges), falls back to the legacy
 * raw `boundaries` edge loops. Returns `null` when neither is usable — an
 * associative hatch whose loops live on host entities is not reachable from a
 * pure function, so callers report "n/a" rather than a wrong number.
 */
function hatchLoops(h: any): IPoint[][] | null {
  const out: IPoint[][] = [];

  const spec = h.boundarySpec;
  if (spec?.loops?.length) {
    for (const loop of spec.loops) {
      const frozen = loop.frozen;
      if (!frozen?.length) continue;
      const ring: IPoint[] = frozen.map((edge: any) => ({ x: edge.p0.x, y: edge.p0.y }));
      if (ring.length >= 3) out.push(ring);
    }
    if (out.length) return out;
  }

  const legacy = h.boundaries as any[][] | undefined;
  if (legacy?.length) {
    for (const loop of legacy) {
      const ring: IPoint[] = [];
      for (const edge of loop) {
        if (edge?.vertices?.length) {
          for (const v of edge.vertices) ring.push({ x: v.x, y: v.y });
        } else if (edge?.start) {
          ring.push({ x: edge.start.x, y: edge.start.y });
        } else if (edge?.center && typeof edge.radius === 'number') {
          const sa = ((edge.startAngle ?? 0) * Math.PI) / 180;
          ring.push({ x: edge.center.x + edge.radius * Math.cos(sa), y: edge.center.y + edge.radius * Math.sin(sa) });
        }
      }
      if (ring.length >= 3) out.push(ring);
    }
  }

  return out.length ? out : null;
}

/* ── Polygon helpers ────────────────────────────────────────────────────── */

/** Absolute shoelace area of the implicitly-closed ring `pts`. */
export function polygonArea(pts: IPoint[]): number {
  if (!pts || pts.length < 3) return 0;
  return Math.abs(signedArea(pts));
}

/** Perimeter of the implicitly-closed ring `pts` (includes the closing edge). */
export function polygonPerimeter(pts: IPoint[]): number {
  if (!pts || pts.length < 2) return 0;
  let per = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[(i + 1) % pts.length];
    per += Math.hypot(q.x - pts[i].x, q.y - pts[i].y);
  }
  return per;
}

/** Perimeter of an OPEN chain — no closing edge. Used for running previews. */
export function chainLength(pts: IPoint[]): number {
  return polylineLength(pts ?? []);
}

/** Area-weighted centroid of a ring; falls back to the vertex mean. */
export function polygonCentroid(pts: IPoint[]): IPoint {
  if (!pts || !pts.length) return { x: 0, y: 0 };
  if (pts.length < 3) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
  }
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < EPS) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/* ── Formatting ─────────────────────────────────────────────────────────── */

/**
 * Format a number with thousands separators and a fixed decimal count.
 * Units are drawing units throughout — no unit suffix is appended.
 */
export function formatMeasure(n: number, decimals = 4): string {
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const dot = fixed.indexOf('.');
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const fracPart = dot === -1 ? '' : fixed.slice(dot);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + fracPart;
}

/**
 * Format an area value. Drawing units are unit-agnostic, so this is just the
 * bare number with thousands separators and 4 decimal places — the caller
 * decides whether to append "sq. units", "mm²", or nothing at all.
 */
export function formatArea(a: number): string {
  return formatMeasure(a, 4);
}

/** Format a world coordinate pair as AutoCAD's `X = …  Y = …  Z = …` triple. */
export function formatPointXYZ(p: IPoint, z = 0, decimals = 4): string {
  return `X = ${formatMeasure(p.x, decimals)}   Y = ${formatMeasure(p.y, decimals)}   Z = ${formatMeasure(z, decimals)}`;
}

/* ── Canvas label helper (no Angular dependency) ────────────────────────── */

/**
 * Paint a monospace multi-line readout at screen position (sx, sy) with a
 * semi-opaque rounded backdrop so it stays legible over dense geometry.
 * Saves and restores the context and always clears the dash pattern.
 */
export function drawInfoLabel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  lines: string[],
): void {
  if (!lines.length) return;
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const padX = 6;
  const padY = 4;
  const lineH = 15;
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);

  const w = maxW + padX * 2;
  const h = lines.length * lineH + padY * 2;
  const x = sx + 12;
  const y = sy - h - 12;
  const r = 4;

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();

  ctx.fillStyle = 'rgba(16,20,28,0.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,48,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#e6edf3';
  lines.forEach((l, i) => ctx.fillText(l, x + padX, y + padY + i * lineH));
  ctx.restore();
}
