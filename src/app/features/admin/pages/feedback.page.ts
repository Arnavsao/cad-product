import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AdminApiService } from '../../../core/api/admin-api.service';
import {
  AdminFeedbackRowDto,
  FeedbackKind,
  FeedbackStatus,
} from '../../../core/api/admin.models';
import {
  RelativeTimePipe,
  UiBadgeComponent,
  UiEmptyStateComponent,
  UiInputDirective,
  UiPaginatorComponent,
  UiSkeletonComponent,
  type UiBadgeTone,
} from '../../../shared/ui';

const PAGE_SIZE = 25;

/** Status → badge tone. New is the only one that should catch the eye. */
export function statusTone(status: FeedbackStatus): UiBadgeTone {
  switch (status) {
    case 'new':
      return 'warning';
    case 'in_progress':
      return 'info';
    case 'resolved':
      return 'success';
    default:
      return 'neutral';
  }
}

/** Human label for a status; the wire form has an underscore. */
export function statusLabel(status: FeedbackStatus): string {
  return status === 'in_progress' ? 'in progress' : status === 'wont_fix' ? "won't fix" : status;
}

/**
 * The beta's inbox.
 *
 * This is the surface the whole beta exists to feed, so the default view is the
 * work queue — everything still open, newest first — rather than an
 * undifferentiated list where a resolved report from last month sits beside
 * this morning's crash. Filters live in the URL so a triage session survives a
 * refresh and can be handed to someone else as a link.
 */
@Component({
  selector: 'app-admin-feedback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiInputDirective,
    UiBadgeComponent,
    UiPaginatorComponent,
    UiEmptyStateComponent,
    UiSkeletonComponent,
    RelativeTimePipe,
  ],
  template: `
    <div class="fb">
      <div class="fb__filters">
        <input
          uiInput
          id="admin-feedback-search"
          type="search"
          class="fb__search"
          placeholder="Search reports and senders"
          [value]="query()"
          (input)="onSearch($event)"
        />
        <div class="fb__chips" role="group" aria-label="Filter by status">
          @for (option of statusOptions; track option.value) {
            <button
              type="button"
              class="fb__chip"
              [class.fb__chip--on]="status() === option.value"
              (click)="setStatus(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
        <div class="fb__chips" role="group" aria-label="Filter by kind">
          @for (option of kindOptions; track option.value) {
            <button
              type="button"
              class="fb__chip"
              [class.fb__chip--on]="kind() === option.value"
              (click)="setKind(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
        <a class="fb__export" [href]="exportUrl()" download>Export CSV</a>
      </div>

      @if (appVersion(); as version) {
        <p class="fb__scope">
          Showing reports from build <strong>{{ version }}</strong>.
          <button type="button" class="fb__clear" (click)="clearVersion()">Show all builds</button>
        </p>
      }

      @if (loading()) {
        <ui-skeleton height="44px" [lines]="8" />
      } @else if (rows().length === 0) {
        <ui-empty-state
          heading="Nothing here"
          description="No reports match these filters. Try widening the status or kind."
        />
      } @else {
        <div class="fb__list">
          @for (row of rows(); track row.id) {
            <a class="fb__row" [routerLink]="['/admin/feedback', row.id]">
              <span class="fb__badges">
                <ui-badge [tone]="tone(row.status)">{{ label(row.status) }}</ui-badge>
                <ui-badge>{{ row.kind }}</ui-badge>
              </span>
              <span class="fb__excerpt">{{ row.excerpt }}</span>
              <span class="fb__from">
                {{ row.fromName || row.fromEmail || 'anonymous' }}
                @if (row.appVersion) {
                  <button type="button" class="fb__version" (click)="filterVersion($event, row.appVersion)">
                    {{ row.appVersion }}
                  </button>
                }
              </span>
              <span class="fb__meta">
                @if (row.repliedAt) {
                  <ui-badge tone="success">replied</ui-badge>
                }
                @if (row.assigneeEmail) {
                  <span class="fb__assignee">{{ row.assigneeEmail }}</span>
                }
                <span>{{ row.createdAt | relativeTime }}</span>
              </span>
            </a>
          }
        </div>

        <ui-paginator [total]="total()" [page]="page()" [pageSize]="pageSize" (pageChange)="setPage($event)" />
      }
    </div>
  `,
  styles: [
    `
      .fb {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 1200px;
      }
      .fb__filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--ui-space-3);
      }
      .fb__search {
        flex: 1 1 220px;
        max-width: 320px;
      }
      .fb__chips {
        display: flex;
        gap: var(--ui-space-1);
        flex-wrap: wrap;
      }
      .fb__chip {
        border: 1px solid var(--ui-border);
        background: var(--ui-surface);
        color: var(--ui-text-dim);
        border-radius: 999px;
        padding: 4px 12px;
        font-size: var(--ui-text-sm);
        cursor: pointer;
      }
      .fb__chip--on {
        background: var(--ui-surface-2);
        color: var(--ui-text);
        border-color: var(--ui-accent);
      }
      .fb__export {
        margin-left: auto;
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
        text-decoration: none;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-sm);
        padding: 5px 12px;
      }
      .fb__export:hover {
        color: var(--ui-text);
        background: var(--ui-surface-2);
      }
      .fb__scope,
      .fb__assignee {
        margin: 0;
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
      }
      .fb__clear,
      .fb__version {
        background: none;
        border: 0;
        padding: 0;
        color: var(--ui-accent);
        font: inherit;
        cursor: pointer;
        text-decoration: underline;
      }
      .fb__version {
        font-size: 11px;
        margin-left: var(--ui-space-2);
      }
      .fb__list {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
        overflow: hidden;
      }
      .fb__row {
        display: grid;
        grid-template-columns: 150px minmax(0, 1fr) 200px 220px;
        gap: var(--ui-space-3);
        align-items: center;
        padding: 10px var(--ui-space-4);
        border-bottom: 1px solid var(--ui-border);
        color: inherit;
        text-decoration: none;
        font-size: var(--ui-text-sm);
      }
      .fb__row:last-child {
        border-bottom: 0;
      }
      .fb__row:hover {
        background: var(--ui-surface-2);
      }
      .fb__badges {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .fb__excerpt {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .fb__from,
      .fb__meta {
        color: var(--ui-text-dim);
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        min-width: 0;
      }
      .fb__meta {
        justify-content: flex-end;
      }
      .fb__from {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (max-width: 980px) {
        .fb__row {
          grid-template-columns: 130px minmax(0, 1fr);
        }
        .fb__from,
        .fb__meta {
          display: none;
        }
      }
    `,
  ],
})
export class AdminFeedbackPage {
  private readonly api = inject(AdminApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly statusOptions: { value: FeedbackStatus | 'open' | 'all'; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'new', label: 'New' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'all', label: 'All' },
  ];
  protected readonly kindOptions: { value: FeedbackKind | 'all'; label: string }[] = [
    { value: 'all', label: 'Any kind' },
    { value: 'bug', label: 'Bugs' },
    { value: 'idea', label: 'Ideas' },
    { value: 'question', label: 'Questions' },
  ];

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly query = computed(() => this.params()?.get('q') ?? '');
  /** Defaults to the work queue rather than everything ever submitted. */
  protected readonly status = computed<FeedbackStatus | 'open' | 'all'>(
    () => (this.params()?.get('status') as FeedbackStatus | null) ?? 'open',
  );
  protected readonly kind = computed<FeedbackKind | 'all'>(
    () => (this.params()?.get('kind') as FeedbackKind | null) ?? 'all',
  );
  protected readonly appVersion = computed(() => this.params()?.get('appVersion'));
  protected readonly page = computed(() => Number(this.params()?.get('page') ?? '1') || 1);

