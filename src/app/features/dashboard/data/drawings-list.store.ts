import { Injectable, computed, inject, signal } from '@angular/core';
import { DrawingSort, DrawingSummaryDto, FolderDetailDto, FolderDto } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { FoldersApiService } from '../../../core/api/folders-api.service';

export type DashboardView = 'grid' | 'list';

/** localStorage key for the grid/list preference (shared with the plan's spec). */
const VIEW_KEY = 'cad.dash.view';
const PAGE_SIZE = 50;

/** What the browser page is currently looking at. */
export interface DrawingsListQuery {
  /** Folder id, or `null` for the top level of "My Drawings". */
  folderId: string | null;
  /** Search text from `?q=`. */
  q: string;
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
 *  - **Search escapes the folder.** With a query, `folderId` is dropped so the
 *    user searches their whole library — the folder scope is a browsing device,
 *    not a filter people expect search to respect.
 *  - **Local mutation over refetch.** Rename / move / duplicate / delete patch
 *    the `items` signal directly so the list does not flicker; a shell-level
 *    change (new folder, upload) bumps `DashboardEventsService` and refetches.
 */
@Injectable()
export class DrawingsListStore {
  private readonly drawings = inject(DrawingsApiService);
  private readonly foldersApi = inject(FoldersApiService);

  readonly items = signal<DrawingSummaryDto[]>([]);
  readonly folders = signal<FolderDto[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);
  readonly sort = signal<DrawingSort>('updated');
  readonly view = signal<DashboardView>(readView());
  /** The folder being browsed (with its breadcrumb `path`); null at the top level. */
  readonly folder = signal<FolderDetailDto | null>(null);

  /** True when the fetch finished and there is genuinely nothing to show. */
  readonly isEmpty = computed(() => !this.loading() && !this.error() && !this.items().length && !this.folders().length);
  readonly hasMore = computed(() => this.nextCursor() !== null);

  private query: DrawingsListQuery = { folderId: null, q: '' };
  private generation = 0;

  /** Point the store at a folder / query and (re)load everything. */
  load(query: DrawingsListQuery): Promise<void> {
    this.query = query;
    return this.reload();
  }

  /** Refetch the current query from scratch. */
  async reload(): Promise<void> {
    const gen = ++this.generation;
    this.loading.set(true);
    this.error.set(null);
    const { folderId, q } = this.query;
    const searching = q.trim().length > 0;

    try {
      const [page, folders, folder] = await Promise.all([
        this.drawings.list({
          // A search spans the whole library; browsing is scoped to one level.
          folderId: searching ? undefined : (folderId ?? 'root'),
          q: searching ? q.trim() : undefined,
          sort: this.sort(),
          limit: PAGE_SIZE,
        }),
        searching ? Promise.resolve<FolderDto[]>([]) : this.foldersApi.list(folderId),
        folderId ? this.foldersApi.get(folderId) : Promise.resolve<FolderDetailDto | null>(null),
      ]);
      if (gen !== this.generation) return;
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.folders.set(folders);
      this.folder.set(folder);
    } catch (e) {
      if (gen !== this.generation) return;
      this.items.set([]);
      this.folders.set([]);
      this.nextCursor.set(null);
      this.error.set(messageOf(e));
    } finally {
      if (gen === this.generation) this.loading.set(false);
    }
  }

  /** Append the next cursor page. No-op when there is nothing more. */
  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    const gen = this.generation;
    this.loadingMore.set(true);
    const { folderId, q } = this.query;
    const searching = q.trim().length > 0;
    try {
      const page = await this.drawings.list({
        folderId: searching ? undefined : (folderId ?? 'root'),
        q: searching ? q.trim() : undefined,
        sort: this.sort(),
        cursor,
        limit: PAGE_SIZE,
      });
      if (gen !== this.generation) return;
      this.items.update((list) => [...list, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch (e) {
      if (gen === this.generation) this.error.set(messageOf(e));
    } finally {
      this.loadingMore.set(false);
    }
  }

  setSort(sort: DrawingSort): void {
    if (sort === this.sort()) return;
    this.sort.set(sort);
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

  patchItem(id: string, patch: Partial<DrawingSummaryDto>): void {
    this.items.update((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  removeItem(id: string): void {
    this.items.update((list) => list.filter((d) => d.id !== id));
  }

  prependItem(item: DrawingSummaryDto): void {
    this.items.update((list) => [item, ...list.filter((d) => d.id !== item.id)]);
  }

  addFolder(folder: FolderDto): void {
    this.folders.update((list) => [...list.filter((f) => f.id !== folder.id), folder].sort(byName));
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

/** Human message for any thrown value (`ApiError` already carries a good one). */
export function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
}
