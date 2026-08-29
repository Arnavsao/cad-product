/**
 * Plot / Export options shared by every exporter (PDF, PNG, DXF) and the
 * Plot dialog. One options object drives the entire pipeline so the dialog's
 * live preview is rendered with exactly the same parameters that the final
 * export will use.
 *
 * All paper sizes are stored in millimetres. World coordinates are CAD units.
 * The dialog converts to/from these primitives — exporters consume them
 * directly without further interpretation.
 */

export type PlotFormat = 'pdf' | 'png' | 'jpg' | 'svg' | 'dxf' | 'dwg' | 'browser';

/** Formats that produce resolution-independent vector output. */
export const VECTOR_FORMATS: ReadonlyArray<PlotFormat> = ['pdf', 'svg', 'dxf'];
/** Formats rasterised to a pixel buffer. */
export const RASTER_FORMATS: ReadonlyArray<PlotFormat> = ['png', 'jpg'];

/** Where the plot's content is sourced from. */
export type PlotArea =
  /** All printable entities across all visible files. */
  | 'extents'
  /** What the user currently sees on screen. */
  | 'display'
  /** A user-defined rectangle (set via `windowBounds`). */
  | 'window'
  /** Only currently selected entities. Falls back to extents if no selection. */
  | 'selection'
  /** Drawing limits as set by LIMITS command. */
  | 'limits'
  /** Active layout extents (paper space). */
  | 'layout';

export type PlotPaper = string; // Now an open string — keys from PAPER_REGISTRY or 'Custom'
export type PlotOrientation = 'portrait' | 'landscape';

/**
 * Plot scale.
 *   - 'fit'  → autoscale so the chosen area fills the page (with margin).
 *   - number → ratio of *world units per paper millimetre*. E.g. for 1:100,
 *              this is 100 (1 mm of paper = 100 world units).
 */
export type PlotScale = 'fit' | number;

export type PlotBackground = 'dark' | 'white' | 'transparent';

/**
 * AutoCAD .ctb-equivalent plot style. Controls how stored CAD colors map to
 * plotted ink. Independent of editor theme — affects PDF/PNG output only.
 */
export type PlotStyle = 'color' | 'monochrome' | 'grayscale';

export type DxfVersion = 'R12' | 'R2000' | 'R2013';

/** Anti-aliasing level for raster exports. */
export type AntiAliasLevel = 'off' | 'low' | 'medium' | 'high';

/** Color depth for raster exports. */
export type ColorDepth = '8bit' | '16bit' | '24bit' | '32bit';

/** PNG compression level. */
export type PngCompression = 'fast' | 'balanced' | 'maximum';

// ─── PDF-specific options ────────────────────────────────────────────────────

export interface PdfOptions {
  /** Keep geometry as vectors (true) vs flatten to raster (false). */
  preserveVectors: boolean;
  /** Embed text as searchable strings. */
  searchableText: boolean;
  /** Embed fonts (true) or convert text to outlines (false). */
  embedFonts: boolean;
  /** Export layer structure into PDF. */
  exportLayers: boolean;
  /** Compression level 0–3 (None/Low/Medium/High). */
  compressionLevel: 0 | 1 | 2 | 3;
  // Metadata
  metaAuthor?: string;
  metaTitle?: string;
  metaSubject?: string;
  metaKeywords?: string;
}

// ─── Raster-specific options ─────────────────────────────────────────────────

export interface RasterOptions {
  antiAlias: AntiAliasLevel;
  colorDepth: ColorDepth;
  pngCompression: PngCompression;
  /** JPEG quality 0..1. */
  jpgQuality: number;
}

// ─── Plot Offset ─────────────────────────────────────────────────────────────

export interface PlotOffset {
  /** Offset from lower-left printable corner in mm. Positive = move right. */
  x: number;
  /** Offset from lower-left printable corner in mm. Positive = move up. */
  y: number;
  center: boolean;
}

// ─── Main options interface ───────────────────────────────────────────────────

export interface IPlotOptions {
  // ── Plotter / Device ──────────────────────────────────────────────────────
  /** Key into PLOTTER_REGISTRY. Drives format & capability flags. */
  plotterKey: string;
  format: PlotFormat;

  // ── Plot Area ─────────────────────────────────────────────────────────────
  area: PlotArea;
  /** World-space bbox. Required when `area === 'window'`. */
  windowBounds?: { minX: number; minY: number; maxX: number; maxY: number };

  // ── Paper ─────────────────────────────────────────────────────────────────
  /** Key into PAPER_REGISTRY or 'Custom'. */
  paper: PlotPaper;
  /** Paper dimensions in mm when `paper === 'Custom'`. Ignored otherwise. */
  customPaperMm?: { w: number; h: number };
  /** Paper units shown in UI — does NOT change stored mm values. */
  paperUnits: 'mm' | 'inches';
  orientation: PlotOrientation;

  // ── Scale ─────────────────────────────────────────────────────────────────
  scale: PlotScale;
  /** Scale lineweights proportionally when scale changes. */
  scaleLineweights: boolean;

