import { Injectable, computed, inject, signal } from '@angular/core';
import { DrawingSort, DrawingSummaryDto, FolderDetailDto, FolderDto, ListScope } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { FoldersApiService } from '../../../core/api/folders-api.service';
import { WorkspaceService } from '../../../core/api/workspace.service';
import { PAGE_SIZES } from '../../../shared/ui';
import { RowSelection } from './row-selection';

export type DashboardView = 'grid' | 'list';

/** localStorage key for the grid/list preference (shared with the plan's spec). */
const VIEW_KEY = 'cad.dash.view';
/** localStorage key for the chosen page size. */
const PAGE_SIZE_KEY = 'cad.dash.pageSize';

/** What the browser page is currently looking at. */
export interface DrawingsListQuery {
  /** Folder id, or `null` for the top level of "My Drawings". */
  folderId: string | null;
  /** Search text from `?q=`. */
  q: string;
  /**
   * `'shared'` lists what other people shared with the caller instead of the
   * active workspace. Browsing *into* a shared folder goes back to `'workspace'`
   * with a `folderId`: the server decides the workspace from the folder, so the
   * ordinary folder route works unchanged.
   */
  scope?: ListScope;
}

/**
 * Signal store behind the drawings browser.
 *
 * Design decisions:
 *  - **One store per page instance, not root-provided.** It holds the state of
 *    one folder view; providing it on `DrawingsPage` means navigating between
 *    folders gets a clean store instead of stale items from another folder.
 *  - **A load generation counter, not cancellation.** Folder changes and search
 *    keystrokes overlap; every load stamps a generation and a response from a
 *    superseded request is dropped. That is simpler than juggling AbortControllers
 *    across two promise-returning clients and gives the same result.
 *  - **Numbered pages, not an appending cursor.** The list is a file table, so
 *    it asks for `?page=` and keeps `total` — which is what lets the footer say
 *    "1–25 of 137" and offer a last-page jump. Any mutation reloads the current
 *    page rather than patching a window whose `total` would then be a lie.
 *  - **Search escapes the folder.** With a query, `folderId` is dropped so the
 *    user searches their whole workspace — the folder scope is a browsing
 *    device, not a filter people expect search to respect.
 *  - **The workspace comes from `WorkspaceService`.** Every request carries the
 *    active organization, so switching workspace and reloading is all the shell
 *    has to do.
 */
@Injectable()
export class DrawingsListStore {
  private readonly drawings = inject(DrawingsApiService);
  private readonly foldersApi = inject(FoldersApiService);
  private readonly workspace = inject(WorkspaceService);

  readonly items = signal<DrawingSummaryDto[]>([]);
  readonly folders = signal<FolderDto[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly sort = signal<DrawingSort>('updated');
  readonly view = signal<DashboardView>(readView());
  /** The folder being browsed (with its breadcrumb `path`); null at the top level. */
  readonly folder = signal<FolderDetailDto | null>(null);

  // ── paging ────────────────────────────────────────────────────────────────
  readonly page = signal(1);
  readonly pageSize = signal(readPageSize());
  readonly total = signal(0);
  readonly lastPage = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  /** True when the fetch finished and there is genuinely nothing to show. */
  readonly isEmpty = computed(() => !this.loading() && !this.error() && !this.items().length && !this.folders().length);

  /** The selection shared by the table, the tiles and the bulk bar. */
  readonly selection = new RowSelection();

  private query: DrawingsListQuery = { folderId: null, q: '' };
  private generation = 0;

  /** Point the store at a folder / query and (re)load from page 1. */
  load(query: DrawingsListQuery): Promise<void> {
    const changed =
      query.folderId !== this.query.folderId || query.q !== this.query.q || query.scope !== this.query.scope;
    this.query = query;
    if (changed) {
      this.page.set(1);
      // Selecting rows in one folder and acting on them in another would be a
      // trap, so a change of view starts from nothing selected.
      this.selection.clear();
    }
    return this.reload();
  }

  /** Refetch the current query and page. */
  async reload(): Promise<void> {
    const gen = ++this.generation;
    this.loading.set(true);
    this.error.set(null);
    const { folderId, q } = this.query;
    const shared = this.query.scope === 'shared';
    const searching = q.trim().length > 0;
    // "Shared with me" spans every workspace, so it carries no organization.
    const organizationId = shared ? null : this.workspace.activeOrgId();

    try {
      const [page, folders, folder] = await Promise.all([
        this.drawings.list({
          // A search spans the whole workspace; browsing is scoped to one level.
          folderId: shared || searching ? undefined : (folderId ?? 'root'),
          organizationId,
          q: searching ? q.trim() : undefined,
          sort: this.sort(),
          page: this.page(),
          limit: this.pageSize(),
          scope: shared ? 'shared' : undefined,
        }),
        searching
          ? Promise.resolve<FolderDto[]>([])
          : this.foldersApi.list(shared ? null : folderId, organizationId, shared ? 'shared' : undefined),
        folderId && !shared ? this.foldersApi.get(folderId) : Promise.resolve<FolderDetailDto | null>(null),
      ]);
      if (gen !== this.generation) return;
      this.items.set(page.items);
      this.total.set(page.total ?? page.items.length);
      // The server clamps a page past the end; adopt what it actually served so
      // the footer and the rows cannot disagree.
      this.page.set(page.page ?? 1);
      this.folders.set(folders);
      this.folder.set(folder);
      // Ids that no longer exist on this page would make the bulk bar lie.
      this.selection.retain(page.items);
    } catch (e) {
      if (gen !== this.generation) return;
      this.items.set([]);
      this.folders.set([]);
      this.total.set(0);
      this.error.set(messageOf(e));
    } finally {
      if (gen === this.generation) this.loading.set(false);
    }
  }

  /** Jump to a page. No-op when it is the page already shown. */
  goToPage(page: number): void {
    const clamped = Math.min(Math.max(Math.trunc(page), 1), this.lastPage());
    if (clamped === this.page()) return;
    this.page.set(clamped);
    void this.reload();
  }

  /** Change the page size, returning to page 1 so the offset stays meaningful. */
  setPageSize(size: number): void {
    if (size === this.pageSize()) return;
    this.pageSize.set(size);
    this.page.set(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      /* private mode / storage disabled — the choice just does not persist. */
    }
    void this.reload();
  }

  setSort(sort: DrawingSort): void {
    if (sort === this.sort()) return;
    this.sort.set(sort);
    this.page.set(1);
    void this.reload();
  }

  setView(view: DashboardView): void {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private mode / storage disabled — the choice just does not persist. */
    }
  }

