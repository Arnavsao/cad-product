import { Component, inject, HostListener , ChangeDetectionStrategy
} from '@angular/core';

import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DocumentManagerService } from '../../core/services/document-manager.service';
import { ContextMenuService } from '../../core/services/context-menu.service';

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
    this.docManager.closeDocument(tabId);
  }

  onTabMiddleClick(tabId: string, event: MouseEvent): void {
    if (event.button === 1) { // Middle click
      event.preventDefault();
      this.docManager.closeDocument(tabId);
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
          this.docManager.closeDocument(tabId);
        }
      },
      {
        label: 'Close Others',
        action: () => {
          this.contextMenu.hide();
          const others = this.docManager.documents().filter(d => d.tabId !== tabId);
          for (const d of others) this.docManager.closeDocument(d.tabId);
        }
      },
      {
        label: 'Close All',
        action: () => {
          this.contextMenu.hide();
          const all = [...this.docManager.documents()];
          for (const d of all) this.docManager.closeDocument(d.tabId);
        }
      },
      { label: '', separator: true, action: () => {} },
      {
        label: 'Save',
        action: () => {
          this.contextMenu.hide();
          this.docManager.saveDocument(tabId);
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
