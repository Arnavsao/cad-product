import { Injectable, inject } from '@angular/core';

import { DrawingsApiService } from '../../../../core/api/drawings-api.service';
import { DocumentManagerService } from './document-manager.service';
import { PlotRendererService } from './export/plot-renderer.service';
import { ThemeService } from './theme.service';
import { IPlotOptions, defaultPlotOptions, defaultRasterOptions } from '../models/plot-options.model';

/** Debounce window before a thumbnail render is attempted. */
const DEBOUNCE_MS = 1500;

/** Render resolution. 76 dpi over a 160×100 mm sheet ≈ 480×300 px. */
const THUMBNAIL_DPI = 76;

/** Card-shaped sheet: wide enough for a landscape drawing, small enough to be cheap. */
const THUMBNAIL_PAPER_MM = { w: 160, h: 100 };

/**
 * Renders and uploads the dashboard preview image for a saved drawing.
 *
 * Design decisions:
 *  - **Reuses the plot renderer**, so the thumbnail is the same picture the
 *    user would get from PLOT → PNG (extents, fit to page) rather than a
 *    second, subtly different drawing pipeline that could drift.
 *  - **Debounced and deferred a frame.** `renderToCanvas` runs on the main
 *    thread and walks every entity; firing it inline with the save would jank
 *    the very interaction that triggered it, and a burst of Ctrl+S presses
 *    would render once per press.
 *  - **Active-document only.** `PlotRendererService` reads `DocumentService`,
 *    i.e. whatever tab is active *now* — it cannot render a background tab. If
 *    the user switched tabs during the debounce the render would silently
 *    upload the wrong picture, so it is skipped instead.
 *  - **Fire and forget.** A missing thumbnail is cosmetic. Nothing here ever
 *    rejects or toasts; failures are logged and dropped.
 */
@Injectable({ providedIn: 'root' })
export class ThumbnailService {
  private readonly plotRenderer = inject(PlotRendererService);
  private readonly docManager = inject(DocumentManagerService);
  private readonly theme = inject(ThemeService);
  private readonly api = inject(DrawingsApiService);

  /** drawingId → pending debounce timer. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Render the ACTIVE document to a PNG blob, or null when there is nothing
   * plottable (an empty drawing has no extents, so the renderer bails).
   */
  async render(): Promise<Blob | null> {
    const opts: IPlotOptions = {
      ...defaultPlotOptions(),
      format: 'png',
      area: 'extents',
      scale: 'fit',
      paper: 'Custom',
      customPaperMm: { ...THUMBNAIL_PAPER_MM },
      orientation: 'landscape',
      margin: 4,
      // Match the app chrome so a dark-theme drawing's white geometry stays
      // visible on the dashboard card.
      background: this.theme.isLight() ? 'white' : 'dark',
      plotStamp: false,
      dpi: THUMBNAIL_DPI,
      rasterOptions: defaultRasterOptions(),
    };

    const rendered = this.plotRenderer.renderToCanvas(opts, THUMBNAIL_DPI);
    if (!rendered) return null;

    return new Promise<Blob | null>((resolve) => {
      rendered.canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  /**
   * Queue a thumbnail refresh for `drawingId`, rendered from `tabId`.
   *
   * `tabId` is required (and re-checked when the timer fires) because the
   * renderer can only see the active document — see the class doc.
   */
  scheduleThumbnail(drawingId: string, tabId: string): void {
    if (!drawingId || !tabId) return;

    const existing = this.timers.get(drawingId);
    if (existing !== undefined) clearTimeout(existing);

    this.timers.set(
      drawingId,
      setTimeout(() => {
        this.timers.delete(drawingId);
        // One more frame of headroom: the save's own reflow lands first.
        requestAnimationFrame(() => void this.renderAndUpload(drawingId, tabId));
      }, DEBOUNCE_MS),
    );
  }

  /** Drop any queued render for a drawing (e.g. its tab was closed). */
  cancel(drawingId: string): void {
    const timer = this.timers.get(drawingId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(drawingId);
    }
  }

  private async renderAndUpload(drawingId: string, tabId: string): Promise<void> {
    try {
      if (this.docManager.activeTabId !== tabId) return;
      const png = await this.render();
      if (!png) return;
      if (this.docManager.activeTabId !== tabId) return; // the render itself yielded
      await this.api.putThumbnail(drawingId, png);
    } catch (e) {
      console.warn('[ThumbnailService] thumbnail upload skipped', e);
    }
  }
}
