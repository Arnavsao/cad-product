import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { TableEntity } from '../../core/models/table-entity.model';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { DocumentService } from '../../core/services/document.service';
import { ModifyGeometryCmd } from '../../core/models/command.model';
import { snapshotEntity } from '../../tools/geometry-utils';

export interface ITableEditorState {
  entity: TableEntity;
  originalSnapshot: Record<string, unknown>;
  /** Currently selected cells [row, col][]. */
  selectedCells: Array<[number, number]>;
  /** The cell currently being actively typed into. */
  editingCell: [number, number] | null;
}

@Injectable({ providedIn: 'root' })
export class TableEditorService {
  state = signal<ITableEditorState | null>(null);
  
  insertSymbolRequested = new Subject<string>();

  constructor(
    private cmds: CommandStackService,
    private vm: ViewModelService,
    private doc: DocumentService,
  ) {}

  openForEdit(entity: TableEntity): void {
    const snapshot = this.snapshot(entity);
    this.doc.clearSelection();
    this.state.set({ entity, originalSnapshot: snapshot, selectedCells: [[0, 0]], editingCell: null });
  }

  /** User finished editing â€” record the modification command. */
  commit(): void {
    const s = this.state();
    if (!s) return;
    const after = this.snapshot(s.entity);
    // Restore original, then push command which re-applies `after`
    this.restore(s.entity, s.originalSnapshot);
    this.cmds.push(new ModifyGeometryCmd(s.entity, s.originalSnapshot, after, {
      markDirty: () => this.vm.markContentDirty(),
    }));
    this.state.set(null);
    this.vm.markDirty();
  }

  cancel(): void {
    const s = this.state();
    if (s) this.restore(s.entity, s.originalSnapshot);
    this.state.set(null);
    this.vm.markContentDirty();
  }

  setSelection(cells: Array<[number, number]>): void {
    const s = this.state();
    if (!s) return;
    this.state.set({ ...s, selectedCells: cells, editingCell: null });
  }

  /** Like setSelection but preserves the current editingCell (for drag-range selection during editing). */
  setSelectionOnly(cells: Array<[number, number]>): void {
    const s = this.state();
    if (!s) return;
    this.state.set({ ...s, selectedCells: cells });
  }

  setEditing(cell: [number, number] | null): void {
    const s = this.state();
    if (!s) return;
    this.state.set({ ...s, editingCell: cell });
  }

  setCellText(row: number, col: number, text: string): void {
    const s = this.state();
    if (!s) return;
    if (row === 0 && s.entity.titleRow && col === 0) {
      s.entity.titleText = text;
    } else if (row >= 0 && row < s.entity.rows && col >= 0 && col < s.entity.cols) {
      s.entity.cells[row][col].text = text;
    }
    s.entity.refreshCaches();
    this.vm.markContentDirty();
  }

  mutateSelectedCells(mutation: (cell: any) => void): void {
    const s = this.state();
    if (!s) return;
    for (const [r, c] of s.selectedCells) {
      if (r === 0 && s.entity.titleRow) {
         // Modify title row specific properties. We'll handle this in the formatting toolbar directly.
      } else {
         mutation(s.entity.cells[r][c]);
      }
    }
    s.entity.refreshCaches();
    this.vm.markContentDirty();
  }

  private snapshot(ent: TableEntity): Record<string, unknown> {
    const base = snapshotEntity(ent);
    // Deep-clone the cells array so undo/redo restores cell text
    base['cells'] = JSON.parse(JSON.stringify(ent.cells));
    base['colWidths'] = [...ent.colWidths];
    base['rowHeights'] = [...ent.rowHeights];
    base['titleRow'] = ent.titleRow;
    base['headerRow'] = ent.headerRow;
    base['titleText'] = ent.titleText;
    base['titleFontSize'] = ent.titleFontSize;
    base['titleTextColor'] = ent.titleTextColor;
    base['titleBgColor'] = ent.titleBgColor;
    base['headerBgColor'] = ent.headerBgColor;
    base['headerTextColor'] = ent.headerTextColor;
    base['headerFontSize'] = ent.headerFontSize;
    return base;
  }