  // ── local mutations ──────────────────────────────────────────────────────
  //
  // Rename and move patch in place, because the row stays on this page and a
  // refetch would flicker. Anything that changes how many rows exist reloads
  // instead: `total` drives the pager, and a page that quietly holds 24 of 25
  // rows is worse than a brief spinner.

  patchItem(id: string, patch: Partial<DrawingSummaryDto>): void {
    this.items.update((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  removeItem(id: string): void {
    this.items.update((list) => list.filter((d) => d.id !== id));
    this.total.update((n) => Math.max(0, n - 1));
    // Removing the last row of the last page would leave an empty table with a
    // pager pointing past the end, so step back a page first.
    if (this.items().length === 0 && this.page() > 1) {
      this.page.update((p) => p - 1);
    }
    void this.reload();
  }

  prependItem(item: DrawingSummaryDto): void {
    this.total.update((n) => n + 1);
    if (this.page() === 1) {
      this.items.update((list) => [item, ...list.filter((d) => d.id !== item.id)].slice(0, this.pageSize()));
    } else {
      // A new row belongs at the top of page 1 under every sort we offer.
      this.goToPage(1);
    }
  }

  addFolder(folder: FolderDto): void {
    this.folders.update((list) => [...list.filter((f) => f.id !== folder.id), folder].sort(byName));
  }

  /** Rename in place: the tile stays where it is, so a refetch would only flicker. */
  patchFolder(id: string, patch: Partial<FolderDto>): void {
    this.folders.update((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)).sort(byName));
  }

  /**
   * Drop a folder tile and reload. Unlike a drawing this does not touch `total`
   * (folders are not paged), but deleting one can trash the drawings inside it,
   * which the current page *is* showing — hence the refetch.
   */
  removeFolder(id: string): void {
    this.folders.update((list) => list.filter((f) => f.id !== id));
    void this.reload();
  }

  /** Remove several drawings at once after a bulk action, then refetch. */
  removeItems(ids: readonly string[]): void {
    if (!ids.length) return;
    const gone = new Set(ids);
    this.items.update((list) => list.filter((d) => !gone.has(d.id)));
    this.total.update((n) => Math.max(0, n - gone.size));
    if (this.items().length === 0 && this.page() > 1) {
      this.page.update((p) => p - 1);
    }
    this.selection.clear();
    void this.reload();
  }
}

function byName(a: FolderDto, b: FolderDto): number {
  return a.name.localeCompare(b.name);
}

function readView(): DashboardView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** Stored page size, ignoring anything not on the offered list. */
function readPageSize(): number {
  try {
    const stored = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(stored) ? stored : PAGE_SIZES[0];
  } catch {
    return PAGE_SIZES[0];
  }
}

/** Human message for any thrown value (`ApiError` already carries a good one). */
export function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
}
