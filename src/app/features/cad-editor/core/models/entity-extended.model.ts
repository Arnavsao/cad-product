import { Entity, IPoint, IBBox, ISnapPoint, IPropertySchema, ViewModelLike, DocLike } from './entity.model';
import { HATCH_PATTERNS } from '../registries/hatch-patterns';
import { DXF_ACI_COLORS } from '../registries/aci-colors';
import type { IHatchBoundarySpec, IBoundaryLoop, IFrozenEdge } from './hatch-boundary.model';
import { loopSignature, traceFrozenLoopToPath, frozenLoopToPolygon } from './hatch-boundary.model';
import type { IAttrib } from './block-attribute.model';
import type { DimTextPlacement } from './dimension-style.model';
import { HatchRendererService } from '../services/hatch-renderer.service';
import { TextLayoutEngine, type ITextLayout, type ITextLayoutOptions } from '../utils/text-layout-engine';
/**
 * Stubs for extended entity types â€” enough fidelity for DXF round-trip + basic rendering.
 * The full implementation (MTEXT wrap, hatch patterns, spline De Boor, etc.) lives in
 * 12-entities-extended.js and will be ported in a follow-up.
 */

/* ---- TEXT ---- */
export interface ITextOptions {
  halign?: number;
  valign?: number;
  attachmentPoint?: number;
  mtextWidth?: number;
  colorNumber?: number;
  font?: string;
  isMText?: boolean;
}

export type TextJustify =
  | 'TL' | 'TC' | 'TR'
  | 'ML' | 'MC' | 'MR'
  | 'BL' | 'BC' | 'BR';

/**
 * Map DXF halign + valign (group codes 72 and 73 / 74) to a 9-point justify code.
 *
 *   halign: 0=left, 1=center, 2=right, 4=middle (overrides valign to middle)
 *   valign: 0=baseline, 1=bottom, 2=middle, 3=top
 *
 * halign 3 (aligned) and 5 (fit) scale text between two points and don't have a
 * single 9-point equivalent â€” we fall back to 'BL' for those.
 */
export function dxfAlignToJustify(halign?: number, valign?: number): TextJustify {
  if (halign === 4) return 'MC'; // DXF "Middle" â€” geometric center
  const v: 'T' | 'M' | 'B' =
    valign === 3 ? 'T'
      : valign === 2 ? 'M'
        : 'B'; // 0=baseline, 1=bottom â†’ B
  const h: 'L' | 'C' | 'R' =
    halign === 1 ? 'C'
      : halign === 2 ? 'R'
        : 'L';
  return (v + h) as TextJustify;
}

export class TextEntity extends Entity {
  x: number;
  y: number;
  text: string;
  height: number;
  rotation: number; // radians
  halign?: number;
  valign?: number;
  attachmentPoint?: number;
  mtextWidth = 0;
  autoWrap?: boolean;
  /** Retained so JSON/DXF serializers do not downgrade MTEXT to TEXT. */
  isMText = false;
  font = 'Arial';

  // Formatting (Step 6 + 9-point justify)
  bold = false;
  italic = false;
  underline = false;
  strikethrough = false;
  overline = false;
  textFrame = false;
  /**
   * 9-point justification â€” matches AutoCAD's TEXT entity. First letter is
   * vertical anchor (T=top, M=middle, B=baseline/bottom), second letter is
   * horizontal anchor (L=left, C=center, R=right). Default 'BL' = baseline-left,
   * which matches AutoCAD's no-explicit-alignment TEXT default.
   *
   * Supersedes the prior `align` field. `align` is kept as a back-compat getter
   * that maps to/from the horizontal half of `justify`.
   */
  justify: TextJustify = 'BL';
  /** Multiplier on line height (1.0 = baseline-to-baseline = font height; 1.2 default). */
  lineSpacing = 1.2;
  /** Extra space between glyphs, in world units. Requires CanvasRenderingContext2D.letterSpacing. */
  charSpacing = 0;
  /** DXF group 41 â€” horizontal scale factor. 1.0 = normal, <1 compresses, >1 stretches. */
  widthFactor = 1;
  /** DXF group 51 â€” oblique angle in radians. Positive = lean right (skewX). */
  obliqueAngle = 0;
  /** When true, paint a filled rectangle behind each line (uses backgroundColor). */
  backgroundMask = false;
  /** Background fill color for the mask (CSS color or '#rgb'/'#rrggbb'). */
  backgroundColor = '#000000';
  /** Offset factor for the mask. Default is 1.5 (1.5x text height). */
  maskOffset = 1.5;

  private _cachedBbox: import('./entity.model').IBBox | null = null;
  private _cachedTextMetrics: Map<string, number> = new Map();

  /** Back-compat read accessor â€” reflects the horizontal half of `justify`. */
  get align(): 'left' | 'center' | 'right' {
    const h = this.justify[1];
    return h === 'L' ? 'left' : h === 'R' ? 'right' : 'center';
  }
  set align(v: 'left' | 'center' | 'right') {
    const vertical = this.justify[0] as 'T' | 'M' | 'B';
    const h = v === 'left' ? 'L' : v === 'right' ? 'R' : 'C';
    this.justify = (vertical + h) as TextJustify;
    this._cachedBbox = null;
  }

  constructor(x: number, y: number, text: string, height = 2.5, rotation = 0, options: ITextOptions = {}) {
    super('TEXT');
    this.x = x;
    this.y = y;
    this.text = text ?? '';
    this.height = height;
    this.rotation = rotation;
    this.halign = options.halign;
    this.valign = options.valign;
    this.attachmentPoint = options.attachmentPoint;
    this.mtextWidth = options.mtextWidth ?? 0;
    this.isMText = !!options.isMText;
    if (options.colorNumber !== undefined) this.colorNumber = options.colorNumber;
    if (options.font) this.font = options.font;
    if (options.attachmentPoint !== undefined && options.attachmentPoint >= 1 && options.attachmentPoint <= 9) {
      const map: Record<number, TextJustify> = {
        1: 'TL', 2: 'TC', 3: 'TR',
        4: 'ML', 5: 'MC', 6: 'MR',
        7: 'BL', 8: 'BC', 9: 'BR',
      };
      this.justify = map[options.attachmentPoint] || 'TL';
    } else if (options.isMText) {
      this.justify = 'TL';
    } else if (options.halign !== undefined || options.valign !== undefined) {
      this.justify = dxfAlignToJustify(options.halign, options.valign);
    } else {
      const hasAlignOptions = Object.keys(options).length > 0;
      this.justify = hasAlignOptions ? 'BL' : 'TL';
    }
  }

  // Cleared the invalid getters/setters that caused TS errors.

  /** Rotation surfaced as degrees for UI binding (read/write). */
  get rotationDeg(): number {
    return this.rotation * 180 / Math.PI;
  }
  set rotationDeg(deg: number) {
    const d = Number(deg);
    if (Number.isFinite(d)) this.rotation = d * Math.PI / 180;
  }

  getLayout(vm?: ViewModelLike): ITextLayout {
    const opts: ITextLayoutOptions = {
      text: this.text ?? '',
      font: this.font,
      height: this.height,
      rotation: this.rotation,
      justify: this.justify,
      lineSpacing: this.lineSpacing,
      widthFactor: this.widthFactor,
      obliqueAngle: this.obliqueAngle,
      bold: this.bold,
      italic: this.italic,
      charSpacing: this.charSpacing,
      x: this.x,
      y: this.y,
      autoWrap: this.autoWrap,
      mtextWidth: this.mtextWidth
    };
    return TextLayoutEngine.measure(opts);
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    const s = vm.w2s(this.x, this.y);
    const scaleFactor = (this as any).isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1;
    const viewScale = scaleFactor * (vm.cumulativeScale ?? vm.scale);

    this.setupContext(ctx, vm, doc, byBlockColor);
    ctx.save();
    ctx.translate(s.x, s.y);
    if (this.rotation) ctx.rotate(-this.rotation);

    if (this.widthFactor !== 1 || this.obliqueAngle !== 0) {
      const skew = this.obliqueAngle !== 0 ? Math.tan(this.obliqueAngle) : 0;
      ctx.transform(this.widthFactor, 0, skew, 1, 0, 0);
    }

    const hPx = this.height * viewScale * (4 / 3);
    const style = this.italic ? 'italic ' : '';
    const weight = this.bold ? 'bold ' : '';
    ctx.font = `${style}${weight}${hPx}px ${this.font}`;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const layout = this.getLayout(vm);
    const textColor = ctx.fillStyle;
    const wf = Math.abs(this.widthFactor) || 1;

    for (const line of layout.lines) {
      const lineY = line.y * viewScale;
      let lineX = 0;
      if (line.glyphs.length > 0) {
        lineX = line.glyphs[0].x * viewScale;
      } else if (line.w > 0) { // Should not happen usually, but for safety
        const horiz = this.justify[1];
        if (horiz === 'C') lineX = (-line.w / 2) * viewScale;
        else if (horiz === 'R') lineX = -line.w * viewScale;
      }

      const lineX_u = lineX / wf;
      const w_u = (line.w * viewScale) / wf;

      // Background mask
      if (this.backgroundMask && line.text.length) {
        const offsetMultiplier = Math.max(1, this.maskOffset || 1.5);
        const pad = hPx * ((offsetMultiplier - 1) / 2);
        const ry = lineY - hPx * 0.85 - pad;
        const rh = hPx + pad * 2;
        ctx.fillStyle = this.backgroundColor;
        ctx.fillRect(lineX_u - pad / wf, ry, w_u + (pad * 2) / wf, rh);
        ctx.fillStyle = textColor;
      }

      // Draw text
      if (line.text.length > 0) {
        if (this.charSpacing !== 0) {
          try { (ctx as any).letterSpacing = `${this.charSpacing * vm.scale}px`; } catch { /* ignore */ }
        }
        ctx.fillText(line.text, lineX_u, lineY);
        if (this.charSpacing !== 0) {
          try { (ctx as any).letterSpacing = '0px'; } catch { /* ignore */ }
        }
      }

      if (this.underline && line.text.length) {
        const yUnder = lineY + hPx * 0.12;
        ctx.save();
        ctx.strokeStyle = textColor as string;
        ctx.lineWidth = Math.max(1, hPx * 0.06);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(lineX_u, yUnder);
        ctx.lineTo(lineX_u + w_u, yUnder);
        ctx.stroke();
        ctx.restore();
      }

      if (this.strikethrough && line.text.length) {
        const yStrike = lineY - hPx * 0.35;
        ctx.save();
        ctx.strokeStyle = textColor as string;
        ctx.lineWidth = Math.max(1, hPx * 0.06);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(lineX_u, yStrike);
        ctx.lineTo(lineX_u + w_u, yStrike);
        ctx.stroke();
        ctx.restore();
      }

      if (this.overline && line.text.length) {
        const yOver = lineY - hPx * 0.9;
        ctx.save();
        ctx.strokeStyle = textColor as string;
        ctx.lineWidth = Math.max(1, hPx * 0.06);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(lineX_u, yOver);
        ctx.lineTo(lineX_u + w_u, yOver);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (this.textFrame && layout.localBounds) {
      ctx.save();
      ctx.strokeStyle = textColor as string;
      // AutoCAD typically uses a thin line for the frame, proportional to text height.
      ctx.lineWidth = Math.max(1, hPx * 0.05);
      ctx.setLineDash([]);

      // Add a small padding (offset) just like AutoCAD's text frame
      const pad = hPx * 0.25;

      const bx = layout.localBounds.minX * viewScale - pad;
      const by = layout.localBounds.minY * viewScale - pad;
      const bw = (layout.localBounds.maxX - layout.localBounds.minX) * viewScale + (pad * 2);
      const bh = (layout.localBounds.maxY - layout.localBounds.minY) * viewScale + (pad * 2);

      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
    }

    ctx.restore();
  }

  override snapPoints(): ISnapPoint[] {
    return [{ x: this.x, y: this.y, label: 'insertion' }];
  }

  override bbox(): IBBox {
    const b = this.getLayout().worldBounds;
    return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
  }

  override fastBbox(): IBBox {
    const chars = this.text ? this.text.length : 1;
    const w = chars * this.height;
    const h = this.height * 2;
    const r = w + h;
    return { x: this.x - r, y: this.y - r, w: r * 2, h: r * 2 };
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const b = this.bbox();
    if (!b) return false;
    const sMin = vm.w2s(b.x, b.y + b.h);
    const sMax = vm.w2s(b.x + b.w, b.y);
    const left = Math.min(sMin.x, sMax.x) - tol;
    const right = Math.max(sMin.x, sMax.x) + tol;
    const top = Math.min(sMin.y, sMax.y) - tol;
    const bottom = Math.max(sMin.y, sMax.y) + tol;
    return sx >= left && sx <= right && sy >= top && sy <= bottom;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'x', label: 'Position X', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'y', label: 'Position Y', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'rotationDeg', label: 'Rotation', type: 'number', category: 'Geometry', precision: 1, suffix: 'Â°' },

      { key: 'text', label: 'Text', type: 'text', category: 'Text' },
      {
        key: 'font', label: 'Font', type: 'dropdown', category: 'Text',
        options: ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'sans-serif', 'serif', 'monospace']
      },
      { key: 'height', label: 'Height', type: 'number', category: 'Text', precision: 2, step: 0.5, min: 0.001 },
      { key: 'bold', label: 'Bold', type: 'boolean', category: 'Text' },
      { key: 'italic', label: 'Italic', type: 'boolean', category: 'Text' },
      { key: 'underline', label: 'Underline', type: 'boolean', category: 'Text' },
      { key: 'textFrame', label: 'Text frame', type: 'boolean', category: 'Text' },
      {
        key: 'justify', label: 'Justify', type: 'dropdown', category: 'Text',
        options: ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR']
      },
      { key: 'lineSpacing', label: 'Line Spacing', type: 'number', category: 'Text', precision: 2, step: 0.1, min: 0.5 },
      { key: 'charSpacing', label: 'Char Spacing', type: 'number', category: 'Text', precision: 2, step: 0.1 },
      { key: 'widthFactor', label: 'Width Factor', type: 'number', category: 'Text', precision: 3, step: 0.1, min: 0.01 },
      { key: 'obliqueAngle', label: 'Oblique Angle', type: 'number', category: 'Text', precision: 1, suffix: 'Â°' },

      { key: 'backgroundMask', label: 'Background Mask', type: 'boolean', category: 'Background' },
      { key: 'backgroundColor', label: 'Background Color', type: 'color', category: 'Background' },
    ];
  }
}

/* ---- ELLIPSE ---- */
export class EllipseEntity extends Entity {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  startAngle: number;
  endAngle: number;

  constructor(cx: number, cy: number, rx: number, ry: number, rotation = 0, startAngle = 0, endAngle = Math.PI * 2) {
    super('ELLIPSE');
    this.cx = cx;
    this.cy = cy;
    this.rx = rx;
    this.ry = ry;
    this.rotation = rotation;
    this.startAngle = startAngle;
    this.endAngle = endAngle;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    const c = vm.w2s(this.cx, this.cy);
    const rx = this.rx * (vm.cumulativeScale ?? vm.scale);
    const ry = this.ry * (vm.cumulativeScale ?? vm.scale);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, -this.rotation, -this.startAngle, -this.endAngle, true);
    this.setupContext(ctx, vm, doc, byBlockColor);
    ctx.stroke();
  }

  override snapPoints(): ISnapPoint[] {
    return [{ x: this.cx, y: this.cy, label: 'center' }];
  }

  override bbox(): IBBox {
    // Tight rotated ellipse bbox: axis-aligned envelope accounting for rotation
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const hw = Math.sqrt(this.rx * this.rx * cos * cos + this.ry * this.ry * sin * sin);
    const hh = Math.sqrt(this.rx * this.rx * sin * sin + this.ry * this.ry * cos * cos);
    return { x: this.cx - hw, y: this.cy - hh, w: hw * 2, h: hh * 2 };
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const c = vm.w2s(this.cx, this.cy);
    const rx = this.rx * (vm.cumulativeScale ?? vm.scale ?? 1);
    const ry = this.ry * (vm.cumulativeScale ?? vm.scale ?? 1);
    const rot = -(this.rotation ?? 0);
    const steps = 36;
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = (Math.PI * 2 * i) / steps;
      const lx = rx * Math.cos(t);
      const ly = ry * Math.sin(t);
      const cur = {
        x: c.x + lx * Math.cos(rot) - ly * Math.sin(rot),
        y: c.y + lx * Math.sin(rot) + ly * Math.cos(rot),
      };
      if (prev) {
        if (pointToScreenSegmentDist(sx, sy, prev, cur) <= tol) return true;
      }
      prev = cur;
    }
    return false;
  }
}

/* ---- SPLINE (rendered as polyline through control points) ---- */
export class SplineEntity extends Entity {
  controlPoints: IPoint[];
  knots: number[];
  degree: number;

  constructor(controlPoints: IPoint[], knots: number[] = [], degree = 3) {
    super('SPLINE');
    this.controlPoints = controlPoints.map((p: any) => ({ x: p.x, y: p.y }));
    this.knots = knots;
    this.degree = degree;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    if (this.controlPoints.length < 2) return;
    const pts = catmullRomChain(this.controlPoints, 16);
    if (pts.length < 2) return;
    ctx.beginPath();
    const p0 = vm.w2s(pts[0].x, pts[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length; i++) {
      const p = vm.w2s(pts[i].x, pts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    this.setupContext(ctx, vm, doc, byBlockColor);
    ctx.stroke();
  }

  override snapPoints(): ISnapPoint[] {
    return this.controlPoints.map((p, i) => ({ x: p.x, y: p.y, label: i === 0 ? 'endpoint' : 'control' }));
  }

  override bbox(): IBBox {
    if (!this.controlPoints.length) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = this.controlPoints.map((p: any) => p.x);
    const ys = this.controlPoints.map((p: any) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const pts = catmullRomChain(this.controlPoints, 16);
    if (pts.length < 2) return false;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = vm.w2s(pts[i].x, pts[i].y);
      const b = vm.w2s(pts[i + 1].x, pts[i + 1].y);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / len2));
      const px = a.x + t * dx - sx;
      const py = a.y + t * dy - sy;
      if (Math.hypot(px, py) <= tol) return true;
    }
    return false;
  }
}

/* ---- HATCH (renders as outline of boundary edges) ---- */
export interface IHatchEdge {
  type?: string;
  start?: IPoint;
  end?: IPoint;
  center?: IPoint;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  isCcw?: boolean;
  majorAxisEndPoint?: IPoint;
  axisRatio?: number;
  vertices?: IPoint[];
  degree?: number;
  rational?: boolean;
  periodic?: boolean;
  knots?: number[];
  weights?: number[];
  fitPoints?: IPoint[];
  startTangent?: IPoint;
  endTangent?: IPoint;
}

/** One raw DXF HATCH pattern-line definition (groups 53/43/44/45/46/79/49). */
export interface IDxfHatchPatternLine {
  angle: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  dashArray: number[];
}

export interface IDxfHatchPolylineVertex {
  point: IPoint;
  /** DXF group 42; it describes the segment beginning at this vertex. */
  bulge?: number;
}

export interface IDxfHatchPolylinePath {
  kind: 'polyline';
  flags: number;
  hasBulges: boolean;
  closed: boolean;
  vertices: IDxfHatchPolylineVertex[];
  sourceBoundaryHandles: string[];
}

export interface IDxfHatchLineEdge {
  kind: 'line';
  start: IPoint;
  end: IPoint;
}

export interface IDxfHatchArcEdge {
  kind: 'arc';
  center: IPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  counterClockwise: boolean;
}

export interface IDxfHatchEllipseEdge {
  kind: 'ellipse';
  center: IPoint;
  majorAxisEndPoint: IPoint;
  axisRatio: number;
  startAngle: number;
  endAngle: number;
  counterClockwise: boolean;
}

export interface IDxfHatchSplineEdge {
  kind: 'spline';
  degree: number;
  rational: boolean;
  periodic: boolean;
  knots: number[];
  controlPoints: IPoint[];
  weights: number[];
  fitPoints: IPoint[];
  startTangent?: IPoint;
  endTangent?: IPoint;
}

export type IDxfHatchEdge =
  | IDxfHatchLineEdge
  | IDxfHatchArcEdge
  | IDxfHatchEllipseEdge
  | IDxfHatchSplineEdge;

export interface IDxfHatchEdgePath {
  kind: 'edges';
  flags: number;
  edges: IDxfHatchEdge[];
  sourceBoundaryHandles: string[];
}

export interface IDxfHatchGradientColor {
  shift: number;
  aci?: number;
  trueColor?: number;
}

export interface IDxfHatchGradient {
  isGradient: boolean;
  reserved451: number;
  singleColor: boolean;
  angleRad: number;
  centeredShift: number;
  tint: number;
  colors: IDxfHatchGradientColor[];
  name: string;
}

/**
 * The full imported HATCH definition. `rawTags` is ordered and includes
 * unknown/application tags; the typed fields are used for rendering/export.
 */
export interface IDxfHatchData {
  schemaVersion: 1;
  rawTags: Array<{ code: number; value: string | number | boolean }>;
  elevation: { x: number; y: number; z: number };
  extrusion: { x: number; y: number; z: number };
  pattern: {
    name: string;
    solidFill: boolean;
    associative: boolean;
    style: number;
    type: number;
    angle: number;
    scale: number;
    double: boolean;
    definitionLines: IDxfHatchPatternLine[];
  };
  boundaryPaths: Array<IDxfHatchPolylinePath | IDxfHatchEdgePath>;
  pixelSize?: number;
  seedPoints: IPoint[];
  gradient?: IDxfHatchGradient;
  parseWarnings: string[];
}

export class HatchEntity extends Entity {
  /** Raw boundary loops (used when not associative). */
  boundaries: IHatchEdge[][];
  /** IDs of boundary entities â€” populated when `associative` is true. */
  boundaryEntIds: number[] = [];