  // ── Plot Offset ───────────────────────────────────────────────────────────
  plotOffset: PlotOffset;

  /** @deprecated Use plotOffset.center instead. Kept for backward compat. */
  centerDrawing: boolean;

  // ── Plot Style (CTB) ──────────────────────────────────────────────────────
  /** Key into PLOT_STYLE_REGISTRY. */
  plotStyleKey: string;
  /** @deprecated Use plotStyleKey. Kept for backward compat. */
  plotStyle: PlotStyle;

  // ── Quality / Resolution ──────────────────────────────────────────────────
  /** Raster resolution in dots-per-inch. Also drives PDF geometry precision. */
  dpi: number;
  /**
   * Optional raster long-edge target in pixels (PNG/JPG only). When set it
   * overrides `dpi` for the pixel buffer — used by the 2K/4K/8K presets.
   */
  rasterLongEdgePx?: number;

  // ── Background ────────────────────────────────────────────────────────────
  /** @deprecated Use rasterOptions.jpgQuality */
  jpgQuality?: number;
  background: PlotBackground;

  // ── Plot Options ──────────────────────────────────────────────────────────
  plotLineweights: boolean;
  plotTransparency: boolean;
  plotStamp: boolean;
  plotStampLabel?: string;

  // ── Margin ────────────────────────────────────────────────────────────────
  /** Page margin in mm (all sides). */
  margin: number;

  // ── PDF Options ───────────────────────────────────────────────────────────
  pdfOptions: PdfOptions;

  // ── Raster Options ────────────────────────────────────────────────────────
  rasterOptions: RasterOptions;

  // ── DXF ──────────────────────────────────────────────────────────────────
  dxfVersion: DxfVersion;
}

// ─── Legacy helpers for existing exporters ────────────────────────────────────

/**
 * Map legacy PlotPaper key to mm. Supports both old keys (A0, Letter…)
 * and new PAPER_REGISTRY keys.
 */
const LEGACY_PAPER_MM: Record<string, { w: number; h: number }> = {
  A0: { w: 841, h: 1189 }, A1: { w: 594, h: 841 }, A2: { w: 420, h: 594 },
  A3: { w: 297, h: 420 }, A4: { w: 210, h: 297 }, A5: { w: 148, h: 210 },
  A6: { w: 105, h: 148 },
  Letter: { w: 215.9, h: 279.4 }, Legal: { w: 215.9, h: 355.6 },
  Tabloid: { w: 279.4, h: 431.8 }, Ledger: { w: 431.8, h: 279.4 },
};

export function getPaperSizeMm(
  paper: string,
  custom?: { w: number; h: number },
): { w: number; h: number } {
  if (paper === 'Custom') return custom ?? { w: 210, h: 297 };
  // Try PAPER_REGISTRY first (lazy import to avoid circular)
  const reg = _getPaperRegistry();
  const p = reg.find(x => x.key === paper);
  if (p) return { w: p.wMm, h: p.hMm };
  // Fall back to legacy map
  return LEGACY_PAPER_MM[paper] ?? { w: 210, h: 297 };
}

// Lazy reference to avoid circular dep — resolved at call-time.
let _paperReg: Array<{ key: string; wMm: number; hMm: number }> | null = null;
function _getPaperRegistry() {
  if (!_paperReg) {
    try {
      // Dynamic import avoided — we just mirror the registry here to prevent
      // circular dependencies between models.
      _paperReg = PAPER_REGISTRY_INLINE;
    } catch { _paperReg = []; }
  }
  return _paperReg;
}

// Inline mirror of PAPER_REGISTRY to break circular dep:
const PAPER_REGISTRY_INLINE: Array<{ key: string; wMm: number; hMm: number }> = [
  { key: 'A0', wMm: 841, hMm: 1189 }, { key: 'A1', wMm: 594, hMm: 841 },
  { key: 'A2', wMm: 420, hMm: 594 }, { key: 'A3', wMm: 297, hMm: 420 },
  { key: 'A4', wMm: 210, hMm: 297 }, { key: 'A5', wMm: 148, hMm: 210 },
  { key: 'A6', wMm: 105, hMm: 148 },
  { key: 'ANSI_A', wMm: 215.9, hMm: 279.4 }, { key: 'ANSI_B', wMm: 279.4, hMm: 431.8 },
  { key: 'ANSI_C', wMm: 431.8, hMm: 558.8 }, { key: 'ANSI_D', wMm: 558.8, hMm: 863.6 },
  { key: 'ANSI_E', wMm: 863.6, hMm: 1117 },
  { key: 'ARCH_A', wMm: 228.6, hMm: 304.8 }, { key: 'ARCH_B', wMm: 304.8, hMm: 457.2 },
  { key: 'ARCH_C', wMm: 457.2, hMm: 609.6 }, { key: 'ARCH_D', wMm: 609.6, hMm: 914.4 },
  { key: 'ARCH_E', wMm: 914.4, hMm: 1219.2 }, { key: 'ARCH_E1', wMm: 762, hMm: 1067 },
  { key: 'ENG_B', wMm: 279.4, hMm: 431.8 }, { key: 'ENG_C', wMm: 431.8, hMm: 558.8 },
  { key: 'ENG_D', wMm: 558.8, hMm: 863.6 }, { key: 'ENG_E', wMm: 863.6, hMm: 1117 },
  { key: 'Letter', wMm: 215.9, hMm: 279.4 }, { key: 'Legal', wMm: 215.9, hMm: 355.6 },
  { key: 'Tabloid', wMm: 279.4, hMm: 431.8 }, { key: 'Ledger', wMm: 431.8, hMm: 279.4 },
];

