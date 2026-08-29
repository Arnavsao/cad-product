import { Injectable, inject } from '@angular/core';
import { DocumentService } from '../document.service';
import { PlotRendererService } from './plot-renderer.service';
import {
  IPlotOptions,
  effectiveRasterDpi,
  getPaperSizeMm,
} from '../../models/plot-options.model';

/**
 * High-resolution raster export (PNG + JPG). The effective DPI drives an
 * offscreen canvas whose pixel dimensions equal `paper_mm * dpi / 25.4` — so
 * an A1 sheet at 600 DPI yields a ~14000 × 19800 px buffer with all
 * dimensions, hatches and tables drawn at native resolution (no upscaling).
 *
 * Resolution can also be pinned to a long-edge pixel target (the 2K/4K/8K
 * presets) via {@link effectiveRasterDpi}, giving a predictable pixel count
 * regardless of paper size.
 *
 * PNG honours the `transparent` background (alpha channel preserved). JPG is
 * always opaque (the renderer falls back to a white fill) and respects the
 * `jpgQuality` option.
 */
@Injectable({ providedIn: 'root' })
export class PngExporterService {
  private doc = inject(DocumentService);
  private renderer = inject(PlotRendererService);

  /** Back-compat entry point — PNG. */
  exportPng(opts: IPlotOptions): boolean {
    return this.exportRaster({ ...opts, format: 'png' });
  }

  /** Export PNG or JPG depending on `opts.format`. */
  exportRaster(opts: IPlotOptions): boolean {
    const isJpg = opts.format === 'jpg';
    // JPG cannot carry alpha — force an opaque (white) background.
    const effective: IPlotOptions = isJpg && opts.background === 'transparent'
      ? { ...opts, background: 'white' }
      : opts;

    const paperMm = resolvePaperMm(effective);
    const dpi = effectiveRasterDpi(effective, paperMm);
    const out = this.renderer.renderToCanvas(effective, dpi);
    if (!out) {
      console.warn('Raster export: nothing to draw.');
      return false;
    }

    const mime = isJpg ? 'image/jpeg' : 'image/png';
    const url = isJpg
      ? out.canvas.toDataURL(mime, clamp01(effective.jpgQuality ?? 0.92))
      : out.canvas.toDataURL(mime);
    const ext = isJpg ? 'jpg' : 'png';
    const name = (this.doc.activeFile?.name || 'drawing').replace(/\.dxf$/i, '') + '.' + ext;
    triggerDownload(url, name);
    return true;
  }
}

function resolvePaperMm(opts: IPlotOptions): { w: number; h: number } {
  const raw = getPaperSizeMm(opts.paper, opts.customPaperMm);
  return opts.orientation === 'portrait'
    ? { w: Math.min(raw.w, raw.h), h: Math.max(raw.w, raw.h) }
    : { w: Math.max(raw.w, raw.h), h: Math.min(raw.w, raw.h) };
}

function clamp01(v: number): number {
  return Math.max(0.1, Math.min(1, Number.isFinite(v) ? v : 0.92));
}

function triggerDownload(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (link.parentNode) link.parentNode.removeChild(link);
  }, 1000);
}
