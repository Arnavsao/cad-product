import { AccessLevel, DrawingFormat, DrawingSummaryDto } from '../../../core/api/api.models';
import { UiMenuItem } from '../../../shared/ui/menu/ui-menu.component';

/** Every action a drawing card / row can raise. */
export type DrawingAction =
  | 'open'
  | 'share'
  | 'rename'
  | 'duplicate'
  | 'copy'
  | 'move'
  | 'download'
  | 'versions'
  | 'delete';

const ACTIONS: readonly DrawingAction[] = [
  'open',
  'share',
  'rename',
  'duplicate',
  'copy',
  'move',
  'download',
  'versions',
  'delete',
];

/** Rank of an access level, so `>=` comparisons read the way they sound. */
const RANK: Record<AccessLevel, number> = { view: 0, edit: 1, manage: 2 };

/**
 * The caller's access to a row, defaulting to `manage`.
 *
 * The default matters: `access` is a new field, and a client talking to an API
 * that predates it must keep the menu it has always had (before sharing, being
 * able to list a drawing meant being able to do everything to it) rather than
 * silently degrading every row to read-only.
 */
export function accessOf(item: { access?: AccessLevel }): AccessLevel {
  return item.access ?? 'manage';
}

/** True when the caller's access on `item` reaches `min`. */
export function hasAccess(item: { access?: AccessLevel }, min: AccessLevel): boolean {
  return RANK[accessOf(item)] >= RANK[min];
}

/** The file name a download should be saved under, extension included once. */
export function downloadNameFor(name: string, format: DrawingFormat): string {
  const suffix = `.${format}`;
  return name.toLowerCase().endsWith(suffix) ? name : `${name}${suffix}`;
}

/**
 * The context menu for one drawing, built from the caller's access to it.
 *
 * Design decisions:
 *
 * - **One function, every surface.** The card, the row, the right-click menu and
 *   Recent all call this, so a viewer can never be offered Rename in one place
 *   and refused it in another.
 *
 * - **Access decides, and it is a floor not a promise.** `view` gets the four
 *   read-only actions, `edit` adds the mutations, `manage` adds sharing. The
 *   server enforces the same table (403 `FORBIDDEN`), so hiding an item is
 *   about not offering a certain failure — never about security.
 *
 * - **The download label names no format.** It used to say "Download DXF" on
 *   DWG rows; the extension now comes from `drawing.format` (see
 *   `downloadNameFor`) and the label just says Download.
 */
export function drawingMenuFor(drawing: DrawingSummaryDto): UiMenuItem[] {
  const level = accessOf(drawing);
  const items: UiMenuItem[] = [{ id: 'open', label: 'Open', icon: 'file' }];

  if (level === 'manage') {
    items.push({
      id: 'share',
      label: drawing.shareCount ? `Share… (${drawing.shareCount})` : 'Share…',
      icon: 'share',
    });
  }

  if (RANK[level] >= RANK.edit) {
    items.push(
      { id: 'rename', label: 'Rename', icon: 'pencil', separator: true },
      { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
      { id: 'move', label: 'Move to…', icon: 'move' },
    );
  }

  items.push(
    { id: 'copy', label: 'Copy to…', icon: 'copy', separator: RANK[level] < RANK.edit },
    { id: 'download', label: 'Download', icon: 'download' },
    { id: 'versions', label: 'Version history', icon: 'history' },
  );

  if (RANK[level] >= RANK.edit) {
    items.push({ id: 'delete', label: 'Delete', icon: 'trash', danger: true, separator: true });
  }
  return items;
}

/** Narrow a menu id back to a `DrawingAction`; unknown ids are dropped. */
export function toDrawingAction(id: string): DrawingAction | null {
  return ACTIONS.find((a) => a === id) ?? null;
}