  /**
   * Phase 3+ boundary specification. When present this is the canonical
   * description of what the hatch covers; legacy `boundaries` /
   * `boundaryEntIds` remain populated in parallel for one release cycle.
   *
   * `null` means the entity was created before Phase 3 (imported DXF or
   * old in-memory hatch) â€” `draw()` falls through to the legacy path.
   */
  boundarySpec: IHatchBoundarySpec | null = null;

  // Pattern definition â€” `pattern`/`scale`/`angle` are the AutoCAD names.
  // Legacy aliases `patternName`/`patternScale`/`patternAngle` proxy to them
  // for backward-compat with the previous TS stub.
  pattern: string;
  scale: number;
  angle: number; // degrees
  solid: boolean;

  // Gradient fields
  gradientType?: 'linear' | 'cylinder' | 'invcylinder' | 'spherical' | 'hemispherical' | 'curved' | 'invspherical' | 'invhemispherical' | 'invcurved';
  gradientColor1?: string;
  gradientColor2?: string;
  gradientAngle?: number;
  gradientShift?: number;
  gradientSingleColor?: boolean;

  get isSolid(): boolean {
    return this.solid || this.pattern === 'SOLID' || !!this.gradientType;
  }

  // Display
  override transparency = 0; // 0..90
  backgroundColor: string | number = 'none';

  // Pattern controls
  patternType: 'Predefined' | 'User-defined' | 'Custom' = 'Predefined';
  doubleHatch = false;
  originX = 0;
  originY = 0;
  originRotation = 0;
  hatchStyle: 'Normal' | 'Outer' | 'Ignore' = 'Normal';
  isoPenWidth = 0.25;
  islandDetection = true;
  patternSpacing = 1;
  associative = true;
  annotative = false;
  /**
   * DXF-embedded pattern definition lines (parsed from groups 78/53/43/44/45/46/79/49).
   * When present, the renderer uses these instead of the built-in HATCH_PATTERNS registry,
   * ensuring custom and user-defined patterns render correctly without manual registration.
   */
  customPatternLines: IDxfHatchPatternLine[] | null = null;

  /** Complete DXF HATCH structure retained across DXF -> JSON -> DXF. */
  dxfHatch: IDxfHatchData | null = null;

  constructor(
    boundariesOrIds: IHatchEdge[][] | number[] = [],
    pattern = 'ANSI31',
    scale = 1,
    angle = 0,
    solid = false,
  ) {
    super('HATCH');
    // Distinguish boundary loops (IHatchEdge[][]) from associative ID arrays
    if (boundariesOrIds.length > 0 && Array.isArray((boundariesOrIds as any)[0])) {
      this.boundaries = boundariesOrIds as IHatchEdge[][];
    } else if (boundariesOrIds.length > 0 && typeof (boundariesOrIds as any)[0] === 'number') {
      this.boundaries = [];
      this.boundaryEntIds = [...(boundariesOrIds as number[])];
    } else {
      this.boundaries = [];
    }
    this.pattern = pattern;
    this.scale = scale;
    this.angle = angle;
    this.solid = !!solid;
  }

  /* ---- legacy aliases (read/write) ---- */
  get patternName() { return this.pattern; }
  set patternName(v: string) { this.pattern = v; }
  get patternScale() { return this.scale; }
  set patternScale(v: number) { this.scale = v; }
  get patternAngle() { return this.angle; }
  set patternAngle(v: number) { this.angle = v; }

  /* ---- computed read-only properties ---- */

  get area(): number {
    // Prefer spec loops when available (outer loop only; islands are subtractive).
    if (this.boundarySpec && !this.boundarySpec.associative) {
      let total = 0;
      for (const loop of this.boundarySpec.loops) {
        const frozen = loop.frozen;
        if (!frozen?.length) continue;
        const pts = [frozen[0].p0, ...frozen.map((e: any) => e.p1)];
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
        }
        total += Math.abs(a) / 2;
      }
      return total;
    }
    if (!this.boundaries?.length) return 0;
    let total = 0;
    for (const loop of this.boundaries) {
      let pts: IPoint[] = [];
      for (const edge of loop) {
        if (edge.start) pts.push(edge.start);
        if (edge.end) pts.push(edge.end);
      }
      pts = pts.filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
      if (pts.length > 2) {
        let loopArea = 0;
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          loopArea += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
        }
        total += Math.abs(loopArea) / 2;
      }
    }
    return total;
  }

  get boundaryCount(): number {
    if (this.boundarySpec) return this.boundarySpec.loops.length;
    return this.boundaries?.length ?? 0;
  }

  get isClosed(): boolean {
    if (this.boundarySpec && !this.boundarySpec.associative) {
      return this.boundarySpec.loops.every((loop) => {
        const f = loop.frozen;
        if (!f?.length) return true;
        const first = f[0].p0;
        const last = f[f.length - 1].p1;
        return Math.hypot(first.x - last.x, first.y - last.y) <= 1e-4;
      });
    }
    if (!this.boundaries?.length) return false;
    for (const loop of this.boundaries) {
      if (!loop.length) continue;
      const first = loop[0].start;
      const last = loop[loop.length - 1].end ?? loop[loop.length - 1].start;
      if (first && last && Math.hypot(first.x - last.x, first.y - last.y) > 1e-4) return false;
    }
    return true;
  }

  get associativityStatus(): string {
    if (this.boundarySpec) {
      return this.boundarySpec.associative && this.boundarySpec.contributingEntityIds.length > 0
        ? 'Yes'
        : 'No';
    }
    return this.associative && this.boundaryEntIds.length > 0 ? 'Yes' : 'No';
  }

  /* ---- draw ---- */

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    // When a boundarySpec is present, it is the authoritative representation.
    // Associative specs resolve entity refs the same way the legacy path did;
    // frozen specs draw directly from stored edge geometry (no entity lookup).
    const spec = this.boundarySpec;
    if (spec) {
      if (!spec.loops.length) return;
    } else {
      const hasEnts = this.boundaryEntIds.length > 0;
      const hasBounds = this.boundaries.length > 0;
      if (!hasEnts && !hasBounds) return;
    }

    const path = new Path2D();

    if (spec) {
      if (spec.associative) {
        // Associative: walk contributing entity outlines (same render path as
        // legacy; Phase 4 will upgrade this to per-anchor curve resolution).
        if (doc?.entities) {
          const bEnts = spec.contributingEntityIds
            .map((id: number) => (doc.entities as Entity[]).find((e: any) => e.id === id))
            .filter(Boolean);
          for (const e of bEnts) this._addEntityToPath(path, e as Entity, vm);
        }
      } else {
        // Frozen: render directly from stored polygon edges, drawing curved
        // edges (arcs / ellipses) as true curves rather than line segments.
        for (const loop of spec.loops) {
          if (!loop.frozen?.length) continue;
          traceFrozenLoopToPath(path, loop.frozen, vm);
          path.closePath();
        }
      }
    } else {
      // ---- Legacy path (no spec) ----

      const hasEnts = this.boundaryEntIds.length > 0;
      const hasBounds = this.boundaries.length > 0;

      // Path from associative boundary entities
      if (this.associative && hasEnts && doc?.entities) {
        const bEnts = this.boundaryEntIds
          .map((id) => doc.entities.find((e: Entity) => e.id === id))
          .filter(Boolean);
        for (const e of bEnts) this._addEntityToPath(path, e, vm);
      }

      // Path from raw boundaries
      if (hasBounds) {
        for (const loop of this.boundaries) {
          if (!loop?.length) continue;
          let started = false;
          for (const edge of loop) {
            this._addEdgeToPath(path, edge, vm, () => started, () => { started = true; });
          }
          path.closePath();
        }
      }
    }

    // Cache the bbox with full document context so pattern rendering has correct bounds.
    this._cachedBBox = this._resolveBoundaryBBox(doc);

    ctx.save();
    const hatchColor = doc?._plotStyle
      ? this.resolvedPlotColor(doc, doc._plotStyle, !!doc._plotLightBg, byBlockColor)
      : this.resolvedDisplayColor(doc, byBlockColor);
    ctx.strokeStyle = hatchColor;
    ctx.fillStyle = hatchColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    if (this.transparency > 0) ctx.globalAlpha = 1 - this.transparency / 100;

    // Background colour fill (drawn first, then pattern on top)
    if (this.backgroundColor && this.backgroundColor !== 'none' && this.backgroundColor !== 'transparent') {
      ctx.save();
      const bg = typeof this.backgroundColor === 'number'
        ? (DXF_ACI_COLORS[this.backgroundColor] ?? '#ffffff')
        : this.backgroundColor;
      this.backgroundColor = bg; // Temporarily update for renderer
      HatchRendererService.drawHatch(ctx, vm, doc, this, hatchColor);
      ctx.restore();
      ctx.restore(); // restore outer save
      return;
    }

    ctx.save();
    HatchRendererService.drawHatch(ctx, vm, doc, this, hatchColor);
    ctx.restore();
    ctx.restore(); // restore outer save
  }

  /** Cached bounding box from the last draw() call; lets external bbox() callers see assoc geometry. */
  private _cachedBBox: IBBox | null = null;

  /** Compute bbox over both raw boundary edges AND associative boundary entities. */
  private _resolveBoundaryBBox(doc: any): IBBox {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const take = (x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    };

    if (this.boundarySpec) {
      const spec = this.boundarySpec;
      if (!spec.associative) {
        // Frozen spec: bbox from sampled edge geometry (curves included).
        for (const loop of spec.loops) {
          for (const p of frozenLoopToPolygon(loop.frozen ?? [])) take(p.x, p.y);
          // Also fold in the exact edge endpoints so open sampling never clips.
          for (const edge of loop.frozen ?? []) {
            take(edge.p0.x, edge.p0.y);
            take(edge.p1.x, edge.p1.y);
          }
        }
      } else if (doc?.entities) {
        // Associative spec: bbox from contributing entity bboxes.
        for (const id of spec.contributingEntityIds) {
          const e = doc.entities.find((x: any) => x.id === id);
          if (!e || typeof e.bbox !== 'function') continue;
          const eb = e.bbox();
          if (!eb) continue;
          take(eb.x, eb.y);
          take(eb.x + eb.w, eb.y + eb.h);
        }
      }
    } else {
      // Legacy path.
      for (const b of this.boundaries) {
        for (const edge of b) {
          const ee = edge as any;
          if (ee.start) take(ee.start.x, ee.start.y);
          if (ee.end) take(ee.end.x, ee.end.y);
          if (Array.isArray(ee.vertices)) for (const v of ee.vertices) take(v.x, v.y);
          if (ee.center && typeof ee.radius === 'number') {
            take(ee.center.x - ee.radius, ee.center.y - ee.radius);
            take(ee.center.x + ee.radius, ee.center.y + ee.radius);
          }
        }
      }
      if (this.associative && this.boundaryEntIds.length && doc?.entities) {
        for (const id of this.boundaryEntIds) {
          const e = doc.entities.find((x: any) => x.id === id);
          if (!e || typeof e.bbox !== 'function') continue;
          const eb = e.bbox();
          if (!eb) continue;
          take(eb.x, eb.y);
          take(eb.x + eb.w, eb.y + eb.h);
        }
      }
    }

    if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** Append a single boundary edge to the active Path2D. */
  private _addEdgeToPath(
    path: Path2D,
    edge: IHatchEdge,
    vm: ViewModelLike,
    isStarted: () => boolean,
    markStarted: () => void,
  ): void {
    const move = (p: IPoint) => {
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
      const pts = tessellateArc(edge.center, edge.radius, edge.startAngle ?? 0, edge.endAngle ?? Math.PI * 2, (edge as any).isCcw !== false);
      for (const p of pts) move(p);
      return;
    }
    const ee = edge as any;
    if (ee.center && (ee.majorAxis || ee.majorAxisEndPoint)) {
      const ma = ee.majorAxis ?? ee.majorAxisEndPoint;
      const rx = Math.hypot(ma.x, ma.y);
      const ry = rx * (ee.axisRatio ?? 1);
      const rot = Math.atan2(ma.y, ma.x);
      const pts = tessellateEllipse(ee.center, rx, ry, rot, ee.startAngle ?? 0, ee.endAngle ?? Math.PI * 2, ee.isCcw !== false);
      for (const p of pts) move(p);
    }
  }

  /** Append a referenced entity's outline to the active Path2D (associative hatch). */
  private _addEntityToPath(path: Path2D, e: any, vm: ViewModelLike): void {
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

  override bbox(): IBBox {
    // For non-associative hatches (frozen geometry stored directly on the entity),
    // always compute fresh from the geometry so the spatial index never gets stale
    // data after explode/transform.  The draw() call still writes _cachedBBox for
    // use by the pattern renderer (which needs the bbox for clip math), but we
    // no longer treat it as the primary source for culling.
    if (!this.boundarySpec?.associative && !this.associative) {
      return this._resolveBoundaryBBox(null);
    }
    // Associative hatch: prefer the draw()-cached bbox (computed with doc context
    // so contributing entity lookups succeed).  Fall back to raw geom on cold call.
    if (this._cachedBBox) return this._cachedBBox;
    return this._resolveBoundaryBBox(null);
  }

  /** Also clear the draw()-cached bbox so the spatial index is forced to
   *  recompute from transformed geometry after an explode/move/grip operation. */
  override refreshCaches(): void {
    this._cachedBBox = null;
    super.refreshCaches(); // bumps revision, clears _bbox / _snapPoints
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const b = this.bbox();
    if (!b || b.w === 0 || b.h === 0) return false;
    const sMin = vm.w2s(b.x, b.y + b.h);
    const sMax = vm.w2s(b.x + b.w, b.y);
    const left = Math.min(sMin.x, sMax.x);
    const right = Math.max(sMin.x, sMax.x);
    const top = Math.min(sMin.y, sMax.y);
    const bottom = Math.max(sMin.y, sMax.y);

    // Quick bbox reject
    if (sx < left - tol || sx > right + tol || sy < top - tol || sy > bottom + tol) return false;

    let polys: IPoint[][] = [];

    if (this.boundarySpec?.loops?.length) {
      polys = this.boundarySpec.loops
        .filter(l => l.frozen?.length)
        .map(l => frozenLoopToPolygon(l.frozen!));
    } else if (this.boundaries?.length) {
      polys = this.boundaries.map(loop => {
        const pts: IPoint[] = [];
        for (const edge of loop) {
          if (edge.start) pts.push(edge.start);
          if (edge.end) pts.push(edge.end);
        }
        return pts.filter((p, idx, arr) => idx === 0 || p.x !== arr[idx - 1].x || p.y !== arr[idx - 1].y);
      }).filter(p => p.length >= 3);
    }

    if (!polys.length) return false;

    // Point-in-polygon test (even-odd fill check for hatch interior)
    let insideCount = 0;
    const wx = vm.s2w(sx, sy).x;
    const wy = vm.s2w(sx, sy).y;
    for (const poly of polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersect = ((yi > wy) !== (yj > wy)) && (wx < (xj - xi) * (wy - yi) / (yj - yi + 1e-30) + xi);
        if (intersect) insideCount++;
      }
    }
    if (insideCount % 2 === 1) return true;

    // Edge proximity test (near boundary lines)
    for (const poly of polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const p1 = vm.w2s(poly[j].x, poly[j].y);
        const p2 = vm.w2s(poly[i].x, poly[i].y);
        if (pointToScreenSegmentDist(sx, sy, p1, p2) <= tol) return true;
      }
    }

    return false;
  }

  override snapPoints(): ISnapPoint[] {
    const b = this.bbox();
    if (!b || b.w === 0 || b.h === 0) return [];
    return [
      { x: b.x + b.w / 2, y: b.y + b.h / 2, label: 'center' },
      { x: b.x, y: b.y, label: 'corner' },
      { x: b.x + b.w, y: b.y + b.h, label: 'corner' },
    ];
  }

  /**
   * Override to deep-clone hatch-specific nested structures that the base
   * Entity.clone() cannot reach with its shallow-object copy:
   *
   *  - `boundarySpec` is a nested object tree (IBoundarySpec â†’ IBoundaryLoop[]
   *    â†’ IFrozenEdge[]) that the base clone assigns BY REFERENCE.  Without
   *    this override ExplodeInsertCmd.transformHatch() would mutate the
   *    original block-definition's hatch spec, corrupting repeated explodes
   *    and undo.
   *
   *  - `customPatternLines` is an array of plain objects â€” already handled by
   *    the base clone's one-level shallow copy, but we re-copy it here for
   *    clarity and future-proofing.
   *
   * `boundaries` (IHatchEdge[][]) is now handled correctly by the fixed base
   * Entity.clone() which deep-clones arrays-of-arrays.
   */
  override clone(): this {
    const fresh = super.clone(); // handles boundaries[], boundaryEntIds[], etc.

    // Deep-clone boundarySpec (nested object tree, not an array).
    if (this.boundarySpec) {
      fresh.boundarySpec = {
        ...this.boundarySpec,
        loops: this.boundarySpec.loops.map((loop) => ({
          ...loop,
          anchors: loop.anchors ? loop.anchors.map((a) => ({ ...a })) : undefined,
          frozen: loop.frozen
            ? loop.frozen.map((f) => ({
              ...f,
              p0: { ...f.p0 },
              p1: { ...f.p1 },
              ...(f.center ? { center: { ...f.center } } : {}),
            }))
            : undefined,
        })),
        contributingEntityIds: [...this.boundarySpec.contributingEntityIds],
        seedPoint: { ...this.boundarySpec.seedPoint },
      };
    }

    // Deep-clone customPatternLines (the base clone shallow-copies the array
    // elements but that's fine for plain scalar objects; this just ensures
    // the array itself is independent).
    if (this.customPatternLines) {
      fresh.customPatternLines = this.customPatternLines.map((l) => ({ ...l, dashArray: [...l.dashArray] }));
    }

    if (this.dxfHatch) {
      // This payload intentionally contains only JSON data (tags, points, and
      // scalar hatch properties), so a structural clone is safe and keeps the
      // clone from sharing editable boundary/pattern arrays with its source.
      fresh.dxfHatch = JSON.parse(JSON.stringify(this.dxfHatch));
    }

    return fresh;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      // GENERAL (additional)
      { key: 'transparency', label: 'Transparency', type: 'number', category: 'General', precision: 0, min: 0, max: 90, step: 5 },
      { key: 'associative', label: 'Associative', type: 'boolean', category: 'General' },
      { key: 'annotative', label: 'Annotative', type: 'boolean', category: 'General' },

      // PATTERN
      { key: 'patternType', label: 'Type', type: 'dropdown', category: 'Pattern' },
      { key: 'pattern', label: 'Pattern Name', type: 'dropdown', category: 'Pattern' },
      { key: 'angle', label: 'Angle', type: 'number', category: 'Pattern', precision: 1, suffix: 'Â°' },
      { key: 'scale', label: 'Scale', type: 'number', category: 'Pattern', precision: 3, min: 0.001, step: 0.1 },
      { key: 'doubleHatch', label: 'Double Hatch', type: 'boolean', category: 'Pattern' },
      { key: 'originX', label: 'Origin X', type: 'number', category: 'Pattern', precision: 3 },
      { key: 'originY', label: 'Origin Y', type: 'number', category: 'Pattern', precision: 3 },
      { key: 'hatchStyle', label: 'Hatch Style', type: 'dropdown', category: 'Pattern' },
      { key: 'isoPenWidth', label: 'ISO Pen Width', type: 'number', category: 'Pattern', precision: 2 },

      // GEOMETRY
      { key: 'area', label: 'Area', type: 'read-only', category: 'Geometry', value: this.area.toFixed(3) },
      { key: 'boundaryCount', label: 'Boundaries', type: 'read-only', category: 'Geometry', value: this.boundaryCount },
      { key: 'islandDetection', label: 'Island Detection', type: 'boolean', category: 'Geometry' },
      { key: 'associativityStatus', label: 'Associativity', type: 'read-only', category: 'Geometry', value: this.associativityStatus },
      { key: 'isClosed', label: 'Closed', type: 'read-only', category: 'Geometry', value: this.isClosed ? 'Yes' : 'No' },
      { key: 'patternSpacing', label: 'Spacing', type: 'number', category: 'Geometry', precision: 3, min: 0.001 },

      // DISPLAY
      { key: 'solid', label: 'Solid Fill', type: 'boolean', category: 'Display' },
      { key: 'backgroundColor', label: 'Background Color', type: 'color', category: 'Display' },
    ];
  }

  override applyPropertyChange(key: string, value: any): void {
    switch (key) {
      case 'scale':
        this.scale = Math.max(0.001, parseFloat(value) || 1);
        break;
      case 'angle':
        this.angle = parseFloat(value) || 0;
        break;
      case 'solid':
        this.solid = !!value;
        break;
      case 'doubleHatch':
        this.doubleHatch = !!value;
        break;
      case 'associative':
        this.associative = !!value;
        break;
      case 'annotative':
        this.annotative = !!value;
        break;
      case 'islandDetection':
        this.islandDetection = !!value;
        break;
      case 'transparency':
        this.transparency = Math.max(0, Math.min(90, parseFloat(value) || 0));
        break;
      case 'originX':
        this.originX = parseFloat(value) || 0;
        break;
      case 'originY':
        this.originY = parseFloat(value) || 0;
        break;
      case 'isoPenWidth':
        this.isoPenWidth = Math.max(0, parseFloat(value) || 0.25);
        break;
      case 'patternSpacing':
        this.patternSpacing = Math.max(0.001, parseFloat(value) || 1);
        break;
      case 'pattern':
      case 'patternType':
      case 'hatchStyle':
      case 'backgroundColor':
        (this as any)[key] = value;
        break;
      default:
        super.applyPropertyChange(key, value);
        return;
    }
    this.refreshCaches();
  }
}

