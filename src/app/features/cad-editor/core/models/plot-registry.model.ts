/**
 * Plot Registry — data-driven definitions for paper sizes, scales, plotters,
 * and plot style tables. Nothing in this file is hardcoded in UI templates;
 * all dropdowns/lists are generated from these registries.
 *
 * Architecture: registry arrays are exported as immutable constants.
 * Future entries (e.g. custom PC3 plotter configs, imported CTB files)
 * can be pushed into these arrays at runtime without modifying UI code.
 */

// ─── Paper Definitions ──────────────────────────────────────────────────────

export type PaperCategory = 'ISO' | 'ANSI' | 'ARCH' | 'Engineering' | 'Other';

export interface PaperDefinition {
  /** Unique key used in IPlotOptions.paper. */
  key: string;
  /** Display label in the dropdown. */
  label: string;
  category: PaperCategory;
  /** Width in mm (short edge). */
  wMm: number;
  /** Height in mm (long edge). */
  hMm: number;
}

export const PAPER_REGISTRY: PaperDefinition[] = [
  // ISO
  { key: 'A0',      label: 'A0',      category: 'ISO',         wMm: 841,   hMm: 1189  },
  { key: 'A1',      label: 'A1',      category: 'ISO',         wMm: 594,   hMm: 841   },
  { key: 'A2',      label: 'A2',      category: 'ISO',         wMm: 420,   hMm: 594   },
  { key: 'A3',      label: 'A3',      category: 'ISO',         wMm: 297,   hMm: 420   },
  { key: 'A4',      label: 'A4',      category: 'ISO',         wMm: 210,   hMm: 297   },
  { key: 'A5',      label: 'A5',      category: 'ISO',         wMm: 148,   hMm: 210   },
  { key: 'A6',      label: 'A6',      category: 'ISO',         wMm: 105,   hMm: 148   },

  // ANSI
  { key: 'ANSI_A',  label: 'ANSI A',  category: 'ANSI',        wMm: 215.9, hMm: 279.4 },
  { key: 'ANSI_B',  label: 'ANSI B',  category: 'ANSI',        wMm: 279.4, hMm: 431.8 },
  { key: 'ANSI_C',  label: 'ANSI C',  category: 'ANSI',        wMm: 431.8, hMm: 558.8 },
  { key: 'ANSI_D',  label: 'ANSI D',  category: 'ANSI',        wMm: 558.8, hMm: 863.6 },
  { key: 'ANSI_E',  label: 'ANSI E',  category: 'ANSI',        wMm: 863.6, hMm: 1117  },

  // Architectural
  { key: 'ARCH_A',  label: 'ARCH A',  category: 'ARCH',        wMm: 228.6, hMm: 304.8 },
  { key: 'ARCH_B',  label: 'ARCH B',  category: 'ARCH',        wMm: 304.8, hMm: 457.2 },
  { key: 'ARCH_C',  label: 'ARCH C',  category: 'ARCH',        wMm: 457.2, hMm: 609.6 },
  { key: 'ARCH_D',  label: 'ARCH D',  category: 'ARCH',        wMm: 609.6, hMm: 914.4 },
  { key: 'ARCH_E',  label: 'ARCH E',  category: 'ARCH',        wMm: 914.4, hMm: 1219.2},
  { key: 'ARCH_E1', label: 'ARCH E1', category: 'ARCH',        wMm: 762,   hMm: 1067  },

  // Engineering
  { key: 'ENG_B',   label: 'B (Engineering)', category: 'Engineering', wMm: 279.4, hMm: 431.8 },
  { key: 'ENG_C',   label: 'C (Engineering)', category: 'Engineering', wMm: 431.8, hMm: 558.8 },
  { key: 'ENG_D',   label: 'D (Engineering)', category: 'Engineering', wMm: 558.8, hMm: 863.6 },
  { key: 'ENG_E',   label: 'E (Engineering)', category: 'Engineering', wMm: 863.6, hMm: 1117  },

  // Other / Office
  { key: 'Letter',  label: 'Letter',  category: 'Other',       wMm: 215.9, hMm: 279.4 },
  { key: 'Legal',   label: 'Legal',   category: 'Other',       wMm: 215.9, hMm: 355.6 },
  { key: 'Tabloid', label: 'Tabloid', category: 'Other',       wMm: 279.4, hMm: 431.8 },
  { key: 'Ledger',  label: 'Ledger',  category: 'Other',       wMm: 431.8, hMm: 279.4 },
];

