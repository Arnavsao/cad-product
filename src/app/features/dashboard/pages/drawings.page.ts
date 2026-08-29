import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DrawingSort, DrawingSummaryDto } from '../../../core/api/api.models';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiEmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { DrawingCardComponent } from '../components/drawing-card.component';
import { toDrawingAction } from '../components/drawing-menu';
import { DrawingRowComponent } from '../components/drawing-row.component';
import { FolderBreadcrumbsComponent } from '../components/folder-breadcrumbs.component';
import { NewDrawingMenuComponent } from '../components/new-drawing-menu.component';
import { DashboardEventsService } from '../data/dashboard-events.service';
import { DrawingActionsService } from '../data/drawing-actions.service';
import { DashboardView, DrawingsListStore } from '../data/drawings-list.store';

const SORTS: readonly { id: DrawingSort; label: string }[] = [
  { id: 'updated', label: 'Last modified' },
  { id: 'opened', label: 'Last opened' },
  { id: 'name', label: 'Name' },
];

/**
 * `/dashboard/drawings` and `/dashboard/folders/:folderId` — the file browser.
 *
 * Design decisions:
 *  - **One component, two routes.** The folder route only adds a `:folderId`;
 *    `withComponentInputBinding()` delivers it (and `?q=`) as signal inputs, so
 *    navigating between folders reuses the component and just re-runs one effect.
 *  - **Store provided here, not at root.** `DrawingsListStore` holds the state of
 *    exactly this view; a component-level provider means leaving the dashboard
 *    disposes it instead of leaking one folder's items into the next visit.
 *  - **Menu actions patch the store.** Rename / duplicate / move / delete update
 *    `items` in place through `DrawingActionsService`'s result, so the list never
 *    flashes back to a skeleton for a one-row change.
 */
@Component({
  selector: 'app-drawings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DrawingsListStore],
  imports: [
    RouterLink,
    UiButtonDirective,
    UiEmptyStateComponent,
    UiIconComponent,
    UiInputDirective,
    UiSkeletonComponent,
    DrawingCardComponent,
    DrawingRowComponent,
    FolderBreadcrumbsComponent,
    NewDrawingMenuComponent,
  ],
  template: `
    <header class="pg__head">
      @if (folderId()) {
        <app-folder-breadcrumbs [folder]="store.folder()" />
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
      @if (query()) {
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
      @if (store.folders().length) {
        <h2 class="pg__subtitle">Folders</h2>
        <div class="dw__folders" [class.dw__folders--list]="store.view() === 'list'">
          @for (folder of store.folders(); track folder.id) {
            <a class="dw__folder" [routerLink]="['/dashboard/folders', folder.id]">
              <ui-icon name="folder" [size]="18" />
              <span class="dw__folder-name">{{ folder.name }}</span>
            </a>
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
              <app-drawing-card [drawing]="drawing" (open)="open(drawing)" (action)="onAction($event, drawing)" />
            }
          </div>
        } @else {
          <div class="dw__list">
            @for (drawing of store.items(); track drawing.id) {
              <app-drawing-row [drawing]="drawing" (open)="open(drawing)" (action)="onAction($event, drawing)" />
            }
          </div>
        }
      }

      @if (store.hasMore()) {
        <div class="dw__more">
          <button type="button" uiButton [loading]="store.loadingMore()" [disabled]="store.loadingMore()" (click)="store.loadMore()">
            Load more
          </button>
        </div>
      }
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
      .dw__list { border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg); overflow: hidden; }

      .dw__folders { display: grid; gap: var(--ui-space-3); grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
      .dw__folders--list { grid-template-columns: 1fr; gap: 2px; }
      .dw__folder {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 14px;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg);
        background: var(--ui-surface); color: var(--ui-text); text-decoration: none;
        font-size: var(--ui-text-md); font-weight: 500;
        transition: border-color var(--ui-dur-fast), background var(--ui-dur-fast);
      }
      .dw__folder:hover { border-color: var(--ui-border-strong); background: var(--ui-hover); }
      .dw__folder:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .dw__folder ui-icon { color: var(--ui-accent); }
      .dw__folder-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .dw__more { display: flex; justify-content: center; margin-top: var(--ui-space-6); }
    `,
  ],
})
export class DrawingsPage {
  /** From `/dashboard/folders/:folderId`; absent on `/dashboard/drawings`. */
  readonly folderId = input<string | null>(null);
  /** From `?q=` — bound by `withComponentInputBinding()`. */
  readonly q = input<string>('');

  protected readonly store = inject(DrawingsListStore);
  private readonly actions = inject(DrawingActionsService);
  private readonly events = inject(DashboardEventsService);

  protected readonly sorts = SORTS;
  protected readonly skeletons = Array.from({ length: 8 }, (_, i) => i);
  protected readonly query = computed(() => this.q().trim());

  constructor() {
    effect(() => {
      const folderId = this.folderId();
      const q = this.q();
      this.events.revision();
      untracked(() => void this.store.load({ folderId, q }));
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

  protected async onAction(id: string, drawing: DrawingSummaryDto): Promise<void> {
    const action = toDrawingAction(id);
    if (!action) return;
    const result = await this.actions.run(action, drawing);
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
}
