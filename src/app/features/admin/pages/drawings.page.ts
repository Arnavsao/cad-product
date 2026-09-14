import { DecimalPipe } from '@angular/common';
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
  UiIconComponent,
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
    DecimalPipe,
    RouterLink,
    UiIconComponent,
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
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Drawings</h1>
        <p class="adm-lede">Every drawing as metadata: what exists, who owns it, how big it is. Nothing here opens one.</p>
      </div>
      <div class="adm-actions">
        @if (isOwner()) {
          <button uiButton variant="secondary" size="sm" [loading]="scanning()" (click)="scan()">
            <ui-icon name="cloud" [size]="16" /> Scan storage
          </button>
        }
      </div>
    </div>

    <div class="adm-toolbar">
      <div class="adm-search">
        <ui-icon class="adm-search__icon" name="search" [size]="16" />
        <input uiInput id="admin-drawing-search" type="search" class="adm-search__input" placeholder="Search drawing names" (input)="onSearch($event)" />
      </div>
      <div class="adm-chips" role="group" aria-label="Filter by state">
        @for (option of stateOptions; track option.value) {
          <button type="button" class="adm-chip" [class.adm-chip--on]="state() === option.value" (click)="setState(option.value)">
            {{ option.label }}
          </button>
        }
      </div>
      @if (total() > 0) {
        <span class="adm-muted adm-push">{{ total() | number }} {{ total() === 1 ? 'drawing' : 'drawings' }}</span>
      }
    </div>

    @if (report(); as r) {
      <section class="adm-card">
        <div class="adm-card__head">
          <p class="adm-kicker">Storage scan</p>
          @if (r.truncated) {
            <ui-badge tone="warning">capped — there may be more</ui-badge>
          }
        </div>
        <dl class="adm-facts">
          <div><dt>Objects looked at</dt><dd>{{ r.scannedObjects | number }}</dd></div>
          <div><dt>Orphaned objects</dt><dd>{{ r.orphanedObjects.length | number }}</dd></div>
          <div><dt>Reclaimable</dt><dd>{{ r.reclaimableBytes | fileSize }}</dd></div>
          <div><dt>Drawings missing their file</dt><dd [class.adm-danger-text]="r.brokenDrawings.length > 0">{{ r.brokenDrawings.length | number }}</dd></div>
        </dl>
        @if (r.brokenDrawings.length) {
          <div class="adm-note adm-note--danger">
            <ui-icon name="alert" [size]="18" />
            <div>
              <p class="adm-note__title">These drawings will fail to open for their owners.</p>
              <p class="adm-note__msg">A missing file is not sweepable garbage; the sweep leaves these alone.</p>
              <ul class="dw__broken">
                @for (broken of r.brokenDrawings; track broken.id) {
                  <li>{{ broken.name }} <span class="adm-muted">— {{ broken.ownerEmail }}</span></li>
                }
              </ul>
            </div>
          </div>
        }
        @if (r.orphanedObjects.length) {
          <div class="adm-actions">
            <button uiButton variant="danger" size="sm" [loading]="scanning()" (click)="purgeOrphans()">
              Delete {{ r.orphanedObjects.length }} orphaned {{ r.orphanedObjects.length === 1 ? 'object' : 'objects' }}
            </button>
            <span class="adm-muted">Storage is re-scanned first, so anything that became legitimate since is left alone.</span>
          </div>
        }
      </section>
    }

    <div class="adm-table dw__table" role="table" aria-label="Drawings">
      <div class="adm-th" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader" class="adm-hide-md">Owner</span>
        <span role="columnheader" class="adm-hide-lg">Workspace</span>
        <span role="columnheader" class="adm-cell--right adm-hide-sm">Size</span>
        <span role="columnheader" class="adm-hide-lg">Updated</span>
        @if (canManage()) {
          <span role="columnheader"></span>
        }
      </div>
      @if (loading()) {
        @for (i of [1, 2, 3, 4, 5, 6]; track i) {
          <div class="adm-tr adm-tr--static" role="row" aria-hidden="true">
            <span><ui-skeleton width="55%" height="14px" /></span>
            <span class="adm-hide-md"><ui-skeleton width="70%" height="14px" /></span>
            <span class="adm-hide-lg"><ui-skeleton width="50%" height="14px" /></span>
            <span class="adm-hide-sm"><ui-skeleton width="40px" height="14px" /></span>
            <span class="adm-hide-lg"><ui-skeleton width="80px" height="14px" /></span>
            @if (canManage()) { <span></span> }
          </div>
        }
      } @else if (rows().length === 0) {
        <ui-empty-state icon="file" heading="No drawings match" description="Try a different search or state filter." />
      } @else {
        @for (row of rows(); track row.id) {
          <div class="adm-tr adm-tr--static" role="row">
            <span class="adm-two" role="cell">
              <span class="adm-cell--wrap">
                <span class="adm-truncate">{{ row.name }}</span>
                @if (row.deletedAt) {
                  <ui-badge tone="warning">in trash</ui-badge>
                }
              </span>
              <span>{{ row.format }} · v{{ row.currentVersion }}</span>
            </span>
            <a class="adm-link adm-link--quiet adm-truncate adm-hide-md" role="cell" [routerLink]="['/admin/users', row.ownerId]">{{ row.ownerEmail }}</a>
            <span class="adm-cell--dim adm-truncate adm-hide-lg" role="cell">{{ row.organizationName ?? 'Personal' }}</span>
            <span class="adm-cell--right adm-cell--dim adm-hide-sm" role="cell">{{ row.byteSize | fileSize }}</span>
            <span class="adm-cell--dim adm-hide-lg" role="cell">{{ row.updatedAt | relativeTime }}</span>
            @if (canManage()) {
              <span class="dw__actions" role="cell">
                @if (row.deletedAt) {
                  <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="restore(row)">Restore</button>
                }
                <button uiButton variant="ghost" size="sm" class="adm-danger-text" [disabled]="busy()" (click)="purge(row)">Purge</button>
              </span>
            }
          </div>
        }
      }
    </div>

    @if (!loading() && rows().length > 0) {
      <ui-paginator [total]="total()" [page]="page()" [pageSize]="pageSize" [showPageSize]="false" noun="drawing" (pageChange)="setPage($event)" />
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .dw__table { --adm-cols: minmax(220px, 2fr) 200px 140px 90px 130px auto; }
      @media (max-width: 1100px) { .dw__table { --adm-cols: minmax(220px, 2fr) 200px 90px auto; } }
      @media (max-width: 900px) { .dw__table { --adm-cols: minmax(180px, 2fr) 90px auto; } }
      @media (max-width: 720px) { .dw__table { --adm-cols: minmax(0, 1fr) auto; } }
      .dw__actions { display: flex; justify-content: flex-end; gap: 2px; }
      .dw__broken { margin: var(--ui-space-2) 0 0; padding-left: 18px; font-size: var(--ui-text-sm); }
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
