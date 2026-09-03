import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DrawingSummaryDto } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { ApiError } from '../../../core/services/http-manager.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { MoveToDialogComponent, MoveToDialogData, MoveToDialogResult } from '../components/move-to-dialog.component';
import { RenameDialogComponent, RenameDialogData } from '../components/rename-dialog.component';
import { ShareDialogComponent, ShareDialogData } from '../components/share-dialog.component';
import {
  VersionHistoryDialogComponent,
  VersionHistoryDialogData,
} from '../components/version-history-dialog.component';
import { DrawingAction, downloadNameFor, hasAccess } from '../components/drawing-menu';

/** What the caller should do to its list after an action ran. */
export type DrawingActionResult =
  /** Nothing changed (cancelled, failed, or the action navigated away). */
  | { kind: 'none' }
  /** Replace the row with `drawing`. */
  | { kind: 'updated'; drawing: DrawingSummaryDto }
  /** Insert `drawing` at the top. */
  | { kind: 'created'; drawing: DrawingSummaryDto }
  /** The drawing left this view (trashed, or moved to another folder/workspace). */
  | { kind: 'removed'; id: string };

/** Where a move or copy is going. */
export interface DrawingDestination {
  organizationId: string | null;
  folderId: string | null;
}

/** Outcome of a bulk run: what succeeded, and why the rest did not. */
export interface BulkResult {
  done: string[];
  failed: { name: string; message: string }[];
}

/**
 * The Open / Share / Rename / Duplicate / Copy / Move / Download / Versions /
 * Delete behaviours, in one place — for a single row and for a selection.
 *
 * Design decisions:
 *
 * - **It runs the dialog *and* the request, but never touches a list.** Each
 *   method returns a `DrawingActionResult` describing the change so every page
 *   applies it to its own store. Recent, My Drawings, Shared with me and a
 *   folder view therefore share identical behaviour (and identical error copy)
 *   while keeping their own very different data shapes.
 *
 * - **`PATCH` and `POST /move` are chosen by the destination, not the caller.**
 *   The dialog answers with a workspace *and* a folder; if the workspace did not
 *   change this is the same intra-workspace move it always was (`PATCH`), and if
 *   it did, only the explicit route can express it. Callers say "move this
 *   there" and never have to know which verb that is.
 *
 * - **Bulk runs are sequential and account for every row.** `Promise.all` would
 *   fail the whole batch on the first 409 and hammer the API with 25 parallel
 *   writes; running in order and collecting failures produces the one honest
 *   summary toast ("Moved 7 drawings; 1 failed: …").
 */
@Injectable({ providedIn: 'root' })
export class DrawingActionsService {
  private readonly api = inject(DrawingsApiService);
  private readonly dialog = inject(UiDialogService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  /** Open a drawing in the editor. DWG cannot be parsed yet, so it is refused. */
  async open(drawing: DrawingSummaryDto): Promise<void> {
    if (drawing.format === 'dwg') {
      this.notify.warning('DWG drawings cannot be opened in the editor yet. Download it or convert it to DXF first.');
      return;
    }
    await this.router.navigate(['/editor', drawing.id]);
  }

  /** Dispatch a menu action. `{ kind: 'none' }` means "leave the list alone". */
  async run(action: DrawingAction, drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    switch (action) {
      case 'open':
        await this.open(drawing);
        return { kind: 'none' };
      case 'share':
        return this.share(drawing);
      case 'rename':
        return this.rename(drawing);
      case 'duplicate':
        return this.duplicate(drawing);
      case 'move':
        return this.move(drawing);
      case 'copy':
        return this.copy(drawing);
      case 'download':
        await this.download(drawing);
        return { kind: 'none' };
      case 'versions':
        return this.versions(drawing);
      case 'delete':
        return this.trash(drawing);
    }
  }

  /**
   * Renames through the dialog's `onSubmit` hook rather than after it closes, so
   * a 409 `NAME_TAKEN` is shown beside the field with the typed name still
   * there. Any other failure still closes and toasts — a storage outage is not
   * something the user can fix by editing the name.
   */
  private async rename(drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    let updated: DrawingSummaryDto | null = null;
    const data: RenameDialogData = {
      title: 'Rename drawing',
      label: 'Name',
      value: drawing.name,
      onSubmit: async (name) => {
        try {
          updated = await this.api.patch(drawing.id, { name });
          return null;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'NAME_TAKEN') {
            return `A drawing named "${name}" already exists here.`;
          }
          this.fail(e, 'The drawing could not be renamed.');
          // Closes the dialog: retyping cannot fix this one.
          return null;
        }
      },
    };
    await this.dialog.open<string, RenameDialogData>(RenameDialogComponent, data).afterClosed;
    return updated ? { kind: 'updated', drawing: updated } : { kind: 'none' };
  }

