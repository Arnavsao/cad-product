import { InjectionToken } from '@angular/core';
import type { OverlayRef } from '@angular/cdk/overlay';
import type { UiButtonVariant } from '../button.directive';

/** Injected into dialog components opened via `UiDialogService.open(component, data)`. */
export const UI_DIALOG_DATA = new InjectionToken<unknown>('UI_DIALOG_DATA');

/** One button in the generic confirm/choose dialog. */
export interface UiDialogAction {
  id: string;
  label: string;
  variant?: UiButtonVariant;
}

/** Payload of the built-in `UiDialogComponent`. */
export interface UiDialogData {
  title: string;
  message: string;
  actions: UiDialogAction[];
  /** Focus the first (cancel) action instead of the last one; used for destructive confirms. */
  danger?: boolean;
}

/**
 * Handle to an open dialog. Inject it inside the dialog component to close
 * with a result; await `afterClosed` from the opener. Closing is idempotent.
 */
export class UiDialogRef<R = unknown> {
  private resolveClosed!: (result: R | undefined) => void;
  private closed = false;

  /** Resolves with the result passed to `close()`, or `undefined` on dismiss (Esc / backdrop). */
  readonly afterClosed: Promise<R | undefined> = new Promise<R | undefined>((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(private readonly overlayRef: OverlayRef) {}

  close(result?: R): void {
    if (this.closed) return;
    this.closed = true;
    this.overlayRef.dispose();
    this.resolveClosed(result);
  }
}
