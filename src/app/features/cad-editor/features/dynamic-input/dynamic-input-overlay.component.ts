import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandPromptService } from '../../core/services/command-prompt.service';
import { ToolCatalogService, ToolMeta } from '../../core/services/tool-catalog.service';
import { CommandRegistryService } from '../../core/services/command-registry.service';
import { SafeHtmlPipe } from '../../shared/components/safe-html.pipe';


@Component({
  selector: 'app-dynamic-input-overlay',
  standalone: true,
  imports: [SafeHtmlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (overlayVisible()) {
      <div
        class="dyn-overlay"
        [style.left.px]="position().left"
        [style.top.px]="position().top"
        >
        <!-- ── Command guidance bar (when a tool is active) ──────────────── -->
        @if (cmdPrompt.state(); as ps) {
          <div class="dyn-cmd-bar">
            @if (ps.command) {
              <span class="dyn-cmd-name">{{ ps.command }}</span>
            }
            @if (ps.message) {
              <span class="dyn-cmd-msg" >{{ ps.message }}</span>
            }
            @for (opt of ps.options; track opt) {
              <button
                type="button"
                class="dyn-chip"
                (mousedown)="$event.preventDefault()"
                (click)="onChip(opt.key)"
                [title]="opt.hint ?? opt.label"
                >[<span class="dyn-chip-key">{{ opt.key }}</span>{{ opt.label.slice(1) }}]</button>
              }
            </div>
          }
          <!-- ── Coordinate fields ─────────────────────────────────────────── -->
          @if (dynInput.visible()) {
            <div class="dyn-fields">
              @for (f of dynInput.effectiveState()!.fields; track trackByKey(i, f); let i = $index) {
                <label
                  class="dyn-field"
                  [class.active]="dynInput.activeFieldKey() === f.key"
                  [class.readonly]="f.readonly"
                  >
                  <span class="dyn-label">{{ f.label }}</span>
                  <input
                    #fieldInput
                    type="text"
                    class="dyn-input"
                    spellcheck="false"
                    autocomplete="off"
                    [attr.data-key]="f.key"
                    [attr.data-index]="i"
                    [readOnly]="f.readonly ?? false"
                    [style.width.px]="f.width ?? 70"
                    [value]="dynInput.effectiveText(f.key, f.liveValue)"
                    (focus)="onFocus(f.key)"
                    (input)="onInput(f.key, $event)"
                    (keydown)="onKey(f.key, i, $event)"
                    />
                    @if (f.suffix) {
                      <span class="dyn-suffix">{{ f.suffix }}</span>
                    }
                  </label>
                }
              </div>
            }
            <!-- ── Idle command search (DYN enabled, no tool active) ─────────── -->
            @if (showSearch()) {
              <div class="dyn-search">
                <span class="dyn-search-prefix">›</span>
                <input
                  #searchInput
                  type="text"
                  class="dyn-search-input"
                  placeholder="Command\u2026"
                  spellcheck="false"
                  autocomplete="off"
                  (input)="onSearchInput($event)"
                  (keydown)="onSearchKey($event)"
                  (blur)="onSearchBlur()"
                  />
                  @if (searchOpen() && searchMatches().length) {
                    <div class="dyn-dd">
                      @for (m of searchMatches(); track m; let i = $index) {
                        <button
                          type="button"
                          class="dyn-dd-item"
                          [class.highlighted]="i === searchHighlight()"
                          (mousedown)="$event.preventDefault()"
                          (mouseenter)="searchHighlight.set(i)"
                          (click)="activateMatch(m)"
                          >
                          <span class="dyn-dd-icon" [innerHTML]="m.svg | safeHtml"></span>
                          <span class="dyn-dd-title">{{ m.title }}</span>
                          <span class="dyn-dd-alias">{{ m.aliases[0] ?? '' }}</span>
                        </button>
                      }
                    </div>
                  }
                </div>
              }
              @if (dynInput.visible()) {
                <div class="dyn-hint">Tab \xB7 Enter \xB7 Esc</div>
              }
            </div>
          }
    `,
  styles: [`
    :host { position: absolute; inset: 0; pointer-events: none; z-index: 50; }
    .dyn-overlay {
      position: absolute;
      pointer-events: auto;
      background: var(--cad-bg-overlay);
      border: 1px solid var(--cad-yellow);
      border-radius: 6px;
      padding: 5px 8px 4px;
      box-shadow: var(--cad-shadow-float);
      font-family: var(--cad-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: 11px;
      color: var(--cad-text-primary);
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 130px;
      max-width: 340px;
    }
    /* ── Command guidance bar ──────────────────────────────── */
    .dyn-cmd-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px;
      padding-bottom: 3px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .dyn-cmd-name {
      color: var(--cad-accent, #f0a030);
      font-weight: 700;
      font-size: 11px;
      letter-spacing: 0.06em;
      margin-right: 2px;
    }
    .dyn-cmd-msg {
      color: var(--cad-text-secondary);
      font-size: 10px;
      flex: 1;
      min-width: 0;
    }
    .dyn-chip {
      display: inline-flex;
      align-items: center;
      padding: 0 4px;
      height: 16px;
      font-size: 10px;
      font-family: inherit;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 3px;
      color: var(--cad-text-primary);
      cursor: pointer;
      white-space: nowrap;
    }
    .dyn-chip:hover { background: rgba(240,160,48,0.22); border-color: var(--cad-yellow); }
    .dyn-chip-key  { color: var(--cad-accent, #f0a030); font-weight: 700; }
    /* ── Coordinate fields ─────────────────────────────────── */
    .dyn-fields { display: flex; flex-wrap: wrap; gap: 6px; }
    .dyn-field {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 4px;
      border-radius: 4px;
      background: var(--cad-bg-input);
      border: 1px solid transparent;
      transition: border-color 0.1s, background 0.1s;
    }
    .dyn-field.active  { border-color: var(--cad-yellow); background: var(--cad-accent-tint); }
    .dyn-field.readonly { opacity: 0.7; }
    .dyn-label { color: var(--cad-text-secondary); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    .dyn-input {
      background: transparent; border: none; outline: none;
      color: var(--cad-text-primary); font-family: inherit; font-size: 12px;
      caret-color: var(--cad-yellow); padding: 0;
    }
    .dyn-input:read-only { color: var(--cad-text-secondary); cursor: default; }
    .dyn-suffix { color: var(--cad-text-dim); font-size: 10px; }
    .dyn-hint   { font-size: 9px; color: var(--cad-text-dim); text-align: right; letter-spacing: 0.04em; }
    /* ── Idle command search ───────────────────────────────── */
    .dyn-search { display: flex; align-items: center; gap: 4px; position: relative; }
    .dyn-search-prefix { color: var(--cad-accent, #f0a030); font-size: 13px; line-height: 1; }
    .dyn-search-input {
      flex: 1; background: transparent; border: none; outline: none;
      color: var(--cad-text-primary); font-family: inherit; font-size: 12px;
      caret-color: var(--cad-yellow); padding: 0; width: 120px;
    }
    .dyn-dd {
      position: absolute; top: calc(100% + 3px); left: 0; right: 0;
      background: var(--cad-bg-overlay, #1e2733);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 4px; box-shadow: var(--cad-shadow-float); z-index: 100; overflow: hidden;
    }
    .dyn-dd-item {
      display: flex; align-items: center; gap: 6px; width: 100%;
      padding: 3px 6px; text-align: left; background: transparent; border: none;
      color: var(--cad-text-primary); font-family: inherit; font-size: 11px; cursor: pointer;
    }
    .dyn-dd-item.highlighted, .dyn-dd-item:hover { background: rgba(240,160,48,0.14); }
    .dyn-dd-icon  { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.85; }
    .dyn-dd-title { flex: 1; }
    .dyn-dd-alias { color: var(--cad-text-dim); font-size: 10px; background: rgba(255,255,255,0.06); padding: 0 3px; border-radius: 2px; }
  `],
})
export class DynamicInputOverlayComponent implements AfterViewInit {
  protected dynInput  = inject(DynamicInputService);
  private   toolMgr   = inject(ToolManagerService);
  protected cmdPrompt = inject(CommandPromptService);
  private   vm        = inject(ViewModelService);
  private   catalog   = inject(ToolCatalogService);
  private   hostRef   = inject(ElementRef<HTMLElement>);
  protected cmdRegistry = inject(CommandRegistryService);

  @ViewChildren('fieldInput') fieldInputs!: QueryList<ElementRef<HTMLInputElement>>;
  @ViewChild('searchInput')   searchInputRef?: ElementRef<HTMLInputElement>;

  readonly position = signal({ left: 0, top: 0 });

  // ─── Idle command-search state ────────────────────────────────────────────
  private readonly _searchActive  = signal(false);
  readonly searchMatches   = signal<ToolMeta[]>([]);
  readonly searchHighlight = signal(0);
  readonly searchOpen      = signal(false);

  /** True when no tool is active and the user has triggered the cursor search. */
  readonly showSearch = computed(() => {
    const name = this.toolMgr.activeToolName();
    const noTool = !name || name === 'select' || name === 'pan';
    return noTool && this.dynInput.dynEnabled() && this._searchActive();
  });

  /**
   * The overlay is visible when:
   *  a) DYN enabled + (tool active or coordinate fields present), OR
   *  b) The idle command search is open.
   */
  readonly overlayVisible = computed(() =>
    this.dynInput.dynVisible() || this._searchActive()
  );

  constructor() {
    effect(() => {
      const sx = this.dynInput.cursorSx();
      const sy = this.dynInput.cursorSy();
      this.dynInput.effectiveState(); // re-run when either state changes
      this.overlayVisible();          // re-run when search activates
      this.updatePosition(sx, sy);
    });
  }

  ngAfterViewInit(): void {
    this.dynInput.focusPrimaryRequest      = (seedChar) => this.focusPrimary(seedChar);
    this.dynInput.activateDynSearchRequest = (char)     => this.startSearch(char);
  }

  /** Position the overlay near the cursor, clamped to the canvas viewport. */
  private updatePosition(sx: number, sy: number): void {
    const host = this.hostRef.nativeElement;
    const W = this.vm.canvasWidth  || host.clientWidth  || 0;
    const H = this.vm.canvasHeight || host.clientHeight || 0;
    if (!W || !H) { this.position.set({ left: sx + 16, top: sy + 16 }); return; }
    const margin = 8, ow = 280, oh = 110;
    let left = sx + 16;
    let top  = sy + 16;
    if (left + ow + margin > W) left = sx - ow - 16;
    if (left < margin) left = margin;
    if (top  + oh + margin > H) top  = sy - oh - 16;
    if (top  < margin) top  = margin;
    this.position.set({ left, top });
  }

  trackByKey = (_: number, f: { key: string }) => f.key;

  // ─── Coordinate field methods ─────────────────────────────────────────────

  focusField(key: string): boolean {
    for (const inp of this.fieldInputs?.toArray() ?? []) {
      if (inp.nativeElement.dataset['key'] === key) {
        inp.nativeElement.focus();
        inp.nativeElement.select();
        return true;
      }
    }
    return false;
  }

  focusPrimary(seedChar?: string): boolean {
    const s = this.dynInput.effectiveState();
    if (!s) return false;
    const primaryKey = s.primaryFieldKey ?? s.fields.find(f => !f.readonly)?.key ?? null;
    if (!primaryKey) return false;
    for (const inp of this.fieldInputs?.toArray() ?? []) {
      if (inp.nativeElement.dataset['key'] === primaryKey) {
        const el = inp.nativeElement;
        el.focus();
        if (seedChar) {
          el.value = seedChar;
          this.dynInput.setActiveField(primaryKey);
          this.dynInput.setFieldText(primaryKey, seedChar);
        } else { el.select(); }
        return true;
      }
    }
    return false;
  }

  onFocus(key: string): void { this.dynInput.setActiveField(key); }

  onInput(key: string, e: Event): void {
    this.dynInput.setFieldText(key, (e.target as HTMLInputElement).value);
    this.vm.markDirty();
  }

  onKey(key: string, index: number, e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.commit(); return; }
    if (e.key === 'Escape') { e.preventDefault(); this.cancel(); return; }
    if (e.key === 'Tab')    { e.preventDefault(); this.cycleField(index, e.shiftKey ? -1 : 1); return; }
  }

  private cycleField(fromIndex: number, dir: 1 | -1): void {
    const s = this.dynInput.effectiveState();
    if (!s) return;
    const n = s.fields.length;
    for (let step = 1; step <= n; step++) {
      const next = ((fromIndex + dir * step) % n + n) % n;
      if (!s.fields[next].readonly) { this.focusField(s.fields[next].key); return; }
    }
  }

  commit(): void {
    const tool   = this.toolMgr.activeTool;
    const values = this.dynInput.collectCommitValues();

    // ── AutoCAD keyword dispatch ──────────────────────────────────────────
    // When the primary field contains an option keyword (single letter OR full
    // label such as '3P', 'Diameter', 'ttr'), route through cmdPrompt so the
    // same multi-char matching used by the bottom command bar applies here too.
    const s = this.dynInput.effectiveState();
    if (s) {
      const primaryKey = s.primaryFieldKey ?? s.fields.find(f => !f.readonly)?.key;
      const primaryVal = (primaryKey ? values[primaryKey] : '')?.trim() ?? '';
      if (/^[a-zA-Z0-9]+$/.test(primaryVal)) {
        const fired = this.cmdPrompt.invokeOptionByKey(primaryVal);
        if (fired) {
          this.dynInput.clearEdits();
          if (this.dynInput.optInputActive()) this.dynInput.clearOptionInput();
          this.blurAll();
          return;
        }
      }
    }

    // ── Coordinate / value commit ─────────────────────────────────────────
    if (!tool?.commitDynamicInput) { this.cancel(); return; }
    const ok = tool.commitDynamicInput(values);
    if (ok) {
      this.dynInput.clearEdits();
      if (this.dynInput.optInputActive()) this.dynInput.clearOptionInput();
      this.blurAll();
    }
  }

  cancel(): void {
    this.dynInput.clearEdits();
    if (this.dynInput.optInputActive()) this.dynInput.clearOptionInput();
    this.blurAll();
  }

  // ─── Command guidance chip click ──────────────────────────────────────────
  onChip(key: string): void { this.cmdPrompt.invokeOptionByKey(key); }

  // ─── Idle command search ──────────────────────────────────────────────────
  startSearch(char: string): void {
    this._searchActive.set(true);
    setTimeout(() => {
      const el = this.searchInputRef?.nativeElement;
      if (!el) return;
      el.value = char;
      el.focus();
      this._handleSearchInput(char);
    });
  }

  onSearchInput(e: Event): void {
    this._handleSearchInput((e.target as HTMLInputElement).value);
  }

  private _handleSearchInput(val: string): void {
    const q = val.trim();
    const matches = q ? this.catalog.search(q) : [];
    this.searchMatches.set(matches);
    this.searchHighlight.set(0);
    this.searchOpen.set(matches.length > 0);
  }

  onSearchKey(e: KeyboardEvent): void {
    const m = this.searchMatches();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (m.length) this.searchHighlight.update(h => (h + 1) % m.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (m.length) this.searchHighlight.update(h => (h - 1 + m.length) % m.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (m.length) this.activateMatch(m[this.searchHighlight()]); else this.closeSearch();
    } else if (e.key === 'Escape') {
      e.preventDefault(); this.closeSearch();
    } else if (e.key === 'Tab' && m.length) {
      e.preventDefault(); this.activateMatch(m[this.searchHighlight()]);
    }
  }

  onSearchBlur(): void { setTimeout(() => this.closeSearch(), 150); }

  activateMatch(t: ToolMeta): void {
    if (!t.stub) {
      // Try executing as a system action first
      if (!this.cmdRegistry.execute(t.id)) {
        // If not a system action, it must be a canvas tool
        this.toolMgr.setTool(t.id);
      }
    }
    this.closeSearch();
  }

  private closeSearch(): void {
    this._searchActive.set(false);
    this.searchMatches.set([]);
    this.searchOpen.set(false);
    if (this.searchInputRef?.nativeElement) this.searchInputRef.nativeElement.value = '';
    this.dynInput.focusPrimaryField();
  }

  private blurAll(): void {
    for (const inp of this.fieldInputs?.toArray() ?? []) inp.nativeElement.blur();
  }

  @HostListener('window:mousedown', ['$event'])
  onWindowMouseDown(e: MouseEvent): void {
    const overlay = this.hostRef.nativeElement.querySelector('.dyn-overlay');
    if (!overlay) return;
    if (!overlay.contains(e.target as Node)) {
      this.dynInput.setActiveField(null);
      this.blurAll();
      if (this._searchActive()) this.closeSearch();
    }
  }
}
