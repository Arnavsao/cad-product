import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DrawingSummaryDto } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { WorkspaceService } from '../../../core/api/workspace.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { UiEmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiPaginatorComponent } from '../../../shared/ui/paginator.component';
import { FileSizePipe } from '../../../shared/ui/pipes/file-size.pipe';
import { RelativeTimePipe } from '../../../shared/ui/pipes/relative-time.pipe';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { BulkBarAction, BulkBarComponent } from '../components/bulk-bar.component';
import { DashboardEventsService } from '../data/dashboard-events.service';
import { PAGE_SIZES } from '../../../shared/ui/paginator.component';
import { messageOf } from '../data/drawings-list.store';
import { RowSelection } from '../data/row-selection';

/** Restore and permanent delete are the only two things a trashed row can do. */
const BULK_ACTIONS: readonly BulkBarAction[] = [
  { id: 'restore', label: 'Restore', icon: 'restore' },
  { id: 'delete', label: 'Delete permanently', icon: 'trash', danger: true },
];

/**
 * `/dashboard/trash` — soft-deleted drawings, with Restore, a guarded Delete
 * permanently, multi-select and Empty trash.
 *
 * Design decisions:
 *
 * - **Rows are plain and non-openable.** A trashed drawing has no meaningful
 *   "open" (the editor would bind to a row the API hides everywhere else), so
 *   the only affordances are the ones that can actually be honoured.
 *
 * - **Every destructive path goes through `confirm({ danger: true })`**, which
 *   focuses Cancel — Enter can never destroy anything here. Empty trash states
 *   the count it is about to delete, because that number is the whole decision.
 *
 * - **Empty trash is a workspace operation, not a loop over the page.** One
 *   `DELETE /drawings/trash` clears rows this page has never even fetched; doing
 *   it row by row would leave everything past page 1 behind.
 */
@Component({
  selector: 'app-trash-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'selection.clear()',
  },
  imports: [
    UiButtonDirective,
    UiEmptyStateComponent,
    UiIconComponent,
    UiPaginatorComponent,
    UiSkeletonComponent,
    RelativeTimePipe,
    FileSizePipe,
    BulkBarComponent,
  ],
  template: `
    <header class="pg__head">
      @if (query()) {
        <h1 class="pg__title">Results for "{{ query() }}" in Trash</h1>
      } @else {
        <h1 class="pg__title">Trash</h1>
      }
      <div class="tr__head-end">
        @if (items().length) {
          <p class="tr__note">Deleted drawings stay here until you remove them permanently.</p>
          <button type="button" uiButton variant="danger" [disabled]="busy() !== null" (click)="emptyTrash()">
            <ui-icon name="trash" [size]="14" />
            Empty trash ({{ total() }})
          </button>
        }
      </div>
    </header>

    @if (loading()) {
      <ui-skeleton [lines]="5" height="46px" radius="var(--ui-radius-md)" />
    } @else if (error(); as message) {
      <div class="pg__error" role="alert">
        <ui-icon name="alert" [size]="18" />
        <div>
          <p class="pg__error-title">The trash could not be loaded.</p>
          <p class="pg__error-msg">{{ message }}</p>
        </div>
        <button type="button" uiButton (click)="reload()"><ui-icon name="refresh" [size]="14" /> Retry</button>
      </div>
    } @else if (!items().length) {
      <ui-empty-state icon="trash" heading="The trash is empty" description="Drawings you delete show up here first." />
    } @else if (!filteredItems().length) {
      <ui-empty-state icon="search" heading="No drawings match your search"
        [description]="'Nothing in Trash matches &quot;' + query() + '&quot;.'" />
    } @else {
      @if (selection.any()) {
        <app-bulk-bar
          [count]="selection.count()"
          [actions]="bulkActions"
          [busy]="busy() !== null"
          (action)="onBulk($event)"
          (clear)="selection.clear()"
        />
      }

      <div class="tr__all">
        <input
          type="checkbox"
          class="tr__check"
          aria-label="Select every drawing on this page"
          [checked]="allSelected()"
          [indeterminate]="selection.any() && !allSelected()"
          (change)="selection.setAll(items(), !allSelected())"
        />
        <span>Select all on this page</span>
      </div>

      <ul class="tr__list">
        @for (drawing of filteredItems(); track drawing.id) {
          <li class="tr__row" [class.tr__row--selected]="selection.has(drawing.id)">
            <input
              type="checkbox"
              class="tr__check"
              [checked]="selection.has(drawing.id)"
              [attr.aria-label]="'Select ' + drawing.name"
              (click)="onPick(drawing, $event)"
            />
            <ui-icon class="tr__icon" name="file" [size]="16" />
            <span class="tr__name" [title]="drawing.name">{{ drawing.name }}</span>
            <span class="tr__meta">Deleted {{ drawing.deletedAt | relativeTime }}</span>
            <span class="tr__size">{{ drawing.byteSize | fileSize }}</span>
            <button type="button" uiButton size="sm" [disabled]="busy() === drawing.id" (click)="restore(drawing)">
              <ui-icon name="restore" [size]="14" />
              Restore
            </button>
            <button type="button" uiButton variant="danger" size="sm" [disabled]="busy() === drawing.id" (click)="deleteForever(drawing)">
              Delete permanently
            </button>
          </li>
        }
      </ul>

      <ui-paginator
        class="tr__pager"
        noun="drawing"
        label="Trash pagination"
        [total]="total()"
        [page]="page()"
        [pageSize]="pageSize()"
        [disabled]="loading()"
        (pageChange)="goToPage($event)"
        (pageSizeChange)="setPageSize($event)"
      />
    }
  `,
  styles: [
    `
      :host { display: block; }
      .pg__head { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4); margin-bottom: var(--ui-space-5); flex-wrap: wrap; }
      .pg__title { margin: 0; font-size: var(--ui-text-xl); font-weight: 600; letter-spacing: -.01em; color: var(--ui-text-strong); }
      .tr__head-end { display: flex; align-items: center; gap: var(--ui-space-3); flex-wrap: wrap; }
      .tr__note { margin: 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .tr__all {
        display: flex; align-items: center; gap: var(--ui-space-2);
        margin-bottom: var(--ui-space-2);
        font-size: var(--ui-text-sm); color: var(--ui-text-dim);
      }
      .tr__check { width: 15px; height: 15px; margin: 0; accent-color: var(--ui-accent); cursor: pointer; flex: 0 0 auto; }
      .tr__row--selected { background: var(--ui-active); }

      .pg__error {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 14px 16px; border: 1px solid var(--ui-danger); border-radius: var(--ui-radius-lg);
        background: var(--ui-danger-tint);
      }
      .pg__error > ui-icon { color: var(--ui-danger); flex: 0 0 auto; }
      .pg__error > div { flex: 1; min-width: 0; }
      .pg__error-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .pg__error-msg { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .tr__list {
        list-style: none; margin: 0; padding: 0;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg); overflow: hidden;
      }
      .tr__row {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 10px 14px;
        border-bottom: 1px solid var(--ui-border);
      }
      .tr__row:last-child { border-bottom: 0; }
      .tr__row:hover { background: var(--ui-hover); }
      .tr__icon { color: var(--ui-text-dim); flex: 0 0 auto; }
      .tr__name {
        flex: 1; min-width: 0; font-size: var(--ui-text-md); font-weight: 500; color: var(--ui-text-strong);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .tr__meta { flex: 0 0 auto; width: 150px; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .tr__size { flex: 0 0 auto; width: 76px; text-align: right; font-size: var(--ui-text-sm); font-family: var(--ui-font-mono); color: var(--ui-text-dim); }
      @media (max-width: 820px) { .tr__meta, .tr__size { display: none; } }
      .tr__pager { margin-top: var(--ui-space-5); }
    `,
  ],
})
export class TrashPage {
  /** From `?q=` — bound by `withComponentInputBinding()`. */
  readonly q = input<string | undefined>('');

