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
  UiButtonDirective,
  UiEmptyStateComponent,
  UiIconComponent,
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
    UiButtonDirective,
    UiIconComponent,
    UiInputDirective,
    UiBadgeComponent,
    UiPaginatorComponent,
    UiEmptyStateComponent,
    UiSkeletonComponent,
    RelativeTimePipe,
  ],
  template: `
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Feedback</h1>
        <p class="adm-lede">The beta's inbox. Opens on everything still waiting for someone.</p>
      </div>
      <div class="adm-actions">
        <a uiButton variant="secondary" size="sm" [href]="exportUrl()" download>
          <ui-icon name="download" [size]="16" /> Export CSV
        </a>
      </div>
    </div>

    <div class="adm-toolbar">
      <div class="adm-search">
        <ui-icon class="adm-search__icon" name="search" [size]="16" />
        <input
          uiInput
          id="admin-feedback-search"
          type="search"
          class="adm-search__input"
          placeholder="Search reports and senders"
          [value]="query()"
          (input)="onSearch($event)"
        />
      </div>
      <div class="adm-chips" role="group" aria-label="Filter by status">
        @for (option of statusOptions; track option.value) {
          <button type="button" class="adm-chip" [class.adm-chip--on]="status() === option.value" (click)="setStatus(option.value)">
            {{ option.label }}
          </button>
        }
      </div>
      <div class="adm-chips" role="group" aria-label="Filter by kind">
        @for (option of kindOptions; track option.value) {
          <button type="button" class="adm-chip" [class.adm-chip--on]="kind() === option.value" (click)="setKind(option.value)">
            {{ option.label }}
          </button>
        }
      </div>
    </div>

    @if (appVersion(); as version) {
      <div class="adm-note adm-note--accent">
        <ui-icon name="tag" [size]="18" />
        <div>
          <p class="adm-note__title">Showing reports from build {{ version }}</p>
          <p class="adm-note__msg">Everything else that broke in this build, in one place.</p>
        </div>
        <button uiButton variant="ghost" size="sm" (click)="clearVersion()">Show all builds</button>
      </div>
    }

    <div class="adm-table fb__table" role="table" aria-label="Feedback">
      <div class="adm-th" role="row">
        <span role="columnheader">Status</span>
        <span role="columnheader">Report</span>
        <span role="columnheader" class="adm-hide-md">From</span>
        <span role="columnheader" class="adm-hide-lg">Assigned</span>
        <span role="columnheader" class="adm-cell--right adm-hide-sm">Received</span>
      </div>
      @if (loading()) {
        @for (i of [1, 2, 3, 4, 5]; track i) {
          <div class="adm-tr adm-tr--static" role="row" aria-hidden="true">
            <span><ui-skeleton width="90px" height="18px" radius="var(--ui-radius-full)" /></span>
            <span><ui-skeleton width="75%" height="14px" /></span>
            <span class="adm-hide-md"><ui-skeleton width="60%" height="14px" /></span>
            <span class="adm-hide-lg"><ui-skeleton width="50%" height="14px" /></span>
            <span class="adm-hide-sm"><ui-skeleton width="60px" height="14px" /></span>
          </div>
        }
      } @else if (rows().length === 0) {
        <ui-empty-state icon="message" heading="Nothing here" description="No reports match these filters. Try widening the status or kind." />
      } @else {
        @for (row of rows(); track row.id) {
          <a class="adm-tr" role="row" [routerLink]="['/admin/feedback', row.id]">
            <span class="adm-cell--wrap" role="cell">
              <ui-badge [tone]="tone(row.status)">{{ label(row.status) }}</ui-badge>
              @if (row.repliedAt) {
                <ui-badge tone="success">replied</ui-badge>
              }
            </span>
            <span class="adm-two" role="cell">
              <span>{{ row.excerpt }}</span>
              <span>
                {{ row.kind }}
                @if (row.appVersion) {
                  · <button type="button" class="fb__version" (click)="filterVersion($event, row.appVersion)">{{ row.appVersion }}</button>
                }
              </span>
            </span>
            <span class="adm-cell--dim adm-truncate adm-hide-md" role="cell">{{ row.fromName || row.fromEmail || 'anonymous' }}</span>
            <span class="adm-cell--dim adm-truncate adm-hide-lg" role="cell">{{ row.assigneeEmail ?? '—' }}</span>
            <span class="adm-cell--right adm-cell--dim adm-hide-sm" role="cell">{{ row.createdAt | relativeTime }}</span>
          </a>
        }
      }
    </div>

    @if (!loading() && rows().length > 0) {
      <ui-paginator [total]="total()" [page]="page()" [pageSize]="pageSize" [showPageSize]="false" noun="report" (pageChange)="setPage($event)" />
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .fb__table { --adm-cols: 150px minmax(240px, 2fr) 180px 180px 110px; }
      @media (max-width: 1100px) { .fb__table { --adm-cols: 150px minmax(240px, 2fr) 180px 110px; } }
      @media (max-width: 900px) { .fb__table { --adm-cols: 150px minmax(200px, 2fr) 110px; } }
      @media (max-width: 720px) { .fb__table { --adm-cols: 130px minmax(0, 1fr); } }
      .fb__version {
        padding: 0; border: 0; background: none; font: inherit; color: var(--ui-accent); cursor: pointer;
        text-decoration: underline; text-decoration-color: transparent; transition: text-decoration-color var(--ui-dur-fast);
      }
      .fb__version:hover { text-decoration-color: currentColor; }
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
