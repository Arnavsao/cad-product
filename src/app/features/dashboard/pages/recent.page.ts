import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DrawingSummaryDto } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiEmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { RelativeTimePipe } from '../../../shared/ui/pipes/relative-time.pipe';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { DrawingCardComponent } from '../components/drawing-card.component';
import { toDrawingAction } from '../components/drawing-menu';
import { NewDrawingMenuComponent } from '../components/new-drawing-menu.component';
import { DashboardEventsService } from '../data/dashboard-events.service';
import { DrawingActionsService } from '../data/drawing-actions.service';
import { messageOf } from '../data/drawings-list.store';

const RECENT_LIMIT = 12;

/**
 * `/dashboard` — the landing view: a "Continue where you left off" hero for the
 * single most recently opened drawing, then the rest as tiles.
 *
 * Design decision: no store. `GET /drawings/recent` is one unpaginated call
 * with a fixed limit, so three signals (items / loading / error) say everything
 * there is to say; `DrawingsListStore` exists for the paginated browser and
 * would only add ceremony here. Mutations from the row menus are applied to
 * `items` locally, and shell-level changes come in through `DashboardEvents`.
 */
@Component({
  selector: 'app-recent-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UiButtonDirective,
    UiEmptyStateComponent,
    UiIconComponent,
    UiSkeletonComponent,
    RelativeTimePipe,
    DrawingCardComponent,
    NewDrawingMenuComponent,
  ],
  template: `
    <header class="pg__head">
      <h1 class="pg__title">Recent</h1>
      @if (!loading() && items().length) {
        <button type="button" uiButton variant="ghost" size="sm" (click)="reload()">
          <ui-icon name="refresh" [size]="14" />
          Refresh
        </button>
      }
    </header>

    @if (loading()) {
      <div class="rc__hero rc__hero--skeleton"><ui-skeleton width="100%" height="150px" radius="var(--ui-radius-lg)" /></div>
      <div class="rc__grid">
        @for (i of skeletons; track i) {
          <ui-skeleton width="100%" height="190px" radius="var(--ui-radius-lg)" />
        }
      </div>
    } @else if (error(); as message) {
      <div class="pg__error" role="alert">
        <ui-icon name="alert" [size]="18" />
        <div>
          <p class="pg__error-title">Your recent drawings could not be loaded.</p>
          <p class="pg__error-msg">{{ message }}</p>
        </div>
        <button type="button" uiButton (click)="reload()"><ui-icon name="refresh" [size]="14" /> Retry</button>
      </div>
    } @else if (!items().length) {
      <ui-empty-state
        icon="file"
        heading="Nothing yet — create your first drawing."
        description="New drawings open straight in the editor and are saved to your account."
      >
        <app-new-drawing-menu (created)="reload()" />
      </ui-empty-state>
    } @else {
      @if (hero(); as top) {
        <section class="rc__hero">
          <div class="rc__hero-thumb">
            @if (top.thumbnailUrl && !heroThumbFailed()) {
              <img [src]="top.thumbnailUrl" alt="" decoding="async" (error)="heroThumbFailed.set(true)" />
            } @else {
              <ui-icon name="file" [size]="30" [strokeWidth]="1.4" />
            }
          </div>
          <div class="rc__hero-body">
            <p class="rc__hero-eyebrow">Continue where you left off</p>
            <h2 class="rc__hero-name">{{ top.name }}</h2>
            <p class="rc__hero-sub">Opened {{ (top.lastOpenedAt ?? top.updatedAt) | relativeTime }}</p>
            <button type="button" uiButton variant="primary" (click)="open(top)">
              Open drawing
              <ui-icon name="chevron-right" [size]="15" />
            </button>
          </div>
        </section>
      }

      @if (rest().length) {
        <h2 class="pg__subtitle">Recently opened</h2>
        <div class="rc__grid">
          @for (drawing of rest(); track drawing.id) {
            <app-drawing-card [drawing]="drawing" (open)="open(drawing)" (action)="onAction($event, drawing)" />
          }
        </div>
      }
    }
  `,
  styles: [
    `
      :host { display: block; }
      .pg__head { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4); margin-bottom: var(--ui-space-5); }
      .pg__title { margin: 0; font-size: var(--ui-text-xl); font-weight: 600; letter-spacing: -.01em; color: var(--ui-text-strong); }
      .pg__subtitle { margin: var(--ui-space-8) 0 var(--ui-space-4); font-size: var(--ui-text-base); font-weight: 600; color: var(--ui-text-dim); }
      .pg__error {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 14px 16px; border: 1px solid var(--ui-danger); border-radius: var(--ui-radius-lg);
        background: var(--ui-danger-tint);
      }
      .pg__error > ui-icon { color: var(--ui-danger); flex: 0 0 auto; }
      .pg__error > div { flex: 1; min-width: 0; }
      .pg__error-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .pg__error-msg { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .rc__hero {
        display: flex; gap: var(--ui-space-6); align-items: stretch;
        padding: var(--ui-space-5);
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xl);
        background: linear-gradient(120deg, var(--ui-accent-tint), transparent 60%), var(--ui-surface);
      }
      .rc__hero--skeleton { display: block; padding: 0; border: 0; background: none; }
      .rc__hero-thumb {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 230px; height: 144px; overflow: hidden;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg);
        background: var(--ui-bg); color: var(--ui-text-dim);
      }
      .rc__hero-thumb img { width: 100%; height: 100%; object-fit: contain; }
      .rc__hero-body { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; min-width: 0; }
      .rc__hero-eyebrow { margin: 0; font-size: var(--ui-text-sm); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ui-accent); }
      .rc__hero-name {
        margin: 4px 0 0; font-size: var(--ui-text-2xl); font-weight: 650; letter-spacing: -.02em; color: var(--ui-text-strong);
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .rc__hero-sub { margin: 0 0 var(--ui-space-4); font-size: var(--ui-text-md); color: var(--ui-text-dim); }

      .rc__grid {
        display: grid; gap: var(--ui-space-4);
        grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
        margin-top: var(--ui-space-4);
      }

      @media (max-width: 720px) {
        .rc__hero { flex-direction: column; }
        .rc__hero-thumb { width: 100%; }
      }
    `,
  ],
})
export class RecentPage {
  private readonly api = inject(DrawingsApiService);
  private readonly actions = inject(DrawingActionsService);
  private readonly events = inject(DashboardEventsService);

