import type { IBBox } from '../models/entity.model';
import type { HatchPatternLine } from '../registries/hatch-patterns';

/**
 * Pattern-line planner shared by the canvas renderer and the PDF exporter.
 *
 * Turns a `.pat` line family (see `hatch-patterns.ts` for the semantics) into
 * the finite segments that need stroking inside a clip rectangle, with the
 * dash phase every segment must start at. Pure geometry: nothing here knows
 * about a canvas, a view model or jsPDF, so the two consumers cannot drift —
 * they did before, and the PDF had its own copy of every bug.
 *
 * ## What AutoCAD does that this has to reproduce
 *
 *   * Line `i` of a family starts at `base + i * (dx·dir + dy·normal)` and its
 *     dash sequence is anchored at THAT point. BRICK's staggered joints and
 *     AR-SAND's scattered dots come from `dx` shifting the phase row by row;
 *     anchoring the dashes anywhere else (the old renderer used the boundary
 *     centre) turns both into a regular grid.
 *   * A dash element of 0 is a dot, a negative one a gap, and a sequence may
 *     begin with a gap (BRICK's third family is `[-6.35, 6.35]`). Canvas and
 *     PDF dash arrays always begin "on", so the sequence is rotated to start
 *     on a dash and the phase is shifted to compensate.
 *
 * ## Why every segment starts on a period boundary
 *
 * Both back-ends restart the dash pattern at each `moveTo`, at `dashOffset`
 * into the array. Starting each segment at a multiple of the period (measured
 * from the line's own base point) makes the phase identical for every line in
 * the family, so a whole family goes out as ONE path and ONE stroke instead of
 * a stroke per line.
 *
 * ## Why there is a budget
 *
 * The freeze users hit when picking SAND or EARTH: the old code stroked each
 * line across twice the boundary diagonal and let the browser dash the whole
 * length. A 0.5 mm dash on a 10 m room is 28 000 dashes per line, times
 * thousands of lines, times three families — tens of millions of segments per
 * frame, repeated on every hover of the picker. Lines are now clipped to the
 * rectangle actually being painted (boundary ∩ viewport), families whose
 * spacing or dash period is below a pixel are drawn as a translucent fill or a
 * lightened continuous line — which is what they look like rasterised anyway —
 * and the total segment estimate is capped, densest family first. AutoCAD does
 * the same in spirit: HPMAXLINES (default 1 000 000) makes an over-dense hatch
 * fall back to a solid fill.
 */

export interface IPatternTransform {
  /** Hatch pattern scale (`HatchEntity.scale`). */
  scale: number;
  /** Hatch pattern angle in degrees (`HatchEntity.angle`, +90 for the double pass). */
  angleDeg: number;
  /** Pattern origin offset in world units (`HatchEntity.originX/Y`). */
  originX: number;
  originY: number;
}

export interface IPlanOptions {
  /** World rectangle to cover — boundary bbox intersected with whatever is visible. */
  clip: IBBox;
  /** Device pixels (or output mm) per world unit; drives the density fallbacks. */
  pixelsPerUnit: number;
  /** Upper bound on estimated stroked dash segments across all families. */
  segmentBudget?: number;
  /** Families spaced closer than this on screen become a translucent fill. */
  minSpacingPx?: number;
  /** Dash sequences shorter than this on screen are drawn continuous (lightened). */
  minDashPeriodPx?: number;
}

export interface ISegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface IFamilyPlan {
  /** 'lines' → stroke `segments`; 'fill' → paint the clip path at `fillAlpha`. */
  mode: 'lines' | 'fill';
  /** World-space segments; each begins on a dash-period boundary of its line. */
  segments: ISegment[];
  /** Dash sequence in WORLD units, rotated to begin with a dash (null = continuous). */
  dash: number[] | null;
  /** Position within `dash` (world units) at which every segment starts. */
  dashOffset: number;
  /** True when the sequence contains dots (0-length dashes) — needs round caps. */
  hasDots: boolean;
  /** Ink fraction along a line: 1 for continuous, less for dashed/dotted. */
  coverage: number;
  /** Alpha to paint the family with when `mode === 'fill'`, or to lighten a
   *  dashed family collapsed to continuous lines. 1 = draw as-is. */
  fillAlpha: number;
  /** Perpendicular spacing in world units (Infinity for a single-line family). */
  spacing: number;
  /** Estimated dash segments this family would cost if stroked as lines. */
  estimatedSegments: number;
}

const DEFAULT_BUDGET = 1_500_000;
const DEFAULT_MIN_SPACING_PX = 1;
const DEFAULT_MIN_DASH_PERIOD_PX = 2;
/** Width in px a dot is assumed to cover when computing ink coverage. */
const DOT_PX = 1;
const EPS = 1e-9;

