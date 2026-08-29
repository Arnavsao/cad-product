import { Entity, IBBox, ISnapPoint, IPropertySchema, ViewModelLike, DocLike } from './entity.model';
import { displayColor } from '../utils/theme-color-mapper';

export interface ITableCell {
  text: string;
  /** Per-cell font override. Falls back to TableEntity.defaultFont when null. */
  font?: string | null;
  /** Per-cell text height (world units). Falls back to defaultFontSize. */
  fontSize?: number | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  textColor?: string | null;
  bgColor?: string | null;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  borderStyle?: string;
}

/**
 * AutoCAD-style table entity.
 *
 * Coords:
 *   `(x, y)` is the TOP-LEFT corner in world space. World Y is up, so the
 *   table extends to the right (+x) and DOWN (-y).
 *
 * Cell access:
 *   `cells[row][col]`, where row 0 is the topmost row.
 *
 * Sizes:
 *   `colWidths[col]` and `rowHeights[row]` are world-units, independently
 *   adjustable per column / per row.
 *
 * Per-cell formatting is supported via the optional fields on `ITableCell`,
 * but the v1 properties panel only exposes the global defaults plus a TSV
 * editor for cell text. Granular per-cell formatting is a follow-up.
 *
 * NOT in this turn: DXF ACAD_TABLE round-trip; merge/split cells; per-cell
 * border-style overrides; in-place WYSIWYG cell editor.
 */
export class TableEntity extends Entity {
  x: number;
  y: number;
  rows: number;
  cols: number;
  colWidths: number[];
  rowHeights: number[];
  cells: ITableCell[][];

  // Table structure toggles
  titleRow: boolean;
  headerRow: boolean;
  titleText: string;

  // Uniform table-wide visual defaults
  borderColor: string;
  borderWeight: number;     // world-units → scaled by vm.scale at render
  cellPadding: number;      // world-units inside each cell
  defaultFont: string;
  defaultFontSize: number;  // world units
  defaultTextColor: string;
  defaultAlign: 'left' | 'center' | 'right';
  defaultValign: 'top' | 'middle' | 'bottom';

  // Specific row styles
  titleFontSize: number;
  titleTextColor: string;
  titleBgColor: string | null;
  headerBgColor: string | null;
  headerTextColor: string;
  headerFontSize: number;

  constructor(x: number, y: number, rows: number, cols: number, opts: {
    colWidth?: number; rowHeight?: number;
    defaultFontSize?: number;
  } = {}) {
    super('TABLE');
    this.x = x;
    this.y = y;
    this.rows = Math.max(1, rows);
    this.cols = Math.max(1, cols);
    const colW = opts.colWidth ?? 40;
    const rowH = opts.rowHeight ?? 10;
    this.colWidths = new Array(this.cols).fill(colW);
    this.rowHeights = new Array(this.rows).fill(rowH);
    this.cells = [];
    for (let r = 0; r < this.rows; r++) {
      const row: ITableCell[] = [];
      for (let c = 0; c < this.cols; c++) row.push({ text: '' });
      this.cells.push(row);
    }
    this.borderColor = '#e0e4ea';
    this.borderWeight = 0.25;
    this.cellPadding = 1;
    this.defaultFont = 'Arial';
    this.defaultFontSize = opts.defaultFontSize ?? 2.5;
    this.defaultTextColor = '#e0e4ea';
    this.defaultAlign = 'left';
    this.defaultValign = 'middle';
    
    this.titleRow = true;
    this.headerRow = true;
    this.titleText = 'TABLE';
    this.titleFontSize = this.defaultFontSize * 1.5;
    this.titleTextColor = this.defaultTextColor;
    this.titleBgColor = null;
    
    this.headerBgColor = null;
    this.headerTextColor = this.defaultTextColor;
    this.headerFontSize = this.defaultFontSize * 1.1;
  }

  get totalWidth(): number { return this.colWidths.reduce((a, b) => a + b, 0); }
  get totalHeight(): number { return this.rowHeights.reduce((a, b) => a + b, 0); }

