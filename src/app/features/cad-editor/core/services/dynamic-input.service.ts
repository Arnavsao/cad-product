import { Injectable, computed, signal } from '@angular/core';
import { IDynamicInputState } from '../models/tool.interface';

/**
 * Owns the editable Dynamic-Input overlay state:
 * - Which tool field (if any) is currently being edited.
 * - The map of user-typed text per field key.
 * - Cursor screen position (for overlay placement).
 *
 * Two independent DI states co-exist:
 *  • `state`      — coordinate fields pushed by the active tool every frame.
 *  • `_optState`  — lightweight keyword/option input created when the user
 *                   types a letter while a tool is active but has no coordinate
 *                   fields (e.g. XLINE 'first' phase).  NOT cleared by the
 *                   render-loop's setState(null) call; only cleared explicitly
 *                   after the option fires or the user cancels.
 *
 * `effectiveState` = tool DI when present, option input otherwise.
 * `visible`        = true when either state has displayable fields.
 */
@Injectable({ providedIn: 'root' })
export class DynamicInputService {
  readonly state    = signal<IDynamicInputState | null>(null);
  private readonly _optState = signal<IDynamicInputState | null>(null);

  readonly activeFieldKey = signal<string | null>(null);
  readonly editedValues   = signal<Record<string, string>>({});
  readonly cursorSx = signal(0);
  readonly cursorSy = signal(0);

  // ─── Dynamic Input on/off toggle (F12 / DYN button) ─────────────────────

  /** Whether the near-cursor Dynamic Input overlay is enabled (default ON). */
  readonly dynEnabled = signal(true);

  toggleDyn(): void { this.dynEnabled.update(v => !v); }

  // ─── Tool-active flag (set by canvas render loop) ──────────────────────

  /**
   * Set to true by the canvas render loop whenever a real drawing/modify tool
   * is active (i.e. not 'select' or 'pan').  The DYN overlay uses this to
   * stay visible with command guidance even when there are no coordinate fields.
   */
  private readonly _toolActive = signal(false);
  readonly toolActive = this._toolActive.asReadonly();

  setToolActive(active: boolean): void { this._toolActive.set(active); }

  /**
   * True when the DYN overlay should be rendered.
   * = dynEnabled AND (coordinate fields present OR tool is active OR search mode).
   * The overlay component also tracks its own 'search active' flag for idle mode.
   */
  readonly dynVisible = computed(() =>
    this.dynEnabled() && (this.visible() || this._toolActive())
  );

  /** True when the option-entry input is active (no tool coordinate DI). */
  readonly optInputActive = computed(() => !!this._optState() && !this.state());

  /**
   * The state the overlay renders — tool coordinate DI takes priority over the
   * option-entry bubble.
   */
  readonly effectiveState = computed<IDynamicInputState | null>(
    () => this.state() ?? this._optState(),
  );

  readonly visible = computed(() => {
    const s = this.effectiveState();
    return !!s && s.fields.length > 0;
  });

  // ─── Tool coordinate DI (pushed every frame by the render loop) ─────────────

  /**
   * Called by the canvas render loop every frame with the active tool's DI
   * state (or null).  When a tool starts publishing coordinate fields the
   * option-entry bubble is automatically dismissed.
   */
  setState(s: IDynamicInputState | null): void {
    // Guard: skip if structurally identical to avoid spurious Angular CD on every RAF frame.
    // Signal equality only checks references; tools return new objects each frame.
    const cur = this.state();
    if (s === null && cur === null && !this._optState()) return;
    if (s !== null && cur !== null
        && s.wx === cur.wx && s.wy === cur.wy
        && s.primaryFieldKey === cur.primaryFieldKey
        && s.fields.length === cur.fields.length
        && s.fields.every((f, i) => f.key === cur.fields[i].key && f.liveValue === cur.fields[i].liveValue)) {
      return;
    }
    this.state.set(s);
    if (s) {
      // Real coordinate DI → dismiss option-entry bubble and its edits
      if (this._optState()) {
        this._optState.set(null);
        this.editedValues.update(ev => { const n = { ...ev }; delete n['_opt']; return n; });
      }
    }
    if (!s && !this._optState()) {
      // Nothing visible at all — drop stale edits
      this.activeFieldKey.set(null);
      this.editedValues.set({});
    }
  }

  // ─── Option-entry bubble ────────────────────────────────────────────────────

  /**
   * Show a small single-field input near the cursor for keyword/option entry.
   * Used when the user starts typing a letter while a tool is active but has
   * no coordinate DI fields (e.g. XLINE 'first' phase).
   */
  showOptionInput(prompt: string): void {
    this._optState.set({
      wx: 0, wy: 0,
      primaryFieldKey: '_opt',
      fields: [{ key: '_opt', label: prompt || 'Enter option', liveValue: '', width: 120 }],
    });
    this.setActiveField('_opt');
  }

  /** Dismiss the option-entry bubble and clear its typed text. */
  clearOptionInput(): void {
    this._optState.set(null);
    this.editedValues.update(ev => { const n = { ...ev }; delete n['_opt']; return n; });
    if (this.activeFieldKey() === '_opt') this.activeFieldKey.set(null);
  }

  // ─── Shared field helpers ───────────────────────────────────────────────────

  setCursor(sx: number, sy: number): void {
    this.cursorSx.set(sx);
    this.cursorSy.set(sy);
  }

  setActiveField(key: string | null): void {
    this.activeFieldKey.set(key);
  }

  setFieldText(key: string, text: string): void {
    this.editedValues.update(ev => ({ ...ev, [key]: text }));
  }

  /** Returns the displayed text for a field: edited value if user typed, else live value. */
  effectiveText(key: string, liveValue: string): string {
    const edited = this.editedValues()[key];
    return edited !== undefined ? edited : liveValue;
  }

  hasEdit(key: string): boolean {
    return this.editedValues()[key] !== undefined;
  }

  /**
   * Snapshot of values for the active (effective) state to send to the tool's
   * commit handler.  Falls back to liveValue when the user hasn't typed.
   */
  collectCommitValues(): Record<string, string> {
    const s = this.effectiveState();
    if (!s) return {};
    const edits = this.editedValues();
    const out: Record<string, string> = {};
    for (const f of s.fields) {
      out[f.key] = edits[f.key] !== undefined ? edits[f.key] : f.liveValue;
    }
    return out;
  }

  /** Drop user edits without changing the visible state. */
  clearEdits(): void {
    this.editedValues.set({});
    this.activeFieldKey.set(null);
  }

  /** Overlay registers its focus-primary callback so external keyboard routing can invoke it. */
  focusPrimaryRequest: ((seedChar?: string) => boolean) | null = null;

  /** Convenience wrapper for external callers. Returns true if focus took. */
  focusPrimaryField(seedChar?: string): boolean {
    return this.focusPrimaryRequest?.(seedChar) ?? false;
  }

  /**
   * Callback registered by the DYN overlay component to open the idle command
   * search box at the cursor position.  Called by the global keydown handler
   * when DYN is enabled and no tool is active, routing canvas keystrokes to
   * the near-cursor search instead of the bottom command bar.
   */
  activateDynSearchRequest: ((char: string) => void) | null = null;

  /** Trigger the near-cursor command search with an initial character. */
  activateDynSearch(char: string): void {
    this.activateDynSearchRequest?.(char);
  }
}
