import { Injectable, inject } from '@angular/core';
import type { Entity, IPoint } from '../models/entity.model';
import { TableEntity, ITableCell } from '../models/table-entity.model';
import { TextEntity } from '../models/entity-extended.model';
import { ImageEntity } from '../models/image-entity.model';
import { DocumentService } from './document.service';
import { ViewModelService } from './view-model.service';
import { CommandStackService } from './command-stack.service';
import { DrawOrderService } from './draw-order.service';
import { PasteEntitiesCmd } from '../models/command.model';

/**
 * AutoCAD-style clipboard interoperability.
 *
 * When the user presses Ctrl+V, we first interrogate the system clipboard
 * (HTML / plain text / images) and try to convert foreign content into
 * native editable CAD entities. If nothing foreign is found, the caller
 * falls back to its internal Entity[] clipboard (CAD-to-CAD copy/paste).
 *
 * Detection order (priority):
 *   1. image/*               → ImageEntity
 *   2. text/html w/ <table>  → TableEntity (with per-cell formatting)
 *   3. text/html             → TextEntity (plain-text fallback after HTML strip)
 *   4. text/plain            → TextEntity
 *
 * Deferred (per stated scope):
 *   - DXF fragment / ENTITIES section parsing → native LINE/ARC/POLYLINE
 *   - AutoCAD INSERT/BLOCK round-trip
 *   - RTF parsing for richer text styling
 */
@Injectable({ providedIn: 'root' })
export class ClipboardImportService {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private cmds = inject(CommandStackService);
  private drawOrder = inject(DrawOrderService);

  /**
   * Try to import foreign content from the system clipboard. Returns the
   * imported entity list when a known format was recognized, otherwise
   * `null` (let the caller fall back to its internal clipboard).
   *
   * Async because `navigator.clipboard.read()` is Promise-based.
   */
  async tryImportFromSystemClipboard(at?: IPoint): Promise<Entity[] | null> {
    const anchor = at ?? this.defaultAnchor();
    if (!('clipboard' in navigator) || !navigator.clipboard.read) {
      // Older browsers / insecure context: best-effort plaintext only.
      return this.tryImportPlainText(anchor);
    }

    let items: ClipboardItems;
    try {
      items = await navigator.clipboard.read();
    } catch {
      // Permission denied or no Promise-API support → fall back to plaintext.
      return this.tryImportPlainText(anchor);
    }

    for (const item of items) {
      // 1. Images take highest priority — paste comes from a screenshot or DXF preview.
      const imageType = item.types.find((t) => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const ent = await this.imageFromBlob(blob, anchor);
        if (ent) return this.commitImport([ent]);
      }

      // 2. HTML — could be a table or styled text.
      if (item.types.includes('text/html')) {
        const blob = await item.getType('text/html');
        const html = await blob.text();
        const table = this.parseHtmlTable(html, anchor);
        if (table) return this.commitImport([table]);
        // No table inside the HTML — extract its visible text and fall through to text path.
        const stripped = this.stripHtml(html).trim();
        if (stripped) {
          return this.commitImport([this.textFromString(stripped, anchor)]);
        }
      }

      // 3. Plain text.
      if (item.types.includes('text/plain')) {
        const blob = await item.getType('text/plain');
        const text = (await blob.text()).trim();
        if (text) {
          // Could also be a tab-separated table (Excel-style). Try TSV first.
          const tsvTable = this.parseTsvTable(text, anchor);
          if (tsvTable) return this.commitImport([tsvTable]);
          return this.commitImport([this.textFromString(text, anchor)]);
        }
      }
    }
    return null;
  }

  // ─── Defaults & helpers ──────────────────────────────────────────────────

