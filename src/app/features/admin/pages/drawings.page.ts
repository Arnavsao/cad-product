import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminDrawingRowDto, StorageOrphansDto } from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  FileSizePipe,
  RelativeTimePipe,
  UiBadgeComponent,
  UiButtonDirective,
  UiDialogService,
  UiEmptyStateComponent,
  UiInputDirective,
  UiPaginatorComponent,
  UiSkeletonComponent,
} from '../../../shared/ui';

const PAGE_SIZE = 25;

/**
 * Drawings and object storage.
 *
 * **Metadata only.** There is no way to open a customer's drawing from here,
 * by design: staff can see that it exists, how big it is and whether it is in
 * the trash, and can restore or permanently delete it. What is inside it is
 * theirs.
 *
 * The storage scan is on the same page because the question it answers —
 * "where is our storage going, and does the bucket still agree with the
 * database" — is the same question the list starts.
 */
@Component({
  selector: 'app-admin-drawings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiInputDirective,
    UiButtonDirective,
    UiBadgeComponent,
    UiEmptyStateComponent,
    UiPaginatorComponent,
    UiSkeletonComponent,
    FileSizePipe,
    RelativeTimePipe,
  ],
  template: `
    <div class="dw">
      <div class="dw__filters">
        <input
          uiInput
          id="admin-drawing-search"
          type="search"
          class="dw__search"
          placeholder="Search drawing names"
          (input)="onSearch($event)"
        />
        <div class="dw__chips" role="group" aria-label="Filter by state">
          @for (option of stateOptions; track option.value) {
            <button
              type="button"
              class="dw__chip"
              [class.dw__chip--on]="state() === option.value"
              (click)="setState(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
        @if (isOwner()) {
          <button uiButton variant="secondary" size="sm" class="dw__scan" [disabled]="scanning()" (click)="scan()">
            {{ scanning() ? 'Scanning…' : 'Scan storage' }}
          </button>
        }
      </div>

      @if (report(); as r) {
        <section class="dw__report">
          <h2 class="dw__heading">Storage scan</h2>
          <p class="dw__line">
            Looked at {{ r.scannedObjects }} objects{{ r.truncated ? ' (capped — there may be more)' : '' }}.
            Found {{ r.orphanedObjects.length }} orphaned
            ({{ r.reclaimableBytes | fileSize }} reclaimable) and {{ r.brokenDrawings.length }} drawings whose
            file is missing.
          </p>
          @if (r.brokenDrawings.length) {
            <p class="dw__warn">
              A missing file is not sweepable garbage — those drawings will fail to open for their owners.
            </p>
            <ul class="dw__broken">
              @for (broken of r.brokenDrawings; track broken.id) {
                <li>{{ broken.name }} — {{ broken.ownerEmail }}</li>
              }
            </ul>
          }
          @if (r.orphanedObjects.length) {
            <button uiButton variant="danger" size="sm" [disabled]="scanning()" (click)="purgeOrphans()">
              Delete {{ r.orphanedObjects.length }} orphaned objects
            </button>
          }
        </section>
      }

      @if (loading()) {
        <ui-skeleton height="40px" [lines]="8" />
      } @else if (rows().length === 0) {
        <ui-empty-state heading="No drawings match" description="Try a different search or state filter." />
      } @else {
        <div class="dw__list">
          @for (row of rows(); track row.id) {
            <div class="dw__row">
              <span class="dw__name">
                {{ row.name }}
                @if (row.deletedAt) {
                  <ui-badge tone="warning">in trash</ui-badge>
                }
              </span>
              <a class="dw__owner" [routerLink]="['/admin/users', row.ownerId]">{{ row.ownerEmail }}</a>
              <span class="dw__meta">{{ row.organizationName ?? 'personal' }}</span>
              <span class="dw__meta">{{ row.byteSize | fileSize }}</span>
              <span class="dw__meta">v{{ row.currentVersion }} · {{ row.updatedAt | relativeTime }}</span>
              @if (canManage()) {
                <span class="dw__actions">
                  @if (row.deletedAt) {
                    <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="restore(row)">
                      Restore
                    </button>
                  }
                  <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="purge(row)">Purge</button>
                </span>
              }
            </div>
          }
        </div>

        <ui-paginator [total]="total()" [page]="page()" [pageSize]="pageSize" (pageChange)="setPage($event)" />
      }
    </div>
  `,
  styles: [
    `
      .dw {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 1200px;
      }
      .dw__filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--ui-space-3);
      }
      .dw__search {
        flex: 1 1 220px;
        max-width: 320px;
      }
      .dw__chips {
        display: flex;
        gap: var(--ui-space-1);
      }
      .dw__chip {
        border: 1px solid var(--ui-border);
        background: var(--ui-surface);
        color: var(--ui-text-dim);
        border-radius: 999px;
        padding: 4px 12px;
        font-size: var(--ui-text-sm);
        cursor: pointer;
      }
      .dw__chip--on {
        background: var(--ui-surface-2);
        color: var(--ui-text);
        border-color: var(--ui-accent);
      }
      .dw__scan {
        margin-left: auto;
      }
      .dw__report {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--ui-space-2);
        padding: var(--ui-space-4);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
      }
      .dw__heading {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .dw__line,
      .dw__meta,
      .dw__owner {
        margin: 0;
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
      }
      .dw__warn {
        margin: 0;
        font-size: var(--ui-text-sm);
        color: var(--ui-warning, #d29922);
      }
      .dw__broken {
        margin: 0;
        padding-left: 18px;
        font-size: var(--ui-text-sm);
      }
      .dw__list {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
        overflow: hidden;
      }
      .dw__row {
        display: grid;
        grid-template-columns: minmax(0, 1.6fr) 180px 130px 90px 170px auto;
        gap: var(--ui-space-3);
        align-items: center;
        padding: 8px var(--ui-space-4);
        border-bottom: 1px solid var(--ui-border);
        font-size: var(--ui-text-sm);
      }
      .dw__row:last-child {
        border-bottom: 0;
      }
      .dw__name {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        font-weight: 600;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dw__owner {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dw__actions {
        display: flex;
        gap: var(--ui-space-1);
        justify-content: flex-end;
      }
      @media (max-width: 1000px) {
        .dw__row {
          grid-template-columns: minmax(0, 1fr) 90px auto;
        }
        .dw__owner,
        .dw__row .dw__meta:nth-of-type(1),
        .dw__row .dw__meta:nth-of-type(3) {
          display: none;
        }
      }
    `,
  ],
})
export class AdminDrawingsPage {
  private readonly api = inject(AdminApiService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(UiDialogService);
  private readonly me = inject(MeService);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly stateOptions: { value: 'all' | 'live' | 'trash'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'live', label: 'Live' },
    { value: 'trash', label: 'In trash' },
  ];