  /** Tab-separated cell content, one row per line. Used by the properties panel's TSV editor. */
  get cellsTSV(): string {
    return this.cells.map((row) => row.map((c) => (c.text ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t')).join('\n');
  }
  set cellsTSV(value: string) {
    if (typeof value !== 'string') return;
    const lines = value.split(/\r?\n/);
    const newRows = Math.max(1, lines.length);
    const newCols = Math.max(1, ...lines.map((l) => l.split('\t').length));
    // Resize structure first (preserves existing cells; new cells default-init)
    this._resize(newRows, newCols);
    // Then fill text
    for (let r = 0; r < newRows; r++) {
      const cells = lines[r].split('\t');
      for (let c = 0; c < this.cols; c++) {
        this.cells[r][c].text = cells[c] ?? '';
      }
    }
    this.refreshCaches();
  }

  /** Resize the row/col counts, preserving existing cells where they overlap. */
  private _resize(rows: number, cols: number): void {
    if (rows < 1 || cols < 1) return;
    // Adjust rows
    while (this.cells.length < rows) {
      const row: ITableCell[] = [];
      for (let c = 0; c < cols; c++) row.push({ text: '' });
      this.cells.push(row);
      this.rowHeights.push(this.rowHeights[this.rowHeights.length - 1] ?? 10);
    }
    if (this.cells.length > rows) {
      this.cells.length = rows;
      this.rowHeights.length = rows;
    }
    // Adjust cols per row
    for (const row of this.cells) {
      while (row.length < cols) row.push({ text: '' });
      if (row.length > cols) row.length = cols;
    }
    while (this.colWidths.length < cols) {
      this.colWidths.push(this.colWidths[this.colWidths.length - 1] ?? 40);
    }
    if (this.colWidths.length > cols) this.colWidths.length = cols;
    this.rows = rows;
    this.cols = cols;
  }

  private resolveThemeColor(c: string | undefined, doc: DocLike): string {
    let color = c || '#ffffff';
    if (color.toLowerCase() === '#e0e4ea') color = '#ffffff';
    return displayColor(color, doc);
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    if (this.rows < 1 || this.cols < 1) return;

    const totalW = this.totalWidth;
    const totalH = this.totalHeight;

    // First pass: cell backgrounds.
    let rowTop = this.y;
    for (let r = 0; r < this.rows; r++) {
      let colLeft = this.x;
      const rowBottom = rowTop - this.rowHeights[r];
      
      if (r === 0 && this.titleRow) {
        if (this.titleBgColor) {
          const a = vm.w2s(this.x, rowTop);
          const b = vm.w2s(this.x + totalW, rowBottom);
          ctx.fillStyle = this.titleBgColor;
          ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        }
        rowTop = rowBottom;
        continue;
      }

      for (let c = 0; c < this.cols; c++) {
        const colRight = colLeft + this.colWidths[c];
        const cell = this.cells[r][c];
        
        let bgColor = cell.bgColor;
        if (!bgColor && this.headerRow && (this.titleRow ? r === 1 : r === 0)) {
           bgColor = this.headerBgColor;
        }

        if (bgColor) {
          const a = vm.w2s(colLeft, rowTop);
          const b = vm.w2s(colRight, rowBottom);
          ctx.fillStyle = bgColor;
          ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        }
        colLeft = colRight;
      }
      rowTop = rowBottom;
    }

    // Second pass: cell text.
    rowTop = this.y;
    for (let r = 0; r < this.rows; r++) {
      let colLeft = this.x;
      const rowBottom = rowTop - this.rowHeights[r];
      
      if (r === 0 && this.titleRow) {
        const fakeCell: ITableCell = {
           text: this.titleText,
           font: this.defaultFont,
           fontSize: this.titleFontSize,
           textColor: this.titleTextColor,
           align: 'center',
           valign: 'middle'
        };
        if (this.titleText) {
           this._drawCellText(ctx, vm, doc, fakeCell, this.x, rowTop, this.x + totalW, rowBottom);
        }
        rowTop = rowBottom;
        continue;
      }

      const isHeader = this.headerRow && (this.titleRow ? r === 1 : r === 0);

      for (let c = 0; c < this.cols; c++) {
        const colRight = colLeft + this.colWidths[c];
        const cell = this.cells[r][c];
        
        const effectiveCell: ITableCell = isHeader ? {
            ...cell,
            fontSize: cell.fontSize ?? this.headerFontSize,
            textColor: cell.textColor ?? this.headerTextColor,
            align: cell.align ?? 'center'
        } : cell;

        if (effectiveCell.text) this._drawCellText(ctx, vm, doc, effectiveCell, colLeft, rowTop, colRight, rowBottom);
        colLeft = colRight;
      }
      rowTop = rowBottom;
    }

    // Third pass: grid lines on top.
    const widthPx = Math.max(1, this.borderWeight * vm.scale);
    ctx.save();
    ctx.strokeStyle = this.resolveThemeColor(this.borderColor, doc);
    ctx.lineWidth = widthPx;
    ctx.setLineDash([]);
    ctx.beginPath();
    // Verticals
    let colLeft = this.x;
    for (let c = 0; c <= this.cols; c++) {
      let vTop = this.y;
      if (this.titleRow && c > 0 && c < this.cols) {
         vTop -= this.rowHeights[0];
      }
      const a = vm.w2s(colLeft, vTop);
      const b = vm.w2s(colLeft, this.y - totalH);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (c < this.cols) colLeft += this.colWidths[c];
    }
    // Horizontals
    let rowY = this.y;
    for (let r = 0; r <= this.rows; r++) {
      const a = vm.w2s(this.x, rowY);
      const b = vm.w2s(this.x + totalW, rowY);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (r < this.rows) rowY -= this.rowHeights[r];
    }
    ctx.stroke();
    ctx.restore();
  }

  private _drawCellText(
    ctx: CanvasRenderingContext2D,
    vm: ViewModelLike,
    doc: DocLike,
    cell: ITableCell,
    leftW: number, topW: number, rightW: number, bottomW: number,
  ): void {
    const fontSizeW = cell.fontSize ?? this.defaultFontSize;
    const fontSizePx = Math.max(14, fontSizeW * vm.scale);
    const font = cell.font ?? this.defaultFont;
    const style = cell.italic ? 'italic ' : '';
    const weight = cell.bold ? 'bold ' : '';
    const padPx = this.cellPadding * vm.scale;
    const tl = vm.w2s(leftW, topW);
    const br = vm.w2s(rightW, bottomW);
    const left = Math.min(tl.x, br.x);
    const right = Math.max(tl.x, br.x);
    const top = Math.min(tl.y, br.y);
    const bottom = Math.max(tl.y, br.y);

    const align = cell.align ?? this.defaultAlign;
    const valign = cell.valign ?? this.defaultValign;

    let tx: number;
    if (align === 'center') tx = (left + right) / 2;
    else if (align === 'right') tx = right - padPx;
    else tx = left + padPx;

    let ty: number;
    if (valign === 'top') ty = top + padPx + fontSizePx * 0.85;
    else if (valign === 'bottom') ty = bottom - padPx;
    else ty = (top + bottom) / 2 + fontSizePx * 0.35;

    ctx.save();
    ctx.font = `${style}${weight}${fontSizePx}px ${font}`;
    ctx.fillStyle = this.resolveThemeColor(cell.textColor ?? this.defaultTextColor, doc);
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    // Clip to cell to avoid text overflow into neighbors.
    ctx.beginPath();
    ctx.rect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
    ctx.clip();
    ctx.fillText(cell.text, tx, ty);
    if (cell.underline && cell.text) {
      const w = ctx.measureText(cell.text).width;
      let ux = tx;
      if (align === 'center') ux = tx - w / 2;
      else if (align === 'right') ux = tx - w;
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = Math.max(1, fontSizePx * 0.06);
      ctx.beginPath();
      ctx.moveTo(ux, ty + fontSizePx * 0.12);
      ctx.lineTo(ux + w, ty + fontSizePx * 0.12);
      ctx.stroke();
    }
    if (cell.strikethrough && cell.text) {
      const w = ctx.measureText(cell.text).width;
      let ux = tx;
      if (align === 'center') ux = tx - w / 2;
      else if (align === 'right') ux = tx - w;
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = Math.max(1, fontSizePx * 0.06);
      ctx.beginPath();
      ctx.moveTo(ux, ty - fontSizePx * 0.3);
      ctx.lineTo(ux + w, ty - fontSizePx * 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  override snapPoints(): ISnapPoint[] {
    const totalW = this.totalWidth;
    const totalH = this.totalHeight;
    return [
      { x: this.x, y: this.y, label: 'corner' },
      { x: this.x + totalW, y: this.y, label: 'corner' },
      { x: this.x + totalW, y: this.y - totalH, label: 'corner' },
      { x: this.x, y: this.y - totalH, label: 'corner' },
      { x: this.x + totalW / 2, y: this.y - totalH / 2, label: 'center' },
    ];
  }

  override bbox(): IBBox {
    const totalH = this.totalHeight;
    return { x: this.x, y: this.y - totalH, w: this.totalWidth, h: totalH };
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 0): boolean {
    const totalW = this.totalWidth;
    const totalH = this.totalHeight;
    const a = vm.w2s(this.x, this.y);
    const b = vm.w2s(this.x + totalW, this.y - totalH);
    const left = Math.min(a.x, b.x) - tol;
    const right = Math.max(a.x, b.x) + tol;
    const top = Math.min(a.y, b.y) - tol;
    const bottom = Math.max(a.y, b.y) + tol;
    return sx >= left && sx <= right && sy >= top && sy <= bottom;
  }

  getCellAt(sx: number, sy: number, vm: ViewModelLike): { row: number, col: number } | null {
    if (!this.hitTest(sx, sy, vm)) return null;
    const w = vm.s2w(sx, sy);
    let rowY = this.y;
    let foundRow = -1;
    for (let r = 0; r < this.rows; r++) {
      rowY -= this.rowHeights[r];
      if (w.y >= rowY) {
        foundRow = r;
        break;
      }
    }
    if (foundRow === -1) return null;
    
    if (foundRow === 0 && this.titleRow) {
       return { row: 0, col: 0 };
    }

    let colX = this.x;
    let foundCol = -1;
    for (let c = 0; c < this.cols; c++) {
      colX += this.colWidths[c];
      if (w.x <= colX) {
        foundCol = c;
        break;
      }
    }
    if (foundCol === -1) return null;
    
    return { row: foundRow, col: foundCol };
  }

  getColumnBoundaryAt(sx: number, sy: number, vm: ViewModelLike, tolPx = 4): number | null {
    if (!this.hitTest(sx, sy, vm, tolPx)) return null;
    const w = vm.s2w(sx, sy);
    const tolW = tolPx / vm.scale;
    
    if (Math.abs(w.x - this.x) <= tolW) {
      return -1;
    }

    let colX = this.x;
    for (let c = 0; c < this.cols; c++) {
      colX += this.colWidths[c];
      if (Math.abs(w.x - colX) <= tolW) {
        if (this.titleRow && w.y > this.y - this.rowHeights[0]) {
           continue;
        }
        return c;
      }
    }
    return null;
  }

  getRowBoundaryAt(sx: number, sy: number, vm: ViewModelLike, tolPx = 4): number | null {
    if (!this.hitTest(sx, sy, vm, tolPx)) return null;
    const w = vm.s2w(sx, sy);
    const tolW = tolPx / vm.scale;
    
    if (Math.abs(w.y - this.y) <= tolW) {
      return -1;
    }

    let rowY = this.y;
    for (let r = 0; r < this.rows; r++) {
      rowY -= this.rowHeights[r];
      if (Math.abs(w.y - rowY) <= tolW) {
        return r;
      }
    }
    return null;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'x', label: 'Position X', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'y', label: 'Position Y', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'titleRow', label: 'Show Title Row', type: 'boolean', category: 'Structure' },
      { key: 'headerRow', label: 'Show Header Row', type: 'boolean', category: 'Structure' },
      { key: 'rows', label: 'Rows', type: 'read-only', category: 'Structure', value: String(this.rows) },
      { key: 'cols', label: 'Cols', type: 'read-only', category: 'Structure', value: String(this.cols) },
      { key: 'borderColor', label: 'Border Color', type: 'color', category: 'Appearance' },
      { key: 'borderWeight', label: 'Border Weight', type: 'number', category: 'Appearance', precision: 2, step: 0.05, min: 0 },
      { key: 'cellPadding', label: 'Cell Padding', type: 'number', category: 'Appearance', precision: 2, step: 0.5, min: 0 },
      { key: 'defaultFont', label: 'Default Font', type: 'dropdown', category: 'Text',
        options: ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'sans-serif', 'serif', 'monospace'] },
      { key: 'defaultFontSize', label: 'Default Size', type: 'number', category: 'Text', precision: 2, step: 0.5, min: 0.5 },
      { key: 'defaultTextColor', label: 'Default Text Color', type: 'color', category: 'Text' },
      { key: 'defaultAlign', label: 'Default Align', type: 'dropdown', category: 'Text', options: ['left', 'center', 'right'] },
      { key: 'defaultValign', label: 'Default VAlign', type: 'dropdown', category: 'Text', options: ['top', 'middle', 'bottom'] },
      { key: 'cellsTSV', label: 'Cells (TSV)', type: 'text', category: 'Cell Contents' },
    ];
  }
}