  /**
   * Anchor when the caller didn't provide one. Uses the last tracked cursor
   * world position, falling back to the world origin if nothing tracked yet.
   */
  private defaultAnchor(): IPoint {
    const c = this.vm.lastCursorWorld;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y) && (c.x !== 0 || c.y !== 0)) {
      return { x: c.x, y: c.y };
    }
    return { x: 0, y: 0 };
  }

  /** Push imported entities through the command stack so undo works. */
  private commitImport(ents: Entity[]): Entity[] {
    if (!ents.length) return ents;
    const file = this.doc.activeFile;
    for (const f of this.doc.files) for (const e of f.entities) e.selected = false;
    for (const e of ents) {
      e.selected = true;
      e.layer = this.doc.activeLayer;
    }
    this.drawOrder.assignInitial(ents, file.entities);
    this.cmds.push(new PasteEntitiesCmd(ents, file, { markDirty: () => this.vm.markContentDirty() }));
    return ents;
  }

  /** Best-effort plaintext path for browsers without `navigator.clipboard.read`. */
  private async tryImportPlainText(anchor: IPoint): Promise<Entity[] | null> {
    if (!('clipboard' in navigator) || !navigator.clipboard.readText) return null;
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return null;
      const tsv = this.parseTsvTable(text, anchor);
      if (tsv) return this.commitImport([tsv]);
      return this.commitImport([this.textFromString(text, anchor)]);
    } catch {
      return null;
    }
  }

  // ─── Phase 1: HTML table → TableEntity ───────────────────────────────────

  /**
   * Parse the first <table> in an HTML fragment into a TableEntity.
   * Per-cell formatting picked up:
   *   - bold/italic/underline via inline <b><i><u> or font-weight/style
   *   - text-align (cell.align)
   *   - background-color (cell.bgColor)
   *   - color (cell.textColor)
   *   - colspan/rowspan are flattened — the leading cell takes the full
   *     text and trailing cells get blanks. (Cell merging is not yet
   *     a TableEntity feature.)
   */
  parseHtmlTable(html: string, at: IPoint): TableEntity | null {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;

    // Collapse <thead>/<tbody>/<tfoot> into a flat row list.
    const rowEls = Array.from(table.querySelectorAll('tr'));
    if (!rowEls.length) return null;

    // Probe the widest row to size the column count.
    let cols = 0;
    for (const tr of rowEls) {
      const cellEls = tr.querySelectorAll('td, th');
      let count = 0;
      for (const c of Array.from(cellEls)) {
        const cs = parseInt(c.getAttribute('colspan') ?? '1', 10) || 1;
        count += cs;
      }
      if (count > cols) cols = count;
    }
    const rows = rowEls.length;
    if (rows < 1 || cols < 1) return null;

    const headerRow = !!table.querySelector('thead') || rowEls[0].querySelector('th') !== null;

    const ent = new TableEntity(at.x, at.y, rows, cols, {
      colWidth: 40, rowHeight: 10, defaultFontSize: 2.5,
    });
    ent.headerRow = headerRow;
    ent.titleRow = false;

    // Walk cells, honoring colspan but flattening into the rectangular cell grid.
    for (let r = 0; r < rows; r++) {
      const cellEls = Array.from(rowEls[r].querySelectorAll('td, th')) as HTMLElement[];
      let c = 0;
      for (const el of cellEls) {
        if (c >= cols) break;
        const cs = Math.max(1, parseInt(el.getAttribute('colspan') ?? '1', 10) || 1);
        ent.cells[r][c] = this.htmlCellToTableCell(el);
        // Trailing colspan slots — blank cells so layout stays rectangular.
        for (let k = 1; k < cs && c + k < cols; k++) {
          ent.cells[r][c + k] = { text: '' };
        }
        c += cs;
      }
    }

    // Best-effort column-width estimate: pick the widest cell text per column,
    // scale to a sensible world width (1 world unit ≈ 1.5 char widths).
    for (let col = 0; col < cols; col++) {
      let maxChars = 4;
      for (let r = 0; r < rows; r++) {
        const t = (ent.cells[r][col]?.text ?? '').replace(/\n/g, ' ');
        if (t.length > maxChars) maxChars = t.length;
      }
      ent.colWidths[col] = Math.max(20, Math.min(120, maxChars * 1.6));
    }

    ent.refreshCaches?.();
    return ent;
  }

  private htmlCellToTableCell(el: HTMLElement): ITableCell {
    const text = (el.textContent ?? '').replace(/\r\n?/g, '\n').trim();
    const style = el.style;
    const align = (style.textAlign || el.getAttribute('align') || '').toLowerCase();
    const tag = el.tagName.toLowerCase();

    // Inline-element-derived flags (AutoCAD/Excel often emit <b> + style:font-weight).
    const hasBold = el.querySelector('b, strong') !== null
      || /bold/i.test(style.fontWeight)
      || tag === 'th';
    const hasItalic = el.querySelector('i, em') !== null || style.fontStyle === 'italic';
    const hasUnderline = el.querySelector('u') !== null || /underline/.test(style.textDecoration);

    const cell: ITableCell = {
      text,
      bold: hasBold || undefined,
      italic: hasItalic || undefined,
      underline: hasUnderline || undefined,
      align: align === 'left' || align === 'right' || align === 'center' ? align : undefined,
    };
    if (style.color) cell.textColor = this.cssColorToHex(style.color);
    if (style.backgroundColor) cell.bgColor = this.cssColorToHex(style.backgroundColor);
    return cell;
  }

  /**
   * Excel-style TSV (tab-separated, newline-terminated). When the clipboard
   * comes through `text/plain` only (some apps don't expose HTML), we still
   * want to land it as a TableEntity if it parses as a rectangular grid.
   */
  parseTsvTable(text: string, at: IPoint): TableEntity | null {
    if (!text.includes('\t')) return null;
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 2) return null;            // single line → not a table
    const grid = lines.map((l) => l.split('\t'));
    const cols = Math.max(...grid.map((r) => r.length));
    if (cols < 2) return null;                    // need ≥ 2 columns
    const rows = grid.length;
    const ent = new TableEntity(at.x, at.y, rows, cols, {
      colWidth: 40, rowHeight: 10, defaultFontSize: 2.5,
    });
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ent.cells[r][c] = { text: (grid[r][c] ?? '').trim() };
      }
    }
    for (let col = 0; col < cols; col++) {
      let maxChars = 4;
      for (let r = 0; r < rows; r++) {
        const t = ent.cells[r][col].text;
        if (t.length > maxChars) maxChars = t.length;
      }
      ent.colWidths[col] = Math.max(20, Math.min(120, maxChars * 1.6));
    }
    ent.refreshCaches?.();
    return ent;
  }

  // ─── Phase 2: text → TextEntity ──────────────────────────────────────────

  textFromString(text: string, at: IPoint): TextEntity {
    const ent = new TextEntity(at.x, at.y, text);
    ent.height = 2.5;
    // Multi-line pasted text should use top-left alignment so it reads
    // naturally downward from the paste anchor.
    if (text.includes('\n')) {
      ent.justify = 'TL';
      ent.lineSpacing = 1.2;
    }
    ent.refreshCaches?.();
    return ent;
  }

  /** Strip HTML tags for the plaintext fallback after a no-table HTML payload. */
  private stripHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body?.textContent ?? '').replace(/ /g, ' ');
  }

  // ─── Phase 3: image → ImageEntity ────────────────────────────────────────

  async imageFromBlob(blob: Blob, at: IPoint): Promise<ImageEntity | null> {
    const dataUrl = await this.blobToDataUrl(blob);
    if (!dataUrl) return null;
    const dims = await this.decodeImageSize(dataUrl);

    // Calculate dynamic size based on current viewport to ensure the pasted
    // image is visible at the current zoom level and doesn't get microscopic.
    const viewportW = (this.vm.canvasWidth > 0 && this.vm.scale > 0) ? (this.vm.canvasWidth / this.vm.scale) : 0;
    const viewportH = (this.vm.canvasHeight > 0 && this.vm.scale > 0) ? (this.vm.canvasHeight / this.vm.scale) : 0;

    let targetDim = 100; // fallback if canvas is not ready
    if (viewportW > 0 && viewportH > 0) {
      targetDim = Math.min(viewportW, viewportH) * 0.25;
    }

    let w = targetDim;
    let h = targetDim * 0.6; // fallback aspect ratio
    if (dims) {
      const ratio = dims.w / dims.h;
      if (dims.w >= dims.h) {
        w = targetDim;
        h = targetDim / ratio;
      } else {
        h = targetDim;
        w = targetDim * ratio;
      }
    }
    // ImageEntity (x,y) is BOTTOM-LEFT in world space — but the paste anchor
    // feels best when it lands on the image's CENTER. Recenter.
    const ent = new ImageEntity(dataUrl, at.x - w / 2, at.y - h / 2, w, h);
    ent.refreshCaches?.();
    return ent;
  }

  private blobToDataUrl(blob: Blob): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  private decodeImageSize(dataUrl: string): Promise<{ w: number; h: number } | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // ─── CSS color → hex ─────────────────────────────────────────────────────

  /**
   * Convert any browser-rendered CSS color (rgb / rgba / named) into a hex
   * string the TableEntity / ITableCell consumers expect. Defers to the
   * browser by using a throwaway canvas's `fillStyle`, which normalizes
   * the input.
   */
  private cssColorToHex(css: string): string {
    if (!css) return '#000000';
    if (css.startsWith('#') && (css.length === 7 || css.length === 4)) return css;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '#000000';
    ctx.fillStyle = '#000';
    try { ctx.fillStyle = css; } catch { return '#000000'; }
    // After assigning, ctx.fillStyle normalizes to '#rrggbb' or 'rgba(...)'.
    const normalized = ctx.fillStyle;
    if (typeof normalized === 'string' && normalized.startsWith('#')) return normalized;
    // rgba(...) → hex (alpha discarded).
    const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(normalized as string);
    if (m) {
      const r = (+m[1]).toString(16).padStart(2, '0');
      const g = (+m[2]).toString(16).padStart(2, '0');
      const b = (+m[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    return '#000000';
  }
}
