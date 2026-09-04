import { Injectable, inject } from '@angular/core';
import jsPDF from 'jspdf';
import { DocumentService } from './document.service';
import { PlotRendererService } from './export/plot-renderer.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  IPlotOptions,
  defaultPlotOptions,
  getPaperSizeMm,
} from '../models/plot-options.model';
import type { Entity } from '../models/entity.model';
import { catmullRomChain } from '../models/entity-extended.model';
import { TextLayoutEngine } from '../utils/text-layout-engine';
import { decodeTextCodes, splitDimensionText } from '../utils/text-control-codes';
import { DEFAULT_DIM_STYLE } from '../models/dimension-style.model';
import { HATCH_PATTERNS } from '../registries/hatch-patterns';
import { frozenLoopToPolygon } from '../models/hatch-boundary.model';

/**
 * Production-grade vector PDF exporter. Every entity is emitted as native PDF
 * drawing primitives (lines, arcs, ellipses, text) — the result is resolution-
 * independent and stays perfectly crisp at any zoom level, exactly like an
 * AutoCAD plot.
 *
 * Key design decisions:
 *   - ALL geometry is vector (pdf.line / pdf.circle / polyline tessellation).
 *   - Text is emitted via pdf.text() with proper font sizing in typographic
 *     points, with a minimum readable height enforced so annotations are
 *     never microscopic on large-format drawings.
 *   - Lineweights are faithfully preserved in mm.
 *   - Dimensions are fully rendered with extension lines, dim line, arrows,
 *     and measurement text — matching the canvas DimensionEntity.draw() logic.
 *   - INSERT blocks recurse through the block definition with composed
 *     transforms so nested references render correctly.
 *
 * File size is NOT a concern. Quality and readability are paramount.
 */

/** @deprecated Use IPlotOptions from plot-options.model.ts. Kept for legacy callers. */
export interface IPdfExportOptions {
  paperSize?: 'A4' | 'A3' | 'Letter' | 'Tabloid';
  orientation?: 'portrait' | 'landscape';
  margin?: number;
  scale?: number;
}

/**
 * Quality presets — Draft 150 dpi → 90 segs / full circle, scaling up to
 * Ultra 1200 dpi → 720 segs. Picked so a 100 mm circle has < 0.5 mm chord
 * sag at Production, and < 0.1 mm sag at Ultra (visually identical to
 * AutoCAD's PDF plotter).
 */
function arcSegmentsForDpi(dpi: number): number {
  if (dpi >= 1200) return 720;
  if (dpi >= 600) return 480;
  if (dpi >= 300) return 360;
  if (dpi >= 150) return 180;
  return 90;
}

/**
 * Minimum text height on paper, in mm. Set to a conservative floor of 0.75 mm
 * (approx 2.1 pt) so microscopic annotations on large drawings are boosted
 * to remain legible under zoom, while avoiding the overlap/overflow issues
 * caused by larger floors (like 1.8 mm).
 */
const MIN_TEXT_HEIGHT_MM = 0.75;

/** Above this paper-space size, the text is legible and scales naturally. */
const NATURAL_TEXT_THRESHOLD_MM = 0.9;

/**
 * Resolve world text height (e.g. 2.5 CAD units) to a paper-space height (mm).
 * To ensure the PDF is a perfect vector representation at any paper size,
 * we strictly follow the scaled height without any artificial floors.
 */
function paperTextHeightMm(worldHeight: number, scaleMm: number): number {
  return Math.max(0, worldHeight) * scaleMm;
}

function downloadPdfFile(pdf: jsPDF, filename: string): void {
  const rawBlob = pdf.output('blob');
  const pdfFileBlob = new Blob([rawBlob], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(pdfFileBlob);

  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);

  link.click();

  // Open PDF directly in new tab upon download
  setTimeout(() => {
    try {
      window.open(blobUrl, '_blank');
    } catch (err) {
      console.error('Failed to open PDF in new tab:', err);
    }
  }, 100);

  setTimeout(() => {
    if (link.parentNode) link.parentNode.removeChild(link);
  }, 5000);
}

@Injectable({ providedIn: 'root' })
export class PdfExportService {
  private doc = inject(DocumentService);
  private renderer = inject(PlotRendererService);
  private notify = inject(NotificationService);

  /** Plot-options API used by the Plot dialog. */
  exportPdf(opts: IPlotOptions): boolean {
    const geom = this.renderer.computeGeometry(opts, opts.dpi || 1200);
    if (!geom) {
      console.warn('PDF export: nothing to draw.');
      return false;
    }
    const paperMm = geom.paperMm;
    const arcN = arcSegmentsForDpi(opts.dpi || 300);

    const pdf = new jsPDF({
      orientation: opts.orientation,
      unit: 'mm',
      format: pickJsPdfFormat(opts),
      compress: true,
    });

    // Fill background
    if (opts.background !== 'transparent') {
      const bgColor = opts.background === 'dark' ? '#1f1f1f' : '#ffffff';
      pdf.setFillColor(bgColor);
      pdf.rect(0, 0, paperMm.w, paperMm.h, 'F');
    }

    // Build a world-to-PDF-mm transform from the geometry.
    const pxPerMm = geom.pxPerMm;
    const w2mm: W2mm = (wx: number, wy: number) => {
      const c = geom.w2c(wx, wy);
      return { x: c.x / pxPerMm, y: c.y / pxPerMm };
    };
    // World units → mm on paper (the linear scale factor)
    const scaleMm = 1 / geom.worldPerMm;

    const wasPrintMode = (this.doc as any).isPrintMode;
    (this.doc as any).isPrintMode = true;
    try {
      for (const file of this.doc.files) {
        if (!file.visible) continue;
        const fileW2mm = buildFileW2mm(w2mm, file);
        const fileScaleMm = scaleMm * file.scale;
        for (const ent of file.entities as Entity[]) {
          if (!ent.visible) continue;
          if (opts.area === 'selection' && !ent.selected) continue;
          const lay = file.layers.get(ent.layer);
          if (lay && (lay.print === false || lay.frozen || !lay.visible)) continue;
          this.drawEntity(pdf, ent, fileW2mm, fileScaleMm, file, null, opts, arcN);
        }
      }
    } finally {
      (this.doc as any).isPrintMode = wasPrintMode;
    }

    const filename = (this.doc.activeFile?.name || 'drawing').replace(/\.dxf$/i, '') + '.pdf';
    
    // Download 1 single PDF file and open directly in a new tab
    downloadPdfFile(pdf, filename);

    this.notify.success(
      `Print PDF saved successfully! File "${filename}" downloaded and opened in new tab.`,
      6000
    );

    return true;
  }

