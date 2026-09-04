import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DrawingSort, DrawingSummaryDto, FolderDto, ListScope } from '../../../core/api/api.models';
import { WorkspaceService } from '../../../core/api/workspace.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiEmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { UiPaginatorComponent } from '../../../shared/ui/paginator.component';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { BulkBarAction, BulkBarComponent } from '../components/bulk-bar.component';
import { setDragIds } from '../components/drag-payload';
import { DrawingCardComponent } from '../components/drawing-card.component';
import { hasAccess, toDrawingAction } from '../components/drawing-menu';
import { DrawingRowComponent, RowSelectEvent } from '../components/drawing-row.component';
import { DrawingsTableHeaderComponent } from '../components/drawings-table-header.component';
import { BreadcrumbDropEvent, FolderBreadcrumbsComponent } from '../components/folder-breadcrumbs.component';
import { toFolderAction } from '../components/folder-menu';
import { FolderTileComponent } from '../components/folder-tile.component';
import { NewDrawingMenuComponent } from '../components/new-drawing-menu.component';
import { DashboardEventsService } from '../data/dashboard-events.service';
import { DrawingActionResult, DrawingActionsService } from '../data/drawing-actions.service';
import { DashboardView, DrawingsListStore } from '../data/drawings-list.store';
import { FolderActionsService } from '../data/folder-actions.service';
import { UploadService } from '../data/upload.service';

const SORTS: readonly { id: DrawingSort; label: string }[] = [
  { id: 'updated', label: 'Last modified' },
  { id: 'opened', label: 'Last opened' },
  { id: 'name', label: 'Name' },
];

/**
 * `/dashboard/drawings`, `/dashboard/folders/:folderId` and
 * `/dashboard/shared` — the file browser.
 *
 * Design decisions:
 *  - **One component, three routes.** The folder route only adds a `:folderId`
 *    and the shared route only sets `data: { scope: 'shared' }`;
 *    `withComponentInputBinding()` delivers both (and `?q=`) as signal inputs,
 *    so navigating between them reuses the component and just re-runs one
 *    effect. Browsing *into* a shared folder goes to the ordinary folder route:
 *    the server decides the workspace from the folder id, so nothing here has
 *    to remember how the user arrived.
 *  - **Store provided here, not at root.** `DrawingsListStore` holds the state of
 *    exactly this view; a component-level provider means leaving the dashboard
 *    disposes it instead of leaking one folder's items into the next visit.
 *  - **Menu actions patch the store.** Rename / duplicate / move / delete update
 *    `items` in place through `DrawingActionsService`'s result, so the list never
 *    flashes back to a skeleton for a one-row change. Folders do the same
 *    through `FolderActionsService`.
 *  - **Dragging follows the selection.** Dragging a selected row moves the whole
 *    selection; dragging an unselected one moves just it — which is what every
 *    file manager does, and it means the drop target needs no knowledge of
 *    either. Drops go through the same `moveTo` as the dialog, so a 409 reads
 *    identically whichever way the move was started.
 */