  private async duplicate(drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    try {
      const copy = await this.api.duplicate(drawing.id);
      this.notify.success(`Created "${copy.name}".`);
      return { kind: 'created', drawing: copy };
    } catch (e) {
      this.fail(e, 'The drawing could not be duplicated.');
      return { kind: 'none' };
    }
  }

  /** Ask for a destination, then move there. */
  private async move(drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    const choice = await this.pickDestination(drawing.name, drawing, 'move');
    if (!choice) return { kind: 'none' };
    return this.moveTo(drawing, choice);
  }

  /**
   * Move without asking — the drag-and-drop path, and the one bulk moves use
   * once the destination has been picked for the whole selection.
   */
  async moveTo(drawing: DrawingSummaryDto, dest: DrawingDestination): Promise<DrawingActionResult> {
    const sameWorkspace = dest.organizationId === (drawing.organizationId ?? null);
    if (sameWorkspace && dest.folderId === (drawing.folderId ?? null)) return { kind: 'none' };
    try {
      const updated = sameWorkspace
        ? await this.api.patch(drawing.id, { folderId: dest.folderId })
        : await this.api.move(drawing.id, dest);
      this.notify.success(`Moved "${updated.name}".`);
      // The drawing left the folder (or the workspace) currently on screen.
      return { kind: 'removed', id: drawing.id };
    } catch (e) {
      this.notify.error(moveFailure(e));
      return { kind: 'none' };
    }
  }

  /** Copy to a chosen workspace/folder; the caller owns the copy. */
  private async copy(drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    const choice = await this.pickDestination(drawing.name, drawing, 'copy');
    if (!choice) return { kind: 'none' };
    return this.copyTo(drawing, choice);
  }

  async copyTo(drawing: DrawingSummaryDto, dest: DrawingDestination): Promise<DrawingActionResult> {
    try {
      const copy = await this.api.copy(drawing.id, dest);
      this.notify.success(`Copied as "${copy.name}".`);
      // Only claim a new row when the copy actually landed in the view on screen.
      const here =
        dest.organizationId === (drawing.organizationId ?? null) && dest.folderId === (drawing.folderId ?? null);
      return here ? { kind: 'created', drawing: copy } : { kind: 'none' };
    } catch (e) {
      this.notify.error(moveFailure(e));
      return { kind: 'none' };
    }
  }

  /**
   * Fetch a fresh presigned URL with an attachment disposition and hand it to
   * the browser. A synthetic anchor rather than `location.assign` so the
   * current page is never replaced if the header is missing.
   */
  private async download(drawing: DrawingSummaryDto): Promise<void> {
    try {
      const full = await this.api.get(drawing.id, { download: true, touch: false });
      const link = document.createElement('a');
      link.href = full.downloadUrl;
      // A DWG saved as ".dxf" is a file no tool will open — the format decides.
      link.download = downloadNameFor(drawing.name, drawing.format);
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      this.fail(e, 'The drawing could not be downloaded.');
    }
  }

  /** People / organizations / links for one drawing. */
  private async share(drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    const data: ShareDialogData = {
      kind: 'drawing',
      id: drawing.id,
      name: drawing.name,
      organizationId: drawing.organizationId,
    };
    const changed = await this.dialog.open<boolean, ShareDialogData>(ShareDialogComponent, data).afterClosed;
    // `shareCount` is on the summary, so a changed share list means the row is stale.
    return changed ? this.refetch(drawing) : { kind: 'none' };
  }

  private async versions(drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    const data: VersionHistoryDialogData = {
      drawingId: drawing.id,
      name: drawing.name,
      format: drawing.format,
      canRestore: hasAccess(drawing, 'edit'),
    };
    const restoredTo = await this.dialog.open<number, VersionHistoryDialogData>(VersionHistoryDialogComponent, data)
      .afterClosed;
    return restoredTo ? this.refetch(drawing) : { kind: 'none' };
  }

  private async trash(drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    const ok = await this.dialog.confirm({
      title: 'Move to trash?',
      message: `"${drawing.name}" will be moved to the trash. You can restore it from there.`,
      confirmLabel: 'Move to trash',
      danger: true,
    });
    if (!ok) return { kind: 'none' };
    try {
      await this.api.trashDrawing(drawing.id);
      this.notify.success(`"${drawing.name}" was moved to the trash.`);
      return { kind: 'removed', id: drawing.id };
    } catch (e) {
      this.fail(e, 'The drawing could not be deleted.');
      return { kind: 'none' };
    }
  }

  // ── bulk ──────────────────────────────────────────────────────────────────