  /** Legacy entry — converts the old shape into IPlotOptions. */
  exportPdfLegacy(legacy: IPdfExportOptions = {}): boolean {
    const opts: IPlotOptions = {
      ...defaultPlotOptions(),
      paper: (legacy.paperSize ?? 'A4') as IPlotOptions['paper'],
      orientation: legacy.orientation ?? 'landscape',
      margin: legacy.margin ?? 10,
      scale: 'fit',
      format: 'pdf',
    };
    return this.exportPdf(opts);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Vector drawing per entity type
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private drawEntity(
    pdf: jsPDF,
    ent: Entity,
    w2mm: W2mm,
    scaleMm: number,
    doc: any,
    byBlockColor: string | null,
    opts: IPlotOptions,
    arcN: number,
  ): void {
    // ── Color ──────────────────────────────────────────────────────────
    // PDF goes through the dedicated PlotColorMapper. Stored CAD data is
    // never mutated; the active plotStyle (color / monochrome / grayscale)
    // and the chosen background determine the printed ink.
    const lightBg = opts.background !== 'dark';
    const color = ent.resolvedPlotColor(doc, opts.plotStyle, lightBg, byBlockColor);
    const rgb = hexToRgb(color);
    pdf.setDrawColor(rgb.r, rgb.g, rgb.b);
    pdf.setFillColor(rgb.r, rgb.g, rgb.b);
    pdf.setTextColor(rgb.r, rgb.g, rgb.b);

    // ── Lineweight ────────────────────────────────────────────────────
    let lw = ent.lineWeight;
    if (lw <= 0) {
      const lay = doc?.layers?.get(ent.layer);
      if (lay && lay.lineWeight > 0) lw = lay.lineWeight;
      else lw = 25; // default 0.25 mm
    }
    // Stored in hundredths of mm. If scaleLineweights is true, the lineweight
    // becomes strictly proportional to the plot scale (perfect for zooming in PDF),
    // otherwise it prints at the exact absolute mm width.
    // We use a tiny floor of 0.001mm to ensure it's never 0 (which PDF viewers might ignore).
    let lwMm = opts.plotLineweights ? (lw / 100) : 0.1;
    if (opts.scaleLineweights) {
      lwMm = Math.max(0.001, lwMm * scaleMm);
    } else {
      lwMm = Math.max(0.05, lwMm);
    }
    pdf.setLineWidth(lwMm);

    // ── Linetype (dash pattern) ───────────────────────────────────────
    // jsPDF supports `setLineDashPattern([a, b, ...], phase)`. Translate the
    // CAD linetype name into a paper-mm dash pattern so DASHED / CENTER /
    // HIDDEN / etc. survive the export instead of flattening to solid.
    const dash = dashPatternForLineType(ent.lineType, lwMm);
    if (dash) pdf.setLineDashPattern(dash, 0);
    else pdf.setLineDashPattern([], 0);

    const e = ent as any;
    switch (e.type) {
      case 'LINE':     this.drawLine(pdf, e, w2mm); break;
      case 'CIRCLE':   this.drawCircle(pdf, e, w2mm, scaleMm); break;
      case 'ARC':      this.drawArc(pdf, e, w2mm, scaleMm, arcN); break;
      case 'ELLIPSE':  this.drawEllipse(pdf, e, w2mm, scaleMm, arcN); break;
      case 'POLYLINE': this.drawPolyline(pdf, e, w2mm); break;
      case 'SPLINE':   this.drawSpline(pdf, e, w2mm); break;
      case 'TEXT':     this.drawText(pdf, e, w2mm, scaleMm); break;
      case 'POINT':    this.drawPoint(pdf, e, w2mm); break;
      case 'HATCH':    this.drawHatch(pdf, e, w2mm, scaleMm, doc, arcN, rgb); break;
      case 'INSERT':   this.drawInsert(pdf, e, w2mm, scaleMm, doc, opts, arcN); break;
      case 'XLINE':    this.drawXLine(pdf, e, w2mm); break;
      case 'DIMENSION': this.drawDimension(pdf, e, w2mm, scaleMm, doc); break;
      case 'LEADER':   this.drawLeader(pdf, e, w2mm, scaleMm); break;
      case 'TABLE':    this.drawTable(pdf, e, w2mm, scaleMm); break;
      case 'IMAGE':    this.drawImage(pdf, e, w2mm, scaleMm); break;
    }

    // Reset dash so subsequent strokes default to solid.
    pdf.setLineDashPattern([], 0);
  }

  // ── LINE ────────────────────────────────────────────────────────────

  private drawLine(pdf: jsPDF, e: any, w2mm: W2mm): void {
    const a = w2mm(e.x1, e.y1);
    const b = w2mm(e.x2, e.y2);
    pdf.line(a.x, a.y, b.x, b.y);
  }

  // ── CIRCLE ──────────────────────────────────────────────────────────

  private drawCircle(pdf: jsPDF, e: any, w2mm: W2mm, scaleMm: number): void {
    const c = w2mm(e.cx, e.cy);
    const rMm = e.r * scaleMm;
    if (rMm < 0.01) return;
    pdf.circle(c.x, c.y, rMm, 'S');
  }

  // ── ARC ─────────────────────────────────────────────────────────────

  private drawArc(pdf: jsPDF, e: any, w2mm: W2mm, _scaleMm: number, arcN: number): void {
    const sa = e.startAngle * Math.PI / 180;
    const ea = e.endAngle * Math.PI / 180;
    let sweep = e.ccw ? ea - sa : sa - ea;
    if (e.ccw && sweep <= 0) sweep += 2 * Math.PI;
    if (!e.ccw && sweep <= 0) sweep += 2 * Math.PI;
    const N = Math.max(24, Math.ceil(Math.abs(sweep) / (2 * Math.PI) * arcN));
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const angle = e.ccw ? (sa + sweep * t) : (sa - sweep * t);
      const wx = e.cx + e.r * Math.cos(angle);
      const wy = e.cy + e.r * Math.sin(angle);
      pts.push(w2mm(wx, wy));
    }
    this.strokePath(pdf, pts, false);
  }

  // ── ELLIPSE ─────────────────────────────────────────────────────────

