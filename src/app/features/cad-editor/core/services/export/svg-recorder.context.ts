/**
 * SvgRecorderContext — a drop-in `CanvasRenderingContext2D` work-alike that
 * records drawing operations as **vector** SVG instead of rasterising them.
 *
 * The whole point: the editor's entity `draw(ctx, vm, file)` routines target a
 * 2D canvas context. By feeding them this recorder instead of a real canvas we
 * get a resolution-independent SVG that is visually identical to the on-screen
 * render and the PNG/PDF plot — every line, arc, dimension and hatch becomes a
 * crisp `<path>`/`<text>` element editable in Illustrator, Figma or Inkscape.
 *
 * Design notes:
 *   - A backing real canvas context provides correct `measureText` metrics and
 *     `font` parsing so text layout (centering, wrapping) matches the editor.
 *   - The current transform matrix (CTM) is tracked manually; path geometry is
 *     baked into absolute SVG coordinates at the time each point is added
 *     (the canvas2svg approach), so mid-path transforms behave correctly.
 *   - Curved primitives (arc / ellipse / bezier) are tessellated into polylines
 *     — still fully vector, just expressed as line segments, which sidesteps
 *     elliptical-arc flag math under arbitrary transforms.
 *   - Text is emitted as a native `<text>` element carrying the CTM as a
 *     `transform` attribute, preserving editability and exact placement.
 *
 * Only the subset of the canvas API actually exercised by the entity draw
 * pipeline is implemented. Unsupported operations (e.g. `clip`) degrade to a
 * no-op rather than throwing.
 */

type Mat = { a: number; b: number; c: number; d: number; e: number; f: number };

interface RecorderState {
  m: Mat;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineDash: number[];
  lineDashOffset: number;
  clipId: string | null;
}

interface SubPath {
  pts: Array<{ x: number; y: number }>;
}

/**
 * Recording stand-in for the native `Path2D`. The hatch renderer builds
 * boundary paths with `new Path2D()` and later passes them to
 * `ctx.fill(path)` / `ctx.clip(path)`. Because a native Path2D exposes no way
 * to read back its geometry, the SVG exporter temporarily swaps the global
 * `Path2D` for this class during a render so the recorder can reconstruct the
 * boundary as SVG. Coordinates are captured in the same screen space the
 * hatch already projects into (via `vm.w2s`).
 */
export class RecordingPath2D {
  subpaths: SubPath[] = [];
  private cur: SubPath | null = null;

  private push(x: number, y: number): void {
    if (!this.cur) { this.cur = { pts: [] }; this.subpaths.push(this.cur); }
    this.cur.pts.push({ x, y });
  }
  moveTo(x: number, y: number): void { this.cur = { pts: [{ x, y }] }; this.subpaths.push(this.cur); }
  lineTo(x: number, y: number): void { this.push(x, y); }
  closePath(): void { if (this.cur && this.cur.pts.length) this.cur.pts.push({ ...this.cur.pts[0] }); }
  rect(x: number, y: number, w: number, h: number): void {
    this.subpaths.push({ pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }] });
    this.cur = null;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    let start = a0, end = a1;
    if (!ccw && end < start) end += Math.PI * 2;
    if (ccw && end > start) end -= Math.PI * 2;
    const segs = Math.max(8, Math.ceil((Math.abs(end - start) / (Math.PI * 2)) * 64));
    for (let i = 0; i <= segs; i++) {
      const t = start + ((end - start) * i) / segs;
      this.push(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    let start = a0, end = a1;
    if (!ccw && end < start) end += Math.PI * 2;
    if (ccw && end > start) end -= Math.PI * 2;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const segs = 64;
    for (let i = 0; i <= segs; i++) {
      const t = start + ((end - start) * i) / segs;
      const ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
      this.push(cx + ex * cos - ey * sin, cy + ex * sin + ey * cos);
    }
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    const p0 = this.cur?.pts.slice(-1)[0] ?? { x: cpx, y: cpy };
    const segs = 18;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, mt = 1 - t;
      this.push(mt * mt * p0.x + 2 * mt * t * cpx + t * t * x, mt * mt * p0.y + 2 * mt * t * cpy + t * t * y);
    }
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const p0 = this.cur?.pts.slice(-1)[0] ?? { x: c1x, y: c1y };
    const segs = 24;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, mt = 1 - t;
      this.push(
        mt * mt * mt * p0.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x,
        mt * mt * mt * p0.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y,
      );
    }
  }
  arcTo(x1: number, y1: number, x2: number, y2: number): void { this.push(x1, y1); this.push(x2, y2); }
  addPath(p: RecordingPath2D): void {
    for (const sp of p.subpaths) this.subpaths.push({ pts: sp.pts.map((q) => ({ ...q })) });
    this.cur = null;
  }
}

