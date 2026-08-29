import { Injectable, inject, signal, Injector } from '@angular/core';
import { DocumentService } from './document.service';

import { DrawingDocument } from '../models/document.model';
import { ViewModelService } from './view-model.service';
import { setEntityIdGenerator } from '../models/entity.model';
import { DxfFile, Layer, ensureDefpoints } from '../models/layer.model';

export const MAX_OPEN_DOCUMENTS = 100;

@Injectable({ providedIn: 'root' })
export class DocumentManagerService {
  private injector = inject(Injector);
  private vm = inject(ViewModelService);

  private docsSignal = signal<DrawingDocument[]>([]);
  public readonly documents = this.docsSignal.asReadonly();

  private activeTabIdSignal = signal<string | null>(null);

  private closedDocuments: DrawingDocument[] = [];

  /**
   * Injected by `DrawingPersistenceService` at startup. Without it the
   * "Save changes?" prompt in `closeDocument` had nowhere real to go and
   * silently cleared `isDirty` instead — losing the drawing. Kept as a
   * callback rather than a direct injection because persistence depends on
   * this service; injecting it back would close a DI cycle.
   */
  private saveHandler: ((tabId: string) => Promise<boolean>) | null = null;

  constructor() {
    // Ensure entity IDs are generated sequentially per document
    setEntityIdGenerator(() => {
      const active = this.activeDocument;
      if (active) {
        return active.entityIdCounter++;
      }
      return Math.floor(Math.random() * 1000000); // fallback if no document is active
    });

    // Initialize with a default document to prevent NG0600 during initial render
    this.createDocument();
  }

  // Lazy load DocumentService to avoid circular DI
  private get doc(): DocumentService {
    return this.injector.get(DocumentService) as DocumentService;
  }

  public get activeTabId(): string | null {
    return this.activeTabIdSignal();
  }

  public get activeDocument(): DrawingDocument | undefined {
    const activeId = this.activeTabIdSignal();
    return this.docsSignal().find(d => d.tabId === activeId);
  }

  public openDocument(file: DxfFile): void {
    if (this.docsSignal().length >= MAX_OPEN_DOCUMENTS) {
      alert(`Cannot open more than ${MAX_OPEN_DOCUMENTS} documents.`);
      return;
    }

    const docs = this.docsSignal();
    
    // Check if it's already open
    const existing = docs.find(d => d.file === file);
    if (existing) {
      this.activateDocument(existing.tabId);
      return;
    }

    const order = docs.length > 0 ? Math.max(...docs.map(d => d.order)) + 1 : 0;
    
    const newDoc = new DrawingDocument(file);
    newDoc.order = order;

    this.docsSignal.update(d => [...d, newDoc]);
    this.activateDocument(file.id);
    this.saveOrderToSession();
  }

  public createDocument(name?: string): void {
    const fileCount = this.docsSignal().length + 1;
    const file = new DxfFile(name || `Drawing${fileCount}`);
    file.layers.set('Layer 0', new Layer('Layer 0'));
    ensureDefpoints(file);
    this.openDocument(file);
  }

  public activateDocument(tabId: string): void {
    const target = this.docsSignal().find(d => d.tabId === tabId);
    if (!target) return;

    this.activeTabIdSignal.set(tabId);
    
    // Ensure active layer is valid
    if (!target.file.layers.has(target.activeLayerName)) {
      const firstLayer = target.file.layers.keys().next();
      if (!firstLayer.done) {
        target.activeLayerName = firstLayer.value;
      }
    }

    this.doc.bump();
    this.vm.zoomExtentsWhenReady(this.doc); // Auto zoom extents on switch
    this.vm.markContentDirty();
  }

  /**
   * Register the real save routine used by the close prompt. Called once by
   * `DrawingPersistenceService`; the handler returns false when the save was
   * cancelled or failed, which aborts the close.
   */
  public setSaveHandler(fn: (tabId: string) => Promise<boolean>): void {
    this.saveHandler = fn;
  }

  /**
   * Close a tab, offering to save it first when it is dirty.
   *
   * Async because answering "Yes" now performs a REAL save (through
   * `setSaveHandler`) and the close must not proceed until it succeeds — a
   * failed or cancelled save leaves the tab open with its work intact.
   * Callers that do not care about the outcome may ignore the promise.
   */
  public async closeDocument(tabId: string, force = false): Promise<void> {
    const docToClose = this.docsSignal().find(d => d.tabId === tabId);
    if (!docToClose) return;

    if (!force && docToClose.isDirty) {
      const save = confirm(`Save changes to ${docToClose.file.name} before closing?`);
      if (save) {
        // No handler (persistence never started, e.g. a bare unit-test host):
        // fall back to the old flag-clearing behaviour rather than trapping
        // the user in a tab they cannot close.
        const saved = this.saveHandler ? await this.saveHandler(tabId) : true;
        if (!saved) return;
        this.saveDocument(tabId);
      }
    }

    // Re-check: the await above yielded, so the tab may already be gone.
    if (!this.docsSignal().some(d => d.tabId === tabId)) return;

    // Push to closed stack
    this.closedDocuments.push(docToClose);

    // Remove from UI list
    let updatedDocs = this.docsSignal().filter(d => d.tabId !== tabId);
    this.docsSignal.set(updatedDocs);

    // If active was closed, switch to the last available document
    if (this.activeTabIdSignal() === tabId) {
      if (updatedDocs.length > 0) {
        // Activate the last ordered one
        const lastDoc = [...updatedDocs].sort((a, b) => a.order - b.order).pop();
        if (lastDoc) {
          this.activateDocument(lastDoc.tabId);
        }
      } else {
        // Create an empty default if everything is closed
        this.activeTabIdSignal.set(null);
        this.createDocument();
      }
    } else {
      this.doc.bump();
      this.vm.markDirty();
    }
    
    this.saveOrderToSession();
  }

