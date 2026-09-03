import { Injector, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DrawingPersistenceService } from './core/services/drawing-persistence.service';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';
import { unsavedChangesGuard } from './unsaved-changes.guard';

/**
 * The header logo and the Back button both leave via the router, so this guard is
 * the AutoCAD-style "save before you go" gate for both. Its contract:
 *   clean            -> leave, no prompt
 *   "Save all"       -> leave only if every save succeeded
 *   "Discard"        -> leave, losing the edits
 *   "Stay here"/esc  -> stay
 */
describe('unsavedChangesGuard', () => {
  let persist: { anyDirty: jasmine.Spy; saveAll: jasmine.Spy };
  let dialog: { choose: jasmine.Spy };
  let injector: Injector;

  const run = () =>
    runInInjectionContext(injector, () =>
      (unsavedChangesGuard as unknown as () => Promise<boolean>)(),
    );

  beforeEach(() => {
    persist = { anyDirty: jasmine.createSpy('anyDirty'), saveAll: jasmine.createSpy('saveAll') };
    dialog = { choose: jasmine.createSpy('choose') };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DrawingPersistenceService, useValue: persist },
        { provide: UiDialogService, useValue: dialog },
      ],
    });
    injector = TestBed.inject(Injector);
  });

  it('leaves immediately when nothing is dirty', async () => {
    persist.anyDirty.and.returnValue(false);
    await expectAsync(run()).toBeResolvedTo(true);
    expect(dialog.choose).not.toHaveBeenCalled();
  });

  it('prompts when there are unsaved edits', async () => {
    persist.anyDirty.and.returnValue(true);
    dialog.choose.and.resolveTo(null);
    await run();
    expect(dialog.choose).toHaveBeenCalled();

    const opts = dialog.choose.calls.mostRecent().args[0];
    expect(opts.actions.map((a: { id: string }) => a.id)).toEqual(['discard', 'save']);
    expect(opts.cancelLabel).toBe('Stay here');
  });

  it('stays put when the prompt is dismissed', async () => {
    persist.anyDirty.and.returnValue(true);
    dialog.choose.and.resolveTo(null);
    await expectAsync(run()).toBeResolvedTo(false);
    expect(persist.saveAll).not.toHaveBeenCalled();
  });

  it('leaves on Discard without saving', async () => {
    persist.anyDirty.and.returnValue(true);
    dialog.choose.and.resolveTo('discard');
    await expectAsync(run()).toBeResolvedTo(true);
    expect(persist.saveAll).not.toHaveBeenCalled();
  });

  it('leaves on Save all when the save succeeds', async () => {
    persist.anyDirty.and.returnValue(true);
    dialog.choose.and.resolveTo('save');
    persist.saveAll.and.resolveTo(true);
    await expectAsync(run()).toBeResolvedTo(true);
    expect(persist.saveAll).toHaveBeenCalled();
  });

  it('stays put when the save fails, so a failed upload is never a silent discard', async () => {
    persist.anyDirty.and.returnValue(true);
    dialog.choose.and.resolveTo('save');
    persist.saveAll.and.resolveTo(false);
    await expectAsync(run()).toBeResolvedTo(false);
  });
});
