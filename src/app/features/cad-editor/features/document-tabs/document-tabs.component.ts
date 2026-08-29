import { Component, inject, HostListener , ChangeDetectionStrategy
} from '@angular/core';

import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DocumentManagerService } from '../../core/services/document-manager.service';
import { ContextMenuService } from '../../core/services/context-menu.service';
import { DrawingPersistenceService } from '../../core/services/drawing-persistence.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-document-tabs',
  standalone: true,
  imports: [DragDropModule],
  templateUrl: './document-tabs.component.html',
  styleUrl: './document-tabs.component.scss'
})
export class DocumentTabsComponent {
  public docManager = inject(DocumentManagerService);
  private contextMenu = inject(ContextMenuService);
  private persist = inject(DrawingPersistenceService);

  isMenuOpen = false;

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isMenuOpen = !this.isMenuOpen;
  }

  closeMenu(): void {
    this.isMenuOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.isMenuOpen) {
      this.closeMenu();
    }
  }

  onTabClick(tabId: string): void {
    this.docManager.activateDocument(tabId);
  }

  onTabDoubleClick(tabId: string): void {
    // Zoom extents on double click. Assuming activate is already called if they clicked.
    // We can emit or just let active document be handled by Zoom Extents via ViewModelService.
    const vm = (this.docManager as any).vm; // Hacky but works, or we can add zoomExtentsActive to docManager
    const doc = (this.docManager as any).doc;
    if (vm && doc) {
      vm.zoomExtentsWhenReady(doc);
    }
  }

  onCloseTab(tabId: string, event: MouseEvent): void {
    event.stopPropagation();
    void this.docManager.closeDocument(tabId);
  }

  onTabMiddleClick(tabId: string, event: MouseEvent): void {
    if (event.button === 1) { // Middle click
      event.preventDefault();
      void this.docManager.closeDocument(tabId);
    }
  }

  onNewDrawing(): void {
    this.docManager.createDocument();
  }

  drop(event: CdkDragDrop<string[]>): void {
    const tabs = this.docManager.documents();
    const newOrder = [...tabs].map(t => t.tabId);
    moveItemInArray(newOrder, event.previousIndex, event.currentIndex);
    this.docManager.reorderDocuments(newOrder);
  }

  onWheel(event: WheelEvent): void {
    if (event.deltaY > 0) {
      this.docManager.nextDocument();
    } else if (event.deltaY < 0) {
      this.docManager.prevDocument();
    }
  }

  /**
   * Close tabs one at a time. Sequential on purpose: each dirty tab may raise
   * its own "Save changes?" prompt, and firing them in parallel would stack
   * modals and race the save handler.
   */
  private async closeMany(tabIds: string[]): Promise<void> {
    for (const id of tabIds) {
      await this.docManager.closeDocument(id);
    }
  }

  openContextMenu(event: MouseEvent, tabId: string): void {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const items = [
      {
        label: 'Close',
        action: () => {
          this.contextMenu.hide();
          void this.docManager.closeDocument(tabId);
        }
      },
      {
        label: 'Close Others',
        action: () => {
          this.contextMenu.hide();
          void this.closeMany(this.docManager.documents().filter(d => d.tabId !== tabId).map(d => d.tabId));
        }
      },
      {
        label: 'Close All',
        action: () => {
          this.contextMenu.hide();
          void this.closeMany(this.docManager.documents().map(d => d.tabId));
        }
      },
      { label: '', separator: true, action: () => {} },
      {
        label: 'Save',
        action: () => {
          this.contextMenu.hide();
          // Real cloud save. This used to call `docManager.saveDocument`,
          // which only cleared the dirty flag — the drawing was never written.
          void this.persist.saveTab(tabId);
        }
      },
      {
        label: 'Duplicate',
        action: () => {
          this.contextMenu.hide();
          this.docManager.duplicateDocument(tabId);
        }
      }
    ];
    this.contextMenu.show(event.clientX, event.clientY, items, window.innerWidth, window.innerHeight);
  }

  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    event.preventDefault();
    // Handled by global window:drop in cad-editor, but we prevent default here so it drops onto app.
    // The main app's window:drop handles files.
  }
}