  /**
   * Close the throwaway `Drawing<N>` tabs left behind when a real drawing is
   * opened (import, cloud open, host hand-off). The constructor always creates
   * one so the first render has a document, and every open path used to
   * duplicate this loop; it now lives here.
   *
   * A tab qualifies only when it is empty AND untouched AND still carries its
   * generated name — an empty drawing the user deliberately named or edited is
   * their work, not scaffolding. Forced close, so no save prompt can appear.
   */
  public closeBlankDocuments(exceptTabId: string): void {
    for (const d of [...this.docsSignal()]) {
      if (d.tabId === exceptTabId) continue;
      if (d.isDirty) continue;
      if (d.file.entities.length > 0) continue;
      if (!/^Drawing\d+$/.test(d.file.name)) continue;
      void this.closeDocument(d.tabId, true);
    }
  }

  public saveDocument(tabId: string): void {
    const target = this.docsSignal().find(d => d.tabId === tabId);
    if (target) {
      target.isDirty = false;
      this.docsSignal.set([...this.docsSignal()]); // trigger reactivity
    }
  }

  public duplicateDocument(tabId: string): void {
    const target = this.docsSignal().find(d => d.tabId === tabId);
    if (!target) return;

    const newFile = new DxfFile(`${target.file.name}_Copy`);
    newFile.entities = target.file.entities.map(e => e.clone());
    
    for (const [name, layer] of target.file.layers) {
      newFile.layers.set(name, layer);
    }
    for (const [name, block] of target.file.blocks) {
      newFile.blocks.set(name, block);
    }

    this.openDocument(newFile);
  }

  public reorderDocuments(newOrderTabIds: string[]): void {
    const current = this.docsSignal();
    const updated = current.map(d => {
      const idx = newOrderTabIds.indexOf(d.tabId);
      return Object.assign(d, { order: idx !== -1 ? idx : d.order });
    });
    updated.sort((a, b) => a.order - b.order);
    this.docsSignal.set(updated);
    this.saveOrderToSession();
  }

  public reopenLastClosedDocument(): void {
    if (this.closedDocuments.length === 0) return;
    const lastClosed = this.closedDocuments.pop();
    if (lastClosed) {
      this.openDocument(lastClosed.file);
    }
  }

  public markActiveDirty(): void {
    const active = this.activeDocument;
    if (active && !active.isDirty) {
      active.isDirty = true;
      this.docsSignal.set([...this.docsSignal()]);
    }
  }

  public nextDocument(): void {
    const docs = [...this.docsSignal()].sort((a, b) => a.order - b.order);
    if (docs.length <= 1) return;
    const activeIdx = docs.findIndex(d => d.tabId === this.activeTabIdSignal());
    if (activeIdx !== -1) {
      const nextIdx = (activeIdx + 1) % docs.length;
      this.activateDocument(docs[nextIdx].tabId);
    }
  }

  public prevDocument(): void {
    const docs = [...this.docsSignal()].sort((a, b) => a.order - b.order);
    if (docs.length <= 1) return;
    const activeIdx = docs.findIndex(d => d.tabId === this.activeTabIdSignal());
    if (activeIdx !== -1) {
      const prevIdx = (activeIdx - 1 + docs.length) % docs.length;
      this.activateDocument(docs[prevIdx].tabId);
    }
  }

  private saveOrderToSession(): void {
    try {
      const orderMap = this.docsSignal().map(d => d.tabId);
      sessionStorage.setItem('document_tabs_order', JSON.stringify(orderMap));
    } catch (e) {
      console.warn('Could not save tab order to sessionStorage', e);
    }
  }

  public loadOrderFromSession(): void {
    try {
      const orderData = sessionStorage.getItem('document_tabs_order');
      if (orderData) {
        const orderMap: string[] = JSON.parse(orderData);
        if (Array.isArray(orderMap)) {
          this.reorderDocuments(orderMap);
        }
      }
    } catch (e) {
      console.warn('Could not load tab order from sessionStorage', e);
    }
  }
}
