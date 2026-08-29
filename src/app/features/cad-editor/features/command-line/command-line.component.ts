import { Component, ElementRef, ViewChild, inject, signal, computed , ChangeDetectionStrategy
} from '@angular/core';

import { ToolManagerService } from '../../core/services/tool-manager.service';
import { ToolCatalogService, ToolMeta } from '../../core/services/tool-catalog.service';
import { CommandRegistryService } from '../../core/services/command-registry.service';
import { CommandPromptService } from '../../core/services/command-prompt.service';
import type { ICommandOption } from '../../core/models/command-prompt.model';
import { SafeHtmlPipe } from '../../shared/components/safe-html.pipe';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-cad-command-line',
  standalone: true,
  imports: [SafeHtmlPipe],
  template: `
    <div class="cad-bottom-bar">
      <div class="command-line">
        <span class="cmd-prefix">›</span>
        <!-- Transient error message (highest priority, auto-clears) -->
        @if (prompt()) {
          <span class="cmd-prompt">{{ prompt() }}</span>
        }
    
        <!-- Active command guidance: name + instruction + clickable option chips -->
        @if (!prompt() && !query() && activePromptState()) {
          <span class="cmd-guidance">
            @if (activePromptState()!.command) {
              <span class="cmd-guidance-cmd">{{ activePromptState()!.command }}</span>
            }
            <span class="cmd-guidance-msg">{{ activePromptState()!.message }}</span>
            @for (opt of activePromptState()!.options; track opt) {
              <button
                type="button"
                class="cmd-opt-chip"
                (mousedown)="$event.preventDefault()"
                (click)="onOptionChip(opt.key)"
                [title]="opt.hint ?? opt.label">
                [<span class="cmd-opt-key">{{ opt.key }}</span>{{ opt.label.slice(1) }}]
              </button>
            }
          </span>
        }
        <div class="cmd-input-wrap">
          <input
            #cmdInput
            class="cmd-input"
            type="text"
            [placeholder]="placeholder()"
            autocomplete="off"
            spellcheck="false"
            (input)="onInput()"
            (keydown)="onKey($event)"
            (blur)="onBlur()"
            />
            @if (ghostSuffix()) {
              <span class="cmd-ghost">
                <span class="cmd-ghost-prefix">{{ query() }}</span><span class="cmd-ghost-suffix">{{ ghostSuffix() }}</span>
              </span>
            }
    
            @if (dropdownOpen() && matches().length) {
              <div class="cmd-dropdown">
                @for (m of matches(); track m; let i = $index) {
                  <button
                    type="button"
                    class="cmd-dropdown-item"
                    [class.highlighted]="i === highlightIndex()"
                    (mousedown)="$event.preventDefault()"
                    (mouseenter)="highlightIndex.set(i)"
                    (click)="activate(m)"
                    >
                    <span class="cmd-dropdown-icon" [innerHTML]="m.svg | safeHtml"></span>
                    <span class="cmd-dropdown-text">
                      <span class="cmd-dropdown-title">{{ m.title }}</span>
                      <span class="cmd-dropdown-group">{{ m.group }}</span>
                    </span>
                    <span class="cmd-dropdown-alias">{{ m.aliases[0] }}</span>
                  </button>
                }
              </div>
            }
          </div>
          <button type="button" class="cmd-btn" (click)="pressEsc()">Esc</button>
          <button type="button" class="cmd-btn" (click)="pressEnter()">Enter</button>
        </div>
      </div>
    `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }
    .cmd-input-wrap {
      position: relative;
      flex: 1;
      display: flex;
      align-items: center;
      min-height: 100%;
    }
    .cmd-ghost {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      pointer-events: none;
      font-family: var(--cad-font-mono);
      font-size: 14px;
      color: transparent;
      white-space: pre;
    }
    .cmd-ghost-prefix { color: transparent; }
    .cmd-ghost-suffix { color: var(--cad-text-dim); }

    .cmd-guidance {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
    }
    .cmd-guidance-cmd {
      color: var(--cad-accent);
      font-family: var(--cad-font-mono);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding-right: 2px;
      flex-shrink: 0;
    }
    .cmd-guidance-msg {
      color: var(--cad-text-secondary, #b8bdc8);
      font-family: var(--cad-font-mono);
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 1;
    }
    .cmd-opt-chip {
      display: inline-flex;
      align-items: center;
      padding: 1px 5px;
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 3px;
      background: var(--cad-bg-panel, #1a1f29);
      color: var(--cad-text-dim, #7f8694);
      font-family: var(--cad-font-mono);
      font-size: 11px;
      cursor: pointer;
      flex-shrink: 0;
      line-height: 1.6;
      transition: background 0.1s, border-color 0.1s;
      white-space: nowrap;
    }
    .cmd-opt-chip:hover {
      background: var(--cad-bg-hover, rgba(255,255,255,0.06));
      border-color: var(--cad-accent);
      color: var(--cad-text-primary, #e0e4ea);
    }
    .cmd-opt-key {
      color: var(--cad-accent);
      font-weight: 600;
    }

    .cmd-dropdown {
      position: absolute;
      left: 0;
      width: 33.333%;
      right: auto;
      bottom: calc(100% + 4px);
      background: var(--cad-bg-panel-solid, #1f2530);
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: var(--cad-radius-sm, 4px);
      box-shadow: var(--cad-shadow-float);
      max-height: 280px;
      overflow-y: auto;
      z-index: 200;
      padding: 4px 0;
    }
    .cmd-dropdown-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 6px 10px;
      background: transparent;
      border: none;
      color: var(--cad-text-primary, #e0e4ea);
      font-family: var(--cad-font-mono);
      font-size: 14px;
      text-align: left;
      cursor: pointer;
      transition: background 0.08s;
    }
    .cmd-dropdown-item.highlighted,
    .cmd-dropdown-item:hover {
      background: var(--cad-bg-hover, rgba(255,255,255,0.06));
    }
    .cmd-dropdown-item.highlighted {
      background: var(--cad-accent-tint);
    }
    .cmd-dropdown-icon {
      display: inline-flex;
      width: 18px;
      height: 18px;
      color: var(--cad-text-secondary, #b8bdc8);
      flex-shrink: 0;
    }
    .cmd-dropdown-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      line-height: 1.2;
    }
    .cmd-dropdown-title { color: var(--cad-text-primary); }
    .cmd-dropdown-group {
      font-size: 10px;
      color: var(--cad-text-dim, #7f8694);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .cmd-dropdown-alias {
      font-size: 10px;
      color: var(--cad-text-dim);
      padding: 2px 6px;
      border: 1px solid var(--cad-border);
      border-radius: 3px;
    }
  `],
})
export class CommandLineComponent {
  @ViewChild('cmdInput') inputRef!: ElementRef<HTMLInputElement>;

  private toolMgr = inject(ToolManagerService);
  private catalog = inject(ToolCatalogService);
  private cmdRegistry = inject(CommandRegistryService);
  private cmdPromptSvc = inject(CommandPromptService);

  readonly prompt = signal('');
  readonly query = signal('');
  readonly matches = signal<ToolMeta[]>([]);
  readonly highlightIndex = signal(0);
  readonly dropdownOpen = signal(false);

  /** Active command guidance state, null when idle or user is typing a command. */
  readonly activePromptState = computed(() => {
    if (this.prompt()) return null; // transient error takes precedence
    return this.cmdPromptSvc.state();
  });

  /** Placeholder reflects the current command phase when a tool is active. */
  readonly placeholder = computed(() => {
    const state = this.cmdPromptSvc.state();
    if (!state) return 'Type a command or tool name\u2026';
    const opts = (state.options ?? []).length
      ? ` [${state.options.map((o: any) => o.key).join('/')}]` : '';
    return `${state.message.replace(/:$/, '')}${opts}`;
  });

  /** Invoke an option chip by its key letter. */
  onOptionChip(key: string): void {
    this.cmdPromptSvc.invokeOptionByKey(key);
  }

  readonly ghostSuffix = computed(() => {
    const q = this.query();
    const m = this.matches();
    if (!q || !m.length || !this.dropdownOpen()) return '';
    const first = m[0];
    const candidates = [first.id, ...first.aliases, first.title.toLowerCase()];
    const ql = q.toLowerCase();
    for (const c of candidates) {
      if (c.startsWith(ql) && c.length > ql.length) {
        return c.slice(ql.length);
      }
    }
    return '';
  });

  onInput(): void {
    const val = this.inputRef.nativeElement.value;
    this.query.set(val);
    // When a non-trivial command is active, the typed text is a value/keyword
    // for that command — never trigger catalog search while a tool is running.
    const name = this.toolMgr.activeToolName();
    if (name && name !== 'select' && name !== 'pan') {
      this.matches.set([]);
      this.dropdownOpen.set(false);
      return;
    }
    const m = val.trim() ? this.catalog.search(val) : [];
    this.matches.set(m);
    this.highlightIndex.set(0);
    this.dropdownOpen.set(m.length > 0);
  }

  /** Focus the command-line input and seed it with `char` (called when the user types on the canvas). */
  focusWithChar(char: string): void {
    if (!this.inputRef) return;
    const el = this.inputRef.nativeElement;
    el.focus();
    if (char) {
      el.value = (el.value ?? '') + char;
      this.onInput();
    }
  }

  onBlur(): void {
    setTimeout(() => this.dropdownOpen.set(false), 120);
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.pressEnter();
    } else if (e.key === ' ') {
      // AutoCAD-style: Space inside the command bar behaves like Enter.
      // Tool aliases never contain whitespace, so consuming Space here can
      // never destroy meaningful user input. Empty query falls through to
      // the Select/last-tool toggle so the command bar behaves like canvas focus.
      e.preventDefault();
      e.stopPropagation();
      // Empty or not, pressEnter() now does the right thing: it forwards to a
      // running tool, and only toggles Select/last-tool when nothing is active.
      this.pressEnter();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.pressEsc();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const m = this.matches();
      if (m.length) this.highlightIndex.set((this.highlightIndex() + 1) % m.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const m = this.matches();
      if (m.length) this.highlightIndex.set((this.highlightIndex() - 1 + m.length) % m.length);
    } else if (e.key === 'Tab') {
      const ghost = this.ghostSuffix();
      if (ghost) {
        e.preventDefault();
        const next = this.query() + ghost;
        this.inputRef.nativeElement.value = next;
        this.query.set(next);
        this.matches.set(this.catalog.search(next));
        this.highlightIndex.set(0);
      }
    }
  }

  pressEnter(): void {
    const rawVal = (this.inputRef?.nativeElement.value ?? '').trim();
    const valLower = rawVal.toLowerCase();

    // Determine tool state early so all branches can use it.
    const activeTool    = this.toolMgr.activeTool;
    const activeToolName = this.toolMgr.activeToolName();
    const toolIsActive  = !!(activeTool && activeToolName !== 'select' && activeToolName !== 'pan');

    if (!valLower) {
      // A running command owns Enter: it means "finish this step" — close the
      // polyline, commit the array, end the selection set, total the area.
      // Forward it to the tool instead of cancelling out to Select, which is
      // what toggleLastOrSelect() would do. Only at idle does Enter carry its
      // other AutoCAD meaning, "repeat the last command".
      if (toolIsActive) {
        activeTool!.onKeyDown?.(new KeyboardEvent('keydown', { key: 'Enter', bubbles: false }));
        return;
      }
      this.toolMgr.toggleLastOrSelect();
      return;
    }

    // 1. When a tool is active, try the typed text as a keyword option.
    //    Supports single-key shortcuts ('3', 'D') AND full labels ('3P', 'Diameter', 'ttr').
    if (toolIsActive && this.cmdPromptSvc.invokeOptionByKey(rawVal)) {
      this.clearInput();
      return;
    }

    // 2. Try to pass the input to the active tool as a value (e.g. radius, length, sides)
    if (toolIsActive) {
      const dynState = activeTool!.getDynamicInputState?.();
      if (dynState && dynState.primaryFieldKey) {
        const success = activeTool!.commitDynamicInput?.({ [dynState.primaryFieldKey]: rawVal });
        if (success) {
          this.clearInput();
          return;
        }
      }
      // Tool is active but couldn’t consume the input — clear without activating
      // another command. The user must Escape first to exit the current command.
      this.clearInput();
      return;
    }

    // 3. Check dropdown matches (only reached when no tool is active)
    const m = this.matches();
    if (m.length) {
      const idx = Math.min(this.highlightIndex(), m.length - 1);
      this.activate(m[idx]);
      return;
    }

    // 4. Exact match lookup as fallback
    const exact = this.catalog.getAll().find(
      (t) => t.id === valLower || t.aliases.includes(valLower) || t.title.toLowerCase() === valLower,
    );
    if (exact) {
      this.activate(exact);
    } else {
      this.prompt.set(`Unknown: ${rawVal}`);
      setTimeout(() => this.prompt.set(''), 2000);
      this.clearInput();
    }
  }

  pressEsc(): void {
    if (this.dropdownOpen()) {
      this.dropdownOpen.set(false);
      return;
    }
    this.clearInput();
    this.prompt.set('');
    this.toolMgr.setTool('select');
  }

  activate(t: ToolMeta): void {
    if (t.stub) return;

    // Try executing as a system action first
    if (!this.cmdRegistry.execute(t.id)) {
      // If not a system action, it must be a canvas tool
      this.toolMgr.setTool(t.id);
    }
    
    this.prompt.set('');
    this.clearInput();
  }

  private clearInput(): void {
    if (this.inputRef) this.inputRef.nativeElement.value = '';
    this.query.set('');
    this.matches.set([]);
    this.dropdownOpen.set(false);
    this.highlightIndex.set(0);
  }
}