export const PAPER_CATEGORIES: PaperCategory[] = ['ISO', 'ANSI', 'ARCH', 'Engineering', 'Other'];

export function getPaperByKey(key: string): PaperDefinition | undefined {
  return PAPER_REGISTRY.find(p => p.key === key);
}

export function getPaperGroups(): Map<PaperCategory, PaperDefinition[]> {
  const map = new Map<PaperCategory, PaperDefinition[]>();
  for (const cat of PAPER_CATEGORIES) map.set(cat, []);
  for (const p of PAPER_REGISTRY) map.get(p.category)!.push(p);
  return map;
}

// ─── Scale Definitions ───────────────────────────────────────────────────────

export type ScaleCategory = 'Fit' | 'Metric' | 'Imperial' | 'Custom';

export interface ScaleDefinition {
  /** Display label */
  label: string;
  /** World units per paper mm. 'fit' for auto-fit. null for custom input. */
  value: number | 'fit' | null;
  category: ScaleCategory;
}

export const SCALE_REGISTRY: ScaleDefinition[] = [
  // Fit
  { label: 'Fit to Page',     value: 'fit',    category: 'Fit' },

  // Metric standard scales
  { label: '1:1',    value: 1,     category: 'Metric' },
  { label: '1:2',    value: 2,     category: 'Metric' },
  { label: '1:5',    value: 5,     category: 'Metric' },
  { label: '1:10',   value: 10,    category: 'Metric' },
  { label: '1:20',   value: 20,    category: 'Metric' },
  { label: '1:25',   value: 25,    category: 'Metric' },
  { label: '1:50',   value: 50,    category: 'Metric' },
  { label: '1:75',   value: 75,    category: 'Metric' },
  { label: '1:100',  value: 100,   category: 'Metric' },
  { label: '1:125',  value: 125,   category: 'Metric' },
  { label: '1:150',  value: 150,   category: 'Metric' },
  { label: '1:200',  value: 200,   category: 'Metric' },
  { label: '1:250',  value: 250,   category: 'Metric' },
  { label: '1:500',  value: 500,   category: 'Metric' },
  { label: '1:1000', value: 1000,  category: 'Metric' },

  // Imperial scales (world units = inches, paper mm converts via 25.4)
  // 1/8"=1' → 1 paper inch = 8' = 96" → 1mm = 96/25.4 ≈ 3.78 drawing-inch
  { label: '1/8" = 1\'',  value: 96 / 25.4,   category: 'Imperial' },
  { label: '1/4" = 1\'',  value: 48 / 25.4,   category: 'Imperial' },
  { label: '3/8" = 1\'',  value: 32 / 25.4,   category: 'Imperial' },
  { label: '1/2" = 1\'',  value: 24 / 25.4,   category: 'Imperial' },
  { label: '3/4" = 1\'',  value: 16 / 25.4,   category: 'Imperial' },
  { label: '1" = 1\'',    value: 12 / 25.4,   category: 'Imperial' },

  // Custom entry sentinel
  { label: 'Custom…',    value: null,  category: 'Custom' },
];

// ─── Plotter / Device Definitions ───────────────────────────────────────────

export type PlotterOutputType = 'pdf' | 'png' | 'jpg' | 'svg' | 'dxf' | 'dwg' | 'browser';

export interface PlotDevice {
  key: string;
  /** AutoCAD-style display name. */
  name: string;
  /** Short description shown below the selector. */
  description: string;
  outputType: PlotterOutputType;
  /** Output format fed to ExportManagerService. */
  format: string;
  supportsColor: boolean;
  supportsTransparency: boolean;
  maxDpi: number;
  isVector: boolean;
  isRaster: boolean;
  available: boolean;
}

