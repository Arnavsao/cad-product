import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FolderDto } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { FoldersApiService } from '../../../core/api/folders-api.service';
import { ApiError } from '../../../core/services/http-manager.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { FolderAction } from '../components/folder-menu';
import { MoveToDialogComponent, MoveToDialogData, MoveToDialogResult } from '../components/move-to-dialog.component';
import { RenameDialogComponent, RenameDialogData } from '../components/rename-dialog.component';
import { ShareDialogComponent, ShareDialogData } from '../components/share-dialog.component';

/** What the caller should do to its folder list after an action ran. */
export type FolderActionResult =
  | { kind: 'none' }
  /** Replace the tile with `folder`. */
  | { kind: 'updated'; folder: FolderDto }
  /** The folder left this view (deleted, or moved elsewhere). */
  | { kind: 'removed'; id: string };

/**
 * Open / Rename / Share / Move / Delete for a folder — the mirror image of
 * `DrawingActionsService`.
 *
 * Design decisions:
 *
 * - **Same shape as the drawing service on purpose.** A page holds folders and
 *   drawings side by side, so both services returning a `{ kind }` result means
 *   one `switch` per list instead of two dialects.
 *
 * - **Delete asks twice, and the second question counts.** `DELETE /folders/:id`
 *   refuses a non-empty folder with 409 `FOLDER_NOT_EMPTY` rather than quietly
 *   trashing its contents. The count for that second confirmation comes from a
 *   one-row listing (`total`) — cheap, and only ever fetched on the path where
 *   the question is actually being asked.
 *
 * - **Moving a folder re-tags its whole subtree**, which is a server
 *   transaction; all the client does is pick a destination that is not inside
 *   the folder itself (the dialog hides it) and report 422 `FOLDER_CYCLE` if the
 *   server disagrees anyway.
 */
@Injectable({ providedIn: 'root' })
export class FolderActionsService {
  private readonly api = inject(FoldersApiService);
  private readonly drawings = inject(DrawingsApiService);
  private readonly dialog = inject(UiDialogService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  async run(action: FolderAction, folder: FolderDto): Promise<FolderActionResult> {
    switch (action) {
      case 'open':
        await this.router.navigate(['/dashboard/folders', folder.id]);
        return { kind: 'none' };
      case 'rename':
        return this.rename(folder);
      case 'share':
        return this.share(folder);
      case 'move':
        return this.move(folder);
      case 'delete':
        return this.remove(folder);
    }
  }

  private async rename(folder: FolderDto): Promise<FolderActionResult> {
    let updated: FolderDto | null = null;
    const data: RenameDialogData = {
      title: 'Rename folder',
      label: 'Name',
      value: folder.name,
      onSubmit: async (name) => {
        try {
          updated = await this.api.update(folder.id, { name });
          return null;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'NAME_TAKEN') {
            return `A folder named "${name}" already exists here.`;
          }
          this.notify.error(messageOr(e, 'The folder could not be renamed.'));
          return null;
        }
      },
    };
    await this.dialog.open<string, RenameDialogData>(RenameDialogComponent, data).afterClosed;
    return updated ? { kind: 'updated', folder: updated } : { kind: 'none' };
  }

  private async share(folder: FolderDto): Promise<FolderActionResult> {
    const data: ShareDialogData = {
      kind: 'folder',
      id: folder.id,
      name: folder.name,
      organizationId: folder.organizationId,
    };
    await this.dialog.open<boolean, ShareDialogData>(ShareDialogComponent, data).afterClosed;
    // Nothing on the tile depends on the share list, so there is nothing to patch.
    return { kind: 'none' };
  }

  private async move(folder: FolderDto): Promise<FolderActionResult> {
    const data: MoveToDialogData = {
      itemName: folder.name,
      currentFolderId: folder.parentId,
      currentOrganizationId: folder.organizationId,
      mode: 'move',
      excludeFolderId: folder.id,
    };
    const choice = await this.dialog.open<MoveToDialogResult, MoveToDialogData>(MoveToDialogComponent, data).afterClosed;
    if (!choice) return { kind: 'none' };
    // The dialog speaks in folders; for a folder the chosen one is its parent.
    return this.moveTo(folder, { organizationId: choice.organizationId, parentId: choice.folderId });
  }

  /** Move without asking — used by the dialog path and by a drag onto a tile. */
  async moveTo(folder: FolderDto, dest: { organizationId: string | null; parentId: string | null }): Promise<FolderActionResult> {
    const sameWorkspace = dest.organizationId === (folder.organizationId ?? null);
    if (sameWorkspace && dest.parentId === (folder.parentId ?? null)) return { kind: 'none' };
    try {
      const moved = sameWorkspace
        ? await this.api.update(folder.id, { parentId: dest.parentId })
        : await this.api.move(folder.id, dest);
      this.notify.success(`Moved "${moved.name}".`);
      return { kind: 'removed', id: folder.id };
    } catch (e) {
      this.notify.error(folderMoveFailure(e));
      return { kind: 'none' };
    }
  }

  private async remove(folder: FolderDto): Promise<FolderActionResult> {
    const ok = await this.dialog.confirm({
      title: 'Delete folder?',
      message: `"${folder.name}" will be deleted.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return { kind: 'none' };

    try {
      await this.api.remove(folder.id);
      this.notify.success(`"${folder.name}" was deleted.`);
      return { kind: 'removed', id: folder.id };
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'FOLDER_NOT_EMPTY') {
        this.notify.error(messageOr(e, 'The folder could not be deleted.'));
        return { kind: 'none' };
      }
      return this.forceRemove(folder);
    }
  }

  /** Second pass: say how many drawings this will trash, then do it. */
  private async forceRemove(folder: FolderDto): Promise<FolderActionResult> {
    const count = await this.countDrawings(folder.id);
    const noun = count === 1 ? '1 drawing' : `${count} drawings`;
    const ok = await this.dialog.confirm({
      title: 'Folder is not empty',
      message: count
        ? `Move ${noun} to trash and delete "${folder.name}"?`
        : `Delete "${folder.name}" and everything inside it?`,
      confirmLabel: 'Move to trash and delete',
      danger: true,
    });
    if (!ok) return { kind: 'none' };
    try {
      const result = await this.api.remove(folder.id, true);
      this.notify.success(
        result.trashedDrawings
          ? `"${folder.name}" was deleted and ${result.trashedDrawings} ${result.trashedDrawings === 1 ? 'drawing' : 'drawings'} moved to the trash.`
          : `"${folder.name}" was deleted.`,
      );
      return { kind: 'removed', id: folder.id };
    } catch (e) {
      this.notify.error(messageOr(e, 'The folder could not be deleted.'));
      return { kind: 'none' };
    }
  }

  /** `total` from a one-row listing; 0 if the count cannot be established. */
  private async countDrawings(folderId: string): Promise<number> {
    try {
      const page = await this.drawings.list({ folderId, page: 1, limit: 1 });
      return page.total ?? page.items.length;
    } catch {
      return 0;
    }
  }
}

function messageOr(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** The folder-move refusals worth wording ourselves. */
function folderMoveFailure(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'NAME_TAKEN':
        return 'A folder with that name already exists in the destination.';
      case 'FOLDER_CYCLE':
        return 'A folder cannot be moved inside itself.';
      case 'CROSS_WORKSPACE_MOVE':
        return 'That destination is in another workspace — use Move to… and pick the workspace.';
      case 'FORBIDDEN':
        return 'You do not have permission to put folders there.';
      default:
        break;
    }
  }
  return messageOr(e, 'The folder could not be moved.');
}
