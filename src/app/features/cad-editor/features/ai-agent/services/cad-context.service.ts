import { Injectable, inject } from '@angular/core';
import { DocumentService } from '../../../core/services/document.service';
import { ViewModelService } from '../../../core/services/view-model.service';
import { LibraryService } from '../../../core/services/library.service';
import { ViewDetectionService } from './view-detection.service';
import type { Entity, IBBox } from '../../../core/models/entity.model';
import type {
  CadContextSnapshot, DrawingSummary, LayerSummary, SelectionContext,
  EntityDigest, LibraryCatalogEntry, ViewSummary,
} from '../models/ai-context.model';

/** Max entities in the full selection digest before falling back to histogram. */
const DETAIL_CAP = 200;

@Injectable({ providedIn: 'root' })
export class CadContextService {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private lib = inject(LibraryService);
  private viewDetection = inject(ViewDetectionService);

  // Revision-keyed cache so repeated calls within the same frame are free.
  private _rev = -1;
  private _summary: DrawingSummary | null = null;
  private _layers: LayerSummary[] | null = null;
  private _views: ViewSummary[] | null = null;

  build(): CadContextSnapshot {
    const file = this.doc.activeFile;
    const rev = this.doc.version();

    if (rev !== this._rev || !this._summary || !this._layers || !this._views) {
      this._summary = this._buildSummary(file.entities);
      this._layers = this._buildLayers();
      this._views = this._buildViews();
      this._rev = rev;
    }

    return {
      schemaVersion: 1,
      documentId: file.id,
      revision: rev,
      activeFileId: this.doc.activeFileId,
      activeLayer: this.doc.activeLayerName,
      summary: this._summary!,
      selection: this._buildSelection(this.doc.getSelectedEntities()),
      layers: this._layers!,
      views: this._views!,
      libraryCatalog: this._buildLibraryCatalog(),
      viewport: {
        scale: this.vm.scale,
        panX: this.vm.panX,
        panY: this.vm.panY,
        canvasWidth: this.vm.canvasWidth,
        canvasHeight: this.vm.canvasHeight,
      },
      cursor: { ...this.vm.lastCursorWorld },
    };
  }

  /** Detected model-space views, capped so a huge sheet never bloats context. */
  private _buildViews(): ViewSummary[] {
    return this.viewDetection.detect().slice(0, 50).map(v => ({
      id: v.id,
      label: v.label,
      bbox: v.bbox,
      entityCount: v.entityIds.length,
    }));
  }

  private _buildSummary(entities: Entity[]): DrawingSummary {
    const byType: Record<string, number> = {};
    const byLayer: Record<string, number> = {};
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasBbox = false;

    for (const e of entities) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      byLayer[e.layer] = (byLayer[e.layer] ?? 0) + 1;
      const bb = typeof e.bbox === 'function' ? e.bbox() : null;
      if (bb && isFinite(bb.x) && isFinite(bb.y) && isFinite(bb.w) && isFinite(bb.h)) {
        hasBbox = true;
        if (bb.x < minX) minX = bb.x;
        if (bb.y < minY) minY = bb.y;
        if (bb.x + bb.w > maxX) maxX = bb.x + bb.w;
        if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
      }
    }

    return {
      entityCount: entities.length,
      byType,
      byLayer,
      worldExtents: hasBbox ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null,
    };
  }

  private _buildLayers(): LayerSummary[] {
    const file = this.doc.activeFile;
    const byLayer = this._buildSummary(file.entities).byLayer;
    const out: LayerSummary[] = [];
    for (const [name, lay] of file.layers) {
      out.push({
        name,
        color: lay.color,
        visible: lay.visible,
        locked: lay.locked,
        frozen: lay.frozen,
        entityCount: byLayer[name] ?? 0,
      });
    }
    return out;
  }

  private _buildSelection(selected: Entity[]): SelectionContext {
    const byType: Record<string, number> = {};
    const byLayer: Record<string, number> = {};
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasBbox = false;

    for (const e of selected) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      byLayer[e.layer] = (byLayer[e.layer] ?? 0) + 1;
      const bb = typeof e.bbox === 'function' ? e.bbox() : null;
      if (bb && isFinite(bb.x)) {
        hasBbox = true;
        if (bb.x < minX) minX = bb.x;
        if (bb.y < minY) minY = bb.y;
        if (bb.x + bb.w > maxX) maxX = bb.x + bb.w;
        if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
      }
    }

    const ctx: SelectionContext = {
      count: selected.length,
      ids: selected.map(e => e.id),
      byType,
      byLayer,
      bbox: hasBbox ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null,
    };

    if (selected.length <= DETAIL_CAP) {
      ctx.entities = selected.map(e => this._digestEntity(e));
    }

    return ctx;
  }

  private _digestEntity(e: Entity): EntityDigest {
    return {
      id: e.id,
      type: e.type,
      layer: e.layer,
      color: e.color ?? String(e.colorNumber),
      bbox: typeof e.bbox === 'function' ? e.bbox() : null,
    };
  }

  private _buildLibraryCatalog(): LibraryCatalogEntry[] {
    return this.lib.items().map(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
      tags: item.tags,
    }));
  }
}
