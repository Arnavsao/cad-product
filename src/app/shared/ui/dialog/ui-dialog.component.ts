import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { UiButtonDirective } from '../button.directive';
import { UiIconComponent } from '../icon.component';
import { UI_DIALOG_DATA, UiDialogData, UiDialogRef } from './ui-dialog-ref';

let seq = 0;

/**
 * Generic modal used by `UiDialogService.confirm()` / `choose()`: a title, a
 * message and a row of actions. Closes with the chosen action's `id`, or
 * `undefined` when dismissed. Focus is trapped (CDK) and restored on close;
 * the initial focus lands on the primary action, or on the first (cancel)
 * action when `danger` is set so Enter never destroys anything by accident.
 *
 * The `.ui-dialog*` classes are global (shared/ui/ui.scss) so custom dialog
 * components opened with `UiDialogService.open()` can reuse the same chrome.
 */
@Component({
  selector: 'ui-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, UiButtonDirective, UiIconComponent],
  template: `
    <div
      class="ui-dialog"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="descId"
      cdkTrapFocus
      cdkTrapFocusAutoCapture
    >
      <header class="ui-dialog__header">
        <h2 [id]="titleId">{{ data.title }}</h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly aria-label="Close" (click)="ref.close()">
          <ui-icon name="close" />
        </button>
      </header>
      <div class="ui-dialog__body" [id]="descId">{{ data.message }}</div>
      <footer class="ui-dialog__footer">
        @for (a of data.actions; track a.id; let i = $index) {
          @if (i === focusIndex) {
            <button type="button" uiButton [variant]="a.variant ?? 'secondary'" cdkFocusInitial (click)="ref.close(a.id)">
              {{ a.label }}
            </button>
          } @else {
            <button type="button" uiButton [variant]="a.variant ?? 'secondary'" (click)="ref.close(a.id)">
              {{ a.label }}
            </button>
          }
        }
      </footer>
    </div>
  `,
})
export class UiDialogComponent {
  protected readonly data = inject(UI_DIALOG_DATA) as UiDialogData;
  protected readonly ref = inject(UiDialogRef) as UiDialogRef<string>;
  protected readonly titleId = `ui-dialog-title-${++seq}`;
  protected readonly descId = `ui-dialog-desc-${seq}`;
  protected readonly focusIndex = this.data.danger ? 0 : Math.max(0, this.data.actions.length - 1);
}
