import { Injector, inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

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
 * **Every dependency here is resolved through a dynamic import.** `app.routes.ts`
 * imports this guard eagerly, so anything named at the top level lands in the
 * initial bundle that a signed-out visitor downloads on the landing page:
 * `DrawingPersistenceService` would pull the export/import/document stack, and
 * `UiDialogService` pulls the CDK overlay (measured at ~65 kB together). Both
 * are `providedIn: 'root'`, so importing the module then asking the injector
 * for the token gives the same singleton. By the time this guard can possibly
 * run, the user is in the editor and both chunks are already cached.
 *
 * Wire it up as `canDeactivate: [unsavedChangesGuard]` on the editor route.
 */
export const unsavedChangesGuard: CanDeactivateFn<CadEditorComponent> = async () => {
  const injector = inject(Injector);

  const [{ DrawingPersistenceService }, { UiDialogService }] = await Promise.all([
    import('./core/services/drawing-persistence.service'),
    import('../../shared/ui/dialog/ui-dialog.service'),
  ]);
  const persist = injector.get(DrawingPersistenceService);

  if (!persist.anyDirty()) return true;
  const dialog = injector.get(UiDialogService);

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
