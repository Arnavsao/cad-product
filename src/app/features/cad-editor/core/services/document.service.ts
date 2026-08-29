import { Injectable, inject, signal, Injector } from '@angular/core';
import { DxfFile, Layer } from '../models/layer.model';
import type { Entity, IBBox } from '../models/entity.model';
import { ViewModelService, createProxyVm, type IProxyVm } from './view-model.service';
import { analyzeDrawingExtents, logExtentsReport, type IExtentsReport, getValidDrawingBounds, debugExtents } from '../utils/extents-debug';
import type { Layout } from '../models/layout.model';
import { SpatialIndexService } from './spatial-index.service';
import { DocumentManagerService } from './document-manager.service';
import { DrawingDocument } from '../models/document.model';

interface IFileRenderCache {
  sorted: Entity[];
  srcRef: Entity[];
  version: number;
}

const FILE_RENDER_CACHE = new WeakMap<DxfFile, IFileRenderCache>();

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private injector = inject(Injector);
  private vm = inject(ViewModelService);
  private spatial = inject(SpatialIndexService);

  private get docManager(): DocumentManagerService {
    return this.injector.get(DocumentManagerService) as DocumentManagerService;
  }

  private get activeDoc(): DrawingDocument {
    const doc = this.docManager.activeDocument;
    if (!doc) {
      throw new Error('No active document available.');
    }
    return doc;
  }

  // Proxied properties to active document
  get activeLayerName(): string { return this.activeDoc.activeLayerName; }
  set activeLayerName(v: string) { this.activeDoc.activeLayerName = v; }

  get activeHatchPattern(): string { return this.activeDoc.activeHatchPattern; }
  set activeHatchPattern(v: string) { this.activeDoc.activeHatchPattern = v; }
  
  /** Temporary pattern for live hover preview in UI */
  previewHatchPattern: string | null = null;

  get isPrintMode(): boolean { return this.activeDoc.isPrintMode; }
  set isPrintMode(v: boolean) { this.activeDoc.isPrintMode = v; }

  get ltScale(): number { return this.activeDoc.ltScale; }
  set ltScale(v: number) { this.activeDoc.ltScale = v; }

  get beditBackground(): Entity[] | null { return this.activeDoc.beditBackground; }
  set beditBackground(v: Entity[] | null) { this.activeDoc.beditBackground = v; }

  get activeFileId(): string | null { return this.activeDoc.tabId; }
  set activeFileId(id: string | null) {
    if (id) this.docManager.activateDocument(id);
  }

  preDrawHook?: () => void;

  readonly activeSpace = signal<'model' | 'paper'>('model');

  readonly version = signal(0);

  bump(): void {
    this.version.update((v) => v + 1);
  }

  get layers(): Map<string, Layer> {
    return this.activeFile.layers;
  }

  get activeLayer(): string {
    return this.activeLayerName;
  }
  set activeLayer(v: string) {
    this.activeLayerName = v;
  }

  get activeLayerObj(): Layer | null {
    return this.activeFile.layers.get(this.activeLayerName) || null;
  }

  get activeFile(): DxfFile {
    return this.activeDoc.file;
  }

  get files(): DxfFile[] {
    return this.activeDoc ? [this.activeDoc.file] : [];
  }

  addEntity(e: Entity): Entity {
    this.activeFile.entities.push(e);
    this.vm.markContentDirty();
    this.docManager.markActiveDirty();
    return e;
  }

  removeEntity(e: Entity): void {
    const file = this.activeFile;
    const idx = file.entities.indexOf(e);
    if (idx !== -1) {
      file.entities.splice(idx, 1);
      this.vm.markContentDirty();
      this.docManager.markActiveDirty();
    }
  }

  getFileOfEntity(e: Entity): DxfFile | null {
    if (this.activeFile.entities.includes(e)) return this.activeFile;
    return null;
  }

  clearSelection(): void {
    let changed = false;
    for (const f of this.files) {
      for (const e of f.entities) {
        if (e.selected) { e.selected = false; changed = true; }
      }
    }
    if (changed) this.vm.markContentDirty();
    else this.vm.markDirty();
  }

  getSelectedEntities(): Entity[] {
    const out: Entity[] = [];
    for (const f of this.files) {
      if (!f.visible) continue;
      for (const e of f.entities) {
        if (!e.selected) continue;
        const lay = f.layers.get(e.layer);
        if (lay && (lay.frozen || !lay.visible)) continue;
        out.push(e);
      }
    }
    return out;
  }

  setEntitySelected(entity: Entity, selected: boolean, opts: { notify?: boolean } = {}): void {
    if (entity.selected === selected) return;
    entity.selected = selected;
    if (opts.notify !== false) this.vm.markContentDirty();
  }

  setSelection(entities: Entity[], opts: { additive?: boolean; notify?: boolean } = {}): void {
    if (!opts.additive) {
      for (const f of this.files) for (const e of f.entities) e.selected = false;
    }
    for (const e of entities) e.selected = true;
    if (opts.notify !== false) this.vm.markContentDirty();
  }

  clear(): void {
    // This used to clear all files. Now it clears just the active document.
    this.activeFile.entities = [];
    this.activeFile.blocks.clear();
    this.activeFile.layers.clear();
    this.vm.markContentDirty();
    this.bump();
  }

  analyzeExtents(silent = false): IExtentsReport {
    const report = analyzeDrawingExtents(this);
    if (!silent) logExtentsReport(report);
    return report;
  }

  getValidDrawingBounds(useSelection = false, log = false): { minX: number; minY: number; maxX: number; maxY: number } | null {
    return getValidDrawingBounds(this, useSelection, log);
  }

  debugExtents(): void {
    debugExtents(this);
  }

  drawAll(ctx: CanvasRenderingContext2D, skipCulling: boolean = false): void {
    this.preDrawHook?.();

    if (this.beditBackground) {
      const file = this.activeFile;
      ctx.globalAlpha = 0.15;
      const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);
      fileVm.annoScale = file.cannoScale;
      for (const e of this.beditBackground) {
        if (!e.visible) continue;
        const lay = file.layers.get(e.layer);
        if (lay && (lay.frozen || !lay.visible)) continue;
        e.draw(ctx, fileVm, file);
      }
      ctx.globalAlpha = 1.0;
    }

    for (const file of this.files) {
      if (!file.visible) continue;
      ctx.globalAlpha = file.opacity;
      const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);
      fileVm.annoScale = file.cannoScale;

      const sortedEntities = this.getSortedEntities(file);
      const cullRect = skipCulling ? null : this.computeCullRect(fileVm);

      let visibleIds: Set<number> | null = null;
      if (cullRect) {
        const ids = this.spatial.queryBox(cullRect);
        if (ids !== null) {
          visibleIds = new Set(ids);
        }
      }

      for (const e of sortedEntities) {
        if (!e.visible || e.inPaperSpace) continue;
        if (this.vm.previewHiddenIds?.has(e.id)) continue;
        const lay = file.layers.get(e.layer);
        if (lay && (lay.frozen || !lay.visible)) continue;

        if (visibleIds) {
          if (e.type === 'XLINE' || e.type === 'RAY') {
             // Always draw infinite lines
          } else if (!visibleIds.has(e.id)) {
             if (!e.selected) continue;
          }
        }

        const isDefpoints = lay && lay.isDefpoints;
        if (isDefpoints) {
          ctx.save();
          ctx.globalAlpha = file.opacity * 0.45;
        }
        e.draw(ctx, fileVm, file);
        if (e.selected) {
          e.drawSelected(ctx, fileVm, file);
          e.drawGrips(ctx, fileVm);
        }
        if (isDefpoints) {
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1.0;
  }

  drawForPlot(ctx: CanvasRenderingContext2D): void {
    for (const file of this.files) {
      if (!file.visible) continue;
      ctx.globalAlpha = file.opacity;
      const fileVm = createProxyVm(this.vm, file.x, file.y, file.scale, file.scale, file.rotation);
      const sortedEntities = this.getSortedEntities(file);
      for (const e of sortedEntities) {
        if (!e.visible || e.inPaperSpace) continue;
        const lay = file.layers.get(e.layer);
        if (lay && (lay.frozen || !lay.visible)) continue;
        if (lay && !lay.print) continue;
        e.draw(ctx, fileVm, file);
      }
    }
  }

  drawPaperEntities(ctx: CanvasRenderingContext2D, layout: Layout, paperVm: IProxyVm): void {
    const file = this.activeFile;
    if (!file.visible) return;
    
    ctx.save();
    ctx.globalAlpha = file.opacity;
    const fileVm = createProxyVm(paperVm, file.x, file.y, file.scale, file.scale, file.rotation);
    fileVm.annoScale = file.cannoScale;

    const sortedEntities = this.getSortedEntities(file);
    for (const e of sortedEntities) {
      if (!e.visible || !e.inPaperSpace) continue;
      if ((e as any).layoutId && (e as any).layoutId !== layout.id) continue;
      
      if (this.vm.previewHiddenIds?.has(e.id)) continue;
      const lay = file.layers.get(e.layer);
      if (lay && (lay.frozen || !lay.visible)) continue;

      const isDefpoints = lay && lay.isDefpoints;
      if (isDefpoints) {
        ctx.save();
        ctx.globalAlpha = file.opacity * 0.45;
      }
      e.draw(ctx, fileVm, file);
      if (e.selected) {
        e.drawSelected(ctx, fileVm, file);
        e.drawGrips(ctx, fileVm);
      }
      if (isDefpoints) {
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private computeCullRect(vm: IProxyVm): IBBox | null {
    if (!this.vm.canvasWidth || !this.vm.canvasHeight) return null;
    const w0 = vm.s2w(0, 0);
    const w1 = vm.s2w(this.vm.canvasWidth, this.vm.canvasHeight);
    const rawMinX = Math.min(w0.x, w1.x);
    const rawMinY = Math.min(w0.y, w1.y);
    const rawMaxX = Math.max(w0.x, w1.x);
    const rawMaxY = Math.max(w0.y, w1.y);
    // Use 2% of viewport dimensions as padding to prevent premature culling
    // of text and hatch entities whose bbox centers are just outside the viewport
    // but whose rendered content extends inside. (Reduced from 10% to fix lag).
    const padX = Math.max(1, (rawMaxX - rawMinX) * 0.02);
    const padY = Math.max(1, (rawMaxY - rawMinY) * 0.02);
    const minX = rawMinX - padX;
    const minY = rawMinY - padY;
    const maxX = rawMaxX + padX;
    const maxY = rawMaxY + padY;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  public getSortedEntities(file: DxfFile): Entity[] {
    const srcRef = file.entities;
    const currentVersion = this.vm.version();
    let cache = FILE_RENDER_CACHE.get(file);

    if (!cache) {
      cache = { sorted: [], srcRef, version: -1 };
      FILE_RENDER_CACHE.set(file, cache);
    }

    if (cache.srcRef !== srcRef || cache.version !== currentVersion) {
      cache.sorted = [...srcRef].sort((a, b) => a.drawOrder - b.drawOrder);
      cache.srcRef = srcRef;
      cache.version = currentVersion;
      return cache.sorted;
    }

    return cache.sorted;
  }
}