  /**
   * Ask once, then move every drawing. Rows that are refused are named in the
   * summary rather than silently dropped — a bulk action that half-worked and
   * said nothing is the worst of the three possible outcomes.
   */
  async bulkMove(drawings: readonly DrawingSummaryDto[]): Promise<BulkResult | null> {
    const first = drawings[0];
    if (!first) return null;
    const choice = await this.pickDestination(label(drawings), first, 'move');
    if (!choice) return null;
    return this.runBulk(drawings, 'Moved', async (drawing) => {
      const sameWorkspace = choice.organizationId === (drawing.organizationId ?? null);
      if (sameWorkspace) await this.api.patch(drawing.id, { folderId: choice.folderId });
      else await this.api.move(drawing.id, choice);
    });
  }

  async bulkCopy(drawings: readonly DrawingSummaryDto[]): Promise<BulkResult | null> {
    const first = drawings[0];
    if (!first) return null;
    const choice = await this.pickDestination(label(drawings), first, 'copy');
    if (!choice) return null;
    return this.runBulk(drawings, 'Copied', async (drawing) => {
      await this.api.copy(drawing.id, choice);
    });
  }

  async bulkTrash(drawings: readonly DrawingSummaryDto[]): Promise<BulkResult | null> {
    if (!drawings.length) return null;
    const ok = await this.dialog.confirm({
      title: `Move ${label(drawings)} to trash?`,
      message: 'They can be restored from the trash.',
      confirmLabel: 'Move to trash',
      danger: true,
    });
    if (!ok) return null;
    return this.runBulk(drawings, 'Moved to trash', async (drawing) => {
      await this.api.trashDrawing(drawing.id);
    });
  }

  /**
   * Download each drawing in turn. Sequential on purpose: a burst of synthetic
   * anchor clicks is what browsers block as a popup flood.
   */
  async bulkDownload(drawings: readonly DrawingSummaryDto[]): Promise<BulkResult | null> {
    if (!drawings.length) return null;
    return this.runBulk(drawings, 'Downloaded', async (drawing) => {
      await this.download(drawing);
    });
  }

  private async runBulk(
    drawings: readonly DrawingSummaryDto[],
    verb: string,
    op: (drawing: DrawingSummaryDto) => Promise<void>,
  ): Promise<BulkResult> {
    const result: BulkResult = { done: [], failed: [] };
    for (const drawing of drawings) {
      try {
        await op(drawing);
        result.done.push(drawing.id);
      } catch (e) {
        result.failed.push({ name: drawing.name, message: e instanceof Error ? e.message : 'Failed' });
      }
    }
    this.summarise(verb, result);
    return result;
  }

  /** One toast for the whole batch, naming at most two failures. */
  private summarise(verb: string, result: BulkResult): void {
    const noun = (n: number) => `${n} ${n === 1 ? 'drawing' : 'drawings'}`;
    if (!result.failed.length) {
      if (result.done.length) this.notify.success(`${verb} ${noun(result.done.length)}.`);
      return;
    }
    const named = result.failed
      .slice(0, 2)
      .map((f) => `${f.name} (${f.message})`)
      .join('; ');
    const rest = result.failed.length > 2 ? ` and ${result.failed.length - 2} more` : '';
    const prefix = result.done.length ? `${verb} ${noun(result.done.length)}; ` : '';
    this.notify.error(`${prefix}${result.failed.length} failed: ${named}${rest}.`);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private pickDestination(
    itemName: string,
    from: DrawingSummaryDto,
    mode: 'move' | 'copy',
  ): Promise<MoveToDialogResult | undefined> {
    const data: MoveToDialogData = {
      itemName,
      currentFolderId: from.folderId,
      currentOrganizationId: from.organizationId,
      mode,
    };
    return this.dialog.open<MoveToDialogResult, MoveToDialogData>(MoveToDialogComponent, data).afterClosed;
  }

  /** Re-read one summary after a dialog changed something the row displays. */
  private async refetch(drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    try {
      const fresh = await this.api.get(drawing.id, { touch: false });
      return { kind: 'updated', drawing: fresh };
    } catch {
      // The change did land; only the row is stale, which is not worth a toast.
      return { kind: 'none' };
    }
  }

  private fail(e: unknown, fallback: string): void {
    this.notify.error(e instanceof Error && e.message ? e.message : fallback);
  }
}

/** "3 drawings" / the single drawing's own name. */
function label(drawings: readonly DrawingSummaryDto[]): string {
  return drawings.length === 1 ? drawings[0].name : `${drawings.length} drawings`;
}

/** The move/copy refusals worth wording ourselves; anything else keeps the server's. */
function moveFailure(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'NAME_TAKEN':
        return 'Something with that name already exists in the destination.';
      case 'CROSS_WORKSPACE_MOVE':
        return 'That destination is in another workspace — use Move to… and pick the workspace.';
      case 'FORBIDDEN':
        return 'You do not have permission to put drawings there.';
      default:
        break;
    }
  }
  return e instanceof Error && e.message ? e.message : 'The drawing could not be moved.';
}