const IDENT: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function mul(m: Mat, l: Mat): Mat {
  return {
    a: m.a * l.a + m.c * l.b,
    b: m.b * l.a + m.d * l.b,
    c: m.a * l.c + m.c * l.d,
    d: m.b * l.c + m.d * l.d,
    e: m.a * l.e + m.c * l.f + m.e,
    f: m.b * l.e + m.d * l.f + m.f,
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function n(v: number): string {
  // Trim to 3 decimals; keep file size sane without visible loss.
  return (Math.round(v * 1000) / 1000).toString();
}

export class SvgRecorderContext {
  /** Accumulated SVG element strings (without the outer <svg> wrapper). */
  private body: string[] = [];
  private defs: string[] = [];
  private clipCounter = 0;
  private state: RecorderState;
  private stack: RecorderState[] = [];
  private current: SubPath[] = [];
  private measureCtx: CanvasRenderingContext2D;

  // Public canvas-context-compatible properties (proxied to state).
  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = 'high';
  readonly canvas: { width: number; height: number };

  constructor(width: number, height: number) {
    this.canvas = { width, height };
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    this.measureCtx = c.getContext('2d')!;
    this.state = {
      m: { ...IDENT },
      strokeStyle: '#000000',
      fillStyle: '#000000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      globalAlpha: 1,
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      lineDash: [],
      lineDashOffset: 0,
      clipId: null,
    };
  }

  /* ─── state-bridged properties ─────────────────────────────────────────── */
  get strokeStyle() { return this.state.strokeStyle; }
  set strokeStyle(v: any) { this.state.strokeStyle = colorToCss(v); }
  get fillStyle() { return this.state.fillStyle; }
  set fillStyle(v: any) { this.state.fillStyle = colorToCss(v); }
  get lineWidth() { return this.state.lineWidth; }
  set lineWidth(v: number) { this.state.lineWidth = v; }
  get lineCap() { return this.state.lineCap; }
  set lineCap(v: CanvasLineCap) { this.state.lineCap = v; }
  get lineJoin() { return this.state.lineJoin; }
  set lineJoin(v: CanvasLineJoin) { this.state.lineJoin = v; }
  get miterLimit() { return this.state.miterLimit; }
  set miterLimit(v: number) { this.state.miterLimit = v; }
  get globalAlpha() { return this.state.globalAlpha; }
  set globalAlpha(v: number) { this.state.globalAlpha = v; }
  get font() { return this.state.font; }
  set font(v: string) { this.state.font = v; this.measureCtx.font = v; }
  get textAlign() { return this.state.textAlign; }
  set textAlign(v: CanvasTextAlign) { this.state.textAlign = v; }
  get textBaseline() { return this.state.textBaseline; }
  set textBaseline(v: CanvasTextBaseline) { this.state.textBaseline = v; }
  get lineDashOffset() { return this.state.lineDashOffset; }
  set lineDashOffset(v: number) { this.state.lineDashOffset = v; }

  /* ─── transform stack ──────────────────────────────────────────────────── */
  save(): void { this.stack.push({ ...this.state, m: { ...this.state.m }, lineDash: [...this.state.lineDash] }); }
  restore(): void { const s = this.stack.pop(); if (s) this.state = s; }
  translate(x: number, y: number): void { this.state.m = mul(this.state.m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }); }
  rotate(rad: number): void {
    const cos = Math.cos(rad), sin = Math.sin(rad);
    this.state.m = mul(this.state.m, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
  }
  scale(sx: number, sy: number): void { this.state.m = mul(this.state.m, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }); }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.m = mul(this.state.m, { a, b, c, d, e, f });
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.m = { a, b, c, d, e, f };
  }
  resetTransform(): void { this.state.m = { ...IDENT }; }

  setLineDash(arr: number[]): void { this.state.lineDash = Array.isArray(arr) ? arr.slice() : []; }
  getLineDash(): number[] { return this.state.lineDash.slice(); }

  /* ─── path building (points baked through current CTM) ─────────────────── */
  private pt(x: number, y: number): { x: number; y: number } {
    const m = this.state.m;
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }

  beginPath(): void { this.current = []; }
  closePath(): void {
    const sp = this.current[this.current.length - 1];
    if (sp && sp.pts.length) sp.pts.push({ ...sp.pts[0] });
  }
  moveTo(x: number, y: number): void { this.current.push({ pts: [this.pt(x, y)] }); }
  lineTo(x: number, y: number): void {
    if (!this.current.length) this.current.push({ pts: [] });
    this.current[this.current.length - 1].pts.push(this.pt(x, y));
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.current.push({ pts: [this.pt(x, y), this.pt(x + w, y), this.pt(x + w, y + h), this.pt(x, y + h), this.pt(x, y)] });
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    const sp = this.current[this.current.length - 1];
    if (!sp || !sp.pts.length) { this.moveTo(cp1x, cp1y); }
    const start = this.current[this.current.length - 1].pts.slice(-1)[0];
    // tessellate in *local* space then bake — reuse pt() per sample.
    const p0 = this.unpt(start);
    const segs = 24;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, mt = 1 - t;
      const bx = mt * mt * mt * p0.x + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x;
      const by = mt * mt * mt * p0.y + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y;
      this.lineTo(bx, by);
    }
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    const sp = this.current[this.current.length - 1];
    if (!sp || !sp.pts.length) this.moveTo(cpx, cpy);
    const start = this.current[this.current.length - 1].pts.slice(-1)[0];
    const p0 = this.unpt(start);
    const segs = 18;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, mt = 1 - t;
      const bx = mt * mt * p0.x + 2 * mt * t * cpx + t * t * x;
      const by = mt * mt * p0.y + 2 * mt * t * cpy + t * t * y;
      this.lineTo(bx, by);
    }
  }

  /** Invert the CTM to recover local coords for tessellation continuity. */
  private unpt(p: { x: number; y: number }): { x: number; y: number } {
    const m = this.state.m;
    const det = m.a * m.d - m.b * m.c;
    if (Math.abs(det) < 1e-12) return { x: p.x, y: p.y };
    const ix = (p.x - m.e), iy = (p.y - m.f);
    return { x: (ix * m.d - iy * m.c) / det, y: (-ix * m.b + iy * m.a) / det };
  }

  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    const segs = Math.max(8, Math.min(360, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 180) || 32));
    let start = a0, end = a1;
    if (!ccw && end < start) end += Math.PI * 2;
    if (ccw && end > start) end -= Math.PI * 2;
    if (!this.current.length) this.current.push({ pts: [] });
    for (let i = 0; i <= segs; i++) {
      const t = start + ((end - start) * i) / segs;
      this.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    const segs = 64;
    let start = a0, end = a1;
    if (!ccw && end < start) end += Math.PI * 2;
    if (ccw && end > start) end -= Math.PI * 2;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    if (!this.current.length) this.current.push({ pts: [] });
    for (let i = 0; i <= segs; i++) {
      const t = start + ((end - start) * i) / segs;
      const ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
      this.lineTo(cx + ex * cos - ey * sin, cy + ex * sin + ey * cos);
    }
  }
  arcTo(x1: number, y1: number, x2: number, _y2: number): void {
    // Approximate: straight segments to the control points (rare in this engine).
    this.lineTo(x1, y1);
    this.lineTo(x2, _y2);
  }

  /* ─── stroking / filling ───────────────────────────────────────────────── */
  private pathData(): string {
    const out: string[] = [];
    for (const sp of this.current) {
      if (!sp.pts.length) continue;
      out.push(`M ${n(sp.pts[0].x)} ${n(sp.pts[0].y)}`);
      for (let i = 1; i < sp.pts.length; i++) out.push(`L ${n(sp.pts[i].x)} ${n(sp.pts[i].y)}`);
    }
    return out.join(' ');
  }

  /** Build path data from a captured RecordingPath2D, baked through the CTM. */
  private recordedPathData(p: RecordingPath2D): string {
    const out: string[] = [];
    for (const sp of p.subpaths) {
      if (!sp.pts.length) continue;
      const p0 = this.pt(sp.pts[0].x, sp.pts[0].y);
      out.push(`M ${n(p0.x)} ${n(p0.y)}`);
      for (let i = 1; i < sp.pts.length; i++) {
        const q = this.pt(sp.pts[i].x, sp.pts[i].y);
        out.push(`L ${n(q.x)} ${n(q.y)}`);
      }
    }
    return out.join(' ');
  }

  private clipAttr(): string {
    return this.state.clipId ? ` clip-path="url(#${this.state.clipId})"` : '';
  }

  stroke(path?: RecordingPath2D): void {
    const d = path instanceof RecordingPath2D ? this.recordedPathData(path) : this.pathData();
    if (!d) return;
    const s = this.state;
    // Scale lineWidth by average CTM scale so stroke thickness matches canvas.
    const sc = Math.sqrt(Math.abs(s.m.a * s.m.d - s.m.b * s.m.c)) || 1;
    const attrs = [
      `d="${d}"`,
      `fill="none"`,
      `stroke="${esc(s.strokeStyle)}"`,
      `stroke-width="${n(Math.max(0.0001, s.lineWidth * sc))}"`,
      `stroke-linecap="${s.lineCap}"`,
      `stroke-linejoin="${s.lineJoin}"`,
    ];
    if (s.miterLimit !== 10) attrs.push(`stroke-miterlimit="${n(s.miterLimit)}"`);
    if (s.lineDash.length) attrs.push(`stroke-dasharray="${s.lineDash.map((x) => n(x * sc)).join(',')}"`);
    if (s.lineDashOffset) attrs.push(`stroke-dashoffset="${n(s.lineDashOffset * sc)}"`);
    if (s.globalAlpha < 1) attrs.push(`stroke-opacity="${n(s.globalAlpha)}"`);
    this.body.push(`<path${this.clipAttr()} ${attrs.join(' ')}/>`);
  }

  fill(arg?: CanvasFillRule | RecordingPath2D, rule?: CanvasFillRule): void {
    let d: string;
    let evenOdd: boolean;
    if (arg instanceof RecordingPath2D) {
      d = this.recordedPathData(arg);
      evenOdd = rule === 'evenodd';
    } else {
      d = this.pathData();
      evenOdd = arg === 'evenodd';
    }
    if (!d) return;
    const s = this.state;
    const attrs = [`d="${d}"`, `fill="${esc(s.fillStyle)}"`, `stroke="none"`];
    if (evenOdd) attrs.push(`fill-rule="evenodd"`);
    if (s.globalAlpha < 1) attrs.push(`fill-opacity="${n(s.globalAlpha)}"`);
    this.body.push(`<path${this.clipAttr()} ${attrs.join(' ')}/>`);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const saved = this.current;
    this.current = [{ pts: [this.pt(x, y), this.pt(x + w, y), this.pt(x + w, y + h), this.pt(x, y + h), this.pt(x, y)] }];
    this.fill();
    this.current = saved;
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    const saved = this.current;
    this.current = [{ pts: [this.pt(x, y), this.pt(x + w, y), this.pt(x + w, y + h), this.pt(x, y + h), this.pt(x, y)] }];
    this.stroke();
    this.current = saved;
  }
  clearRect(): void { /* SVG has no clear; background fill handled by exporter. */ }

  /* ─── text ─────────────────────────────────────────────────────────────── */
  measureText(text: string): TextMetrics {
    this.measureCtx.font = this.state.font;
    return this.measureCtx.measureText(text);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.emitText(text, x, y, this.state.fillStyle, 'none', maxWidth);
  }
  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    this.emitText(text, x, y, 'none', this.state.strokeStyle, maxWidth);
  }

  private emitText(text: string, x: number, y: number, fill: string, stroke: string, maxWidth?: number): void {
    if (text == null || text === '') return;
    const s = this.state;
    const { sizePx, family, weight, style } = parseFont(s.font);
    const anchor = s.textAlign === 'left' || s.textAlign === 'start' ? 'start'
      : s.textAlign === 'right' || s.textAlign === 'end' ? 'end' : 'middle';
    const baseline =
      s.textBaseline === 'top' || s.textBaseline === 'hanging' ? 'text-before-edge'
      : s.textBaseline === 'middle' ? 'central'
      : s.textBaseline === 'bottom' || s.textBaseline === 'ideographic' ? 'text-after-edge'
      : 'alphabetic';
    const m = s.m;
    const attrs = [
      `x="${n(x)}"`,
      `y="${n(y)}"`,
      `transform="matrix(${n(m.a)} ${n(m.b)} ${n(m.c)} ${n(m.d)} ${n(m.e)} ${n(m.f)})"`,
      `font-family="${esc(family)}"`,
      `font-size="${n(sizePx)}"`,
      `text-anchor="${anchor}"`,
      `dominant-baseline="${baseline}"`,
    ];
    if (weight && weight !== 'normal') attrs.push(`font-weight="${weight}"`);
    if (style && style !== 'normal') attrs.push(`font-style="${style}"`);
    if (fill !== 'none') attrs.push(`fill="${esc(fill)}"`); else attrs.push('fill="none"');
    if (stroke !== 'none') { attrs.push(`stroke="${esc(stroke)}"`); attrs.push(`stroke-width="${n(Math.max(0.0001, s.lineWidth))}"`); }
    if (maxWidth && maxWidth > 0) attrs.push(`textLength="${n(maxWidth)}"`);
    if (s.globalAlpha < 1) attrs.push(`opacity="${n(s.globalAlpha)}"`);
    this.body.push(`<text${this.clipAttr()} ${attrs.join(' ')}>${esc(text)}</text>`);
  }

  /* ─── images ───────────────────────────────────────────────────────────── */
  drawImage(img: any, dx: number, dy: number, dw?: number, dh?: number): void {
    let href = '';
    try {
      if (img instanceof HTMLImageElement) href = img.src;
      else if (typeof img?.toDataURL === 'function') href = img.toDataURL('image/png');
      else if (img?.src) href = img.src;
    } catch { /* tainted canvas — skip */ }
    if (!href) return;
    const w = dw ?? img.width ?? 0;
    const h = dh ?? img.height ?? 0;
    const m = this.state.m;
    this.body.push(
      `<image${this.clipAttr()} x="${n(dx)}" y="${n(dy)}" width="${n(w)}" height="${n(h)}" ` +
        `transform="matrix(${n(m.a)} ${n(m.b)} ${n(m.c)} ${n(m.d)} ${n(m.e)} ${n(m.f)})" ` +
        `preserveAspectRatio="none" href="${esc(href)}"/>`,
    );
  }

  /* ─── clipping ─────────────────────────────────────────────────────────── */
  /**
   * Register a clip region. Accepts either a captured {@link RecordingPath2D}
   * (hatch pattern boundary) or, when called argument-less, the current path
   * (table cells / viewports). The clip stays active until the next
   * `restore()` pops the state that owns it.
   */
  clip(arg?: CanvasFillRule | RecordingPath2D, rule?: CanvasFillRule): void {
    let d: string;
    let evenOdd: boolean;
    if (arg instanceof RecordingPath2D) {
      d = this.recordedPathData(arg);
      evenOdd = rule === 'evenodd';
    } else {
      d = this.pathData();
      evenOdd = arg === 'evenodd';
    }
    if (!d) { this.state.clipId = null; return; }
    const id = `clip${++this.clipCounter}`;
    this.defs.push(
      `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">` +
        `<path d="${d}"${evenOdd ? ' clip-rule="evenodd"' : ''}/></clipPath>`,
    );
    this.state.clipId = id;
  }

  /* ─── no-ops / stubs for unused API surface ────────────────────────────── */
  createLinearGradient(): any { return makeFakeGradient(); }
  createRadialGradient(): any { return makeFakeGradient(); }
  createPattern(): any { return null; }

  /* ─── output ───────────────────────────────────────────────────────────── */
  toSvg(backgroundCss: string | null): string {
    const w = this.canvas.width, h = this.canvas.height;
    const bg = backgroundCss ? `<rect x="0" y="0" width="${w}" height="${h}" fill="${esc(backgroundCss)}"/>` : '';
    const defs = this.defs.length ? `<defs>\n${this.defs.join('\n')}\n</defs>\n` : '';
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
      defs +
      bg +
      this.body.join('\n') +
      `\n</svg>\n`
    );
  }
}

