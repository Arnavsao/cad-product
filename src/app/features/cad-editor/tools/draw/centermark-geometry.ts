export interface CenterMarkCircleLike {
  cx: number;
  cy: number;
  r: number;
}

export interface CenterMarkSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Build an AutoCAD-style center mark: a small cross at the centre plus four
 * separated extension arms that run slightly beyond the selected circle/arc.
 */
export function buildCenterMarkSegments(
  source: CenterMarkCircleLike,
  markRatio = 0.12,
  gapRatio = 0.06,
  extensionRatio = 0.1,
): CenterMarkSegment[] {
  if (!Number.isFinite(source.cx) || !Number.isFinite(source.cy)
      || !Number.isFinite(source.r) || source.r <= 0) return [];

  const halfMark = source.r * Math.max(0, markRatio);
  const armStart = Math.min(source.r, halfMark + source.r * Math.max(0, gapRatio));
  const armEnd = source.r * (1 + Math.max(0, extensionRatio));
  const { cx, cy } = source;

  return [
    { x1: cx - halfMark, y1: cy, x2: cx + halfMark, y2: cy },
    { x1: cx, y1: cy - halfMark, x2: cx, y2: cy + halfMark },
    { x1: cx - armEnd, y1: cy, x2: cx - armStart, y2: cy },
    { x1: cx + armStart, y1: cy, x2: cx + armEnd, y2: cy },
    { x1: cx, y1: cy - armEnd, x2: cx, y2: cy - armStart },
    { x1: cx, y1: cy + armStart, x2: cx, y2: cy + armEnd },
  ];
}
