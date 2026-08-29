import { Injectable, signal } from '@angular/core';

/** Which face the drawing browser shows when it opens. */
export type DrawingBrowserMode = 'open' | 'save';

/**
 * Open/close state for the drawing browser dialog.
 *
 * Mirrors the pattern used by `FindDialogService` / `PlotDialogService` so the
 * host template can lazily mount the dialog with `@defer (when svc.isOpen())`.
 */
@Injectable({ providedIn: 'root' })
export class DrawingBrowserService {
  readonly isOpen = signal(false);
  readonly mode = signal<DrawingBrowserMode>('open');

  open(mode: DrawingBrowserMode = 'open'): void {
    this.mode.set(mode);
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }
}
