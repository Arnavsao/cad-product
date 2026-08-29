import { UiMenuItem } from '../../../shared/ui/menu/ui-menu.component';

/** Every action a drawing card / row can raise. */
export type DrawingAction = 'open' | 'rename' | 'duplicate' | 'move' | 'download' | 'delete';

/**
 * The shared context menu for a drawing. Declared once so the card, the row and
 * the right-click menu can never drift apart.
 */
export const DRAWING_MENU_ITEMS: readonly UiMenuItem[] = [
  { id: 'open', label: 'Open', icon: 'file' },
  { id: 'rename', label: 'Rename', icon: 'pencil' },
  { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
  { id: 'move', label: 'Move to…', icon: 'move' },
  { id: 'download', label: 'Download DXF', icon: 'download', separator: true },
  { id: 'delete', label: 'Delete', icon: 'trash', danger: true, separator: true },
];

/** Narrow a menu id back to a `DrawingAction`; unknown ids are dropped. */
export function toDrawingAction(id: string): DrawingAction | null {
  return (['open', 'rename', 'duplicate', 'move', 'download', 'delete'] as const).find((a) => a === id) ?? null;
}
