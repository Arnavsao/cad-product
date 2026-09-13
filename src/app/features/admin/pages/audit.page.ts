import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AuditEntryDto } from '../../../core/api/admin.models';
import {
  RelativeTimePipe,
  UiEmptyStateComponent,
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
  imports: [UiInputDirective, UiPaginatorComponent, UiEmptyStateComponent, UiSkeletonComponent, RelativeTimePipe],
  template: `
    <div class="audit">
      <input
        uiInput
        id="admin-audit-filter"
        class="audit__filter"
        type="search"
        placeholder="Filter by action, e.g. user.suspend"
        [value]="action()"
        (input)="onFilter($event)"
      />

      @if (loading()) {
        <ui-skeleton height="40px" [lines]="8" />
      } @else if (rows().length === 0) {
        <ui-empty-state heading="Nothing recorded" description="Staff actions will appear here as they happen." />
      } @else {
        <div class="audit__list">
          @for (row of rows(); track row.id) {
            <details class="audit__row">
              <summary class="audit__summary">
                <span class="audit__action">{{ row.action }}</span>
                <span class="audit__target">{{ row.targetType }}{{ row.targetId ? ' · ' + row.targetId : '' }}</span>
                <span class="audit__actor">{{ row.actorEmail }}</span>
                <span class="audit__when">{{ row.createdAt | relativeTime }}</span>
              </summary>
              <div class="audit__body">
                @if (row.reason) {
                  <p class="audit__reason">Reason: {{ row.reason }}</p>
                }
                @if (row.ip) {
                  <p class="audit__meta">From {{ row.ip }}</p>
                }
                <div class="audit__diff">
                  <div>
                    <h3>Before</h3>
                    <pre>{{ json(row.before) }}</pre>
                  </div>
                  <div>
                    <h3>After</h3>
                    <pre>{{ json(row.after) }}</pre>
                  </div>
                </div>
              </div>
            </details>
          }
        </div>

        <ui-paginator [total]="total()" [page]="page()" [pageSize]="pageSize" (pageChange)="setPage($event)" />
      }
    </div>
  `,
  styles: [
    `
      .audit {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 1100px;
      }
      .audit__filter {
        max-width: 320px;
      }
      .audit__list {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
        overflow: hidden;
      }
      .audit__row {
        border-bottom: 1px solid var(--ui-border);
      }
      .audit__row:last-child {
        border-bottom: 0;
      }
      .audit__summary {
        display: grid;
        grid-template-columns: 180px minmax(0, 1fr) 200px 120px;
        gap: var(--ui-space-3);
        align-items: center;
        padding: 10px var(--ui-space-4);
        cursor: pointer;
        font-size: var(--ui-text-sm);
      }
      .audit__summary:hover {
        background: var(--ui-surface-2);
      }
      .audit__action {
        font-family: var(--ui-font-mono, ui-monospace, monospace);
        font-weight: 600;
      }
      .audit__target,
      .audit__actor,
      .audit__when {
        color: var(--ui-text-dim);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .audit__body {
        padding: 0 var(--ui-space-4) var(--ui-space-4);
        font-size: var(--ui-text-sm);
      }
      .audit__reason {
        margin: 0 0 var(--ui-space-2);
      }
      .audit__meta {
        margin: 0 0 var(--ui-space-2);
        color: var(--ui-text-dim);
      }
      .audit__diff {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: var(--ui-space-3);
      }
      .audit__diff h3 {
        margin: 0 0 4px;
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .audit__diff pre {
        margin: 0;
        padding: var(--ui-space-3);
        background: var(--ui-surface-2);
        border-radius: var(--ui-radius-sm);
        overflow-x: auto;
        font-size: 12px;
      }
      @media (max-width: 860px) {
        .audit__summary {
          grid-template-columns: minmax(0, 1fr) 110px;
        }
        .audit__target,
        .audit__actor {
          display: none;
        }
      }
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
