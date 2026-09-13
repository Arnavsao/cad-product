/**
 * Hatch pattern registry — AutoCAD's `acadiso.pat`, verbatim.
 *
 * Every entry below (SOLID and the CADO extras at the bottom aside) is the
 * millimetre definition AutoCAD ships, so a CADO hatch and an AutoCAD hatch of
 * the same name, scale and angle produce the same lines. Earlier versions of
 * this file carried hand-written approximations (ANSI32 with two identical
 * families, ANSI37 as a single-direction hatch, an invented BRICK, HEX built
 * from 10-unit dashes) and drew AR-CONC, GRAVEL, HEX and HONEY with bespoke
 * shape renderers; the visual gap to AutoCAD was the standing complaint.
 *
 * ## Line semantics (`.pat` file convention)
 *
 * A pattern is a set of line *families*. For each family:
 *
 *   angle       direction of every line, degrees CCW from +X
 *   x0, y0      base point of the first line (pattern units, before hatch scale)
 *   dx          shift ALONG the line direction between successive lines
 *   dy          spacing PERPENDICULAR to the line between successive lines
 *   dashArray   dash sequence anchored at each line's own base point:
 *               > 0 dash, 0 dot, < 0 gap. Empty = continuous.
 *
 * Line `i` therefore starts at `(x0, y0) + i * (dx * dir + dy * normal)`, and
 * its dashes begin there — that is what staggers BRICK's vertical joints and
 * scatters AR-SAND's dots. A renderer that anchors the dash phase anywhere else
 * turns both into a grid.
 *
 * ## DXF encoding differs
 *
 * DXF HATCH groups 45/46 store the offset as a *vector in pattern space*, i.e.
 * `(dx, dy)` rotated by the line angle — not the along/perpendicular pair. Use
 * `patternOffsetToDxf` / `dxfOffsetToPattern` at the import/export boundary;
 * feeding one convention to the other skews every family that is not axis
 * aligned (ANSI31 imported raw comes out at 2.245 mm spacing instead of 3.175).
 *
 * Regenerated from ezdxf's `_iso_pattern.py` (a scaled copy of acadiso.pat);
 * offsets converted with `dxfOffsetToPattern`, rounded to 6 decimals.
 */

export interface HatchPatternLine {
  angle: number;
  x0: number;
  y0: number;
  /** Shift along the line direction between successive lines. */
  dx: number;
  /** Perpendicular spacing between successive lines (sign = side of the normal). */
  dy: number;
  /** Dash sequence: > 0 dash, 0 dot, < 0 gap. Empty = continuous. */
  dashArray: number[];
}

export interface HatchPattern {
  name: string;
  lines: HatchPatternLine[];
}

/**
 * `.pat` (along, perpendicular) offset → DXF 45/46 offset vector.
 * The vector is the along/perp pair expressed in world axes, i.e. rotated by
 * the line angle.
 */
