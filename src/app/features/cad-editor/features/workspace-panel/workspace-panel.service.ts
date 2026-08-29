import { Injectable, signal } from '@angular/core';

export type DrawerPanelId = 'properties' | 'layers' | 'blocks' | 'viewports' | 'library' | 'ai-agent' | 'l-section' | 'settings' | null;

@Injectable({ providedIn: 'root' })
export class WorkspacePanelService {
  readonly activePanel = signal<DrawerPanelId>(null);

  /** Open and focus a panel. If already open, keeps it open. */
  open(panel: DrawerPanelId): void {
    this.activePanel.set(panel);
  }

  /** Toggle a panel open or closed. */
  toggle(panel: DrawerPanelId): void {
    if (this.activePanel() === panel) {
      this.activePanel.set(null);
    } else {
      this.activePanel.set(panel);
    }
  }

  /** Close the currently open panel. */
  close(): void {
    this.activePanel.set(null);
  }
}
