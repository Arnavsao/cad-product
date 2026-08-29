// @ts-nocheck
import { Injectable, inject, signal } from '@angular/core';
import type { IPlotOptions, PlotFormat } from '../../models/plot-options.model';
import { FORMAT_META } from '../../models/plot-options.model';
import { PdfExportService } from '../pdf-export.service';
import { PngExporterService } from './png-exporter.service';
import { SvgExporterService } from './svg-exporter.service';
import { PlotRendererService } from './plot-renderer.service';
import { ExportService } from '../export.service';
import { DocumentService } from '../document.service';
import { NotificationService } from '../../../../../core/services/notification.service';

/**
 * Single entry point for every Plot / Export / Download path in the editor.
 *
 *   ExportManager.plot(opts)  →  per-format exporter (registry dispatch)
 *
 * The dialog, keyboard shortcuts (Ctrl+P / Ctrl+Shift+P / Ctrl+E), command-bar
 * commands (PLOT / EXPORT / PDF / PNG …) and any legacy menu all route here.
 * New formats slot in as new registry entries without call sites changing:
 *
 *   ExportService (abstraction)
 *    ├─ PdfExporter   (vector, jsPDF)
 *    ├─ SvgExporter   (vector, recorder)
 *    ├─ PngExporter   (raster)
 *    ├─ JpgExporter   (raster)
 *    ├─ DxfExporter   (CAD exchange)
 *    └─ DwgExporter   (future — stubbed)
 *
 * DXF is a model-exchange format, not a sheet plot, so `area` / `paper` /
 * `scale` are ignored for it; the active file is emitted in full. PDF/PNG/JPG/
 * SVG honour lineweights, transparency and plot-style through the shared
 * renderer.
 */
type ExporterFn = (opts: IPlotOptions) => boolean;

@Injectable({ providedIn: 'root' })
export class ExportManagerService {
  private doc = inject(DocumentService);
  private pdf = inject(PdfExportService);
  private png = inject(PngExporterService);
  private plotRenderer = inject(PlotRendererService);
  private svg = inject(SvgExporterService);
  private dxf = inject(ExportService);
  private notify = inject(NotificationService);

  /**
   * Bumped after every successful DXF export with the emitted DXF string.
   * Parent components (e.g. CadEditor) can react via an `effect` to forward
   * the payload to their `save` output without coupling to the dialog.
   */
  readonly lastDxfSave = signal<string | null>(null);

  /** Last options actually plotted — drives Quick Plot (Ctrl+Shift+P). */
  readonly lastOptions = signal<IPlotOptions | null>(null);

  /** Format → exporter registry. Extend here; call sites never change. */
  private readonly registry: Record<PlotFormat, ExporterFn> = {
    pdf: (o) => this.pdf.exportPdf(o),
    svg: (o) => this.svg.exportSvg(o),
    png: (o) => this.png.exportRaster(o),
    jpg: (o) => this.png.exportRaster(o),
    dxf: () => this.exportDxf(),
    dwg: () => this.exportDwg(),
  };

  /** Returns true on successful download trigger. */
  plot(opts: IPlotOptions): boolean {
    const meta = FORMAT_META[opts.format];
    if (meta && !meta.available) {
      this.exportDwg();
      return false;
    }
    const exporter = this.registry[opts.format];
    if (!exporter) {
      this.notify.error(`Unsupported export format: ${opts.format}`);
      return false;
    }
    const ok = exporter(opts);
    if (ok) this.lastOptions.set({ ...opts });
    return ok;
  }

  /**
   * Quick Plot — re-runs the last plot with the exact same settings, no
   * dialog. Mirrors AutoCAD's Ctrl+Shift+P. Falls back to false (caller opens
   * the dialog) when nothing has been plotted yet.
   */
  quickPlot(): boolean {
    const last = this.lastOptions();
    if (!last) return false;
    return this.plot(last);
  }

  /**
   * Browser Print — renders the drawing to a hidden iframe and triggers the
   * OS print dialog (Ctrl+P → actual physical / PDF printer through the OS).
   * The iframe is removed after printing or on cancel.
   */
  browserPrint(opts: IPlotOptions): void {
    const printOpts: IPlotOptions = { ...opts, background: 'white' };
    const out = this.plotRenderer.renderToCanvas(printOpts, 150);
    if (!out) {
      this.notify.error('Nothing to print — draw something first.');
      return;
    }
    const dataUrl = out.canvas.toDataURL('image/png');
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      this.notify.error('Print failed: could not access print document.');
      return;
    }
    const orientationStyle = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>Print</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{display:flex;align-items:center;justify-content:center;background:#fff;}
  img{max-width:100%;max-height:100vh;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  @page{margin:0;size:${orientationStyle};}
</style>
</head><body><img id="printImg" src="${dataUrl}"/></body></html>`);
    doc.close();

    const img = doc.getElementById('printImg') as HTMLImageElement;
    const triggerPrint = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          this.notify.success('Print document generated! Browser print dialog opened.', 5000);
        } catch (err) {
          console.error('Print error:', err);
        } finally {
          setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 3000);
        }
      }, 250);
    };

    if (img && !img.complete) {
      img.onload = triggerPrint;
    } else {
      triggerPrint();
    }
  }

  private exportDxf(): boolean {
    const file = this.doc.activeFile;
    if (!file) return false;
    this.dxf.downloadDxf();
    const dxf = this.dxf.exportDXFView();
    this.lastDxfSave.set(dxf);
    return true;
  }

  private exportDwg(): boolean {
    // DWG is a closed binary format; a faithful writer is future scope. The
    // abstraction is in place so it slots in without touching call sites.
    this.notify.warning(
      'DWG export is coming soon. For a CAD-editable file use DXF, which opens in AutoCAD, BricsCAD, DraftSight and NanoCAD.',
      6000,
    );
    return false;
  }
}

