import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { TableEntity } from '../../core/models/table-entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { evalExpression } from '../../core/utils/expression-parser';
import { InsertTableDialogService, ITableConfig } from '../../features/table-editor/insert-table-dialog.service';

/**
 * Table insert tool.
 *
 * Flow:
 *   1. activate() shows the Dynamic Input overlay with editable `Rows` + `Cols`
 *      fields. Defaults to 3 Ã— 4.
 *   2. The cursor drags a live preview of the table at default column/row sizes.
 *   3. Click â†’ place the table at the click world coord (its TOP-LEFT corner).
 *   4. Esc / Enter without click â†’ cancel.
 *
 * Default column width 40, row height 10 (world units). Adjust via grips after
 * placement, or via the properties panel.
 */
export class TableTool implements ITool {
  readonly name = 'table';

  private rows = 3;
  private cols = 4;
  private config: ITableConfig | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  
  private dragStart: IPoint | null = null;
  private isDragging = false;
  private dialogOpen = false;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }
  private get dialog() { return this.injector.get(InsertTableDialogService) as InsertTableDialogService; }

  activate(): void {
    this.dyn.clearEdits();
    this.dialogOpen = true;
    this.dialog.open().then(config => {
      this.dialogOpen = false;
      if (config) {
        this.config = config;
        this.rows = config.rows;
        if (config.firstRowStyle !== 'Data') this.rows++;
        if (config.secondRowStyle !== 'Data') this.rows++;
        this.cols = config.cols;
      } else {
        this.tools.setTool('select');
      }
    });
  }

  onMouseMove(wx: number, wy: number): void {
    if (this.dialogOpen) return;
    this.cur = { x: wx, y: wy };
    if (this.dragStart) {
      this.isDragging = true;
    }
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number, _sx: number, _sy: number, e: MouseEvent): void {
    if (e.button !== 0 || this.dialogOpen) return;
    this.dragStart = { x: wx, y: wy };
    this.isDragging = false;
  }

  onMouseUp(wx: number, wy: number, _sx: number, _sy: number, e: MouseEvent): void {
    if (e.button !== 0 || !this.dragStart || this.dialogOpen) return;
    
    // If it was just a click (or tiny drag), use default dynamic sizing.
    // If it was a noticeable drag, use the dragged window to define size.
    const dx = Math.abs(wx - this.dragStart.x);
    const dy = Math.abs(wy - this.dragStart.y);
    const dragged = this.isDragging && (dx * this.vm.scale > 5 || dy * this.vm.scale > 5);

    this._place(this.dragStart.x, this.dragStart.y, dragged ? wx : null, dragged ? wy : null);
    
    this.dragStart = null;
    this.isDragging = false;
  }

  private _getDynamicSizes(c: number): { colW: number, rowH: number } {
    const viewW = this.vm.canvasWidth / this.vm.scale;
    // Dynamic size: 25% of visible width.
    const tableW = viewW > 0 ? viewW * 0.25 : 40 * c;
    const colW = tableW / c;
    const rowH = colW * 0.25; // 4:1 cell ratio
    return { colW, rowH };
  }

  private _place(wx: number, wy: number, endX: number | null, endY: number | null): void {
    if (!this.config) return;
    
    const r = this.rows;
    const c = this.cols;
    
    let colW = this.config.colWidth;
    let rowH = this.config.rowHeight;
    
    if (endX !== null && endY !== null) {
      // Specify Window Mode overrides automatic sizing
      const totalW = Math.max(0.1, Math.abs(endX - wx));
      const totalH = Math.max(0.1, Math.abs(endY - wy));
      colW = totalW / c;
      rowH = totalH / r;
      // Adjust start to be Top-Left if dragged in another direction
      wx = Math.min(wx, endX);
      wy = Math.max(wy, endY);
    }
    
    const ent = new TableEntity(wx, wy, r, c);
    
    // Use configured row heights and column widths
    ent.colWidths = Array(c).fill(colW);
    ent.rowHeights = Array(r).fill(rowH);
    
    ent.titleRow = this.config.firstRowStyle === 'Title';
    ent.headerRow = this.config.firstRowStyle === 'Header' || this.config.secondRowStyle === 'Header';

    // Apply specific fonts and alignments for title/header
    if (ent.titleRow && ent.cells[0]) {
      for (let j = 0; j < c; j++) {
        ent.cells[0][j].font = 'sans-serif';
        ent.cells[0][j].bold = true;
        ent.cells[0][j].align = 'center';
      }
    }
    const headerIdx = ent.titleRow ? 1 : (ent.headerRow ? 0 : -1);
    if (headerIdx >= 0 && ent.cells[headerIdx]) {
      for (let j = 0; j < c; j++) {
        ent.cells[headerIdx][j].font = 'sans-serif';
        ent.cells[headerIdx][j].bold = true;
        ent.cells[headerIdx][j].align = 'center';
      }
    }

    ent.refreshCaches?.();

    this.cmds.push(new AddEntityCmd(ent, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    this.tools.setTool('select');
  }

  getPhase(): string { return 'place'; }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.dialogOpen || !this.config) return;
    
    const wx = this.cur.x;
    const wy = this.cur.y;

    const r = this.rows;
    const c = this.cols;
    const colW = this.config.colWidth;
    const rowH = this.config.rowHeight;

    let totalW = colW * c;
    let totalH = rowH * r;
    let startX: number, startY: number;

    if (this.dragStart && this.isDragging) {
      // Window Preview
      startX = Math.min(this.dragStart.x, this.cur.x);
      startY = Math.max(this.dragStart.y, this.cur.y);
      totalH = Math.abs(this.cur.y - this.dragStart.y);
    } else {
      // Auto Preview
      const { colW, rowH } = this._getDynamicSizes(c);
      totalW = c * colW;
      totalH = r * rowH;
      startX = this.cur.x;
      startY = this.cur.y;
    }

    const tl = this.vm.w2s(startX, startY);
    const br = this.vm.w2s(startX + totalW, startY - totalH);
    
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 160, 48, 0.85)';
    ctx.fillStyle = 'rgba(240, 160, 48, 0.05)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 3]);
    const left = Math.min(tl.x, br.x), top = Math.min(tl.y, br.y);
    const w = Math.abs(br.x - tl.x), h = Math.abs(br.y - tl.y);
    ctx.fillRect(left, top, w, h);
    ctx.strokeRect(left, top, w, h);
    
    // Inner grid
    if (w > 0 && h > 0) {
      ctx.beginPath();
      for (let i = 1; i < c; i++) {
        const x = left + (w * i) / c;
        ctx.moveTo(x, top); ctx.lineTo(x, top + h);
      }
      for (let i = 1; i < r; i++) {
        const y = top + (h * i) / r;
        ctx.moveTo(left, y); ctx.lineTo(left + w, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  getAnchor(): IPoint | null { return this.cur; }

  getDynamicInputState(): IDynamicInputState | null {
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      primaryFieldKey: 'rows',
      fields: [
        { key: 'rows', label: 'Rows', liveValue: String(this.rows), width: 60 },
        { key: 'cols', label: 'Cols', liveValue: String(this.cols), width: 60 },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    const r = evalExpression(values['rows'] ?? '');
    const c = evalExpression(values['cols'] ?? '');
    if (r !== null && r >= 1) this.rows = Math.round(r);
    if (c !== null && c >= 1) this.cols = Math.round(c);
    this.dyn.clearEdits();
    this.vm.markDirty();
    // No placement on Enter â€” user still needs to click. Returning true so the
    // overlay clears edits and re-reads liveValues from the updated state.
    return true;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.dragStart) {
        this.dragStart = null;
        this.isDragging = false;
        this.vm.markDirty();
      } else {
        this.dyn.clearEdits();
        this.tools.setTool('select');
      }
    }
  }

  deactivate(): void {
    this.dyn.clearEdits();
    this.dyn.setState(null);
  }
}
