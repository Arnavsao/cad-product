import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { UiIconComponent } from './icon.component';

/** Page sizes offered in the picker. */
export const PAGE_SIZES = [25, 50, 100] as const;

/** How many numbered buttons to show around the current page. */
const WINDOW = 1;

/** `'…'` marks an elided run of pages; numbers are 1-based page numbers. */
type PageSlot = number | 'gap';

/**
 * Numbered pager: `1–25 of 137`, a page-size picker, and first / prev /
 * numbers / next / last.
 *
 * Design decisions:
 *
 * - **Numbered, not "load more".** A file table is something people scan and
 *   jump around in — "page 4 of 6" and a total are the point. Feed-shaped
 *   lists (the notification inbox) keep their cursor-based "Load more".
 *
 * - **A fixed-width page window.** Always first page, last page, and the
 *   current page ±1, with `…` for the gaps. The control therefore never
 *   changes width as you page through, so the buttons stay under the cursor
 *   instead of sliding away between clicks.
 *
 * - **Renders nothing when there is one page.** An empty or single-page list
 *   should not grow a row of chrome that can only say "1 of 1".
 */
@Component({
  selector: 'ui-paginator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIconComponent],
  template: `
    @if (total() > 0) {
      <nav class="pg" [attr.aria-label]="label()">
        <p class="pg__count" aria-live="polite">
          <span class="pg__range">{{ firstRow() }}–{{ lastRow() }}</span>
          of {{ total() }} {{ total() === 1 ? noun() : nounPlural() }}
        </p>

        <div class="pg__spacer"></div>

        @if (showPageSize()) {
          <label class="pg__size">
            <span class="pg__size-label">Per page</span>
            <select
              class="pg__select"
              [value]="pageSize()"
              [disabled]="disabled()"
              (change)="onPageSize($event)"
            >
              @for (size of sizes; track size) {
                <option [value]="size">{{ size }}</option>
              }
            </select>
          </label>
        }

        @if (lastPage() > 1) {
          <div class="pg__pages">
            <button
              type="button"
              class="pg__btn pg__btn--icon"
              aria-label="First page"
              [disabled]="disabled() || page() === 1"
              (click)="go(1)"
            >
              <ui-icon name="chevrons-left" [size]="14" />
            </button>
            <button
              type="button"
              class="pg__btn pg__btn--icon"
              aria-label="Previous page"
              [disabled]="disabled() || page() === 1"
              (click)="go(page() - 1)"
            >
              <ui-icon name="chevron-left" [size]="14" />
            </button>

            @for (slot of slots(); track $index) {
              @if (slot === 'gap') {
                <span class="pg__gap" aria-hidden="true">…</span>
              } @else {
                <button
                  type="button"
                  class="pg__btn pg__btn--num"
                  [class.pg__btn--active]="slot === page()"
                  [attr.aria-label]="'Page ' + slot"
                  [attr.aria-current]="slot === page() ? 'page' : null"
                  [disabled]="disabled()"
                  (click)="go(slot)"
                >
                  {{ slot }}
                </button>
              }
            }

            <button
              type="button"
              class="pg__btn pg__btn--icon"
              aria-label="Next page"
              [disabled]="disabled() || page() >= lastPage()"
              (click)="go(page() + 1)"
            >
              <ui-icon name="chevron-right" [size]="14" />
            </button>
            <button
              type="button"
              class="pg__btn pg__btn--icon"
              aria-label="Last page"
              [disabled]="disabled() || page() >= lastPage()"
              (click)="go(lastPage())"
            >
              <ui-icon name="chevrons-right" [size]="14" />
            </button>
          </div>
        }
      </nav>
    }
  `,
  styles: [
    `
      :host { display: block; }

      .pg {
        display: flex; align-items: center; gap: var(--ui-space-4);
        flex-wrap: wrap;
        padding: var(--ui-space-3) 0 0;
        border-top: 1px solid var(--ui-border);
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
      }
      .pg__spacer { flex: 1 1 auto; }
      .pg__count { margin: 0; white-space: nowrap; }
      .pg__range { color: var(--ui-text-strong); font-variant-numeric: tabular-nums; }

      .pg__size { display: inline-flex; align-items: center; gap: var(--ui-space-2); }
      .pg__size-label { white-space: nowrap; }
      .pg__select {
        appearance: auto;
        padding: 4px 6px;
        font: inherit; color: var(--ui-text);
        background: var(--ui-surface); border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-sm);
        cursor: pointer;
      }
      .pg__select:disabled { opacity: .5; cursor: default; }

      .pg__pages { display: flex; align-items: center; gap: 2px; }

      .pg__btn {
        display: inline-grid; place-items: center;
        min-width: 28px; height: 28px; padding: 0 6px;
        font: inherit; font-variant-numeric: tabular-nums;
        color: var(--ui-text); background: transparent;
        border: 1px solid transparent; border-radius: var(--ui-radius-sm);
        cursor: pointer;
        transition: background var(--ui-dur-fast), border-color var(--ui-dur-fast), color var(--ui-dur-fast);
      }
      .pg__btn:hover:not(:disabled) { background: var(--ui-hover); color: var(--ui-text-strong); }
      .pg__btn:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
      .pg__btn:disabled { opacity: .4; cursor: default; }

      .pg__btn--active,
      .pg__btn--active:hover:not(:disabled) {
        color: var(--ui-text-strong);
        background: var(--ui-accent-tint);
        border-color: var(--ui-accent);
      }

      .pg__gap { min-width: 20px; text-align: center; user-select: none; }

      /* Narrow: the count and the controls stack rather than wrap mid-control. */
      @media (max-width: 640px) {
        .pg { gap: var(--ui-space-2); }
        .pg__size-label { display: none; }
      }
    `,
  ],
})
export class UiPaginatorComponent {
  /** Total rows matching the filter, across all pages. */
  readonly total = input.required<number>();
  /** Current 1-based page. */
  readonly page = input.required<number>();
  readonly pageSize = input<number>(PAGE_SIZES[0]);
  /** Set while a page is loading, to stop double-clicks queuing requests. */
  readonly disabled = input(false);
  /** Hide the per-page picker where a fixed size is wanted. */
  readonly showPageSize = input(true);
  /** Singular noun for the count, e.g. `drawing`. */
  readonly noun = input('item');
  /** Plural, when it is not simply `noun + "s"`. */
  readonly nounPluralInput = input<string | null>(null, { alias: 'nounPlural' });
  readonly label = input('Pagination');

  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  protected readonly sizes = PAGE_SIZES;

