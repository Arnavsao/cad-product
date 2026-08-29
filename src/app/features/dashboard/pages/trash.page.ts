import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { DrawingSummaryDto } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { UiEmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { FileSizePipe } from '../../../shared/ui/pipes/file-size.pipe';
import { RelativeTimePipe } from '../../../shared/ui/pipes/relative-time.pipe';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { DashboardEventsService } from '../data/dashboard-events.service';
import { messageOf } from '../data/drawings-list.store';

/**
 * `/dashboard/trash` — soft-deleted drawings, with Restore and a guarded
 * Delete permanently.
 *
 * Design decision: rows are plain and non-openable. A trashed drawing has no
 * meaningful "open" (the editor would bind to a row the API hides everywhere
 * else), so the only affordances are the two that can actually be honoured.
 * Permanent deletion goes through `UiDialogService.confirm({ danger: true })`,
 * which focuses Cancel — Enter can never destroy anything here.
 */
@Component({
  selector: 'app-trash-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiEmptyStateComponent, UiIconComponent, UiSkeletonComponent, RelativeTimePipe, FileSizePipe],
  template: `
    <header class="pg__head">
      <h1 class="pg__title">Trash</h1>
      @if (items().length) {
        <p class="tr__note">Deleted drawings stay here until you remove them permanently.</p>
      }
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
    } @else {
      <ul class="tr__list">
        @for (drawing of items(); track drawing.id) {
          <li class="tr__row">
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
    }
  `,
  styles: [
    `
      :host { display: block; }
      .pg__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ui-space-4); margin-bottom: var(--ui-space-5); flex-wrap: wrap; }
      .pg__title { margin: 0; font-size: var(--ui-text-xl); font-weight: 600; letter-spacing: -.01em; color: var(--ui-text-strong); }
      .tr__note { margin: 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

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
    `,
  ],
})
export class TrashPage {
  private readonly api = inject(DrawingsApiService);
  private readonly dialog = inject(UiDialogService);
  private readonly notify = inject(NotificationService);
  private readonly events = inject(DashboardEventsService);

  protected readonly items = signal<DrawingSummaryDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Id of the row with a request in flight, so its buttons disable. */
  protected readonly busy = signal<string | null>(null);

  private generation = 0;
  /** Revision this page produced itself; reloading for it would only flash the list. */
  private ownRevision = -1;

  constructor() {
    effect(() => {
      const revision = this.events.revision();
      untracked(() => {
        if (revision === this.ownRevision) return;
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
      const page = await this.api.trash();
      if (gen !== this.generation) return;
      this.items.set(page.items);
    } catch (e) {
      if (gen !== this.generation) return;
      this.items.set([]);
      this.error.set(messageOf(e));
    } finally {
      if (gen === this.generation) this.loading.set(false);
    }
  }

  protected async restore(drawing: DrawingSummaryDto): Promise<void> {
    if (this.busy()) return;
    this.busy.set(drawing.id);
    try {
      await this.api.restore(drawing.id);
      this.items.update((list) => list.filter((d) => d.id !== drawing.id));
      this.notify.success(`"${drawing.name}" was restored.`);
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
      this.items.update((list) => list.filter((d) => d.id !== drawing.id));
      this.notify.success(`"${drawing.name}" was deleted.`);
      this.announce();
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.busy.set(null);
    }
  }
}
