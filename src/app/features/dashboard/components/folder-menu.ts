import { FolderDto } from '../../../core/api/api.models';
import { UiMenuItem } from '../../../shared/ui/menu/ui-menu.component';
import { accessOf, hasAccess } from './drawing-menu';

/** Every action a folder tile / row can raise. */
export type FolderAction = 'open' | 'rename' | 'share' | 'move' | 'delete';

const ACTIONS: readonly FolderAction[] = ['open', 'rename', 'share', 'move', 'delete'];

/**
 * The context menu for one folder, built from the caller's access to it.
 *
 * Design decision: folders had no menu at all before — they were plain links —
 * so this mirrors `drawingMenuFor` deliberately, level for level, rather than
 * inventing a second vocabulary. Sharing a folder covers its subtree, which is
 * why Share sits at `manage`: it hands out access to files the folder merely
 * contains.
 */
export function folderMenuFor(folder: FolderDto): UiMenuItem[] {
  const items: UiMenuItem[] = [{ id: 'open', label: 'Open', icon: 'folder' }];

  if (accessOf(folder) === 'manage') {
    items.push({ id: 'share', label: 'Share…', icon: 'share' });
  }
  if (hasAccess(folder, 'edit')) {
    items.push(
      { id: 'rename', label: 'Rename', icon: 'pencil', separator: true },
      { id: 'move', label: 'Move to…', icon: 'move' },
      // Deleting an *empty* folder is an `edit` operation; only the `force`
      // variant (which trashes what it contains) needs `manage`, and that
      // second step is a confirmation the server can still refuse. Gating the
      // whole item on `manage` would take folder deletion away from ordinary
      // organization members, who have always had it.
      { id: 'delete', label: 'Delete', icon: 'trash', danger: true, separator: true },
    );
  }
  return items;
}

/** Narrow a menu id back to a `FolderAction`; unknown ids are dropped. */
export function toFolderAction(id: string): FolderAction | null {
  return ACTIONS.find((a) => a === id) ?? null;
}
