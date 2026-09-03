import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent, UiIconName } from '../../../shared/ui/icon.component';

/** One button in the bulk bar. */
export interface BulkBarAction {
  id: string;
  label: string;
  icon?: UiIconName;
  danger?: boolean;
}

/**
 * "7 selected · Move to… · Copy to… · Download · Delete · Clear".
 *
 * Design decisions:
 *
 * - **Sticky above the list, not a floating island.** It has to stay reachable
 *   while the user scrolls a 100-row page, and anchoring it to the top of the
 *   list keeps it next to the checkboxes it belongs to instead of covering the
 *   rows at the bottom of the viewport.
 *
 * - **The actions are passed in.** My Drawings offers Move / Copy / Download /
 *   Delete; Trash offers Restore / Delete permanently. Both are the same bar
 *   with a different array, which is one component and one set of styles rather
 *   than two that drift.
 *
 * - **`role="status"`** so the count is announced when it changes: selecting
 *   with the keyboard otherwise gives no feedback at all.
 */
@Component({
  selector: 'app-bulk-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiIconComponent],
  template: `
    <div class="bb" role="status">
      <span class="bb__count">{{ count() }} selected</span>
      @for (item of actions(); track item.id) {
        <button
          type="button"
          uiButton
          size="sm"
          [variant]="item.danger ? 'danger' : 'secondary'"
          [disabled]="busy()"
          (click)="action.emit(item.id)"
        >
          @if (item.icon; as icon) {
            <ui-icon [name]="icon" [size]="14" />
          }
          {{ item.label }}
        </button>
      }
      <button type="button" uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="clear.emit()">Clear</button>
    </div>
  `,
  styles: [
    `
      :host { display: block; position: sticky; top: 0; z-index: 3; }
      .bb {
        display: flex; align-items: center; gap: var(--ui-space-2); flex-wrap: wrap;
        margin-bottom: var(--ui-space-3);
        padding: 8px 12px;
        border: 1px solid var(--ui-accent); border-radius: var(--ui-radius-lg);
        background: var(--ui-surface-raised);
        box-shadow: var(--ui-shadow-panel);
      }
      .bb__count {
        margin-right: var(--ui-space-2);
        font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong);
      }
    `,
  ],
})
export class BulkBarComponent {
  readonly count = input.required<number>();
  readonly actions = input.required<BulkBarAction[]>();
  /** Disables every button while a batch is running. */
  readonly busy = input(false);

  readonly action = output<string>();
  readonly clear = output<void>();
}
