import { Injectable } from '@angular/core';

const KEY_DXF = 'cad.transfer.dxf';
const KEY_FILENAME = 'cad.transfer.filename';
const KEY_DRAWING_ID = 'cad.transfer.drawingId';
const KEY_CONTEXT_ID = 'cad.transfer.contextId';

export interface DrawingTransfer {
  /** DXF text, or a JSON entity payload (array / `{ entities: [...] }`). */
  dxf: string;
  filename: string;
  /** Identifier of the drawing in the host system, if any. */
  drawingId?: string;
  /** Opaque host-side context (e.g. a project or version id). */
  contextId?: string;
}

/**
 * Hand-off channel that lets a host application (or another page of this app)
 * open a drawing in the editor without a file dialog.
 *
 * `set()` stores the payload in memory and mirrors it to localStorage so the
 * hand-off survives a hard refresh; `consume()` on the editor page reads it
 * back. Call `clear()` once the drawing has been persisted elsewhere.
 */
@Injectable({ providedIn: 'root' })
export class DrawingTransferService {
  private pending: DrawingTransfer | null = null;

  set(dxf: string, filename = 'Drawing.dxf', drawingId?: string, contextId?: string): void {
    this.pending = { dxf, filename, drawingId, contextId };
    try {
      localStorage.setItem(KEY_DXF, dxf);
      localStorage.setItem(KEY_FILENAME, filename);
      drawingId ? localStorage.setItem(KEY_DRAWING_ID, drawingId) : localStorage.removeItem(KEY_DRAWING_ID);
      contextId ? localStorage.setItem(KEY_CONTEXT_ID, contextId) : localStorage.removeItem(KEY_CONTEXT_ID);
    } catch (e) {
      console.warn('[DrawingTransferService] localStorage unavailable; hand-off will not survive a refresh.', e);
    }
  }

  consume(): DrawingTransfer | null {
    if (this.pending) return this.pending;
    try {
      const dxf = localStorage.getItem(KEY_DXF);
      if (!dxf) return null;
      this.pending = {
        dxf,
        filename: localStorage.getItem(KEY_FILENAME) || 'Drawing.dxf',
        drawingId: localStorage.getItem(KEY_DRAWING_ID) || undefined,
        contextId: localStorage.getItem(KEY_CONTEXT_ID) || undefined,
      };
      return this.pending;
    } catch {
      return null;
    }
  }

  clear(): void {
    this.pending = null;
    try {
      [KEY_DXF, KEY_FILENAME, KEY_DRAWING_ID, KEY_CONTEXT_ID].forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }
}
