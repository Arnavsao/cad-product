import { Injectable, inject, signal, computed } from '@angular/core';
import { DocumentService } from './document.service';
import { ViewModelService } from './view-model.service';
import { CommandStackService } from './command-stack.service';
import { PasteEntitiesCmd } from '../models/command.model';
import type { Entity, IPoint, IBBox } from '../models/entity.model';
import {
  LineEntity, CircleEntity, ArcEntity, PolylineEntity, PointEntity,
} from '../models/entity.model';
import {
  TextEntity, EllipseEntity, SplineEntity, HatchEntity,
  InsertEntity, XLineEntity, LeaderEntity, DimensionEntity,
} from '../models/entity-extended.model';
import { ImageEntity } from '../models/image-entity.model';
import { TableEntity } from '../models/table-entity.model';
import {
  ILibraryItem, ILibraryCategory, DEFAULT_CATEGORIES, generateLibraryId,
} from '../models/library.model';

const STORAGE_KEY = 'cad_asset_library_v1';
const THUMB_SIZE = 80;

@Injectable({ providedIn: 'root' })
export class LibraryService {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private cmds = inject(CommandStackService);

  // ── Reactive state ──────────────────────────────────────────────────────
  readonly items = signal<ILibraryItem[]>(this._load());
  readonly categories = signal<ILibraryCategory[]>([...DEFAULT_CATEGORIES]);

  /** Active search query (bound to the search input). */
  readonly searchQuery = signal('');
  /** Active category filter — null means 'All'. */
  readonly activeCategory = signal<string | null>(null);

