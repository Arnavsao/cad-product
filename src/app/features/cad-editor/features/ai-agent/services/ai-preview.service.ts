import { Injectable, inject, signal } from '@angular/core';
import { ViewModelService } from '../../../core/services/view-model.service';
import { DocumentService } from '../../../core/services/document.service';

/**
 * AiPreviewService — visual "see before apply" overlay.
 *
 * When the orchestrator emits a plan that awaits confirmation, it registers the
 * affected entity ids here. The canvas render loop calls `render()` after the
 * tool preview, drawing a dashed accent highlight around each affected entity's
 * bounding box. Cleared on confirm / cancel / new turn.
 *
 * This never mutates the document — it only paints a transient overlay, exactly
 * like the move/rotate ghost preview the modify tools already use.
 */
@Injectable({ providedIn: 'root' })
export class AiPreviewService {
  private vm = inject(ViewModelService);

  /** Entity ids to highlight while a plan is pending. */
  readonly activeIds = signal<Set<number>>(new Set());
  /** Risk class drives the highlight colour. */
  readonly risk = signal<'safe' | 'review' | 'destructive'>('review');

  show(ids: number[], risk: 'safe' | 'review' | 'destructive'): void {
    if (!ids.length) return;
    this.activeIds.set(new Set(ids));
    this.risk.set(risk);
    this.vm.markDirty();
  }

  clear(): void {
    if (this.activeIds().size === 0) return;
    this.activeIds.set(new Set());
    this.vm.markDirty();
  }

  hasPreview(): boolean {
    return this.activeIds().size > 0;
  }

  /**
   * Draw a highlight box around every affected entity. Called by the canvas
   * render loop. World→screen via the shared ViewModel so it tracks pan/zoom.
   */
  render(ctx: CanvasRenderingContext2D, doc: DocumentService): void {
    const ids = this.activeIds();
    if (ids.size === 0) return;

    const colors = {
      safe: { stroke: 'rgba(52,211,153,0.9)', fill: 'rgba(52,211,153,0.12)' },
      review: { stroke: 'rgba(79,142,247,0.9)', fill: 'rgba(79,142,247,0.12)' },
      destructive: { stroke: 'rgba(248,113,113,0.95)', fill: 'rgba(248,113,113,0.14)' },
    }[this.risk()];

    ctx.save();
    ctx.strokeStyle = colors.stroke;
    ctx.fillStyle = colors.fill;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);

    const pad = 4;
    for (const e of doc.activeFile.entities) {
      if (!ids.has(e.id)) continue;
      const bb = typeof e.bbox === 'function' ? e.bbox() : null;
      if (!bb || !isFinite(bb.x) || !isFinite(bb.y) || !isFinite(bb.w) || !isFinite(bb.h)) continue;

      // World corners → screen (Y is flipped by w2s).
      const a = this.vm.w2s(bb.x, bb.y + bb.h);
      const b = this.vm.w2s(bb.x + bb.w, bb.y);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);

      ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
      ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
    }

    ctx.restore();
  }
}
