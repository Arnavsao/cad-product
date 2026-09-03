import { computed, signal } from '@angular/core';

/** Anything with an id can be selected. */
export interface Identified {
  id: string;
}

/**
 * Checkbox selection for one list of rows.
 *
 * Design decisions:
 *
 * - **A plain class holding signals, not an injectable.** Two pages (My
 *   Drawings and Trash) need the same behaviour over completely different rows,
 *   and a page may want more than one selection later; `new RowSelection()` is
 *   free of DI and disposes with its owner.
 *
 * - **The row order is passed in, not stored.** Shift-click ranges and
 *   select-all are defined against *what is on screen right now* — which, with
 *   sorting, paging and search, only the page knows. Keeping a copy here would
 *   be a second source of truth that goes stale on the next reload.
 *
 * - **Ids are kept, rows are not.** Reloading a page produces new objects for
 *   the same rows; holding ids means a refresh does not silently lose the
 *   selection, while `retain()` drops the ids that genuinely went away.
 */
export class RowSelection {
  private readonly ids = signal<ReadonlySet<string>>(new Set<string>());

  /** How many rows are selected. */
  readonly count = computed(() => this.ids().size);
  /** True when at least one row is selected. */
  readonly any = computed(() => this.ids().size > 0);

  /** Index of the last row clicked, so shift-click has an anchor. */
  private anchor: string | null = null;

  has(id: string): boolean {
    return this.ids().has(id);
  }

  /** The selected members of `rows`, in the order `rows` are in. */
  selected<T extends Identified>(rows: readonly T[]): T[] {
    const ids = this.ids();
    return rows.filter((row) => ids.has(row.id));
  }

  /**
   * Tick or untick one row. With `shift`, everything between the anchor and
   * this row takes the new state — the standard file-list gesture.
   */
  toggle<T extends Identified>(rows: readonly T[], id: string, on: boolean, shift = false): void {
    const next = new Set(this.ids());
    const from = shift && this.anchor ? rows.findIndex((r) => r.id === this.anchor) : -1;
    const to = rows.findIndex((r) => r.id === id);

    if (from >= 0 && to >= 0) {
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      for (let i = lo; i <= hi; i++) {
        if (on) next.add(rows[i].id);
        else next.delete(rows[i].id);
      }
    } else if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }

    this.anchor = id;
    this.ids.set(next);
  }

  /** Select or clear every row on the page, leaving other pages' ids alone. */
  setAll<T extends Identified>(rows: readonly T[], on: boolean): void {
    const next = new Set(this.ids());
    for (const row of rows) {
      if (on) next.add(row.id);
      else next.delete(row.id);
    }
    this.anchor = null;
    this.ids.set(next);
  }

  /** True when every row on the page is selected (and there is at least one). */
  allOf<T extends Identified>(rows: readonly T[]): boolean {
    return rows.length > 0 && rows.every((row) => this.ids().has(row.id));
  }

  /** True when some — but not all — of the page is selected. */
  someOf<T extends Identified>(rows: readonly T[]): boolean {
    return rows.some((row) => this.ids().has(row.id));
  }

  /** Forget ids that are no longer in `rows` (after a reload or a delete). */
  retain<T extends Identified>(rows: readonly T[]): void {
    const live = new Set(rows.map((row) => row.id));
    const next = new Set([...this.ids()].filter((id) => live.has(id)));
    if (next.size !== this.ids().size) this.ids.set(next);
  }

  clear(): void {
    this.anchor = null;
    if (this.ids().size) this.ids.set(new Set<string>());
  }
}
