import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DrawingFormat, VersionDto } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UI_DIALOG_DATA, UiDialogRef } from '../../../shared/ui/dialog/ui-dialog-ref';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { FileSizePipe } from '../../../shared/ui/pipes/file-size.pipe';
import { RelativeTimePipe } from '../../../shared/ui/pipes/relative-time.pipe';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { downloadNameFor } from './drawing-menu';

export interface VersionHistoryDialogData {
  drawingId: string;
  name: string;
  format: DrawingFormat;
  /** Whether Restore is offered — `edit` and up. */
  canRestore: boolean;
}

/**
 * `v7 · 12.3 KB · 2 hours ago · Current`, with Download and Restore per row.
 *
 * Design decisions:
 *
 * - **Restore is append-only, and the copy says so.** The server re-commits the
 *   old bytes as a *new* version, so nothing is destroyed; the confirmation
 *   states that explicitly, because "restore" otherwise sounds like a rollback
 *   that discards the work since.
 *
 * - **It resolves the new current version, not a boolean.** The caller has a row
 *   on screen whose `currentVersion` and `updatedAt` just changed, so handing
 *   back the `SaveResultDto` lets it patch in place instead of reloading.
 *
 * - **Downloads use the drawing's real extension.** A DWG's version 3 is DWG
 *   bytes; naming the file `.dxf` would produce a file no tool can open.
 */
@Component({
  selector: 'app-version-history-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, UiButtonDirective, UiIconComponent, UiSkeletonComponent, FileSizePipe, RelativeTimePipe],
  template: `
    <div class="ui-dialog vh" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" cdkTrapFocus>
      <header class="ui-dialog__header">
        <h2 [id]="titleId">Version history — {{ data.name }}</h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly aria-label="Close" (click)="close()">
          <ui-icon name="close" />
        </button>
      </header>

      <div class="ui-dialog__body vh__body">
        @if (loading()) {
          <ui-skeleton [lines]="4" height="38px" />
        } @else if (error(); as message) {
          <p class="vh__error" role="alert">{{ message }}</p>
          <button type="button" uiButton size="sm" (click)="reload()"><ui-icon name="refresh" [size]="14" /> Retry</button>
        } @else if (!versions().length) {
          <p class="vh__muted">This drawing has no saved history yet.</p>
        } @else {
          <ul class="vh__list">
            @for (version of versions(); track version.version) {
              <li class="vh__row">
                <span class="vh__v">v{{ version.version }}</span>
                <span class="vh__meta">
                  {{ version.byteSize | fileSize }} · {{ version.createdAt | relativeTime }}
                  @if (version.isCurrent) {
                    <span class="vh__current">Current</span>
                  }
                </span>
                <button
                  type="button"
                  uiButton
                  variant="ghost"
                  size="sm"
                  [disabled]="busy() !== null"
                  (click)="download(version)"
                >
                  <ui-icon name="download" [size]="14" />
                  Download
                </button>
                @if (data.canRestore && !version.isCurrent) {
                  <button type="button" uiButton size="sm" [disabled]="busy() !== null" (click)="restore(version)">
                    <ui-icon name="restore" [size]="14" />
                    Restore
                  </button>
                } @else {
                  <span class="vh__spacer"></span>
                }
              </li>
            }
          </ul>
          <p class="vh__note">Older versions are pruned once the history limit is reached.</p>
        }
      </div>

      <footer class="ui-dialog__footer">
        <button type="button" uiButton variant="secondary" (click)="close()">Done</button>
      </footer>
    </div>
  `,
  styles: [
    `
      .vh { width: 520px; max-width: 100%; }
      .vh__body { min-height: 160px; max-height: 60vh; }
      .vh__list { list-style: none; margin: 0; padding: 0; }
      .vh__row {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 8px 0; border-bottom: 1px solid var(--ui-border);
      }
      .vh__row:last-child { border-bottom: 0; }
      .vh__v {
        flex: 0 0 auto; min-width: 42px;
        font-family: var(--ui-font-mono); font-size: var(--ui-text-md); font-weight: 600;
        color: var(--ui-text-strong);
      }
      .vh__meta { flex: 1; min-width: 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vh__current {
        margin-left: 6px; padding: 1px 7px;
        font-size: var(--ui-text-xs); font-weight: 600;
        color: var(--ui-accent); background: var(--ui-accent-tint);
        border-radius: var(--ui-radius-full);
      }
      /* Keeps the Download button in one column when Restore is absent. */
      .vh__spacer { flex: 0 0 auto; width: 88px; }
      .vh__muted { margin: 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .vh__note { margin: var(--ui-space-4) 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .vh__error { margin: 0 0 10px; color: var(--ui-danger); }

      @media (max-width: 620px) {
        .vh { width: auto; }
        .vh__spacer { display: none; }
      }
    `,
  ],
})
export class VersionHistoryDialogComponent {
  protected readonly data = inject(UI_DIALOG_DATA) as VersionHistoryDialogData;
  /** Resolves the new current version number when one was restored. */
  protected readonly ref = inject(UiDialogRef) as UiDialogRef<number>;

  private readonly api = inject(DrawingsApiService);
  private readonly dialog = inject(UiDialogService);
  private readonly notify = inject(NotificationService);

  protected readonly titleId = `versions-title-${++seq}`;
  protected readonly versions = signal<VersionDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** `v<n>` of the row with a request in flight. */
  protected readonly busy = signal<string | null>(null);

  private restoredTo: number | null = null;

  protected readonly current = computed(() => this.versions().find((v) => v.isCurrent)?.version ?? null);

  constructor() {
    void this.reload();
  }

  protected close(): void {
    this.ref.close(this.restoredTo ?? undefined);
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.versions.set(await this.api.versions(this.data.drawingId));
    } catch (e) {
      this.versions.set([]);
      this.error.set(e instanceof Error && e.message ? e.message : 'The history could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async download(version: VersionDto): Promise<void> {
    if (this.busy()) return;
    this.busy.set(`v${version.version}`);
    try {
      const { downloadUrl } = await this.api.versionDownload(this.data.drawingId, version.version);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = downloadNameFor(`${stemOf(this.data.name)} (v${version.version})`, this.data.format);
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      this.notify.error(e instanceof Error && e.message ? e.message : 'That version could not be downloaded.');
    } finally {
      this.busy.set(null);
    }
  }

  protected async restore(version: VersionDto): Promise<void> {
    if (this.busy()) return;
    const ok = await this.dialog.confirm({
      title: `Restore version ${version.version}?`,
      message: 'The current version is kept in history — this saves the older contents as a new version.',
      confirmLabel: 'Restore',
    });
    if (!ok) return;

    this.busy.set(`v${version.version}`);
    try {
      const result = await this.api.restoreVersion(this.data.drawingId, version.version, this.current());
      this.restoredTo = result.version;
      this.notify.success(`Version ${version.version} was restored as v${result.version}.`);
      await this.reload();
    } catch (e) {
      this.notify.error(e instanceof Error && e.message ? e.message : 'That version could not be restored.');
    } finally {
      this.busy.set(null);
    }
  }
}

/** "plan.dxf" → "plan"; leaves a name without an extension alone. */
function stemOf(name: string): string {
  return name.replace(/\.(dxf|dwg)$/i, '');
}

let seq = 0;
