import { DecimalPipe } from '@angular/common';
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
  UiIconComponent,
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
    DecimalPipe,
    RouterLink,
    UiIconComponent,
    UiInputDirective,
    UiBadgeComponent,
    UiPaginatorComponent,
    UiEmptyStateComponent,
    UiSkeletonComponent,
    FileSizePipe,
    RelativeTimePipe,
  ],
  template: `
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Users</h1>
        <p class="adm-lede">Every account, what it is entitled to, and how recently it was seen.</p>
      </div>
      <div class="adm-actions">
        @if (total() > 0) {
          <span class="adm-muted">{{ total() | number }} {{ total() === 1 ? 'account' : 'accounts' }}</span>
        }
      </div>
    </div>

    <div class="adm-toolbar">
      <div class="adm-search">
        <ui-icon class="adm-search__icon" name="search" [size]="16" />
        <input
          uiInput
          id="admin-user-search"
          type="search"
          class="adm-search__input"
          placeholder="Search by email or name"
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
    </div>

    @if (error(); as e) {
      <div class="adm-note adm-note--danger" role="alert">
        <ui-icon name="alert" [size]="18" />
        <div><p class="adm-note__title">Accounts could not be loaded.</p><p class="adm-note__msg">{{ e }}</p></div>
      </div>
    }

    <div class="adm-table us__table" role="table" aria-label="Accounts">
      <div class="adm-th" role="row">
        <span role="columnheader">Person</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" class="adm-hide-sm">Plan</span>
        <span role="columnheader" class="adm-cell--right adm-hide-md">Drawings</span>
        <span role="columnheader" class="adm-cell--right adm-hide-md">Storage</span>
        <span role="columnheader" class="adm-hide-lg">Last seen</span>
      </div>
      @if (loading()) {
        @for (i of [1, 2, 3, 4, 5, 6]; track i) {
          <div class="adm-tr adm-tr--static" role="row" aria-hidden="true">
            <span><ui-skeleton width="60%" height="14px" /></span>
            <span><ui-skeleton width="64px" height="18px" radius="var(--ui-radius-full)" /></span>
            <span class="adm-hide-sm"><ui-skeleton width="36px" height="14px" /></span>
            <span class="adm-hide-md"><ui-skeleton width="24px" height="14px" /></span>
            <span class="adm-hide-md"><ui-skeleton width="44px" height="14px" /></span>
            <span class="adm-hide-lg"><ui-skeleton width="70px" height="14px" /></span>
          </div>
        }
      } @else if (rows().length === 0) {
        <ui-empty-state icon="users" heading="No accounts match" description="Try a different search or status filter." />
      } @else {
        @for (row of rows(); track row.id) {
          <a class="adm-tr" role="row" [routerLink]="['/admin/users', row.id]">
            <span class="adm-two" role="cell">
              <span>{{ fullName(row) }}</span>
              <span>{{ row.email }}</span>
            </span>
            <span class="adm-cell--wrap" role="cell">
              <ui-badge [tone]="statusTone(row.status)">{{ row.status }}</ui-badge>
              @if (row.platformRole !== 'user') {
                <ui-badge tone="info">{{ row.platformRole }}</ui-badge>
              }
            </span>
            <span class="adm-hide-sm" role="cell">{{ row.plan }}</span>
            <span class="adm-cell--right adm-cell--dim adm-hide-md" role="cell">{{ row.drawingCount }}</span>
            <span class="adm-cell--right adm-cell--dim adm-hide-md" role="cell">{{ row.bytesUsed | fileSize }}</span>
            <span class="adm-cell--dim adm-hide-lg" role="cell">{{ row.lastSeenAt ? (row.lastSeenAt | relativeTime) : 'never' }}</span>
          </a>
        }
      }
    </div>

    @if (!loading() && rows().length > 0) {
      <ui-paginator [total]="total()" [page]="page()" [pageSize]="pageSize" [showPageSize]="false" noun="account" (pageChange)="setPage($event)" />
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .us__table { --adm-cols: minmax(200px, 2fr) 170px 70px 90px 100px 130px; }
      @media (max-width: 1100px) { .us__table { --adm-cols: minmax(200px, 2fr) 170px 70px 90px 100px; } }
      @media (max-width: 900px) { .us__table { --adm-cols: minmax(160px, 2fr) 170px 70px; } }
      @media (max-width: 720px) { .us__table { --adm-cols: minmax(0, 1fr) 150px; } }
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
