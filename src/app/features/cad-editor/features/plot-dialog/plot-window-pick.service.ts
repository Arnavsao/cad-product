import { Injectable, signal } from '@angular/core';

/**
 * Coordinates the "Pick Window" interaction for the Plot dialog.
 *
 * When the user clicks "Pick Window" in the Plot dialog:
 *   1. The dialog calls `startPicking(callback)`.
 *   2. The dialog closes; `isPicking` becomes true.
 *   3. The canvas routes mouse events to `PlotWindowTool` (registered via
 *      ToolManagerService).
 *   4. When the user finishes drawing the rectangle the tool calls `resolve()`
 *      with the world-space bounds.
 *   5. The Plot dialog re-opens with `area='window'` and the picked bounds set.
 *
 * The dialog itself reads `isPicking` to suppress re-rendering while picking.
 */
@Injectable({ providedIn: 'root' })
export class PlotWindowPickService {
  /** True while the canvas is waiting for the user to pick two corners. */
  readonly isPicking = signal(false);

  private callback: ((bounds: { minX: number; minY: number; maxX: number; maxY: number } | null) => void) | null = null;

  /**
   * Called by the Plot dialog. Puts the service in picking mode and stores
   * the callback that will be invoked once the user finishes (or cancels).
   */
  startPicking(
    onDone: (bounds: { minX: number; minY: number; maxX: number; maxY: number } | null) => void,
  ): void {
    this.callback = onDone;
    this.isPicking.set(true);
  }

  /**
   * Called by `PlotWindowTool` when the user completes a window selection.
   * Pass `null` to signal cancellation (Esc pressed).
   */
  resolve(bounds: { minX: number; minY: number; maxX: number; maxY: number } | null): void {
    this.isPicking.set(false);
    const cb = this.callback;
    this.callback = null;
    cb?.(bounds);
  }
}