  private readonly api = inject(DrawingsApiService);
  private readonly workspace = inject(WorkspaceService);
  private readonly dialog = inject(UiDialogService);
  private readonly notify = inject(NotificationService);
  private readonly events = inject(DashboardEventsService);

  protected readonly items = signal<DrawingSummaryDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Id of the row with a request in flight, so its buttons disable. */
  protected readonly busy = signal<string | null>(null);

  protected readonly page = signal(1);
  protected readonly pageSize = signal<number>(PAGE_SIZES[0]);
  protected readonly total = signal(0);

  protected readonly selection = new RowSelection();
  protected readonly bulkActions = [...BULK_ACTIONS];
  protected readonly allSelected = computed(() => this.selection.allOf(this.items()));

  /** Normalised query string from `?q=`. */
  protected readonly query = computed(() => (this.q() ?? '').trim());

  /**
   * Client-side filter applied on top of the current page's items.
   * Will be replaced by a server-side `q` param once the backend supports it.
   */
  protected readonly filteredItems = computed(() => {
    const q = this.query().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((d) => d.name.toLowerCase().includes(q));
  });

  private generation = 0;
  /** Revision this page produced itself; reloading for it would only flash the list. */
  private ownRevision = -1;

  constructor() {
    effect(() => {
      const revision = this.events.revision();
      // Also re-run when the search query changes.
      this.q();
      untracked(() => {
        if (revision === this.ownRevision) return;
        this.page.set(1);
        void this.reload();
      });
    });
  }

  /** Tell the other pages something changed without re-fetching our own list. */
  private announce(): void {
    this.events.bump();
    this.ownRevision = this.events.revision();
  }