  /** Filtered and sorted items reactive view. */
  readonly filteredItems = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const cat = this.activeCategory();
    return this.items()
      .filter(item => {
        const matchesCat = !cat || item.category === cat;
        const matchesQ = !q ||
          item.name.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.tags.some(t => t.toLowerCase().includes(q));
        return matchesCat && matchesQ;
      })
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  });

  // ── Save ─────────────────────────────────────────────────────────────────

  /**
   * Serialize the given entities into a new library item and persist it.
   * Returns the saved item so callers can open an edit modal if needed.
   */
  async saveToLibrary(
    entities: Entity[],
    meta: { name: string; category: string; description?: string; tags?: string[] },
  ): Promise<ILibraryItem> {
    const thumbnail = await this.generateThumbnail(entities);
    const layerDefs = this._captureLayerDefs(entities);

    const item: ILibraryItem = {
      id: generateLibraryId(),
      name: meta.name.trim() || 'Untitled',
      category: meta.category || 'Custom',
      description: meta.description,
      tags: meta.tags ?? [],
      thumbnail,
      entities: entities.map(e => this._serializeEntity(e)),
      layerDefs,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    this.items.update(prev => [item, ...prev]);
    this._persist();
    return item;
  }

  // ── Insert ───────────────────────────────────────────────────────────────

  /**
   * Deserialize a library item's entities, center them on `at`, and push
   * them into the active file via the undo-able command stack.
   */
  insertItem(item: ILibraryItem, at: IPoint): Entity[] {
    const hydrated = this._hydrateEntities(item.entities);
    if (!hydrated.length) return [];

    // Compute centroid of the hydrated entity group.
    const bbox = this._groupBBox(hydrated);
    const cx = bbox ? bbox.x + bbox.w / 2 : 0;
    const cy = bbox ? bbox.y + bbox.h / 2 : 0;
    const dx = at.x - cx;
    const dy = at.y - cy;

    // Translate all entities to the target position.
    for (const ent of hydrated) {
      this._translateEntity(ent, dx, dy);
      ent.selected = true;
    }

    const file = this.doc.activeFile;
    for (const f of this.doc.files) for (const e of f.entities) e.selected = false;
    for (const e of hydrated) e.selected = true;

    this.cmds.push(new PasteEntitiesCmd(hydrated, file, {
      markDirty: () => this.vm.markContentDirty(),
    }));

    // Bump lastUsedAt.
    this.items.update(prev =>
      prev.map(i => i.id === item.id ? { ...i, lastUsedAt: Date.now() } : i),
    );
    this._persist();

    return hydrated;
  }

  // ── Management ──────────────────────────────────────────────────────────

  updateItem(id: string, patch: Partial<Pick<ILibraryItem, 'name' | 'category' | 'description' | 'tags'>>): void {
    this.items.update(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    this._persist();
  }

  deleteItem(id: string): void {
    this.items.update(prev => prev.filter(i => i.id !== id));
    this._persist();
  }

  duplicateItem(id: string): ILibraryItem | null {
    const src = this.items().find(i => i.id === id);
    if (!src) return null;
    const copy: ILibraryItem = {
      ...src,
      id: generateLibraryId(),
      name: src.name + ' (copy)',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    this.items.update(prev => [copy, ...prev]);
    this._persist();
    return copy;
  }

  toggleFavorite(id: string): void {
    const item = this.items().find(i => i.id === id);
    if (!item) return;
    if (item.category === 'Favorites') {
      // Un-favorite: move to Custom.
      this.updateItem(id, { category: 'Custom' });
    } else {
      this.updateItem(id, { category: 'Favorites' });
    }
  }

  addCategory(name: string): void {
    if (this.categories().some(c => c.name === name)) return;
    this.categories.update(prev => [
      ...prev,
      { name, icon: '⊕', isBuiltIn: false },
    ]);
  }

  // ── Thumbnail generation ─────────────────────────────────────────────────

  /**
   * Render a set of entities to an offscreen 80×80 canvas and return a
   * data-URI PNG. Falls back to a placeholder if rendering fails.
   */
  async generateThumbnail(entities: Entity[]): Promise<string> {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_SIZE;
      canvas.height = THUMB_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return this._placeholderThumbnail();

      const isLight = document.documentElement.getAttribute('data-cad-theme') === 'light';
      const bgColor = isLight ? '#f4f7fa' : '#1a1a2e';
      const fgColor = isLight ? '#334155' : '#5eead4';
      const fgFill = isLight ? 'rgba(51, 65, 85, 0.25)' : 'rgba(94,234,212,0.25)';

      // Background.
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);

      // Compute group bbox.
      const bbox = this._groupBBox(entities);
      if (!bbox || bbox.w < 0.001 || bbox.h < 0.001) return this._placeholderThumbnail();

      const pad = 6;
      const scaleX = (THUMB_SIZE - pad * 2) / bbox.w;
      const scaleY = (THUMB_SIZE - pad * 2) / bbox.h;
      const scale = Math.min(scaleX, scaleY, 20);

      const cx = bbox.x + bbox.w / 2;
      const cy = bbox.y + bbox.h / 2;
      const ox = THUMB_SIZE / 2 - cx * scale;
      const oy = THUMB_SIZE / 2 + cy * scale; // canvas Y is flipped

      // Minimal viewmodel-like object for entity.draw().
      const thumbVm = {
        scale,
        w2s: (wx: number, wy: number) => ({ x: wx * scale + ox, y: oy - wy * scale }),
        canvasWidth: THUMB_SIZE,
        canvasHeight: THUMB_SIZE,
        theme: isLight ? 'light' : 'dark'
      };

      ctx.strokeStyle = fgColor;
      ctx.fillStyle = fgColor;
      ctx.lineWidth = 1.2;

      for (const ent of entities) {
        try {
          ctx.save();
          ctx.strokeStyle = fgColor;
          ctx.fillStyle = fgFill;
          ctx.lineWidth = 1.2;
          ent.draw(ctx, thumbVm as any, null);
          ctx.restore();
        } catch { /* ignore individual entity errors */ }
      }

      return canvas.toDataURL('image/png');
    } catch {
      return this._placeholderThumbnail();
    }
  }

  private _placeholderThumbnail(): string {
    const c = document.createElement('canvas');
    c.width = c.height = THUMB_SIZE;
    const ctx = c.getContext('2d')!;
    const isLight = document.documentElement.getAttribute('data-cad-theme') === 'light';
    
    ctx.fillStyle = isLight ? '#f4f7fa' : '#1a1a2e';
    ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    ctx.fillStyle = isLight ? '#334155' : '#5eead4';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⬡', THUMB_SIZE / 2, THUMB_SIZE / 2);
    return c.toDataURL('image/png');
  }

  // ── Serialization ────────────────────────────────────────────────────────

  private _serializeEntity(e: Entity): Record<string, unknown> {
    // Clone removes circular refs / prototype methods; JSON round-trip strips functions.
    const clone = e.clone();
    return JSON.parse(JSON.stringify(clone));
  }

  _hydrateEntities(serialized: Record<string, unknown>[]): Entity[] {
    const out: Entity[] = [];
    for (const raw of serialized) {
      const ent = this._hydrateOne(raw);
      if (ent) out.push(ent);
    }
    return out;
  }

  private _hydrateOne(raw: Record<string, unknown>): Entity | null {
    const r = raw as any;
    let e: Entity | null = null;

    switch (r.type) {
      case 'LINE':
        e = new LineEntity(r.x1, r.y1, r.x2, r.y2);
        break;
      case 'CIRCLE':
        e = new CircleEntity(r.cx, r.cy, r.r);
        break;
      case 'ARC':
        e = new ArcEntity(r.cx, r.cy, r.r, r.startAngle, r.endAngle, r.ccw ?? true);
        break;
      case 'POLYLINE': {
        const pts = (r.pts ?? []).map((p: any) => ({ x: p.x, y: p.y }));
        e = new PolylineEntity(pts, !!r.closed);
        (e as PolylineEntity).globalWidth = r.globalWidth;
        break;
      }
      case 'POINT':
        e = new PointEntity(r.x, r.y);
        break;
      case 'TEXT': {
        e = new TextEntity(r.x, r.y, r.text, r.height, r.rotation ?? 0, {
          halign: r.halign,
          valign: r.valign,
          mtextWidth: r.mtextWidth,
        });
        break;
      }
      case 'ELLIPSE':
        e = new EllipseEntity(r.cx, r.cy, r.rx, r.ry, r.rotation ?? 0, r.startAngle ?? 0, r.endAngle ?? Math.PI * 2);
        break;
      case 'SPLINE':
        e = new SplineEntity(r.controlPoints ?? [], r.knotValues ?? [], r.degree ?? 3);
        break;
      case 'HATCH': {
        e = new HatchEntity(r.boundaries ?? [], r.patternName ?? 'ANSI31', r.scale ?? 1, r.angle ?? 0, !!r.solid);
        if (r.boundarySpec) (e as HatchEntity).boundarySpec = r.boundarySpec;
        break;
      }
      case 'INSERT':
        e = new InsertEntity(r.blockName, r.x, r.y, r.sx ?? r.xScale ?? 1, r.sy ?? r.yScale ?? 1, r.rotation ?? 0);
        break;
      case 'XLINE':
        e = new XLineEntity(r.x, r.y, r.angle ?? 0);
        break;
      case 'LEADER': {
        const pts = (r.pts ?? []).map((p: any) => ({ x: p.x, y: p.y }));
        e = new LeaderEntity(pts, r.text ?? '', r.textHeight ?? 2.5);
        break;
      }
      case 'DIMENSION': {
        const p1 = r.p1 ?? { x: r.x1 ?? 0, y: r.y1 ?? 0 };
        const p2 = r.p2 ?? { x: r.x2 ?? 0, y: r.y2 ?? 0 };
        if (p1 && p2) {
          e = new DimensionEntity(p1, p2, r.dimLinePoint);
          if (r.textOverride) (e as DimensionEntity).textOverride = r.textOverride;
          if (r.styleName) (e as DimensionEntity).styleName = r.styleName;
        }
        break;
      }
      case 'IMAGE':
        e = new ImageEntity(r.dataUrl ?? r.src ?? '', r.x, r.y, r.w ?? 100, r.h ?? 100);
        break;
      case 'TABLE': {
        e = new TableEntity(r.x, r.y, r.rows ?? 2, r.cols ?? 2, {});
        Object.assign(e, r); // restore all table-specific fields
        (e as any).id = undefined; // will be re-assigned by base constructor below
        break;
      }
      default:
        console.warn('[LibraryService] Unknown entity type for hydration:', r.type);
        return null;
    }

    if (e) {
      // Restore common Entity fields (but NOT id — new id was assigned in constructor).
      e.layer = r.layer ?? 'Layer 0';
      e.colorNumber = r.colorNumber ?? 256;
      e.color = r.color ?? null;
      e.lineType = r.lineType ?? 'BYLAYER';
      e.lineTypeScale = r.lineTypeScale ?? 1;
      e.lineWeight = r.lineWeight ?? -1;
      e.visible = r.visible ?? true;
      e.selected = false;
      e.refreshCaches?.();
    }
    return e;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _groupBBox(entities: Entity[]): IBBox | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let valid = false;
    for (const e of entities) {
      const b = e.bbox?.();
      if (!b || !Number.isFinite(b.x)) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
      valid = true;
    }
    if (!valid) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  private _captureLayerDefs(entities: Entity[]): Array<{ name: string; color: string; lineType: string }> {
    const file = this.doc.activeFile;
    const seen = new Set<string>();
    const out: Array<{ name: string; color: string; lineType: string }> = [];
    for (const e of entities) {
      if (seen.has(e.layer)) continue;
      seen.add(e.layer);
      const lay = file.layers.get(e.layer);
      out.push({ name: e.layer, color: lay?.color ?? '#ffffff', lineType: lay?.lineType ?? 'Continuous' });
    }
    return out;
  }

  /** In-place translation — mirrors what moveEntityInPlace does for common types. */
  private _translateEntity(e: Entity, dx: number, dy: number): void {
    const r = e as any;
    switch (e.type) {
      case 'LINE':   r.x1 += dx; r.y1 += dy; r.x2 += dx; r.y2 += dy; break;
      case 'CIRCLE': case 'ARC': case 'ELLIPSE': r.cx += dx; r.cy += dy; break;
      case 'POINT':  r.x += dx; r.y += dy; break;
      case 'POLYLINE': r.pts = r.pts?.map((p: IPoint) => ({ x: p.x + dx, y: p.y + dy })); break;
      case 'TEXT': case 'TABLE': case 'IMAGE': case 'INSERT':
        r.x += dx; r.y += dy; break;
      case 'XLINE':  (r as any).x += dx; (r as any).y += dy; break;
      case 'LEADER': r.pts = r.pts?.map((p: IPoint) => ({ x: p.x + dx, y: p.y + dy })); break;
      case 'SPLINE':
        r.controlPoints = r.controlPoints?.map((p: IPoint) => ({ x: p.x + dx, y: p.y + dy }));
        break;
      case 'DIMENSION':
        if (r.p1) { r.p1.x += dx; r.p1.y += dy; }
        if (r.p2) { r.p2.x += dx; r.p2.y += dy; }
        if (r.dimLinePoint) { r.dimLinePoint.x += dx; r.dimLinePoint.y += dy; }
        break;
      case 'HATCH':
        if (r.boundarySpec?.seedPoint) {
          r.boundarySpec.seedPoint.x += dx;
          r.boundarySpec.seedPoint.y += dy;
        }
        // Translate frozen boundary spec loops
        if (r.boundarySpec?.loops) {
          for (const loop of r.boundarySpec.loops) {
            if (loop.frozen) {
              loop.frozen = {
                polygon: loop.frozen.polygon?.map((p: IPoint) => ({ x: p.x + dx, y: p.y + dy })) ?? [],
                islands: loop.frozen.islands?.map((isl: IPoint[]) =>
                  isl.map((p: IPoint) => ({ x: p.x + dx, y: p.y + dy }))),
              };
            }
          }
        }
        // Translate legacy boundaries
        if (Array.isArray(r.boundaries)) {
          for (const loop of r.boundaries) {
            for (const edge of loop) {
              if (edge.start) { edge.start.x += dx; edge.start.y += dy; }
              if (edge.end)   { edge.end.x += dx;   edge.end.y += dy; }
            }
          }
        }
        break;
    }
    e.refreshCaches?.();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private _persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items()));
    } catch (err) {
      console.warn('[LibraryService] Could not persist to localStorage:', err);
    }
  }

  private _load(): ILibraryItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as ILibraryItem[];
    } catch {
      return [];
    }
  }
}
