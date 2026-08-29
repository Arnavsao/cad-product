import { Injectable, signal } from '@angular/core';

/**
 * Signal-based open/close service for the Layout Manager dialog.
 * Follows the same pattern as PlotDialogService.
 */
@Injectable({ providedIn: 'root' })
export class LayoutManagerDialogService {
  readonly isOpen = signal(false);

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }
}