@Component({
  selector: 'app-drawings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DrawingsListStore],
  host: {
    // On `document`, not the host: Esc has to clear the selection wherever focus
    // happens to be after a click, and a bare host listener only sees keys
    // pressed inside this component's own subtree.
    '(document:keydown.escape)': 'store.selection.clear()',
  },
  imports: [
    RouterLink,
    UiButtonDirective,
    UiEmptyStateComponent,
    UiIconComponent,
    UiInputDirective,
    UiPaginatorComponent,
    UiSkeletonComponent,
    BulkBarComponent,
    DrawingCardComponent,
    DrawingRowComponent,
    DrawingsTableHeaderComponent,
    FolderBreadcrumbsComponent,
    FolderTileComponent,
    NewDrawingMenuComponent,
  ],
  template: `
    <header class="pg__head">
      @if (isShared()) {
        <h1 class="pg__title">Shared with me</h1>
      } @else if (folderId()) {
        <app-folder-breadcrumbs [folder]="store.folder()" (itemsDropped)="onCrumbDrop($event)" />
      } @else if (query()) {
        <h1 class="pg__title">Results for "{{ query() }}"</h1>
      } @else {
        <h1 class="pg__title">My Drawings</h1>
      }

      <div class="pg__tools">
        <label class="pg__sort">
          <span class="ui-visually-hidden">Sort by</span>
          <select uiInput (change)="onSort($event)">
            @for (option of sorts; track option.id) {
              <option [value]="option.id" [selected]="option.id === store.sort()">{{ option.label }}</option>
            }
          </select>
        </label>

        <div class="pg__view" role="group" aria-label="View">
          <button
            type="button"
            uiButton
            size="sm"
            iconOnly
            aria-label="Grid view"
            [attr.aria-pressed]="store.view() === 'grid'"
            [class.pg__view--on]="store.view() === 'grid'"
            (click)="setView('grid')"
          >
            <ui-icon name="grid" [size]="15" />
          </button>
          <button
            type="button"
            uiButton
            size="sm"
            iconOnly
            aria-label="List view"
            [attr.aria-pressed]="store.view() === 'list'"
            [class.pg__view--on]="store.view() === 'list'"
            (click)="setView('list')"
          >
            <ui-icon name="list" [size]="15" />
          </button>
        </div>
      </div>
    </header>

    @if (store.loading()) {
      <div class="dw__grid">
        @for (i of skeletons; track i) {
          <ui-skeleton width="100%" height="190px" radius="var(--ui-radius-lg)" />
        }
      </div>
    } @else if (store.error(); as message) {
      <div class="pg__error" role="alert">
        <ui-icon name="alert" [size]="18" />
        <div>
          <p class="pg__error-title">This folder could not be loaded.</p>
          <p class="pg__error-msg">{{ message }}</p>
        </div>
        <button type="button" uiButton (click)="store.reload()"><ui-icon name="refresh" [size]="14" /> Retry</button>
      </div>
    } @else if (store.isEmpty()) {
      @if (isShared()) {
        <ui-empty-state
          icon="share"
          heading="Nothing has been shared with you yet"
          description="Drawings and folders other people share with you — or with an organization you are in — show up here."
        />
      } @else if (query()) {
        <ui-empty-state icon="search" heading="No drawings match your search" [description]="'Nothing found for “' + query() + '”.'">
          <a uiButton routerLink="/dashboard/drawings">Clear search</a>
        </ui-empty-state>
      } @else {
        <ui-empty-state
          icon="folder"
          heading="This folder doesn't contain any files"
          description="Drop a .dxf here, or create a new drawing."
        >
          <app-new-drawing-menu [folderId]="folderId()" (created)="store.reload()" />
        </ui-empty-state>
      }
    } @else {
      @if (store.selection.any()) {
        <app-bulk-bar
          [count]="store.selection.count()"
          [actions]="bulkActions()"
          [busy]="bulkBusy()"
          (action)="onBulk($event)"
          (clear)="store.selection.clear()"
        />
      }

      @if (store.folders().length) {
        <h2 class="pg__subtitle">Folders</h2>
        <div class="dw__folders">
          @for (folder of store.folders(); track folder.id) {
            <app-folder-tile
              [folder]="folder"
              (action)="onFolderAction($event, folder)"
              (filesDropped)="onFolderFiles(folder, $event)"
              (itemsDropped)="onFolderDrop(folder, $event)"
            />
          }
        </div>
      }

      @if (store.items().length) {
        @if (store.folders().length) {
          <h2 class="pg__subtitle">Drawings</h2>
        }
        @if (store.view() === 'grid') {
          <div class="dw__grid">
            @for (drawing of store.items(); track drawing.id) {
              <app-drawing-card
                [drawing]="drawing"
                [selected]="store.selection.has(drawing.id)"
                [draggable]="true"
                (open)="open(drawing)"
                (action)="onAction($event, drawing)"
                (selectChange)="onSelect(drawing, $event)"
                (dragStart)="onDragStart($event, drawing)"
              />
            }
          </div>
        } @else {
          <div class="dw__table" role="grid" aria-label="Drawings">
            <app-drawings-table-header
              [sort]="store.sort()"
              [allSelected]="allSelected()"
              [someSelected]="store.selection.any()"
              (sortChange)="store.setSort($event)"
              (allChange)="store.selection.setAll(store.items(), $event)"
            />
            @for (drawing of store.items(); track drawing.id) {
              <app-drawing-row
                [drawing]="drawing"
                [selected]="store.selection.has(drawing.id)"
                [draggable]="true"
                (open)="open(drawing)"
                (action)="onAction($event, drawing)"
                (selectChange)="onSelect(drawing, $event)"
                (dragStart)="onDragStart($event, drawing)"
              />
            }
          </div>
        }
      }

      <ui-paginator
        class="dw__pager"
        noun="drawing"
        label="Drawings pagination"
        [total]="store.total()"
        [page]="store.page()"
        [pageSize]="store.pageSize()"
        [disabled]="store.loading()"
        (pageChange)="store.goToPage($event)"
        (pageSizeChange)="store.setPageSize($event)"
      />
    }
  `,
  styles: [
    `
      :host { display: block; }
      .pg__head {
        display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4);
        margin-bottom: var(--ui-space-5); flex-wrap: wrap;
      }
      .pg__title { margin: 0; font-size: var(--ui-text-xl); font-weight: 600; letter-spacing: -.01em; color: var(--ui-text-strong); }
      .pg__subtitle { margin: var(--ui-space-6) 0 var(--ui-space-3); font-size: var(--ui-text-base); font-weight: 600; color: var(--ui-text-dim); }
      .pg__subtitle:first-of-type { margin-top: 0; }
      .pg__tools { display: flex; align-items: center; gap: var(--ui-space-2); }
      .pg__sort select { width: auto; min-width: 148px; }
      .pg__view { display: inline-flex; gap: 2px; }
      .pg__view--on { --_bg: var(--ui-active); --_bg-hover: var(--ui-active); --_bd: var(--ui-accent); --_fg: var(--ui-accent); }

      .pg__error {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 14px 16px; border: 1px solid var(--ui-danger); border-radius: var(--ui-radius-lg);
        background: var(--ui-danger-tint);
      }
      .pg__error > ui-icon { color: var(--ui-danger); flex: 0 0 auto; }
      .pg__error > div { flex: 1; min-width: 0; }
      .pg__error-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .pg__error-msg { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .dw__grid { display: grid; gap: var(--ui-space-4); grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }

      /*
       * The single source of truth for the table's columns: the header and every
       * row inherit --dw-cols from here, so they cannot fall out of alignment.
       * The 36px lead column is the selection checkbox; minmax(0, 1fr) on Name
       * lets it absorb the slack and be the only column that ever truncates —
       * the rest are sized to their content.
       */
      .dw__table {
        --dw-cols: 36px 78px minmax(0, 1fr) 150px 96px 160px 170px 44px;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-lg);
        overflow: hidden;
      }
      @media (max-width: 1100px) { .dw__table { --dw-cols: 36px 78px minmax(0, 1fr) 150px 96px 160px 44px; } }
      @media (max-width: 900px) { .dw__table { --dw-cols: 36px 78px minmax(0, 1fr) 150px 96px 44px; } }
      @media (max-width: 720px) { .dw__table { --dw-cols: 36px 78px minmax(0, 1fr) 150px 44px; } }
      @media (max-width: 560px) { .dw__table { --dw-cols: 36px 78px minmax(0, 1fr) 44px; } }

      .dw__folders { display: grid; gap: var(--ui-space-3); grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }

      .dw__pager { margin-top: var(--ui-space-5); }
    `,
  ],
})
export class DrawingsPage {
  /**
   * From `/dashboard/folders/:folderId`; absent on `/dashboard/drawings`.
   *
   * `| undefined` is deliberate, as it is on `q` below: `withComponentInputBinding()`
   * writes `undefined` when the param is missing from the matched route rather than
   * leaving the input at its default, so the declared type has to admit it. Keeping
   * it honest is what makes the `??` normalisation below type-required instead of
   * merely defensive — dropping it crashed the page on `/dashboard/drawings`.
   */
  readonly folderId = input<string | null | undefined>(null);
  /** From `?q=` — bound by `withComponentInputBinding()`; `undefined` with no `?q=`. */
  readonly q = input<string | undefined>('');
  /** From the route's `data`: `'shared'` on `/dashboard/shared`. */
  readonly scope = input<ListScope | undefined>('workspace');

