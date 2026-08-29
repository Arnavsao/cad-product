import { Component, effect, ViewChild, ElementRef, HostListener, AfterViewChecked, OnDestroy , ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { TableEditorService } from './table-editor.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { ENG_SYMBOLS } from '../../core/services/symbol.service';
import { Subscription } from 'rxjs';

interface IRect { x: number; y: number; w: number; h: number; }

/**
 * Lightweight edit-state: only layout + font info needed to position the
 * invisible textarea so the blinking caret appears in the right spot.
 * No text value — the textarea manages its own value natively.
 */
interface ICellEditState extends IRect {
  fontFamily: string;
  fontSizePx: number;
  textAlign: string;
  fontWeight: string;
  fontStyle: string;
  caretColor: string;
  paddingTop: number;
  paddingHoriz: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-table-editor-overlay',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (svc.state(); as s) {
      <!--
      Hitbox: covers the exact table bounding box in absolute canvas coords.
      position:absolute works because this component lives inside
      <main style="position:relative"> in cad-editor.html.
        -->
        <div class="te-hitbox"
          [style.left.px]="hitbox.x"
          [style.top.px]="hitbox.y"
          [style.width.px]="hitbox.w"
          [style.height.px]="hitbox.h"
          [style.cursor]="cursorStyle"
          (mousedown)="onMouseDown($event)"
          (dblclick)="onDoubleClick($event)"
          (mousemove)="onMouseMove($event)"
          (mouseleave)="onMouseLeave($event)"
          (mouseup)="onMouseUp($event)">
          <!-- Cell selection highlight(s) -->
          @for (sel of selectedDivs; track sel) {
            <div
              class="te-sel"
              [style.left.px]="sel.x"
              [style.top.px]="sel.y"
              [style.width.px]="sel.w"
              [style.height.px]="sel.h">
            </div>
          }
          <!--
          In-place textarea: overlaid exactly on the active cell.
          Text is INVISIBLE (color: transparent) — the CANVAS renders
          the cell text at its exact correct position. The textarea
          only captures keyboard input and shows the blinking caret.
          This eliminates all text-positioning mismatches between
          CSS textarea rendering and canvas fillText().
          -->
          @if (editState; as ed) {
            <textarea
              #editTextarea
              class="te-textarea"
              [style.left.px]="ed.x"
              [style.top.px]="ed.y"
              [style.width.px]="ed.w"
              [style.height.px]="ed.h"
              [style.font-family]="ed.fontFamily"
              [style.font-size.px]="ed.fontSizePx"
              [style.text-align]="ed.textAlign"
              [style.font-weight]="ed.fontWeight"
              [style.font-style]="ed.fontStyle"
              [style.caret-color]="ed.caretColor"
              [style.padding-top.px]="ed.paddingTop"
              [style.padding-left.px]="ed.paddingHoriz"
              [style.padding-right.px]="ed.paddingHoriz"
              (input)="onInput($event)"
              (keydown)="onKey($event)"
              (mousedown)="$event.stopPropagation()"
              (dblclick)="$event.stopPropagation()"
              spellcheck="false"
              autocomplete="off">
            </textarea>
          }

          <!-- Plus buttons for adding rows/columns -->
          <div class="te-add-col" (click)="addColumn($event)" title="Add Column">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </div>
          <div class="te-add-row" (click)="addRow($event)" title="Add Row">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </div>
        </div>

        @if (isResizingActive) {
          <div
            style="position: fixed; inset: 0; z-index: 9999; cursor: {{cursorStyle}};"
            (mousedown)="onOverlayMouseDown($event)">
          </div>
        }
      }
    `,
  styles: [`
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 5;
      overflow: visible;
    }

    .te-hitbox {
      position: absolute;
      pointer-events: auto;
    }

    .te-sel {
      position: absolute;
      border: 2px solid var(--cad-accent);
      background: var(--cad-accent-tint);
      pointer-events: none;
      box-sizing: border-box;
    }

    .te-textarea {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid var(--cad-accent);
      outline: none;
      margin: 0;
      padding-bottom: 0;
      resize: none;
      overflow: hidden;
      line-height: 1.2;
      pointer-events: auto;
      z-index: 1;

      /* KEY: text is invisible — the canvas renders the real text.
         Only the blinking caret is visible. */
      background: transparent;
      color: transparent;
    }

    /* Make text selection visible even though text is invisible */
    .te-textarea::selection {
      background: var(--cad-accent-glow);
      color: transparent;
    }

    .te-toolbar-host {
      position: absolute;
      pointer-events: auto;
    }

    .te-add-col, .te-add-row {
      position: absolute;
      width: 24px;
      height: 24px;
      background: var(--cad-bg-toolbar, #1e1e1e);
      border: 1px solid var(--cad-border, #333);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      cursor: pointer;
      pointer-events: auto;
      z-index: 10;
    }
    .te-add-col:hover, .te-add-row:hover {
      background: var(--cad-accent, #007acc);
      border-color: var(--cad-accent, #007acc);
    }
    
    .te-add-col {
      right: -30px;
      top: 50%;
      transform: translateY(-50%);
    }

    .te-add-row {
      bottom: -30px;
      left: 50%;
      transform: translateX(-50%);
    }
  `]
})
export class TableEditorOverlayComponent implements AfterViewChecked {
  @ViewChild('editTextarea') editTextarea?: ElementRef<HTMLTextAreaElement>;

  hitbox: IRect = { x: 0, y: 0, w: 0, h: 0 };
  selectedDivs: IRect[] = [];
  editState: ICellEditState | null = null;
  symbols = Object.values(ENG_SYMBOLS).flat();

  cursorStyle = 'default';

  isDragging = false;
  dragStartCell: { row: number; col: number } | null = null;
  resizeMode: 'col' | 'row' | null = null;
  resizeIndex = 0;
  resizeStartPos = 0;
  resizeStartVal = 0;
  resizeStartPosWorld = 0;
  isResizingActive = false;

  // Editing lifecycle state
  private needsFocus = false;
  private pendingText = '';
  private editCellKey = '';     // "row-col" of the cell currently being edited
  private subs: Subscription[] = [];

  constructor(
    public svc: TableEditorService,
    private vm: ViewModelService,
  ) {
    this.subs.push(
      this.svc.insertSymbolRequested.subscribe(sym => {
        this.insertSymbolFromToolbar(sym);
      })
    );
    // Recompute layout whenever viewport changes (pan/zoom) or entity mutates
    effect(() => {
      this.vm.viewEpoch(); // reposition on pan/zoom
      this.vm.version();   // re-evaluate on content/selection changes
      const s = this.svc.state();
      if (s?.entity) {
        this.updateMetrics(s);
      } else {
        this.hitbox = { x: 0, y: 0, w: 0, h: 0 };
        this.selectedDivs = [];
        this.editState = null;
        this.editCellKey = '';
      }
    });

    // When a NEW cell starts editing, capture its text and schedule focus
    effect(() => {
      const s = this.svc.state();
      if (s?.editingCell) {
        const key = `${s.editingCell[0]}-${s.editingCell[1]}`;
        if (key !== this.editCellKey) {
          this.editCellKey = key;
          const [r, c] = s.editingCell;
          if (r === 0 && s.entity.titleRow) {
            this.pendingText = s.entity.titleText ?? '';
          } else {
            this.pendingText = s.entity.cells?.[r]?.[c]?.text ?? '';
          }
          this.needsFocus = true;
        }
      } else {
        this.editCellKey = '';
      }
    });
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  /**
   * After Angular renders the textarea, set its value and focus it.
   * We set the value HERE (not via [value] binding) so that subsequent
   * keystrokes don't reset the cursor position via Angular change detection.
   */
  ngAfterViewChecked(): void {
    if (this.needsFocus && this.editTextarea) {
      this.needsFocus = false;
      const ta = this.editTextarea.nativeElement;
      ta.value = this.pendingText;
      ta.focus();
      // Place cursor at end of text
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
  }

  // ─── Window mousedown: commit when clicking outside the table ────────────
  @HostListener('window:mousedown', ['$event'])
  onWindowMouseDown(e: MouseEvent) {
    const s = this.svc.state();
    if (!s) return;
    const target = e.target as HTMLElement;
    if (!target.closest('.te-hitbox') && !target.closest('.te-toolbar')) {
      this.svc.commit();
    }
  }

  // ─── Metric computation ──────────────────────────────────────────────────
  updateMetrics(s: any): void {
    const ent = s.entity;
    const totalW = (ent.colWidths as number[]).reduce((a: number, b: number) => a + b, 0);
    const totalH = (ent.rowHeights as number[]).reduce((a: number, b: number) => a + b, 0);

    // Hitbox in canvas (screen) coords
    const tl = this.vm.w2s(ent.x, ent.y);
    const br = this.vm.w2s(ent.x + totalW, ent.y - totalH);
    const pad = 6;
    this.hitbox = {
      x: Math.min(tl.x, br.x) - pad,
      y: Math.min(tl.y, br.y) - pad,
      w: Math.abs(br.x - tl.x) + pad * 2,
      h: Math.abs(br.y - tl.y) + pad * 2,
    };

    // Selected-cell highlight rects (relative to hitbox TL)
    this.selectedDivs = s.selectedCells
      .map((rc: [number, number]) => this.getCellRect(ent, rc[0], rc[1]))
      .filter((r: IRect | null): r is IRect => r !== null);

    // Editing overlay — only update POSITION, never touch the textarea value
    if (s.editingCell) {
      const [r, c] = s.editingCell;
      const rect = this.getCellRect(ent, r, c);
      if (rect) {
        this.editState = this.buildEditState(ent, r, c, rect);
      } else {
        this.editState = null;
      }
    } else {
      this.editState = null;
    }
  }

  /** Returns a rect RELATIVE to the hitbox top-left corner */
  getCellRect(ent: any, row: number, col: number): IRect | null {
    if (row < 0 || row >= ent.rows || col < 0 || col >= ent.cols) return null;
    if (row === 0 && ent.titleRow && col > 0) return null;

    let wx = ent.x;
    for (let c = 0; c < col; c++) wx += ent.colWidths[c];
    let ww = (row === 0 && ent.titleRow)
      ? (ent.colWidths as number[]).reduce((a: number, b: number) => a + b, 0)
      : ent.colWidths[col];

    let wy = ent.y;
    for (let r = 0; r < row; r++) wy -= ent.rowHeights[r];
    const wh = ent.rowHeights[row];

    const ptTl = this.vm.w2s(wx, wy);
    const ptBr = this.vm.w2s(wx + ww, wy - wh);
    return {
      x: Math.min(ptTl.x, ptBr.x) - this.hitbox.x,
      y: Math.min(ptTl.y, ptBr.y) - this.hitbox.y,
      w: Math.abs(ptBr.x - ptTl.x),
      h: Math.abs(ptBr.y - ptTl.y),
    };
  }

  /**
   * Build the edit state for the textarea.
   * Does NOT include text — the textarea value is set once in ngAfterViewChecked
   * and then managed natively by the browser.
   *
   * The padding-top is calculated to place the invisible text (and hence the
   * blinking caret) at the same vertical position where the canvas draws text.
   *
   * Canvas uses: textBaseline='alphabetic', ty = cellH/2 + fontSizePx*0.35  (middle)
   * CSS textarea: baseline ≈ paddingTop + fontSizePx * ascent_ratio
   * We solve for paddingTop so both baselines coincide.
   */
  buildEditState(ent: any, r: number, c: number, rect: IRect): ICellEditState {
    let fontFamily = ent.defaultFont;
    let fontSize: number = ent.defaultFontSize;
    let color: string = ent.defaultTextColor;
    let textAlign: string = ent.defaultAlign;
    let valign: string = ent.defaultValign ?? 'middle';
    let bold = false;
    let italic = false;

    if (r === 0 && ent.titleRow) {
      fontSize = ent.titleFontSize;
      color = ent.titleTextColor;
      textAlign = 'center';
      valign = 'middle';
    } else {
      const cell = ent.cells[r][c];
      const isHeader = ent.headerRow && (ent.titleRow ? r === 1 : r === 0);
      if (isHeader) {
        fontSize = ent.headerFontSize;
        color = ent.headerTextColor;
        textAlign = 'center';
      }
      if (cell.font) fontFamily = cell.font;
      if (cell.fontSize) fontSize = cell.fontSize;
      if (cell.textColor) color = cell.textColor;
      if (cell.align) textAlign = cell.align;
      if (cell.valign) valign = cell.valign;
      bold = !!cell.bold;
      italic = !!cell.italic;
    }

    const fontSizePx = Math.max(8, fontSize * this.vm.scale);
    const padPx = (ent.cellPadding ?? 1) * this.vm.scale;
    const cellH = rect.h;
    const borderW = 2; // matches CSS border: 2px solid
    const lineH = 1.2;

    // Calculate padding-top so the caret sits at the same Y as canvas text.
    // Canvas baseline positions (relative to cell top in screen px):
    //   top:    padPx + fontSizePx * 0.85
    //   middle: cellH/2 + fontSizePx * 0.35
    //   bottom: cellH - padPx
    // CSS textarea baseline = borderW + paddingTop + fontSizePx * 0.85 (approx ascent)
    // Solve: paddingTop = canvasBaseline - borderW - fontSizePx * 0.85
    let paddingTop: number;
    if (valign === 'top') {
      paddingTop = padPx - borderW;
    } else if (valign === 'bottom') {
      paddingTop = cellH - padPx - borderW - fontSizePx * 0.85;
    } else {
      // middle
      paddingTop = cellH / 2 + fontSizePx * 0.35 - borderW - fontSizePx * 0.85;
    }
    paddingTop = Math.max(0, paddingTop);

    return {
      ...rect,
      fontFamily,
      fontSizePx,
      textAlign,
      fontWeight: bold ? 'bold' : 'normal',
      fontStyle: italic ? 'italic' : 'normal',
      caretColor: color,
      paddingTop,
      paddingHoriz: Math.max(0, padPx - borderW),
    };
  }

  onOverlayMouseDown(e: MouseEvent) {
    if (this.isResizingActive) {
      this.isResizingActive = false;
      this.resizeStartPos = 0;
      this.vm.markContentDirty();
      e.stopPropagation();
      e.preventDefault();
    }
  }

  // ─── Hitbox interactions ─────────────────────────────────────────────────
  onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = this.svc.state();
    if (!s) return;

    if (this.isResizingActive) {
      this.isResizingActive = false;
      this.resizeStartPos = 0;
      this.vm.markContentDirty();
      return;
    }

    if (this.resizeMode !== null) {
      this.isResizingActive = true;
      this.resizeStartPos = this.resizeMode === 'col' ? e.clientX : e.clientY;
      const ent = s.entity;
      
      if (this.resizeIndex === -1) {
        this.resizeStartVal = this.resizeMode === 'col' ? ent.colWidths[0] : ent.rowHeights[0];
        this.resizeStartPosWorld = this.resizeMode === 'col' ? ent.x : ent.y;
      } else {
        this.resizeStartVal = this.resizeMode === 'col'
          ? ent.colWidths[this.resizeIndex]
          : ent.rowHeights[this.resizeIndex];
      }
      return;
    }

    const cRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - cRect.left + this.hitbox.x;
    const sy = e.clientY - cRect.top + this.hitbox.y;

    const cellPos = s.entity.getCellAt(sx, sy, this.vm);
    if (!cellPos) return;

    // If actively editing the same cell — let textarea handle it
    if (s.editingCell && s.editingCell[0] === cellPos.row && s.editingCell[1] === cellPos.col) {
      return;
    }

    if (s.editingCell) {
      this.svc.setEditing(null);
    }

    if (e.shiftKey) {
      const current = [...s.selectedCells];
      if (!current.some(x => x[0] === cellPos.row && x[1] === cellPos.col)) {
        current.push([cellPos.row, cellPos.col]);
      }
      this.svc.setSelection(current);
    } else {
      this.svc.setSelection([[cellPos.row, cellPos.col]]);
      this.dragStartCell = cellPos;
      this.isDragging = true;
    }
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(e: MouseEvent) {
    const s = this.svc.state();
    if (!s || !this.isResizingActive || this.resizeStartPos === 0) return;

    const ent = s.entity;
    if (this.resizeMode === 'col') {
      const diff = (e.clientX - this.resizeStartPos) / this.vm.scale;
      if (this.resizeIndex === -1) {
        const newWidth = this.resizeStartVal - diff;
        if (newWidth >= 2) {
          ent.x = this.resizeStartPosWorld + diff;
          ent.colWidths[0] = newWidth;
        } else {
          ent.x = this.resizeStartPosWorld + (this.resizeStartVal - 2);
          ent.colWidths[0] = 2;
        }
      } else {
        ent.colWidths[this.resizeIndex] = Math.max(2, this.resizeStartVal + diff);
      }
    } else {
      const diff = (e.clientY - this.resizeStartPos) / this.vm.scale;
      if (this.resizeIndex === -1) {
        const newHeight = this.resizeStartVal - diff;
        if (newHeight >= 2) {
          ent.y = this.resizeStartPosWorld - diff;
          ent.rowHeights[0] = newHeight;
        } else {
          ent.y = this.resizeStartPosWorld - (this.resizeStartVal - 2);
          ent.rowHeights[0] = 2;
        }
      } else {
        ent.rowHeights[this.resizeIndex] = Math.max(2, this.resizeStartVal + diff);
      }
    }
    ent.refreshCaches?.();
    this.vm.markDirty();
    this.updateMetrics(s);
  }

  onMouseMove(e: MouseEvent) {
    const s = this.svc.state();
    if (!s) return;
    if (this.isResizingActive) return;

    const cRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - cRect.left + this.hitbox.x;
    const sy = e.clientY - cRect.top + this.hitbox.y;

    // Hover: detect row/col boundary
    if (!this.isDragging && !this.isResizingActive) {
      const colIdx = s.entity.getColumnBoundaryAt(sx, sy, this.vm);
      if (colIdx !== null) {
        this.cursorStyle = 'col-resize';
        this.resizeMode = 'col';
        this.resizeIndex = colIdx;
        return;
      }
      const rowIdx = s.entity.getRowBoundaryAt(sx, sy, this.vm);
      if (rowIdx !== null) {
        this.cursorStyle = 'row-resize';
        this.resizeMode = 'row';
        this.resizeIndex = rowIdx;
        return;
      }
      this.cursorStyle = 'default';
      this.resizeMode = null;
      return;
    }

    // Drag selection
    if (!this.dragStartCell) return;
    const cellPos = s.entity.getCellAt(sx, sy, this.vm);
    if (!cellPos) return;

    const minR = Math.min(this.dragStartCell.row, cellPos.row);
    const maxR = Math.max(this.dragStartCell.row, cellPos.row);
    const minC = Math.min(this.dragStartCell.col, cellPos.col);
    const maxC = Math.max(this.dragStartCell.col, cellPos.col);
    const sel: Array<[number, number]> = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (r === 0 && s.entity.titleRow && c > 0) continue;
        sel.push([r, c]);
      }
    }
    this.svc.setSelectionOnly(sel);
  }

  onMouseUp(_e: MouseEvent) {
    this.isDragging = false;
    this.dragStartCell = null;
    // Do not reset resize here, forcing pure click-move-click
  }

  onMouseLeave(_e: MouseEvent) {
    if (!this.isDragging && !this.isResizingActive) {
      this.cursorStyle = 'default';
      this.resizeMode = null;
    }
  }

  onDoubleClick(e: MouseEvent) {
    e.stopPropagation();
    const s = this.svc.state();
    if (!s) return;

    const cRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - cRect.left + this.hitbox.x;
    const sy = e.clientY - cRect.top + this.hitbox.y;

    const cellPos = s.entity.getCellAt(sx, sy, this.vm);
    if (!cellPos) return;

    this.svc.setSelection([[cellPos.row, cellPos.col]]);
    this.svc.setEditing([cellPos.row, cellPos.col]);
  }

  // ─── Textarea events ─────────────────────────────────────────────────────
  /**
   * On every keystroke, update the entity cell text. This triggers
   * vm.markDirty() → canvas re-render → user sees live text changes
   * directly on the canvas (the textarea text itself is invisible).
   *
   * We do NOT update editState or [value] — the textarea manages its
   * own value natively, so the cursor position is never disrupted.
   */
  onInput(e: Event) {
    const s = this.svc.state();
    if (!s?.editingCell) return;
    const val = (e.target as HTMLTextAreaElement).value;
    this.svc.setCellText(s.editingCell[0], s.editingCell[1], val);
  }

  onKey(e: KeyboardEvent) {
    const s = this.svc.state();
    if (!s?.editingCell) return;

    const [r, c] = s.editingCell;

    const navigateTo = (nr: number, nc: number) => {
      this.svc.setSelection([[nr, nc]]);
      this.svc.setEditing([nr, nc]);
    };

    if (e.key === 'Tab') {
      e.preventDefault();
      const nc = e.shiftKey ? c - 1 : c + 1;
      if (nc >= 0 && nc < s.entity.cols) {
        navigateTo(r, nc);
      } else if (!e.shiftKey && r + 1 < s.entity.rows) {
        navigateTo(r + 1, 0);
      } else if (e.shiftKey && r > 0) {
        const prevC = (r - 1 === 0 && s.entity.titleRow) ? 0 : s.entity.cols - 1;
        navigateTo(r - 1, prevC);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (r + 1 < s.entity.rows) navigateTo(r + 1, c);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.svc.setEditing(null);
    } else if (e.key === 'ArrowDown' && e.ctrlKey) {
      e.preventDefault();
      if (r + 1 < s.entity.rows) navigateTo(r + 1, c);
    } else if (e.key === 'ArrowUp' && e.ctrlKey) {
      e.preventDefault();
      if (r > 0) {
        const prevC = (r - 1 === 0 && s.entity.titleRow) ? 0 : c;
        navigateTo(r - 1, prevC);
      }
    }
  }

  // ─── Toolbar Binding Methods ──────────────────────────────────────────────

  insertSymbolFromToolbar(sym: string) {
    const ta = this.editTextarea?.nativeElement;
    if (!ta) return;
    const cell = this.svc.state()?.editingCell;
    if (!cell) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + sym + ta.value.slice(end);
    this.svc.setCellText(cell[0], cell[1], ta.value);
    const pos = start + sym.length;
    setTimeout(() => { ta.focus(); ta.setSelectionRange(pos, pos); }, 0);
  }

  addColumn(e: MouseEvent) {
    e.stopPropagation();
    const s = this.svc.state();
    if (!s) return;
    const ent = s.entity;
    
    // Add a new column to the right
    ent.cols++;
    ent.colWidths.push(ent.colWidths[ent.colWidths.length - 1] ?? 40);
    for (let r = 0; r < ent.rows; r++) {
      ent.cells[r].push({ text: '' });
    }
    
    ent.refreshCaches?.();
    this.vm.markContentDirty();
    this.updateMetrics(s);
  }

  addRow(e: MouseEvent) {
    e.stopPropagation();
    const s = this.svc.state();
    if (!s) return;
    const ent = s.entity;
    
    // Add a new row to the bottom
    ent.rows++;
    ent.rowHeights.push(ent.rowHeights[ent.rowHeights.length - 1] ?? 10);
    const newRow = [];
    for (let c = 0; c < ent.cols; c++) {
      newRow.push({ text: '' });
    }
    ent.cells.push(newRow);
    
    ent.refreshCaches?.();
    this.vm.markContentDirty();
    this.updateMetrics(s);
  }
}