// ─── Presets ─────────────────────────────────────────────────────────────────

export const DPI_PRESETS = [72, 150, 300, 600, 1200] as const;

export const RESOLUTION_PRESETS: Array<{ label: string; longEdgePx: number | null }> = [
  { label: 'By DPI (quality)', longEdgePx: null },
  { label: '2K  (2048 px)',    longEdgePx: 2048 },
  { label: '4K  (3840 px)',    longEdgePx: 3840 },
  { label: '8K  (7680 px)',    longEdgePx: 7680 },
];

export const QUALITY_PRESETS: Array<{ label: string; dpi: number }> = [
  { label: 'Draft',         dpi: 150  },
  { label: 'High Quality',  dpi: 300  },
  { label: 'Production',    dpi: 600  },
  { label: 'Ultra Quality', dpi: 1200 },
];

/** Legacy scale presets — kept for backward compat. Use SCALE_REGISTRY for new UI. */
export const SCALE_PRESETS: Array<{ label: string; value: PlotScale }> = [
  { label: 'Fit to page', value: 'fit' },
  { label: '1:1',   value: 1 }, { label: '1:2',   value: 2 },
  { label: '1:5',   value: 5 }, { label: '1:10',  value: 10 },
  { label: '1:20',  value: 20 }, { label: '1:50', value: 50 },
  { label: '1:100', value: 100 }, { label: '1:200', value: 200 },
];

// ─── Static format metadata ──────────────────────────────────────────────────

export const FORMAT_META: Record<
  PlotFormat,
  { label: string; ext: string; vector: boolean; raster: boolean; available: boolean }
> = {
  pdf:     { label: 'PDF (vector)',        ext: 'pdf', vector: true,  raster: false, available: true  },
  svg:     { label: 'SVG (vector)',        ext: 'svg', vector: true,  raster: false, available: true  },
  dxf:     { label: 'DXF (CAD exchange)', ext: 'dxf', vector: true,  raster: false, available: true  },
  png:     { label: 'PNG (raster)',        ext: 'png', vector: false, raster: true,  available: true  },
  jpg:     { label: 'JPG (raster)',        ext: 'jpg', vector: false, raster: true,  available: true  },
  dwg:     { label: 'DWG (future)',        ext: 'dwg', vector: true,  raster: false, available: false },
  browser: { label: 'Browser Print',       ext: '',    vector: true,  raster: false, available: true  },
};

// ─── Defaults ────────────────────────────────────────────────────────────────

export function defaultPdfOptions(): PdfOptions {
  return {
    preserveVectors: true,
    searchableText: true,
    embedFonts: true,
    exportLayers: false,
    compressionLevel: 2,
  };
}

export function defaultRasterOptions(): RasterOptions {
  return {
    antiAlias: 'high',
    colorDepth: '24bit',
    pngCompression: 'balanced',
    jpgQuality: 0.92,
  };
}

export function defaultPlotOffset(): PlotOffset {
  return { x: 0, y: 0, center: true };
}

export function defaultPlotOptions(): IPlotOptions {
  return {
    plotterKey: 'DWGToPDF',
    format: 'pdf',
    area: 'extents',
    paper: 'A0',
    paperUnits: 'mm',
    orientation: 'landscape',
    scale: 'fit',
    scaleLineweights: true,
    plotOffset: defaultPlotOffset(),
    centerDrawing: true,
    plotStyleKey: 'acad_color',
    plotStyle: 'color',
    dpi: 300,
    jpgQuality: 0.92,
    background: 'white',
    plotLineweights: true,
    plotTransparency: true,
    margin: 10,
    plotStamp: false,
    dxfVersion: 'R2000',
    pdfOptions: defaultPdfOptions(),
    rasterOptions: defaultRasterOptions(),
  };
}

/**
 * Resolve the effective DPI a raster export should use. When a long-edge pixel
 * target is set (2K/4K/8K presets) it wins over the quality DPI so the pixel
 * count is predictable; otherwise the quality DPI is used directly.
 */
export function effectiveRasterDpi(opts: IPlotOptions, paperMm: { w: number; h: number }): number {
  if (opts.rasterLongEdgePx && opts.rasterLongEdgePx > 0) {
    const longEdgeMm = Math.max(paperMm.w, paperMm.h);
    const longEdgeInches = longEdgeMm / 25.4;
    if (longEdgeInches > 0) return opts.rasterLongEdgePx / longEdgeInches;
  }
  return opts.dpi || 300;
}

// Keep old interface alias for backward compat
export type { IPlotOptions as IPlotOptionsV2 };