  // â”€â”€â”€ Format Getters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  getActiveFont(): string {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return 'Arial';
    const [r, c] = s.selectedCells[0];
    if (r === 0 && s.entity.titleRow) return s.entity.defaultFont;
    return s.entity.cells[r][c].font || s.entity.defaultFont;
  }

  getActiveFontSize(): number {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return 2.5;
    const [r, c] = s.selectedCells[0];
    if (r === 0 && s.entity.titleRow) return s.entity.titleFontSize;
    const isHeader = s.entity.headerRow && (s.entity.titleRow ? r === 1 : r === 0);
    return s.entity.cells[r][c].fontSize || (isHeader ? s.entity.headerFontSize : s.entity.defaultFontSize);
  }

  getActiveTextColor(): string {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return '#ffffff';
    const [r, c] = s.selectedCells[0];
    if (r === 0 && s.entity.titleRow) return s.entity.titleTextColor;
    const isHeader = s.entity.headerRow && (s.entity.titleRow ? r === 1 : r === 0);
    return s.entity.cells[r][c].textColor || (isHeader ? s.entity.headerTextColor : s.entity.defaultTextColor);
  }

  getActiveBgColor(): string {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return '#000000';
    const [r, c] = s.selectedCells[0];
    if (r === 0 && s.entity.titleRow) return s.entity.titleBgColor || '#000000';
    const isHeader = s.entity.headerRow && (s.entity.titleRow ? r === 1 : r === 0);
    return s.entity.cells[r][c].bgColor || (isHeader ? s.entity.headerBgColor : '#000000') || '#000000';
  }

  getActiveAlign(): string {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return 'left';
    const [r, c] = s.selectedCells[0];
    if (r === 0 && s.entity.titleRow) return 'center';
    return s.entity.cells[r][c].align || s.entity.defaultAlign;
  }

  getActiveValign(): string {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return 'middle';
    const [r, c] = s.selectedCells[0];
    if (r === 0 && s.entity.titleRow) return 'middle';
    return s.entity.cells[r][c].valign || s.entity.defaultValign;
  }

  getActiveBool(prop: string): boolean {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return false;
    const [r, c] = s.selectedCells[0];
    if (r === 0 && s.entity.titleRow) return false;
    return !!(s.entity.cells[r][c] as any)[prop];
  }

  // â”€â”€â”€ Format Setters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setFont(f: string) { this.mutateSelectedCells(c => c.font = f); }
  setFontSize(sz: number) { this.mutateSelectedCells(c => c.fontSize = sz); }
  toggleBool(prop: string) { this.mutateSelectedCells(c => c[prop] = !c[prop]); }
  setAlign(a: string) { this.mutateSelectedCells(c => c.align = a); }
  setValign(v: string) { this.mutateSelectedCells(c => c.valign = v); }
  
  setTextColor(c: string) { 
     this.mutateSelectedCells(cell => cell.textColor = c); 
     const s = this.state();
     if (s && s.selectedCells[0][0] === 0 && s.entity.titleRow) {
         s.entity.titleTextColor = c;
         s.entity.refreshCaches();
     }
  }

  setBgColor(c: string) { 
     this.mutateSelectedCells(cell => cell.bgColor = c); 
     const s = this.state();
     if (s && s.selectedCells[0][0] === 0 && s.entity.titleRow) {
         s.entity.titleBgColor = c;
         s.entity.refreshCaches();
     }
  }

  insertRow() {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return;
    const r = s.selectedCells[0][0];
    const ent = s.entity;
    const newRow: any[] = [];
    for (let i = 0; i < ent.cols; i++) newRow.push({ text: '' });
    ent.cells.splice(r, 0, newRow);
    ent.rowHeights.splice(r, 0, ent.rowHeights[r] || 10);
    ent.rows++;
    ent.refreshCaches();
    this.vm.markContentDirty();
  }

  insertCol() {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return;
    const c = s.selectedCells[0][1];
    const ent = s.entity;
    for (let i = 0; i < ent.rows; i++) {
      if (i === 0 && ent.titleRow) continue;
      ent.cells[i].splice(c, 0, { text: '' });
    }
    ent.colWidths.splice(c, 0, ent.colWidths[c] || 25);
    ent.cols++;
    ent.refreshCaches();
    this.vm.markContentDirty();
  }

  deleteRow() {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return;
    const r = s.selectedCells[0][0];
    const ent = s.entity;
    if (r === 0 && ent.titleRow) return; 
    if (ent.rows <= (ent.titleRow ? 2 : 1)) return;
    ent.cells.splice(r, 1);
    ent.rowHeights.splice(r, 1);
    ent.rows--;
    s.selectedCells = [];
    ent.refreshCaches();
    this.vm.markContentDirty();
  }

  deleteCol() {
    const s = this.state();
    if (!s || s.selectedCells.length === 0) return;
    const c = s.selectedCells[0][1];
    const ent = s.entity;
    if (ent.cols <= 1) return;
    for (let i = 0; i < ent.rows; i++) {
      if (i === 0 && ent.titleRow) continue;
      ent.cells[i].splice(c, 1);
    }
    ent.colWidths.splice(c, 1);
    ent.cols--;
    s.selectedCells = [];
    ent.refreshCaches();
    this.vm.markContentDirty();
  }

  private restore(ent: any, snap: Record<string, unknown>): void {
    for (const k in snap) {
      const v = snap[k];
      if (k === 'cells') {
        ent[k] = JSON.parse(JSON.stringify(v));
      } else if (Array.isArray(v)) {
        ent[k] = [...v];
      } else if (v && typeof v === 'object') {
        ent[k] = { ...(v as object) };
      } else {
        ent[k] = v;
      }
    }
    ent.refreshCaches();
  }
}
