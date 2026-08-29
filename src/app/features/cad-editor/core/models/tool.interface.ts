import type { IPoint } from './entity.model';

/** One editable field in the dynamic-input overlay (DOM input). */
export interface IDynamicField {
  /** Stable key, e.g. 'length', 'angle', 'width', 'dx'. */
  key: string;
  /** Display label, e.g. "Length". */
  label: string;
  /** Optional unit suffix, e.g. "°" or "mm". */
  suffix?: string;
  /** Current live value derived from cursor (used when this field is NOT being edited). */
  liveValue: string;
  /** Read-only fields show the live value but cannot be edited. */
  readonly?: boolean;
  /** Optional pixel width for the input. */
  width?: number;
}

/** State returned by a tool to drive the dynamic-input overlay. */
export interface IDynamicInputState {
  /** World coords anchoring the overlay (rendered offset from this point's screen pos). */
  wx: number;
  wy: number;
  /** Fields to render, in order. Tab cycles through them. */
  fields: IDynamicField[];
  /** Key of the field auto-focused when user types a printable char. */
  primaryFieldKey?: string;
}

export interface ITool {
  activate?(): void;
  deactivate?(): void;
  onMouseDown?(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void;
  onMouseMove?(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void;
  onMouseUp?(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  onKeyUp?(e: KeyboardEvent): void;
  drawPreview?(ctx: CanvasRenderingContext2D): void;
  /** Anchor point used by ortho mode + dynamic input. */
  getAnchor?(): IPoint | null;
  /**
   * Return multi-field state for the editable dynamic-input overlay, or null when no fields apply.
   * The overlay shows a real DOM input per field; tools opt in by implementing this.
   */
  getDynamicInputState?(): IDynamicInputState | null;
  /**
   * Commit user-entered field values. Receives a map of field key → raw text the user typed.
   * Returns true on successful commit (tool should advance/place geometry).
   * Tools should pre-parse using the shared expression parser.
   */
  commitDynamicInput?(values: Record<string, string>): boolean;
  /** Optional tool name for UI highlighting */
  readonly name?: string;
  /**
   * Optional cursor hint. Return a string key to request a specific cursor
   * when this tool is active. Known keys:
   * - `'pickbox'` — AutoCAD-style crosshair + square pickbox (fillet, trim, extend, etc.)
   * - `'crosshair'` — default drawing crosshair
   * - `'grab'` / `'grabbing'` — pan tool
   * - `'move'` / `'rotate'` / `'scale'` — future modify cursors
   * The canvas component maps these keys to CSS cursor values.
   */
  getCursor?(): string;

  /**
   * Optional status bar text that describes the current tool state.
   * This is displayed in the status bar to provide user feedback.
   * Example: "TRIM - Hold Shift for temporary EXTEND mode"
   */
  getStatusText?(): string;

  /**
   * Return the current workflow phase ID so the CommandPromptService can look
   * up the correct message and options from COMMAND_PROMPTS.
   * Return null when the tool has just activated and no phase-specific
   * guidance is needed (the registry first-phase is used as the fallback).
   *
   * Example: LineTool returns 'first' before p1 is set, 'next' after.
   */
  getPhase?(): string | null;

  /**
   * Return the stable COMMAND_PROMPTS registry key for the tool's current
   * sub-mode.  When not implemented, syncCommandPrompt() falls back to the
   * activeToolName signal set at activation time.
   *
   * This lets a single tool instance switch modes at runtime (e.g. CircleTool
   * in '2p' mode returns 'circle_2p') so the command bar and DYN overlay
   * always show the right prompt and option chips without spawning a new tool.
   *
   * Example: CircleTool with mode='diameter' returns 'circle_dia'.
   */
  getCommandId?(): string;

  /**
   * Handle a command option invoked by key (e.g. 'U' for Undo, 'C' for Close,
   * 'R' for Radius).  Called by CommandPromptService.invokeOptionByKey() when
   * the user types a letter that matches an active option chip.
   * Returns true when the option was recognised and handled (prevents the key
   * from falling through to Dynamic Input or the Command Bar).
   */
  invokeOption?(key: string): boolean;
}