  protected readonly store = inject(DrawingsListStore);
  private readonly actions = inject(DrawingActionsService);
  private readonly folderActions = inject(FolderActionsService);
  private readonly events = inject(DashboardEventsService);
  private readonly upload = inject(UploadService);
  private readonly workspace = inject(WorkspaceService);

  protected readonly sorts = SORTS;
  protected readonly skeletons = Array.from({ length: 8 }, (_, i) => i);
  protected readonly query = computed(() => (this.q() ?? '').trim());
  protected readonly isShared = computed(() => this.scope() === 'shared');
  protected readonly bulkBusy = signal(false);

  protected readonly allSelected = computed(() => this.store.selection.allOf(this.store.items()));

  /** Everything currently ticked, as rows. */
  private readonly picked = computed(() => this.store.selection.selected(this.store.items()));

  /**
   * Move and Delete only appear when every selected row allows them — a bulk
   * action that is guaranteed to fail for half the selection is worse than one
   * that is not offered.
   */
  protected readonly bulkActions = computed<BulkBarAction[]>(() => {
    const rows = this.picked();
    const editable = rows.length > 0 && rows.every((d) => hasAccess(d, 'edit'));
    const items: BulkBarAction[] = [];
    if (editable) items.push({ id: 'move', label: 'Move to…', icon: 'move' });
    items.push({ id: 'copy', label: 'Copy to…', icon: 'copy' }, { id: 'download', label: 'Download', icon: 'download' });
    if (editable) items.push({ id: 'delete', label: 'Delete', icon: 'trash', danger: true });
    return items;
  });

