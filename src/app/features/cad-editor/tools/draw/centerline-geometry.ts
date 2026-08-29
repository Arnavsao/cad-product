import type { IPoint } from '../../core/models/entity.model';

export interface LineSegmentLike {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CenterlineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const EPSILON = 1e-9;
const PARALLEL_TOLERANCE = 1e-6;

/**
 * Build the AutoCAD-style centerline between two finite line segments.
 *
 * Parallel lines are paired endpoint-to-endpoint and averaged. Intersecting
 * lines use the angle bisector facing the two picked sides. The result is
 * extended slightly past the source geometry so the CENTER linetype reads as
 * a conventional drafting centerline rather than an ordinary trimmed edge.
 */
export function buildCenterlineSegment(
  first: LineSegmentLike,
  second: LineSegmentLike,
  firstPick?: IPoint,
  secondPick?: IPoint,
  extensionRatio = 0.12,
): CenterlineSegment | null {
  const ax = first.x2 - first.x1;
  const ay = first.y2 - first.y1;
  const bx = second.x2 - second.x1;
  const by = second.y2 - second.y1;
  const aLength = Math.hypot(ax, ay);
  const bLength = Math.hypot(bx, by);
  if (aLength < EPSILON || bLength < EPSILON) return null;

  const au = { x: ax / aLength, y: ay / aLength };
  const bu = { x: bx / bLength, y: by / bLength };
  const cross = au.x * bu.y - au.y * bu.x;

  if (Math.abs(cross) <= PARALLEL_TOLERANCE) {
    return buildParallelCenterline(first, second, au, bu, extensionRatio);
  }

  const intersection = infiniteLineIntersection(first, second);
  if (!intersection) return null;

  const orientedA = orientTowardPick(au, intersection, firstPick, first);
  const orientedB = orientTowardPick(bu, intersection, secondPick, second);
  const sumX = orientedA.x + orientedB.x;
  const sumY = orientedA.y + orientedB.y;
  const sumLength = Math.hypot(sumX, sumY);
  if (sumLength < EPSILON) return null;

  const direction = { x: sumX / sumLength, y: sumY / sumLength };
  const projections = [
    projectFrom(intersection, direction, { x: first.x1, y: first.y1 }),
    projectFrom(intersection, direction, { x: first.x2, y: first.y2 }),
    projectFrom(intersection, direction, { x: second.x1, y: second.y1 }),
    projectFrom(intersection, direction, { x: second.x2, y: second.y2 }),
  ];
  const minProjection = Math.min(0, ...projections);
  const maxProjection = Math.max(0, ...projections);
  const span = maxProjection - minProjection;
  if (span < EPSILON) return null;
  const extension = Math.max(0, extensionRatio) * span;

  return segmentAlong(
    intersection,
    direction,
    minProjection - extension,
    maxProjection + extension,
  );
}

function buildParallelCenterline(
  first: LineSegmentLike,
  second: LineSegmentLike,
  firstDirection: IPoint,
  secondDirection: IPoint,
  extensionRatio: number,
): CenterlineSegment | null {
  const sameDirection = firstDirection.x * secondDirection.x + firstDirection.y * secondDirection.y >= 0;
  const bStart = sameDirection
    ? { x: second.x1, y: second.y1 }
    : { x: second.x2, y: second.y2 };
  const bEnd = sameDirection
    ? { x: second.x2, y: second.y2 }
    : { x: second.x1, y: second.y1 };

  const start = { x: (first.x1 + bStart.x) / 2, y: (first.y1 + bStart.y) / 2 };
  const end = { x: (first.x2 + bEnd.x) / 2, y: (first.y2 + bEnd.y) / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return null;

  const direction = { x: dx / length, y: dy / length };
  const extension = Math.max(0, extensionRatio) * length;
  return segmentAlong(start, direction, -extension, length + extension);
}

function infiniteLineIntersection(a: LineSegmentLike, b: LineSegmentLike): IPoint | null {
  const adx = a.x2 - a.x1;
  const ady = a.y2 - a.y1;
  const bdx = b.x2 - b.x1;
  const bdy = b.y2 - b.y1;
  const det = adx * bdy - ady * bdx;
  if (Math.abs(det) < EPSILON) return null;
  const t = ((b.x1 - a.x1) * bdy - (b.y1 - a.y1) * bdx) / det;
  return { x: a.x1 + t * adx, y: a.y1 + t * ady };
}

function orientTowardPick(
  direction: IPoint,
  origin: IPoint,
  pick: IPoint | undefined,
  segment: LineSegmentLike,
): IPoint {
  const target = pick ?? {
    x: (segment.x1 + segment.x2) / 2,
    y: (segment.y1 + segment.y2) / 2,
  };
  const dot = (target.x - origin.x) * direction.x + (target.y - origin.y) * direction.y;
  return dot >= 0 ? direction : { x: -direction.x, y: -direction.y };
}

function projectFrom(origin: IPoint, direction: IPoint, point: IPoint): number {
  return (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y;
}

function segmentAlong(origin: IPoint, direction: IPoint, start: number, end: number): CenterlineSegment {
  return {
    x1: origin.x + direction.x * start,
    y1: origin.y + direction.y * start,
    x2: origin.x + direction.x * end,
    y2: origin.y + direction.y * end,
  };
}
