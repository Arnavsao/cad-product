import { Injectable, inject } from '@angular/core';
import { DocumentService } from '../document.service';
import { PlotRendererService } from './plot-renderer.service';
import { SvgRecorderContext, RecordingPath2D } from './svg-recorder.context';
import type { IPlotOptions } from '../../models/plot-options.model';

/**
 * Vector SVG exporter. Reuses the shared `PlotRendererService.render` pipeline
 * but swaps the real 2D canvas context for an {@link SvgRecorderContext}, so
 * every entity's existing `draw()` routine emits crisp `<path>`/`<text>`
 * elements instead of pixels.
 *
 * Output opens and stays editable in Illustrator, Figma and Inkscape with
 * preserved paths, text, dimensions, leaders and splines.
 *
 * SVG is resolution-independent, so the geometry is generated at a moderate
 * fixed DPI (96) purely to keep coordinate magnitudes sane — visual quality is
 * unaffected by this number.
 */
@Injectable({ providedIn: 'root' })
export class SvgExporterService {
  private doc = inject(DocumentService);
  private renderer = inject(PlotRendererService);

  /** SVG generation DPI — vector output stays crisp regardless of this value. */
  private static readonly SVG_DPI = 96;

  exportSvg(opts: IPlotOptions): boolean {
    const svg = this.buildSvgString(opts);
    if (!svg) {
      console.warn('SVG export: nothing to draw.');
      return false;
    }
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const name = (this.doc.activeFile?.name || 'drawing').replace(/\.dxf$/i, '') + '.svg';
    triggerDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  /** Build the raw SVG string (used by export + future preview/embed paths). */
  buildSvgString(opts: IPlotOptions): string | null {
    const geom = this.renderer.computeGeometry(opts, SvgExporterService.SVG_DPI);
    if (!geom) return null;

    const recorder = new SvgRecorderContext(geom.canvasPx.w, geom.canvasPx.h);

    // Hatches build boundaries with `new Path2D()` then hand them to
    // ctx.fill/clip. A native Path2D exposes no geometry, so we temporarily
    // swap the global for a recording subclass the recorder can read back.
    const NativePath2D = (globalThis as any).Path2D;
    (globalThis as any).Path2D = RecordingPath2D;
    try {
      // The recorder is a faithful CanvasRenderingContext2D work-alike; render()
      // only uses 2D-context APIs so the cast is safe.
      this.renderer.render(recorder as unknown as CanvasRenderingContext2D, opts, geom);
    } finally {
      (globalThis as any).Path2D = NativePath2D;
    }

    // Background is already recorded by render()'s fillBackground pass (unless
    // transparent), so we don't inject another rect here.
    return recorder.toSvg(null);
  }
}

function triggerDownload(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}
