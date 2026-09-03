import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DrawingSort } from '../../../core/api/api.models';
import { UiIconComponent } from '../../../shared/ui/icon.component';

/**
 * Column header for the drawings table.
 *
 * Design decisions:
 *
 * - **It shares `--dw-cols` with the rows** (see `DrawingRowComponent`), so the
 *   header and every row are laid out by one grid template and the columns line
 *   up by construction instead of by two sets of matching widths. The select-all
 *   box is the first of those columns for the same reason.
 *
 * - **Select-all is tri-state.** `indeterminate` is a DOM property with no
 *   attribute, so it is bound with `[indeterminate]` rather than `[attr.…]`;
 *   without it, "some of this page" would look identical to "none".
 *
 * - **Only the three server-sortable columns are buttons.** `sort=updated|name|
 *   opened` is what the API offers; making Owner or Shared look clickable would
 *   promise an ordering the endpoint cannot deliver.
 *
 * - **Sticky, so the columns stay identifiable** once a 100-row page is
 *   scrolled — the whole point of having headers at all.
 */
@Component({
  selector: 'app-drawings-table-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIconComponent],
  template: `
    <div class="th" role="row">
      <span class="th__cell th__cell--pick" role="columnheader">
        @if (selectable()) {
          <input
            type="checkbox"
            class="th__check"
            aria-label="Select all drawings on this page"
            [checked]="allSelected()"
            [indeterminate]="someSelected() && !allSelected()"
            (change)="allChange.emit(!allSelected())"
          />
        } @else {
          <span class="ui-visually-hidden">Select</span>
        }
      </span>

      <span class="th__cell th__cell--type" role="columnheader">File Type</span>

      <span class="th__cell th__cell--name" role="columnheader" [attr.aria-sort]="ariaSort('name')">
        <button type="button" class="th__btn" (click)="sortChange.emit('name')">
          Name
          @if (sort() === 'name') {
            <ui-icon name="chevron-down" [size]="12" />
          }
        </button>
      </span>

      <span class="th__cell th__cell--modified" role="columnheader" [attr.aria-sort]="ariaSort('updated')">
        <button type="button" class="th__btn" (click)="sortChange.emit('updated')">
          Date Modified
          @if (sort() === 'updated') {
            <ui-icon name="chevron-down" [size]="12" />
          }
        </button>
      </span>

      <span class="th__cell th__cell--size" role="columnheader">Size</span>
      <span class="th__cell th__cell--owner" role="columnheader">Owner</span>
      <span class="th__cell th__cell--shared" role="columnheader">Shared</span>
      <span class="th__cell th__cell--menu" role="columnheader"><span class="ui-visually-hidden">Actions</span></span>
    </div>
  `,
  styles: [
    `
      :host { display: block; position: sticky; top: 0; z-index: 2; }

      .th {
        display: grid;
        grid-template-columns: var(--dw-cols, 36px 78px minmax(180px, 1fr) 150px 96px 160px 170px 44px);
        align-items: center;
        gap: var(--ui-space-2);
        padding: 0 var(--ui-space-2);
        background: var(--ui-surface-raised);
        border-bottom: 1px solid var(--ui-border);
      }

      .th__cell {
        min-width: 0;
        padding: 8px 6px;
        font-size: var(--ui-text-xs);
        font-weight: 600;
        letter-spacing: .04em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      .th__btn {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 0; font: inherit; letter-spacing: inherit; text-transform: inherit;
        color: inherit; background: transparent; border: 0; cursor: pointer;
      }
      .th__btn:hover { color: var(--ui-text-strong); }
      .th__btn:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: var(--ui-radius-sm); }

      /* Mirrors the row's alignment so the header sits over its own column. */
      .th__cell--size { text-align: right; }
      .th__cell--menu { padding-right: 0; }
      .th__cell--pick { display: flex; justify-content: center; padding-left: 0; padding-right: 0; }
      .th__check { width: 15px; height: 15px; margin: 0; accent-color: var(--ui-accent); cursor: pointer; }

      /* Must match DrawingRowComponent exactly, or the header shifts off its
         columns at these widths. */
      @media (max-width: 1100px) { .th__cell--shared { display: none; } }
      @media (max-width: 900px) { .th__cell--owner { display: none; } }
      @media (max-width: 720px) { .th__cell--size { display: none; } }
      @media (max-width: 560px) { .th__cell--modified { display: none; } }
    `,
  ],
})
export class DrawingsTableHeaderComponent {
  readonly sort = input.required<DrawingSort>();
  readonly sortChange = output<DrawingSort>();

  /** Render the select-all box (the column is always there, for alignment). */
  readonly selectable = input(true);
  /** Every row on this page is selected. */
  readonly allSelected = input(false);
  /** At least one row on this page is selected. */
  readonly someSelected = input(false);
  /** Fires with the state the user asked for. */
  readonly allChange = output<boolean>();

  /** `aria-sort` for a column, so the current ordering is announced. */
  protected ariaSort(column: DrawingSort): 'descending' | 'ascending' | 'none' {
    if (this.sort() !== column) return 'none';
    // `name` is the only ascending sort the API offers; the date sorts are newest-first.
    return column === 'name' ? 'ascending' : 'descending';
  }
}