export const PLOTTER_REGISTRY: PlotDevice[] = [
  {
    key: 'DWGToPDF',
    name: 'DWG To PDF.pc3',
    description: 'High-fidelity vector PDF — recommended for professional output',
    outputType: 'pdf', format: 'pdf',
    supportsColor: true, supportsTransparency: true,
    maxDpi: 2400, isVector: true, isRaster: false, available: true,
  },
  {
    key: 'HighQualityPDF',
    name: 'High Quality PDF.pc3',
    description: 'PDF optimised for print production (CMYK-safe)',
    outputType: 'pdf', format: 'pdf',
    supportsColor: true, supportsTransparency: true,
    maxDpi: 2400, isVector: true, isRaster: false, available: true,
  },
  {
    key: 'GeneralDocPDF',
    name: 'AutoCAD PDF (General Documentation).pc3',
    description: 'Compact PDF for documentation and distribution',
    outputType: 'pdf', format: 'pdf',
    supportsColor: true, supportsTransparency: false,
    maxDpi: 1200, isVector: true, isRaster: false, available: true,
  },
  {
    key: 'SVGPlotter',
    name: 'SVG Plotter.pc3',
    description: 'Scalable Vector Graphics — Illustrator, Figma, web',
    outputType: 'svg', format: 'svg',
    supportsColor: true, supportsTransparency: true,
    maxDpi: 0, isVector: true, isRaster: false, available: true,
  },
  {
    key: 'PNGPlotter',
    name: 'PNG Plotter.pc3',
    description: 'High-resolution raster with transparency support',
    outputType: 'png', format: 'png',
    supportsColor: true, supportsTransparency: true,
    maxDpi: 1200, isVector: false, isRaster: true, available: true,
  },
  {
    key: 'JPGPlotter',
    name: 'JPG Plotter.pc3',
    description: 'Compressed raster — ideal for sharing and presentations',
    outputType: 'jpg', format: 'jpg',
    supportsColor: true, supportsTransparency: false,
    maxDpi: 1200, isVector: false, isRaster: true, available: true,
  },
  {
    key: 'DXFExport',
    name: 'DXF Export.pc3',
    description: 'AutoCAD DXF — exchange with AutoCAD, BricsCAD, NanoCAD',
    outputType: 'dxf', format: 'dxf',
    supportsColor: true, supportsTransparency: false,
    maxDpi: 0, isVector: true, isRaster: false, available: true,
  },
  {
    key: 'DWGExport',
    name: 'DWG Export.pc3',
    description: 'AutoCAD binary format (coming soon)',
    outputType: 'dwg', format: 'dwg',
    supportsColor: true, supportsTransparency: false,
    maxDpi: 0, isVector: true, isRaster: false, available: false,
  },
  {
    key: 'BrowserPrinter',
    name: 'Browser Printer',
    description: 'Send to system print dialog (any connected printer)',
    outputType: 'browser', format: 'browser',
    supportsColor: true, supportsTransparency: false,
    maxDpi: 600, isVector: true, isRaster: false, available: true,
  },
];

export function getPlotterByKey(key: string): PlotDevice | undefined {
  return PLOTTER_REGISTRY.find(p => p.key === key);
}

// ─── Plot Style Tables (CTB) ─────────────────────────────────────────────────

export interface PlotStyleTable {
  key: string;
  /** AutoCAD-compatible filename */
  filename: string;
  /** Display label */
  label: string;
  description: string;
  /**
   * Effect on color rendering:
   *  'color'       → keep source colors
   *  'monochrome'  → map all to black/white
   *  'grayscale'   → luminance-based gray mapping
   */
  colorMode: 'color' | 'monochrome' | 'grayscale';
}

export const PLOT_STYLE_REGISTRY: PlotStyleTable[] = [
  {
    key: 'acad_color',
    filename: 'acad.ctb',
    label: 'acad.ctb — Full Color',
    description: 'Preserve all CAD colors; ambiguous white/black are resolved for the output background.',
    colorMode: 'color',
  },
  {
    key: 'monochrome',
    filename: 'monochrome.ctb',
    label: 'monochrome.ctb — All Black',
    description: 'Map every color to solid black (white paper) or solid white (dark paper). Standard for construction drawings.',
    colorMode: 'monochrome',
  },
  {
    key: 'grayscale',
    filename: 'grayscale.ctb',
    label: 'grayscale.ctb — Grayscale',
    description: 'Luminance-based gray mapping — reduces ink usage while preserving tonal variation.',
    colorMode: 'grayscale',
  },
];

// ─── Page Setup ──────────────────────────────────────────────────────────────

export interface PageSetup {
  name: string;
  /** ISO8601 timestamp of last save. */
  savedAt: string;
  /** Partial IPlotOptions snapshot — only plot-relevant fields. */
  snapshot: {
    plotterKey: string;
    paperKey: string;
    orientation: string;
    scale: number | 'fit';
    margin: number;
    plotStyleKey: string;
    dpi: number;
    background: string;
    centerDrawing: boolean;
    plotLineweights: boolean;
    plotTransparency: boolean;
  };
}
