import type { Entity, IPoint } from '../core/models/entity.model';

const norm360 = (v: number) => ((v % 360) + 360) % 360;

/**
 * Shortest distance from (px, py) to the finite segment a→b. Returns the
 * perpendicular distance when the closest projection lies on the segment;
 * otherwise the Euclidean distance to whichever endpoint is closer.
 *
 * Universal helper — TrimTool and OffsetTool both consume this, so the
 * algorithm lives here instead of being copied per tool.
 */
export function pointToSegmentDistance(px: number, py: number, a: IPoint, b: IPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * dx;
  const qy = a.y + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/**
 * Shortest distance from (px, py) to the finite arc defined by center (cx, cy),
 * radius r, start/end angles (degrees), and ccw direction. When the point's
 * polar angle lies inside the arc sweep, returns the radial distance
 * (|hypot(p-c) − r|). Otherwise returns the distance to the nearer endpoint.
 *
 * Universal helper — used by TrimTool's cut detection and OffsetTool's
 * cursor-driven distance derivation for ARC entities.
 */
export function pointToArcDistance(
  px: number,
  py: number,
  cx: number,
  cy: number,
  r: number,
  sa: number,
  ea: number,
  ccw: boolean,
): number {
  const ang = norm360((Math.atan2(py - cy, px - cx) * 180) / Math.PI);
  const s = norm360(sa);
  const e = norm360(ea);
  const sweep = ccw ? ((e - s + 360) % 360 || 360) : ((s - e + 360) % 360 || 360);
  const t = ccw ? ((ang - s + 360) % 360) : ((s - ang + 360) % 360);
  const isOnArc = t <= sweep + 0.001;

  if (isOnArc) {
    const distToCenter = Math.hypot(px - cx, py - cy);
    return Math.abs(distToCenter - r);
  }
  const saRad = (s * Math.PI) / 180;
  const eaRad = (e * Math.PI) / 180;
  const sx = cx + r * Math.cos(saRad);
  const sy = cy + r * Math.sin(saRad);
  const ex = cx + r * Math.cos(eaRad);
  const ey = cy + r * Math.sin(eaRad);
  return Math.min(Math.hypot(px - sx, py - sy), Math.hypot(px - ex, py - ey));
}

/**
 * Signed area of a polygon (shoelace formula). Sign encodes winding:
 * positive in standard y-up coords means CCW; negative means CW. Callers
 * typically only need the sign — magnitude is the polygon's actual area.
 *
 * Reused by OffsetTool to pick "outward" per segment without dot-product
 * heuristics that fail on perpendicular edges.
 */
export function signedArea(pts: IPoint[]): number {
  let a = 0;
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % N];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Ray-casting point-in-polygon test. Returns true iff (px, py) lies inside
 * the closed polygon defined by `pts`. Works for any simple (non self-
 * intersecting) polygon regardless of winding direction. O(N).
 *
 * Universal helper — OffsetTool uses it to decide inward vs outward offset
 * for closed polylines; future area / hatch / fill features can reuse.
 */
export function pointInPolygon(px: number, py: number, pts: IPoint[]): boolean {
  let inside = false;
  const N = pts.length;
  for (let i = 0, j = N - 1; i < N; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersect = ((yi > py) !== (yj > py))
      && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function rotatePoint(px: number, py: number, cx: number, cy: number, rad: number): IPoint {
  const dx = px - cx;
  const dy = py - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

export function mirrorPoint(px: number, py: number, x1: number, y1: number, x2: number, y2: number): IPoint {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { x: px, y: py };
  const t = ((px - x1) * dx + (py - y1) * dy) / len2;
  const fx = x1 + t * dx;
  const fy = y1 + t * dy;
  return { x: 2 * fx - px, y: 2 * fy - py };
}

export function scalePoint(px: number, py: number, cx: number, cy: number, factor: number): IPoint {
  return { x: cx + (px - cx) * factor, y: cy + (py - cy) * factor };
}

/**
 * Snapshot the mutable fields needed to undo a transform on an entity.
 *
 * Symmetric with `ModifyGeometryCmd.execute()` / `undo()` — every field
 * captured here is re-applied via direct `(entity as any)[key] = snap[key]`.
 * For arrays (pts, colWidths, rowHeights) we deep-clone so the snapshot
 * isn't aliased to the live entity.
 *
 * IMAGE / TABLE additions: `width` for IMAGE corner/edge resize, and the
 * per-column / per-row size arrays + cell text for TABLE. Without these
 * fields in the snapshot, undo after a grip resize wouldn't restore the
 * actual geometry.
 */
export function snapshotEntity(e: Entity): Record<string, unknown> {
  const ent = e as any;
  const snap: Record<string, unknown> = {};
  for (const key of [
    'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'rotation', 'startAngle', 'endAngle', 'height', 'angle',
    // IMAGE
    'width', 'opacity', 'brightness', 'contrast',
    // TABLE structural
    'rows', 'cols', 'titleRow', 'headerRow', 'titleText',
    // LEADER / DIMENSION style fields driven by grip drags + properties panel.
    'landingLength', 'attachmentSide', 'arrowSize', 'arrowType',
  ]) {
    if (ent[key] !== undefined) snap[key] = ent[key];
  }
  if (ent.pts) snap['pts'] = (ent.pts as IPoint[]).map((p: any) => ({ x: p.x, y: p.y }));
  if (ent.p1) snap['p1'] = { x: ent.p1.x, y: ent.p1.y };
  if (ent.p2) snap['p2'] = { x: ent.p2.x, y: ent.p2.y };
  if (ent.controlPoints) snap['controlPoints'] = (ent.controlPoints as IPoint[]).map((p: any) => ({ x: p.x, y: p.y }));
  // TABLE-specific arrays — deep clone so undo restores cell text + sizes.
  if (Array.isArray(ent.colWidths)) snap['colWidths'] = [...ent.colWidths];
  if (Array.isArray(ent.rowHeights)) snap['rowHeights'] = [...ent.rowHeights];
  if (Array.isArray(ent.cells)) snap['cells'] = JSON.parse(JSON.stringify(ent.cells));
  // HATCH — deep clone spec + legacy boundary data so undo can restore
  // both the new and old representation simultaneously.
  if (ent.type === 'HATCH') {
    snap['associative'] = ent.associative;
    snap['boundaryEntIds'] = Array.isArray(ent.boundaryEntIds) ? [...ent.boundaryEntIds] : [];
    if (Array.isArray(ent.boundaries)) snap['boundaries'] = JSON.parse(JSON.stringify(ent.boundaries));
    if (ent.boundarySpec != null) snap['boundarySpec'] = JSON.parse(JSON.stringify(ent.boundarySpec));
  }
  return snap;
}

/* ─── Frozen-hatch transform helpers ───────────────────────────────────────
 *
 * All four transform functions delegate hatch-specific geometry through these
 * helpers so the logic lives in one place. Associative hatches are read-only
 * from the transform perspective — they follow their boundary entities. Only
 * frozen hatches (spec.associative=false, or no spec but associative=false)
 * actually move their stored polygon geometry.
 */

function isAssociativeHatch(ent: any): boolean {
  if (ent.boundarySpec) return ent.boundarySpec.associative === true;
  return ent.associative === true;
}

/** Translate all frozen edge endpoints + seedPoint + legacy boundary vertices. */
export function moveFrozenHatch(ent: any, dx: number, dy: number): void {
  if (ent.boundarySpec?.loops) {
    for (const loop of ent.boundarySpec.loops) {
      for (const edge of loop.frozen ?? []) {
        edge.p0.x += dx; edge.p0.y += dy;
        edge.p1.x += dx; edge.p1.y += dy;
      }
    }
    if (ent.boundarySpec.seedPoint) {
      ent.boundarySpec.seedPoint.x += dx;
      ent.boundarySpec.seedPoint.y += dy;
    }
  }
  _syncLegacyBoundaries(ent);
}

/** Rotate all frozen edge endpoints + seedPoint around (cx, cy) by rad. */
function rotateFrozenHatch(ent: any, cx: number, cy: number, rad: number): void {
  if (ent.boundarySpec?.loops) {
    for (const loop of ent.boundarySpec.loops) {
      for (const edge of loop.frozen ?? []) {
        const p0 = rotatePoint(edge.p0.x, edge.p0.y, cx, cy, rad);
        const p1 = rotatePoint(edge.p1.x, edge.p1.y, cx, cy, rad);
        edge.p0.x = p0.x; edge.p0.y = p0.y;
        edge.p1.x = p1.x; edge.p1.y = p1.y;
      }
    }
    if (ent.boundarySpec.seedPoint) {
      const sp = rotatePoint(ent.boundarySpec.seedPoint.x, ent.boundarySpec.seedPoint.y, cx, cy, rad);
      ent.boundarySpec.seedPoint.x = sp.x;
      ent.boundarySpec.seedPoint.y = sp.y;
    }
  }
  _syncLegacyBoundaries(ent);
}

/** Scale all frozen edge endpoints + seedPoint from (cx, cy) by factor. */
function scaleFrozenHatch(ent: any, cx: number, cy: number, factor: number): void {
  if (ent.boundarySpec?.loops) {
    for (const loop of ent.boundarySpec.loops) {
      for (const edge of loop.frozen ?? []) {
        const p0 = scalePoint(edge.p0.x, edge.p0.y, cx, cy, factor);
        const p1 = scalePoint(edge.p1.x, edge.p1.y, cx, cy, factor);
        edge.p0.x = p0.x; edge.p0.y = p0.y;
        edge.p1.x = p1.x; edge.p1.y = p1.y;
      }
    }
    if (ent.boundarySpec.seedPoint) {
      const sp = scalePoint(ent.boundarySpec.seedPoint.x, ent.boundarySpec.seedPoint.y, cx, cy, factor);
      ent.boundarySpec.seedPoint.x = sp.x;
      ent.boundarySpec.seedPoint.y = sp.y;
    }
  }
  _syncLegacyBoundaries(ent);
}

/** Mirror all frozen edge endpoints + seedPoint across the line (x1,y1)→(x2,y2). */
function mirrorFrozenHatch(ent: any, x1: number, y1: number, x2: number, y2: number): void {
  if (ent.boundarySpec?.loops) {
    for (const loop of ent.boundarySpec.loops) {
      for (const edge of loop.frozen ?? []) {
        const p0 = mirrorPoint(edge.p0.x, edge.p0.y, x1, y1, x2, y2);
        const p1 = mirrorPoint(edge.p1.x, edge.p1.y, x1, y1, x2, y2);
        edge.p0.x = p0.x; edge.p0.y = p0.y;
        edge.p1.x = p1.x; edge.p1.y = p1.y;
      }
    }
    if (ent.boundarySpec.seedPoint) {
      const sp = mirrorPoint(ent.boundarySpec.seedPoint.x, ent.boundarySpec.seedPoint.y, x1, y1, x2, y2);
      ent.boundarySpec.seedPoint.x = sp.x;
      ent.boundarySpec.seedPoint.y = sp.y;
    }
  }
  _syncLegacyBoundaries(ent);
}

/**
 * Rebuild legacy `boundaries` from `boundarySpec.loops` frozen edges so that
 * DXF export and any remaining legacy render paths stay in sync after a
 * transform. Only called for frozen hatches — associative hatches never have
 * their frozen edges touched.
 */
function _syncLegacyBoundaries(ent: any): void {
  if (!ent.boundarySpec?.loops) return;
  ent.boundaries = ent.boundarySpec.loops.map((loop: any) =>
    (loop.frozen ?? []).map((edge: any) => ({
      type: 'LINE',
      start: { x: edge.p0.x, y: edge.p0.y },
      end: { x: edge.p1.x, y: edge.p1.y },
    })),
  );
}

export function rotateEntityInPlace(e: Entity, cx: number, cy: number, rad: number): void {
  const ent = e as any;
  const degDelta = (rad * 180) / Math.PI;
  switch (ent.type) {
    case 'LINE': {
      const a = rotatePoint(ent.x1, ent.y1, cx, cy, rad);
      const b = rotatePoint(ent.x2, ent.y2, cx, cy, rad);
      ent.x1 = a.x; ent.y1 = a.y; ent.x2 = b.x; ent.y2 = b.y; break;
    }
    case 'CIRCLE':
    case 'ELLIPSE': {
      const c = rotatePoint(ent.cx, ent.cy, cx, cy, rad);
      ent.cx = c.x; ent.cy = c.y;
      if (ent.type === 'ELLIPSE') ent.rotation = (ent.rotation || 0) + rad;
      break;
    }
    case 'ARC': {
      const c = rotatePoint(ent.cx, ent.cy, cx, cy, rad);
      ent.cx = c.x; ent.cy = c.y;
      ent.startAngle += degDelta; ent.endAngle += degDelta; break;
    }
    case 'POLYLINE':
      ent.pts = (ent.pts as IPoint[]).map((p: any) => rotatePoint(p.x, p.y, cx, cy, rad));
      break;
    case 'LEADER':
      ent.pts = (ent.pts as IPoint[]).map((p: any) => rotatePoint(p.x, p.y, cx, cy, rad));
      if (ent.textRotationOverride != null) {
        ent.textRotationOverride += rad;
      }
      break;
    case 'XLINE': {
      const p = rotatePoint(ent.x, ent.y, cx, cy, rad);
      ent.x = p.x; ent.y = p.y;
      ent.angle = ((ent.angle ?? 0) + rad) % (Math.PI * 2);
      break;
    }
    case 'TEXT':
    case 'MTEXT':
    case 'POINT':
    case 'INSERT':
    case 'IMAGE':
    case 'TABLE': {
      const p = rotatePoint(ent.x, ent.y, cx, cy, rad);
      ent.x = p.x; ent.y = p.y;
      if (ent.rotation !== undefined) {
        // INSERT rotation is in degrees, TEXT/MTEXT/IMAGE/TABLE in radians.
        ent.rotation = ent.type === 'INSERT' ? (ent.rotation || 0) + degDelta : (ent.rotation || 0) + rad;
      }
      break;
    }
    case 'DIMENSION': {
      ent.p1 = rotatePoint(ent.p1.x, ent.p1.y, cx, cy, rad);
      ent.p2 = rotatePoint(ent.p2.x, ent.p2.y, cx, cy, rad);
      if (ent.dimLinePoint) ent.dimLinePoint = rotatePoint(ent.dimLinePoint.x, ent.dimLinePoint.y, cx, cy, rad);
      if (ent.trueCenter) ent.trueCenter = rotatePoint(ent.trueCenter.x, ent.trueCenter.y, cx, cy, rad);
      if (ent.overrideCenter) ent.overrideCenter = rotatePoint(ent.overrideCenter.x, ent.overrideCenter.y, cx, cy, rad);
      if (ent.arcPoint) ent.arcPoint = rotatePoint(ent.arcPoint.x, ent.arcPoint.y, cx, cy, rad);
      if (ent.jogPoint) ent.jogPoint = rotatePoint(ent.jogPoint.x, ent.jogPoint.y, cx, cy, rad);
      if (ent.textPoint) ent.textPoint = rotatePoint(ent.textPoint.x, ent.textPoint.y, cx, cy, rad);
      // A rotated linear dimension measures along a fixed axis; that axis has
      // to turn with the entity or the reading changes.
      if (typeof ent.rotation === 'number') ent.rotation += rad;
      break;
    }
    case 'DIMRADIUS':
    case 'DIMDIAMETER': {
      ent.center = rotatePoint(ent.center.x, ent.center.y, cx, cy, rad);
      ent.arcPoint = rotatePoint(ent.arcPoint.x, ent.arcPoint.y, cx, cy, rad);
      if (ent.textPoint) ent.textPoint = rotatePoint(ent.textPoint.x, ent.textPoint.y, cx, cy, rad);
      break;
    }
    case 'DIMANGULAR': {
      ent.vertex = rotatePoint(ent.vertex.x, ent.vertex.y, cx, cy, rad);
      ent.p1 = rotatePoint(ent.p1.x, ent.p1.y, cx, cy, rad);
      ent.p2 = rotatePoint(ent.p2.x, ent.p2.y, cx, cy, rad);
      break;
    }
    case 'DIMARC': {
      ent.center = rotatePoint(ent.center.x, ent.center.y, cx, cy, rad);
      ent.p1 = rotatePoint(ent.p1.x, ent.p1.y, cx, cy, rad);
      ent.p2 = rotatePoint(ent.p2.x, ent.p2.y, cx, cy, rad);
      break;
    }
    case 'DIMORDINATE': {
      ent.featurePoint = rotatePoint(ent.featurePoint.x, ent.featurePoint.y, cx, cy, rad);
      ent.leaderEndPoint = rotatePoint(ent.leaderEndPoint.x, ent.leaderEndPoint.y, cx, cy, rad);
      break;
    }
    case 'SPLINE':
      ent.controlPoints = (ent.controlPoints as IPoint[]).map((p: any) => rotatePoint(p.x, p.y, cx, cy, rad));
      break;
    case 'HATCH':
      if (typeof ent.angle === 'number') ent.angle = (ent.angle + degDelta) % 360;
      rotateFrozenHatch(ent, cx, cy, rad);
      break;
  }
  e.refreshCaches();
}

export function scaleEntityInPlace(e: Entity, cx: number, cy: number, factor: number): void {
  const ent = e as any;
  const f = factor;
  switch (ent.type) {
    case 'LINE': {
      const a = scalePoint(ent.x1, ent.y1, cx, cy, f);
      const b = scalePoint(ent.x2, ent.y2, cx, cy, f);
      ent.x1 = a.x; ent.y1 = a.y; ent.x2 = b.x; ent.y2 = b.y; break;
    }
    case 'CIRCLE':
    case 'ARC': {
      const c = scalePoint(ent.cx, ent.cy, cx, cy, f);
      ent.cx = c.x; ent.cy = c.y; ent.r *= f; break;
    }
    case 'ELLIPSE': {
      const c = scalePoint(ent.cx, ent.cy, cx, cy, f);
      ent.cx = c.x; ent.cy = c.y; ent.rx *= f; ent.ry *= f; break;
    }
    case 'POLYLINE':
    case 'LEADER':
      ent.pts = (ent.pts as IPoint[]).map((p: any) => scalePoint(p.x, p.y, cx, cy, f));
      break;
    case 'TEXT':
    case 'MTEXT': {
      const p = scalePoint(ent.x, ent.y, cx, cy, f);
      ent.x = p.x; ent.y = p.y;
      if (ent.height !== undefined) ent.height *= f;
      if (ent.type === 'MTEXT' && ent.width !== undefined) ent.width *= f;
      break;
    }
    case 'IMAGE': {
      const p = scalePoint(ent.x, ent.y, cx, cy, f);
      ent.x = p.x; ent.y = p.y;
      if (ent.width !== undefined) ent.width *= f;
      if (ent.height !== undefined) ent.height *= f;
      break;
    }
    case 'TABLE': {
      const p = scalePoint(ent.x, ent.y, cx, cy, f);
      ent.x = p.x; ent.y = p.y;
      if (Array.isArray(ent.colWidths)) {
        for (let i = 0; i < ent.colWidths.length; i++) ent.colWidths[i] *= f;
      }
      if (Array.isArray(ent.rowHeights)) {
        for (let i = 0; i < ent.rowHeights.length; i++) ent.rowHeights[i] *= f;
      }
      if (ent.defaultFontSize !== undefined) ent.defaultFontSize *= f;
      if (ent.titleFontSize !== undefined) ent.titleFontSize *= f;
      if (ent.headerFontSize !== undefined) ent.headerFontSize *= f;
      if (ent.borderWeight !== undefined) ent.borderWeight *= f;
      if (ent.cellPadding !== undefined) ent.cellPadding *= f;
      
      if (Array.isArray(ent.cells)) {
        for (let r = 0; r < ent.cells.length; r++) {
          if (Array.isArray(ent.cells[r])) {
            for (let c = 0; c < ent.cells[r].length; c++) {
              if (ent.cells[r][c] && ent.cells[r][c].fontSize != null) {
                ent.cells[r][c].fontSize *= f;
              }
            }
          }
        }
      }
      break;
    }
    case 'POINT':
    case 'INSERT':
    case 'XLINE': {
      const p = scalePoint(ent.x, ent.y, cx, cy, f);
      ent.x = p.x; ent.y = p.y;
      if (ent.type === 'INSERT') { ent.sx *= f; ent.sy *= f; }
      break;
    }
    case 'SPLINE':
      ent.controlPoints = (ent.controlPoints as IPoint[]).map((p: any) => scalePoint(p.x, p.y, cx, cy, f));
      break;
    case 'HATCH':
      scaleFrozenHatch(ent, cx, cy, f);
      break;
    case 'DIMENSION': {
      if (ent.p1) ent.p1 = scalePoint(ent.p1.x, ent.p1.y, cx, cy, f);
      if (ent.p2) ent.p2 = scalePoint(ent.p2.x, ent.p2.y, cx, cy, f);
      if (ent.dimLinePoint) ent.dimLinePoint = scalePoint(ent.dimLinePoint.x, ent.dimLinePoint.y, cx, cy, f);
      if (ent.trueCenter) ent.trueCenter = scalePoint(ent.trueCenter.x, ent.trueCenter.y, cx, cy, f);
      if (ent.overrideCenter) ent.overrideCenter = scalePoint(ent.overrideCenter.x, ent.overrideCenter.y, cx, cy, f);
      if (ent.arcPoint) ent.arcPoint = scalePoint(ent.arcPoint.x, ent.arcPoint.y, cx, cy, f);
      if (ent.jogPoint) ent.jogPoint = scalePoint(ent.jogPoint.x, ent.jogPoint.y, cx, cy, f);
      if (ent.textPoint) ent.textPoint = scalePoint(ent.textPoint.x, ent.textPoint.y, cx, cy, f);
      if (ent.textHeight != null) ent.textHeight *= f;
      if (ent.arrowSize != null) ent.arrowSize *= f;
      break;
    }
    case 'DIMRADIUS':
    case 'DIMDIAMETER': {
      ent.center = scalePoint(ent.center.x, ent.center.y, cx, cy, f);
      ent.arcPoint = scalePoint(ent.arcPoint.x, ent.arcPoint.y, cx, cy, f);
      if (ent.textPoint) ent.textPoint = scalePoint(ent.textPoint.x, ent.textPoint.y, cx, cy, f);
      if (ent.textHeight != null) ent.textHeight *= f;
      if (ent.arrowSize != null) ent.arrowSize *= f;
      break;
    }
    case 'DIMANGULAR': {
      ent.vertex = scalePoint(ent.vertex.x, ent.vertex.y, cx, cy, f);
      ent.p1 = scalePoint(ent.p1.x, ent.p1.y, cx, cy, f);
      ent.p2 = scalePoint(ent.p2.x, ent.p2.y, cx, cy, f);
      if (ent.textHeight != null) ent.textHeight *= f;
      if (ent.arrowSize != null) ent.arrowSize *= f;
      break;
    }
    case 'DIMARC': {
      ent.center = scalePoint(ent.center.x, ent.center.y, cx, cy, f);
      ent.p1 = scalePoint(ent.p1.x, ent.p1.y, cx, cy, f);
      ent.p2 = scalePoint(ent.p2.x, ent.p2.y, cx, cy, f);
      ent.dimArcRadius *= f;
      if (ent.textHeight != null) ent.textHeight *= f;
      if (ent.arrowSize != null) ent.arrowSize *= f;
      break;
    }
    case 'DIMORDINATE': {
      ent.featurePoint = scalePoint(ent.featurePoint.x, ent.featurePoint.y, cx, cy, f);
      ent.leaderEndPoint = scalePoint(ent.leaderEndPoint.x, ent.leaderEndPoint.y, cx, cy, f);
      if (ent.textHeight != null) ent.textHeight *= f;
      break;
    }
  }
  e.refreshCaches();
}

export function mirrorEntityInPlace(e: Entity, x1: number, y1: number, x2: number, y2: number): void {
  const ent = e as any;
  switch (ent.type) {
    case 'LINE': {
      const a = mirrorPoint(ent.x1, ent.y1, x1, y1, x2, y2);
      const b = mirrorPoint(ent.x2, ent.y2, x1, y1, x2, y2);
      ent.x1 = a.x; ent.y1 = a.y; ent.x2 = b.x; ent.y2 = b.y; break;
    }
    case 'CIRCLE':
    case 'ELLIPSE': {
      const c = mirrorPoint(ent.cx, ent.cy, x1, y1, x2, y2);
      ent.cx = c.x; ent.cy = c.y; break;
    }
    case 'ARC': {
      const c = mirrorPoint(ent.cx, ent.cy, x1, y1, x2, y2);
      ent.cx = c.x; ent.cy = c.y;
      // Reverse + reflect angles
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const reflect = (deg: number) => {
        const rad = (deg * Math.PI) / 180;
        return ((2 * ang - rad) * 180) / Math.PI;
      };
      const sa = reflect(ent.startAngle);
      const ea = reflect(ent.endAngle);
      ent.startAngle = ea;
      ent.endAngle = sa;
      // DO NOT toggle ent.ccw here! DXF arcs are always CCW. Swapping sa and ea already perfectly reflects the sweep.
      break;
    }
    case 'POLYLINE':
    case 'LEADER':
      ent.pts = (ent.pts as IPoint[]).map((p: any) => mirrorPoint(p.x, p.y, x1, y1, x2, y2));
      if (ent.bulges && Array.isArray(ent.bulges)) {
        ent.bulges = ent.bulges.map((b: number) => -b);
      }
      break;
    case 'TEXT':
    case 'POINT':
    case 'INSERT': {
      const p = mirrorPoint(ent.x, ent.y, x1, y1, x2, y2);
      ent.x = p.x; ent.y = p.y;

      if (ent.type === 'TEXT') {
        const mirrorAng = Math.atan2(y2 - y1, x2 - x1);
        const rotGeo = 2 * mirrorAng - (ent.rotation || 0);

        const normalizeAngle = (a: number) => {
          let n = a % (2 * Math.PI);
          if (n > Math.PI) n -= 2 * Math.PI;
          if (n <= -Math.PI) n += 2 * Math.PI;
          return n;
        };

        const rot1 = normalizeAngle(rotGeo);
        const rot2 = normalizeAngle(rotGeo + Math.PI);

        // A rotation is readable if it's between -90 and +90 degrees (inclusive)
        const isReadable = (a: number) => Math.abs(a) <= Math.PI / 2 + 1e-9;

        let useChoice2 = false;
        if (isReadable(rot2) && !isReadable(rot1)) {
          useChoice2 = true;
        } else if (isReadable(rot1) && !isReadable(rot2)) {
          useChoice2 = false;
        } else {
          // If both are exact boundaries (e.g. 90 and -90), prefer positive 90 (reads bottom-to-top)
          useChoice2 = rot2 > 0;
        }

        ent.rotation = useChoice2 ? rot2 : rot1;

        let flipX = useChoice2;
        let flipY = !useChoice2;

        if (ent.justify) {
          let vAlign = ent.justify.charAt(0);
          let hAlign = ent.justify.charAt(1);

          if (flipX) {
            if (hAlign === 'L') hAlign = 'R';
            else if (hAlign === 'R') hAlign = 'L';
          }
          if (flipY) {
            if (vAlign === 'T') vAlign = 'B';
            else if (vAlign === 'B') vAlign = 'T';
          }

          ent.justify = vAlign + hAlign;

          // Keep legacy/DXF properties synced with the new justification
          if (hAlign === 'L') ent.halign = 0;
          else if (hAlign === 'C') ent.halign = 1;
          else if (hAlign === 'R') ent.halign = 2;

          if (vAlign === 'B') ent.valign = 1;
          else if (vAlign === 'M') ent.valign = 2;
          else if (vAlign === 'T') ent.valign = 3;
          else ent.valign = 0;
        }
      }
      break;
    }
    case 'XLINE': {
      // Mirror the base point AND reflect the direction angle.
      // For a mirror line at angle mirrorAng, the reflection of a direction
      // angle θ is: 2·mirrorAng − θ (mod 2π).
      const p = mirrorPoint(ent.x, ent.y, x1, y1, x2, y2);
      ent.x = p.x; ent.y = p.y;
      const mirrorAng = Math.atan2(y2 - y1, x2 - x1);
      ent.angle = 2 * mirrorAng - ent.angle;
      break;
    }
    case 'DIMENSION': {
      ent.p1 = mirrorPoint(ent.p1.x, ent.p1.y, x1, y1, x2, y2);
      ent.p2 = mirrorPoint(ent.p2.x, ent.p2.y, x1, y1, x2, y2);
      if (ent.dimLinePoint) ent.dimLinePoint = mirrorPoint(ent.dimLinePoint.x, ent.dimLinePoint.y, x1, y1, x2, y2);
      if (ent.trueCenter) ent.trueCenter = mirrorPoint(ent.trueCenter.x, ent.trueCenter.y, x1, y1, x2, y2);
      if (ent.overrideCenter) ent.overrideCenter = mirrorPoint(ent.overrideCenter.x, ent.overrideCenter.y, x1, y1, x2, y2);
      if (ent.arcPoint) ent.arcPoint = mirrorPoint(ent.arcPoint.x, ent.arcPoint.y, x1, y1, x2, y2);
      if (ent.jogPoint) ent.jogPoint = mirrorPoint(ent.jogPoint.x, ent.jogPoint.y, x1, y1, x2, y2);
      if (ent.textPoint) ent.textPoint = mirrorPoint(ent.textPoint.x, ent.textPoint.y, x1, y1, x2, y2);
      // Reflecting the measurement axis about the mirror line: the reflection
      // of a direction at angle t in a line at angle m is 2m - t.
      if (typeof ent.rotation === 'number') {
        const mirrorAngle = Math.atan2(y2 - y1, x2 - x1);
        ent.rotation = 2 * mirrorAngle - ent.rotation;
      }
      break;
    }
    case 'DIMRADIUS':
    case 'DIMDIAMETER': {
      ent.center = mirrorPoint(ent.center.x, ent.center.y, x1, y1, x2, y2);
      ent.arcPoint = mirrorPoint(ent.arcPoint.x, ent.arcPoint.y, x1, y1, x2, y2);
      if (ent.textPoint) ent.textPoint = mirrorPoint(ent.textPoint.x, ent.textPoint.y, x1, y1, x2, y2);
      break;
    }
    case 'DIMANGULAR': {
      ent.vertex = mirrorPoint(ent.vertex.x, ent.vertex.y, x1, y1, x2, y2);
      ent.p1 = mirrorPoint(ent.p1.x, ent.p1.y, x1, y1, x2, y2);
      ent.p2 = mirrorPoint(ent.p2.x, ent.p2.y, x1, y1, x2, y2);
      break;
    }
    case 'DIMARC': {
      ent.center = mirrorPoint(ent.center.x, ent.center.y, x1, y1, x2, y2);
      ent.p1 = mirrorPoint(ent.p1.x, ent.p1.y, x1, y1, x2, y2);
      ent.p2 = mirrorPoint(ent.p2.x, ent.p2.y, x1, y1, x2, y2);
      break;
    }
    case 'DIMORDINATE': {
      ent.featurePoint = mirrorPoint(ent.featurePoint.x, ent.featurePoint.y, x1, y1, x2, y2);
      ent.leaderEndPoint = mirrorPoint(ent.leaderEndPoint.x, ent.leaderEndPoint.y, x1, y1, x2, y2);
      break;
    }
    case 'SPLINE':
      ent.controlPoints = (ent.controlPoints as IPoint[]).map((p: any) => mirrorPoint(p.x, p.y, x1, y1, x2, y2));
      break;
    case 'HATCH':
      mirrorFrozenHatch(ent, x1, y1, x2, y2);
      break;
  }
  e.refreshCaches();
}

export function moveEntityInPlace(e: Entity, dx: number, dy: number): void {
  const ent = e as any;
  switch (ent.type) {
    case 'LINE': {
      ent.x1 += dx; ent.y1 += dy;
      ent.x2 += dx; ent.y2 += dy;
      break;
    }
    case 'CIRCLE':
    case 'ARC':
    case 'ELLIPSE': {
      ent.cx += dx; ent.cy += dy;
      break;
    }
    case 'POLYLINE':
    case 'LEADER': {
      if (ent.pts) {
        for (const p of ent.pts) {
          p.x += dx; p.y += dy;
        }
      }
      break;
    }
    case 'TEXT':
    case 'POINT':
    case 'INSERT':
    case 'XLINE':
    case 'IMAGE':
    case 'TABLE': {
      // ImageEntity (x,y) = bottom-left corner; TableEntity (x,y) = top-left.
      // Both translate identically — same x/y field.
      ent.x += dx; ent.y += dy;
      break;
    }
    case 'DIMENSION': {
      // DimensionEntity (linear/aligned/etc.): p1, p2, dimLinePoint
      if (ent.p1) { ent.p1.x += dx; ent.p1.y += dy; }
      if (ent.p2) { ent.p2.x += dx; ent.p2.y += dy; }
      if (ent.dimLinePoint) { ent.dimLinePoint.x += dx; ent.dimLinePoint.y += dy; }
      // JoggedRadiusDimensionEntity (also type=\'DIMENSION\'): trueCenter, overrideCenter, arcPoint, jogPoint, textPoint
      if (ent.trueCenter) { ent.trueCenter.x += dx; ent.trueCenter.y += dy; }
      if (ent.overrideCenter) { ent.overrideCenter.x += dx; ent.overrideCenter.y += dy; }
      if (ent.arcPoint) { ent.arcPoint.x += dx; ent.arcPoint.y += dy; }
      if (ent.jogPoint) { ent.jogPoint.x += dx; ent.jogPoint.y += dy; }
      if (ent.textPoint) { ent.textPoint.x += dx; ent.textPoint.y += dy; }
      break;
    }
    case 'DIMRADIUS':
    case 'DIMDIAMETER': {
      if (ent.center) { ent.center.x += dx; ent.center.y += dy; }
      if (ent.arcPoint) { ent.arcPoint.x += dx; ent.arcPoint.y += dy; }
      if (ent.textPoint) { ent.textPoint.x += dx; ent.textPoint.y += dy; }
      break;
    }
    case 'DIMANGULAR': {
      ent.vertex.x += dx; ent.vertex.y += dy;
      ent.p1.x += dx; ent.p1.y += dy;
      ent.p2.x += dx; ent.p2.y += dy;
      break;
    }
    case 'DIMARC': {
      ent.center.x += dx; ent.center.y += dy;
      ent.p1.x += dx; ent.p1.y += dy;
      ent.p2.x += dx; ent.p2.y += dy;
      break;
    }
    case 'DIMORDINATE': {
      ent.featurePoint.x += dx; ent.featurePoint.y += dy;
      ent.leaderEndPoint.x += dx; ent.leaderEndPoint.y += dy;
      break;
    }
    case 'SPLINE': {
      if (ent.controlPoints) {
        for (const p of ent.controlPoints) {
          p.x += dx; p.y += dy;
        }
      }
      break;
    }
    case 'HATCH': {
      // Associative hatches also have frozen loops that must be translated
      // so they can move alongside their boundaries (or be orphaned).
      moveFrozenHatch(ent, dx, dy);
      break;
    }
  }
  e.refreshCaches();
}

/**
 * Translate every coordinate field of `e` by (dx, dy) — including fields that
 * `moveEntityInPlace` deliberately skips. Used by DXF import to bake an
 * absolute offset into a freshly-parsed file (coordinate normalization, or
 * baking `autoPosition` into entities so `file.x/y` stays at 0).
 *
 * Differences from `moveEntityInPlace`:
 *   - Hatches always translate (associative or not), since the host entities
 *     are translated by the same offset in this bulk pass — relative geometry
 *     is preserved.
 *   - DIMENSION's `dimLinePoint` is translated (moveEntityInPlace skips it).
 *   - SPLINE `points` (fit points) is translated alongside `controlPoints`.
 *   - Legacy hatch `boundaries[][].start/end/vertices` are translated.
 *
 * Block-internal entities are NOT translated by this helper — they live in
 * block-local coordinates and follow their INSERT's position.
 */
export function translateEntityRaw(e: Entity, dx: number, dy: number): void {
  const ent = e as any;
  switch (ent.type) {
    case 'LINE':
      ent.x1 += dx; ent.y1 += dy;
      ent.x2 += dx; ent.y2 += dy;
      break;
    case 'CIRCLE':
    case 'ARC':
    case 'ELLIPSE':
      ent.cx += dx; ent.cy += dy;
      break;
    case 'POLYLINE':
    case 'LEADER':
      if (Array.isArray(ent.pts)) {
        for (const p of ent.pts) { p.x += dx; p.y += dy; }
      }
      break;
    case 'TEXT':
    case 'POINT':
    case 'INSERT':
    case 'XLINE':
    case 'IMAGE':
    case 'TABLE':
      ent.x += dx; ent.y += dy;
      break;
    case 'DIMENSION':
      if (ent.p1) { ent.p1.x += dx; ent.p1.y += dy; }
      if (ent.p2) { ent.p2.x += dx; ent.p2.y += dy; }
      if (ent.dimLinePoint) { ent.dimLinePoint.x += dx; ent.dimLinePoint.y += dy; }
      if (ent.trueCenter) { ent.trueCenter.x += dx; ent.trueCenter.y += dy; }
      if (ent.overrideCenter) { ent.overrideCenter.x += dx; ent.overrideCenter.y += dy; }
      if (ent.arcPoint) { ent.arcPoint.x += dx; ent.arcPoint.y += dy; }
      if (ent.jogPoint) { ent.jogPoint.x += dx; ent.jogPoint.y += dy; }
      if (ent.textPoint) { ent.textPoint.x += dx; ent.textPoint.y += dy; }
      break;
    case 'DIMRADIUS':
    case 'DIMDIAMETER':
      if (ent.center) { ent.center.x += dx; ent.center.y += dy; }
      if (ent.arcPoint) { ent.arcPoint.x += dx; ent.arcPoint.y += dy; }
      if (ent.textPoint) { ent.textPoint.x += dx; ent.textPoint.y += dy; }
      break;
    case 'DIMANGULAR':
      ent.vertex.x += dx; ent.vertex.y += dy;
      ent.p1.x += dx; ent.p1.y += dy;
      ent.p2.x += dx; ent.p2.y += dy;
      break;
    case 'DIMARC':
      ent.center.x += dx; ent.center.y += dy;
      ent.p1.x += dx; ent.p1.y += dy;
      ent.p2.x += dx; ent.p2.y += dy;
      break;
    case 'DIMORDINATE':
      ent.featurePoint.x += dx; ent.featurePoint.y += dy;
      ent.leaderEndPoint.x += dx; ent.leaderEndPoint.y += dy;
      break;
    case 'SPLINE':
      if (Array.isArray(ent.controlPoints)) {
        for (const p of ent.controlPoints) { p.x += dx; p.y += dy; }
      }
      if (Array.isArray(ent.points)) {
        for (const p of ent.points) { p.x += dx; p.y += dy; }
      }
      break;
    case 'HATCH':
      _translateHatchAll(ent, dx, dy);
      break;
  }
  e.refreshCaches();
}

/** Bulk-translate every hatch coordinate (spec + legacy boundaries). */
function _translateHatchAll(ent: any, dx: number, dy: number): void {
  if (ent.boundarySpec?.loops) {
    for (const loop of ent.boundarySpec.loops) {
      for (const edge of loop.frozen ?? []) {
        edge.p0.x += dx; edge.p0.y += dy;
        edge.p1.x += dx; edge.p1.y += dy;
      }
    }
    if (ent.boundarySpec.seedPoint) {
      ent.boundarySpec.seedPoint.x += dx;
      ent.boundarySpec.seedPoint.y += dy;
    }
  }
  if (Array.isArray(ent.boundaries)) {
    for (const loop of ent.boundaries) {
      if (!Array.isArray(loop)) continue;
      for (const edge of loop) {
        if (edge?.start) { edge.start.x += dx; edge.start.y += dy; }
        if (edge?.end) { edge.end.x += dx; edge.end.y += dy; }
        if (edge?.center) { edge.center.x += dx; edge.center.y += dy; }
        if (Array.isArray(edge?.vertices)) {
          for (const v of edge.vertices) { v.x += dx; v.y += dy; }
        }
      }
    }
  }
  // Keep the lossless DXF representation in the same coordinate system as
  // the editor geometry. This is essential because imported drawings are
  // normalized on load and shifted back only during DXF export.
  const source = ent.dxfHatch;
  if (source) {
    source.elevation.x += dx;
    source.elevation.y += dy;
    for (const seed of source.seedPoints ?? []) { seed.x += dx; seed.y += dy; }
    for (const path of source.boundaryPaths ?? []) {
      if (path.kind === 'polyline') {
        for (const vertex of path.vertices) {
          vertex.point.x += dx;
          vertex.point.y += dy;
        }
      } else {
        for (const edge of path.edges) {
          if (edge.kind === 'line') {
            edge.start.x += dx; edge.start.y += dy;
            edge.end.x += dx; edge.end.y += dy;
          } else if (edge.kind === 'arc' || edge.kind === 'ellipse') {
            edge.center.x += dx; edge.center.y += dy;
          } else if (edge.kind === 'spline') {
            for (const point of edge.controlPoints) { point.x += dx; point.y += dy; }
            for (const point of edge.fitPoints) { point.x += dx; point.y += dy; }
            // Tangents are vectors, not points; translation must not alter them.
          }
        }
      }
    }
    if (source.pattern?.definitionLines) {
      for (const line of source.pattern.definitionLines) {
        line.x0 += dx;
        line.y0 += dy;
      }
    }
  }
  if (Array.isArray(ent.customPatternLines)) {
    for (const line of ent.customPatternLines) {
      line.x0 += dx;
      line.y0 += dy;
    }
  }
}

/**
 * Bulk-translate a list of entities. Convenience wrapper around
 * `translateEntityRaw` used during DXF import.
 */
export function translateEntitiesInPlace(entities: Entity[], dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const e of entities) translateEntityRaw(e, dx, dy);
}