export function planPatternFamilies(
  lines: readonly HatchPatternLine[],
  xf: IPatternTransform,
  opts: IPlanOptions,
): IFamilyPlan[] {
  const plans: IFamilyPlan[] = [];
  if (!lines.length || opts.clip.w <= 0 || opts.clip.h <= 0) return plans;
  for (const def of lines) {
    const plan = planFamily(def, xf, opts);
    if (plan) plans.push(plan);
  }
  applyBudget(plans, opts.segmentBudget ?? DEFAULT_BUDGET, opts.pixelsPerUnit);
  return plans;
}

function planFamily(def: HatchPatternLine, xf: IPatternTransform, opts: IPlanOptions): IFamilyPlan | null {
  const scale = Math.max(1e-6, xf.scale || 1);
  const ppu = Math.max(1e-12, opts.pixelsPerUnit);
  const global = (xf.angleDeg * Math.PI) / 180;
  const rad = (def.angle * Math.PI) / 180 + global;
  const dirX = Math.cos(rad), dirY = Math.sin(rad);
  const nX = -dirY, nY = dirX;

  // Base point: pattern units → scaled → rotated with the hatch → shifted to the origin.
  const bx = def.x0 * scale, by = def.y0 * scale;
  const cg = Math.cos(global), sg = Math.sin(global);
  const baseX = bx * cg - by * sg + (xf.originX || 0);
  const baseY = bx * sg + by * cg + (xf.originY || 0);

  const shift = def.dx * scale;
  const dySigned = def.dy * scale;
  const spacing = Math.abs(dySigned);

  // ── Dash sequence ────────────────────────────────────────────────────────
  const dashInfo = normaliseDash(def.dashArray, scale);
  if (dashInfo.invisible) return null;
  const clip = opts.clip;
  const clipDiag = Math.hypot(clip.w, clip.h);

  let coverage = 1;
  let dash: number[] | null = null;
  let dashOffset = 0;
  let hasDots = false;
  let fillAlpha = 1;
  if (dashInfo.period > 0 && dashInfo.rotated) {
    const inkWorld = dashInfo.inkLength + dashInfo.dotCount * (DOT_PX / ppu);
    coverage = Math.min(1, inkWorld / dashInfo.period);
    const periodPx = dashInfo.period * ppu;
    if (periodPx >= (opts.minDashPeriodPx ?? DEFAULT_MIN_DASH_PERIOD_PX)) {
      dash = dashInfo.rotated;
      dashOffset = dashInfo.offset;
      hasDots = dashInfo.dotCount > 0;
    } else {
      // Sub-pixel dashes: continuous line at the ink fraction, which is what
      // the rasteriser would average them to.
      fillAlpha = Math.max(0.08, coverage);
    }
  }

  // ── Line index range over the clip rectangle ─────────────────────────────
  const corners = [
    [clip.x, clip.y], [clip.x + clip.w, clip.y],
    [clip.x, clip.y + clip.h], [clip.x + clip.w, clip.y + clip.h],
  ];
  const baseN = baseX * nX + baseY * nY;
  let nMin = Infinity, nMax = -Infinity;
  for (const [cx, cy] of corners) {
    const n = cx * nX + cy * nY;
    if (n < nMin) nMin = n;
    if (n > nMax) nMax = n;
  }

  let iStart = 0, iEnd = 0;
  if (spacing > EPS) {
    const a = (nMin - baseN) / dySigned;
    const b = (nMax - baseN) / dySigned;
    iStart = Math.floor(Math.min(a, b)) - 1;
    iEnd = Math.ceil(Math.max(a, b)) + 1;
  }
  const lineCount = iEnd - iStart + 1;

  // ── Density fallback: closer than a pixel → translucent fill ─────────────
  const spacingPx = spacing * ppu;
  if (spacing > EPS && spacingPx < (opts.minSpacingPx ?? DEFAULT_MIN_SPACING_PX)) {
    return {
      mode: 'fill', segments: [], dash: null, dashOffset: 0, hasDots: false, coverage,
      fillAlpha: densityAlpha(coverage, spacingPx), spacing,
      estimatedSegments: 0,
    };
  }

  const period = dash ? dashInfo.period : 0;
  const estimatedSegments = lineCount * (period > 0 ? Math.max(1, clipDiag / period) : 1);

  // ── Emit clipped segments ────────────────────────────────────────────────
  const segments: ISegment[] = [];
  for (let i = iStart; i <= iEnd; i++) {
    const ox = baseX + i * (shift * dirX + dySigned * nX);
    const oy = baseY + i * (shift * dirY + dySigned * nY);
    const t = clipLineToRect(ox, oy, dirX, dirY, clip);
    if (!t) continue;
    let t0 = t[0];
    const t1 = t[1];
    // Start on a period boundary measured from this line's own base point so
    // the dash phase is the same for every subpath in the family.
    if (period > 0) t0 = Math.floor(t0 / period) * period;
    segments.push({ x1: ox + t0 * dirX, y1: oy + t0 * dirY, x2: ox + t1 * dirX, y2: oy + t1 * dirY });
  }
  if (!segments.length) return null;

  return {
    mode: 'lines', segments, dash, dashOffset, hasDots, coverage, fillAlpha,
    spacing: spacing > EPS ? spacing : Infinity, estimatedSegments,
  };
}