  protected async reload(): Promise<void> {
    const gen = ++this.generation;
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.trash({
        page: this.page(),
        limit: this.pageSize(),
        organizationId: this.workspace.activeOrgId(),
      });
      if (gen !== this.generation) return;
      this.items.set(page.items);
      this.total.set(page.total ?? page.items.length);
      // Adopt the page the server actually served — it clamps one past the end.
      this.page.set(page.page ?? 1);
      this.selection.retain(page.items);
    } catch (e) {
      if (gen !== this.generation) return;
      this.items.set([]);
      this.total.set(0);
      this.error.set(messageOf(e));
    } finally {
      if (gen === this.generation) this.loading.set(false);
    }
  }

  protected goToPage(page: number): void {
    if (page === this.page()) return;
    this.page.set(page);
    void this.reload();
  }

  protected setPageSize(size: number): void {
    if (size === this.pageSize()) return;
    this.pageSize.set(size);
    this.page.set(1);
    void this.reload();
  }

  /**
   * Drops a row and reloads. A refetch (rather than only splicing) is what
   * keeps `total` and the page contents in step — emptying the last page would
   * otherwise leave a pager pointing past the end.
   */
  private dropRow(id: string): void {
    this.items.update((list) => list.filter((d) => d.id !== id));
    this.total.update((n) => Math.max(0, n - 1));
    if (!this.items().length && this.page() > 1) {
      this.page.update((p) => p - 1);
    }
    void this.reload();
  }

  protected async restore(drawing: DrawingSummaryDto): Promise<void> {
    if (this.busy()) return;
    this.busy.set(drawing.id);
    try {
      const restored = await this.api.restore(drawing.id);
      this.dropRow(drawing.id);
      // The server auto-suffixes a name that was taken while the drawing sat in
      // the trash, so say what actually came back rather than what was asked for.
      this.notify.success(
        restored.name === drawing.name
          ? `"${drawing.name}" was restored.`
          : `"${drawing.name}" was restored as "${restored.name}".`,
      );
      this.announce();
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.busy.set(null);
    }
  }

  protected async deleteForever(drawing: DrawingSummaryDto): Promise<void> {
    if (this.busy()) return;
    const ok = await this.dialog.confirm({
      title: 'Delete permanently?',
      message: `"${drawing.name}" and all of its saved versions will be deleted. This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    this.busy.set(drawing.id);
    try {
      await this.api.deletePermanently(drawing.id);
      this.dropRow(drawing.id);
      this.notify.success(`"${drawing.name}" was deleted.`);
      this.announce();
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.busy.set(null);
    }
  }

  // ── selection ─────────────────────────────────────────────────────────────

  protected onPick(drawing: DrawingSummaryDto, event: MouseEvent): void {
    const input = event.target as HTMLInputElement;
    this.selection.toggle(this.items(), drawing.id, input.checked, event.shiftKey);
  }

  protected async onBulk(id: string): Promise<void> {
    const rows = this.selection.selected(this.items());
    if (!rows.length || this.busy()) return;

    if (id === 'delete') {
      const ok = await this.dialog.confirm({
        title: `Delete ${rows.length === 1 ? 'this drawing' : rows.length + ' drawings'} permanently?`,
        message: 'They and all of their saved versions will be deleted. This cannot be undone.',
        confirmLabel: 'Delete permanently',
        danger: true,
      });
      if (!ok) return;
    } else if (id !== 'restore') {
      return;
    }

    this.busy.set('bulk');
    const failed: string[] = [];
    let done = 0;
    try {
      // Sequential: 25 parallel writes would be a burst the API has no reason
      // to absorb, and one failure must not abort the rest of the batch.
      for (const drawing of rows) {
        try {
          if (id === 'restore') await this.api.restore(drawing.id);
          else await this.api.deletePermanently(drawing.id);
          done++;
        } catch {
          failed.push(drawing.name);
        }
      }
    } finally {
      this.busy.set(null);
    }

    const verb = id === 'restore' ? 'Restored' : 'Deleted';
    if (failed.length) {
      this.notify.error(`${verb} ${done} of ${rows.length}; failed: ${failed.slice(0, 2).join(', ')}.`);
    } else {
      this.notify.success(`${verb} ${done} ${done === 1 ? 'drawing' : 'drawings'}.`);
    }
    this.selection.clear();
    await this.reload();
    this.announce();
  }

  /**
   * Clears the whole workspace's trash, not just this page — see the class
   * note. Personal trash is the caller's own; an organization's needs ADMIN,
   * which the server enforces (403).
   */
  protected async emptyTrash(): Promise<void> {
    if (this.busy() || !this.items().length) return;
    const count = this.total();
    const ok = await this.dialog.confirm({
      title: 'Empty the trash?',
      message: `${count} ${count === 1 ? 'drawing' : 'drawings'} and all of their saved versions will be deleted. This cannot be undone.`,
      confirmLabel: 'Empty trash',
      danger: true,
    });
    if (!ok) return;

    this.busy.set('empty');
    try {
      const { deleted } = await this.api.emptyTrash(this.workspace.activeOrgId());
      this.selection.clear();
      this.notify.success(`${deleted} ${deleted === 1 ? 'drawing' : 'drawings'} deleted.`);
      this.page.set(1);
      await this.reload();
      this.announce();
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.busy.set(null);
    }
  }
}
