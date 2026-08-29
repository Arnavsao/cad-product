import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { IPoint, Entity } from '../../core/models/entity.model';
import type { ILibraryItem } from '../../core/models/library.model';
import { LibraryService } from '../../core/services/library.service';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { PasteEntitiesCmd } from '../../core/models/command.model';

/**
 * Click-to-insert tool for Library items.
 *
 * Flow:
 *   1. `LibraryPanelComponent` sets `InsertLibraryItemTool.pendingItem` then
 *      calls `toolMgr.setTool('insert_library_item')`.
 *   2. This tool activates, deserializes the item's entities, and shows a
 *      semi-transparent ghost preview following the cursor.
 *   3. On left-click, the hydrated entities are translated to the cursor
 *      position and committed via PasteEntitiesCmd (undoable).
 *   4. The tool stays active for chained placements. Esc returns to select.
 */
export class InsertLibraryItemTool implements ITool {
  readonly name = 'insert_library_item';

  /** Set by LibraryPanelComponent before activating this tool. */
  static pendingItem: ILibraryItem | null = null;

  private item: ILibraryItem | null = null;
  private preview: Entity[] = [];
  private cur: IPoint = { x: 0, y: 0 };
  private hasCursor = false;
  /** Offset of each preview entity from cursor. */
  private offsets: IPoint[] = [];

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm()  { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get library() { return this.injector.get(LibraryService) as LibraryService; }

  activate(): void {
    this.item = InsertLibraryItemTool.pendingItem;
    InsertLibraryItemTool.pendingItem = null;

    if (!this.item) {
      this.tools.setTool('select');
      return;
    }

    // Hydrate entities once; keep them as the preview template.
    this.preview = this.library._hydrateEntities(this.item.entities);
    if (!this.preview.length) {
      this.tools.setTool('select');
      return;
    }

    // Compute each entity's offset relative to the group centroid.
    const bbox = this._groupBBox(this.preview);
    const cx = bbox ? bbox.x + bbox.w / 2 : 0;
    const cy = bbox ? bbox.y + bbox.h / 2 : 0;
    this.offsets = this.preview.map(e => {
      const b = e.bbox();
      if (!b) return { x: 0, y: 0 };
      return { x: b.x + b.w / 2 - cx, y: b.y + b.h / 2 - cy };
    });
  }

  onMouseMove(wx: number, wy: number, _sx: number, _sy: number, _e: MouseEvent): void {
    this.cur = { x: wx, y: wy };
    this.hasCursor = true;
    this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.hasCursor || !this.item || !this.preview.length) return;

    const bbox = this._groupBBox(this.preview);
    const origCx = bbox ? bbox.x + bbox.w / 2 : 0;
    const origCy = bbox ? bbox.y + bbox.h / 2 : 0;

    // World-space offset to move group centroid to cursor.
    const dx = this.cur.x - origCx;
    const dy = this.cur.y - origCy;

    // Build a proxy ViewModel that adds the world-space offset into every w2s call.
    const vm = this.vm;
    const proxyVm = {
      scale: vm.scale,
      cumulativeScale: (vm as any).cumulativeScale ?? vm.scale,
      w2s: (wx: number, wy: number) => vm.w2s(wx + dx, wy + dy),
      s2w: (sx: number, sy: number) => { const w = vm.s2w(sx, sy); return { x: w.x - dx, y: w.y - dy }; },
    };

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#5eead4';
    ctx.fillStyle = 'rgba(94,234,212,0.18)';
    ctx.lineWidth = 1.5;

    for (const ent of this.preview) {
      ctx.save();
      try { ent.draw(ctx, proxyVm, this.doc.activeFile); } catch { /* skip */ }
      ctx.restore();
    }

    // Crosshair at cursor.
    const s = vm.w2s(this.cur.x, this.cur.y);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#5eead4';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x + 10, s.y);
    ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y + 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  onMouseDown(wx: number, wy: number, _sx: number, _sy: number, e: MouseEvent): void {
    if (e.button !== 0 || !this.item) return;
    this._commit(wx, wy);
    // Stay in tool for chained placements.
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.hasCursor = false;
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  deactivate(): void {
    this.item = null;
    this.preview = [];
    this.offsets = [];
    this.hasCursor = false;
  }

  getAnchor(): IPoint | null {
    return this.hasCursor ? this.cur : null;
  }

  private _commit(wx: number, wy: number): void {
    if (!this.item) return;

    // Fresh hydration for each placement so entities get new IDs.
    const ents = this.library._hydrateEntities(this.item.entities);
    if (!ents.length) return;

    const bbox = this._groupBBox(ents);
    const cx = bbox ? bbox.x + bbox.w / 2 : 0;
    const cy = bbox ? bbox.y + bbox.h / 2 : 0;
    const dx = wx - cx;
    const dy = wy - cy;

    // Use LibraryService internal translation helper via any-cast (package-private).
    for (const ent of ents) {
      (this.library as any)._translateEntity(ent, dx, dy);
      ent.selected = true;
    }

    const file = this.doc.activeFile;
    for (const f of this.doc.files) for (const e of f.entities) e.selected = false;
    for (const e of ents) e.selected = true;

    this.cmds.push(new PasteEntitiesCmd(ents, file, {
      markDirty: () => this.vm.markContentDirty(),
    }));

    this.vm.markDirty();
  }

  private _groupBBox(entities: Entity[]): { x: number; y: number; w: number; h: number } | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let valid = false;
    for (const e of entities) {
      const b = e.bbox?.();
      if (!b || !Number.isFinite(b.x)) continue;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      valid = true;
    }
    return valid ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
  }
}