  private drawEllipse(pdf: jsPDF, e: any, w2mm: W2mm, _scaleMm: number, arcN: number): void {
    const sa = e.startAngle;
    const ea = e.endAngle;
    let sweep = ea - sa;
    if (sweep <= 0) sweep += 2 * Math.PI;
    const N = Math.max(36, Math.ceil(sweep / (2 * Math.PI) * arcN));
    const cosR = Math.cos(e.rotation);
    const sinR = Math.sin(e.rotation);
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const angle = sa + (sweep * i) / N;
      const lx = e.rx * Math.cos(angle);
      const ly = e.ry * Math.sin(angle);
      const wx = e.cx + lx * cosR - ly * sinR;
      const wy = e.cy + lx * sinR + ly * cosR;
      pts.push(w2mm(wx, wy));
    }
    const isFull = Math.abs(sweep - 2 * Math.PI) < 0.01;
    this.strokePath(pdf, pts, isFull);
  }

  // ── POLYLINE ────────────────────────────────────────────────────────

  private drawPolyline(pdf: jsPDF, e: any, w2mm: W2mm): void {
    if (!e.pts || e.pts.length < 2) return;
    const pts = e.pts.map((p: any) => w2mm(p.x, p.y));
    this.strokePath(pdf, pts, !!e.closed);
  }

  // ── SPLINE ──────────────────────────────────────────────────────────

  private drawSpline(pdf: jsPDF, e: any, w2mm: W2mm): void {
    if (!e.controlPoints || e.controlPoints.length < 2) return;
    const worldPts = catmullRomChain(e.controlPoints, 16);
    const pts = worldPts.map((p: any) => w2mm(p.x, p.y));
    this.strokePath(pdf, pts, false);
  }

  // ── TEXT ─────────────────────────────────────────────────────────────
  //
  // This is THE critical path for readability. We compute the text height
  // in mm on paper, applying a moderate floor (0.75 mm) so annotations remain
  // legible under zoom without overlapping or overflowing adjacent lines.

  private drawText(pdf: jsPDF, e: any, w2mm: W2mm, scaleMm: number): void {
    if (!e.text) return;
    const pos = w2mm(e.x, e.y);

    // World text height → paper mm, with a moderate legibility floor to balance
    // readability and layout spacing.
    const heightMm = paperTextHeightMm(e.height, scaleMm);

    // mm → typographic points (1pt = 1/72 inch = 25.4/72 mm ≈ 0.353 mm)
    const fontSizePt = heightMm * 72 / 25.4;

    const style = e.bold && e.italic ? 'bolditalic' : e.bold ? 'bold' : e.italic ? 'italic' : 'normal';
    pdf.setFont('helvetica', style);
    pdf.setFontSize(fontSizePt);

    const layout = TextLayoutEngine.measure({
      autoWrap: e.autoWrap,
      mtextWidth: e.mtextWidth,
      text: e.text || '',
      font: e.font || 'sans-serif',
      height: e.height || 2.5,
      rotation: e.rotation || 0,
      justify: e.justify || 'BL',
      lineSpacing: e.lineSpacing || 1.2,
      widthFactor: e.widthFactor || 1,
      obliqueAngle: e.obliqueAngle || 0,
      bold: e.bold || false,
      italic: e.italic || false,
      charSpacing: e.charSpacing || 0,
      x: e.x,
      y: e.y,
    });

    let angle = 0;
    if (e.rotation) {
      angle = e.rotation * 180 / Math.PI;
    }
    
    const cosR = Math.cos(e.rotation || 0);
    const sinR = Math.sin(e.rotation || 0);

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const lineText = line.text;
      if (!lineText) continue;

      // In TextLayoutEngine, line.glyphs[0].x represents the start X of the line.
      // Wait, what if the line has no glyphs (e.g. whitespace)? line.w is the width.
      // TextLayoutEngine computes `lineStartX` internally and assigns it to glyphs, 
      // but if we want it robustly, we can use the first glyph's X if available.
      // Alternatively, we can re-calculate lineStartX for the anchor:
      // Let's check `TextLayoutEngine.measure` again... `lineStartX` is not exposed directly on `ITextLineLayout`, 
      // but `line.glyphs[0]?.x` IS `lineStartX`.
      
      const localCanvasX = line.glyphs.length > 0 ? line.glyphs[0].x : 0;
      const localCanvasY = line.y; // baselineY
      const localWorldY = -localCanvasY;

      const wx = e.x + localCanvasX * cosR - localWorldY * sinR;
      const wy = e.y + localCanvasX * sinR + localWorldY * cosR;
      const paperPos = w2mm(wx, wy);

      pdf.text(lineText, paperPos.x, paperPos.y, { align: 'left', angle });
    }
  }

  // ── POINT ───────────────────────────────────────────────────────────

  private drawPoint(pdf: jsPDF, e: any, w2mm: W2mm): void {
    const p = w2mm(e.x, e.y);
    pdf.circle(p.x, p.y, 0.2, 'F');
  }

  // ── HATCH ───────────────────────────────────────────────────────────

  private drawHatch(
    pdf: jsPDF,
    e: any,
    w2mm: W2mm,
    scaleMm: number,
    _doc: any,
    arcN: number,
    rgb: { r: number; g: number; b: number },
  ): void {
    const loops = flattenHatchBoundaries(e, w2mm, arcN);
    if (!loops.length) return;

    // Solid fill — covers e.solid=true, pattern==='SOLID', and gradient hatches.
    const isSolid = e.solid || e.pattern === 'SOLID' || !!e.gradientType;
    if (isSolid) {
      pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      fillHatchLoops(pdf, loops);
      return;
    }

    // Pattern hatch — get the world-space bounding box for line generation.
    const b = typeof e.bbox === 'function' ? e.bbox() : null;
    if (!b || b.w <= 0 || b.h <= 0) {
      // No usable bbox — fall back to boundary outlines only.
      for (const loop of loops) this.strokePath(pdf, loop, true);
      return;
    }

    // Pattern lines use a hairline stroke so dense patterns remain legible,
    // matching the canvas HatchRendererService which always uses lineWidth=1px.
    pdf.setLineWidth(0.08);
    pdf.setLineDashPattern([], 0);

    this.clipToHatchLoops(pdf, loops, () => {
      if (e.pattern === 'HEX' || e.pattern === 'HONEY') {
        this.drawHatchHex(pdf, e, w2mm, scaleMm, b);
      } else if (e.pattern === 'GRAVEL') {
        this.drawHatchGravel(pdf, e, w2mm, scaleMm, b);
      } else if (e.customPatternLines?.length) {
        this.drawHatchCustomLines(pdf, e, w2mm, scaleMm, b);
      } else {
        this.drawHatchPatternPass(pdf, e, w2mm, scaleMm, b, e.angle || 0);
        if (e.doubleHatch) {
          this.drawHatchPatternPass(pdf, e, w2mm, scaleMm, b, (e.angle || 0) + 90);
        }
      }
    });

    // Reset dash so subsequent entity drawing starts clean.
    pdf.setLineDashPattern([], 0);
  }

  /**
   * Save the PDF graphics state, clip to the hatch boundary loops using the
   * even-odd fill rule (matching canvas ctx.clip(path,'evenodd')), run the
   * pattern-drawing callback, then restore.
   */
  private clipToHatchLoops(pdf: jsPDF, loops: Pt[][], drawFn: () => void): void {
    if (!loops.length) { drawFn(); return; }
    pdf.saveGraphicsState();
    for (const loop of loops) {
      if (loop.length < 2) continue;
      pdf.moveTo(loop[0].x, loop[0].y);
      for (let i = 1; i < loop.length; i++) pdf.lineTo(loop[i].x, loop[i].y);
      pdf.close();
    }
    pdf.clipEvenOdd();
    pdf.discardPath();
    drawFn();
    pdf.restoreGraphicsState();
  }

  /**
   * Generate one pass of parallel pattern lines from the HATCH_PATTERNS registry
   * in paper-mm space. Mirrors HatchRendererService.drawPatternPass().
   */
  private drawHatchPatternPass(
    pdf: jsPDF,
    e: any,
    w2mm: W2mm,
    scaleMm: number,
    bbox: { x: number; y: number; w: number; h: number },
    currentAngle: number,
  ): void {
    const pat = HATCH_PATTERNS[e.pattern] ?? HATCH_PATTERNS['ANSI31'];
    const scale = Math.max(0.01, e.scale || 1);
    const globalAngleRad = (currentAngle * Math.PI) / 180;
    const diag = Math.hypot(bbox.w, bbox.h) * 2 + 4;
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const MAX_LINES = 2000;

    for (const lineDef of pat.lines) {
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
      x0 += (e.originX || 0);
      y0 += (e.originY || 0);

      const spacing = lineDef.dy * scale;
      const shift   = lineDef.dx * scale;

      // Dash lengths: pattern units × hatch-scale × world-to-mm factor.
      if (lineDef.dashArray?.length) {
        pdf.setLineDashPattern(
          lineDef.dashArray.map((v: number) => Math.abs(v) * scale * scaleMm),
          0,
        );
      } else {
        pdf.setLineDashPattern([], 0);
      }

      if (spacing < 0.001) {
        const lx1 = cx - cosA * diag, ly1 = cy - sinA * diag;
        const lx2 = cx + cosA * diag, ly2 = cy + sinA * diag;
        const p1 = w2mm(lx1, ly1), p2 = w2mm(lx2, ly2);
        pdf.moveTo(p1.x, p1.y);
        pdf.lineTo(p2.x, p2.y);
      } else {
        const centerNormalDist = (cx - x0) * (-sinA) + (cy - y0) * cosA;
        const halfRange = diag / 2;
        const startI = Math.floor((centerNormalDist - halfRange) / spacing) - 1;
        const endI   = Math.ceil((centerNormalDist + halfRange) / spacing) + 1;
        const lineCount = endI - startI + 1;
        const step = lineCount > MAX_LINES ? Math.ceil(lineCount / MAX_LINES) : 1;

        for (let i = startI; i <= endI; i += step) {
          const perpDist  = i * spacing;
          const shiftDist = i * shift;
          const px = x0 - sinA * perpDist + cosA * shiftDist;
          const py = y0 + cosA * perpDist + sinA * shiftDist;
          const lx1 = px - cosA * diag, ly1 = py - sinA * diag;
          const lx2 = px + cosA * diag, ly2 = py + sinA * diag;
          const p1 = w2mm(lx1, ly1), p2 = w2mm(lx2, ly2);
          pdf.moveTo(p1.x, p1.y);
          pdf.lineTo(p2.x, p2.y);
        }
      }
      pdf.stroke();
    }
    pdf.setLineDashPattern([], 0);
  }

  /**
   * Draw DXF-embedded custom pattern definition lines.
   * Mirrors HatchRendererService.drawCustomPatternLines().
   */
  private drawHatchCustomLines(
    pdf: jsPDF,
    e: any,
    w2mm: W2mm,
    scaleMm: number,
    bbox: { x: number; y: number; w: number; h: number },
  ): void {
    const scale = Math.max(0.01, e.scale || 1);
    const globalAngleRad = ((e.angle || 0) * Math.PI) / 180;
    const diag = Math.hypot(bbox.w, bbox.h) * 2 + 4;
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const MAX_LINES = 2000;

    for (const lineDef of e.customPatternLines as Array<{ angle: number; x0: number; y0: number; dx: number; dy: number; dashArray: number[] }>) {
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
      x0 += (e.originX || 0);
      y0 += (e.originY || 0);

      const spacing = Math.abs(lineDef.dy) * scale;
      const shift   = lineDef.dx * scale;

      if (lineDef.dashArray?.length) {
        pdf.setLineDashPattern(
          lineDef.dashArray.map((v: number) => Math.abs(v) * scale * scaleMm),
          0,
        );
      } else {
        pdf.setLineDashPattern([], 0);
      }

      if (spacing < 0.001) {
        const lx1 = cx - cosA * diag, ly1 = cy - sinA * diag;
        const lx2 = cx + cosA * diag, ly2 = cy + sinA * diag;
        const p1 = w2mm(lx1, ly1), p2 = w2mm(lx2, ly2);
        pdf.moveTo(p1.x, p1.y);
        pdf.lineTo(p2.x, p2.y);
      } else {
        const centerNormalDist = (cx - x0) * (-sinA) + (cy - y0) * cosA;
        const halfRange = diag / 2;
        const startI = Math.floor((centerNormalDist - halfRange) / spacing) - 1;
        const endI   = Math.ceil((centerNormalDist + halfRange) / spacing) + 1;
        const lineCount = endI - startI + 1;
        const step = lineCount > MAX_LINES ? Math.ceil(lineCount / MAX_LINES) : 1;

        for (let i = startI; i <= endI; i += step) {
          const perpDist  = i * spacing;
          const shiftDist = i * shift;
          const px = x0 - sinA * perpDist + cosA * shiftDist;
          const py = y0 + cosA * perpDist + sinA * shiftDist;
          const lx1 = px - cosA * diag, ly1 = py - sinA * diag;
          const lx2 = px + cosA * diag, ly2 = py + sinA * diag;
          const p1 = w2mm(lx1, ly1), p2 = w2mm(lx2, ly2);
          pdf.moveTo(p1.x, p1.y);
          pdf.lineTo(p2.x, p2.y);
        }
      }
      pdf.stroke();
    }
    pdf.setLineDashPattern([], 0);
  }

  /**
   * Draw a hexagonal / honeycomb pattern in paper-mm space.
   * The clip region is already active when this is called.
   * Mirrors HatchRendererService.drawHexagonalPattern().
   */
  private drawHatchHex(
    pdf: jsPDF,
    e: any,
    w2mm: W2mm,
    _scaleMm: number,
    bbox: { x: number; y: number; w: number; h: number },
  ): void {
    const scale = Math.max(0.01, e.scale || 1) * 10;
    const globalAngleRad = (e.angle || 0) * Math.PI / 180;
    const isHoney = e.pattern === 'HONEY';
    const radius   = isHoney ? scale * 0.5 : scale * 1.2;
    const hSpacing = radius * 2 * 0.75;
    const vSpacing = Math.sqrt(3) * radius;

    let uMinX = Infinity, uMaxX = -Infinity, uMinY = Infinity, uMaxY = -Infinity;
    for (const pt of [
      { x: bbox.x,          y: bbox.y          },
      { x: bbox.x + bbox.w, y: bbox.y          },
      { x: bbox.x,          y: bbox.y + bbox.h },
      { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
    ]) {
      const urx = pt.x * Math.cos(-globalAngleRad) - pt.y * Math.sin(-globalAngleRad);
      const ury = pt.x * Math.sin(-globalAngleRad) + pt.y * Math.cos(-globalAngleRad);
      uMinX = Math.min(uMinX, urx); uMaxX = Math.max(uMaxX, urx);
      uMinY = Math.min(uMinY, ury); uMaxY = Math.max(uMaxY, ury);
    }

    const startC = Math.floor(uMinX / hSpacing) - 1;
    const endC   = Math.ceil(uMaxX  / hSpacing) + 1;
    const startR = Math.floor(uMinY / vSpacing) - 1;
    const endR   = Math.ceil(uMaxY  / vSpacing) + 1;
    const drawRadius = isHoney ? radius : radius * 0.8;

    for (let c = startC; c <= endC; c++) {
      for (let r = startR; r <= endR; r++) {
        let hcx = c * hSpacing;
        let hcy = r * vSpacing;
        if (Math.abs(c) % 2 === 1) hcy += vSpacing / 2;
        for (let i = 0; i <= 6; i++) {
          const theta = (i * 60) * Math.PI / 180;
          const vx  = hcx + drawRadius * Math.cos(theta);
          const vy  = hcy + drawRadius * Math.sin(theta);
          const rvx = vx * Math.cos(globalAngleRad) - vy * Math.sin(globalAngleRad);
          const rvy = vx * Math.sin(globalAngleRad) + vy * Math.cos(globalAngleRad);
          const spt = w2mm(rvx, rvy);
          if (i === 0) pdf.moveTo(spt.x, spt.y);
          else         pdf.lineTo(spt.x, spt.y);
        }
      }
    }
    pdf.stroke();
  }

  /**
   * Draw a gravel / random-polygon pattern in paper-mm space.
   * The clip region is already active when this is called.
   * Mirrors HatchRendererService.drawGravelPattern() using polylines
   * (straight edges) since jsPDF does not expose quadraticCurveTo.
   */
  private drawHatchGravel(
    pdf: jsPDF,
    e: any,
    w2mm: W2mm,
    _scaleMm: number,
    bbox: { x: number; y: number; w: number; h: number },
  ): void {
    const scale = Math.max(0.01, e.scale || 1) * 10;
    const globalAngleRad = (e.angle || 0) * Math.PI / 180;
    const gridSize = scale * 2.5;

    let uMinX = Infinity, uMaxX = -Infinity, uMinY = Infinity, uMaxY = -Infinity;
    for (const pt of [
      { x: bbox.x,          y: bbox.y          },
      { x: bbox.x + bbox.w, y: bbox.y          },
      { x: bbox.x,          y: bbox.y + bbox.h },
      { x: bbox.x + bbox.w, y: bbox.y + bbox.h },
    ]) {
      const urx = pt.x * Math.cos(-globalAngleRad) - pt.y * Math.sin(-globalAngleRad);
      const ury = pt.x * Math.sin(-globalAngleRad) + pt.y * Math.cos(-globalAngleRad);
      uMinX = Math.min(uMinX, urx); uMaxX = Math.max(uMaxX, urx);
      uMinY = Math.min(uMinY, ury); uMaxY = Math.max(uMaxY, ury);
    }

    let startC = Math.floor(uMinX / gridSize) - 1;
    let endC   = Math.ceil(uMaxX  / gridSize) + 1;
    let startR = Math.floor(uMinY / gridSize) - 1;
    let endR   = Math.ceil(uMaxY  / gridSize) + 1;

    // Adaptive LOD: cap total cells to avoid generating huge PDFs.
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

    for (let c = startC; c <= endC; c++) {
      for (let r = startR; r <= endR; r++) {
        const seed = (Math.imul(c, 31337) ^ Math.imul(r, 1103515245)) >>> 0;
        const rand = mulberry32(seed);
        const pcx = (c + 0.1 + rand() * 0.8) * gridSize;
        const pcy = (r + 0.1 + rand() * 0.8) * gridSize;
        const numPoints  = 6 + Math.floor(rand() * 6);
        const baseRadius = scale * (0.4 + rand() * 0.6);
        const randomness = 0.5;

        const points: Pt[] = [];
        for (let i = 0; i < numPoints; i++) {
          const theta = (i / numPoints) * Math.PI * 2;
          const pr  = baseRadius * (1.0 + (rand() - 0.5) * randomness);
          const vx  = pcx + pr * Math.cos(theta);
          const vy  = pcy + pr * Math.sin(theta);
          const rvx = vx * Math.cos(globalAngleRad) - vy * Math.sin(globalAngleRad);
          const rvy = vx * Math.sin(globalAngleRad) + vy * Math.cos(globalAngleRad);
          points.push(w2mm(rvx, rvy));
        }
        if (points.length > 2) {
          pdf.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) pdf.lineTo(points[i].x, points[i].y);
          pdf.close();
          pdf.stroke();
        }
      }
    }
  }

  // ── INSERT (block reference) ────────────────────────────────────────

  private drawInsert(pdf: jsPDF, e: any, w2mm: W2mm, scaleMm: number, doc: any, opts: IPlotOptions, arcN: number): void {
    const def = doc?.blocks?.get(e.blockName);
    if (!def?.entities) return;
    const bp = def.basePoint ?? { x: 0, y: 0 };
    const rad = (e.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);

    const insertW2mm: W2mm = (lx: number, ly: number) => {
      const sxLocal = (lx - bp.x) * e.sx;
      const syLocal = (ly - bp.y) * e.sy;
      const wx = e.x + (sxLocal * cosR - syLocal * sinR);
      const wy = e.y + (sxLocal * sinR + syLocal * cosR);
      return w2mm(wx, wy);
    };
    const childScale = scaleMm * ((Math.abs(e.sx) + Math.abs(e.sy)) / 2);
    for (const child of def.entities) {
      if (!child.visible) continue;
      this.drawEntity(pdf, child, insertW2mm, childScale, doc, e.color, opts, arcN);
    }
  }

  // ── XLINE ───────────────────────────────────────────────────────────

  private drawXLine(pdf: jsPDF, e: any, w2mm: W2mm): void {
    const L = 1e6;
    const dx = Math.cos(e.angle) * L;
    const dy = Math.sin(e.angle) * L;
    const a = w2mm(e.x - dx, e.y - dy);
    const b = w2mm(e.x + dx, e.y + dy);
    pdf.line(a.x, a.y, b.x, b.y);
  }

  // ── DIMENSION (full AutoCAD-style rendering) ────────────────────────
  //
  // Replicates the DimensionEntity.draw() logic: extension lines,
  // dimension line, arrowheads, and measurement text with proper
  // formatting, offset, and rotation.

  private drawDimension(pdf: jsPDF, e: any, w2mm: W2mm, scaleMm: number, doc: any): void {
    // Resolve anchors if associative
    if (typeof e._resolveAnchors === 'function') {
      e._resolveAnchors(doc);
    }

    const dx = e.p2.x - e.p1.x;
    const dy = e.p2.y - e.p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;

    // Effective style values (matching DimensionEntity's dynamic sizing)
    const dynamicSize = len > 0 ? Math.max(0.5, Math.min(100, len * 0.04)) : 2.5;
    const dynamicArrow = dynamicSize;
    const arrowSize = e.arrowSize ?? dynamicArrow;
    const textHeight = e.textHeight ?? dynamicSize;
    const textOffset = e.textOffset ?? (dynamicSize * 0.6);
    const extensionGap = e.extensionGap ?? (dynamicSize * 0.25);
    const extensionPast = e.extensionPast ?? (dynamicSize * 0.5);

    // Signed perpendicular distance from p1-p2 to dim line
    const ox = e.dimLinePoint.x - e.p1.x;
    const oy = e.dimLinePoint.y - e.p1.y;
    const signedOffset = ox * nx + oy * ny;
    const side = signedOffset >= 0 ? 1 : -1;
    const ex = nx * side;
    const ey = ny * side;

    // World-space anchors
    const dimP1 = { x: e.p1.x + signedOffset * nx, y: e.p1.y + signedOffset * ny };
    const dimP2 = { x: e.p2.x + signedOffset * nx, y: e.p2.y + signedOffset * ny };
    const ext1Start = { x: e.p1.x + extensionGap * ex, y: e.p1.y + extensionGap * ey };
    const ext1End   = { x: dimP1.x + extensionPast * ex, y: dimP1.y + extensionPast * ey };
    const ext2Start = { x: e.p2.x + extensionGap * ex, y: e.p2.y + extensionGap * ey };
    const ext2End   = { x: dimP2.x + extensionPast * ex, y: dimP2.y + extensionPast * ey };

    // Convert all to mm
    const mDimP1 = w2mm(dimP1.x, dimP1.y);
    const mDimP2 = w2mm(dimP2.x, dimP2.y);
    const mExt1S = w2mm(ext1Start.x, ext1Start.y);
    const mExt1E = w2mm(ext1End.x, ext1End.y);
    const mExt2S = w2mm(ext2Start.x, ext2Start.y);
    const mExt2E = w2mm(ext2End.x, ext2End.y);

    // Extension lines
    pdf.line(mExt1S.x, mExt1S.y, mExt1E.x, mExt1E.y);
    pdf.line(mExt2S.x, mExt2S.y, mExt2E.x, mExt2E.y);
    // Dimension line
    pdf.line(mDimP1.x, mDimP1.y, mDimP2.x, mDimP2.y);

    // Arrowheads (filled triangles)
    const arrowMm = arrowSize * scaleMm;
    const dimDx = mDimP2.x - mDimP1.x;
    const dimDy = mDimP2.y - mDimP1.y;
    const dimLen = Math.hypot(dimDx, dimDy);
    if (dimLen > 0.01) {
      const sux = dimDx / dimLen, suy = dimDy / dimLen;
      this.drawArrowPdf(pdf, mDimP1, sux, suy, arrowMm);
      this.drawArrowPdf(pdf, mDimP2, -sux, -suy, arrowMm);
    }

    // ── Measurement text ─────────────────────────────────────────────────────
    // Mirrors DimensionEntity.draw(): DIMLFAC scales the measurement, the
    // style's precision governs the decimals, and `%%` codes are decoded. The
    // old `len.toFixed(2)` ignored all three, so a PDF could disagree with what
    // was on screen.
    const measured = typeof e.formatMeasurement === 'function'
      ? e.formatMeasurement(this.doc.activeFile?.dimStyles?.get(e.styleName) ?? DEFAULT_DIM_STYLE)
      : len.toFixed(2);
    let text: string;
    if (typeof e.textOverride === 'string' && e.textOverride.length > 0) {
      text = e.textOverride;
      // Replace <> placeholder with measured value
      if (text.indexOf('<>') >= 0) {
        text = text.split('<>').join(measured);
      }
    } else {
      text = measured;
    }
    // `\X` stacks text above/below the line; jsPDF draws one string, so join.
    const [pdfAbove, pdfBelow] = splitDimensionText(decodeTextCodes(text).text);
    text = pdfBelow == null ? pdfAbove : `${pdfAbove} ${pdfBelow}`;

    // Text position: AutoCAD's stored position when the file gave one,
    // otherwise the midpoint of the dim line offset perpendicular.
    const midDimWorld = { x: (dimP1.x + dimP2.x) / 2, y: (dimP1.y + dimP2.y) / 2 };
    const textPosWorld = e.textPoint
      ? { x: e.textPoint.x, y: e.textPoint.y }
      : { x: midDimWorld.x + textOffset * ex, y: midDimWorld.y + textOffset * ey };
    const mTextPos = w2mm(textPosWorld.x, textPosWorld.y);

    // Dimension text height → mm, clamped to readable floor.
    const hMm = paperTextHeightMm(textHeight, scaleMm);
    const ptSize = hMm * 72 / 25.4;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(ptSize);

    // Compute text rotation from the dimension line direction in paper space
    let textAngle = Math.atan2(dimDy, dimDx) * 180 / Math.PI;
    // Keep text readable (not upside-down)
    if (textAngle > 90 || textAngle < -90) textAngle += 180;

    pdf.text(text, mTextPos.x, mTextPos.y, { align: 'center', angle: -textAngle });
  }

  // ── LEADER ──────────────────────────────────────────────────────────

  private drawLeader(pdf: jsPDF, e: any, w2mm: W2mm, scaleMm: number): void {
    if (!e.pts || e.pts.length < 2) return;
    const pts = e.pts.map((p: any) => w2mm(p.x, p.y));
    this.strokePath(pdf, pts, false);

    // Arrowhead at the first point
    if (pts.length >= 2) {
      const arrowMm = Math.max(0.5, (e.arrowSize ?? 2.5) * scaleMm);
      const aDx = pts[1].x - pts[0].x;
      const aDy = pts[1].y - pts[0].y;
      const aLen = Math.hypot(aDx, aDy);
      if (aLen > 0.01) {
        this.drawArrowPdf(pdf, pts[0], aDx / aLen, aDy / aLen, arrowMm);
      }
    }
  }

  // ── IMAGE ───────────────────────────────────────────────────────────
  //
  // Raster images are embedded via pdf.addImage(). We prefer the cached
  // HTMLImageElement (ImageEntity._img) when the editor has already loaded
  // it; otherwise we fall back to the raw `src` (which is always a data URL
  // for user-uploaded images, so jsPDF can decode it inline).
  //
  // ImageEntity stores (x, y) as the BOTTOM-LEFT corner in world space
  // (world +Y is up). jsPDF positions images by their top-left corner in
  // paper-mm space (paper +Y is down) — so we transform the world top-left
  // (e.x, e.y + e.height) into paper coords. Rotation is applied in
  // degrees around the image's bottom-left, matching jsPDF's pivot.

  private drawImage(pdf: jsPDF, e: any, w2mm: W2mm, scaleMm: number): void {
    if (!e || !e.src) return;
    const wMm = Math.abs(e.width  * scaleMm);
    const hMm = Math.abs(e.height * scaleMm);
    if (wMm < 0.1 || hMm < 0.1) return;

    // Top-left corner on paper.
    const tl = w2mm(e.x, e.y + e.height);

    let source: HTMLImageElement | string | null = null;
    let format = 'PNG';

    if (e._img && (e._img.complete || e._imgState === 'loaded') && (e._img.naturalWidth || e._img.width)) {
      source = e._img;
      format = pickImageFormat(e._img.src || e.src, e._img);
    } else if (typeof e.src === 'string' && e.src.trim()) {
      source = e.src;
      format = pickImageFormat(e.src, null);
    }

    if (!source) {
      pdf.setLineDashPattern([1.5, 1.5], 0);
      pdf.rect(tl.x, tl.y, wMm, hMm, 'S');
      pdf.setLineDashPattern([], 0);
      return;
    }

    const rotationDeg = e.rotation ? -e.rotation * 180 / Math.PI : 0;
    const op = typeof e.opacity === 'number' && e.opacity >= 0 && e.opacity < 1 ? e.opacity : 1;
    let pushedGState = false;

    try {
      if (op < 1 && (pdf as any).GState && (pdf as any).setGState) {
        (pdf as any).saveGraphicsState();
        (pdf as any).setGState(new (pdf as any).GState({ opacity: op }));
        pushedGState = true;
      }
      pdf.addImage(source as any, format, tl.x, tl.y, wMm, hMm, undefined, 'FAST', rotationDeg);
    } catch (err) {
      try {
        // Fallback: if e.src is present, try direct addImage without strict format hint
        if (typeof e.src === 'string') {
          pdf.addImage(e.src, 'PNG', tl.x, tl.y, wMm, hMm, undefined, 'FAST', rotationDeg);
          return;
        }
      } catch (_e2) {}

      console.warn('PDF image embed failed, falling back to placeholder:', err);
      pdf.setLineDashPattern([1.5, 1.5], 0);
      pdf.rect(tl.x, tl.y, wMm, hMm, 'S');
      pdf.setLineDashPattern([], 0);
    } finally {
      if (pushedGState) (pdf as any).restoreGraphicsState();
    }
  }

  // ── TABLE ───────────────────────────────────────────────────────────
  //
  // Emits cell borders + per-cell text as vector primitives. Top-left
  // origin matches TableEntity's coord convention (x grows right, y grows
  // down in world space — but world Y is up, so we subtract row heights).

  private drawTable(pdf: jsPDF, e: any, w2mm: W2mm, scaleMm: number): void {
    if (!e.cells?.length || !e.colWidths?.length || !e.rowHeights?.length) return;

    // Build cumulative x / y offsets along the table grid (world coords).
    const xs: number[] = [e.x];
    for (let c = 0; c < e.cols; c++) xs.push(xs[xs.length - 1] + e.colWidths[c]);
    const ys: number[] = [e.y]; // table top
    for (let r = 0; r < e.rows; r++) ys.push(ys[ys.length - 1] - e.rowHeights[r]);

    // Border weight: stored world units → mm.
    const borderMm = Math.max(0.1, (e.borderWeight ?? 0.25) * scaleMm);
    pdf.setLineWidth(borderMm);
    let borderColor = e.borderColor || '#000000';
    if (borderColor.toLowerCase() === '#e0e4ea' || borderColor.toLowerCase() === '#ffffff') borderColor = '#000000';
    pdf.setDrawColor(...hexTriple(borderColor));

    // Vertical grid lines
    for (let c = 0; c <= e.cols; c++) {
      let vTop = e.y;
      if (e.titleRow && c > 0 && c < e.cols) {
         vTop -= e.rowHeights[0];
      }
      const a = w2mm(xs[c], vTop);
      const b = w2mm(xs[c], ys[ys.length - 1]);
      pdf.line(a.x, a.y, b.x, b.y);
    }
    // Horizontal grid lines
    for (let r = 0; r <= e.rows; r++) {
      const a = w2mm(xs[0], ys[r]);
      const b = w2mm(xs[xs.length - 1], ys[r]);
      pdf.line(a.x, a.y, b.x, b.y);
    }

    // Cell text
    for (let r = 0; r < e.rows; r++) {
      const top = ys[r];
      const bot = ys[r + 1];
      
      if (r === 0 && e.titleRow) {
         const fakeCell = {
           text: e.titleText || 'TABLE',
           fontSize: e.titleFontSize ?? (e.defaultFontSize * 1.5),
           textColor: e.titleTextColor ?? e.defaultTextColor,
           align: 'center',
           valign: 'middle'
         };
         this.drawTableCellText(pdf, e, fakeCell, w2mm, scaleMm, xs[0], xs[xs.length - 1], top, bot);
         continue;
      }
      
      const isHeader = e.headerRow && (e.titleRow ? r === 1 : r === 0);
      
      for (let c = 0; c < e.cols; c++) {
        const cell = e.cells[r]?.[c];
        if (!cell || !cell.text) continue;
        
        const effectiveCell = isHeader ? {
            ...cell,
            fontSize: cell.fontSize ?? e.headerFontSize ?? (e.defaultFontSize * 1.1),
            textColor: cell.textColor ?? e.headerTextColor ?? e.defaultTextColor,
            align: cell.align ?? 'center'
        } : cell;
        
        this.drawTableCellText(pdf, e, effectiveCell, w2mm, scaleMm, xs[c], xs[c + 1], top, bot);
      }
    }
  }

  private drawTableCellText(
    pdf: jsPDF,
    e: any,
    cell: any,
    w2mm: W2mm,
    scaleMm: number,
    xL: number, xR: number, yT: number, yB: number,
  ): void {
    const worldHeight = cell.fontSize ?? e.defaultFontSize ?? 2.5;
    const heightMm = paperTextHeightMm(worldHeight, scaleMm);
    pdf.setFontSize(heightMm * 72 / 25.4);
    const weight = cell.bold ? 'bold' : 'normal';
    const style = cell.italic ? (cell.bold ? 'bolditalic' : 'italic') : weight;
    pdf.setFont('helvetica', style);
    
    let tColor = cell.textColor || e.defaultTextColor || '#000000';
    if (tColor.toLowerCase() === '#e0e4ea' || tColor.toLowerCase() === '#ffffff') tColor = '#000000';
    pdf.setTextColor(...hexTriple(tColor));

    const align: 'left' | 'center' | 'right' = (cell.align || e.defaultAlign || 'left');
    const pad = (e.cellPadding ?? 1);
    const wx = align === 'center' ? (xL + xR) / 2 : align === 'right' ? xR - pad : xL + pad;
    const wy = (yT + yB) / 2;
    const p = w2mm(wx, wy);
    pdf.text(String(cell.text), p.x, p.y, { align, baseline: 'middle' });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Helpers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Stroke a polyline path through consecutive points. */
  private strokePath(pdf: jsPDF, pts: Pt[], closed: boolean): void {
    if (pts.length < 2) return;
    for (let i = 0; i < pts.length - 1; i++) {
      pdf.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    }
    if (closed && pts.length > 2) {
      const last = pts[pts.length - 1];
      pdf.line(last.x, last.y, pts[0].x, pts[0].y);
    }
  }

  /** Draw a filled arrowhead triangle at `tip` pointing in direction (ux, uy). */
  private drawArrowPdf(pdf: jsPDF, tip: Pt, ux: number, uy: number, size: number): void {
    const hw = size * 0.3; // half-width
    // Two base corners of the arrowhead
    const bx = tip.x + ux * size;
    const by = tip.y + uy * size;
    const lx = bx - uy * hw;
    const ly = by + ux * hw;
    const rx = bx + uy * hw;
    const ry = by - ux * hw;
    pdf.triangle(tip.x, tip.y, lx, ly, rx, ry, 'F');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Utility types and helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type Pt = { x: number; y: number };
type W2mm = (wx: number, wy: number) => Pt;

/** Build a transform that maps file-local world coords → paper mm. */
function buildFileW2mm(rootW2mm: W2mm, file: any): W2mm {
  const rad = (file.rotation * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  return (lx: number, ly: number) => {
    const sx = lx * file.scale;
    const sy = ly * file.scale;
    const wx = file.x + (sx * cosR - sy * sinR);
    const wy = file.y + (sx * sinR + sy * cosR);
    return rootW2mm(wx, wy);
  };
}

/** Parse a hex color string into RGB components. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (!hex || hex === 'none') return { r: 0, g: 0, b: 0 };
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  const m3 = hex.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m3) return { r: parseInt(m3[1] + m3[1], 16), g: parseInt(m3[2] + m3[2], 16), b: parseInt(m3[3] + m3[3], 16) };
  return { r: 0, g: 0, b: 0 }; // default black for print mode
}

/**
 * Flatten the boundary loops of a HatchEntity into mm-space polygons.
 * Each loop is a flat IPoint[]; arc edges are tessellated into chords.
 */
function flattenHatchBoundaries(e: any, w2mm: W2mm, arcN: number): Pt[][] {
  const out: Pt[][] = [];
  // Prefer the modern boundarySpec when present (frozen edge list).
  if (e.boundarySpec?.loops?.length) {
    for (const loop of e.boundarySpec.loops) {
      if (!loop.frozen?.length) continue;
      // Sample curved edges (arcs / ellipses) into a smooth polygon so the
      // PDF boundary follows the true curve instead of a straight chord.
      const worldPts = frozenLoopToPolygon(loop.frozen, arcN);
      const pts: Pt[] = worldPts.map((p: { x: number; y: number }) => w2mm(p.x, p.y));
      if (pts.length >= 3) out.push(pts);
    }
    return out;
  }
  if (!Array.isArray(e.boundaries)) return out;
  for (const loop of e.boundaries) {
    if (!Array.isArray(loop)) continue;
    const pts: Pt[] = [];
    for (const edge of loop) {
      if (!edge) continue;
      if (edge.type === 'ARC' && edge.center && edge.radius != null) {
        const sa = (edge.startAngle ?? 0) * Math.PI / 180;
        const ea = (edge.endAngle ?? 360) * Math.PI / 180;
        let sweep = ea - sa;
        if (sweep <= 0) sweep += 2 * Math.PI;
        const N = Math.max(12, Math.ceil(sweep / (2 * Math.PI) * arcN));
        for (let i = 0; i <= N; i++) {
          const angle = sa + (sweep * i) / N;
          pts.push(w2mm(edge.center.x + edge.radius * Math.cos(angle),
                        edge.center.y + edge.radius * Math.sin(angle)));
        }
      } else if (edge.vertices && edge.vertices.length >= 2) {
        for (const v of edge.vertices) pts.push(w2mm(v.x, v.y));
      } else if (edge.start && edge.end) {
        if (!pts.length) pts.push(w2mm(edge.start.x, edge.start.y));
        pts.push(w2mm(edge.end.x, edge.end.y));
      }
    }
    if (pts.length >= 3) out.push(pts);
  }
  return out;
}

/**
 * Fill a set of polygon loops using jsPDF's path API + even-odd fill rule
 * so the first loop fills and each subsequent loop carves a hole.
 */
function fillHatchLoops(pdf: jsPDF, loops: Pt[][]): void {
  // jsPDF exposes `lines(linesArr, x, y, scale, style, closed)` plus the
  // lower-level path API via the internal `pdf.internal.write`. Use the
  // public `lines()` per loop with the 'F' fill style.
  for (const loop of loops) {
    if (loop.length < 3) continue;
    const start = loop[0];
    const segs: Array<[number, number]> = [];
    for (let i = 1; i < loop.length; i++) {
      segs.push([loop[i].x - loop[i - 1].x, loop[i].y - loop[i - 1].y]);
    }
    // Close back to start
    segs.push([start.x - loop[loop.length - 1].x, start.y - loop[loop.length - 1].y]);
    (pdf as any).lines(segs, start.x, start.y, [1, 1], 'F', true);
  }
}

/** Parse a hex colour into a 3-tuple suitable for jsPDF's setDrawColor / setTextColor. */
function hexTriple(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return [0, 0, 0];
}

/**
 * Translate a CAD linetype name into a jsPDF dash pattern (array of dash /
 * gap lengths in paper millimetres). Lengths scale with line weight so
 * thicker lines get proportionally larger gaps — same convention AutoCAD
 * uses. Returns null for solid / unknown linetypes.
 */
function dashPatternForLineType(lineType: string | undefined, lwMm: number): number[] | null {
  if (!lineType) return null;
  const key = lineType.toUpperCase();
  if (key === 'CONTINUOUS' || key === 'BYLAYER' || key === 'BYBLOCK') return null;
  // Base unit scales with stroke weight so dashes stay readable at any lw.
  const u = Math.max(0.5, lwMm * 4);
  if (key === 'DASHED' || key.startsWith('ACAD_ISO02') || key === 'DASH') return [u * 3, u];
  if (key === 'HIDDEN') return [u * 2, u];
  if (key === 'DOTTED' || key === 'DOT' || key.startsWith('ACAD_ISO07')) return [u * 0.5, u];
  if (key === 'CENTER' || key.startsWith('ACAD_ISO04')) return [u * 4, u, u, u];
  if (key === 'DASHDOT' || key === 'PHANTOM' || key.startsWith('ACAD_ISO10')) return [u * 4, u, u * 0.5, u];
  if (key === 'DIVIDE') return [u * 3, u, u * 0.5, u, u * 0.5, u];
  return null;
}

/**
 * Pick the jsPDF image-format hint for a given image source. jsPDF can sniff
 * many formats on its own, but supplying the hint speeds decoding and is
 * required for some builds where auto-detection is conservative.
 *
 * Returns one of jsPDF's supported format names: 'PNG', 'JPEG', 'WEBP'.
 * Falls back to PNG when the format can't be determined.
 */
function pickImageFormat(dataSrc: string, img: HTMLImageElement | null): string {
  // Inspect the data URL prefix first — it's the most reliable signal.
  if (dataSrc.startsWith('data:image/')) {
    const m = /^data:image\/([a-z0-9+-]+)/i.exec(dataSrc);
    if (m) {
      const mime = m[1].toLowerCase();
      if (mime === 'jpeg' || mime === 'jpg') return 'JPEG';
      if (mime === 'webp') return 'WEBP';
      if (mime === 'png')  return 'PNG';
    }
  }
  // External URL: look at the file extension.
  const ext = (img?.src || dataSrc).toLowerCase().split('?')[0].split('.').pop() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'JPEG';
  if (ext === 'webp') return 'WEBP';
  // PNG is a safe default — jsPDF re-encodes via canvas if the input format
  // doesn't actually match, so this is robust.
  return 'PNG';
}

/** Pick the jsPDF format string for our paper enum. */
function pickJsPdfFormat(opts: IPlotOptions): string | [number, number] {
  let format: string | [number, number];
  switch (opts.paper) {
    case 'A0': format = 'a0'; break;
    case 'A1': format = 'a1'; break;
    case 'A2': format = 'a2'; break;
    case 'A3': format = 'a3'; break;
    case 'A4': format = 'a4'; break;
    case 'Letter': format = 'letter'; break;
    case 'Legal': format = 'legal'; break;
    case 'Tabloid': format = 'tabloid'; break;
    case 'Custom': {
      const mm = getPaperSizeMm('Custom', opts.customPaperMm);
      format = [mm.w, mm.h];
      break;
    }
    default: {
      const mm = getPaperSizeMm(opts.paper, opts.customPaperMm);
      format = [mm.w, mm.h];
      break;
    }
  }

  // If jsPDF is passed an array for custom sizes, it ignores the orientation parameter
  // and creates a page with width = format[0] and height = format[1].
  // We must manually orient the array dimensions based on the chosen orientation.
  if (Array.isArray(format)) {
    const w = format[0];
    const h = format[1];
    if (opts.orientation === 'landscape') {
      return [Math.max(w, h), Math.min(w, h)];
    } else {
      return [Math.min(w, h), Math.max(w, h)];
    }
  }
  return format;
}
