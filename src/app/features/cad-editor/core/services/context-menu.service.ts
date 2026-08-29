import { Injectable, signal } from '@angular/core';

export interface IContextMenuItem {
  label: string;
  icon?: string;
  action: () => void;
  danger?: boolean;
  separator?: boolean;
}

export interface IContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: IContextMenuItem[];
}

/**
 * Lightweight signal-based context menu service.
 *
 * Any component can show a context menu by calling `show()` with a position
 * and an array of action items. The canvas right-click handler uses this
 * to expose "Add to Library" and other entity actions.
 *
 * Only one context menu can be visible at a time; subsequent `show()` calls
 * replace the previous menu.
 */
@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  readonly state = signal<IContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
  });

  show(x: number, y: number, items: IContextMenuItem[], containerWidth?: number, containerHeight?: number): void {
    let finalX = x;
    let finalY = y;

    if (containerWidth && containerHeight) {
      const estimatedHeight = items.length * 36 + 16;
      const estimatedWidth = 200; // rough estimate for menu width

      if (y + estimatedHeight > containerHeight) {
        finalY = Math.max(10, containerHeight - estimatedHeight - 10);
      }
      
      if (x + estimatedWidth > containerWidth) {
        finalX = Math.max(10, containerWidth - estimatedWidth - 10);
      }
    }

    this.state.set({ visible: true, x: finalX, y: finalY, items });
  }

  hide(): void {
    this.state.update(s => ({ ...s, visible: false }));
  }
}