  constructor() {
    effect(() => {
      const folderId = this.folderId() ?? null;
      const q = this.q() ?? '';
      const scope = this.scope() ?? 'workspace';
      this.events.revision();
      untracked(() => void this.store.load({ folderId, q, scope }));
    });
  }

  protected setView(view: DashboardView): void {
    this.store.setView(view);
  }

  protected onSort(event: Event): void {
    this.store.setSort((event.target as HTMLSelectElement).value as DrawingSort);
  }

  protected open(drawing: DrawingSummaryDto): void {
    void this.actions.open(drawing);
  }

  // ── selection ─────────────────────────────────────────────────────────────

  protected onSelect(drawing: DrawingSummaryDto, event: RowSelectEvent): void {
    this.store.selection.toggle(this.store.items(), drawing.id, event.selected, event.shift);
  }

  // ── single-row actions ────────────────────────────────────────────────────

  protected async onAction(id: string, drawing: DrawingSummaryDto): Promise<void> {
    const action = toDrawingAction(id);
    if (!action) return;
    this.apply(await this.actions.run(action, drawing));
  }

  private apply(result: DrawingActionResult): void {
    switch (result.kind) {
      case 'updated':
        this.store.patchItem(result.drawing.id, result.drawing);
        break;
      case 'created':
        this.store.prependItem(result.drawing);
        break;
      case 'removed':
        this.store.removeItem(result.id);
        break;
      case 'none':
        break;
    }
  }

  // ── folders ───────────────────────────────────────────────────────────────

  protected async onFolderAction(id: string, folder: FolderDto): Promise<void> {
    const action = toFolderAction(id);
    if (!action) return;
    const result = await this.folderActions.run(action, folder);
    switch (result.kind) {
      case 'updated':
        this.store.patchFolder(result.folder.id, result.folder);
        break;
      case 'removed':
        this.store.removeFolder(result.id);
        break;
      case 'none':
        break;
    }
  }

  /** Files dropped straight onto a folder tile import into that folder. */
  protected async onFolderFiles(folder: FolderDto, files: File[]): Promise<void> {
    if (!files.length) return;
    await this.upload.upload(files, folder.id, folder.organizationId ?? this.workspace.activeOrgId());
    this.events.bump();
  }

  // ── drag and drop ─────────────────────────────────────────────────────────

  protected onDragStart(event: DragEvent, drawing: DrawingSummaryDto): void {
    // Dragging a row that is part of the selection drags the whole selection.
    const ids = this.store.selection.has(drawing.id) ? this.picked().map((d) => d.id) : [drawing.id];
    if (!setDragIds(event, ids)) event.preventDefault();
  }

  protected onFolderDrop(folder: FolderDto, ids: string[]): void {
    void this.moveDropped(ids, { organizationId: folder.organizationId ?? null, folderId: folder.id });
  }

  protected onCrumbDrop(event: BreadcrumbDropEvent): void {
    const organizationId = this.store.folder()?.organizationId ?? this.workspace.activeOrgId();
    void this.moveDropped(event.ids, { organizationId, folderId: event.folderId });
  }

  /**
   * Applies a drop. One row keeps the single-item toast and patching; several
   * go through the bulk accounting so a partial failure is still reported once.
   */
  private async moveDropped(
    ids: readonly string[],
    dest: { organizationId: string | null; folderId: string | null },
  ): Promise<void> {
    const rows = this.store.items().filter((d) => ids.includes(d.id) && hasAccess(d, 'edit'));
    if (!rows.length) return;
    if (rows.length === 1) {
      this.apply(await this.actions.moveTo(rows[0], dest));
      return;
    }
    this.bulkBusy.set(true);
    try {
      const moved: string[] = [];
      for (const row of rows) {
        const result = await this.actions.moveTo(row, dest);
        if (result.kind === 'removed') moved.push(result.id);
      }
      this.store.removeItems(moved);
    } finally {
      this.bulkBusy.set(false);
    }
  }

  // ── bulk actions ──────────────────────────────────────────────────────────

  protected async onBulk(id: string): Promise<void> {
    const rows = this.picked();
    if (!rows.length || this.bulkBusy()) return;
    this.bulkBusy.set(true);
    try {
      switch (id) {
        case 'move': {
          const result = await this.actions.bulkMove(rows);
          if (result) this.store.removeItems(result.done);
          return;
        }
        case 'copy': {
          const result = await this.actions.bulkCopy(rows);
          if (result?.done.length) void this.store.reload();
          return;
        }
        case 'download':
          await this.actions.bulkDownload(rows);
          return;
        case 'delete': {
          const result = await this.actions.bulkTrash(rows);
          if (result) this.store.removeItems(result.done);
          return;
        }
        default:
          return;
      }
    } finally {
      this.bulkBusy.set(false);
    }
  }
}
