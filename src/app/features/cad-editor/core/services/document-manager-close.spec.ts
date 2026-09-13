import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DocumentManagerService } from './document-manager.service';

/**
 * The close hook is how autosave learns a tab is gone. It has to fire on every
 * path that actually removes the tab — "No" (discard), "Yes" (saved), and a
 * forced close — and must NOT fire when a vetoed save keeps the tab open.
 * Before the hook existed only the save path cleaned up, so discarding a dirty
 * tab left its snapshot behind and the next launch reported "unsaved work was
 * recovered" for work the user had just chosen to throw away.
 */
describe('DocumentManagerService close hook', () => {
  let mgr: DocumentManagerService;
  let closed: string[];

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    mgr = TestBed.inject(DocumentManagerService);
    closed = [];
    mgr.setCloseHandler((id) => closed.push(id));
    // Two tabs so closing one never triggers the "keep at least one" fallback.
    mgr.createDocument('Second');
  });

  const dirtyTab = () => {
    const doc = mgr.documents()[0];
    doc.isDirty = true;
    return doc.tabId;
  };

  it('fires when a dirty tab is closed with "No" (discard)', async () => {
    const tab = dirtyTab();
    spyOn(window, 'confirm').and.returnValue(false);
    await mgr.closeDocument(tab);
    expect(closed).toEqual([tab]);
    expect(mgr.documents().some((d) => d.tabId === tab)).toBeFalse();
  });

  it('fires when a dirty tab is closed with "Yes" and the save succeeds', async () => {
    const tab = dirtyTab();
    spyOn(window, 'confirm').and.returnValue(true);
    mgr.setSaveHandler(async () => true);
    await mgr.closeDocument(tab);
    expect(closed).toEqual([tab]);
    expect(mgr.documents().some((d) => d.tabId === tab)).toBeFalse();
  });

  it('does NOT fire when the save is vetoed and the tab stays open', async () => {
    const tab = dirtyTab();
    spyOn(window, 'confirm').and.returnValue(true);
    mgr.setSaveHandler(async () => false);
    await mgr.closeDocument(tab);
    expect(closed).toEqual([]);
    expect(mgr.documents().some((d) => d.tabId === tab)).toBeTrue();
  });

  it('fires on a forced close without asking', async () => {
    const tab = dirtyTab();
    const confirmSpy = spyOn(window, 'confirm');
    await mgr.closeDocument(tab, true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(closed).toEqual([tab]);
  });

  it('fires for a clean tab too', async () => {
    const tab = mgr.documents()[0].tabId;
    const confirmSpy = spyOn(window, 'confirm');
    await mgr.closeDocument(tab);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(closed).toEqual([tab]);
  });
});
