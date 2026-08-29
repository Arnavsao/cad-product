import { Injectable, signal } from '@angular/core';

/** Which face the drawing browser shows when it opens. */
export type DrawingBrowserMode = 'open' | 'save';

/**
 * Open/close state for the drawing browser dialog.
 *
 * Mirrors the pattern used by `FindDialogService` / `PlotDialogService` so the
 * host template can lazily mount the dialog with `@defer (when svc.isOpen())`.
 *
 * `openAndWait()` additionally resolves with the outcome, which is what lets
 * the tab-close prompt route an unbound drawing through Save As and only close
 * the tab once the drawing actually reached the cloud.
 */
@Injectable({ providedIn: 'root' })
export class DrawingBrowserService {
  readonly isOpen = signal(false);
  readonly mode = signal<DrawingBrowserMode>('open');

  /** Resolver of the in-flight `openAndWait()`, if any. */
  private pending: ((saved: boolean) => void) | null = null;

  open(mode: DrawingBrowserMode = 'open'): void {
    this.settle(false); // a re-open supersedes any earlier await
    this.mode.set(mode);
    this.isOpen.set(true);
  }

  /** Open the dialog and resolve true only if it closed after a successful save. */
  openAndWait(mode: DrawingBrowserMode = 'save'): Promise<boolean> {
    this.open(mode);
    return new Promise<boolean>((resolve) => {
      this.pending = resolve;
    });
  }

  /** @param saved true when the dialog is closing because a save succeeded. */
  close(saved = false): void {
    this.isOpen.set(false);
    this.settle(saved);
  }

  private settle(saved: boolean): void {
    const resolve = this.pending;
    this.pending = null;
    resolve?.(saved);
  }
}