  protected readonly nounPlural = computed(() => this.nounPluralInput() ?? `${this.noun()}s`);
  protected readonly lastPage = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly firstRow = computed(() => (this.page() - 1) * this.pageSize() + 1);
  protected readonly lastRow = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  /** First, last, and the current page ±`WINDOW`, with `'gap'` between runs. */
  protected readonly slots = computed<PageSlot[]>(() => {
    const last = this.lastPage();
    const current = Math.min(Math.max(this.page(), 1), last);

    const wanted = new Set<number>([1, last]);
    for (let p = current - WINDOW; p <= current + WINDOW; p++) {
      if (p >= 1 && p <= last) {
        wanted.add(p);
      }
    }

    const out: PageSlot[] = [];
    let previous = 0;
    for (const p of [...wanted].sort((a, b) => a - b)) {
      // A single skipped page is rendered as that page, not as an ellipsis —
      // "1 … 3" would be wider than "1 2 3" and hide a reachable page.
      if (previous && p - previous === 2) {
        out.push(previous + 1);
      } else if (previous && p - previous > 2) {
        out.push('gap');
      }
      out.push(p);
      previous = p;
    }
    return out;
  });

  protected go(page: number): void {
    const clamped = Math.min(Math.max(page, 1), this.lastPage());
    if (clamped !== this.page()) {
      this.pageChange.emit(clamped);
    }
  }

  protected onPageSize(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (Number.isFinite(value) && value !== this.pageSize()) {
      this.pageSizeChange.emit(value);
    }
  }
}
