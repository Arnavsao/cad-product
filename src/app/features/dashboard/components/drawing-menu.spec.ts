import { AccessLevel, DrawingFormat, DrawingSummaryDto, FolderDto } from '../../../core/api/api.models';
import { accessOf, downloadNameFor, drawingMenuFor, hasAccess, toDrawingAction } from './drawing-menu';
import { folderMenuFor, toFolderAction } from './folder-menu';

/**
 * The menus are the whole of the client-side permission story: everything a
 * viewer must not be offered is decided here, and every surface (card, row,
 * right-click, Recent) renders whatever these functions return. These cases pin
 * each level to its actions — and pin the default, which is what a client sees
 * when it is newer than the API it is talking to.
 */
function drawing(patch: Partial<DrawingSummaryDto> = {}): DrawingSummaryDto {
  return {
    id: 'd1',
    name: 'Plan',
    format: 'dxf' as DrawingFormat,
    folderId: null,
    organizationId: null,
    organizationName: null,
    owner: null,
    byteSize: 1024,
    currentVersion: 3,
    thumbnailUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    lastOpenedAt: null,
    ...patch,
  };
}

function folder(patch: Partial<FolderDto> = {}): FolderDto {
  return {
    id: 'f1',
    name: 'Projects',
    parentId: null,
    organizationId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

const idsOf = (access?: AccessLevel) => drawingMenuFor(drawing({ access })).map((item) => item.id);

describe('drawingMenuFor', () => {
  it('offers a viewer only the read-only actions', () => {
    expect(idsOf('view')).toEqual(['open', 'copy', 'download', 'versions']);
  });

  it('adds the mutations at edit, but not sharing', () => {
    expect(idsOf('edit')).toEqual(['open', 'rename', 'duplicate', 'move', 'copy', 'download', 'versions', 'delete']);
  });

  it('adds Share only at manage', () => {
    expect(idsOf('manage')).toContain('share');
    expect(idsOf('edit')).not.toContain('share');
    expect(idsOf('view')).not.toContain('share');
  });

  it('falls back to manage when the server did not send an access level', () => {
    // A client newer than its API must keep the menu it has always had.
    expect(idsOf(undefined)).toEqual(idsOf('manage'));
  });

  it('badges Share with the number of existing shares', () => {
    const items = drawingMenuFor(drawing({ access: 'manage', shareCount: 2 }));
    expect(items.find((i) => i.id === 'share')?.label).toBe('Share… (2)');
    expect(drawingMenuFor(drawing({ access: 'manage' })).find((i) => i.id === 'share')?.label).toBe('Share…');
  });

  it('names no format in the Download label', () => {
    const label = (format: DrawingFormat) =>
      drawingMenuFor(drawing({ format })).find((i) => i.id === 'download')?.label;
    expect(label('dxf')).toBe('Download');
    expect(label('dwg')).toBe('Download');
  });
});

describe('accessOf / hasAccess', () => {
  it('ranks the levels', () => {
    expect(hasAccess(drawing({ access: 'view' }), 'edit')).toBe(false);
    expect(hasAccess(drawing({ access: 'edit' }), 'edit')).toBe(true);
    expect(hasAccess(drawing({ access: 'edit' }), 'manage')).toBe(false);
    expect(hasAccess(drawing({ access: 'manage' }), 'manage')).toBe(true);
  });

  it('treats a missing level as manage', () => {
    expect(accessOf(drawing())).toBe('manage');
    expect(hasAccess(drawing(), 'manage')).toBe(true);
  });
});

describe('downloadNameFor', () => {
  it('uses the drawing format and never doubles the extension', () => {
    expect(downloadNameFor('plan', 'dxf')).toBe('plan.dxf');
    expect(downloadNameFor('plan', 'dwg')).toBe('plan.dwg');
    expect(downloadNameFor('plan.dwg', 'dwg')).toBe('plan.dwg');
    expect(downloadNameFor('PLAN.DXF', 'dxf')).toBe('PLAN.DXF');
  });

  it('does not treat the other format as its own extension', () => {
    // A DWG named "plan.dxf" downloads as "plan.dxf.dwg" — the bytes decide.
    expect(downloadNameFor('plan.dxf', 'dwg')).toBe('plan.dxf.dwg');
  });
});

describe('folderMenuFor', () => {
  it('offers a viewer nothing but Open', () => {
    expect(folderMenuFor(folder({ access: 'view' })).map((i) => i.id)).toEqual(['open']);
  });

  it('lets an editor rename, move and delete', () => {
    expect(folderMenuFor(folder({ access: 'edit' })).map((i) => i.id)).toEqual(['open', 'rename', 'move', 'delete']);
  });

  it('adds Share at manage', () => {
    expect(folderMenuFor(folder({ access: 'manage' })).map((i) => i.id)).toEqual([
      'open',
      'share',
      'rename',
      'move',
      'delete',
    ]);
  });
});

describe('action narrowing', () => {
  it('accepts the ids the menus emit and rejects anything else', () => {
    expect(toDrawingAction('versions')).toBe('versions');
    expect(toDrawingAction('share')).toBe('share');
    expect(toDrawingAction('sep')).toBeNull();
    expect(toFolderAction('delete')).toBe('delete');
    expect(toFolderAction('duplicate')).toBeNull();
  });
});
