import { Component, effect, ViewChild, ElementRef, HostListener, AfterViewChecked, ChangeDetectorRef, OnDestroy , ChangeDetectionStrategy, inject
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { TextEditorService } from './text-editor.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { TextLayoutEngine, type ITextLayout } from '../../core/utils/text-layout-engine';
import { ListHelper } from './list-helper';
import { NotificationService } from '../../../../core/services/notification.service';

interface IRect { x: number; y: number; w: number; h: number; }

/**
 * Layout state for the invisible-text editing textarea. Mirrors the structure
 * the table-editor uses (`ICellEditState`): the textarea text is `color:
 * transparent` and sized/positioned so its caret lines up with the canvas-
 * rendered glyphs. The canvas keeps rendering the live text on every
 * keystroke — only the blinking caret comes from the textarea.
 */
interface ITextEditState extends IRect {
  fontFamily: string;
  fontSizePx: number;
  lineHeight: number;        // unitless multiplier (matches entity.lineSpacing)
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  textAlign: string;
  caretColor: string;
  /**
   * `'transparent'` for existing-entity edits (canvas renders the live text;
   * the textarea is invisible, only its caret shows). For brand-new entities
   * the textarea text is opaque, because the entity is not yet on the canvas
   * until commit pushes the AddEntityCmd.
   */
  textColor: string;
  wrap: 'soft' | 'off';
}

/**
 * In-place TEXT editor. Mounts inside `<main style="position:relative">` in
 * cad-editor.html, so absolute coordinates map to canvas screen space.
 *
 * Visual language matches the TableEditorOverlay:
 *   - 2px blue ring (`#3b82f6`) drawn over the text bbox.
 *   - Invisible textarea overlaid on canvas-rendered text. Same font /
 *     size / line-height / text-align as the entity, so the caret lands
 *     where the user expects.
 *   - Floating format toolbar above the text (or below if no headroom).
 *   - Click-outside commits, Esc cancels, Enter commits, Shift+Enter newline.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-text-editor-overlay',
  standalone: true,
  imports: [FormsModule],
  template: `
    <!-- The text editor overlay spans the entire canvas. We use document:mousedown to commit when clicking outside. -->
    
    @if (svc.state(); as s) {
      <div class="te-rotated-host"
        [style.left.px]="originX"
        [style.top.px]="originY"
        [style.transform]="'rotate(' + rotationDeg + 'deg)'">
        <div class="te-ring"
          [style.left.px]="ring.x"
          [style.top.px]="ring.y"
          [style.width.px]="ring.w"
          [style.height.px]="ring.h">
          @if (!isLeader(s.entity)) {
            <div class="te-grip te-grip-stretch" (pointerdown)="onStretchStart($event, s.entity)"></div>
          }
          <div class="te-grip te-grip-scale" (pointerdown)="onScaleStart($event, s.entity)"></div>
        </div>
        @for (r of selectionRects; track r) {
          <div class="te-selection"
            [style.left.px]="r.x"
            [style.top.px]="r.y"
            [style.width.px]="r.w"
            [style.height.px]="r.h">
          </div>
        }
        @if (caret) {
          <div class="te-caret"
              [style.font-weight]="editState?.fontWeight"
              [style.font-style]="editState?.fontStyle"
              [style.text-decoration]="editState?.textDecoration"
              [style.left.px]="caret.x"
              [style.top.px]="caret.y"
              [style.height.px]="caret.h">
          </div>
        }
        @if (editState; as ed) {
          <textarea
            #editTextarea
            class="te-textarea"
            [style.left.px]="ring.x"
            [style.top.px]="ring.y"
            [style.width.px]="ring.w"
            [style.height.px]="ring.h"
            [style.font-family]="ed.fontFamily"
            [style.font-size.px]="ed.fontSizePx"
            [style.font-weight]="ed.fontWeight"
            [style.font-style]="ed.fontStyle"
            [style.text-decoration]="ed.textDecoration"
            [style.line-height]="ed.lineHeight"
            [style.text-align]="ed.textAlign"
            (input)="onInput($event)"
            (keydown)="onKey($event)"
            (mousedown)="onMouseDown($event)"
            (dblclick)="$event.stopPropagation()"
            (mouseup)="onMouseUp()"
            (copy)="onCopy($event)"
            spellcheck="false"
            autocomplete="off">
          </textarea>
        }
      </div>
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

    
    .te-rotated-host {
      position: absolute;
      pointer-events: none;
      transform-origin: 0 0;
    }
    .te-selection {
      position: absolute;
      background: var(--cad-accent-glow, rgba(59, 130, 246, 0.3));
      pointer-events: none;
      z-index: 1;
    }
    .te-caret {
      position: absolute;
      width: 1px;
      background: var(--cad-text-primary, #ffffff);
      pointer-events: none;
      z-index: 2;
      animation: blink 1s step-end infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }
.te-ring {
      position: absolute;
      border: 2px solid var(--cad-accent);
      background: var(--cad-accent-tint);
      pointer-events: none;
      box-sizing: border-box;
      border-radius: 2px;
    }

    .te-grip {
      position: absolute;
      width: 8px;
      height: 8px;
      background: var(--cad-bg-panel);
      border: 1px solid var(--cad-accent);
      border-radius: 50%;
      pointer-events: auto;
    }

    .te-grip-stretch {
      right: -4px;
      top: 50%;
      transform: translateY(-50%);
      cursor: ew-resize;
    }

    .te-grip-scale {
      right: -4px;
      bottom: -4px;
      cursor: nwse-resize;
    }

    .te-textarea {
      position: absolute;
      box-sizing: content-box;
      border: none;
      outline: none;
      margin: 0;
      padding: 0;
      resize: none;
      overflow: hidden;
      pointer-events: auto;
      z-index: 1;
      background: transparent;
      color: transparent;
      caret-color: transparent;
    }

    .te-textarea::selection {
      background: var(--cad-accent-glow);
    }

    .te-toolbar-host {
      position: absolute;
      pointer-events: auto;
    }

    .te-sep {
      width: 1px;
      height: 16px;
      background: var(--cad-border, #4a5568);
      margin: 0 4px;
    }

    .te-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--cad-text-primary, #cbd5e0);
      padding: 2px 6px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.2;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 24px;
      box-sizing: border-box;
    }

    .te-btn:hover {
      background: var(--cad-bg-hover, #4a5568);
    }

    .te-btn-confirm {
      color: #10b981;
      font-size: 14px;
    }

    .te-btn-confirm:hover {
      background: rgba(16, 185, 129, 0.15);
      border-color: rgba(16, 185, 129, 0.3);
    }

    .te-btn-cancel {
      color: #ef4444;
      font-size: 12px;
    }

    .te-btn-cancel:hover {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.3);
    }
  `],
})
export class TextEditorOverlayComponent implements AfterViewChecked, OnDestroy {
  @ViewChild('editTextarea') editTextarea?: ElementRef<HTMLTextAreaElement>;

  ring: IRect = { x: 0, y: 0, w: 0, h: 0 };
  caret: { x: number, y: number, h: number } | null = null;
  selectionRects: IRect[] = [];
  rotationDeg = 0;
  originX = 0;
  originY = 0;
  layout: ITextLayout | null = null;
  viewScale = 1;

  editState: ITextEditState | null = null;

  private needsFocus = false;
  private pendingText = '';
  private lastEntityId: number | null = null;
  /** Pending click coordinates for caret positioning on double-click edit. */
  private pendingClickSx: number | undefined;
  private pendingClickSy: number | undefined;
  
  private notify = inject(NotificationService);

  private subs: any[] = [];
  private rafId = 0;
  private lastVmVersion = -1;

  insertSymbolFromToolbar(sym: string) {
    const ta = this.editTextarea?.nativeElement;
    const s = this.svc.state();
    if (!ta || !s) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + sym + ta.value.slice(end);
    s.entity.text = ta.value;
    s.entity.refreshCaches?.();
    this.vm.markContentDirty();
    this.updateMetrics(s.entity);
    const pos = start + sym.length;
    setTimeout(() => { ta.focus(); ta.setSelectionRange(pos, pos); }, 0);
  }

  constructor(
    public svc: TextEditorService,
    private vm: ViewModelService,
    private cdr: ChangeDetectorRef
  ) {
    // Track high-frequency panning/zooming via RAF. In zoneless Angular 20,
    // NgZone.runOutsideAngular() is a no-op — the RAF loop already runs
    // outside Angular change detection by default.
    const loop = () => {
      // Track both epochs: viewEpoch (pan/zoom repositioning) + version (content changes).
      const ve = this.vm.viewEpoch();
      const cv = this.vm.version();
      const combined = ve ^ (cv << 16);
      if (combined !== this.lastVmVersion) {
        this.lastVmVersion = combined;
        const s = this.svc.state();
        if (s?.entity) {
          this.updateMetrics(s.entity);
          this.cdr.detectChanges();
        }
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);


    // Track entity mutations (content changes) through standard Angular effect
    effect(() => {
      const s = this.svc.state();
      if (s?.entity) {
        this.updateMetrics(s.entity);
        this.cdr.detectChanges();
      } else {
        this.editState = null;
        this.ring = { x: 0, y: 0, w: 0, h: 0 };
        this.lastEntityId = null;
        this.cdr.detectChanges();
      }
    });

    // When a NEW entity opens, seed the textarea value once and request focus.
    effect(() => {
      const s = this.svc.state();
      if (s?.entity) {
        const id = (s.entity as any).id ?? -1;
        if (id !== this.lastEntityId) {
          this.lastEntityId = id;
          this.pendingText = s.entity.text || '';
          this.needsFocus = true;
          this.pendingClickSx = s.clickSx;
          this.pendingClickSy = s.clickSy;
        }
      }
    });
    
    this.subs.push(
      this.svc.formatChanged.subscribe(() => {
        const s = this.svc.state();
        if (s?.entity) {
          this.updateMetrics(s.entity);
          this.cdr.markForCheck();
          setTimeout(() => this.editTextarea?.nativeElement.focus(), 0);
        }
      })
    );
    
    this.subs.push(
      this.svc.insertSymbolRequested.subscribe(sym => {
        this.insertSymbolFromToolbar(sym);
      })
    );

    this.subs.push(
      this.svc.toggleListTypeRequested.subscribe(typeMarker => {
        if (this.editTextarea) {
          ListHelper.toggleListType(this.editTextarea.nativeElement, typeMarker);
          this.onInput({ target: this.editTextarea.nativeElement } as any);
          this.editTextarea.nativeElement.focus();
        }
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.cleanupDrag();
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
  }

  ngAfterViewChecked(): void {
    if (this.needsFocus && this.editTextarea) {
      this.needsFocus = false;
      const ta = this.editTextarea.nativeElement;
      ta.value = this.pendingText;
      ta.focus();

      // Position caret at the double-click location if coordinates were provided.
      let caretIndex = ta.value.length; // default: end of text
      if (this.pendingClickSx != null && this.pendingClickSy != null && this.layout) {
        caretIndex = this.computeCaretIndexFromScreen(this.pendingClickSx, this.pendingClickSy);
      }
      this.pendingClickSx = undefined;
      this.pendingClickSy = undefined;
      ta.setSelectionRange(caretIndex, caretIndex);
      this.updateSelectionOverlay();
    }
  }

  /**
   * Convert screen-space click coordinates (relative to canvas) to a
   * character index in the text. Used when entering edit mode via
   * double-click to place the caret at the clicked position.
   */
  private computeCaretIndexFromScreen(sx: number, sy: number): number {
    if (!this.layout) return 0;
    // Transform from screen space to the entity's rotated local space.
    // 1. Translate to entity origin
    const dx = sx - this.originX;
    const dy = sy - this.originY;
    // 2. Undo rotation (rotationDeg is negative of world rotation)
    const rad = -this.rotationDeg * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    // 3. Convert to pre-scale local coordinates (matching the layout engine)
    const localX = rx / this.viewScale;
    const localY = ry / this.viewScale;
    return TextLayoutEngine.getIndexFromLocalCoords(this.layout, localX, localY);
  }

  
  onMouseDown(e: MouseEvent) {
    if (!this.layout) return;
    const target = e.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    // Use offsetX/Y so it's relative to the rotated textarea!
    const x = e.offsetX;
    const y = e.offsetY;
    
    const localX = (x + this.ring.x) / this.viewScale;
    const localY = (y + this.ring.y) / this.viewScale;
    
    const index = TextLayoutEngine.getIndexFromLocalCoords(this.layout, localX, localY);
    
    const ta = this.editTextarea?.nativeElement;
    if (ta) {
      setTimeout(() => {
        ta.focus();
        // Only force the caret to the click position if the browser didn't 
        // just natively select a word (e.g. via double-click).
        if (ta.selectionStart === ta.selectionEnd) {
          ta.setSelectionRange(index, index);
        }
        this.updateSelectionOverlay();
      }, 0);
    }
  }

  onMouseUp() {
    this.updateSelectionOverlay();
  }

  updateSelectionOverlay() {
    const ta = this.editTextarea?.nativeElement;
    if (!ta || !this.layout) return;
    
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    
    if (start === end) {
      this.selectionRects = [];
      const pos = TextLayoutEngine.getCaretPosition(this.layout, start);
      this.caret = {
        x: pos.x * this.viewScale,
        y: pos.y * this.viewScale,
        h: pos.h * this.viewScale
      };
    } else {
      this.caret = null;
      const rects = TextLayoutEngine.getSelectionRects(this.layout, start, end);
      this.selectionRects = rects.map(r => ({
        x: r.x * this.viewScale,
        y: r.y * this.viewScale,
        w: r.w * this.viewScale,
        h: r.h * this.viewScale
      }));
    }
  }

  // ─── Click outside commits ───────────────────────────────────────────────
  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(e: MouseEvent) {
    if (!this.svc.state()) return;
    const target = e.target as HTMLElement;
    if (target.closest('.te-textarea, .te-toolbar-host, .te-ring')) {
      return;
    }
    this.svc.commit();
  }

  isLeader(ent: any): boolean {
    return !!ent && ent.type === 'LEADER';
  }

  isDimension(ent: any): boolean {
    return !!ent && ent.type === 'DIMENSION';
  }

  // ─── Metric computation ──────────────────────────────────────────────────
  
  private updateMetrics(ent: any): void {
    if (this.isLeader(ent)) {
      this.updateLeaderMetrics(ent);
      return;
    }
    if (this.isDimension(ent)) {
      this.updateDimensionMetrics(ent);
      return;
    }

    const layout = ent.getLayout?.(this.vm);
    if (!layout) return;

    this.layout = layout;

    const vm = this.vm as any;
    const scaleFactor = ent.isAnnotative ? (1 / (vm.annoScale || 1)) : 1;
    this.viewScale = scaleFactor * (vm.cumulativeScale ?? vm.scale);
    const sIns = this.vm.w2s(ent.x, ent.y);

    this.originX = sIns.x;
    this.originY = sIns.y;
    this.rotationDeg = -ent.rotation * 180 / Math.PI;

    const lb = layout.localBounds;
    const pad = 4;
    this.ring = {
      x: lb.minX * this.viewScale - pad,
      y: lb.minY * this.viewScale - pad,
      w: (lb.maxX - lb.minX) * this.viewScale + pad * 2,
      h: (lb.maxY - lb.minY) * this.viewScale + pad * 2
    };

    const wb = layout.worldBounds;
    const sMin = this.vm.w2s(wb.minX, wb.maxY);
    const sMax = this.vm.w2s(wb.maxX, wb.minY);
    
    const minX = Math.min(sMin.x, sMax.x);
    const minY = Math.min(sMin.y, sMax.y);
    const maxY = Math.max(sMin.y, sMax.y);

    const TOOLBAR_H = 36;

    const isNew = !!this.svc.state()?.isNew;
    this.editState = {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      fontFamily: ent.font || 'Arial',
      fontSizePx: ent.height * this.viewScale * (4/3),
      lineHeight: ent.lineSpacing,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      textAlign: 'left',
      caretColor: 'transparent',
      textColor: 'transparent',
      wrap: 'off'
    };
    
    this.updateSelectionOverlay();
  }
private updateLeaderMetrics(ent: any): void {
    if (!ent.pts || ent.pts.length === 0) {
      this.editState = null;
      return;
    }

    // Leader positions its ring with absolute screen coords inside ring.x/y,
    // so the rotated-host container must sit at the canvas origin (0,0).
    this.originX = 0;
    this.originY = 0;
    this.rotationDeg = 0;

    const vm = this.vm as any;
    const scaleFactor = ent.isAnnotative ? (1 / (vm.annoScale || 1)) : 1;
    const fontHeightPx = ent.height * scaleFactor * (vm.cumulativeScale ?? vm.scale) * (4 / 3);
    const fontSizePx = Math.max(8, fontHeightPx);
    const lineHeight = ent.lineSpacing || 1.2;
    const lineDyPx = fontSizePx * lineHeight;

    // World-space text insertion → screen.
    const ins = typeof ent.textInsertion === 'function'
      ? ent.textInsertion()
      : (() => {
          const last = ent.pts[ent.pts.length - 1];
          const dir = ent.attachmentSide === 'right' ? 1 : -1;
          const pad = ent.height * 0.25;
          return { x: last.x + dir * (ent.landingLength ?? 4) + dir * pad, y: last.y };
        })();
    const sIns = this.vm.w2s(ins.x, ins.y);

    const lines = (ent.text || '').split(/\\P|\n/);
    const N = Math.max(1, lines.length);

    // Width: widest measured line + breathing room (text doesn't wrap).
    const maxLineW = this.measureMaxLineWidth(lines, ent, fontSizePx);
    const taW = Math.max(fontSizePx * 6, maxLineW + fontSizePx);
    const taH = Math.max(fontSizePx + 4, N * lineDyPx + fontSizePx * 0.4);

    const rightSide = ent.attachmentSide !== 'left';
    // Horizontal placement: anchor at sIns.x, then shift left if text extends
    // to the left (attachmentSide='left' → text-align right inside textarea).
    const taX = rightSide ? sIns.x : sIns.x - taW;
    // Vertical placement: text is middle-baseline → put insertion at the
    // textarea's vertical center, accounting for line count.
    const blockTop = sIns.y - (N * lineDyPx) / 2;
    const taY = blockTop;

    const isNew = !!this.svc.state()?.isNew;
    this.editState = {
      x: taX,
      y: taY,
      w: taW,
      h: taH,
      fontFamily: ent.font || 'Arial',
      fontSizePx,
      lineHeight,
      fontWeight: ent.bold ? 'bold' : 'normal',
      fontStyle: ent.italic ? 'italic' : 'normal',
      textDecoration: [ent.underline ? 'underline' : '', ent.strikethrough ? 'line-through' : '', ent.overline ? 'overline' : ''].filter(Boolean).join(' ') || 'none',
      textAlign: rightSide ? 'left' : 'right',
      caretColor: ent.textColor || '#ffffff',
      textColor: 'transparent',
      wrap: 'off',
    };

    const padX = Math.max(4, fontSizePx * 0.15);
    const padY = Math.max(2, fontSizePx * 0.1);
    this.ring = {
      x: taX - padX,
      y: taY - padY,
      w: taW + padX * 2,
      h: taH + padY * 2,
    };

    const TOOLBAR_H = 36;
  }

  private updateDimensionMetrics(ent: any): void {
    const fontSizePx = 16;
    const lineHeight = 1.2;
    const lineDyPx = fontSizePx * lineHeight;

    // Dimension positions its ring with absolute screen coords inside ring.x/y.
    this.originX = 0;
    this.originY = 0;
    this.rotationDeg = 0;

    const doc = (this.svc as any).doc?.activeFile;
    const metrics = typeof ent.getEditorMetrics === 'function' ? ent.getEditorMetrics(this.vm, doc) : null;
    
    if (!metrics) {
      this.editState = null;
      return;
    }

    const sIns = metrics.sPos;
    const angle = metrics.angle;
    
    const lines = (ent.text || '').split(/\\P|\n/);
    const N = Math.max(1, lines.length);

    const maxLineW = this.measureMaxLineWidth(lines, { font: 'Arial', italic: false, bold: false }, fontSizePx);
    const taW = Math.max(fontSizePx * 6, maxLineW + fontSizePx * 2);
    const taH = Math.max(fontSizePx + 4, N * lineDyPx + fontSizePx * 0.4);

    const taX = sIns.x - taW / 2;
    const taY = sIns.y - taH / 2;

    const isNew = !!this.svc.state()?.isNew;
    this.editState = {
      x: taX,
      y: taY,
      w: taW,
      h: taH,
      fontFamily: 'Arial',
      fontSizePx,
      lineHeight,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      textAlign: 'center',
      caretColor: '#ffffff',
      textColor: 'transparent',
      wrap: 'off',
    };

    const padX = Math.max(4, fontSizePx * 0.15);
    const padY = Math.max(2, fontSizePx * 0.1);
    this.ring = {
      x: taX - padX,
      y: taY - padY,
      w: taW + padX * 2,
      h: taH + padY * 2,
    };

    const TOOLBAR_H = 36;

    // Apply rotation to the editor if it's not strictly horizontal
    if (Math.abs(angle) > 1e-3) {
      setTimeout(() => {
        if (this.editTextarea?.nativeElement) {
          this.editTextarea.nativeElement.style.transform = `rotate(${angle}rad)`;
          this.editTextarea.nativeElement.style.transformOrigin = 'center center';
        }
        // Also rotate the ring for visual alignment
        const ringEl = document.querySelector('.te-ring') as HTMLElement;
        if (ringEl) {
          ringEl.style.transform = `rotate(${angle}rad)`;
          ringEl.style.transformOrigin = 'center center';
        }
      }, 0);
    } else {
      setTimeout(() => {
        if (this.editTextarea?.nativeElement) {
          this.editTextarea.nativeElement.style.transform = 'none';
        }
        const ringEl = document.querySelector('.te-ring') as HTMLElement;
        if (ringEl) {
          ringEl.style.transform = 'none';
        }
      }, 0);
    }
  }

  /**
   * Quick screen-space measurement of the widest line. Used only to pick a
   * sensible textarea width when autoWrap is off — exact pixel-accurate
   * measurement isn't needed because the textarea text is invisible; the
   * width just controls how far the caret can travel before wrapping.
   */
  private measureMaxLineWidth(lines: string[], ent: any, fontSizePx: number): number {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return fontSizePx * 4;
    const style = ent.italic ? 'italic ' : '';
    const weight = ent.bold ? 'bold ' : '';
    ctx.font = `${style}${weight}${fontSizePx}px ${ent.font || 'Arial'}`;
    let max = 0;
    for (const ln of lines) {
      const w = ctx.measureText(ln || ' ').width;
      if (w > max) max = w;
    }
    return Math.ceil(max);
  }

  // ─── Textarea events ─────────────────────────────────────────────────────
  onInput(e: Event) {
    const s = this.svc.state();
    if (!s) return;
    s.entity.text = (e.target as HTMLTextAreaElement).value;
    s.entity.refreshCaches?.();
    // markContentDirty (not markDirty) bumps the content epoch so the canvas
    // static-layer cache invalidates and re-renders the edited text live —
    // otherwise edits to EXISTING text stay hidden behind the stale cache until
    // commit. It also lets the RAF metrics loop pick up the change.
    this.vm.markContentDirty();
    // Resize the blue ring / textarea synchronously as the text grows so the
    // box tracks the content instead of lagging a frame behind.
    this.updateMetrics(s.entity);
    this.updateSelectionOverlay();
  }

  onKey(e: KeyboardEvent) {
    const ta = this.editTextarea?.nativeElement;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.svc.cancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      // Ctrl+Enter or Cmd+Enter commits; plain Enter naturally inserts a newline in textarea
      e.preventDefault();
      e.stopPropagation();
      this.svc.commit();
    } else if (ta) {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (ListHelper.onEnter(ta)) {
          e.preventDefault();
          this.onInput({ target: ta } as any);
        }
      } else if (e.key === 'Backspace') {
        if (ListHelper.onBackspace(ta)) {
          e.preventDefault();
          this.onInput({ target: ta } as any);
        }
      } else if (e.key === 'Tab') {
        if (ListHelper.onTab(ta, e.shiftKey)) {
          e.preventDefault();
          this.onInput({ target: ta } as any);
        }
      }
    }
    setTimeout(() => this.updateSelectionOverlay(), 0);
  }

  onCopy(e: ClipboardEvent) {
    const ta = this.editTextarea?.nativeElement;
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      const selectedText = ta.value.substring(ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
      e.clipboardData?.setData('text/plain', selectedText);
      e.preventDefault();
      this.notify.info('Text copied to clipboard', 1800);
    }
  }

  // ─── Drag Resize Grips ───────────────────────────────────────────────────
  private _dragCleanup: (() => void) | null = null;

  onScaleStart(e: PointerEvent, ent: any) {
    e.preventDefault();
    e.stopPropagation();
    
    const startY = e.clientY;
    const startHeight = ent.height;
    const initialScreenHeight = this.ring.h;
    
    const onMove = (ev: PointerEvent) => {
      // Delta in screen pixels
      const dy = ev.clientY - startY;
      // Rough heuristic: map delta Y to a change in world height.
      // E.g., if we dragged 10 pixels down, increase font size linearly.
      // More accurate: ratio based on original bounding box height.
      const newScreenHeight = initialScreenHeight + dy;
      const ratio = Math.max(0.1, newScreenHeight / initialScreenHeight);
      
      ent.height = Math.max(0.1, startHeight * ratio);
      ent.refreshCaches?.();
      this.vm.markContentDirty();
      this.updateMetrics(ent);
    };
    
    const onUp = (ev: PointerEvent) => {
      this.cleanupDrag();
      setTimeout(() => this.editTextarea?.nativeElement.focus(), 0);
    };
    
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    this._dragCleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }

  onStretchStart(e: PointerEvent, ent: any) {
    e.preventDefault();
    e.stopPropagation();
    
    const vm = this.vm as any;
    const startX = e.clientX;
    const startWidth = ent.autoWrap && ent.mtextWidth > 0 
      ? ent.mtextWidth 
      : this.ring.w / (vm.cumulativeScale ?? vm.scale);
      
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dw = dx / (vm.cumulativeScale ?? vm.scale);
      ent.autoWrap = true;
      ent.mtextWidth = Math.max(0.1, startWidth + dw);
      ent.refreshCaches?.();
      this.vm.markContentDirty();
      this.updateMetrics(ent);
    };
    
    const onUp = (ev: PointerEvent) => {
      this.cleanupDrag();
      setTimeout(() => this.editTextarea?.nativeElement.focus(), 0);
    };
    
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    this._dragCleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }

  cleanupDrag() {
    if (this._dragCleanup) {
      this._dragCleanup();
      this._dragCleanup = null;
    }
  }
}
