import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FolderDto, FolderPathEntry } from '../../../core/api/api.models';
import { FoldersApiService } from '../../../core/api/folders-api.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UI_DIALOG_DATA, UiDialogRef } from '../../../shared/ui/dialog/ui-dialog-ref';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';

export interface MoveToDialogData {
  /** What is being moved, shown in the header. */
  itemName: string;
  /** The folder it is in now, so "Move here" can be disabled there. */
  currentFolderId: string | null;
}

/** Resolved when the user confirms a destination. */
export interface MoveToDialogResult {
  /** `null` means the top level of My Drawings. */
  folderId: string | null;
}

/**
 * Folder picker. Resolves `{ folderId }`, or `undefined` when cancelled.
 *
 * Design decision: it browses one level at a time (`GET /folders?parentId=`)
 * instead of loading a whole tree. The API has no "all folders" endpoint, and a
 * lazy trail is both one request per click and correct for libraries of any
 * depth. The trail is kept locally rather than re-fetched, since the user built
 * it by clicking through.
 */
@Component({
  selector: 'app-move-to-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, UiButtonDirective, UiIconComponent, UiSkeletonComponent],
  template: `
    <div class="ui-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" cdkTrapFocus>
      <header class="ui-dialog__header">
        <h2 [id]="titleId">Move "{{ data.itemName }}"</h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly aria-label="Close" (click)="ref.close()">
          <ui-icon name="close" />
        </button>
      </header>

      <nav class="mv__crumbs" aria-label="Destination folder">
        <button type="button" class="mv__crumb" [disabled]="!trail().length" (click)="goTo(-1)">My Drawings</button>
        @for (crumb of trail(); track crumb.id; let i = $index; let last = $last) {
          <ui-icon name="chevron-right" [size]="13" />
          <button type="button" class="mv__crumb" [disabled]="last" (click)="goTo(i)">{{ crumb.name }}</button>
        }
      </nav>

      <div class="ui-dialog__body mv__body">
        @if (loading()) {
          <ui-skeleton [lines]="4" height="32px" />
        } @else if (error(); as message) {
          <p class="mv__error" role="alert">{{ message }}</p>
          <button type="button" uiButton size="sm" (click)="reload()"><ui-icon name="refresh" [size]="14" /> Retry</button>
        } @else if (!folders().length) {
          <p class="mv__empty">No sub-folders here.</p>
        } @else {
          <ul class="mv__list">
            @for (folder of folders(); track folder.id) {
              <li>
                <button type="button" class="mv__item" (click)="enter(folder)">
                  <ui-icon name="folder" [size]="16" />
                  <span class="mv__item-name">{{ folder.name }}</span>
                  <ui-icon name="chevron-right" [size]="14" />
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <footer class="ui-dialog__footer">
        <span class="mv__target">Move to <strong>{{ targetName() }}</strong></span>
        <button type="button" uiButton variant="secondary" (click)="ref.close()">Cancel</button>
        <button type="button" uiButton variant="primary" [disabled]="isCurrent()" (click)="confirm()">Move here</button>
      </footer>
    </div>
  `,
  styles: [
    `
      .mv__crumbs {
        display: flex; align-items: center; gap: 2px; flex-wrap: wrap;
        padding: 8px 16px; border-bottom: 1px solid var(--ui-border);
        color: var(--ui-text-dim);
      }
      .mv__crumb {
        padding: 3px 6px; border: 0; border-radius: var(--ui-radius-sm);
        background: transparent; color: var(--ui-accent);
        font: 500 var(--ui-text-md) / 1 var(--ui-font); cursor: pointer;
      }
      .mv__crumb:disabled { color: var(--ui-text-strong); cursor: default; }
      .mv__crumb:hover:not(:disabled) { background: var(--ui-hover); }
      .mv__crumb:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }

      .mv__body { min-height: 190px; max-height: 320px; }
      .mv__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
      .mv__item {
        display: flex; align-items: center; gap: 10px; width: 100%;
        padding: 8px 10px; border: 0; border-radius: var(--ui-radius-sm);
        background: transparent; color: var(--ui-text);
        font: 400 var(--ui-text-md) / 1.2 var(--ui-font); text-align: left; cursor: pointer;
      }
      .mv__item:hover { background: var(--ui-hover); }
      .mv__item:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
      .mv__item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mv__item ui-icon:first-child { color: var(--ui-accent); }
      .mv__empty { margin: 0; color: var(--ui-text-dim); }
      .mv__error { margin: 0 0 10px; color: var(--ui-danger); }
      .mv__target { flex: 1; min-width: 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mv__target strong { color: var(--ui-text-strong); font-weight: 600; }
    `,
  ],
})
export class MoveToDialogComponent {
  protected readonly data = inject(UI_DIALOG_DATA) as MoveToDialogData;
  protected readonly ref = inject(UiDialogRef) as UiDialogRef<MoveToDialogResult>;
  private readonly api = inject(FoldersApiService);

  protected readonly titleId = `move-to-title-${++seq}`;
  protected readonly trail = signal<FolderPathEntry[]>([]);
  protected readonly folders = signal<FolderDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly targetId = computed<string | null>(() => {
    const trail = this.trail();
    return trail.length ? trail[trail.length - 1].id : null;
  });
  protected readonly targetName = computed(() => {
    const trail = this.trail();
    return trail.length ? trail[trail.length - 1].name : 'My Drawings';
  });
  protected readonly isCurrent = computed(() => this.targetId() === this.data.currentFolderId);

  constructor() {
    void this.reload();
  }

  protected enter(folder: FolderDto): void {
    this.trail.update((t) => [...t, { id: folder.id, name: folder.name }]);
    void this.reload();
  }

  /** `index` is a position in the trail; `-1` returns to the top level. */
  protected goTo(index: number): void {
    this.trail.update((t) => t.slice(0, index + 1));
    void this.reload();
  }

  protected confirm(): void {
    this.ref.close({ folderId: this.targetId() });
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const target = this.targetId();
    try {
      const folders = await this.api.list(target);
      if (this.targetId() !== target) return; // a faster click superseded this load
      this.folders.set(folders);
    } catch (e) {
      this.folders.set([]);
      this.error.set(e instanceof Error && e.message ? e.message : 'Folders could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }
}

let seq = 0;