  protected readonly rows = signal<AdminDrawingRowDto[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly state = signal<'all' | 'live' | 'trash'>('all');
  protected readonly query = signal('');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly scanning = signal(false);
  protected readonly report = signal<StorageOrphansDto | null>(null);

  protected readonly canManage = computed(() => {
    const role = this.me.me()?.user.platformRole;
    return role === 'admin' || role === 'owner';
  });
  protected readonly isOwner = computed(() => this.me.me()?.user.platformRole === 'owner');

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const state = this.state();
      const result = await this.api.listDrawings({
        q: this.query() || undefined,
        deleted: state === 'all' ? undefined : state === 'trash' ? 'true' : 'false',
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

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.query.set(value);
      this.page.set(1);
      void this.load();
    }, 250);
  }

  protected setState(state: 'all' | 'live' | 'trash'): void {
    this.state.set(state);
    this.page.set(1);
    void this.load();
  }

  protected setPage(page: number): void {
    this.page.set(page);
    void this.load();
  }

  protected async restore(row: AdminDrawingRowDto): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.restoreDrawing(row.id);
      this.notify.success(`Restored ${row.name}`);
      await this.load();
    } catch {
      this.notify.error('Could not restore that drawing.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async purge(row: AdminDrawingRowDto): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Permanently delete "${row.name}"?`,
      message: 'The drawing, its versions and its files are deleted. This cannot be undone.',
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    const reason = globalThis.prompt('Reason (stored in the audit log)')?.trim();
    if (!reason || reason.length < 3) return;

    this.busy.set(true);
    try {
      const result = await this.api.purgeDrawing(row.id, reason);
      this.notify.success(`Deleted ${row.name}`);
      this.report.update((r) => (r ? { ...r, reclaimableBytes: r.reclaimableBytes + result.bytesFreed } : r));
      await this.load();
    } catch {
      this.notify.error('Could not delete that drawing.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async scan(): Promise<void> {
    this.scanning.set(true);
    try {
      this.report.set(await this.api.storageOrphans());
    } catch (error) {
      this.notify.error(
        (error as { code?: string })?.code === 'FORBIDDEN'
          ? 'The storage scan is owner-only.'
          : 'The scan did not finish.',
      );
    } finally {
      this.scanning.set(false);
    }
  }

  protected async purgeOrphans(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Delete orphaned objects',
      message: 'Storage is re-scanned first, so anything that became legitimate since the report is left alone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    this.scanning.set(true);
    try {
      const result = await this.api.purgeStorageOrphans();
      this.notify.success(`Deleted ${result.deleted} objects`);
      this.report.set(null);
    } catch {
      this.notify.error('Could not sweep storage.');
    } finally {
      this.scanning.set(false);
    }
  }
}
