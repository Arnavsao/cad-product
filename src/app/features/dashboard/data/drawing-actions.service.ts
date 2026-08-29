import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DrawingSummaryDto } from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { MoveToDialogComponent, MoveToDialogData, MoveToDialogResult } from '../components/move-to-dialog.component';
import { RenameDialogComponent, RenameDialogData } from '../components/rename-dialog.component';
import { DrawingAction } from '../components/drawing-menu';

/** What the caller should do to its list after an action ran. */
export type DrawingActionResult =
  /** Nothing changed (cancelled, failed, or the action navigated away). */
  | { kind: 'none' }
  /** Replace the row with `drawing`. */
  | { kind: 'updated'; drawing: DrawingSummaryDto }
  /** Insert `drawing` at the top. */
  | { kind: 'created'; drawing: DrawingSummaryDto }
  /** The drawing left this view (trashed, or moved to another folder). */
  | { kind: 'removed'; id: string };

/**
 * The Open / Rename / Duplicate / Move / Download / Delete behaviours, in one
 * place.
 *
 * Design decision: this service runs the dialog *and* the request, but never
 * touches a list — it returns a `DrawingActionResult` describing the change so
 * each page applies it to its own store. Recent, My Drawings and a folder view
 * therefore share identical behaviour (and identical error copy) while keeping
 * their own very different data shapes.
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

  /** Dispatch a menu action. `null` results mean "leave the list alone". */
  async run(action: DrawingAction, drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    switch (action) {
      case 'open':
        await this.open(drawing);
        return { kind: 'none' };
      case 'rename':
        return this.rename(drawing);
      case 'duplicate':
        return this.duplicate(drawing);
      case 'move':
        return this.move(drawing);
      case 'download':
        await this.download(drawing);
        return { kind: 'none' };
      case 'delete':
        return this.trash(drawing);
    }
  }

  private async rename(drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    const data: RenameDialogData = { title: 'Rename drawing', label: 'Name', value: drawing.name };
    const name = await this.dialog.open<string, RenameDialogData>(RenameDialogComponent, data).afterClosed;
    if (!name) return { kind: 'none' };
    try {
      const updated = await this.api.patch(drawing.id, { name });
      return { kind: 'updated', drawing: updated };
    } catch (e) {
      this.fail(e, 'The drawing could not be renamed.');
      return { kind: 'none' };
    }
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

  private async move(drawing: DrawingSummaryDto): Promise<DrawingActionResult> {
    const data: MoveToDialogData = { itemName: drawing.name, currentFolderId: drawing.folderId };
    const choice = await this.dialog.open<MoveToDialogResult, MoveToDialogData>(MoveToDialogComponent, data).afterClosed;
    if (!choice) return { kind: 'none' };
    try {
      const updated = await this.api.patch(drawing.id, { folderId: choice.folderId });
      this.notify.success(`Moved "${updated.name}".`);
      // The drawing left the folder currently on screen.
      return { kind: 'removed', id: drawing.id };
    } catch (e) {
      this.fail(e, 'The drawing could not be moved.');
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
      link.download = drawing.name.toLowerCase().endsWith('.dxf') ? drawing.name : `${drawing.name}.dxf`;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      this.fail(e, 'The drawing could not be downloaded.');
    }
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

  private fail(e: unknown, fallback: string): void {
    this.notify.error(e instanceof Error && e.message ? e.message : fallback);
  }
}