function tessellateArc(center: { x: number; y: number }, radius: number, startRad: number, endRad: number, ccw: boolean, segments = 32): { x: number; y: number }[] {
  let sweep = endRad - startRad;
  if (ccw && sweep < 0) sweep += Math.PI * 2;
  if (!ccw && sweep > 0) sweep -= Math.PI * 2;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = startRad + sweep * (i / segments);
    out.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return out;
}

function tessellateEllipse(center: { x: number; y: number }, rx: number, ry: number, rotation: number, startRad: number, endRad: number, ccw: boolean, segments = 48): { x: number; y: number }[] {
  let sweep = endRad - startRad;
  if (ccw && sweep < 0) sweep += Math.PI * 2;
  if (!ccw && sweep > 0) sweep -= Math.PI * 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = startRad + sweep * (i / segments);
    const lx = rx * Math.cos(t);
    const ly = ry * Math.sin(t);
    out.push({ x: center.x + lx * cos - ly * sin, y: center.y + lx * sin + ly * cos });
  }
  return out;
}

/* ---- INSERT (block reference) ---- */
export class InsertEntity extends Entity {
  blockName: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  rotation: number; // degrees
  attribs: IAttrib[] = [];

  /** Cached reference to the block definition. Set at import time and by
   *  commands that create INSERT entities. Avoids passing `doc` into bbox(). */
  _blockDef: any | null = null;

  constructor(blockName: string, x: number, y: number, sx = 1, sy = 1, rotation = 0) {
    super('INSERT');
    this.blockName = blockName;
    this.x = x;
    this.y = y;
    this.sx = sx;
    this.sy = sy;
    this.rotation = rotation;
  }

  /** Transform a point from block-local coords to world coords. */
  private _transformPt(lx: number, ly: number, bp: { x: number; y: number }): { x: number; y: number } {
    const rad = (this.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const sxLocal = (lx - bp.x) * this.sx;
    const syLocal = (ly - bp.y) * this.sy;
    return {
      x: this.x + (sxLocal * cos - syLocal * sin),
      y: this.y + (sxLocal * sin + syLocal * cos),
    };
  }

  /** Build a proxy ViewModel that maps block-local coords through the INSERT transform. */
  private _buildInsertVm(vm: ViewModelLike, def: any): any {
    const bp = def.basePoint ?? { x: 0, y: 0 };
    const rad = (this.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const tx = this.x;
    const ty = this.y;
    const sx = this.sx;
    const sy = this.sy;

    return {
      scale: vm.scale,
      cumulativeScale: (vm.cumulativeScale ?? vm.scale) * ((Math.abs(sx) + Math.abs(sy)) / 2),
      w2s: (lx: number, ly: number) => {
        const sxLocal = (lx - bp.x) * sx;
        const syLocal = (ly - bp.y) * sy;
        const wx = tx + (sxLocal * cos - syLocal * sin);
        const wy = ty + (sxLocal * sin + syLocal * cos);
        return vm.w2s(wx, wy);
      },
      s2w: (screenX: number, screenY: number) => {
        const w = vm.s2w(screenX, screenY);
        return { x: w.x, y: w.y };
      },
    };
  }

  /** Resolve the block definition from either the cached ref or doc. */
  private _resolveDef(doc?: any): any {
    if (this._blockDef) return this._blockDef;
    if (doc?.blocks) return doc.blocks.get(this.blockName) ?? null;
    return null;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, _byBlockColor: string | null = null): void {
    if (!doc || !doc.blocks) return;
    const def = doc.blocks.get(this.blockName);
    if (!def) return;

    const insertVm = this._buildInsertVm(vm, def);

    for (const child of def.entities ?? []) {
      if (!child.visible) continue;
      ctx.save();
      child.draw(ctx, insertVm, doc, this.color);
      ctx.restore();
    }

    // Draw visible attribute text
    for (const att of this.attribs) {
      if (att.invisible) continue;
      const wp = this._transformPt(att.x, att.y, def.basePoint ?? { x: 0, y: 0 });
      const s = vm.w2s(wp.x, wp.y);
      const scaleFactor = (att as any).isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1;
      const fontSize = att.height * scaleFactor * vm.scale * this.sy;
      ctx.save();
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = this.resolvedColor?.(vm as any, doc) ?? this.color ?? '#cdd6f4';
      ctx.textBaseline = 'bottom';
      if (att.rotation || this.rotation) {
        ctx.translate(s.x, s.y);
        ctx.rotate(-((att.rotation + this.rotation) * Math.PI) / 180);
        ctx.fillText(att.value, 0, 0);
      } else {
        ctx.fillText(att.value, s.x, s.y);
      }
      ctx.restore();
    }
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const def = this._resolveDef();
    if (!def?.entities?.length) {
      // Fallback: test insertion point only
      const s = vm.w2s(this.x, this.y);
      return Math.hypot(sx - s.x, sy - s.y) <= tol;
    }
    const insertVm = this._buildInsertVm(vm, def);
    for (const child of def.entities) {
      if (!child.visible) continue;
      if (typeof child.hitTest === 'function' && child.hitTest(sx, sy, insertVm, tol)) return true;
    }
    // Also test the bbox envelope as a fallback for entity types with no hitTest
    const b = this.bbox();
    if (b && b.w > 0 && b.h > 0) {
      const sMin = vm.w2s(b.x, b.y + b.h);
      const sMax = vm.w2s(b.x + b.w, b.y);
      const left = Math.min(sMin.x, sMax.x) - tol;
      const right = Math.max(sMin.x, sMax.x) + tol;
      const top = Math.min(sMin.y, sMax.y) - tol;
      const bottom = Math.max(sMin.y, sMax.y) + tol;
      if (sx >= left && sx <= right && sy >= top && sy <= bottom) return true;
    }
    return false;
  }

  override snapPoints(): ISnapPoint[] {
    const pts: ISnapPoint[] = [{ x: this.x, y: this.y, label: 'insertion' }];
    const def = this._resolveDef();
    if (!def?.entities) return pts;
    const bp = def.basePoint ?? { x: 0, y: 0 };
    for (const child of def.entities) {
      if (!child.visible) continue;
      if (typeof child.snapPoints !== 'function') continue;
      for (const sp of child.snapPoints()) {
        const t = this._transformPt(sp.x, sp.y, bp);
        pts.push({ x: t.x, y: t.y, label: sp.label });
      }
    }
    return pts;
  }

  override bbox(): IBBox {
    if (this._bbox) return this._bbox;
    const def = this._resolveDef();
    if (!def?.entities?.length) {
      return { x: this.x - 1, y: this.y - 1, w: 2, h: 2 };
    }
    const bp = def.basePoint ?? { x: 0, y: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let valid = false;
    for (const child of def.entities) {
      const cb = typeof child.bbox === 'function' ? child.bbox() : null;
      if (!cb || !Number.isFinite(cb.x + cb.y + cb.w + cb.h)) continue;
      // Transform all 4 corners of child bbox
      const corners = [
        this._transformPt(cb.x, cb.y, bp),
        this._transformPt(cb.x + cb.w, cb.y, bp),
        this._transformPt(cb.x, cb.y + cb.h, bp),
        this._transformPt(cb.x + cb.w, cb.y + cb.h, bp),
      ];
      for (const c of corners) {
        if (c.x < minX) minX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.x > maxX) maxX = c.x;
        if (c.y > maxY) maxY = c.y;
        valid = true;
      }
    }
    if (!valid) return { x: this.x - 1, y: this.y - 1, w: 2, h: 2 };
    this._bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    return this._bbox;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    const schema = [
      ...super.getPropertiesSchema(),
      { key: 'blockName', label: 'Block Name', type: 'read-only', category: 'Block', value: this.blockName },
      { key: 'x', label: 'Position X', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'y', label: 'Position Y', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'sx', label: 'Scale X', type: 'number', category: 'Geometry', precision: 3, step: 0.1 },
      { key: 'sy', label: 'Scale Y', type: 'number', category: 'Geometry', precision: 3, step: 0.1 },
      { key: 'rotation', label: 'Rotation', type: 'number', category: 'Geometry', precision: 1, suffix: 'Â°', step: 1 },
    ] as IPropertySchema[];
    for (let i = 0; i < this.attribs.length; i++) {
      const att = this.attribs[i];
      schema.push({
        key: `_attrib_${i}`,
        label: att.tag,
        type: 'text',
        category: 'Attributes',
        value: att.value,
      } as any);
    }
    return schema;
  }

  override applyPropertyChange(key: string, value: any): void {
    if (key.startsWith('_attrib_')) {
      const idx = parseInt(key.substring(8), 10);
      if (idx >= 0 && idx < this.attribs.length) {
        this.attribs[idx].value = String(value);
        this._bbox = null;
      }
      return;
    }
    super.applyPropertyChange(key, value);
    this._bbox = null;
  }
}

/* ---- XLINE (infinite construction line) ---- */
export class XLineEntity extends Entity {
  x: number;
  y: number;
  angle: number; // radians

  /**
   * Distance (world units) from base to the direction-control grip.
   * Large enough to survive moderate zoom changes; the grip is a
   * purely UI artifact â€” the infinite line itself has no "second end".
   */
  static readonly DIR_GRIP_DIST = 10;

  constructor(x: number, y: number, angle = 0) {
    super('XLINE');
    this.x = x;
    this.y = y;
    this.angle = angle;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    const L = 1e6;
    const dx = Math.cos(this.angle) * L;
    const dy = Math.sin(this.angle) * L;
    const a = vm.w2s(this.x - dx, this.y - dy);
    const b = vm.w2s(this.x + dx, this.y + dy);
    this.setupContext(ctx, vm, doc, byBlockColor);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  /**
   * Hit-test against the INFINITE line, not just the base point.
   * Computes the perpendicular screen-space distance from (sx, sy) to the
   * line passing through the base point with the stored angle. Returns true
   * when that distance is within `tol` pixels â€” matching AutoCAD's own
   * pick-box tolerance for XLINE selection.
   */
  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    // Base point in screen space.
    const b = vm.w2s(this.x, this.y);
    // Unit direction in screen space (canvas: Y grows downward, so flip sin).
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const scale = vm.scale ?? 1;
    const ddx = cos * scale;
    const ddy = -sin * scale;
    const len2 = ddx * ddx + ddy * ddy;
    if (len2 < 1e-12) return Math.hypot(sx - b.x, sy - b.y) <= tol;
    // Perpendicular distance = |cross product of (cursor-base) and unit dir|
    const ex = sx - b.x;
    const ey = sy - b.y;
    const cross = Math.abs(ex * ddy - ey * ddx);
    return cross / Math.sqrt(len2) <= tol;
  }

  /**
   * Two grip points:
   *   1. Base point â€” the defining anchor (move translates the whole line)
   *   2. Direction handle â€” 10 world units along the angle (drag rotates)
   */
  override snapPoints(): ISnapPoint[] {
    const L = XLineEntity.DIR_GRIP_DIST;
    return [
      { x: this.x, y: this.y, label: 'basepoint' },
      { x: this.x + Math.cos(this.angle) * L, y: this.y + Math.sin(this.angle) * L, label: 'direction' },
    ];
  }

  /**
   * bbox() intentionally returns a tiny stub â€” XLINEs are excluded from
   * zoom-extents (view-model.service.ts documents this explicitly) because
   * they are infinite. Window/crossing selection uses dedicated logic in
   * select-tool.ts instead of relying on bbox.
   */
  override bbox(): IBBox {
    return { x: this.x - 1, y: this.y - 1, w: 2, h: 2 };
  }

  /** Angle in degrees (read-only derived â€” exposed to Properties Panel). */
  get angleDeg(): number {
    return ((this.angle * 180) / Math.PI + 360) % 360;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'x', label: 'Base X', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'y', label: 'Base Y', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'angleDeg', label: 'Angle', type: 'number', category: 'Geometry', precision: 2, suffix: 'Â°', step: 1 },
    ];
  }

  override applyPropertyChange(key: string, value: any): void {
    if (key === 'angleDeg') {
      this.angle = (parseFloat(value) * Math.PI) / 180;
    } else {
      super.applyPropertyChange(key, value);
    }
    this.refreshCaches();
  }
}

/* ---- LEADER ---- */
export class LeaderEntity extends Entity {
  pts: IPoint[];
  text: string;
  height: number;

  // Text style â€” shared shape with TextEntity so the universal text editor
  // (TextEditorOverlayComponent) can edit Leader annotation text using the
  // same toolbar / textarea path it uses for TEXT/MTEXT.
  font = 'Arial';
  bold = false;
  italic = false;
  underline = false;
  strikethrough = false;
  textColor: string | null = null;
  lineSpacing = 1.2;
  textRotationOverride: number | null = null;

  get textRotationOverrideDeg(): number | null {
    return this.textRotationOverride == null ? null : this.textRotationOverride * 180 / Math.PI;
  }
  set textRotationOverrideDeg(deg: number | null) {
    if (deg == null || deg === '' as any) {
      this.textRotationOverride = null;
    } else {
      const d = Number(deg);
      if (Number.isFinite(d)) this.textRotationOverride = d * Math.PI / 180;
    }
  }

  // Leader-specific geometry.
  attachmentSide: 'left' | 'right' = 'right';
  landingLength = 4;
  arrowSize = 2.5;
  arrowAspect = 3;
  /**
   * Arrowhead style. Same vocabulary as DimensionEntity so a single
   * `drawArrowHead()` call renders both, and the properties panel reuses
   * the same dropdown options.
   */
  arrowType: DimArrowType = 'closed';
  anchor?: { entityId: number; snapIndex: number };

  constructor(pts: IPoint[], text = '', height = 2.5) {
    super('LEADER');
    this.pts = pts.map((p: any) => ({ x: p.x, y: p.y }));
    this.text = text;
    this.height = height;
  }

  /** Landing endpoint (last polyline vertex offset by landingLength along attachmentSide). */
  landingEnd(): IPoint {
    if (!this.pts.length) return { x: 0, y: 0 };
    const last = this.pts[this.pts.length - 1];
    const dir = this.attachmentSide === 'right' ? 1 : -1;
    return { x: last.x + dir * this.landingLength, y: last.y };
  }