  protected readonly rows = signal<AdminFeedbackRowDto[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);

  protected readonly tone = statusTone;
  protected readonly label = statusLabel;

  protected readonly exportUrl = computed(() =>
    this.api.feedbackExportUrl({
      q: this.query() || undefined,
      status: this.status() === 'open' || this.status() === 'all' ? undefined : (this.status() as FeedbackStatus),
      kind: this.kind() === 'all' ? undefined : (this.kind() as FeedbackKind),
      appVersion: this.appVersion() ?? undefined,
    }),
  );

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const params = {
        q: this.query(),
        status: this.status(),
        kind: this.kind(),
        appVersion: this.appVersion(),
        page: this.page(),
      };
      void this.load(params);
    });
  }

  /**
   * "Open" is three statuses, and the API takes one. Rather than teach the
   * endpoint a pseudo-status, the client asks for each and merges — three small
   * indexed queries, and the server's filter vocabulary stays honest.
   */
  private async load(params: {
    q: string;
    status: FeedbackStatus | 'open' | 'all';
    kind: FeedbackKind | 'all';
    appVersion: string | null;
    page: number;
  }): Promise<void> {
    this.loading.set(true);
    const base = {
      q: params.q || undefined,
      kind: params.kind === 'all' ? undefined : (params.kind as FeedbackKind),
      appVersion: params.appVersion ?? undefined,
      page: params.page,
      pageSize: PAGE_SIZE,
    };
    try {
      if (params.status === 'open') {
        const pages = await Promise.all(
          (['new', 'triaged', 'in_progress'] as FeedbackStatus[]).map((status) =>
            this.api.listFeedback({ ...base, status, page: 1, pageSize: PAGE_SIZE }),
          ),
        );
        const merged = pages
          .flatMap((p) => p.items)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, PAGE_SIZE);
        this.rows.set(merged);
        this.total.set(pages.reduce((sum, p) => sum + (p.total ?? p.items.length), 0));
      } else {
        const result = await this.api.listFeedback({
          ...base,
          status: params.status === 'all' ? undefined : (params.status as FeedbackStatus),
        });
        this.rows.set(result.items);
        this.total.set(result.total ?? result.items.length);
      }
    } catch {
      this.rows.set([]);
      this.total.set(0);
    } finally {
      this.loading.set(false);
    }
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.patch({ q: value || null, page: null }), 250);
  }

  protected setStatus(status: FeedbackStatus | 'open' | 'all'): void {
    this.patch({ status: status === 'open' ? null : status, page: null });
  }

  protected setKind(kind: FeedbackKind | 'all'): void {
    this.patch({ kind: kind === 'all' ? null : kind, page: null });
  }

  /** From a row: "show me everything else broken in this build". */
  protected filterVersion(event: Event, version: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.patch({ appVersion: version, page: null });
  }

  protected clearVersion(): void {
    this.patch({ appVersion: null, page: null });
  }

  protected setPage(page: number): void {
    this.patch({ page: page === 1 ? null : String(page) });
  }

  private patch(params: Record<string, string | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
