import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AccountStatus, AdminUserRowDto } from '../../../core/api/admin.models';
import {
  FileSizePipe,
  RelativeTimePipe,
  UiBadgeComponent,
  UiEmptyStateComponent,
  UiInputDirective,
  UiPaginatorComponent,
  UiSkeletonComponent,
  type UiBadgeTone,
} from '../../../shared/ui';

const PAGE_SIZE = 25;

/**
 * The account list: search, filter, and a way into one person's detail page.
 *
 * Filter state lives in the URL so a staff member can send a colleague "the
 * suspended accounts" as a link, and so the back button behaves. Search is
 * debounced because it hits an ILIKE across three columns.
 */
@Component({
  selector: 'app-admin-users',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiInputDirective,
    UiBadgeComponent,
    UiPaginatorComponent,
    UiEmptyStateComponent,
    UiSkeletonComponent,
    FileSizePipe,
    RelativeTimePipe,
  ],
  template: `
    <div class="users">
      <div class="users__filters">
        <input
          uiInput
          id="admin-user-search"
          type="search"
          class="users__search"
          placeholder="Search email or name"
          [value]="query()"
          (input)="onSearch($event)"
        />
        <div class="users__chips" role="group" aria-label="Filter by status">
          @for (option of statusOptions; track option.value) {
            <button
              type="button"
              class="users__chip"
              [class.users__chip--on]="status() === option.value"
              (click)="setStatus(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      </div>

      @if (error()) {
        <p class="users__error">{{ error() }}</p>
      }

      @if (loading()) {
        <ui-skeleton height="36px" [lines]="8" />
      } @else if (rows().length === 0) {
        <ui-empty-state heading="No accounts match" description="Try a different search or status filter." />
      } @else {
        <div class="users__table" role="table">
          <div class="users__head" role="row">
            <span role="columnheader">Person</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Plan</span>
            <span role="columnheader">Drawings</span>
            <span role="columnheader">Storage</span>
            <span role="columnheader">Last seen</span>
          </div>
          @for (row of rows(); track row.id) {
            <a class="users__row" role="row" [routerLink]="['/admin/users', row.id]">
              <span class="users__person" role="cell">
                <span class="users__name">{{ fullName(row) }}</span>
                <span class="users__email">{{ row.email }}</span>
              </span>
              <span role="cell">
                <ui-badge [tone]="statusTone(row.status)">{{ row.status }}</ui-badge>
                @if (row.platformRole !== 'user') {
                  <ui-badge tone="info">{{ row.platformRole }}</ui-badge>
                }
              </span>
              <span role="cell">{{ row.plan }}</span>
              <span role="cell" class="users__num">{{ row.drawingCount }}</span>
              <span role="cell" class="users__num">{{ row.bytesUsed | fileSize }}</span>
              <span role="cell">{{ row.lastSeenAt ? (row.lastSeenAt | relativeTime) : 'never' }}</span>
            </a>
          }
        </div>

        <ui-paginator
          [total]="total()"
          [page]="page()"
          [pageSize]="pageSize"
          (pageChange)="setPage($event)"
        />
      }
    </div>
  `,
  styles: [
    `
      .users {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 1200px;
      }
      .users__filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--ui-space-3);
      }
      .users__search {
        flex: 1 1 240px;
        max-width: 360px;
      }
      .users__chips {
        display: flex;
        gap: var(--ui-space-1);
      }
      .users__chip {
        border: 1px solid var(--ui-border);
        background: var(--ui-surface);
        color: var(--ui-text-dim);
        border-radius: 999px;
        padding: 4px 12px;
        font-size: var(--ui-text-sm);
        cursor: pointer;
      }
      .users__chip--on {
        background: var(--ui-surface-2);
        color: var(--ui-text);
        border-color: var(--ui-accent);
      }
      .users__table {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        overflow: hidden;
        background: var(--ui-surface);
      }
      .users__head,
      .users__row {
        display: grid;
        grid-template-columns: minmax(200px, 2fr) 150px 80px 90px 100px 120px;
        gap: var(--ui-space-3);
        align-items: center;
        padding: 10px var(--ui-space-4);
      }
      .users__head {
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
        border-bottom: 1px solid var(--ui-border);
        background: var(--ui-surface-2);
      }
      .users__row {
        border-bottom: 1px solid var(--ui-border);
        color: inherit;
        text-decoration: none;
        font-size: var(--ui-text-sm);
      }
      .users__row:last-child {
        border-bottom: 0;
      }
      .users__row:hover {
        background: var(--ui-surface-2);
      }
      .users__person {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .users__name {
        font-weight: 600;
      }
      .users__email,
      .users__num {
        color: var(--ui-text-dim);
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .users__error {
        margin: 0;
        color: var(--ui-danger, #f85149);
        font-size: var(--ui-text-sm);
      }
      @media (max-width: 900px) {
        .users__head,
        .users__row {
          grid-template-columns: minmax(160px, 2fr) 130px 90px;
        }
        .users__head span:nth-child(n + 4),
        .users__row span:nth-child(n + 4) {
          display: none;
        }
      }
    `,
  ],
})
export class AdminUsersPage {
  private readonly api = inject(AdminApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly statusOptions: { value: AccountStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'deleted', label: 'Deleted' },
  ];

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly query = computed(() => this.params()?.get('q') ?? '');
  protected readonly status = computed<AccountStatus | 'all'>(
    () => (this.params()?.get('status') as AccountStatus | null) ?? 'all',
  );
  protected readonly page = computed(() => Number(this.params()?.get('page') ?? '1') || 1);

  protected readonly rows = signal<AdminUserRowDto[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // One effect keyed on the URL: every filter change is a navigation, so the
    // list reloads from exactly one place and back/forward work for free.
    effect(() => {
      const q = this.query();
      const status = this.status();
      const page = this.page();
      void this.load(q, status, page);
    });
  }

  private async load(q: string, status: AccountStatus | 'all', page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.api.listUsers({
        q: q || undefined,
        status: status === 'all' ? undefined : status,
        page,
        pageSize: PAGE_SIZE,
      });
      this.rows.set(result.items);
      this.total.set(result.total ?? result.items.length);
    } catch (error) {
      this.error.set((error as { message?: string })?.message ?? 'Could not load accounts.');
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    // Debounced: the query is an ILIKE over three columns, so typing should not
    // issue one of those per keystroke.
    this.searchTimer = setTimeout(() => this.patch({ q: value || null, page: null }), 250);
  }

  protected setStatus(status: AccountStatus | 'all'): void {
    this.patch({ status: status === 'all' ? null : status, page: null });
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

  protected fullName(row: AdminUserRowDto): string {
    return [row.firstName, row.lastName].filter(Boolean).join(' ') || '—';
  }

  protected statusTone(status: AccountStatus): UiBadgeTone {
    if (status === 'suspended') return 'warning';
    return status === 'deleted' ? 'danger' : 'success';
  }
}
