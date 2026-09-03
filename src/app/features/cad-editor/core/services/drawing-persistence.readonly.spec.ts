import { WritableSignal, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import type { DrawingDto } from '../../../../core/api/api.models';
import { DrawingsApiService } from '../../../../core/api/drawings-api.service';
import { ApiError } from '../../../../core/services/http-manager.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { UiDialogService } from '../../../../shared/ui/dialog/ui-dialog.service';
import { DrawingBrowserService } from '../../features/drawing-browser/drawing-browser.service';
import { AutosaveService } from './autosave.service';
import { DocumentManagerService } from './document-manager.service';
import { DrawingPersistenceService } from './drawing-persistence.service';
import { DrawingStoreService } from './drawing-store.service';
import { DxfImportService } from './dxf-import.service';
import { ExportService } from './export.service';
import { ThumbnailService } from './thumbnail.service';

/**
 * Workspace-aware Save As and view-only access, which together decide where a
 * drawing's bytes are allowed to land. Everything here goes through the public
 * surface (`openRemote` → `saveActive`) rather than poking at the binding map,
 * because the binding is exactly the thing under test.
 */
describe('DrawingPersistenceService — workspaces and view-only access', () => {
  /** One open tab; the real `DrawingDocument` is far larger than this needs. */
  interface FakeDoc {
    tabId: string;
    isDirty: boolean;
    file: { name: string };
  }

  let doc: FakeDoc;
  let api: jasmine.SpyObj<DrawingsApiService>;
  let dialog: { choose: jasmine.Spy };
  let docManager: {
    documents: WritableSignal<FakeDoc[]>;
    activeTabId: string | null;
    activeDocument: FakeDoc | null;
    activateDocument: jasmine.Spy;
    saveDocument: jasmine.Spy;
    closeDocument: jasmine.Spy;
    closeBlankDocuments: jasmine.Spy;
    setSaveHandler: jasmine.Spy;
  };
  let persist: DrawingPersistenceService;

  /** A `DrawingDto` with just the fields the persistence layer reads. */
  const dto = (over: Partial<DrawingDto> = {}): DrawingDto =>
    ({
      id: 'd1',
      name: 'Plan',
      currentVersion: 3,
      folderId: null,
      organizationId: null,
      access: 'manage',
      downloadUrl: 'https://storage.test/d1.dxf',
      ...over,
    }) as DrawingDto;

  beforeEach(() => {
    doc = { tabId: 't1', isDirty: false, file: { name: 'Plan' } };

    api = jasmine.createSpyObj<DrawingsApiService>('DrawingsApiService', [
      'get',
      'fetchContent',
      'create',
      'putContent',
      'presignContent',
      'completeContent',
      'uploadToStorage',
    ]);
    api.fetchContent.and.resolveTo('0\nSECTION\n');
    api.uploadToStorage.and.returnValue(of({} as never));

    dialog = { choose: jasmine.createSpy('choose').and.resolveTo(null) };

    docManager = {
      documents: signal([doc]),
      activeTabId: 't1',
      activeDocument: doc,
      activateDocument: jasmine.createSpy('activateDocument'),
      saveDocument: jasmine.createSpy('saveDocument'),
      closeDocument: jasmine.createSpy('closeDocument').and.resolveTo(undefined),
      closeBlankDocuments: jasmine.createSpy('closeBlankDocuments'),
      setSaveHandler: jasmine.createSpy('setSaveHandler'),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        DrawingPersistenceService,
        { provide: DrawingsApiService, useValue: api },
        { provide: UiDialogService, useValue: dialog },
        { provide: DocumentManagerService, useValue: docManager },
        {
          provide: DrawingStoreService,
          useValue: { isAvailable: () => true, save: () => Promise.resolve(), get: () => Promise.resolve(null) },
        },
        { provide: AutosaveService, useValue: { markClean: () => {} } },
        { provide: ExportService, useValue: { buildDxfString: () => '0\nSECTION\n' } },
        { provide: DxfImportService, useValue: { loadDxfDataAsync: () => Promise.resolve(1) } },
        {
          provide: NotificationService,
          useValue: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} },
        },
        { provide: DrawingBrowserService, useValue: { openAndWait: () => Promise.resolve(false) } },
        { provide: ThumbnailService, useValue: { scheduleThumbnail: () => {} } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true), navigateByUrl: () => Promise.resolve(true) } },
      ],
    });
    persist = TestBed.inject(DrawingPersistenceService);
  });

  /** Bind the tab to a server drawing the way a real `/editor/:id` visit does. */
  const openBound = async (over: Partial<DrawingDto> = {}) => {
    api.get.and.resolveTo(dto(over));
    await persist.openRemote(over.id ?? 'd1');
  };

  it('carries the workspace and the access level onto the binding', async () => {
    await openBound({ organizationId: 'org1', folderId: 'f1', access: 'edit' });

    const bound = persist.remoteForTab('t1');
    expect(bound?.organizationId).toBe('org1');
    expect(bound?.folderId).toBe('f1');
    expect(bound?.access).toBe('edit');
  });

  it('defaults access to manage when the server does not send one', async () => {
    await openBound({ access: undefined });
    expect(persist.accessForTab('t1')).toBe('manage');
    expect(persist.activeIsReadOnly()).toBeFalse();
  });

  it('reports view-only access as the readonly cloud state, even when dirty', async () => {
    await openBound({ access: 'view' });
    doc.isDirty = true;
    docManager.documents.set([doc]);

    expect(persist.activeIsReadOnly()).toBeTrue();
    expect(persist.cloudState()).toBe('readonly');
  });

  it('offers a copy instead of writing over a view-only drawing', async () => {
    await openBound({ access: 'view' });

    await expectAsync(persist.saveActive()).toBeResolvedTo(false);
    expect(api.putContent).not.toHaveBeenCalled();
    expect(dialog.choose).toHaveBeenCalled();
    expect(dialog.choose.calls.mostRecent().args[0].message).toContain('view-only');
  });

  it('saves the copy into My Drawings, never the shared workspace', async () => {
    await openBound({ access: 'view', organizationId: 'org1', folderId: 'f1' });
    dialog.choose.and.resolveTo('copy');
    api.create.and.resolveTo(dto({ id: 'd2', name: 'Plan (copy)', currentVersion: 1 }));

    await expectAsync(persist.saveActive()).toBeResolvedTo(true);

    const req = api.create.calls.mostRecent().args[0];
    expect(req.name).toBe('Plan (copy)');
    expect(req.folderId).toBeNull();
    expect(req.organizationId).toBeNull();
    // The tab now follows the copy, so a second Ctrl+S saves normally.
    expect(persist.remoteIdForTab('t1')).toBe('d2');
    expect(persist.accessForTab('t1')).toBe('manage');
  });

  it('maps a 403 from the server onto the same copy prompt', async () => {
    await openBound({ access: 'edit' });
    api.putContent.and.rejectWith(new ApiError('Forbidden', 403, 'FORBIDDEN'));

    await expectAsync(persist.saveActive()).toBeResolvedTo(false);
    expect(dialog.choose).toHaveBeenCalled();
    expect(dialog.choose.calls.mostRecent().args[0].message).toContain('view-only');
    // Believing the server means the header stops advertising a save.
    expect(persist.cloudState()).toBe('readonly');
  });

  it('sends the chosen workspace with Save As', async () => {
    api.create.and.resolveTo(dto({ id: 'd9', organizationId: 'org2' }));

    await expectAsync(persist.saveActiveAs('Site plan', null, 'org2')).toBeResolvedTo(true);

    const req = api.create.calls.mostRecent().args[0];
    expect(req.organizationId).toBe('org2');
    expect(persist.remoteForTab('t1')?.organizationId).toBe('org2');
  });

  it('keeps the source workspace when a conflict is forked into a copy', async () => {
    await openBound({ access: 'manage', organizationId: 'org1', folderId: 'f1' });
    api.putContent.and.rejectWith(new ApiError('Conflict', 409, 'VERSION_CONFLICT', { currentVersion: 9 }));
    dialog.choose.and.resolveTo('copy');
    api.create.and.resolveTo(dto({ id: 'd3', name: 'Plan (conflict copy)', organizationId: 'org1', folderId: 'f1' }));

    await expectAsync(persist.saveActive()).toBeResolvedTo(true);

    const req = api.create.calls.mostRecent().args[0];
    expect(req.name).toBe('Plan (conflict copy)');
    expect(req.folderId).toBe('f1');
    expect(req.organizationId).toBe('org1');
  });
});