/**
 * Once the per-family estimates are known, collapse the most expensive
 * families to fills until the total fits the budget. The densest family is
 * the one the eye reads as a tone anyway; keeping the sparse ones as lines
 * preserves the pattern's character (BRICK keeps its courses, loses nothing).
 */
function applyBudget(plans: IFamilyPlan[], budget: number, ppu: number): void {
  let total = 0;
  for (const p of plans) total += p.estimatedSegments;
  if (total <= budget) return;
  const byCost = plans
    .filter((p) => p.mode === 'lines')
    .sort((a, b) => b.estimatedSegments - a.estimatedSegments);
  for (const p of byCost) {
    if (total <= budget) break;
    total -= p.estimatedSegments;
    p.mode = 'fill';
    p.segments = [];
    p.dash = null;
    p.hasDots = false;
    p.fillAlpha = densityAlpha(p.coverage, p.spacing * ppu);
    p.estimatedSegments = 0;
  }
}

/** Tone a family reads as when its lines are too dense to resolve. */
function densityAlpha(coverage: number, spacingPx: number): number {
  const lineWidthPx = 1;
  const a = coverage * (lineWidthPx / Math.max(spacingPx, 1e-6));
  return Math.min(0.85, Math.max(0.05, a));
}

interface IDashInfo {
  /** Sequence in world units rotated so it begins with a dash (or a dot). */
  rotated: number[] | null;
  /** Position in `rotated` corresponding to the original phase 0. */
  offset: number;
  period: number;
  inkLength: number;
  dotCount: number;
  /** All gaps, no dash and no dot — nothing would ever be painted. */
  invisible: boolean;
}

function normaliseDash(raw: readonly number[] | undefined, scale: number): IDashInfo {
  if (!raw || !raw.length) return { rotated: null, offset: 0, period: 0, inkLength: 0, dotCount: 0, invisible: false };
  const seq = raw.map((v) => v * scale);
  let period = 0, ink = 0, dots = 0;
  for (const v of seq) {
    period += Math.abs(v);
    if (v > 0) ink += v;
    else if (v === 0) dots++;
  }
  // A sequence with no positive length and no dots has nothing to paint.
  if (period <= EPS) return { rotated: null, offset: 0, period: 0, inkLength: 0, dotCount: 0, invisible: false };
  if (ink <= EPS && dots === 0) return { rotated: null, offset: 0, period, inkLength: 0, dotCount: 0, invisible: true };

  // Rotate so the array starts "on": first dash, else first dot.
  let k = seq.findIndex((v) => v > 0);
  if (k < 0) k = seq.findIndex((v) => v === 0);
  let pre = 0;
  for (let i = 0; i < k; i++) pre += Math.abs(seq[i]);
  const rotated = seq.slice(k).concat(seq.slice(0, k)).map((v) => Math.abs(v));
  // Back-ends need an even count; a .pat odd sequence repeats as-is, which is
  // exactly what doubling produces.
  if (rotated.length % 2 === 1) rotated.push(...rotated);
  const offset = pre > EPS ? (period - pre) % period : 0;
  return { rotated, offset, period, inkLength: ink, dotCount: dots, invisible: false };
}

/**
 * Parameter range [t0, t1] of the infinite line `o + t·d` inside `rect`
 * (Liang–Barsky), or null when it misses.
 */
function clipLineToRect(ox: number, oy: number, dx: number, dy: number, r: IBBox): [number, number] | null {
  let t0 = -Infinity, t1 = Infinity;
  const xMax = r.x + r.w, yMax = r.y + r.h;
  if (Math.abs(dx) < EPS) {
    if (ox < r.x || ox > xMax) return null;
  } else {
    const a = (r.x - ox) / dx, b = (xMax - ox) / dx;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (Math.abs(dy) < EPS) {
    if (oy < r.y || oy > yMax) return null;
  } else {
    const a = (r.y - oy) / dy, b = (yMax - oy) / dy;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return null;
  return [t0, t1];
}

/** Intersection of two rectangles, or null when they do not overlap. */
export function intersectRects(a: IBBox, b: IBBox | null | undefined): IBBox | null {
  if (!b) return a;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}
