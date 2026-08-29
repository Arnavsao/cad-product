import { Injector, inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';
import type { CadEditorComponent } from './cad-editor';

/**
 * Stops a navigation away from the editor while any open document has unsaved
 * edits.
 *
 * Cloud saves are explicit in this app (see `DrawingPersistenceService`), so
 * leaving the route is the last moment at which unsaved work can still be
 * pushed — the local recovery snapshot survives a crash, but it is not a
 * substitute for the drawing existing in the user's account.
 *
 * "Save all" aborts the navigation if any save fails or is cancelled, so a
 * failed upload never doubles as a discard.
 *
 * `DrawingPersistenceService` is reached through a dynamic import rather than a
 * top-level one: `app.routes.ts` imports this guard eagerly, and a static
 * import would pull the export/import/document stack — most of the editor —
 * into the initial bundle. By the time the guard can possibly run, the editor
 * chunk is already loaded, so the import resolves from cache.
 *
 * Wire it up as `canDeactivate: [unsavedChangesGuard]` on the editor route.
 */
export const unsavedChangesGuard: CanDeactivateFn<CadEditorComponent> = async () => {
  const injector = inject(Injector);
  const dialog = inject(UiDialogService);

  const { DrawingPersistenceService } = await import('./core/services/drawing-persistence.service');
  const persist = injector.get(DrawingPersistenceService);

  if (!persist.anyDirty()) return true;

  const choice = await dialog.choose({
    title: 'You have unsaved changes',
    message: 'Some drawings have edits that are not saved to your account yet.',
    actions: [
      { id: 'discard', label: 'Discard changes', variant: 'danger' },
      { id: 'save', label: 'Save all', variant: 'primary' },
    ],
    cancelLabel: 'Stay here',
  });

  if (choice === 'discard') return true;
  if (choice === 'save') return persist.saveAll();
  return false;
};