export function patternOffsetToDxf(angleDeg: number, dx: number, dy: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** DXF 45/46 offset vector → `.pat` (along, perpendicular) offset. */
export function dxfOffsetToPattern(angleDeg: number, ox: number, oy: number): { dx: number; dy: number } {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return { dx: ox * c + oy * s, dy: -ox * s + oy * c };
}

/**
 * DXF HATCH pattern lines → registry form.
 *
 * AutoCAD writes groups 53/43-46/49 with the hatch scale and angle already
 * applied and the offset as a vector, so a renderer that re-applies the
 * entity's own scale/angle (as CADO's does, to keep the Properties panel
 * live) must first undo them here. The result is unscaled, unrotated,
 * along/perpendicular — exactly what `HATCH_PATTERNS` holds.
 */
export function patternLinesFromDxf(
  lines: readonly { angle: number; x0: number; y0: number; dx: number; dy: number; dashArray: readonly number[] }[],
  scale: number,
  angleDeg: number,
): HatchPatternLine[] {
  const k = scale && scale > 0 ? 1 / scale : 1;
  const rad = (-(angleDeg || 0) * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return lines.map((l) => {
    const off = dxfOffsetToPattern(l.angle, l.dx, l.dy);
    return {
      angle: l.angle - (angleDeg || 0),
      x0: (l.x0 * c - l.y0 * s) * k,
      y0: (l.x0 * s + l.y0 * c) * k,
      dx: off.dx * k,
      dy: off.dy * k,
      dashArray: l.dashArray.map((d) => d * k),
    };
  });
}

/**
 * Registry form → DXF HATCH pattern lines, i.e. the inverse of
 * `patternLinesFromDxf`: scale and rotate as AutoCAD would, fold the pattern
 * origin into the base point, and express the offset as a vector.
 */
export function patternLinesToDxf(
  lines: readonly HatchPatternLine[],
  scale: number,
  angleDeg: number,
  originX = 0,
  originY = 0,
): { angle: number; x0: number; y0: number; dx: number; dy: number; dashArray: number[] }[] {
  const k = scale && scale > 0 ? scale : 1;
  const rad = ((angleDeg || 0) * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return lines.map((l) => {
    const angle = l.angle + (angleDeg || 0);
    const bx = l.x0 * k, by = l.y0 * k;
    const off = patternOffsetToDxf(angle, l.dx * k, l.dy * k);
    return {
      angle,
      x0: bx * c - by * s + originX,
      y0: bx * s + by * c + originY,
      dx: off.x,
      dy: off.y,
      dashArray: l.dashArray.map((d) => d * k),
    };
  });
}

/**
 * Look a pattern up by name, tolerating the `AR_SAND` spelling some DXF
 * writers use for `AR-SAND`. Returns `null` for unknown names so callers can
 * decide on a fallback (the renderer uses ANSI31, matching AutoCAD's own
 * behaviour when a drawing references a pattern the .pat file lacks).
 */
export function resolveHatchPattern(name: string | null | undefined): HatchPattern | null {
  if (!name) return null;
  return HATCH_PATTERNS[name] ?? HATCH_PATTERNS[name.replace(/_/g, '-')] ?? HATCH_PATTERNS[name.replace(/-/g, '_')] ?? null;
}

export const HATCH_PATTERNS: Record<string, HatchPattern> = {
  SOLID: { name: 'SOLID', lines: [] },

  // ── acadiso.pat ──────────────────────────────────────────────────────────
  ANSI31: { name: 'ANSI31', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
  ]},
  ANSI32: { name: 'ANSI32', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 9.525, dashArray: [] },
    { angle: 45, x0: 4.490128, y0: 0, dx: 0, dy: 9.525, dashArray: [] },
  ]},
  ANSI33: { name: 'ANSI33', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 45, x0: 4.490128, y0: 0, dx: 0, dy: 6.35, dashArray: [3.175, -1.5875] },
  ]},
  ANSI34: { name: 'ANSI34', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 19.05, dashArray: [] },
    { angle: 45, x0: 4.490128, y0: 0, dx: 0, dy: 19.05, dashArray: [] },
    { angle: 45, x0: 8.980256, y0: 0, dx: 0, dy: 19.05, dashArray: [] },
    { angle: 45, x0: 13.470384, y0: 0, dx: 0, dy: 19.05, dashArray: [] },
  ]},
  ANSI35: { name: 'ANSI35', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 45, x0: 4.490128, y0: 0, dx: 0, dy: 6.35, dashArray: [7.9375, -1.5875, 0, -1.5875] },
  ]},
  ANSI36: { name: 'ANSI36', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 5.55625, dy: 3.175, dashArray: [7.9375, -1.5875, 0, -1.5875] },
  ]},
  ANSI37: { name: 'ANSI37', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
    { angle: 135, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
  ]},
  ANSI38: { name: 'ANSI38', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
    { angle: 135, x0: 0, y0: 0, dx: 6.35, dy: 3.175, dashArray: [7.9375, -4.7625] },
  ]},
  ANGLE: { name: 'ANGLE', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 13.97, dashArray: [10.16, -3.81] },
    { angle: 90, x0: 0, y0: 0, dx: 0, dy: 13.97, dashArray: [10.16, -3.81] },
  ]},
  'AR-B816': { name: 'AR-B816', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 203.2, dashArray: [] },
    { angle: 90, x0: 0, y0: 0, dx: 203.2, dy: 203.2, dashArray: [203.2, -203.2] },
  ]},
  'AR-B88': { name: 'AR-B88', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 203.2, dashArray: [] },
    { angle: 90, x0: 0, y0: 0, dx: 203.2, dy: 101.6, dashArray: [203.2, -203.2] },
  ]},
  'AR-BRELM': { name: 'AR-BRELM', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 135.484, dashArray: [193.675, -9.525] },
    { angle: 0, x0: 0, y0: 57.15, dx: 0, dy: 135.484, dashArray: [193.675, -9.525] },
    { angle: 0, x0: 50.8, y0: 67.7418, dx: 0, dy: 135.484, dashArray: [92.075, -9.525] },
    { angle: 0, x0: 50.8, y0: 124.892, dx: 0, dy: 135.484, dashArray: [92.075, -9.525] },
    { angle: 90, x0: 0, y0: 0, dx: 0, dy: 203.2, dashArray: [57.15, -78.334] },
    { angle: 90, x0: -9.525, y0: 0, dx: 0, dy: 203.2, dashArray: [57.15, -78.334] },
    { angle: 90, x0: 50.8, y0: 67.7418, dx: 0, dy: 101.6, dashArray: [57.15, -78.334] },
    { angle: 90, x0: 41.275, y0: 67.7418, dx: 0, dy: 101.6, dashArray: [57.15, -78.334] },
  ]},
  'AR-BRSTD': { name: 'AR-BRSTD', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 67.7418, dashArray: [] },
    { angle: 90, x0: 0, y0: 0, dx: 67.7418, dy: 101.6, dashArray: [67.7418, -67.7418] },
  ]},
  'AR-CONC': { name: 'AR-CONC', lines: [
    { angle: 50, x0: 0, y0: 0, dx: 104.896, dy: -149.807, dashArray: [19.05, -209.55] },
    { angle: 355, x0: 0, y0: 0, dx: -51.761011, dy: 187.25815, dashArray: [15.24, -167.640584] },
    { angle: 100.451445, x0: 15.182007, y0: -1.328253, dx: 145.556906, dy: -176.270089, dashArray: [16.190009, -178.090245] },
    { angle: 46.1842, x0: 0, y0: 50.8, dx: 157.343, dy: -224.71, dashArray: [28.575, -314.325] },
    { angle: 96.635558, x0: 22.5899, y0: 47.2965, dx: 218.335772, dy: -264.404804, dashArray: [24.285023, -267.135608] },
    { angle: 351.184151, x0: 0, y0: 50.8, dx: 196.679121, dy: 280.887404, dashArray: [22.859967, -251.459732] },
    { angle: 21, x0: 25.4, y0: 38.1, dx: 104.895659, dy: -149.806526, dashArray: [19.05, -209.55] },
    { angle: 326, x0: 25.4, y0: 38.1, dx: -51.7604, dy: 187.258, dashArray: [15.24, -167.64] },
    { angle: 71.451445, x0: 38.034533, y0: 29.5779, dx: 145.556755, dy: -176.270075, dashArray: [16.190009, -178.089938] },
    { angle: 37.5, x0: 0, y0: 0, dx: 53.9242, dy: 65.2018, dashArray: [0, -165.608, 0, -170.18, 0, -168.275] },
    { angle: 7.5, x0: 0, y0: 0, dx: 79.3242, dy: 90.6018, dashArray: [0, -97.028, 0, -161.798, 0, -64.135] },
    { angle: -32.5, x0: -56.642, y0: 0, dx: 117.434, dy: 68.0212, dashArray: [0, -63.5, 0, -198.12, 0, -262.89] },
    { angle: -42.5, x0: -82.042, y0: 0, dx: 92.0344, dy: 118.821, dashArray: [0, -82.55, 0, -131.572, 0, -186.69] },
  ]},
  'AR-HBONE': { name: 'AR-HBONE', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 101.6, dy: 101.6, dashArray: [304.8, -101.6] },
    { angle: 135, x0: 71.842, y0: 71.842, dx: 101.6, dy: -101.6, dashArray: [304.8, -101.6] },
  ]},
  'AR-PARQ1': { name: 'AR-PARQ1', lines: [
    { angle: 90, x0: 0, y0: 0, dx: 304.8, dy: 304.8, dashArray: [304.8, -304.8] },
    { angle: 90, x0: 50.8, y0: 0, dx: 304.8, dy: 304.8, dashArray: [304.8, -304.8] },
    { angle: 90, x0: 101.6, y0: 0, dx: 304.8, dy: 304.8, dashArray: [304.8, -304.8] },
    { angle: 90, x0: 152.4, y0: 0, dx: 304.8, dy: 304.8, dashArray: [304.8, -304.8] },
    { angle: 90, x0: 203.2, y0: 0, dx: 304.8, dy: 304.8, dashArray: [304.8, -304.8] },
    { angle: 90, x0: 254, y0: 0, dx: 304.8, dy: 304.8, dashArray: [304.8, -304.8] },
    { angle: 90, x0: 304.8, y0: 0, dx: 304.8, dy: 304.8, dashArray: [304.8, -304.8] },
    { angle: 0, x0: 0, y0: 304.8, dx: 304.8, dy: -304.8, dashArray: [304.8, -304.8] },
    { angle: 0, x0: 0, y0: 355.6, dx: 304.8, dy: -304.8, dashArray: [304.8, -304.8] },
    { angle: 0, x0: 0, y0: 406.4, dx: 304.8, dy: -304.8, dashArray: [304.8, -304.8] },
    { angle: 0, x0: 0, y0: 457.2, dx: 304.8, dy: -304.8, dashArray: [304.8, -304.8] },
    { angle: 0, x0: 0, y0: 508, dx: 304.8, dy: -304.8, dashArray: [304.8, -304.8] },
    { angle: 0, x0: 0, y0: 558.8, dx: 304.8, dy: -304.8, dashArray: [304.8, -304.8] },
    { angle: 0, x0: 0, y0: 609.6, dx: 304.8, dy: -304.8, dashArray: [304.8, -304.8] },
  ]},
  'AR-RROOF': { name: 'AR-RROOF', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 55.88, dy: 25.4, dashArray: [381, -50.8, 127, -25.4] },
    { angle: 0, x0: 33.782, y0: 12.7, dx: -25.4, dy: 33.782, dashArray: [76.2, -8.382, 152.4, -19.05] },
    { angle: 0, x0: 12.7, y0: 21.59, dx: 132.08, dy: 17.018, dashArray: [203.2, -35.56, 101.6, -25.4] },
  ]},
  'AR-RSHKE': { name: 'AR-RSHKE', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 647.7, dy: 304.8, dashArray: [152.4, -127, 177.8, -76.2, 228.6, -101.6] },
    { angle: 0, x0: 152.4, y0: 12.7, dx: 647.7, dy: 304.8, dashArray: [127, -482.6, 101.6, -152.4] },
    { angle: 0, x0: 457.2, y0: -19.05, dx: 647.7, dy: 304.8, dashArray: [76.2, -787.4] },
    { angle: 90, x0: 0, y0: 0, dx: 304.8, dy: 215.9, dashArray: [292.1, -927.1] },
    { angle: 90, x0: 152.4, y0: 0, dx: 304.8, dy: 215.9, dashArray: [285.75, -933.45] },
    { angle: 90, x0: 279.4, y0: 0, dx: 304.8, dy: 215.9, dashArray: [266.7, -952.5] },
    { angle: 90, x0: 457.2, y0: -19.05, dx: 304.8, dy: 215.9, dashArray: [292.1, -927.1] },
    { angle: 90, x0: 533.4, y0: -19.05, dx: 304.8, dy: 215.9, dashArray: [292.1, -927.1] },
    { angle: 90, x0: 762, y0: 0, dx: 304.8, dy: 215.9, dashArray: [279.4, -939.8] },
  ]},
  'AR-SAND': { name: 'AR-SAND', lines: [
    { angle: 37.5, x0: 0, y0: 0, dx: 28.5242, dy: 39.8018, dashArray: [0, -38.608, 0, -43.18, 0, -41.275] },
    { angle: 7.5, x0: 0, y0: 0, dx: 53.9242, dy: 65.2018, dashArray: [0, -20.828, 0, -34.798, 0, -13.335] },
    { angle: -32.5, x0: -31.242, y0: 0, dx: 66.6344, dy: 42.6212, dashArray: [0, -12.7, 0, -45.72, 0, -59.69] },
    { angle: -42.5, x0: -31.242, y0: 0, dx: 41.2344, dy: 68.0212, dashArray: [0, -6.35, 0, -29.972, 0, -34.29] },
  ]},
  BOX: { name: 'BOX', lines: [
    { angle: 90, x0: 0, y0: 0, dx: 0, dy: 25.4, dashArray: [] },
    { angle: 90, x0: 6.35, y0: 0, dx: 0, dy: 25.4, dashArray: [] },
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 25.4, dashArray: [-6.35, 6.35] },
    { angle: 0, x0: 0, y0: 6.35, dx: 0, dy: 25.4, dashArray: [-6.35, 6.35] },
    { angle: 0, x0: 0, y0: 12.7, dx: 0, dy: 25.4, dashArray: [6.35, -6.35] },
    { angle: 0, x0: 0, y0: 19.05, dx: 0, dy: 25.4, dashArray: [6.35, -6.35] },
    { angle: 90, x0: 12.7, y0: 0, dx: 0, dy: 25.4, dashArray: [6.35, -6.35] },
    { angle: 90, x0: 19.05, y0: 0, dx: 0, dy: 25.4, dashArray: [6.35, -6.35] },
  ]},
  BRASS: { name: 'BRASS', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 0, x0: 0, y0: 3.175, dx: 0, dy: 6.35, dashArray: [3.175, -1.5875] },
  ]},
  BRICK: { name: 'BRICK', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 90, x0: 0, y0: 0, dx: 0, dy: 12.7, dashArray: [6.35, -6.35] },
    { angle: 90, x0: 6.35, y0: 0, dx: 0, dy: 12.7, dashArray: [-6.35, 6.35] },
  ]},
  BRSTONE: { name: 'BRSTONE', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 8.382, dashArray: [] },
    { angle: 90, x0: 22.86, y0: 0, dx: 8.382, dy: 12.7, dashArray: [8.382, -8.382] },
    { angle: 90, x0: 20.32, y0: 0, dx: 8.382, dy: 12.7, dashArray: [8.382, -8.382] },
    { angle: 0, x0: 22.86, y0: 1.397, dx: 12.7, dy: 8.382, dashArray: [-22.86, 2.54] },
    { angle: 0, x0: 22.86, y0: 2.794, dx: 12.7, dy: 8.382, dashArray: [-22.86, 2.54] },
    { angle: 0, x0: 22.86, y0: 4.191, dx: 12.7, dy: 8.382, dashArray: [-22.86, 2.54] },
    { angle: 0, x0: 22.86, y0: 5.588, dx: 12.7, dy: 8.382, dashArray: [-22.86, 2.54] },
    { angle: 0, x0: 22.86, y0: 6.985, dx: 12.7, dy: 8.382, dashArray: [-22.86, 2.54] },
  ]},
  CLAY: { name: 'CLAY', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 4.7625, dashArray: [] },
    { angle: 0, x0: 0, y0: 0.79375, dx: 0, dy: 4.7625, dashArray: [] },
    { angle: 0, x0: 0, y0: 1.5875, dx: 0, dy: 4.7625, dashArray: [] },
    { angle: 0, x0: 0, y0: 3.175, dx: 0, dy: 4.7625, dashArray: [4.7625, -3.175] },
  ]},
  CORK: { name: 'CORK', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 3.81, dashArray: [] },
    { angle: 135, x0: 1.905, y0: -1.905, dx: 0, dy: 10.776307, dashArray: [5.388154, -5.388154] },
    { angle: 135, x0: 2.8575, y0: -1.905, dx: 0, dy: 10.776307, dashArray: [5.388154, -5.388154] },
    { angle: 135, x0: 3.81, y0: -1.905, dx: 0, dy: 10.776307, dashArray: [5.388154, -5.388154] },
  ]},
  CROSS: { name: 'CROSS', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 6.35, dy: 6.35, dashArray: [3.175, -9.525] },
    { angle: 90, x0: 1.5875, y0: -1.5875, dx: 6.35, dy: 6.35, dashArray: [3.175, -9.525] },
  ]},
  DASH: { name: 'DASH', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 3.175, dy: 3.175, dashArray: [3.175, -3.175] },
  ]},
  DOLMIT: { name: 'DOLMIT', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 17.9605, dashArray: [8.980256, -17.960512] },
  ]},
  DOTS: { name: 'DOTS', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0.79375, dy: 1.5875, dashArray: [0, -1.5875] },
  ]},
  EARTH: { name: 'EARTH', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 6.35, dy: 6.35, dashArray: [6.35, -6.35] },
    { angle: 0, x0: 0, y0: 2.38125, dx: 6.35, dy: 6.35, dashArray: [6.35, -6.35] },
    { angle: 0, x0: 0, y0: 4.7625, dx: 6.35, dy: 6.35, dashArray: [6.35, -6.35] },
    { angle: 90, x0: 0.79375, y0: 5.55625, dx: 6.35, dy: 6.35, dashArray: [6.35, -6.35] },
    { angle: 90, x0: 3.175, y0: 5.55625, dx: 6.35, dy: 6.35, dashArray: [6.35, -6.35] },
    { angle: 90, x0: 5.55625, y0: 5.55625, dx: 6.35, dy: 6.35, dashArray: [6.35, -6.35] },
  ]},
  ESCHER: { name: 'ESCHER', lines: [
    { angle: 60, x0: 0, y0: 0, dx: -15.24, dy: 26.396454, dashArray: [27.94, -2.54] },
    { angle: 180, x0: 0, y0: 0, dx: -15.24, dy: 26.396454, dashArray: [27.94, -2.54] },
    { angle: 300, x0: 0, y0: 0, dx: 15.24, dy: 26.396454, dashArray: [27.94, -2.54] },
    { angle: 60, x0: 2.54, y0: 0, dx: -15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 300, x0: 2.54, y0: 0, dx: 15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 60, x0: -1.27, y0: 2.199705, dx: -15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 180, x0: -1.27, y0: 2.199705, dx: -15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 300, x0: -1.27, y0: -2.199705, dx: 15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 180, x0: -1.27, y0: -2.199705, dx: -15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 60, x0: -10.16, y0: 0, dx: -15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 300, x0: -10.16, y0: 0, dx: 15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 60, x0: 5.08, y0: -8.798818, dx: -15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 180, x0: 5.08, y0: -8.798818, dx: -15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 300, x0: 5.08, y0: 8.798818, dx: 15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 180, x0: 5.08, y0: 8.798818, dx: -15.24, dy: 26.396454, dashArray: [5.08, -25.4] },
    { angle: 0, x0: 5.08, y0: 4.399409, dx: -15.24, dy: 26.396454, dashArray: [17.78, -12.7] },
    { angle: 0, x0: 5.08, y0: -4.399409, dx: -15.24, dy: 26.396454, dashArray: [17.78, -12.7] },
    { angle: 120, x0: 1.27, y0: 6.599114, dx: 15.24, dy: 26.396454, dashArray: [17.78, -12.7] },
    { angle: 120, x0: -6.35, y0: 2.199705, dx: 15.24, dy: 26.396454, dashArray: [17.78, -12.7] },
    { angle: 240, x0: -6.35, y0: -2.199705, dx: 15.24, dy: 26.396454, dashArray: [17.78, -12.7] },
    { angle: 240, x0: 1.27, y0: -6.599114, dx: 15.24, dy: 26.396454, dashArray: [17.78, -12.7] },
  ]},
  FLEX: { name: 'FLEX', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [6.35, -6.35] },
    { angle: 45, x0: 6.35, y0: 0, dx: 4.490128, dy: 4.490128, dashArray: [1.5875, -5.805256, 1.5875, -8.980256] },
  ]},
  GRASS: { name: 'GRASS', lines: [
    { angle: 90, x0: 0, y0: 0, dx: 17.960512, dy: 17.960512, dashArray: [4.7625, -31.158524] },
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 25.4, dashArray: [4.7625, -20.6375] },
    { angle: 135, x0: 0, y0: 0, dx: 0, dy: 25.4, dashArray: [4.7625, -20.6375] },
  ]},
  GRATE: { name: 'GRATE', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 0.79375, dashArray: [] },
    { angle: 90, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
  ]},
  GRAVEL: { name: 'GRAVEL', lines: [
    { angle: 228.012788, x0: 18.288, y0: 25.4, dx: 305.850675, dy: 1.887967, dashArray: [3.417214, -338.304836] },
    { angle: 184.969741, x0: 16.002, y0: 22.86, dx: -305.854524, dy: 1.100196, dashArray: [5.864047, -580.540489] },
    { angle: 132.510447, x0: 10.16, y0: 22.352, dx: -377.594922, dy: 1.56031, dashArray: [4.134815, -409.347228] },
    { angle: 267.273689, x0: 0.254, y0: 16.002, dx: -508.633169, dy: 1.208155, dashArray: [5.340045, -528.664374] },
    { angle: 292.833654, x0: 0, y0: 10.668, dx: -330.197701, dy: 1.232081, dashArray: [5.236337, -518.398077] },
    { angle: 357.273689, x0: 2.032, y0: 5.842, dx: -508.633169, dy: 1.208155, dashArray: [5.340045, -528.664374] },
    { angle: 37.69424, x0: 7.366, y0: 5.588, dx: -416.589973, dy: 0.913575, dashArray: [7.061937, -699.131153] },
    { angle: 72.255328, x0: 12.954, y0: 9.906, dx: 586.403738, dy: 0.967663, dashArray: [6.667195, -660.052566] },
    { angle: 121.429566, x0: 14.986, y0: 16.256, dx: 387.712303, dy: 1.204075, dashArray: [5.35813, -530.455457] },
    { angle: 175.236358, x0: 12.192, y0: 20.828, dx: -280.54424, dy: 2.109355, dashArray: [6.117133, -299.73937] },
    { angle: 222.397438, x0: 6.096, y0: 21.336, dx: 413.481239, dy: 0.815545, dashArray: [7.910779, -783.167725] },
    { angle: 138.814075, x0: 25.4, y0: 15.748, dx: 234.164239, dy: 2.389431, dashArray: [2.700045, -267.305658] },
    { angle: 171.469234, x0: 23.368, y0: 17.526, dx: -334.082479, dy: 1.255949, dashArray: [5.13682, -508.54639] },
    { angle: 225, x0: 18.288, y0: 18.288, dx: 17.960512, dy: 17.960512, dashArray: [3.592093, -32.328931] },
    { angle: 203.198591, x0: 16.51, y0: 21.336, dx: -136.742519, dy: 3.335183, dashArray: [1.934413, -191.506224] },
    { angle: 291.801409, x0: 14.732, y0: 20.574, dx: -80.183247, dy: 4.716662, dashArray: [2.735656, -134.04753] },
    { angle: 30.963757, x0: 15.748, y0: 18.034, dx: 91.477345, dy: 4.356064, dashArray: [4.443197, -143.662982] },
    { angle: 161.565051, x0: 19.558, y0: 20.32, dx: -56.225297, dy: 8.032185, dashArray: [3.212871, -77.108981] },
    { angle: 16.38954, x0: 0, y0: 20.574, dx: 265.179911, dy: 1.433405, dashArray: [4.50088, -445.588267] },
    { angle: 70.346176, x0: 4.318, y0: 21.844, dx: -297.294468, dy: 1.708589, dashArray: [3.775989, -373.822157] },
    { angle: 293.198591, x0: 19.558, y0: 25.4, dx: -136.742519, dy: 3.335183, dashArray: [3.868801, -189.571836] },
    { angle: 343.61046, x0: 21.082, y0: 21.844, dx: -265.179911, dy: 1.433405, dashArray: [4.50088, -445.588267] },
    { angle: 339.443955, x0: 0, y0: 4.826, dx: -136.750876, dy: 2.972845, dashArray: [4.340352, -212.677343] },
    { angle: 294.775141, x0: 4.064, y0: 3.302, dx: -306.904241, dy: 1.774013, dashArray: [3.636721, -360.035934] },
    { angle: 66.801409, x0: 19.812, y0: 0, dx: 136.742519, dy: 3.335183, dashArray: [3.868801, -189.571836] },
    { angle: 17.354025, x0: 21.336, y0: 3.556, dx: -345.474028, dy: 1.515237, dashArray: [4.257827, -421.52376] },
    { angle: 69.443955, x0: 7.366, y0: 0, dx: -136.750876, dy: 2.972845, dashArray: [2.170176, -214.847519] },
    { angle: 101.309932, x0: 18.288, y0: 0, dx: 104.608346, dy: 4.98135, dashArray: [1.295146, -128.21995] },
    { angle: 165.963757, x0: 18.034, y0: 1.27, dx: -80.085263, dy: 6.160405, dashArray: [5.236337, -99.490546] },
    { angle: 186.009006, x0: 12.954, y0: 2.54, dx: -255.263379, dy: 1.329497, dashArray: [4.85267, -480.413649] },
    { angle: 303.690068, x0: 15.748, y0: 15.748, dx: -56.35754, dy: 7.044692, dashArray: [3.663239, -87.917764] },
    { angle: 353.157227, x0: 17.78, y0: 12.7, dx: 434.776796, dy: 1.008763, dashArray: [6.395568, -633.160091] },
    { angle: 60.945396, x0: 24.13, y0: 11.938, dx: -204.766486, dy: 2.467066, dashArray: [2.615082, -258.893923] },
    { angle: 90, x0: 25.4, y0: 14.224, dx: 25.4, dy: 25.4, dashArray: [1.524, -23.876] },
    { angle: 120.256437, x0: 12.446, y0: 3.302, dx: -204.773185, dy: 1.828332, dashArray: [3.52867, -349.339408] },
    { angle: 48.012788, x0: 10.668, y0: 6.35, dx: 305.850675, dy: 1.887967, dashArray: [6.834429, -334.887622] },
    { angle: 0, x0: 15.24, y0: 11.43, dx: 25.4, dy: 25.4, dashArray: [6.604, -18.796] },
    { angle: 325.304846, x0: 21.844, y0: 11.43, dx: 310.042351, dy: -1.606437, dashArray: [4.016096, -397.593167] },
    { angle: 254.054604, x0: 25.146, y0: 9.144, dx: 104.66875, dy: 3.488958, dashArray: [3.698291, -181.2165] },
    { angle: 207.645975, x0: 24.13, y0: 5.588, dx: 545.360076, dy: 1.071434, dashArray: [6.021451, -596.124644] },
    { angle: 175.426079, x0: 18.796, y0: 2.794, dx: 331.173934, dy: 1.012764, dashArray: [6.370295, -630.658465] },
  ]},
  HEX: { name: 'HEX', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 5.499261, dashArray: [3.175, -6.35] },
    { angle: 120, x0: 0, y0: 0, dx: 0, dy: 5.499261, dashArray: [3.175, -6.35] },
    { angle: 60, x0: 3.175, y0: 0, dx: 0, dy: 5.499261, dashArray: [3.175, -6.35] },
  ]},
  HONEY: { name: 'HONEY', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 4.7625, dy: 2.749631, dashArray: [3.175, -6.35] },
    { angle: 120, x0: 0, y0: 0, dx: 4.7625, dy: 2.749631, dashArray: [3.175, -6.35] },
    { angle: 60, x0: 0, y0: 0, dx: 4.7625, dy: 2.749631, dashArray: [-6.35, 3.175] },
  ]},
  HOUND: { name: 'HOUND', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 6.35, dy: 1.5875, dashArray: [25.4, -12.7] },
    { angle: 90, x0: 0, y0: 0, dx: -6.35, dy: 1.5875, dashArray: [25.4, -12.7] },
  ]},
  INSUL: { name: 'INSUL', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 9.525, dashArray: [] },
    { angle: 0, x0: 0, y0: 3.175, dx: 0, dy: 9.525, dashArray: [3.175, -3.175] },
    { angle: 0, x0: 0, y0: 6.35, dx: 0, dy: 9.525, dashArray: [3.175, -3.175] },
  ]},
  LINE: { name: 'LINE', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
  ]},
  MUDST: { name: 'MUDST', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 12.7, dy: 6.35, dashArray: [6.35, -6.35, 0, -6.35, 0, -6.35] },
  ]},
  NET: { name: 'NET', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
    { angle: 90, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
  ]},
  NET3: { name: 'NET3', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
    { angle: 60, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
    { angle: 120, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
  ]},
  PLAST: { name: 'PLAST', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 0, x0: 0, y0: 0.79375, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 0, x0: 0, y0: 1.5875, dx: 0, dy: 6.35, dashArray: [] },
  ]},
  PLASTI: { name: 'PLASTI', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 0, x0: 0, y0: 0.79375, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 0, x0: 0, y0: 1.5875, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 0, x0: 0, y0: 3.96875, dx: 0, dy: 6.35, dashArray: [] },
  ]},
  SACNCR: { name: 'SACNCR', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 2.38125, dashArray: [] },
    { angle: 45, x0: 1.6838, y0: 0, dx: 0, dy: 2.38125, dashArray: [0, -2.38125] },
  ]},
  SQUARE: { name: 'SQUARE', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [3.175, -3.175] },
    { angle: 90, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [3.175, -3.175] },
  ]},
  STARS: { name: 'STARS', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 5.499261, dashArray: [3.175, -3.175] },
    { angle: 60, x0: 0, y0: 0, dx: 0, dy: 5.499261, dashArray: [3.175, -3.175] },
    { angle: 120, x0: 1.5875, y0: 2.749631, dx: 0, dy: 5.499261, dashArray: [3.175, -3.175] },
  ]},
  STEEL: { name: 'STEEL', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 7.62, dashArray: [] },
    { angle: 45, x0: 4.318, y0: 0, dx: 0, dy: 7.62, dashArray: [] },
    { angle: 45, x0: 4.572, y0: 0, dx: 0, dy: 7.62, dashArray: [] },
    { angle: 45, x0: 4.826, y0: 0, dx: 0, dy: 7.62, dashArray: [] },
    { angle: 45, x0: 5.08, y0: 0, dx: 0, dy: 7.62, dashArray: [] },
    { angle: 45, x0: 5.334, y0: 0, dx: 0, dy: 7.62, dashArray: [] },
    { angle: 45, x0: 5.588, y0: 0, dx: 0, dy: 7.62, dashArray: [] },
    { angle: 45, x0: 5.842, y0: 0, dx: 0, dy: 7.62, dashArray: [] },
  ]},
  SWAMP: { name: 'SWAMP', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 12.7, dy: 21.997045, dashArray: [3.175, -22.225] },
    { angle: 90, x0: 1.5875, y0: 0, dx: 21.997045, dy: 12.7, dashArray: [1.5875, -42.40659] },
    { angle: 90, x0: 1.984375, y0: 0, dx: 21.997045, dy: 12.7, dashArray: [1.27, -42.72409] },
    { angle: 90, x0: 1.190625, y0: 0, dx: 21.997045, dy: 12.7, dashArray: [1.27, -42.72409] },
    { angle: 60, x0: 2.38125, y0: 0, dx: 12.7, dy: 21.997045, dashArray: [1.016, -24.384] },
    { angle: 120, x0: 0.79375, y0: 0, dx: 12.7, dy: 21.997045, dashArray: [1.016, -24.384] },
  ]},
  TRANS: { name: 'TRANS', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [] },
    { angle: 0, x0: 0, y0: 3.175, dx: 0, dy: 6.35, dashArray: [3.175, -3.175] },
  ]},
  TRIANG: { name: 'TRIANG', lines: [
    { angle: 60, x0: 0, y0: 0, dx: 4.7625, dy: 8.248892, dashArray: [4.7625, -4.7625] },
    { angle: 120, x0: 0, y0: 0, dx: 4.7625, dy: 8.248892, dashArray: [4.7625, -4.7625] },
    { angle: 0, x0: -2.38125, y0: 4.124446, dx: 4.7625, dy: 8.248892, dashArray: [4.7625, -4.7625] },
  ]},
  ZIGZAG: { name: 'ZIGZAG', lines: [
    { angle: 0, x0: 0, y0: 0, dx: 6.35, dy: 6.35, dashArray: [6.35, -6.35] },
    { angle: 90, x0: 6.35, y0: 0, dx: 6.35, dy: 6.35, dashArray: [6.35, -6.35] },
  ]},

  // ── CADO extras (not in acadiso.pat; kept so drawings saved with these
  //    names keep rendering). ISO is a 45° dashed section hatch; PCC is a
  //    plain-cement-concrete grid with diagonal ticks.
  ISO: { name: 'ISO', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 5, dashArray: [10, -2] },
  ]},
  PCC: { name: 'PCC', lines: [
    { angle: 0,   x0: 0, y0: 0, dx: 0, dy: 12,    dashArray: [] },
    { angle: 90,  x0: 0, y0: 0, dx: 0, dy: 12,    dashArray: [] },
    { angle: 45,  x0: 0, y0: 0, dx: 0, dy: 16.97, dashArray: [3, -3] },
    { angle: 135, x0: 0, y0: 0, dx: 0, dy: 16.97, dashArray: [3, -3] },
  ]},
};

// Legacy aliases: ANSI30 was CADO's name for the 45°/135° crosshatch, which is
// AutoCAD's ANSI37; SAND was an approximation of AR-SAND. Both share the real
// definition so old drawings render as AutoCAD would draw the canonical name.
HATCH_PATTERNS['ANSI30'] = { name: 'ANSI30', lines: HATCH_PATTERNS['ANSI37'].lines };
HATCH_PATTERNS['SAND'] = { name: 'SAND', lines: HATCH_PATTERNS['AR-SAND'].lines };
