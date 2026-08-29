import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Injectable, Injector, Type, inject } from '@angular/core';
import { UiDialogComponent } from './ui-dialog.component';
import { UI_DIALOG_DATA, UiDialogAction, UiDialogData, UiDialogRef } from './ui-dialog-ref';

export interface UiConfirmOptions {
  title: string;
  message: string;
  /** Default "Confirm". */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Red confirm button and initial focus on Cancel. */
  danger?: boolean;
}

export interface UiChooseOptions {
  title: string;
  message: string;
  /** Rendered left→right after the cancel button; the last one is the primary. */
  actions: UiDialogAction[];
  /** Default "Cancel"; pass `null` to omit the cancel button. */
  cancelLabel?: string | null;
}

export interface UiDialogConfig {
  /** CSS width of the overlay pane (the `.ui-dialog` inside sizes itself by default). */
  width?: string;
  /** Ignore Esc and backdrop clicks — the dialog must close itself. */
  disableClose?: boolean;
}

/**
 * Promise-based modal dialogs on the CDK overlay.
 *
 * Promises instead of an `afterClosed()` Observable because every use is
 * "ask, await one answer, continue" — `if (!(await dialog.confirm(...))) return;`
 * reads naturally in the save/delete routines that need it. Esc and backdrop
 * click dismiss (result `undefined` → `false` / `null`), body scroll is
 * blocked, focus is trapped in the dialog and restored afterwards.
 *
 * `open<R>(component, data)` hosts any standalone component; inside it inject
 * `UiDialogRef<R>` to close and `UI_DIALOG_DATA` to read `data`.
 */
@Injectable({ providedIn: 'root' })
export class UiDialogService {
  private readonly overlay = inject(Overlay);
  private readonly injector = inject(Injector);

  /** Yes/No question. Resolves `true` only when the confirm action was chosen. */
  async confirm(opts: UiConfirmOptions): Promise<boolean> {
    const data: UiDialogData = {
      title: opts.title,
      message: opts.message,
      danger: opts.danger,
      actions: [
        { id: 'cancel', label: opts.cancelLabel ?? 'Cancel', variant: 'secondary' },
        { id: 'confirm', label: opts.confirmLabel ?? 'Confirm', variant: opts.danger ? 'danger' : 'primary' },
      ],
    };
    const result = await this.open<string, UiDialogData>(UiDialogComponent, data).afterClosed;
    return result === 'confirm';
  }

  /** Multi-way question (e.g. Overwrite / Save as copy / Reload). Resolves the chosen `id`, or `null` on cancel/dismiss. */
  async choose(opts: UiChooseOptions): Promise<string | null> {
    const actions: UiDialogAction[] = [...opts.actions];
    if (opts.cancelLabel !== null) actions.unshift({ id: CANCEL_ID, label: opts.cancelLabel ?? 'Cancel', variant: 'secondary' });
    const data: UiDialogData = { title: opts.title, message: opts.message, actions };
    const result = await this.open<string, UiDialogData>(UiDialogComponent, data).afterClosed;
    return !result || result === CANCEL_ID ? null : result;
  }

  /** Open any standalone component as a modal. */
  open<R = unknown, D = unknown>(component: Type<unknown>, data?: D, config: UiDialogConfig = {}): UiDialogRef<R> {
    const overlayRef = this.overlay.create({
      hasBackdrop: true,
      backdropClass: 'ui-backdrop',
      panelClass: 'ui-dialog-panel',
      width: config.width,
      maxWidth: '92vw',
      maxHeight: '90vh',
      scrollStrategy: this.overlay.scrollStrategies.block(),
      positionStrategy: this.overlay.position().global().centerHorizontally().centerVertically(),
    });
    const ref = new UiDialogRef<R>(overlayRef);
    const injector = Injector.create({
      parent: this.injector,
      providers: [
        { provide: UiDialogRef, useValue: ref },
        { provide: UI_DIALOG_DATA, useValue: data ?? null },
      ],
    });
    overlayRef.attach(new ComponentPortal(component, null, injector));

    if (!config.disableClose) {
      overlayRef.backdropClick().subscribe(() => ref.close());
      overlayRef.keydownEvents().subscribe((e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          ref.close();
        }
      });
    }
    return ref;
  }
}

const CANCEL_ID = '__cancel';