  /** World-space text insertion point (small pad past landing end). */
  textInsertion(): IPoint {
    const end = this.landingEnd();
    const dir = this.attachmentSide === 'right' ? 1 : -1;
    const pad = this.height * 0.25;
    return { x: end.x + dir * pad, y: end.y };
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    if (this.pts.length < 2) return;
    this.setupContext(ctx, vm, doc, byBlockColor);

    // 1. Polyline (arrow tip â†’ bend â†’ ... â†’ last vertex) + auto landing line.
    ctx.beginPath();
    const p0 = vm.w2s(this.pts[0].x, this.pts[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < this.pts.length; i++) {
      const p = vm.w2s(this.pts[i].x, this.pts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    const end = this.landingEnd();
    const sEnd = vm.w2s(end.x, end.y);
    ctx.lineTo(sEnd.x, sEnd.y);
    ctx.stroke();

    // 2. Arrowhead at pts[0], pointing along pts[0] â†’ pts[1] (in screen space).
    const a = vm.w2s(this.pts[0].x, this.pts[0].y);
    const b = vm.w2s(this.pts[1].x, this.pts[1].y);
    const adx = b.x - a.x;
    const ady = b.y - a.y;
    const aLen = Math.hypot(adx, ady);
    if (aLen > 1e-6) {
      const arrowPx = this.arrowSize * vm.scale;
      drawArrowHead(ctx, a, adx / aLen, ady / aLen, arrowPx, this.arrowType, this.arrowAspect);
    }

    // 3. Annotation text â€” anchored at textInsertion(), middle-baseline,
    //    horiz align follows attachmentSide. Mirrors TextEntity.draw() so the
    //    universal TextEditor's positioning math lines up with what we render.
    if (this.text && this.text.length) {
      const ins = this.textInsertion();
      const sIns = vm.w2s(ins.x, ins.y);
      const scaleFactor = (this as any).isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1;
      const hPx = this.height * scaleFactor * (vm.cumulativeScale ?? vm.scale) * (4 / 3);
      const style = this.italic ? 'italic ' : '';
      const weight = this.bold ? 'bold ' : '';
      ctx.font = `${style}${weight}${hPx}px ${this.font}`;

      ctx.save();
      ctx.translate(sIns.x, sIns.y);
      if (this.textRotationOverride != null) {
        ctx.rotate(-this.textRotationOverride);
      }
      ctx.textBaseline = 'middle';
      ctx.textAlign = this.attachmentSide === 'right' ? 'left' : 'right';

      const prevFill = ctx.fillStyle;
      if (this.textColor) ctx.fillStyle = this.textColor;

      const lines = this.text.split(/\\P|\n/);
      const lineDy = hPx * this.lineSpacing;
      const N = lines.length;
      const blockY = -((N - 1) * lineDy) / 2;

      for (let i = 0; i < N; i++) {
        const line = lines[i];
        const ly = blockY + i * lineDy;
        ctx.fillText(line, 0, ly);

        if ((this.underline || this.strikethrough) && line.length) {
          const w = ctx.measureText(line).width;
          const lx = this.attachmentSide === 'right' ? 0 : -w;
          ctx.save();
          ctx.strokeStyle = ctx.fillStyle as string;
          ctx.lineWidth = Math.max(1, hPx * 0.06);
          ctx.setLineDash([]);
          if (this.underline) {
            ctx.beginPath();
            ctx.moveTo(lx, ly + hPx * 0.45);
            ctx.lineTo(lx + w, ly + hPx * 0.45);
            ctx.stroke();
          }
          if (this.strikethrough) {
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(lx + w, ly);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
      ctx.fillStyle = prevFill;
      ctx.restore();
    }
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    if (this.pts.length < 2) return false;
    // 1. Test polyline segments (including landing)
    const pts = [...this.pts, this.landingEnd()];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = vm.w2s(pts[i].x, pts[i].y);
      const b = vm.w2s(pts[i + 1].x, pts[i + 1].y);
      if (pointToScreenSegmentDist(sx, sy, a, b) <= tol) return true;
    }
    // 2. Test text bounding box
    if (this.text && this.text.length) {
      const ins = this.textInsertion();
      const sIns = vm.w2s(ins.x, ins.y);
      const scaleFactor = (this as any).isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1;
      const hPx = this.height * scaleFactor * (vm.cumulativeScale ?? vm.scale) * (4 / 3);
      // Approximation for text bbox using character count
      const approxWidth = this.text.length * hPx * 0.6;
      const left = this.attachmentSide === 'right' ? sIns.x : sIns.x - approxWidth;
      const right = this.attachmentSide === 'right' ? sIns.x + approxWidth : sIns.x;
      const top = sIns.y - hPx;
      const bottom = sIns.y + hPx;
      if (sx >= left - tol && sx <= right + tol && sy >= top - tol && sy <= bottom + tol) return true;
    }
    return false;
  }

  override snapPoints(): ISnapPoint[] {
    const sp = this.pts.map((p, i) => ({ x: p.x, y: p.y, label: i === 0 ? 'arrowhead' : 'vertex' }));
    const end = this.landingEnd();
    sp.push({ x: end.x, y: end.y, label: 'landing' });
    return sp;
  }

  override bbox(): IBBox {
    if (!this.pts.length) return { x: 0, y: 0, w: 0, h: 0 };
    const end = this.landingEnd();
    const xs = [...this.pts.map((p: any) => p.x), end.x];
    const ys = [...this.pts.map((p: any) => p.y), end.y];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'text', label: 'Text', type: 'text', category: 'Text' },
      {
        key: 'font', label: 'Font', type: 'dropdown', category: 'Text',
        options: ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'sans-serif', 'serif', 'monospace']
      },
      { key: 'height', label: 'Height', type: 'number', category: 'Text', precision: 2, step: 0.5, min: 0.001 },
      { key: 'bold', label: 'Bold', type: 'boolean', category: 'Text' },
      { key: 'italic', label: 'Italic', type: 'boolean', category: 'Text' },
      { key: 'underline', label: 'Underline', type: 'boolean', category: 'Text' },
      { key: 'textRotationOverrideDeg', label: 'Text Rotation', type: 'text-rotation', category: 'Text', precision: 1, suffix: 'Â°' },
      { key: 'lineSpacing', label: 'Line Spacing', type: 'number', category: 'Text', precision: 2, step: 0.1, min: 0.5 },
      { key: 'landingLength', label: 'Landing Length', type: 'number', category: 'Leader', precision: 2, step: 0.5, min: 0 },
      {
        key: 'arrowType', label: 'Arrow Type', type: 'dropdown', category: 'Leader',
        options: ['closed', 'open', 'tick', 'dot', 'none']
      },
      { key: 'arrowSize', label: 'Arrow Size', type: 'number', category: 'Leader', precision: 2, step: 0.5, min: 0.001 },
      { key: 'arrowAspect', label: 'Arrow Aspect', type: 'number', category: 'Leader', precision: 1, step: 0.1, min: 0.1 },
    ];
  }

  override applyPropertyChange(key: string, value: any): void {
    if (key === 'textRotationOverrideDeg') {
      this.textRotationOverrideDeg = value;
      this.refreshCaches();
      return;
    }
    (this as any)[key] = value;
    this.refreshCaches();
  }
}

/* ---- DIMENSION ---- */
import { formatDimensionLength, type DimUnitFormat } from '../utils/dimension-units';
import { DimensionStyle, DEFAULT_DIM_STYLE, type DimArrowType, type IDimAnchor } from './dimension-style.model';

export type { DimArrowType };

/**
 * Linear (aligned) dimension.
 *
 * Geometry is defined by three points:
 *   - `p1`, `p2`  â€” the two measurement origins (extension-line bases)
 *   - `dimLinePoint` â€” any world point that lies on the dimension line; its
 *     perpendicular projection from the p1-p2 axis determines the dim-line
 *     offset AND which side of the measurement the dimension is drawn on.
 *
 * Per-entity style fields exist now so each dimension is independently
 * configurable. Step 3 of the annotation roadmap moves these onto a shared
 * `DimensionStyle` document object referenced by name.
 */
export class DimensionEntity extends Entity {
  p1: IPoint;
  p2: IPoint;
  /** Any point on the dimension line; its perpendicular projection sets the offset + side. */
  dimLinePoint: IPoint;

  /** Rotation angle in radians for linear dimensions. If null, it is an aligned dimension. */
  rotation: number | null = null;

  /**
   * Name of the DimensionStyle to consult on `DxfFile.dimStyles`. If the style
   * is missing or `doc` doesn't expose one, falls back to DEFAULT_DIM_STYLE.
   */
  styleName = 'Standard';

  /**
   * Per-entity style overrides. `null` â†’ inherit from the named style.
   * AutoCAD calls these "dimension overrides"; setting any non-null value here
   * wins over the style without modifying the style itself.
   */
  arrowSize: number | null = null;
  arrowAspect: number | null = null;
  arrowType: DimArrowType | null = null;
  textHeight: number | null = null;
  textOffset: number | null = null;
  extensionGap: number | null = null;
  extensionPast: number | null = null;
  unitFormat: DimUnitFormat | null = null;
  unitPrecision: number | null = null;
  unitPrefix: string | null = null;
  unitSuffix: string | null = null;
  decimalSeparator: '.' | ',' | null = null;
  suppressTrailingZeros: boolean | null = null;
  roundOff: number | null = null;

  /**
   * When true, the text is drawn on the opposite side of the dimension line
   * from where it would normally appear. Matches AutoCAD's "Flip Text" feature.
   * Persists through save, load, copy, undo, and redo.
   */
  textFlipped = false;
  textAlongOffset: number | null = null;

  /**
   * Per-entity text placement override. `null` â†’ inherit from named style.
   *
   *   'auto'    â†’ smart: inside when space permits, outside with jog leader otherwise
   *   'inside'  â†’ always between extension lines
   *   'outside' â†’ always outside extension lines with jog leader
   *   'above'   â†’ centred above the dim line (offset = 0 on perpendicular axis)
   */
  textPlacement: DimTextPlacement | null = null;

  /**
   * Display text override. `null` â†’ use formatted measured length.
   * If non-null, any literal `<>` substring is replaced with the formatted
   * measurement (matches AutoCAD's DIMTAD/Mtext placeholder convention).
   */
  textOverride: string | null = null;
  textRotationOverride: number | null = null;

  get textRotationOverrideDeg(): number | null {
    return this.textRotationOverride == null ? null : this.textRotationOverride * 180 / Math.PI;
  }
  set textRotationOverrideDeg(deg: number | null) {
    if (deg == null || deg === '' as any) {
      this.textRotationOverride = null;
    } else {
      const d = Number(deg);
      if (Number.isFinite(d)) this.textRotationOverride = d * Math.PI / 180;
    }
  }

  override getMeasurementText(doc: DocLike): string {
    const s = this._resolveStyle(doc);
    return formatDimensionLength(this.length, {
      format: this.unitFormat ?? s.unitFormat,
      precision: this.unitPrecision ?? s.unitPrecision,
      prefix: this.unitPrefix ?? s.unitPrefix,
      suffix: this.unitSuffix ?? s.unitSuffix,
      decimalSeparator: this.decimalSeparator ?? s.decimalSeparator,
      suppressTrailingZeros: this.suppressTrailingZeros ?? s.suppressTrailingZeros,
      roundOff: this.roundOff ?? s.roundOff,
    });
  }

  get text(): string {
    return this.textOverride ?? '<>';
  }
  set text(val: string) {
    if (!val || val === '<>') {
      this.textOverride = null;
    } else {
      this.textOverride = val;
    }
  }

  /**
   * Associative anchors. When set, p1/p2 are re-resolved from the source
   * entity's snap point on every render â€” editing the source updates this
   * dimension live. `null` â†’ static (non-associative); p1/p2 are authoritative.
   */
  anchor1: IDimAnchor | null = null;
  anchor2: IDimAnchor | null = null;

  /**
   * If true, this dimension is annotative. Its visual sizes (text height, arrow size)
   * are dynamically scaled by `1 / vm.annoScale` to maintain consistent paper size.
   */
  isAnnotative = false;

  constructor(p1: IPoint, p2: IPoint, dimLinePoint?: IPoint) {
    super('DIMENSION');
    this.p1 = { x: p1.x, y: p1.y };
    this.p2 = { x: p2.x, y: p2.y };
    this.dimLinePoint = dimLinePoint
      ? { x: dimLinePoint.x, y: dimLinePoint.y }
      : defaultDimLinePoint(p1, p2);
  }

  get length(): number {
    if (this.rotation !== null) {
      const ux = Math.cos(this.rotation);
      const uy = Math.sin(this.rotation);
      return Math.abs((this.p2.x - this.p1.x) * ux + (this.p2.y - this.p1.y) * uy);
    }
    return Math.hypot(this.p2.x - this.p1.x, this.p2.y - this.p1.y);
  }

  /** Backwards-compat read accessor: signed perpendicular distance to the dim line. */
  get offset(): number {
    const f = this._frame();
    if (!f) return 0;
    const ox = this.dimLinePoint.x - this.p1.x;
    const oy = this.dimLinePoint.y - this.p1.y;
    return ox * f.nx + oy * f.ny;
  }

  /**
   * If anchors are set, look up the source entity's snap point and copy that
   * world coord onto p1/p2. Source-entity edits (move, stretch, grip-drag,
   * undo, redo) propagate to this dimension on the next render.
   *
   * If the source entity is gone (deleted, undone, on a different file), the
   * anchor is silently ignored and the dimension keeps its last good p1/p2 â€”
   * "graceful orphan" behavior. We do NOT auto-clear the anchor here, so a
   * subsequent undo that restores the source will re-engage the link.
   */
  private _resolveAnchors(doc: any): void {
    if (!this.anchor1 && !this.anchor2) return;
    let entities: any[] | undefined;
    if (doc?.entities && Array.isArray(doc.entities)) entities = doc.entities;
    else if (doc?.activeFile?.entities && Array.isArray(doc.activeFile.entities)) entities = doc.activeFile.entities;
    if (!entities) return;

    const resolve = (anchor: IDimAnchor): IPoint | null => {
      const ent = entities!.find((e: any) => e && e.id === anchor.entityId);
      if (!ent || typeof ent.snapPoints !== 'function') return null;
      const pts = ent.snapPoints();
      const pt = pts[anchor.snapIndex];
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
      return { x: pt.x, y: pt.y };
    };

    if (this.anchor1) {
      const w = resolve(this.anchor1);
      if (w) { this.p1.x = w.x; this.p1.y = w.y; }
    }
    if (this.anchor2) {
      const w = resolve(this.anchor2);
      if (w) { this.p2.x = w.x; this.p2.y = w.y; }
    }
  }

  /**
   * Resolve which `DimensionStyle` applies to this entity. The `doc` arg from
   * the render pipeline can be either the `DxfFile` (drawAll path) or the
   * `DocumentService` (preview/snapshot path), so probe both.
   */
  private _resolveStyle(doc: any): DimensionStyle {
    if (!doc) return DEFAULT_DIM_STYLE;
    if (doc.dimStyles instanceof Map) {
      return doc.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    }
    if (doc.activeFile?.dimStyles instanceof Map) {
      return doc.activeFile.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    }
    return DEFAULT_DIM_STYLE;
  }

  /**
   * Resolve effective property value for display in the Properties Panel.
   * For nullable per-entity override fields, resolve through:
   *   1. Entity override (if non-null) â†’ use it directly
   *   2. Dynamic length-based sizing (for arrowSize, textHeight, textOffset, etc.)
   *   3. Named DimensionStyle fallback
   * This ensures the panel never shows empty inputs for dimension properties.
   */
  override getEffectivePropertyValue(key: string, doc?: any): any {
    const raw = (this as any)[key];

    // Keys that cascade through the dimension style
    const STYLE_KEYS = [
      'arrowSize', 'arrowAspect', 'arrowType', 'textHeight', 'textOffset',
      'extensionGap', 'extensionPast',
      'unitFormat', 'unitPrecision', 'unitPrefix', 'unitSuffix',
      'decimalSeparator', 'suppressTrailingZeros', 'roundOff',
      'textPlacement',
    ];

    if (raw !== null && raw !== undefined) return raw;

    if (!STYLE_KEYS.includes(key)) {
      // textOverride: null means "use measured length" â†’ show empty (user clears to reset)
      if (key === 'textOverride') return '';
      return raw;
    }

    // Resolve through style cascade
    const s = this._resolveStyle(doc);

    // Dynamic length-based sizing (matches draw() logic)
    const len = this.length;
    const dynamicSize = s.textHeight;
    const dynamicArrow = s.arrowSize;
    const dynamicArrowAspect = (s as any).arrowAspect ?? 3;

    switch (key) {
      case 'arrowSize': return dynamicArrow;
      case 'arrowAspect': return dynamicArrowAspect;
      case 'textHeight': return dynamicSize;
      case 'textOffset': return s.textOffset;
      case 'extensionGap': return s.extensionGap;
      case 'extensionPast': return s.extensionPast;
      case 'textPlacement': return s.textPlacement ?? 'auto';
      default: return (s as any)[key];
    }
  }

  /** Compute the orthonormal frame (u along p1->p2, n perpendicular CCW). Returns null if degenerate. */
  private _frame(): { ux: number; uy: number; nx: number; ny: number; len: number } | null {
    if (this.rotation !== null) {
      const ux = Math.cos(this.rotation);
      const uy = Math.sin(this.rotation);
      const dx = this.p2.x - this.p1.x;
      const dy = this.p2.y - this.p1.y;
      const len = dx * ux + dy * uy;
      let finalUx = ux;
      let finalUy = uy;
      if (len < 0) {
        finalUx = -ux;
        finalUy = -uy;
      }
      const finalLen = Math.abs(len);
      if (finalLen < 1e-9) return null;
      return { ux: finalUx, uy: finalUy, nx: -finalUy, ny: finalUx, len: finalLen };
    }
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const ux = dx / len, uy = dy / len;
    return { ux, uy, nx: -uy, ny: ux, len };
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    // Pull live positions from source entities BEFORE computing the frame.
    this._resolveAnchors(doc);

    const f = this._frame();
    if (!f) return;

    // Resolve effective style: per-entity override > named style > built-in fallback.
    const s = this._resolveStyle(doc);

    // Auto-scale defaults based on dimension length, ensuring minimum legibility.
    const dynamicSize = s.textHeight;
    const dynamicArrow = s.arrowSize;

    let arrowSize = this.arrowSize ?? dynamicArrow;
    let arrowAspect = this['arrowAspect'] ?? (s as any).arrowAspect ?? 3;
    const arrowType = this.arrowType ?? s.arrowType;
    let textHeight = this.textHeight ?? dynamicSize;
    let padding = this.textOffset ?? s.textOffset ?? 1.0;
    let extensionGap = this.extensionGap ?? s.extensionGap;
    let extensionPast = this.extensionPast ?? s.extensionPast;
    const textPlacement = this.textPlacement ?? s.textPlacement ?? 'auto';

    // â”€â”€ Annotative & Global Scaling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // If marked annotative, we inverse-scale by the current annotation scale
    // (either the Viewport camScale, or CANNOSCALE in model space).
    // Otherwise, we scale by the style's globalScale (DIMSCALE).
    let isAnnotative = this.isAnnotative ?? (s as any).annotative;
    if (isAnnotative) {
      let aScale = (vm as any).annoScale;
      if (typeof aScale !== 'number' || aScale <= 0) {
        aScale = 1.0;
      }
      const scaleMultiplier = 1 / aScale;
      arrowSize *= scaleMultiplier;
      textHeight *= scaleMultiplier;
      padding *= scaleMultiplier;
      extensionGap *= scaleMultiplier;
      extensionPast *= scaleMultiplier;
    } else {
      const globalScale = (s as any).globalScale ?? 1.0;
      if (globalScale > 0 && globalScale !== 1.0) {
        arrowSize *= globalScale;
        textHeight *= globalScale;
        padding *= globalScale;
        extensionGap *= globalScale;
        extensionPast *= globalScale;
      }
    }

    // Signed perpendicular distance from p1â€“p2 axis to the dim line.
    const ox = this.dimLinePoint.x - this.p1.x;
    const oy = this.dimLinePoint.y - this.p1.y;
    const signedOffset = ox * f.nx + oy * f.ny;
    const side = signedOffset >= 0 ? 1 : -1;
    const ex = f.nx * side; // extension-line direction (perpendicular, away from measured pts)
    const ey = f.ny * side;

    // World-space anchors for dim-line endpoints and extension lines.
    const dimP1 = { x: this.p1.x + signedOffset * f.nx, y: this.p1.y + signedOffset * f.ny };
    const dimP2 = { x: dimP1.x + f.len * f.ux, y: dimP1.y + f.len * f.uy };
    const ext1Start = { x: this.p1.x + extensionGap * ex, y: this.p1.y + extensionGap * ey };
    const ext1End = { x: dimP1.x + extensionPast * ex, y: dimP1.y + extensionPast * ey };
    const ext2Start = { x: this.p2.x + extensionGap * ex, y: this.p2.y + extensionGap * ey };
    const ext2End = { x: dimP2.x + extensionPast * ex, y: dimP2.y + extensionPast * ey };

    // Screen projections.
    const sDimP1 = vm.w2s(dimP1.x, dimP1.y);
    const sDimP2 = vm.w2s(dimP2.x, dimP2.y);
    const sExt1Start = vm.w2s(ext1Start.x, ext1Start.y);
    const sExt1End = vm.w2s(ext1End.x, ext1End.y);
    const sExt2Start = vm.w2s(ext2Start.x, ext2Start.y);
    const sExt2End = vm.w2s(ext2End.x, ext2End.y);

    this.setupContext(ctx, vm, doc, byBlockColor);

    // â”€â”€ Text metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const measured = formatDimensionLength(this.length, {
      format: this.unitFormat ?? s.unitFormat,
      precision: this.unitPrecision ?? s.unitPrecision,
      prefix: this.unitPrefix ?? s.unitPrefix,
      suffix: this.unitSuffix ?? s.unitSuffix,
      decimalSeparator: this.decimalSeparator ?? s.decimalSeparator,
      suppressTrailingZeros: this.suppressTrailingZeros ?? s.suppressTrailingZeros,
      roundOff: this.roundOff ?? s.roundOff,
    });
    const text = this.textOverride == null
      ? measured
      : this.textOverride.indexOf('<>') >= 0
        ? this.textOverride.split('<>').join(measured)
        : this.textOverride;

    const heightPx = textHeight * vm.scale;
    ctx.font = `${heightPx}px sans-serif`;
    const m = ctx.measureText(text);
    const textWidthPx = m.width;
    const textWidthWorld = textWidthPx / vm.scale;
    const textHeightPx = (m.actualBoundingBoxAscent !== undefined && m.actualBoundingBoxDescent !== undefined)
      ? m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
      : heightPx * 1.2;
    const textHeightWorld = textHeightPx / vm.scale;
    const effectiveTextOffset = Math.max(arrowSize * 2, (textHeightWorld / 2) + padding);

    // ── Dim-line direction in screen space ────────────────────────────────────────
    const sdx = sDimP2.x - sDimP1.x;
    const sdy = sDimP2.y - sDimP1.y;
    const slen = Math.hypot(sdx, sdy);
    const arrowPx = arrowSize * vm.scale;

    // Effective placement, honouring per-entity/style override.
    let fitMode = (s as any).fitMode ?? 'BestFit';
    let useOutsideArrows = false;
    let useOutsideText = false;
    
    const spanWorld = this.length;
    
    // Available world-space span for arrows vs text
    const minSpanForArrows = 2 * arrowSize * 1.5;
    const minSpanForText = textWidthWorld;
    const minSpanForBoth = textWidthWorld + minSpanForArrows;

    if (textPlacement === 'outside') { 
        useOutsideArrows = true; 
        useOutsideText = true; 
    } else if (textPlacement === 'inside') { 
        useOutsideArrows = false; 
        useOutsideText = false; 
    } else if (textPlacement === 'above') { 
        useOutsideArrows = spanWorld < minSpanForArrows; 
        useOutsideText = false; 
    } else { // 'auto' or 'centered'
        if (fitMode === 'BestFit') {
            if (spanWorld >= minSpanForBoth) {
                // Both fit inside
            } else if (spanWorld >= minSpanForText) {
                // Arrows move out, text stays in
                useOutsideArrows = true;
            } else if (spanWorld >= minSpanForArrows) {
                // Text moves out, arrows stay in
                useOutsideText = true;
            } else {
                // Neither fit, both out
                useOutsideArrows = true;
                useOutsideText = true;
            }
        } else if (fitMode === 'ArrowsOnly') {
            if (spanWorld < minSpanForBoth) {
                useOutsideArrows = true;
            }
        } else if (fitMode === 'TextOnly') {
            if (spanWorld < minSpanForBoth) {
                useOutsideText = true;
            }
        } else if (fitMode === 'TextAndArrows') {
            if (spanWorld < minSpanForBoth) {
                useOutsideArrows = true;
                useOutsideText = true;
            }
        }
    }

    if (this.textAlongOffset != null && this.textAlongOffset !== 0) {
      useOutsideText = false;
    }

    let isCentered = (!useOutsideText && (textPlacement === 'auto' || textPlacement == null));

    // â”€â”€ Flip sign: controls which side of the dim line text appears on â”€â”€â”€â”€â”€â”€
    // textFlipped swaps the perpendicular sign; isCentered pins offset to 0.
    const flipSign = this.textFlipped ? -1 : 1;
    const perpFactor = isCentered ? 0 : flipSign;

    const textAlongOffset = this.textAlongOffset ?? 0;
    const midDimWorld = {
      x: (dimP1.x + dimP2.x) / 2 + textAlongOffset * f.ux,
      y: (dimP1.y + dimP2.y) / 2 + textAlongOffset * f.uy
    };
    const textPosWorld = {
      x: midDimWorld.x + effectiveTextOffset * perpFactor * ex,
      y: midDimWorld.y + effectiveTextOffset * perpFactor * ey,
    };
    const sTextPos = vm.w2s(textPosWorld.x, textPosWorld.y);

    // â”€â”€ Extension lines â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    ctx.save();
    if ((s as any).extLineColor && (s as any).extLineColor.toLowerCase() !== 'byblock' && (s as any).extLineColor.toLowerCase() !== 'bylayer') {
      ctx.strokeStyle = (s as any).extLineColor.toLowerCase();
    }
    ctx.beginPath();
    ctx.moveTo(sExt1Start.x, sExt1Start.y); ctx.lineTo(sExt1End.x, sExt1End.y);
    ctx.moveTo(sExt2Start.x, sExt2Start.y); ctx.lineTo(sExt2End.x, sExt2End.y);
    ctx.stroke();
    ctx.restore();

    // â”€â”€ Dim line â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    ctx.save();
    if ((s as any).dimLineColor && (s as any).dimLineColor.toLowerCase() !== 'byblock' && (s as any).dimLineColor.toLowerCase() !== 'bylayer') {
      ctx.strokeStyle = (s as any).dimLineColor.toLowerCase();
      ctx.fillStyle = (s as any).dimLineColor.toLowerCase();
    }
    ctx.beginPath();

    if (!useOutsideText && perpFactor === 0) {
      // Break the dimension line for the text
      const gapWorld = textWidthWorld / 2 + padding;
      const dimDirX = f.ux;
      const dimDirY = f.uy;

      const p1BreakWorld = { x: midDimWorld.x - gapWorld * dimDirX, y: midDimWorld.y - gapWorld * dimDirY };
      const p2BreakWorld = { x: midDimWorld.x + gapWorld * dimDirX, y: midDimWorld.y + gapWorld * dimDirY };

      const sP1Break = vm.w2s(p1BreakWorld.x, p1BreakWorld.y);
      const sP2Break = vm.w2s(p2BreakWorld.x, p2BreakWorld.y);

      // Only draw the segments if the break points are within the dimension line
      const d1 = Math.hypot(p1BreakWorld.x - dimP1.x, p1BreakWorld.y - dimP1.y);
      const d2 = Math.hypot(p2BreakWorld.x - dimP2.x, p2BreakWorld.y - dimP2.y);

      if (d1 < spanWorld && d2 < spanWorld && gapWorld * 2 < spanWorld) {
        ctx.moveTo(sDimP1.x, sDimP1.y); ctx.lineTo(sP1Break.x, sP1Break.y);
        ctx.moveTo(sP2Break.x, sP2Break.y); ctx.lineTo(sDimP2.x, sDimP2.y);
      }
    } else {
      ctx.moveTo(sDimP1.x, sDimP1.y); ctx.lineTo(sDimP2.x, sDimP2.y);
    }
    ctx.stroke();

    // â”€â”€ Text angle (derived from screen dim-line direction) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let angle = this.textRotationOverride != null
      ? -this.textRotationOverride
      : Math.atan2(sdy, sdx);
    if (this.textRotationOverride == null && (angle > Math.PI / 2 || angle < -Math.PI / 2)) {
      angle += Math.PI; // keep readable
    }
    
    // Apply Horizontal alignment overrides
    if (this.textRotationOverride == null) {
      if (!useOutsideText && (s as any).textInsideAlign === 'Horizontal') {
        angle = 0;
      } else if (useOutsideText && (s as any).textOutsideAlign === 'Horizontal') {
        angle = 0;
      }
    }

    // ── DRAW ARROWS ──────────────────────────────────────────────────────────
    if (slen > 1e-6) {
      const sux = sdx / slen, suy = sdy / slen;
      let type1 = (s as any).arrowType1?.toLowerCase() ?? arrowType;
      let type2 = (s as any).arrowType2?.toLowerCase() ?? arrowType;
      if (type1 === 'closedfilled') type1 = 'closed';
      if (type1 === 'architecturaltick') type1 = 'tick';
      if (type2 === 'closedfilled') type2 = 'closed';
      if (type2 === 'architecturaltick') type2 = 'tick';

      if (!useOutsideArrows) {
        // Arrowheads pointing inward
        drawArrowHead(ctx, sDimP1, sux, suy, arrowPx, type1, arrowAspect);
        drawArrowHead(ctx, sDimP2, -sux, -suy, arrowPx, type2, arrowAspect);
      } else {
        // Both arrowheads point outward (flipped direction) so they fit outside.
        drawArrowHead(ctx, sDimP1, -sux, -suy, arrowPx, type1, arrowAspect);
        drawArrowHead(ctx, sDimP2, sux, suy, arrowPx, type2, arrowAspect);
      }
    }
    ctx.restore(); // Restore the dim-line context

    // ── DRAW TEXT ────────────────────────────────────────────────────────────
    if (!useOutsideText) {
      // Text is already positioned at sTextPos
      ctx.save();
      ctx.translate(sTextPos.x, sTextPos.y);
      ctx.rotate(angle);
      
      let textColor = (s as any).textColor;
      if (textColor && textColor.toLowerCase() !== 'byblock' && textColor.toLowerCase() !== 'bylayer') {
        ctx.fillStyle = textColor.toLowerCase();
      } else {
        ctx.fillStyle = ctx.strokeStyle; // inherits layer/entity color
      }
      
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 0);
      ctx.restore();

    } else {
      // Determine which end to attach the text to (p2 side by default,
      // or p1 side when textFlipped, matching AutoCAD's behaviour).
      const anchorDimPt = this.textFlipped ? sDimP1 : sDimP2;
      const anchorUx = (slen > 1e-6) ? (sdx / slen) : 1;
      const anchorUy = (slen > 1e-6) ? (sdy / slen) : 0;
      // Text is placed beyond the anchor arrowhead tip along the dim-line axis.
      const jogPx = arrowPx * 1.5 + textWidthPx / 2 + 4;
      // Flip direction if textFlipped (move toward p1 instead of p2)
      const jogSign = this.textFlipped ? -1 : 1;
      const sTextX = anchorDimPt.x + jogSign * jogPx * anchorUx;
      const sTextY = anchorDimPt.y + jogSign * jogPx * anchorUy;

      // Short jog leader: from arrowhead tip to just before the text.
      const jogStartX = anchorDimPt.x + jogSign * arrowPx * anchorUx;
      const jogStartY = anchorDimPt.y + jogSign * arrowPx * anchorUy;
      const jogEndX = sTextX - jogSign * (textWidthPx / 2 + 2) * anchorUx;
      const jogEndY = sTextY - jogSign * (textWidthPx / 2 + 2) * anchorUy;
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(jogStartX, jogStartY);
      ctx.lineTo(jogEndX, jogEndY);
      ctx.stroke();
      ctx.restore();

      // Text label.
      ctx.save();
      ctx.translate(sTextX, sTextY);
      ctx.rotate(angle);
      
      let textColor = (s as any).textColor;
      if (textColor && textColor.toLowerCase() !== 'byblock' && textColor.toLowerCase() !== 'bylayer') {
        ctx.fillStyle = textColor.toLowerCase();
      } else {
        ctx.fillStyle = ctx.strokeStyle; // inherits layer/entity color
      }
      
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  getEditorMetrics(vm: ViewModelLike, doc: DocLike): { sPos: IPoint; angle: number; align: 'center', baseline: 'middle' } | null {
    this._resolveAnchors(doc);
    const f = this._frame();
    if (!f) return null;
    const s = this._resolveStyle(doc);
    const dynamicSize = s.textHeight;
    let textHeight = this.textHeight ?? dynamicSize;
    let padding = this.textOffset ?? (this.length > 0 ? dynamicSize * 0.2 : s.textOffset);
    const textPlacement = this.textPlacement ?? s.textPlacement ?? 'auto';

    if (this.isAnnotative) {
      let aScale = (vm as any).annoScale;
      if (typeof aScale !== 'number' || aScale <= 0) aScale = 1.0;
      const scaleMultiplier = 1 / aScale;
      textHeight *= scaleMultiplier;
      padding *= scaleMultiplier;
    }

    const ox = this.dimLinePoint.x - this.p1.x;
    const oy = this.dimLinePoint.y - this.p1.y;
    const signedOffset = ox * f.nx + oy * f.ny;
    const side = signedOffset >= 0 ? 1 : -1;
    const ex = f.nx * side;
    const ey = f.ny * side;

    const dimP1 = { x: this.p1.x + signedOffset * f.nx, y: this.p1.y + signedOffset * f.ny };
    const dimP2 = { x: this.p2.x + signedOffset * f.nx, y: this.p2.y + signedOffset * f.ny };
    const sDimP1 = vm.w2s(dimP1.x, dimP1.y);
    const sDimP2 = vm.w2s(dimP2.x, dimP2.y);
    const sdx = sDimP2.x - sDimP1.x;
    const sdy = sDimP2.y - sDimP1.y;
    const slen = Math.hypot(sdx, sdy);

    const heightPx = textHeight * vm.scale;
    const textHeightPx = heightPx * 1.2;
    const textHeightWorld = textHeightPx / vm.scale;
    const arrowPx = (this.arrowSize ?? s.arrowSize) * (this.isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1) * vm.scale;
    const effectiveTextOffset = Math.max(arrowPx * 2 / vm.scale, (textHeightWorld / 2) + padding);

    const flipSign = this.textFlipped ? -1 : 1;
    let useAbove = false;
    let useOutside = false;
    if (textPlacement === 'outside') { useOutside = true; }
    else if (textPlacement === 'inside') { useOutside = false; }
    else if (textPlacement === 'above') { useOutside = false; useAbove = true; }
    else {
      const textWidthPx = 16 * (this.text.length || 4);
      const fitInside = this.length >= (textWidthPx / vm.scale) + 2 * (arrowPx / vm.scale) * 1.5;
      useOutside = !fitInside;
    }

    if (this.textAlongOffset != null && this.textAlongOffset !== 0) {
      useOutside = false;
    }

    const perpFactor = useAbove ? 0 : flipSign;
    const textAlongOffset = this.textAlongOffset ?? 0;
    const midDimWorld = {
      x: (dimP1.x + dimP2.x) / 2 + textAlongOffset * f.ux,
      y: (dimP1.y + dimP2.y) / 2 + textAlongOffset * f.uy
    };

    let angle = this.textRotationOverride != null ? -this.textRotationOverride : Math.atan2(sdy, sdx);
    if (this.textRotationOverride == null && (angle > Math.PI / 2 || angle < -Math.PI / 2)) {
      angle += Math.PI;
    }

    if (!useOutside) {
      const textPosWorld = {
        x: midDimWorld.x + effectiveTextOffset * perpFactor * ex,
        y: midDimWorld.y + effectiveTextOffset * perpFactor * ey,
      };
      return { sPos: vm.w2s(textPosWorld.x, textPosWorld.y), angle, align: 'center', baseline: 'middle' };
    } else {
      const anchorDimPt = this.textFlipped ? sDimP1 : sDimP2;
      const anchorUx = (slen > 1e-6) ? (sdx / slen) : 1;
      const anchorUy = (slen > 1e-6) ? (sdy / slen) : 0;
      const textWidthPx = 16 * (this.text.length || 4);
      const jogPx = arrowPx * 1.5 + textWidthPx / 2 + 4;
      const jogSign = this.textFlipped ? -1 : 1;
      return {
        sPos: { x: anchorDimPt.x + jogSign * jogPx * anchorUx, y: anchorDimPt.y + jogSign * jogPx * anchorUy },
        angle, align: 'center', baseline: 'middle'
      };
    }
  }

  override snapPoints(): ISnapPoint[] {
    const f = this._frame();
    const out: ISnapPoint[] = [
      { x: this.p1.x, y: this.p1.y, label: 'endpoint' },
      { x: this.p2.x, y: this.p2.y, label: 'endpoint' },
    ];
    if (f) {
      const ox = this.dimLinePoint.x - this.p1.x;
      const oy = this.dimLinePoint.y - this.p1.y;
      const so = ox * f.nx + oy * f.ny;
      const dp1 = { x: this.p1.x + so * f.nx, y: this.p1.y + so * f.ny };
      const dp2 = { x: this.p2.x + so * f.nx, y: this.p2.y + so * f.ny };
      out.push(
        { x: dp1.x, y: dp1.y, label: 'dim-end' },
        { x: dp2.x, y: dp2.y, label: 'dim-end' },
        { x: (dp1.x + dp2.x) / 2, y: (dp1.y + dp2.y) / 2, label: 'midpoint' },
      );
    }
    return out;
  }

  override bbox(): IBBox {
    const f = this._frame();
    const xs = [this.p1.x, this.p2.x];
    const ys = [this.p1.y, this.p2.y];
    if (f) {
      const ox = this.dimLinePoint.x - this.p1.x;
      const oy = this.dimLinePoint.y - this.p1.y;
      const so = ox * f.nx + oy * f.ny;
      xs.push(this.p1.x + so * f.nx, this.p2.x + so * f.nx);
      ys.push(this.p1.y + so * f.ny, this.p2.y + so * f.ny);
    }
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...xs), maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const f = this._frame();
    if (!f) return false;
    const ox = this.dimLinePoint.x - this.p1.x;
    const oy = this.dimLinePoint.y - this.p1.y;
    const so = ox * f.nx + oy * f.ny;
    const dimP1 = { x: this.p1.x + so * f.nx, y: this.p1.y + so * f.ny };
    const dimP2 = { x: this.p2.x + so * f.nx, y: this.p2.y + so * f.ny };

    // 1. Dimension line
    const sDimP1 = vm.w2s(dimP1.x, dimP1.y);
    const sDimP2 = vm.w2s(dimP2.x, dimP2.y);
    if (pointToScreenSegmentDist(sx, sy, sDimP1, sDimP2) <= tol) return true;

    // 2. Extension lines
    const sP1 = vm.w2s(this.p1.x, this.p1.y);
    const sP2 = vm.w2s(this.p2.x, this.p2.y);
    const ep = this.extensionPast ?? 1.25;
    const dp1Ext = { x: dimP1.x + f.nx * ep, y: dimP1.y + f.ny * ep };
    const dp2Ext = { x: dimP2.x + f.nx * ep, y: dimP2.y + f.ny * ep };
    if (pointToScreenSegmentDist(sx, sy, sP1, vm.w2s(dp1Ext.x, dp1Ext.y)) <= tol) return true;
    if (pointToScreenSegmentDist(sx, sy, sP2, vm.w2s(dp2Ext.x, dp2Ext.y)) <= tol) return true;

    // 3. Text area (approximate center point)
    const midX = (dimP1.x + dimP2.x) / 2;
    const midY = (dimP1.y + dimP2.y) / 2;
    const sMid = vm.w2s(midX, midY);
    // Allow a larger radius around the midpoint for clicking the text
    if (Math.hypot(sx - sMid.x, sy - sMid.y) <= tol * 4) return true;

    return false;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'styleName', label: 'Dim Style', type: 'dropdown', category: 'Style', options: ['Standard', 'ISO-25'] },
      { key: 'isAnnotative', label: 'Annotative', type: 'boolean', category: 'Style' },

