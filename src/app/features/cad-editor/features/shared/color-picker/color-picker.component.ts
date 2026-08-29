import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
  OnChanges,
  SimpleChanges,
  output,
  ChangeDetectionStrategy,
  input
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import {
  parseColorInput,
  hexToRgb,
  rgbToHex,
  QUICK_COLORS,
  IParsedColor,
} from '../../../core/utils/color-parse';
import { RecentColorsService } from './recent-colors.service';

/**
 * Reusable color picker. Drop in anywhere a color field is needed:
 *
 *   <app-color-picker
 *     [value]="ent.color"
 *     [mixed]="multipleEntitiesHaveDifferentColors"
 *     (valueChange)="setColor($event)">
 *   </app-color-picker>
 *
 * UX:
 *   - Closed: shows a swatch + label, no popup. Single click opens it.
 *   - Open: shows quick swatches, RGB inputs, HEX input, recent colors,
 *     live preview, Apply / Cancel. Typing NEVER auto-commits — only
 *     Enter or the Apply button commits. Escape (or click-outside)
 *     cancels and restores the previous color.
 *   - Multi-select: pass `mixed=true` to show "Varies" instead of a value.
 *     The first edit will set the new color for every selected entity.
 *
 * Emits `valueChange` exactly once per commit, with the canonical
 * `#rrggbb` hex string. Consumers route this through their command stack;
 * the picker itself never mutates any model.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-color-picker',
  standalone: true,
  imports: [FormsModule],
  template: `
    <button type="button" class="cp-trigger" [class.mixed]="mixed() && !isOpen()" [class.no-label]="!showLabel()" (click)="toggle()" [title]="triggerTitle()">
      <span class="cp-swatch" [style.background]="triggerSwatch()"></span>
      @if (showLabel()) {
        <span class="cp-label">{{ triggerLabel() }}</span>
      }
      <span class="cp-caret">▾</span>
    </button>
    
    @if (isOpen()) {
      <div class="cp-popover" [class.is-dropdown]="mode() === 'dropdown'" #popover (click)="$event.stopPropagation()">
        <!-- DROPDOWN MODE (AutoCAD style) -->
        @if (mode() === 'dropdown') {
          <div class="cp-dropdown-list">
            @for (q of quickColors; track q) {
              <button
                type="button"
                class="cp-dropdown-item"
                [class.selected]="drafting().toLowerCase() === q.hex"
                (click)="pickQuick(q.hex)">
                <span class="cp-swatch-sm" [style.background]="q.hex"></span>
                <span class="cp-item-label">{{ q.name }}</span>
              </button>
            }
            <div class="cp-divider"></div>
            <button type="button" class="cp-dropdown-item cp-more-colors" (click)="setMode('advanced')">
              <span class="cp-swatch-sm cp-swatch-empty"></span>
              <span class="cp-item-label">Select Color...</span>
            </button>
          </div>
        }
        <!-- ADVANCED MODE (RGB, HEX, Recent) -->
        @if (mode() === 'advanced') {
          <!-- Quick swatches -->
          <div class="cp-section">
            <div class="cp-section-title">Quick</div>
            <div class="cp-swatch-row">
              @for (q of quickColors; track q) {
                <button
                  type="button"
                  class="cp-swatch-btn"
                  [class.selected]="drafting().toLowerCase() === q.hex"
                  [style.background]="q.hex"
                  [title]="q.name + ' (' + q.hex + ')'"
                (click)="pickQuick(q.hex)"></button>
              }
            </div>
          </div>
          <!-- Live preview + RGB/HEX inputs -->
          <div class="cp-section cp-edit-row">
            <div class="cp-preview" [style.background]="drafting()" [title]="drafting()"></div>
            <div class="cp-inputs">
              <label class="cp-input-row">
                <span>HEX</span>
                <input #hexInput type="text" class="cp-text"
                  [ngModel]="hexBuffer()"
                  (ngModelChange)="onHexInput($event)"
                  (keydown.enter)="commit()"
                  (keydown.escape)="cancel()"
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="#rrggbb / 255,0,0 / red / 1">
                </label>
                <div class="cp-rgb-row">
                  <label><span>R</span><input type="number" min="0" max="255"
                  [ngModel]="r()"
                  (ngModelChange)="onRgbInput('r', $event)"
                  (keydown.enter)="commit()"
                (keydown.escape)="cancel()"></label>
                <label><span>G</span><input type="number" min="0" max="255"
                [ngModel]="g()"
                (ngModelChange)="onRgbInput('g', $event)"
                (keydown.enter)="commit()"
              (keydown.escape)="cancel()"></label>
              <label><span>B</span><input type="number" min="0" max="255"
              [ngModel]="b()"
              (ngModelChange)="onRgbInput('b', $event)"
              (keydown.enter)="commit()"
            (keydown.escape)="cancel()"></label>
          </div>
        </div>
      </div>
      <!-- Recent -->
      @if (recents.colors().length) {
        <div class="cp-section">
          <div class="cp-section-title">Recent</div>
          <div class="cp-swatch-row">
            @for (c of recents.colors(); track c) {
              <button
                type="button"
                class="cp-swatch-btn"
                [style.background]="c"
                [title]="c"
              (click)="pickQuick(c)"></button>
            }
          </div>
        </div>
      }
      <div class="cp-actions">
        <button type="button" class="cp-btn" (click)="cancel()">Cancel</button>
        <button type="button" class="cp-btn primary" (click)="commit()">Apply</button>
      </div>
    }
    </div>
    }
    `,
  styles: [`
    :host { position: relative; display: inline-block; }
    .cp-trigger { display: flex; align-items: center; gap: 6px; background: var(--cad-bg-input); border: 1px solid var(--cad-border); color: var(--cad-text-primary); padding: 2px 6px; border-radius: 2px; font: inherit; font-size: 12px; cursor: pointer; min-width: 110px; }
    .cp-trigger.no-label { min-width: unset; width: auto; padding: 2px 4px; gap: 3px; }
    .cp-trigger:hover { border-color: var(--cad-accent); }
    .cp-trigger.mixed .cp-swatch { background: repeating-linear-gradient(45deg, var(--cad-text-dim) 0 4px, var(--cad-border) 4px 8px) !important; }
    .cp-swatch { display: inline-block; width: 16px; height: 16px; border: 1px solid var(--cad-border-soft); border-radius: 2px; flex: 0 0 auto; }
    .cp-label { flex: 1; text-align: left; font-family: monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cp-caret { color: var(--cad-text-dim); font-size: 10px; }

    .cp-popover {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 3000;
      width: 240px;
      background: var(--cad-bg-panel-solid);
      border: 1px solid var(--cad-border);
      border-radius: 4px;
      box-shadow: var(--cad-shadow-float);
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      font-family: var(--cad-font-ui);
      color: var(--cad-text-primary);
    }
    .cp-popover.is-dropdown {
      width: 160px;
      padding: 4px 0;
      gap: 0;
    }

    /* DROPDOWN STYLES */
    .cp-dropdown-list { display: flex; flex-direction: column; }
    .cp-dropdown-item {
      display: flex; align-items: center; gap: 8px; padding: 6px 12px;
      background: transparent; border: none; color: var(--cad-text-primary);
      cursor: pointer; font-family: var(--cad-font-ui); font-size: 12px; text-align: left;
    }
    .cp-dropdown-item:hover, .cp-dropdown-item.selected { background: var(--cad-bg-hover); }
    .cp-swatch-sm { display: inline-block; width: 14px; height: 14px; border: 1px solid var(--cad-border-soft); border-radius: 2px; flex: 0 0 auto; }
    .cp-swatch-empty { background: transparent; border: 1px dashed var(--cad-text-dim); }
    .cp-item-label { flex: 1; }
    .cp-divider { height: 1px; background: var(--cad-border); margin: 4px 0; }
    .cp-more-colors { color: var(--cad-text-primary); }

    /* ADVANCED STYLES */
    .cp-section-title { font-size: 10px; text-transform: uppercase; color: var(--cad-text-dim); margin-bottom: 4px; letter-spacing: 0.5px; }
    .cp-swatch-row { display: flex; flex-wrap: wrap; gap: 4px; }
    .cp-swatch-btn { width: 22px; height: 22px; border: 1px solid var(--cad-border-soft); border-radius: 2px; cursor: pointer; padding: 0; }
    .cp-swatch-btn:hover { outline: 1px solid var(--cad-accent); }
    .cp-swatch-btn.selected { outline: 2px solid var(--cad-accent); }

    .cp-edit-row { display: flex; gap: 8px; align-items: stretch; }
    .cp-preview { width: 56px; min-height: 56px; border: 1px solid var(--cad-border-soft); border-radius: 2px; flex: 0 0 56px; }
    .cp-inputs { flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .cp-input-row { display: flex; align-items: center; gap: 6px; font-size: 11px; }
    .cp-input-row span { width: 26px; color: var(--cad-text-dim); }
    .cp-input-row input { flex: 1; background: var(--cad-bg-input); border: 1px solid var(--cad-border); color: var(--cad-text-primary); padding: 3px 5px; border-radius: 2px; font-family: monospace; font-size: 12px; }
    .cp-rgb-row { display: flex; gap: 4px; }
    .cp-rgb-row label { flex: 1; display: flex; align-items: center; gap: 4px; font-size: 11px; }
    .cp-rgb-row label span { color: var(--cad-text-dim); }
    .cp-rgb-row input { width: 100%; min-width: 0; background: var(--cad-bg-input); border: 1px solid var(--cad-border); color: var(--cad-text-primary); padding: 3px 4px; border-radius: 2px; font-size: 11px; }

    .cp-actions { display: flex; justify-content: flex-end; gap: 6px; }
    .cp-btn { background: var(--cad-bg-panel-solid); border: 1px solid var(--cad-border); color: var(--cad-text-primary); padding: 4px 10px; border-radius: 2px; font-size: 11px; cursor: pointer; }
    .cp-btn:hover { background: var(--cad-bg-hover); }
    .cp-btn.primary { background: var(--cad-accent); border-color: var(--cad-accent); color: var(--cad-text-on-accent); }
    .cp-btn.primary:hover { background: var(--cad-accent-dim); }
  `],
})
export class ColorPickerComponent implements OnChanges {
  /** Current color (`#rrggbb`). Ignored when `mixed` is true. */
  readonly value = input<string | null | undefined>('#ffffff');
  /** Render the trigger as "Varies" without a definite color. */
  readonly mixed = input(false);
  /** Optional label override shown alongside the swatch when closed. */
  readonly label = input<string>(undefined);
  /** Whether to show the hex color code/label when the picker is closed. */
  readonly showLabel = input(true);
  /** Emitted exactly once per commit (Enter or Apply). */
  readonly valueChange = output<string>();

  readonly recents = inject(RecentColorsService);
  readonly quickColors = QUICK_COLORS;

  readonly isOpen = signal(false);
  readonly mode = signal<'dropdown' | 'advanced'>('dropdown');

  /** The color the popover is currently *drafting* — what the preview shows. */
  private readonly _draft = signal<string>('#ffffff');
  /** What the trigger and inputs displayed when the popover opened — used to restore on cancel. */
  private _committedAtOpen = '#ffffff';
  /** Free-form text the user has typed into the HEX field, kept separate so
   *  partial entries like '#FF' don't get overwritten while typing. */
  private readonly _hexBuffer = signal<string>('#ffffff');

  @ViewChild('hexInput') hexInput?: ElementRef<HTMLInputElement>;

  drafting = computed(() => this._draft());
  hexBuffer = computed(() => this._hexBuffer());
  r = computed(() => (hexToRgb(this._draft()) ?? [0, 0, 0])[0]);
  g = computed(() => (hexToRgb(this._draft()) ?? [0, 0, 0])[1]);
  b = computed(() => (hexToRgb(this._draft()) ?? [0, 0, 0])[2]);

  constructor(private host: ElementRef<HTMLElement>) {}

  ngOnChanges(changes: SimpleChanges): void {
    // Track the upstream `value` whenever the picker is closed so the
    // trigger reflects external edits.
    if (!this.isOpen() && (changes['value'] || changes['mixed'])) {
      const v = this._normaliseInputValue();
      this._draft.set(v);
      this._hexBuffer.set(v);
    }
  }

  /* ─── trigger / label ─────────────────────────────────────────────── */

  triggerSwatch(): string {
    if (this.mixed() && !this.isOpen()) return '#888888';
    return this._draft();
  }

  triggerLabel(): string {
    const label = this.label();
    if (label) return label;
    if (this.mixed() && !this.isOpen()) return 'Varies';
    return this._draft();
  }

  triggerTitle(): string {
    if (this.mixed() && !this.isOpen()) return 'Multiple values — click to set';
    return this._draft();
  }

  /* ─── open / close ────────────────────────────────────────────────── */

  toggle(): void {
    if (this.isOpen()) this.cancel();
    else this.open();
  }

  open(): void {
    const v = this._normaliseInputValue();
    this._committedAtOpen = v;
    this._draft.set(v);
    this._hexBuffer.set(v);
    this.mode.set('dropdown');
    this.isOpen.set(true);
  }

  setMode(mode: 'dropdown' | 'advanced'): void {
    this.mode.set(mode);
    if (mode === 'advanced') {
      setTimeout(() => this.hexInput?.nativeElement.select(), 0);
    }
  }

  cancel(): void {
    this._draft.set(this._committedAtOpen);
    this._hexBuffer.set(this._committedAtOpen);
    this.isOpen.set(false);
  }

  commit(): void {
    const parsed = parseColorInput(this._hexBuffer());
    const hex = parsed ? parsed.hex : this._draft();
    this._draft.set(hex);
    this._hexBuffer.set(hex);
    this.isOpen.set(false);
    this.recents.push(hex);
    this.valueChange.emit(hex);
  }

  /* ─── input handlers (preview only — never auto-commit) ───────────── */

  onHexInput(text: string): void {
    this._hexBuffer.set(text);
    const parsed = parseColorInput(text);
    if (parsed) this._draft.set(parsed.hex);
    // If parsing failed we keep the previous preview; the user is mid-type.
  }

  onRgbInput(channel: 'r' | 'g' | 'b', val: number | string): void {
    const n = typeof val === 'number' ? val : parseInt(String(val), 10);
    if (!Number.isFinite(n)) return;
    const current = hexToRgb(this._draft()) ?? [0, 0, 0];
    const idx = channel === 'r' ? 0 : channel === 'g' ? 1 : 2;
    current[idx] = Math.max(0, Math.min(255, Math.round(n)));
    const hex = rgbToHex(current as [number, number, number]);
    this._draft.set(hex);
    this._hexBuffer.set(hex);
  }

  pickQuick(hex: string): void {
    this._draft.set(hex);
    this._hexBuffer.set(hex);
    // Single-click on a swatch commits immediately — that's the "quick"
    // affordance the spec asks for.
    this.commit();
  }

  /* ─── outside click / escape — global listeners ───────────────────── */

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (!this.isOpen()) return;
    if (!this.host.nativeElement.contains(e.target as Node)) {
      this.cancel();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.isOpen()) this.cancel();
  }

  /* ─── helpers ─────────────────────────────────────────────────────── */

  private _normaliseInputValue(): string {
    if (this.mixed()) return '#888888';
    const v = (this.value() ?? '').trim();
    const parsed = parseColorInput(v);
    return parsed ? parsed.hex : (/^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '#ffffff');
  }

  /** External callers can reach into the picker to commit programmatically. */
  forceCommit(hex: string): void {
    const parsed = parseColorInput(hex);
    if (!parsed) return;
    this._draft.set(parsed.hex);
    this._hexBuffer.set(parsed.hex);
    this.commit();
  }

  /** Re-exported for templates that want to bind `[parsed]`. */
  parse(input: string): IParsedColor | null { return parseColorInput(input); }
}
