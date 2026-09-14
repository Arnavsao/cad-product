import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AuditEntryDto } from '../../../core/api/admin.models';
import {
  RelativeTimePipe,
  UiEmptyStateComponent,
  UiIconComponent,
  UiInputDirective,
  UiPaginatorComponent,
  UiSkeletonComponent,
} from '../../../shared/ui';

const PAGE_SIZE = 50;

/**
 * Who did what, newest first.
 *
 * Each row expands to the before/after snapshot, because "changed the account"
 * is not an audit trail — the value it changed from is the part that answers
 * questions weeks later.
 */
@Component({
  selector: 'app-admin-audit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UiIconComponent, UiInputDirective, UiPaginatorComponent, UiEmptyStateComponent, UiSkeletonComponent, RelativeTimePipe],
  template: `
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Audit log</h1>
        <p class="adm-lede">Who did what, newest first. Every row expands to the before and after.</p>
      </div>
      <div class="adm-actions">
        @if (total() > 0) { <span class="adm-muted">{{ total() | number }} {{ total() === 1 ? 'entry' : 'entries' }}</span> }
      </div>
    </div>

    <div class="adm-toolbar">
      <div class="adm-search">
        <ui-icon class="adm-search__icon" name="search" [size]="16" />
        <input uiInput id="admin-audit-filter" class="adm-search__input" type="search" placeholder="Filter by action, e.g. user.suspend" [value]="action()" (input)="onFilter($event)" />
      </div>
    </div>

    <div class="adm-table au__table" role="table" aria-label="Audit entries">
      <div class="adm-th" role="row">
        <span role="columnheader">Action</span>
        <span role="columnheader" class="adm-hide-md">Target</span>
        <span role="columnheader" class="adm-hide-sm">Actor</span>
        <span role="columnheader" class="adm-cell--right">When</span>
      </div>
      @if (loading()) {
        @for (i of [1, 2, 3, 4, 5, 6]; track i) {
          <div class="adm-tr adm-tr--static" role="row" aria-hidden="true">
            <span><ui-skeleton width="120px" height="14px" /></span>
            <span class="adm-hide-md"><ui-skeleton width="60%" height="14px" /></span>
            <span class="adm-hide-sm"><ui-skeleton width="70%" height="14px" /></span>
            <span><ui-skeleton width="60px" height="14px" /></span>
          </div>
        }
      } @else if (rows().length === 0) {
        <ui-empty-state icon="history" heading="Nothing recorded" description="Staff actions will appear here as they happen." />
      } @else {
        @for (row of rows(); track row.id) {
          <details class="au__row">
            <summary class="adm-tr au__summary" role="row">
              <span class="adm-mono adm-cell--strong adm-truncate" role="cell">{{ row.action }}</span>
              <span class="adm-cell--dim adm-truncate adm-hide-md" role="cell">{{ row.targetType }}{{ row.targetId ? ' · ' + row.targetId : '' }}</span>
              <span class="adm-cell--dim adm-truncate adm-hide-sm" role="cell">{{ row.actorEmail }}</span>
              <span class="adm-cell--right adm-cell--dim" role="cell">{{ row.createdAt | relativeTime }}</span>
            </summary>
            <div class="adm-detail">
              @if (row.reason) { <p class="au__reason"><span class="adm-kicker">Reason</span> {{ row.reason }}</p> }
              <div class="adm-grid-halves">
                <div class="adm-stack">
                  <p class="adm-kicker">Before</p>
                  <pre class="adm-pre">{{ json(row.before) }}</pre>
                </div>
                <div class="adm-stack">
                  <p class="adm-kicker">After</p>
                  <pre class="adm-pre">{{ json(row.after) }}</pre>
                </div>
              </div>
              @if (row.ip) { <p class="adm-muted">From {{ row.ip }}</p> }
            </div>
          </details>
        }
      }
    </div>

    @if (!loading() && rows().length > 0) {
      <ui-paginator [total]="total()" [page]="page()" [pageSize]="pageSize" [showPageSize]="false" noun="entry" nounPlural="entries" (pageChange)="setPage($event)" />
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .au__table { --adm-cols: 190px minmax(160px, 1fr) 220px 110px; }
      @media (max-width: 900px) { .au__table { --adm-cols: 190px 200px 110px; } }
      @media (max-width: 720px) { .au__table { --adm-cols: minmax(0, 1fr) 110px; } }
      .au__row { border-bottom: 1px solid var(--ui-border); }
      .au__row:last-child { border-bottom: 0; }
      .au__row > .adm-tr { border-bottom: 0; }
      .au__summary { cursor: pointer; list-style: none; }
      .au__summary::-webkit-details-marker { display: none; }
      .au__summary:hover { background: var(--ui-hover); }
      .au__summary:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
      .au__row[open] > .au__summary { background: var(--ui-active); }
      .au__reason { margin: 0; display: flex; gap: var(--ui-space-2); align-items: baseline; font-size: var(--ui-text-md); }
    `,
  ],
})
export class AdminAuditPage {
  private readonly api = inject(AdminApiService);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly rows = signal<AuditEntryDto[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly action = signal('');
  protected readonly loading = signal(true);

  private filterTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const result = await this.api.audit({
        action: this.action() || undefined,
        page: this.page(),
        pageSize: PAGE_SIZE,
      });
      this.rows.set(result.items);
      this.total.set(result.total ?? result.items.length);
    } catch {
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected onFilter(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.filterTimer) clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => {
      this.action.set(value);
      this.page.set(1);
      void this.load();
    }, 250);
  }

  protected setPage(page: number): void {
    this.page.set(page);
    void this.load();
  }

  /** `—` rather than `null`, so an absent snapshot does not read as a stored null. */
  protected json(value: unknown): string {
    return value === null || value === undefined ? '—' : JSON.stringify(value, null, 2);
  }
}