      { key: 'length', label: 'Length', type: 'read-only', category: 'Geometry', value: this.length.toFixed(3) },
      { key: 'anchor1Status', label: 'Anchor 1', type: 'read-only', category: 'Geometry', value: this.anchor1 ? `Attached â†’ #${this.anchor1.entityId}` : 'Detached' },
      ...(this.anchor1 ? [{ key: 'anchor1', label: 'Detach Anchor 1', type: 'action-button', category: 'Geometry', value: null } as IPropertySchema] : []),
      { key: 'anchor2Status', label: 'Anchor 2', type: 'read-only', category: 'Geometry', value: this.anchor2 ? `Attached â†’ #${this.anchor2.entityId}` : 'Detached' },
      ...(this.anchor2 ? [{ key: 'anchor2', label: 'Detach Anchor 2', type: 'action-button', category: 'Geometry', value: null } as IPropertySchema] : []),

      { key: 'textOverride', label: 'Text Override', type: 'text', category: 'Text' },
      { key: 'textHeight', label: 'Text Height', type: 'number', category: 'Text', precision: 2, step: 0.1, min: 0 },
      { key: 'textOffset', label: 'Text Offset', type: 'number', category: 'Text', precision: 2, step: 0.1 },
      { key: 'textFlipped', label: 'Flip Text', type: 'boolean', category: 'Text' },
      { key: 'textRotationOverrideDeg', label: 'Text Rotation', type: 'text-rotation', category: 'Text', precision: 1, suffix: 'Â°' },
      {
        key: 'textPlacement', label: 'Text Placement', type: 'dropdown', category: 'Text',
        options: ['auto', 'inside', 'outside', 'above']
      },

      { key: 'arrowType', label: 'Arrow Type', type: 'dropdown', category: 'Arrows', options: ['closed', 'open', 'tick', 'dot', 'none'] },
      { key: 'arrowSize', label: 'Arrow Size', type: 'number', category: 'Arrows', precision: 2, step: 0.1, min: 0 },
      { key: 'arrowAspect', label: 'Arrow Aspect', type: 'number', category: 'Arrows', precision: 1, step: 0.1, min: 0.1 },
      { key: 'extensionGap', label: 'Extension Gap', type: 'number', category: 'Arrows', precision: 2, step: 0.1, min: 0 },
      { key: 'extensionPast', label: 'Extension Past', type: 'number', category: 'Arrows', precision: 2, step: 0.1, min: 0 },

      { key: 'unitFormat', label: 'Unit Format', type: 'dropdown', category: 'Units', options: ['decimal', 'engineering', 'architectural', 'fractional', 'scientific'] },
      { key: 'unitPrecision', label: 'Precision', type: 'number', category: 'Units', step: 1, min: 0, max: 256 },
      { key: 'unitPrefix', label: 'Prefix', type: 'text', category: 'Units' },
      { key: 'unitSuffix', label: 'Suffix', type: 'text', category: 'Units' },
      { key: 'decimalSeparator', label: 'Decimal Separator', type: 'dropdown', category: 'Units', options: ['.', ','] },
      { key: 'suppressTrailingZeros', label: 'Suppress Zeros', type: 'boolean', category: 'Units' },
      { key: 'roundOff', label: 'Round Off', type: 'number', category: 'Units', precision: 4, step: 0.01, min: 0 },
    ];
  }

  override applyPropertyChange(key: string, value: any): void {
    // The schema lets users empty override fields by setting them to the style's
    // resolved value; storing the empty string here clears the override.
    if (value === '' || value === undefined) {
      switch (key) {
        case 'arrowSize': case 'arrowAspect': case 'arrowType': case 'textHeight': case 'textOffset':
        case 'extensionGap': case 'extensionPast':
        case 'unitFormat': case 'unitPrecision': case 'unitPrefix': case 'unitSuffix':
        case 'decimalSeparator': case 'suppressTrailingZeros': case 'roundOff':
        case 'textOverride': case 'textPlacement': case 'textRotationOverrideDeg':
          (this as any)[key] = null;
          this.refreshCaches();
          return;
      }
      if (key === 'textRotationOverrideDeg') {
        this.textRotationOverrideDeg = value;
        this.refreshCaches();
        return;
      }
    }
    if (key === 'textFlipped') {
      this.textFlipped = !!value;
      this.refreshCaches();
      return;
    }
    if (key === 'suppressTrailingZeros') {
      this.suppressTrailingZeros = !!value;
      this.refreshCaches();
      return;
    }
    if (key === 'unitPrecision' || key === 'roundOff') {
      const n = parseFloat(value);
      (this as any)[key] = Number.isFinite(n) ? n : null;
      this.refreshCaches();
      return;
    }
    super.applyPropertyChange(key, value);
  }
}

