import { Injectable, signal } from '@angular/core';

/**
 * Signal-based open/close service for the Page Setup dialog.
 * Follows the same pattern as PlotDialogService.
 */
@Injectable({ providedIn: 'root' })
export class PageSetupDialogService {
  readonly isOpen = signal(false);
  /** The layout ID that the dialog is configuring when opened. */
  readonly targetLayoutId = signal<string | null>(null);

  open(layoutId: string): void {
    this.targetLayoutId.set(layoutId);
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
    this.targetLayoutId.set(null);
  }
}
