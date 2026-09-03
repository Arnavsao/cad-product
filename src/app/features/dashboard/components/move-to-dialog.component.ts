import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FolderDto, FolderPathEntry } from '../../../core/api/api.models';
import { FoldersApiService } from '../../../core/api/folders-api.service';
import { WorkspaceService } from '../../../core/api/workspace.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UI_DIALOG_DATA, UiDialogRef } from '../../../shared/ui/dialog/ui-dialog-ref';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { hasAccess } from './drawing-menu';

/** "Move" refuses the current location; "copy" accepts it. */
export type MoveToDialogMode = 'move' | 'copy';

export interface MoveToDialogData {
  /** What is being moved, shown in the header. */
  itemName: string;
  /** The folder it is in now, so "Move here" can be disabled there. */
  currentFolderId: string | null;
  /** The workspace it is in now (`null` = personal); the picker starts here. */
  currentOrganizationId?: string | null;
  /** Default "move". */
  mode?: MoveToDialogMode;
  /**
   * A folder that must not be offered as a destination — itself, when a folder
   * is what is being moved. The server would refuse with 422 `FOLDER_CYCLE`;
   * hiding it means the user never has to find that out.
   */
  excludeFolderId?: string | null;
}

/** Resolved when the user confirms a destination. */
export interface MoveToDialogResult {
  /** `null` = the caller's personal workspace. */
  organizationId: string | null;
  /** `null` means the top level of that workspace. */
  folderId: string | null;
}

/**
 * Workspace + folder picker. Resolves `{ organizationId, folderId }`, or
 * `undefined` when cancelled.
 *
 * Design decisions:
 *
 * - **The workspace is a first-class part of the destination.** Personal and
 *   each organization are separate folder trees, so a dialog that only picked a
 *   folder could not express "move this into Acme" at all — which is the whole
 *   point of a cross-workspace move. Changing the workspace resets the trail,
 *   because a folder id from one workspace means nothing in another.
 *
 * - **Only workspaces you can write to are listed.** A viewer in an org cannot
 *   be the destination of anything (403 `FORBIDDEN`), so offering it would be
 *   offering a certain failure.
 *
 * - **It browses one level at a time** (`GET /folders?parentId=`) instead of
 *   loading a whole tree. The API has no "all folders" endpoint, and a lazy
 *   trail is both one request per click and correct for libraries of any depth.
 *   The trail is kept locally rather than re-fetched, since the user built it by
 *   clicking through.
 *
 * - **It returns a destination; it does not move anything.** The caller decides
 *   between `PATCH` (same workspace) and `POST /move` (workspace changed) and
 *   owns the error copy — see `DrawingActionsService`.
 */
@Component({
  selector: 'app-move-to-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, UiButtonDirective, UiIconComponent, UiInputDirective, UiSkeletonComponent],
  template: `
    <div class="ui-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" cdkTrapFocus>
      <header class="ui-dialog__header">
        <h2 [id]="titleId">{{ isCopy ? 'Copy' : 'Move' }} "{{ data.itemName }}"</h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly aria-label="Close" (click)="ref.close()">
          <ui-icon name="close" />
        </button>
      </header>

      @if (workspaces().length > 1) {
        <div class="mv__ws">
          <label class="mv__ws-label" [attr.for]="wsId">Workspace</label>
          <select uiInput [id]="wsId" [value]="orgId() ?? ''" (change)="onWorkspace($event)">
            @for (option of workspaces(); track option.id ?? 'personal') {
              <option [value]="option.id ?? ''">{{ option.name }}</option>
            }
          </select>
        </div>
      }

      <nav class="mv__crumbs" aria-label="Destination folder">
        <button type="button" class="mv__crumb" [disabled]="!trail().length" (click)="goTo(-1)">{{ rootName() }}</button>
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
        <span class="mv__target">
          {{ isCopy ? 'Copy' : 'Move' }} to <strong>{{ targetName() }}</strong>
        </span>
        <button type="button" uiButton variant="secondary" (click)="ref.close()">Cancel</button>
        <button type="button" uiButton variant="primary" [disabled]="isCurrent()" (click)="confirm()">
          {{ isCopy ? 'Copy here' : 'Move here' }}
        </button>
      </footer>
    </div>
  `,
  styles: [
    `
      .mv__ws {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 10px 16px 0;
      }
      .mv__ws-label { flex: 0 0 auto; font-size: var(--ui-text-sm); font-weight: 600; color: var(--ui-text-dim); }
      .mv__ws select { flex: 1; min-width: 0; width: auto; }

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
  private readonly workspace = inject(WorkspaceService);

  protected readonly titleId = `move-to-title-${++seq}`;
  protected readonly wsId = `move-to-ws-${seq}`;
  protected readonly isCopy = this.data.mode === 'copy';

  protected readonly trail = signal<FolderPathEntry[]>([]);
  protected readonly folders = signal<FolderDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Destination workspace; starts at the item's own. */
  protected readonly orgId = signal<string | null>(this.data.currentOrganizationId ?? null);

  /** Personal plus every org the caller can write to. */
  protected readonly workspaces = computed<{ id: string | null; name: string }[]>(() => [
    { id: null, name: 'Personal' },
    ...this.workspace
      .organizations()
      .filter((org) => org.role !== 'viewer')
      .map((org) => ({ id: org.id, name: org.name })),
  ]);

  protected readonly rootName = computed(() => {
    const id = this.orgId();
    if (id === null) return 'My Drawings';
    return this.workspace.organizations().find((o) => o.id === id)?.name ?? 'Organization';
  });

  protected readonly targetId = computed<string | null>(() => {
    const trail = this.trail();
    return trail.length ? trail[trail.length - 1].id : null;
  });
  protected readonly targetName = computed(() => {
    const trail = this.trail();
    return trail.length ? trail[trail.length - 1].name : this.rootName();
  });

  /** A move to where it already is does nothing; a copy there is legitimate. */
  protected readonly isCurrent = computed(
    () =>
      !this.isCopy &&
      this.targetId() === this.data.currentFolderId &&
      this.orgId() === (this.data.currentOrganizationId ?? null),
  );

  constructor() {
    void this.reload();
  }

  protected onWorkspace(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const next = value === '' ? null : value;
    if (next === this.orgId()) return;
    this.orgId.set(next);
    // Folder ids are workspace-local, so the trail cannot survive the switch.
    this.trail.set([]);
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
    this.ref.close({ organizationId: this.orgId(), folderId: this.targetId() });
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const target = this.targetId();
    const org = this.orgId();
    try {
      const folders = await this.api.list(target, org);
      // A faster click (or a workspace switch) superseded this load.
      if (this.targetId() !== target || this.orgId() !== org) return;
      this.folders.set(
        folders.filter((f) => f.id !== this.data.excludeFolderId && hasAccess(f, 'edit')),
      );
    } catch (e) {
      this.folders.set([]);
      this.error.set(e instanceof Error && e.message ? e.message : 'Folders could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }
}

let seq = 0;