function pointToScreenSegmentDist(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Default dim-line point = midpoint of p1-p2 offset 5 units along the CCW perpendicular. */
function defaultDimLinePoint(p1: IPoint, p2: IPoint): IPoint {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: p1.x, y: p1.y + 5 };
  const nx = -dy / len;
  const ny = dx / len;
  return { x: (p1.x + p2.x) / 2 + 5 * nx, y: (p1.y + p2.y) / 2 + 5 * ny };
}

/**
 * Draw a single arrowhead in screen coords.
 * `tip` is the arrow point; (ux, uy) is the unit screen-space direction the
 * arrow body extends FROM the tip (i.e. back toward the dim-line interior).
 */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tip: { x: number; y: number },
  ux: number,
  uy: number,
  size: number,
  type: DimArrowType,
  aspectRatio: number = 2,
): void {
  if (type === 'none' || size < 1) return;
  const nx = -uy, ny = ux;
  if (type === 'tick') {
    const half = size * 0.5;
    // 45Â° tick across the dim line
    const tx = (ux + nx) * half;
    const ty = (uy + ny) * half;
    ctx.beginPath();
    ctx.moveTo(tip.x - tx, tip.y - ty);
    ctx.lineTo(tip.x + tx, tip.y + ty);
    ctx.stroke();
    return;
  }
  if (type === 'dot') {
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, size * 0.25, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // closed / open: triangle with tip at `tip`, base at tip + size*u
  const baseX = tip.x + ux * size;
  const baseY = tip.y + uy * size;
  const half = size / (2 * aspectRatio);
  const lx = baseX + nx * half;
  const ly = baseY + ny * half;
  const rx = baseX - nx * half;
  const ry = baseY - ny * half;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.closePath();
  if (type === 'closed') ctx.fill();
  else ctx.stroke();
}

/* ---- VIEWPORT (paper-space viewport rectangle) ---- */
export class ViewportEntity extends Entity {
  cx: number;
  cy: number;
  w: number;
  h: number;
  viewCenter: IPoint;
  viewHeight: number;
  viewTarget?: { x: number; y: number; z: number };

  constructor(cx: number, cy: number, w: number, h: number, viewCenter: IPoint = { x: 0, y: 0 }, viewHeight = 100) {
    super('VIEWPORT');
    this.cx = cx;
    this.cy = cy;
    this.w = w;
    this.h = h;
    this.viewCenter = viewCenter;
    this.viewHeight = viewHeight;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    const a = vm.w2s(this.cx - this.w / 2, this.cy - this.h / 2);
    const b = vm.w2s(this.cx + this.w / 2, this.cy + this.h / 2);
    this.setupContext(ctx, vm, doc, byBlockColor);
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }

  override bbox(): IBBox {
    return { x: this.cx - this.w / 2, y: this.cy - this.h / 2, w: this.w, h: this.h };
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const a = vm.w2s(this.cx - this.w / 2, this.cy - this.h / 2);
    const b = vm.w2s(this.cx + this.w / 2, this.cy + this.h / 2);
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);

    // Viewport is an outline â€” hit test the edges, not the fill.
    if (pointToScreenSegmentDist(sx, sy, { x: left, y: top }, { x: right, y: top }) <= tol) return true;
    if (pointToScreenSegmentDist(sx, sy, { x: right, y: top }, { x: right, y: bottom }) <= tol) return true;
    if (pointToScreenSegmentDist(sx, sy, { x: right, y: bottom }, { x: left, y: bottom }) <= tol) return true;
    if (pointToScreenSegmentDist(sx, sy, { x: left, y: bottom }, { x: left, y: top }) <= tol) return true;

    return false;
  }
}

/** Catmull-Rom chain utility (used by SplineTool). */
export function catmullRomChain(pts: IPoint[], segments = 16): IPoint[] {
  if (pts.length < 2) return pts.slice();
  const out: IPoint[] = [];
  const ext = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 0; i < ext.length - 3; i++) {
    const p0 = ext[i], p1 = ext[i + 1], p2 = ext[i + 2], p3 = ext[i + 3];
    for (let s = 0; s < segments; s++) {
      const t = s / segments;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, y });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/* ---- MLEADER ---- */
export interface MLeaderLine {
  pts: IPoint[]; // Points from arrowhead to just before the landing.
}

export class MLeaderEntity extends DimensionEntity {
  content: string;
  blockId?: string;
  leaderLines: MLeaderLine[];
  doglegLength: number;
  attachmentSide: 'left' | 'right';