function makeFakeGradient() {
  const g: any = { addColorStop: () => {} };
  return g;
}

function colorToCss(v: any): string {
  if (typeof v === 'string') return v;
  return '#000000';
}

function parseFont(font: string): { sizePx: number; family: string; weight: string; style: string } {
  // Handles "italic bold 12px Arial", "12px sans-serif", "bold 10pt serif".
  let weight = 'normal', style = 'normal';
  let sizePx = 10, family = 'sans-serif';
  const tokens = font.trim().split(/\s+/);
  const familyParts: string[] = [];
  let sizeFound = false;
  for (const tk of tokens) {
    if (!sizeFound && (tk === 'italic' || tk === 'oblique')) { style = 'italic'; continue; }
    if (!sizeFound && (tk === 'bold' || /^[1-9]00$/.test(tk) || tk === 'bolder' || tk === 'lighter')) { weight = tk; continue; }
    if (!sizeFound && tk === 'normal') continue;
    const mm = tk.match(/^([\d.]+)(px|pt)?/);
    if (!sizeFound && mm) {
      const val = parseFloat(mm[1]);
      sizePx = mm[2] === 'pt' ? val * (96 / 72) : val;
      sizeFound = true;
      continue;
    }
    if (sizeFound) familyParts.push(tk);
  }
  if (familyParts.length) family = familyParts.join(' ').replace(/['"]/g, '');
  return { sizePx, family, weight, style };
}