  protected readonly items = signal<DrawingSummaryDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly heroThumbFailed = signal(false);
  protected readonly skeletons = Array.from({ length: 6 }, (_, i) => i);

  protected readonly hero = computed<DrawingSummaryDto | null>(() => this.items()[0] ?? null);
  protected readonly rest = computed(() => this.items().slice(1));

  private generation = 0;

  constructor() {
    // Reload on mount and whenever the shell reports a change (upload, new folder…).
    effect(() => {
      this.events.revision();
      untracked(() => void this.reload());
    });
  }

  protected async reload(): Promise<void> {
    const gen = ++this.generation;
    this.loading.set(true);
    this.error.set(null);
    try {
      const items = await this.api.recent(RECENT_LIMIT);
      if (gen !== this.generation) return;
      this.items.set(items);
      this.heroThumbFailed.set(false);
    } catch (e) {
      if (gen !== this.generation) return;
      this.items.set([]);
      this.error.set(messageOf(e));
    } finally {
      if (gen === this.generation) this.loading.set(false);
    }
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
        this.items.update((list) => list.map((d) => (d.id === result.drawing.id ? result.drawing : d)));
        break;
      case 'created':
        this.items.update((list) => [result.drawing, ...list]);
        break;
      case 'removed':
        this.items.update((list) => list.filter((d) => d.id !== result.id));
        break;
      case 'none':
        break;
    }
  }
}