  constructor(leaderLines: MLeaderLine[], content = '', attachmentSide: 'left' | 'right' = 'right', doglegLength = 4) {
    // MLeaders don't use p1, p2, or dimLinePoint for geometry, but we pass dummies to super
    super({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    this.type = 'MLEADER';
    this.leaderLines = leaderLines;
    this.content = content;
    this.attachmentSide = attachmentSide;
    this.doglegLength = doglegLength;
  }

  /** Landing endpoint for the given leader line. */
  landingEnd(lineIdx: number): IPoint {
    const line = this.leaderLines[lineIdx];
    if (!line || !line.pts.length) return { x: 0, y: 0 };
    const last = line.pts[line.pts.length - 1];
    const dir = this.attachmentSide === 'right' ? 1 : -1;
    return { x: last.x + dir * this.doglegLength, y: last.y };
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    if (!this.leaderLines.length) return;
    this.setupContext(ctx, vm, doc, byBlockColor);

    const s = (this as any)._resolveStyle(doc);

    // Scale visual sizes if annotative
    const scaleFactor = this.isAnnotative ? (1 / (vm.annoScale || 1)) : 1;
    const arrowSize = (this.arrowSize ?? s.arrowSize) * scaleFactor;
    const arrowType = this.arrowType ?? s.arrowType;
    const arrowAspect = this['arrowAspect'] ?? s['arrowAspect'] ?? 3;
    const textHeight = (this.textHeight ?? s.textHeight) * scaleFactor;
    const doglegLength = this.doglegLength * scaleFactor;

    ctx.save();

    // Draw all leader lines
    for (let i = 0; i < this.leaderLines.length; i++) {
      const line = this.leaderLines[i];
      if (line.pts.length < 2) continue;

      // 1. Polyline
      ctx.beginPath();
      const p0 = vm.w2s(line.pts[0].x, line.pts[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let j = 1; j < line.pts.length; j++) {
        const p = vm.w2s(line.pts[j].x, line.pts[j].y);
        ctx.lineTo(p.x, p.y);
      }

      // Dogleg segment
      const last = line.pts[line.pts.length - 1];
      const dir = this.attachmentSide === 'right' ? 1 : -1;
      const end = { x: last.x + dir * doglegLength, y: last.y };
      const sEnd = vm.w2s(end.x, end.y);
      ctx.lineTo(sEnd.x, sEnd.y);

      // Color from style
      ctx.strokeStyle = s.dimLineColor === 'ByBlock' ? (byBlockColor || '#fff') : (s.dimLineColor || '#fff');
      ctx.lineWidth = Math.max(1, s.dimLineWeight);
      ctx.stroke();

      // 2. Arrowhead
      const a = vm.w2s(line.pts[0].x, line.pts[0].y);
      const b = vm.w2s(line.pts[1].x, line.pts[1].y);
      const adx = b.x - a.x;
      const ady = b.y - a.y;
      const aLen = Math.hypot(adx, ady);
      if (aLen > 1e-6) {
        const arrowPx = arrowSize * vm.scale;
        drawArrowHead(ctx, a, adx / aLen, ady / aLen, arrowPx, arrowType, arrowAspect);
      }
    }

    // 3. Content (Text or Block)
    if (this.blockId) {
      // Draw block callout mock
      const end = this.landingEnd(0);
      const sEnd = vm.w2s(end.x, end.y);
      ctx.beginPath();
      ctx.arc(sEnd.x + (this.attachmentSide === 'right' ? 15 : -15), sEnd.y, 15, 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.content && this.content.length) {
      // Use the first leader's landing for text
      const last = this.leaderLines[0].pts[this.leaderLines[0].pts.length - 1];
      const dir = this.attachmentSide === 'right' ? 1 : -1;
      const end = { x: last.x + dir * doglegLength, y: last.y };
      const gap = (this.textOffset ?? s.textOffset) * scaleFactor;
      const ins = { x: end.x + dir * gap, y: end.y };
      const sIns = vm.w2s(ins.x, ins.y);

      const hPx = textHeight * (vm.cumulativeScale ?? vm.scale) * (4 / 3);
      ctx.font = `${hPx}px sans-serif`;

      ctx.save();
      ctx.translate(sIns.x, sIns.y);
      if (this.textRotationOverride != null) {
        ctx.rotate(-this.textRotationOverride);
      }
      ctx.textBaseline = 'middle';
      ctx.textAlign = this.attachmentSide === 'right' ? 'left' : 'right';

      ctx.fillStyle = s.textColor === 'ByBlock' ? (byBlockColor || '#fff') : (s.textColor || '#fff');

      const lines = this.content.split(/\\P|\n/);
      const lineDy = hPx * 1.2;
      const N = lines.length;
      const blockY = -((N - 1) * lineDy) / 2;

      for (let i = 0; i < N; i++) {
        ctx.fillText(lines[i], 0, blockY + i * lineDy);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    if (!this.leaderLines.length) return false;

    // Scale visual sizes if annotative
    const s = (this as any)._resolveStyle(null);
    const scaleFactor = this.isAnnotative ? (1 / (vm.annoScale || 1)) : 1;
    const doglegLength = this.doglegLength * scaleFactor;

    for (let i = 0; i < this.leaderLines.length; i++) {
      const line = this.leaderLines[i];
      if (line.pts.length < 2) continue;

      const last = line.pts[line.pts.length - 1];
      const dir = this.attachmentSide === 'right' ? 1 : -1;
      const end = { x: last.x + dir * doglegLength, y: last.y };

      const pts = [...line.pts, end];
      for (let j = 0; j < pts.length - 1; j++) {
        const a = vm.w2s(pts[j].x, pts[j].y);
        const b = vm.w2s(pts[j + 1].x, pts[j + 1].y);
        if (pointToScreenSegmentDist(sx, sy, a, b) <= tol) return true;
      }
    }

    // Text bounding box hit test
    if (this.content && this.content.length) {
      const textHeight = (this.textHeight ?? s.textHeight) * scaleFactor;
      const last = this.leaderLines[0].pts[this.leaderLines[0].pts.length - 1];
      const dir = this.attachmentSide === 'right' ? 1 : -1;
      const end = { x: last.x + dir * doglegLength, y: last.y };
      const gap = (this.textOffset ?? s.textOffset) * scaleFactor;
      const ins = { x: end.x + dir * gap, y: end.y };
      const sIns = vm.w2s(ins.x, ins.y);

      const hPx = textHeight * (vm.cumulativeScale ?? vm.scale) * (4 / 3);
      const approxWidth = this.content.length * hPx * 0.6;
      const left = this.attachmentSide === 'right' ? sIns.x : sIns.x - approxWidth;
      const right = this.attachmentSide === 'right' ? sIns.x + approxWidth : sIns.x;
      const top = sIns.y - hPx * this.content.split('\n').length;
      const bottom = sIns.y + hPx * this.content.split('\n').length;
      if (sx >= left - tol && sx <= right + tol && sy >= top - tol && sy <= bottom + tol) return true;
    }
    return false;
  }

  override snapPoints(): ISnapPoint[] {
    const sp: ISnapPoint[] = [];
    const scaleFactor = this.isAnnotative ? 1 : 1;
    const doglegLength = this.doglegLength * scaleFactor;

    for (let i = 0; i < this.leaderLines.length; i++) {
      const line = this.leaderLines[i];
      if (!line.pts.length) continue;

      line.pts.forEach((p, idx) => {
        sp.push({ x: p.x, y: p.y, label: idx === 0 ? 'arrowhead' : 'vertex' });
      });

      const last = line.pts[line.pts.length - 1];
      const dir = this.attachmentSide === 'right' ? 1 : -1;
      const end = { x: last.x + dir * doglegLength, y: last.y };
      sp.push({ x: end.x, y: end.y, label: 'landing' });
    }
    return sp;
  }

  override bbox(): IBBox {
    if (!this.leaderLines.length) return { x: 0, y: 0, w: 0, h: 0 };

    const scaleFactor = this.isAnnotative ? 1 : 1;
    const doglegLength = this.doglegLength * scaleFactor;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const line of this.leaderLines) {
      if (!line.pts.length) continue;

      for (const p of line.pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }

      const last = line.pts[line.pts.length - 1];
      const dir = this.attachmentSide === 'right' ? 1 : -1;
      const end = { x: last.x + dir * doglegLength, y: last.y };

      if (end.x < minX) minX = end.x;
      if (end.x > maxX) maxX = end.x;
      if (end.y < minY) minY = end.y;
      if (end.y > maxY) maxY = end.y;
    }

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema().filter(s =>
        !['textPlacement', 'unitFormat', 'unitPrecision', 'unitPrefix', 'unitSuffix', 'decimalSeparator', 'suppressTrailingZeros', 'roundOff'].includes(s.key)
      ),
      { key: 'content', label: 'Content', type: 'text', category: 'MLeader' },
      { key: 'attachmentSide', label: 'Attachment', type: 'dropdown', category: 'MLeader', options: ['left', 'right'] },
      { key: 'doglegLength', label: 'Dogleg Length', type: 'number', category: 'MLeader', precision: 2, step: 0.5, min: 0 },
      { key: 'blockId', label: 'Block Callout', type: 'text', category: 'MLeader' },
    ];
  }
}

/* ---- JOGGED RADIUS DIMENSION ---- */
export class JoggedRadiusDimensionEntity extends Entity {
  trueCenter: IPoint;
  overrideCenter: IPoint;
  arcPoint: IPoint;
  jogPoint: IPoint;
  textPoint: IPoint | null = null;

  styleName = 'Standard';
  textFlipped = false;
  textOverride: string | null = null;
  isAnnotative = false;
  anchorArc: IDimAnchor | null = null;
  textRotationOverride: number | null = null;

  get textRotationOverrideDeg(): number | null {
    return this.textRotationOverride == null ? null : this.textRotationOverride * 180 / Math.PI;
  }
  set textRotationOverrideDeg(deg: number | null) {
    if (deg == null || deg === '' as any) {
      this.textRotationOverride = null;
    } else {
      const d = Number(deg);
      if (Number.isFinite(d)) this.textRotationOverride = d * Math.PI / 180;
    }
  }

  // Style overrides
  arrowSize: number | null = null;
  arrowType: DimArrowType | null = null;
  textHeight: number | null = null;
  textOffset: number | null = null;
  unitFormat: DimUnitFormat | null = null;
  unitPrecision: number | null = null;
  unitPrefix: string | null = null;
  unitSuffix: string | null = null;
  decimalSeparator: '.' | ',' | null = null;
  suppressTrailingZeros: boolean | null = null;
  roundOff: number | null = null;
  jogAngle: number | null = null;
  jogHeightFactor: number | null = null;

  constructor(trueCenter: IPoint, overrideCenter: IPoint, arcPoint: IPoint, jogPoint: IPoint) {
    super('DIMENSION');
    this.trueCenter = { ...trueCenter };
    this.overrideCenter = { ...overrideCenter };
    this.arcPoint = { ...arcPoint };
    this.jogPoint = { ...jogPoint };
  }

  get radius(): number {
    return Math.hypot(this.arcPoint.x - this.trueCenter.x, this.arcPoint.y - this.trueCenter.y);
  }

  private _resolveStyle(doc: any): DimensionStyle {
    if (!doc) return DEFAULT_DIM_STYLE;
    if (doc.dimStyles instanceof Map) {
      return doc.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    }
    if (doc.activeFile?.dimStyles instanceof Map) {
      return doc.activeFile.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    }
    return DEFAULT_DIM_STYLE;
  }

  private _resolveAnchors(doc: any): void {
    if (!this.anchorArc) return;
    let entities: any[] | undefined;
    if (doc?.entities && Array.isArray(doc.entities)) entities = doc.entities;
    else if (doc?.activeFile?.entities && Array.isArray(doc.activeFile.entities)) entities = doc.activeFile.entities;
    if (!entities) return;

    const ent = entities.find((e: any) => e && e.id === this.anchorArc!.entityId);
    if (!ent) return;

    // In AutoCAD, jogged dimensions stay anchored to the arc center and arc point.
    // If the arc changed its center or radius, update trueCenter and arcPoint.
    if (ent.cx !== undefined && ent.cy !== undefined) {
      this.trueCenter.x = ent.cx;
      this.trueCenter.y = ent.cy;
      // Also adjust arcPoint to stay on the circle/arc boundary
      const angle = Math.atan2(this.arcPoint.y - ent.cy, this.arcPoint.x - ent.cx);
      const r = ent.radius ?? this.radius;
      this.arcPoint.x = ent.cx + Math.cos(angle) * r;
      this.arcPoint.y = ent.cy + Math.sin(angle) * r;
    }
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    this._resolveAnchors(doc);
    this.setupContext(ctx, vm, doc, byBlockColor);

    const s = this._resolveStyle(doc);
    const scaleFactor = this.isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1;

    const arrowSize = (this.arrowSize ?? s.arrowSize) * scaleFactor;
    const arrowType = this.arrowType ?? s.arrowType;
    const arrowAspect = this['arrowAspect'] ?? s['arrowAspect'] ?? 3;
    const textHeight = (this.textHeight ?? s.textHeight) * scaleFactor;
    const textOffset = (this.textOffset ?? s.textOffset) * scaleFactor;
    const jogAngle = this.jogAngle ?? (s as any).jogAngle ?? (Math.PI / 4);
    const jogHeightFactor = this.jogHeightFactor ?? (s as any).jogHeightFactor ?? 1.5;

    const tc = vm.w2s(this.trueCenter.x, this.trueCenter.y);
    const ap = vm.w2s(this.arcPoint.x, this.arcPoint.y);

    // Single axis vector from trueCenter to arcPoint
    const dx = ap.x - tc.x;
    const dy = ap.y - tc.y;
    const len = Math.hypot(dx, dy);

    if (len < 1e-9) return;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const jogHeightPx = textHeight * vm.scale * jogHeightFactor;
    const jogWidthPx = jogHeightPx / Math.tan(jogAngle);

    // 1. Arrowhead at arcPoint pointing INWARD (towards the center)
    const arrowPx = arrowSize * vm.scale;
    drawArrowHead(ctx, ap, -ux, -uy, arrowPx, arrowType, arrowAspect);

    // 2. Determine text point and if it's outside
    let tp = this.textPoint ? vm.w2s(this.textPoint.x, this.textPoint.y) : null;
    let isOutside = false;

    if (!tp) {
      tp = { x: tc.x + ux * (len / 2), y: tc.y + uy * (len / 2) };
    } else {
      const tpDist = Math.hypot(tp.x - tc.x, tp.y - tc.y);
      if (tpDist > len + 1e-5) {
        isOutside = true;
      }
    }

    // 3. Text measurement
    const measured = formatDimensionLength(this.radius, {
      format: this.unitFormat ?? s.unitFormat,
      precision: this.unitPrecision ?? s.unitPrecision,
      prefix: this.unitPrefix ?? s.unitPrefix,
      suffix: this.unitSuffix ?? s.unitSuffix,
      decimalSeparator: this.decimalSeparator ?? s.decimalSeparator,
      suppressTrailingZeros: this.suppressTrailingZeros ?? s.suppressTrailingZeros,
      roundOff: this.roundOff ?? s.roundOff,
    });
    const text = this.textOverride == null
      ? `R${measured}`
      : this.textOverride.indexOf('<>') >= 0
        ? this.textOverride.split('<>').join(measured)
        : this.textOverride;

    const heightPx = textHeight * vm.scale;
    ctx.font = `${heightPx}px sans-serif`;
    const textWidthPx = ctx.measureText(text).width;

    // 4. Draw Lines
    ctx.beginPath();
    ctx.moveTo(tc.x, tc.y);

    let landingDir = 1;
    let landingLen = textWidthPx + 8;

    if (isOutside) {
      // Line from center to text point
      ctx.lineTo(tp.x, tp.y);
      // Landing line (horizontal)
      landingDir = (tp.x >= tc.x) ? 1 : -1;
      ctx.lineTo(tp.x + landingDir * landingLen, tp.y);
    } else {
      // Line from center to arc point only
      ctx.lineTo(ap.x, ap.y);
    }
    ctx.stroke();

    // 5. Place text
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle;

    if (isOutside) {
      ctx.save();
      // Position text slightly above the landing line
      const textX = tp.x + landingDir * 4;
      const textY = tp.y - 2;

      ctx.translate(textX, textY);
      if (this.textRotationOverride != null) {
        ctx.rotate(-this.textRotationOverride);
      }
      ctx.textAlign = landingDir === 1 ? 'left' : 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    } else {
      // Draw text aligned with the radial line
      let angle = Math.atan2(uy, ux);
      if (angle > Math.PI / 2 || angle <= -Math.PI / 2) {
        angle += Math.PI;
      }
      ctx.save();
      ctx.translate(tp.x, tp.y);
      const rAngle = this.textRotationOverride != null ? -this.textRotationOverride : angle;
      ctx.rotate(rAngle);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // White out background for text readability over the dimension line
      ctx.clearRect(-textWidthPx / 2 - 2, -heightPx / 2 - 2, textWidthPx + 4, heightPx + 4);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  override snapPoints(): ISnapPoint[] {
    return [
      { x: this.trueCenter.x, y: this.trueCenter.y, label: 'center' },
      { x: this.arcPoint.x, y: this.arcPoint.y, label: 'arc-pt' }
    ];
  }

  override bbox(): IBBox {
    const xs = [this.trueCenter.x, this.arcPoint.x];
    const ys = [this.trueCenter.y, this.arcPoint.y];
    if (this.textPoint) { xs.push(this.textPoint.x); ys.push(this.textPoint.y); }
    return {
      x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys)
    };
  }

  override getPropertiesSchema(): IPropertySchema[] {
    const s = (this as any)._resolveStyle(null);
    return [
      ...super.getPropertiesSchema(),
      { key: 'styleName', label: 'Dim Style', type: 'dropdown', category: 'Style', options: ['Standard', 'ISO-25'] },
      { key: 'isAnnotative', label: 'Annotative', type: 'boolean', category: 'Style' },
      { key: 'radius', label: 'Radius', type: 'read-only', category: 'Geometry', value: this.radius.toFixed(3) },
      { key: 'textOverride', label: 'Text Override', type: 'text', category: 'Text' },
      { key: 'textHeight', label: 'Text Height', type: 'number', category: 'Text', precision: 2, step: 0.1, min: 0 },
      { key: 'textOffset', label: 'Text Offset', type: 'number', category: 'Text', precision: 2, step: 0.1 },
      { key: 'textFlipped', label: 'Flip Text', type: 'boolean', category: 'Text' },
      { key: 'textRotationOverrideDeg', label: 'Text Rotation', type: 'text-rotation', category: 'Text', precision: 1, suffix: 'Â°' },
      { key: 'arrowType', label: 'Arrow Type', type: 'dropdown', category: 'Arrows', options: ['closed', 'open', 'tick', 'dot', 'none'] },
      { key: 'arrowSize', label: 'Arrow Size', type: 'number', category: 'Arrows', precision: 2, step: 0.1, min: 0 },
    ];
  }

  override applyPropertyChange(key: string, value: any): void {
    if (value === '' || value === undefined) {
      switch (key) {
        case 'arrowSize': case 'arrowType': case 'textHeight': case 'textOffset':
        case 'textOverride': case 'textRotationOverrideDeg':
          (this as any)[key] = null;
          this.refreshCaches();
          return;
      }
    }
    if (key === 'textRotationOverrideDeg') {
      this.textRotationOverrideDeg = value;
      this.refreshCaches();
      return;
    }
    (this as any)[key] = value;
    this.refreshCaches();
  }

  override refreshCaches(): void { }
}

/* ---- RADIUS DIMENSION ---- */
export class RadiusDimensionEntity extends Entity {
  center: IPoint;
  arcPoint: IPoint;
  textPoint: IPoint | null = null;
  anchorArc: IDimAnchor | null = null;
  styleName = 'Standard';
  textOverride: string | null = null;
  textRotationOverride: number | null = null;
  arrowSize: number | null = null;
  arrowType: DimArrowType | null = null;
  textHeight: number | null = null;
  textOffset: number | null = null;
  unitFormat: DimUnitFormat | null = null;
  unitPrecision: number | null = null;
  unitPrefix: string | null = null;
  unitSuffix: string | null = null;
  decimalSeparator: '.' | ',' | null = null;
  suppressTrailingZeros: boolean | null = null;
  roundOff: number | null = null;
  isAnnotative = false;

  constructor(center: IPoint, arcPoint: IPoint) {
    super('DIMRADIUS');
    this.center = { ...center };
    this.arcPoint = { ...arcPoint };
  }

  get radius(): number {
    return Math.hypot(this.arcPoint.x - this.center.x, this.arcPoint.y - this.center.y);
  }

  private _resolveStyle(doc: any): DimensionStyle {
    if (!doc) return DEFAULT_DIM_STYLE;
    if (doc.dimStyles instanceof Map) return doc.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    if (doc.activeFile?.dimStyles instanceof Map) return doc.activeFile.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    return DEFAULT_DIM_STYLE;
  }

  private _resolveAnchors(doc: any): void {
    if (!this.anchorArc) return;
    let entities: any[] | undefined;
    if (doc?.entities && Array.isArray(doc.entities)) entities = doc.entities;
    else if (doc?.activeFile?.entities && Array.isArray(doc.activeFile.entities)) entities = doc.activeFile.entities;
    if (!entities) return;
    const ent = entities.find((e: any) => e && e.id === this.anchorArc!.entityId);
    if (!ent) return;
    if (ent.cx !== undefined && ent.cy !== undefined) {
      this.center.x = ent.cx;
      this.center.y = ent.cy;
      const angle = Math.atan2(this.arcPoint.y - ent.cy, this.arcPoint.x - ent.cx);
      const r = ent.r ?? ent.radius ?? this.radius;
      this.arcPoint.x = ent.cx + Math.cos(angle) * r;
      this.arcPoint.y = ent.cy + Math.sin(angle) * r;
    }
  }

  override getMeasurementText(doc: DocLike): string {
    const s = this._resolveStyle(doc);
    const m = formatDimensionLength(this.radius, {
      format: this.unitFormat ?? s.unitFormat,
      precision: this.unitPrecision ?? s.unitPrecision,
      prefix: this.unitPrefix ?? s.unitPrefix,
      suffix: this.unitSuffix ?? s.unitSuffix,
      decimalSeparator: this.decimalSeparator ?? s.decimalSeparator,
      suppressTrailingZeros: this.suppressTrailingZeros ?? s.suppressTrailingZeros,
      roundOff: this.roundOff ?? s.roundOff,
    });
    return `R${m}`;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    this._resolveAnchors(doc);
    this.setupContext(ctx, vm, doc, byBlockColor);
    const s = this._resolveStyle(doc);
    const scaleFactor = this.isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1;
    const arrowSize = (this.arrowSize ?? s.arrowSize) * scaleFactor;
    const arrowType = this.arrowType ?? s.arrowType;
    const arrowAspect = this['arrowAspect'] ?? s['arrowAspect'] ?? 3;
    const textHeight = (this.textHeight ?? s.textHeight) * scaleFactor;

    const sc = vm.w2s(this.center.x, this.center.y);
    const ap = vm.w2s(this.arcPoint.x, this.arcPoint.y);
    const dx = ap.x - sc.x, dy = ap.y - sc.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const ux = dx / len, uy = dy / len;
    const arrowPx = arrowSize * vm.scale;
    const heightPx = textHeight * vm.scale;
    ctx.font = `${heightPx}px sans-serif`;

    const measured = formatDimensionLength(this.radius, {
      format: this.unitFormat ?? s.unitFormat,
      precision: this.unitPrecision ?? s.unitPrecision,
      prefix: this.unitPrefix ?? s.unitPrefix,
      suffix: this.unitSuffix ?? s.unitSuffix,
      decimalSeparator: this.decimalSeparator ?? s.decimalSeparator,
      suppressTrailingZeros: this.suppressTrailingZeros ?? s.suppressTrailingZeros,
      roundOff: this.roundOff ?? s.roundOff,
    });
    const text = this.textOverride == null
      ? `R${measured}`
      : this.textOverride.indexOf('<>') >= 0 ? this.textOverride.split('<>').join(measured) : this.textOverride;

    let tp: { x: number; y: number };
    let isOutside = false;
    if (this.textPoint) {
      tp = vm.w2s(this.textPoint.x, this.textPoint.y);
      isOutside = Math.hypot(tp.x - sc.x, tp.y - sc.y) > len + 1e-5;
    } else {
      tp = { x: sc.x + ux * len * 0.6, y: sc.y + uy * len * 0.6 };
    }

    ctx.beginPath();
    ctx.moveTo(sc.x, sc.y);
    if (isOutside) {
      ctx.lineTo(tp.x, tp.y);
      const landingDir = tp.x >= sc.x ? 1 : -1;
      ctx.lineTo(tp.x + landingDir * (ctx.measureText(text).width + 8), tp.y);
    } else {
      ctx.lineTo(ap.x, ap.y);
    }
    ctx.stroke();

    drawArrowHead(ctx, ap, ux, uy, arrowPx, arrowType, arrowAspect);

    ctx.save();
    ctx.fillStyle = ctx.strokeStyle as string;
    if (isOutside) {
      const landingDir = tp.x >= sc.x ? 1 : -1;
      ctx.textAlign = landingDir === 1 ? 'left' : 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text, tp.x + landingDir * 4, tp.y - 2);
    } else {
      let angle = Math.atan2(uy, ux);
      if (angle > Math.PI / 2 || angle <= -Math.PI / 2) angle += Math.PI;
      ctx.save();
      ctx.translate(tp.x, tp.y);
      ctx.rotate(this.textRotationOverride != null ? -this.textRotationOverride : angle);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(text).width;
      ctx.clearRect(-tw / 2 - 2, -heightPx / 2 - 2, tw + 4, heightPx + 4);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  override snapPoints(): ISnapPoint[] {
    return [
      { x: this.center.x, y: this.center.y, label: 'center' },
      { x: this.arcPoint.x, y: this.arcPoint.y, label: 'arc-pt' },
    ];
  }

  override bbox(): IBBox {
    const xs = [this.center.x, this.arcPoint.x];
    const ys = [this.center.y, this.arcPoint.y];
    if (this.textPoint) { xs.push(this.textPoint.x); ys.push(this.textPoint.y); }
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'styleName', label: 'Dim Style', type: 'dropdown', category: 'Style', options: ['Standard', 'ISO-25'] },
      { key: 'radius', label: 'Radius', type: 'read-only', category: 'Geometry', value: this.radius.toFixed(3) },
      { key: 'textOverride', label: 'Text Override', type: 'text', category: 'Text' },
      { key: 'textHeight', label: 'Text Height', type: 'number', category: 'Text', precision: 2, step: 0.1, min: 0 },
      { key: 'arrowType', label: 'Arrow Type', type: 'dropdown', category: 'Arrows', options: ['closed', 'open', 'tick', 'dot', 'none'] },
      { key: 'arrowSize', label: 'Arrow Size', type: 'number', category: 'Arrows', precision: 2, step: 0.1, min: 0 },
    ];
  }
}

/* ---- DIAMETER DIMENSION ---- */
export class DiameterDimensionEntity extends Entity {
  center: IPoint;
  arcPoint: IPoint;
  textPoint: IPoint | null = null;
  anchorCircle: IDimAnchor | null = null;
  styleName = 'Standard';
  textOverride: string | null = null;
  textRotationOverride: number | null = null;
  arrowSize: number | null = null;
  arrowType: DimArrowType | null = null;
  textHeight: number | null = null;
  textOffset: number | null = null;
  unitFormat: DimUnitFormat | null = null;
  unitPrecision: number | null = null;
  unitPrefix: string | null = null;
  unitSuffix: string | null = null;
  decimalSeparator: '.' | ',' | null = null;
  suppressTrailingZeros: boolean | null = null;
  roundOff: number | null = null;
  isAnnotative = false;

  constructor(center: IPoint, arcPoint: IPoint) {
    super('DIMDIAMETER');
    this.center = { ...center };
    this.arcPoint = { ...arcPoint };
  }

  get radius(): number {
    return Math.hypot(this.arcPoint.x - this.center.x, this.arcPoint.y - this.center.y);
  }

  private _resolveStyle(doc: any): DimensionStyle {
    if (!doc) return DEFAULT_DIM_STYLE;
    if (doc.dimStyles instanceof Map) return doc.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    if (doc.activeFile?.dimStyles instanceof Map) return doc.activeFile.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    return DEFAULT_DIM_STYLE;
  }

  private _resolveAnchors(doc: any): void {
    if (!this.anchorCircle) return;
    let entities: any[] | undefined;
    if (doc?.entities && Array.isArray(doc.entities)) entities = doc.entities;
    else if (doc?.activeFile?.entities && Array.isArray(doc.activeFile.entities)) entities = doc.activeFile.entities;
    if (!entities) return;
    const ent = entities.find((e: any) => e && e.id === this.anchorCircle!.entityId);
    if (!ent) return;
    if (ent.cx !== undefined && ent.cy !== undefined) {
      this.center.x = ent.cx;
      this.center.y = ent.cy;
      const angle = Math.atan2(this.arcPoint.y - ent.cy, this.arcPoint.x - ent.cx);
      const r = ent.r ?? ent.radius ?? this.radius;
      this.arcPoint.x = ent.cx + Math.cos(angle) * r;
      this.arcPoint.y = ent.cy + Math.sin(angle) * r;
    }
  }

  override getMeasurementText(doc: DocLike): string {
    const s = this._resolveStyle(doc);
    const m = formatDimensionLength(this.radius * 2, {
      format: this.unitFormat ?? s.unitFormat,
      precision: this.unitPrecision ?? s.unitPrecision,
      prefix: this.unitPrefix ?? s.unitPrefix,
      suffix: this.unitSuffix ?? s.unitSuffix,
      decimalSeparator: this.decimalSeparator ?? s.decimalSeparator,
      suppressTrailingZeros: this.suppressTrailingZeros ?? s.suppressTrailingZeros,
      roundOff: this.roundOff ?? s.roundOff,
    });
    return `\u2300${m}`;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    this._resolveAnchors(doc);
    this.setupContext(ctx, vm, doc, byBlockColor);
    const s = this._resolveStyle(doc);
    const scaleFactor = this.isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1;
    const arrowSize = (this.arrowSize ?? s.arrowSize) * scaleFactor;
    const arrowType = this.arrowType ?? s.arrowType;
    const arrowAspect = this['arrowAspect'] ?? s['arrowAspect'] ?? 3;
    const textHeight = (this.textHeight ?? s.textHeight) * scaleFactor;

    const sc = vm.w2s(this.center.x, this.center.y);
    const ap = vm.w2s(this.arcPoint.x, this.arcPoint.y);
    // Opposite point through center
    const opp = { x: 2 * sc.x - ap.x, y: 2 * sc.y - ap.y };
    const dx = ap.x - opp.x, dy = ap.y - opp.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const ux = dx / len, uy = dy / len;
    const arrowPx = arrowSize * vm.scale;
    const heightPx = textHeight * vm.scale;
    ctx.font = `${heightPx}px sans-serif`;

    const diam = this.radius * 2;
    const measured = formatDimensionLength(diam, {
      format: this.unitFormat ?? s.unitFormat,
      precision: this.unitPrecision ?? s.unitPrecision,
      prefix: this.unitPrefix ?? s.unitPrefix,
      suffix: this.unitSuffix ?? s.unitSuffix,
      decimalSeparator: this.decimalSeparator ?? s.decimalSeparator,
      suppressTrailingZeros: this.suppressTrailingZeros ?? s.suppressTrailingZeros,
      roundOff: this.roundOff ?? s.roundOff,
    });
    const text = this.textOverride == null
      ? `\u2300${measured}`
      : this.textOverride.indexOf('<>') >= 0 ? this.textOverride.split('<>').join(measured) : this.textOverride;

    // Full line through circle
    ctx.beginPath();
    ctx.moveTo(opp.x, opp.y);
    ctx.lineTo(ap.x, ap.y);
    ctx.stroke();

    drawArrowHead(ctx, ap, ux, uy, arrowPx, arrowType, arrowAspect);
    drawArrowHead(ctx, opp, -ux, -uy, arrowPx, arrowType, arrowAspect);

    // Text at midpoint (center)
    const tp = this.textPoint ? vm.w2s(this.textPoint.x, this.textPoint.y) : sc;
    let angle = Math.atan2(uy, ux);
    if (angle > Math.PI / 2 || angle <= -Math.PI / 2) angle += Math.PI;
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.translate(tp.x, tp.y);
    ctx.rotate(this.textRotationOverride != null ? -this.textRotationOverride : angle);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.clearRect(-tw / 2 - 2, -heightPx / 2 - 2, tw + 4, heightPx + 4);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  override snapPoints(): ISnapPoint[] {
    return [
      { x: this.center.x, y: this.center.y, label: 'center' },
      { x: this.arcPoint.x, y: this.arcPoint.y, label: 'arc-pt' },
      { x: 2 * this.center.x - this.arcPoint.x, y: 2 * this.center.y - this.arcPoint.y, label: 'opp-pt' },
    ];
  }

  override bbox(): IBBox {
    const xs = [this.center.x, this.arcPoint.x, 2 * this.center.x - this.arcPoint.x];
    const ys = [this.center.y, this.arcPoint.y, 2 * this.center.y - this.arcPoint.y];
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'styleName', label: 'Dim Style', type: 'dropdown', category: 'Style', options: ['Standard', 'ISO-25'] },
      { key: 'radius', label: 'Radius', type: 'read-only', category: 'Geometry', value: this.radius.toFixed(3) },
      { key: 'textOverride', label: 'Text Override', type: 'text', category: 'Text' },
      { key: 'textHeight', label: 'Text Height', type: 'number', category: 'Text', precision: 2, step: 0.1, min: 0 },
      { key: 'arrowType', label: 'Arrow Type', type: 'dropdown', category: 'Arrows', options: ['closed', 'open', 'tick', 'dot', 'none'] },
      { key: 'arrowSize', label: 'Arrow Size', type: 'number', category: 'Arrows', precision: 2, step: 0.1, min: 0 },
    ];
  }
}

/* ---- ANGULAR DIMENSION ---- */
export class AngularDimensionEntity extends Entity {
  vertex: IPoint;
  p1: IPoint;
  p2: IPoint;
  placePt: IPoint | null;
  styleName = 'Standard';
  textOverride: string | null = null;
  textRotationOverride: number | null = null;
  arrowSize: number | null = null;
  arrowType: DimArrowType | null = null;
  textHeight: number | null = null;
  unitPrecision: number | null = null;
  isAnnotative = false;

  constructor(vertex: IPoint, p1: IPoint, p2: IPoint, placePt: IPoint | null = null) {
    super('DIMANGULAR');
    this.vertex = { ...vertex };
    this.p1 = { ...p1 };
    this.p2 = { ...p2 };
    this.placePt = placePt ? { ...placePt } : null;
  }

  get angleDeg(): number {
    const a1 = Math.atan2(this.p1.y - this.vertex.y, this.p1.x - this.vertex.x);
    const a2 = Math.atan2(this.p2.y - this.vertex.y, this.p2.x - this.vertex.x);
    const place = this.placePt || this.p2;
    const aP = Math.atan2(place.y - this.vertex.y, place.x - this.vertex.x);

    let dA2 = (a2 - a1) % (2 * Math.PI);
    if (dA2 < 0) dA2 += 2 * Math.PI;

    let dAP = (aP - a1) % (2 * Math.PI);
    if (dAP < 0) dAP += 2 * Math.PI;

    const isNegativeSweep = dAP >= dA2;
    const sweep = isNegativeSweep ? (2 * Math.PI - dA2) : dA2;
    return sweep * 180 / Math.PI;
  }

  private _resolveStyle(doc: any): DimensionStyle {
    if (!doc) return DEFAULT_DIM_STYLE;
    if (doc.dimStyles instanceof Map) return doc.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    if (doc.activeFile?.dimStyles instanceof Map) return doc.activeFile.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    return DEFAULT_DIM_STYLE;
  }

  override getMeasurementText(doc: DocLike): string {
    const s = this._resolveStyle(doc);
    const precision = this.unitPrecision ?? s.unitPrecision ?? 1;
    return `${Math.abs(this.angleDeg).toFixed(precision)}\u00b0`;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    this.setupContext(ctx, vm, doc, byBlockColor);
    const s = this._resolveStyle(doc);
    const scaleFactor = this.isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1;
    const arrowSize = (this.arrowSize ?? s.arrowSize) * scaleFactor;
    const arrowType = this.arrowType ?? s.arrowType;
    const arrowAspect = this['arrowAspect'] ?? s['arrowAspect'] ?? 3;
    const textHeight = (this.textHeight ?? s.textHeight) * scaleFactor;
    const heightPx = textHeight * vm.scale;
    const arrowPx = arrowSize * vm.scale;

    const sv = vm.w2s(this.vertex.x, this.vertex.y);
    const sp1 = vm.w2s(this.p1.x, this.p1.y);
    const sp2 = vm.w2s(this.p2.x, this.p2.y);
    const sPlace = this.placePt ? vm.w2s(this.placePt.x, this.placePt.y) : sp2;

    const a1 = Math.atan2(sp1.y - sv.y, sp1.x - sv.x);
    const a2 = Math.atan2(sp2.y - sv.y, sp2.x - sv.x);
    const aP = Math.atan2(sPlace.y - sv.y, sPlace.x - sv.x);

    // Arc radius in screen space = distance from vertex to placePt
    const arcR = Math.hypot(sPlace.x - sv.x, sPlace.y - sv.y);
    if (arcR < 2) return;

    let dA2 = (a2 - a1) % (2 * Math.PI);
    if (dA2 < 0) dA2 += 2 * Math.PI;

    let dAP = (aP - a1) % (2 * Math.PI);
    if (dAP < 0) dAP += 2 * Math.PI;

    const canvasCcw = dAP >= dA2;

    // Arc end-points in screen space
    const arcP1 = { x: sv.x + Math.cos(a1) * arcR, y: sv.y + Math.sin(a1) * arcR };
    const arcP2 = { x: sv.x + Math.cos(a2) * arcR, y: sv.y + Math.sin(a2) * arcR };

    // Extension lines: from p1/p2 direction out to slightly beyond the arc
    const ext1Start = vm.w2s(this.p1.x, this.p1.y);
    const ext2Start = vm.w2s(this.p2.x, this.p2.y);
    const extPastPx = 4;
    const ext1End = { x: sv.x + Math.cos(a1) * (arcR + extPastPx), y: sv.y + Math.sin(a1) * (arcR + extPastPx) };
    const ext2End = { x: sv.x + Math.cos(a2) * (arcR + extPastPx), y: sv.y + Math.sin(a2) * (arcR + extPastPx) };

    ctx.beginPath();
    ctx.moveTo(sv.x, sv.y); ctx.lineTo(ext1Start.x, ext1Start.y);
    ctx.moveTo(sv.x, sv.y); ctx.lineTo(ext2Start.x, ext2Start.y);
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(ext1Start.x, ext1Start.y); ctx.lineTo(ext1End.x, ext1End.y);
    ctx.moveTo(ext2Start.x, ext2Start.y); ctx.lineTo(ext2End.x, ext2End.y);
    ctx.stroke();

    // Dimension arc
    ctx.beginPath();
    ctx.arc(sv.x, sv.y, arcR, a1, a2, canvasCcw);
    ctx.stroke();

    // Arrowheads: tangent to arc at each endpoint
    // If canvasCcw is false, angle is increasing (CW on screen). Tangent at a1 is +90 deg, at a2 is +90 deg.
    // If canvasCcw is true, angle is decreasing (CCW on screen). Tangent at a1 is -90 deg, at a2 is -90 deg.
    const dir = canvasCcw ? -1 : 1;
    const tan1 = { x: -Math.sin(a1) * dir, y: Math.cos(a1) * dir };
    // For arrowhead 2, it points towards the arc end, so tangent must point *into* the arc (opposite to drawing direction)
    const tan2 = { x: Math.sin(a2) * dir, y: -Math.cos(a2) * dir };

    drawArrowHead(ctx, arcP1, -tan1.x, -tan1.y, arrowPx, arrowType, arrowAspect);
    drawArrowHead(ctx, arcP2, -tan2.x, -tan2.y, arrowPx, arrowType, arrowAspect);

    // Text at arc midpoint
    const sweep = canvasCcw ? -(2 * Math.PI - dA2) : dA2;
    const midAngle = a1 + sweep / 2;
    const precision = this.unitPrecision ?? s.unitPrecision ?? 1;
    const angleDeg = Math.abs(sweep * 180 / Math.PI);
    const textVal = this.textOverride == null
      ? `${angleDeg.toFixed(precision)}\u00b0`
      : this.textOverride;

    ctx.font = `${heightPx}px sans-serif`;
    const tw = ctx.measureText(textVal).width;
    const tmx = sv.x + Math.cos(midAngle) * arcR;
    const tmy = sv.y + Math.sin(midAngle) * arcR;
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.translate(tmx, tmy);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.clearRect(-tw / 2 - 2, -heightPx / 2 - 2, tw + 4, heightPx + 4);
    ctx.fillText(textVal, 0, 0);
    ctx.restore();
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const sv = vm.w2s(this.vertex.x, this.vertex.y);
    const sp1 = vm.w2s(this.p1.x, this.p1.y);
    const sp2 = vm.w2s(this.p2.x, this.p2.y);
    const sPlace = this.placePt ? vm.w2s(this.placePt.x, this.placePt.y) : sp2;

    const a1 = Math.atan2(sp1.y - sv.y, sp1.x - sv.x);
    const a2 = Math.atan2(sp2.y - sv.y, sp2.x - sv.x);
    const aP = Math.atan2(sPlace.y - sv.y, sPlace.x - sv.x);

    const arcR = Math.hypot(sPlace.x - sv.x, sPlace.y - sv.y);
    if (arcR < 2) return false;

    let dA2 = (a2 - a1) % (2 * Math.PI);
    if (dA2 < 0) dA2 += 2 * Math.PI;
    let dAP = (aP - a1) % (2 * Math.PI);
    if (dAP < 0) dAP += 2 * Math.PI;

    const canvasCcw = dAP >= dA2;
    const sweep = canvasCcw ? -(2 * Math.PI - dA2) : dA2;
    const midAngle = a1 + sweep / 2;

    const tmx = sv.x + Math.cos(midAngle) * arcR;
    const tmy = sv.y + Math.sin(midAngle) * arcR;

    // Text area (approximate center point)
    if (Math.hypot(sx - tmx, sy - tmy) <= tol * 4) return true;

    // Arc line approximation
    const distToCenter = Math.hypot(sx - sv.x, sy - sv.y);
    if (Math.abs(distToCenter - arcR) <= tol) {
      const clickAng = Math.atan2(sy - sv.y, sx - sv.x);
      let dClick = (clickAng - a1) % (2 * Math.PI);
      if (dClick < 0) dClick += 2 * Math.PI;
      const clickSweep = canvasCcw ? (2 * Math.PI - dClick) % (2 * Math.PI) : dClick;
      const absSweep = Math.abs(sweep);
      if (clickSweep <= absSweep + 0.1) return true;
    }

    return false;
  }

  override snapPoints(): ISnapPoint[] {
    return [
      { x: this.vertex.x, y: this.vertex.y, label: 'vertex' },
      { x: this.p1.x, y: this.p1.y, label: 'p1' },
      { x: this.p2.x, y: this.p2.y, label: 'p2' },
    ];
  }

  override bbox(): IBBox {
    // Collect all candidate points: vertex, p1, p2, and placePt
    const pts: IPoint[] = [this.vertex, this.p1, this.p2];
    if (this.placePt) pts.push(this.placePt);

    // Radius of the dimension arc = distance from vertex to placePt (or p2 if no placePt)
    const refPt = this.placePt ?? this.p2;
    const r = Math.hypot(refPt.x - this.vertex.x, refPt.y - this.vertex.y);

    // The full bounding box is the vertex ± radius on all sides (safe worst-case)
    const xs = pts.map(p => p.x).concat([this.vertex.x - r, this.vertex.x + r]);
    const ys = pts.map(p => p.y).concat([this.vertex.y - r, this.vertex.y + r]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'styleName', label: 'Dim Style', type: 'dropdown', category: 'Style', options: ['Standard', 'ISO-25'] },
      { key: 'angleDeg', label: 'Angle', type: 'read-only', category: 'Geometry', value: `${this.angleDeg.toFixed(1)}\u00b0` },
      { key: 'textOverride', label: 'Text Override', type: 'text', category: 'Text' },
      { key: 'textHeight', label: 'Text Height', type: 'number', category: 'Text', precision: 2, step: 0.1, min: 0 },
      { key: 'arrowType', label: 'Arrow Type', type: 'dropdown', category: 'Arrows', options: ['closed', 'open', 'tick', 'dot', 'none'] },
      { key: 'arrowSize', label: 'Arrow Size', type: 'number', category: 'Arrows', precision: 2, step: 0.1, min: 0 },
    ];
  }
}

/* ---- ARC LENGTH DIMENSION ---- */
export class ArcLengthDimensionEntity extends Entity {
  center: IPoint;
  p1: IPoint;
  p2: IPoint;
  dimArcRadius: number;
  anchorArc: IDimAnchor | null = null;
  styleName = 'Standard';
  textOverride: string | null = null;
  textRotationOverride: number | null = null;
  arrowSize: number | null = null;
  arrowType: DimArrowType | null = null;
  textHeight: number | null = null;
  textOffset: number | null = null;
  unitFormat: DimUnitFormat | null = null;
  unitPrecision: number | null = null;
  unitPrefix: string | null = null;
  unitSuffix: string | null = null;
  decimalSeparator: '.' | ',' | null = null;
  suppressTrailingZeros: boolean | null = null;
  roundOff: number | null = null;
  isAnnotative = false;

  constructor(center: IPoint, p1: IPoint, p2: IPoint, dimArcRadius: number) {
    super('DIMARC');
    this.center = { ...center };
    this.p1 = { ...p1 };
    this.p2 = { ...p2 };
    this.dimArcRadius = dimArcRadius;
  }

  get arcRadius(): number {
    return Math.hypot(this.p1.x - this.center.x, this.p1.y - this.center.y);
  }

  get arcLength(): number {
    const a1 = Math.atan2(this.p1.y - this.center.y, this.p1.x - this.center.x);
    const a2 = Math.atan2(this.p2.y - this.center.y, this.p2.x - this.center.x);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    return Math.abs(sweep) * this.arcRadius;
  }

  private _resolveStyle(doc: any): DimensionStyle {
    if (!doc) return DEFAULT_DIM_STYLE;
    if (doc.dimStyles instanceof Map) return doc.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    if (doc.activeFile?.dimStyles instanceof Map) return doc.activeFile.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    return DEFAULT_DIM_STYLE;
  }

  private _resolveAnchors(doc: any): void {
    if (!this.anchorArc) return;
    let entities: any[] | undefined;
    if (doc?.entities && Array.isArray(doc.entities)) entities = doc.entities;
    else if (doc?.activeFile?.entities && Array.isArray(doc.activeFile.entities)) entities = doc.activeFile.entities;
    if (!entities) return;
    const ent = entities.find((e: any) => e && e.id === this.anchorArc!.entityId);
    if (!ent || ent.cx === undefined) return;
    this.center.x = ent.cx;
    this.center.y = ent.cy;
    const r = ent.r ?? ent.radius ?? this.arcRadius;
    const a1 = Math.atan2(this.p1.y - ent.cy, this.p1.x - ent.cx);
    const a2 = Math.atan2(this.p2.y - ent.cy, this.p2.x - ent.cx);
    this.p1 = { x: ent.cx + Math.cos(a1) * r, y: ent.cy + Math.sin(a1) * r };
    this.p2 = { x: ent.cx + Math.cos(a2) * r, y: ent.cy + Math.sin(a2) * r };
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    this._resolveAnchors(doc);
    this.setupContext(ctx, vm, doc, byBlockColor);
    const s = this._resolveStyle(doc);
    const scaleFactor = this.isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1;
    const arrowSize = (this.arrowSize ?? s.arrowSize) * scaleFactor;
    const arrowType = this.arrowType ?? s.arrowType;
    const arrowAspect = this['arrowAspect'] ?? s['arrowAspect'] ?? 3;
    const textHeight = (this.textHeight ?? s.textHeight) * scaleFactor;
    const heightPx = textHeight * vm.scale;
    const arrowPx = arrowSize * vm.scale;

    const sc = vm.w2s(this.center.x, this.center.y);
    const sp1 = vm.w2s(this.p1.x, this.p1.y);
    const sp2 = vm.w2s(this.p2.x, this.p2.y);

    const a1 = Math.atan2(sp1.y - sc.y, sp1.x - sc.x);
    const a2 = Math.atan2(sp2.y - sc.y, sp2.x - sc.x);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;

    const dimR = this.dimArcRadius * vm.scale;
    if (dimR < 2) return;

    const dimP1 = { x: sc.x + Math.cos(a1) * dimR, y: sc.y + Math.sin(a1) * dimR };
    const dimP2 = { x: sc.x + Math.cos(a2) * dimR, y: sc.y + Math.sin(a2) * dimR };
    const extPast = 4;

    // Extension lines from arc ends to dim arc
    ctx.beginPath();
    ctx.moveTo(sp1.x, sp1.y);
    ctx.lineTo(sc.x + Math.cos(a1) * (dimR + extPast), sc.y + Math.sin(a1) * (dimR + extPast));
    ctx.moveTo(sp2.x, sp2.y);
    ctx.lineTo(sc.x + Math.cos(a2) * (dimR + extPast), sc.y + Math.sin(a2) * (dimR + extPast));
    ctx.stroke();

    // Dimension arc
    const ccw = sweep < 0;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, dimR, a1, a2, ccw);
    ctx.stroke();

    // Arrowheads tangent to arc
    const tan1 = { x: -Math.sin(a1), y: Math.cos(a1) };
    const tan2 = { x: -Math.sin(a2), y: Math.cos(a2) };
    const dir = ccw ? -1 : 1;
    drawArrowHead(ctx, dimP1, -tan1.x * dir, -tan1.y * dir, arrowPx, arrowType, arrowAspect);
    drawArrowHead(ctx, dimP2, tan2.x * dir, tan2.y * dir, arrowPx, arrowType, arrowAspect);

    // Arc symbol above text (small arc ~8px radius)
    const midAngle = a1 + sweep / 2;
    const tmx = sc.x + Math.cos(midAngle) * dimR;
    const tmy = sc.y + Math.sin(midAngle) * dimR;
    const arcLen = this.arcLength;
    const measured = formatDimensionLength(arcLen, {
      format: this.unitFormat ?? s.unitFormat,
      precision: this.unitPrecision ?? s.unitPrecision,
      prefix: this.unitPrefix ?? s.unitPrefix,
      suffix: this.unitSuffix ?? s.unitSuffix,
      decimalSeparator: this.decimalSeparator ?? s.decimalSeparator,
      suppressTrailingZeros: this.suppressTrailingZeros ?? s.suppressTrailingZeros,
      roundOff: this.roundOff ?? s.roundOff,
    });
    const textStr = this.textOverride == null
      ? measured
      : this.textOverride.indexOf('<>') >= 0 ? this.textOverride.split('<>').join(measured) : this.textOverride;

    ctx.font = `${heightPx}px sans-serif`;
    const tw = ctx.measureText(textStr).width;
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.translate(tmx, tmy);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.clearRect(-tw / 2 - 2, -heightPx / 2 - 2, tw + 4, heightPx + 4);
    ctx.fillText(textStr, 0, 0);
    // Arc symbol (âŒ’) above text
    ctx.font = `${heightPx * 0.7}px sans-serif`;
    ctx.fillText('\u2312', 0, -heightPx);
    ctx.restore();
  }

  override snapPoints(): ISnapPoint[] {
    return [
      { x: this.center.x, y: this.center.y, label: 'center' },
      { x: this.p1.x, y: this.p1.y, label: 'arc-start' },
      { x: this.p2.x, y: this.p2.y, label: 'arc-end' },
    ];
  }

  override bbox(): IBBox {
    const xs = [this.center.x, this.p1.x, this.p2.x];
    const ys = [this.center.y, this.p1.y, this.p2.y];
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'styleName', label: 'Dim Style', type: 'dropdown', category: 'Style', options: ['Standard', 'ISO-25'] },
      { key: 'arcLength', label: 'Arc Length', type: 'read-only', category: 'Geometry', value: this.arcLength.toFixed(3) },
      { key: 'textOverride', label: 'Text Override', type: 'text', category: 'Text' },
      { key: 'textHeight', label: 'Text Height', type: 'number', category: 'Text', precision: 2, step: 0.1, min: 0 },
      { key: 'arrowType', label: 'Arrow Type', type: 'dropdown', category: 'Arrows', options: ['closed', 'open', 'tick', 'dot', 'none'] },
      { key: 'arrowSize', label: 'Arrow Size', type: 'number', category: 'Arrows', precision: 2, step: 0.1, min: 0 },
    ];
  }
}

/* ---- ORDINATE DIMENSION ---- */
export class OrdinateDimensionEntity extends Entity {
  featurePoint: IPoint;
  leaderEndPoint: IPoint;
  isXDatum: boolean;
  styleName = 'Standard';
  textOverride: string | null = null;
  textHeight: number | null = null;
  isAnnotative = false;

  constructor(featurePoint: IPoint, leaderEndPoint: IPoint, isXDatum: boolean) {
    super('DIMORDINATE');
    this.featurePoint = { ...featurePoint };
    this.leaderEndPoint = { ...leaderEndPoint };
    this.isXDatum = isXDatum;
  }

  get coordinateValue(): number {
    return this.isXDatum ? this.featurePoint.x : this.featurePoint.y;
  }

  private _resolveStyle(doc: any): DimensionStyle {
    if (!doc) return DEFAULT_DIM_STYLE;
    if (doc.dimStyles instanceof Map) return doc.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    if (doc.activeFile?.dimStyles instanceof Map) return doc.activeFile.dimStyles.get(this.styleName) ?? DEFAULT_DIM_STYLE;
    return DEFAULT_DIM_STYLE;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    this.setupContext(ctx, vm, doc, byBlockColor);
    const s = this._resolveStyle(doc);
    const scaleFactor = this.isAnnotative ? (1 / ((vm as any).annoScale || 1)) : 1;
    const textHeight = (this.textHeight ?? s.textHeight) * scaleFactor;
    const heightPx = textHeight * vm.scale;

    const sfp = vm.w2s(this.featurePoint.x, this.featurePoint.y);
    const slep = vm.w2s(this.leaderEndPoint.x, this.leaderEndPoint.y);

    const dx = slep.x - sfp.x;
    const dy = slep.y - sfp.y;

    // Dogleg leader: elbow is horizontal/vertical depending on ordinate type
    let elbow: { x: number; y: number };
    if (this.isXDatum) {
      // X ordinate: leader goes vertically from feature, then horizontally to end
      elbow = { x: sfp.x, y: slep.y };
    } else {
      // Y ordinate: leader goes horizontally from feature, then vertically to end
      elbow = { x: slep.x, y: sfp.y };
    }

    ctx.beginPath();
    ctx.moveTo(sfp.x, sfp.y);
    // If elbow is meaningful (offset from both endpoints), draw dogleg
    const needsElbow = Math.abs(dx) > 2 && Math.abs(dy) > 2;
    if (needsElbow) {
      ctx.lineTo(elbow.x, elbow.y);
    }
    ctx.lineTo(slep.x, slep.y);
    ctx.stroke();

    // Small marker dot at the feature point
    ctx.beginPath();
    ctx.arc(sfp.x, sfp.y, 2, 0, Math.PI * 2);
    ctx.fill();

    const coordVal = this.coordinateValue;
    const precision = s.unitPrecision ?? 3;
    const textStr = this.textOverride ?? coordVal.toFixed(precision);
    ctx.font = `${heightPx}px sans-serif`;
    const tw = ctx.measureText(textStr).width;

    ctx.save();
    ctx.fillStyle = ctx.strokeStyle as string;
    // Align text at leader end
    const textX = slep.x + (dx >= 0 ? 4 : -4);
    const textAlign: CanvasTextAlign = dx >= 0 ? 'left' : 'right';
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'middle';
    ctx.fillText(textStr, textX, slep.y);
    ctx.restore();
  }

  override snapPoints(): ISnapPoint[] {
    return [
      { x: this.featurePoint.x, y: this.featurePoint.y, label: 'feature' },
      { x: this.leaderEndPoint.x, y: this.leaderEndPoint.y, label: 'leader-end' },
    ];
  }

  override bbox(): IBBox {
    const xs = [this.featurePoint.x, this.leaderEndPoint.x];
    const ys = [this.featurePoint.y, this.leaderEndPoint.y];
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'styleName', label: 'Dim Style', type: 'dropdown', category: 'Style', options: ['Standard', 'ISO-25'] },
      { key: 'coordinateValue', label: 'Value', type: 'read-only', category: 'Geometry', value: this.coordinateValue.toFixed(3) },
      { key: 'isXDatum', label: 'X Datum', type: 'boolean', category: 'Geometry' },
      { key: 'textOverride', label: 'Text Override', type: 'text', category: 'Text' },
      { key: 'textHeight', label: 'Text Height', type: 'number', category: 'Text', precision: 2, step: 0.1, min: 0 },
    ];
  }
}
