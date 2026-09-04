import { Injectable, inject } from '@angular/core';
import type { Entity, IPoint } from '../models/entity.model';
import type { DxfFile, IBlockDef, ILineTypeDef } from '../models/layer.model';
import { Layer } from '../models/layer.model';
import type { DimensionStyle } from '../models/dimension-style.model';
import { DocumentService } from './document.service';
import { ViewModelService } from './view-model.service';
import { CommandStackService } from './command-stack.service';
import { DrawOrderService } from './draw-order.service';
import { PasteEntitiesCmd, DeleteMultipleCmd, CreateBlockCmd } from '../models/command.model';
import { TextEntity } from '../models/entity-extended.model';
import { snapshotEntity } from '../../tools/geometry-utils';

// â”€â”€â”€ DTO shapes stored in the payload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface LayerDTO {
  name: string;
  color: string;
  colorNumber: number;
  lineType: string;
  lineWeight: number;
  visible: boolean;
  locked: boolean;
  frozen: boolean;
  print: boolean;
}

export interface BlockDTO {
  name: string;
  basePoint: { x: number; y: number };
  /** Plain-object snapshots of block-definition entities (produced by clone()). */
  entities: Record<string, unknown>[];
  isAnonymous?: boolean;
}

export interface DimStyleDTO {
  name: string;
  props: Record<string, unknown>;
}

export interface LinetypeDTO {
  name: string;
  description?: string;
  pattern: number[];
}

/** The full clipboard package. Version-stamped for future forward-compat. */
export interface ClipboardPayload {
  version: 1;
  /** Base point in source drawing world coordinates. Paste offset = insertion - basePoint. */
  basePoint: IPoint;
  /** Source drawing file id (for cross-project detection). */
  sourceDrawingId: string;
  /**
   * Cloned entity instances â€” NOT plain DTOs. Kept live so re-paste is instant
   * without re-hydration. These are the objects that `buildPasteEntities` clones
   * on each paste.
   */
  entities: Entity[];
  /** JSON-safe flat snapshot of the same entities â€” used for LocalStorage / system clipboard. */
  entitySnapshots: Record<string, unknown>[];
  layers: LayerDTO[];
  blocks: BlockDTO[];
  dimStyles: DimStyleDTO[];
  linetypes: LinetypeDTO[];
  timestamp: number;
}

const LS_KEY = 'cad_clipboard';
const SYSTEM_CLIPBOARD_TYPE = 'aagento-cad-clipboard';

// â”€â”€â”€ Service â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * AutoCAD-style clipboard singleton.
 *
 * Owns the in-memory `ClipboardPayload`, an optional LocalStorage copy for
 * cross-tab persistence, and an optional JSON bridge to the system clipboard
 * so users can paste between browser tabs / editor instances.
 *
 * Commands wired in CadEditorComponent:
 *   Ctrl+C / COPY / COPYBASE  â†’ copy()
 *   Ctrl+X / CUTCLIP          â†’ cut()
 *   Ctrl+V / PASTECLIP        â†’ pasteAtPoint()  (via PasteTool)
 *   Ctrl+Shift+V / PASTEORIG  â†’ pasteOriginal() (instant, no tool)
 *   Ctrl+Alt+V / PASTEBLOCK   â†’ pasteAsBlock()  (via PasteTool block mode)
 */
@Injectable({ providedIn: 'root' })
export class CadClipboardService {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private cmds = inject(CommandStackService);
  private drawOrder = inject(DrawOrderService);

  /** Current in-memory payload. Null when clipboard is empty. */
  payload: ClipboardPayload | null = null;

  // â”€â”€â”€ Copy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Copy selected entities into the clipboard.
   *
   * @param entities   Entities to copy (caller filters the selection).
   * @param basePoint  Explicit base point (COPYBASE). Omit to use bbox centre (Ctrl+C).
   */
  copy(entities: Entity[], basePoint?: IPoint): void {
    if (!entities.length) return;

    const bp = basePoint ?? this.computeCenter(entities);
    const file = this.doc.activeFile;

    // Deep-clone via the existing Entity.clone() mechanism (same as ExplodeInsertCmd).
    const clones = entities.map((e: any) => e.clone());

    this.payload = {
      version: 1,
      basePoint: bp,
      sourceDrawingId: file.id,
      entities: clones,
      entitySnapshots: clones.map((e: any) => entityToSnapshot(e)),
      layers: this.collectLayers(entities, file),
      blocks: this.collectBlocks(entities, file),
      dimStyles: this.collectDimStyles(entities, file),
      linetypes: this.collectLinetypes(file),
      timestamp: Date.now(),
    };

    this.serializeToLocalStorage();
    this.writeToSystemClipboard(); // fire-and-forget; errors swallowed
  }

  // â”€â”€â”€ Cut â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Cut: copy then delete source entities through the undo stack (single transaction). */
  cut(entities: Entity[]): void {
    if (!entities.length) return;
    this.copy(entities);
    this.cmds.push(
      new DeleteMultipleCmd(
        entities,
        (e: any) => this.doc.getFileOfEntity(e),
        { markDirty: () => this.vm.markContentDirty() },
      ),
    );
  }

  // â”€â”€â”€ Paste helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Produce fresh, translated entity clones for a paste operation.
   * The payload base point is shifted to `insertionPoint`.
   * Returns null when there is nothing in the clipboard.
   */
  buildPasteEntities(insertionPoint: IPoint): Entity[] | null {
    if (!this.payload?.entities.length) return null;
    const dx = insertionPoint.x - this.payload.basePoint.x;
    const dy = insertionPoint.y - this.payload.basePoint.y;

    return this.payload.entities.map((src) => {
      const clone = src.clone();
      moveEntityDelta(clone, dx, dy);
      clone.selected = true;
      return clone;
    });
  }

  /**
   * Commit a paste at `insertionPoint` through the command stack.
   * Imports missing layers / blocks / dim-styles first.
   */
  pasteAtPoint(insertionPoint: IPoint): Entity[] {
    const file = this.doc.activeFile;
    this.ensureLayersExist(file);
    this.ensureBlocksExist(file);
    this.ensureDimStylesExist(file);

    const clones = this.buildPasteEntities(insertionPoint);
    if (!clones?.length) return [];

    // Deselect everything; the newly-pasted entities become the selection.
    for (const f of this.doc.files) for (const e of f.entities) e.selected = false;

    this.drawOrder.assignInitial(clones, file.entities);
    this.cmds.push(new PasteEntitiesCmd(clones, file, { markDirty: () => this.vm.markContentDirty() }));
    return clones;
  }

  /**
   * PASTEORIG: paste at the original world coordinates (offset = 0,0).
   */
  pasteOriginal(): Entity[] {
    if (!this.payload) return [];
    return this.pasteAtPoint(this.payload.basePoint);
  }

  /**
   * PASTEBLOCK: wrap pasted entities in a new named block, insert a single INSERT entity.
   */
  pasteAsBlock(insertionPoint: IPoint, blockName?: string): void {
    const file = this.doc.activeFile;
    this.ensureLayersExist(file);
    this.ensureBlocksExist(file);

    const clones = this.buildPasteEntities(insertionPoint);
    if (!clones?.length) return;

    const name = blockName ?? this.generateBlockName(file);

    // CreateBlockCmd removes the loose entities from the file and inserts a
    // single INSERT entity at the base point. We pass insertionPoint as the
    // block's origin so it lands exactly where the user clicked.
    this.cmds.push(
      new CreateBlockCmd(
        name,
        insertionPoint,
        clones,
        file,
        this.doc.activeLayer,
        { markDirty: () => this.vm.markContentDirty() },
      ),
    );
  }

  // â”€â”€â”€ Layer / Block / Style Import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  ensureLayersExist(file: DxfFile): void {
    if (!this.payload?.layers.length) return;
    for (const dto of this.payload.layers) {
      if (file.layers.has(dto.name)) continue;
      const lay = new Layer(dto.name, dto.color, dto.colorNumber);
      lay.lineType = dto.lineType;
      lay.lineWeight = dto.lineWeight;
      lay.visible = dto.visible;
      lay.locked = dto.locked;
      lay.frozen = dto.frozen;
      lay.print = dto.print;
      file.layers.set(dto.name, lay);
    }
  }

  ensureBlocksExist(file: DxfFile): void {
    if (!this.payload?.blocks.length) return;
    for (const dto of this.payload.blocks) {
      if (file.blocks.has(dto.name)) continue;
      const hydratedEntities = (dto.entities as Record<string, unknown>[])
        .map((snap) => snapshotToEntity(snap))
        .filter((e): e is Entity => e !== null);

      const blockDef: IBlockDef = {
        name: dto.name,
        basePoint: { ...dto.basePoint },
        entities: hydratedEntities,
        isAnonymous: dto.isAnonymous,
      };
      file.blocks.set(dto.name, blockDef);
    }
  }

  ensureDimStylesExist(file: DxfFile): void {
    if (!this.payload?.dimStyles.length) return;
    for (const dto of this.payload.dimStyles) {
      if (file.dimStyles.has(dto.name)) continue;
      const ds = Object.assign(Object.create(null), dto.props) as DimensionStyle;
      (ds as any).name = dto.name;
      file.dimStyles.set(dto.name, ds);
    }
  }

  // â”€â”€â”€ LocalStorage persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  serializeToLocalStorage(): void {
    if (!this.payload) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        version: this.payload.version,
        basePoint: this.payload.basePoint,
        sourceDrawingId: this.payload.sourceDrawingId,
        entitySnapshots: this.payload.entitySnapshots,
        layers: this.payload.layers,
        blocks: this.payload.blocks,
        dimStyles: this.payload.dimStyles,
        linetypes: this.payload.linetypes,
        timestamp: this.payload.timestamp,
      }));
    } catch { /* localStorage full or unavailable */ }
  }

  /**
   * Restore payload from localStorage (for cross-tab paste).
   * Returns true when a payload was successfully loaded.
   */
  loadFromLocalStorage(): boolean {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !Array.isArray(parsed.entitySnapshots)) return false;

      const entities = (parsed.entitySnapshots as Record<string, unknown>[])
        .map((snap) => snapshotToEntity(snap))
        .filter((e): e is Entity => e !== null);

      if (!entities.length) return false;

      this.payload = {
        version: 1,
        basePoint: parsed.basePoint ?? { x: 0, y: 0 },
        sourceDrawingId: parsed.sourceDrawingId ?? '',
        entities,
        entitySnapshots: parsed.entitySnapshots,
        layers: parsed.layers ?? [],
        blocks: parsed.blocks ?? [],
        dimStyles: parsed.dimStyles ?? [],
        linetypes: parsed.linetypes ?? [],
        timestamp: parsed.timestamp ?? 0,
      };
      return true;
    } catch {
      return false;
    }
  }

  // â”€â”€â”€ System clipboard bridge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  writeToSystemClipboard(): void {
    if (!this.payload || !('clipboard' in navigator) || !navigator.clipboard.writeText) return;
    try {
      const json = JSON.stringify({
        type: SYSTEM_CLIPBOARD_TYPE,
        version: this.payload.version,
        basePoint: this.payload.basePoint,
        sourceDrawingId: this.payload.sourceDrawingId,
        entitySnapshots: this.payload.entitySnapshots,
        layers: this.payload.layers,
        blocks: this.payload.blocks,
        dimStyles: this.payload.dimStyles,
        linetypes: this.payload.linetypes,
        timestamp: this.payload.timestamp,
      });
      navigator.clipboard.writeText(json).catch(() => { /* permission denied */ });
    } catch { /* serialization error */ }
  }

  /**
   * Try to read a CAD payload from the system clipboard.
   * Returns true and populates `this.payload` on success.
   */
  async readFromSystemClipboard(): Promise<boolean> {
    if (!('clipboard' in navigator) || !navigator.clipboard.readText) return false;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return false;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Plain text - convert to a new TextEntity (AutoCAD parity for plain text pasting)
        const ent = new TextEntity(0, 0, text);
        ent.layer = this.doc.activeLayerName;
        ent.height = 20 / this.vm.scale; // Scale to ~20px on screen so it's readable
        this.payload = {
          version: 1,
          basePoint: { x: 0, y: 0 },
          sourceDrawingId: '',
          entities: [ent],
          entitySnapshots: [snapshotEntity(ent)],
          layers: [],
          blocks: [],
          dimStyles: [],
          linetypes: [],
          timestamp: Date.now(),
        };
        return true;
      }
      if (parsed?.type !== SYSTEM_CLIPBOARD_TYPE || parsed.version !== 1) {
        // It's valid JSON, but not a CAD payload (e.g. copied from a code editor).
        // Treat it as plain text.
        const ent = new TextEntity(0, 0, text);
        ent.layer = this.doc.activeLayerName;
        ent.height = 20 / this.vm.scale; // Scale to ~20px on screen so it's readable
        this.payload = {
          version: 1,
          basePoint: { x: 0, y: 0 },
          sourceDrawingId: '',
          entities: [ent],
          entitySnapshots: [snapshotEntity(ent)],
          layers: [],
          blocks: [],
          dimStyles: [],
          linetypes: [],
          timestamp: Date.now(),
        };
        return true;
      }

      const entities = (parsed.entitySnapshots as Record<string, unknown>[])
        .map((snap) => snapshotToEntity(snap))
        .filter((e): e is Entity => e !== null);

      if (!entities.length) return false;

      this.payload = {
        version: 1,
        basePoint: parsed.basePoint ?? { x: 0, y: 0 },
        sourceDrawingId: parsed.sourceDrawingId ?? '',
        entities,
        entitySnapshots: parsed.entitySnapshots ?? [],
        layers: parsed.layers ?? [],
        blocks: parsed.blocks ?? [],
        dimStyles: parsed.dimStyles ?? [],
        linetypes: parsed.linetypes ?? [],
        timestamp: parsed.timestamp ?? 0,
      };
      return true;
    } catch {
      return false;
    }
  }

  // â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Compute the bounding-box centre of a set of entities. */
  computeCenter(entities: Entity[]): IPoint {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of entities) {
      const b = e.bbox?.();
      if (!b) continue;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    return {
      x: isFinite(minX) && isFinite(maxX) ? (minX + maxX) / 2 : 0,
      y: isFinite(minY) && isFinite(maxY) ? (minY + maxY) / 2 : 0,
    };
  }

  private collectLayers(entities: Entity[], file: DxfFile): LayerDTO[] {
    const names = new Set(entities.map((e: any) => e.layer));
    const result: LayerDTO[] = [];
    for (const name of names) {
      const lay = file.layers.get(name);
      if (!lay) continue;
      result.push({
        name: lay.name, color: lay.color, colorNumber: lay.colorNumber,
        lineType: lay.lineType, lineWeight: lay.lineWeight,
        visible: lay.visible, locked: lay.locked, frozen: lay.frozen, print: lay.print,
      });
    }
    return result;
  }

  private collectBlocks(entities: Entity[], file: DxfFile): BlockDTO[] {
    const collected: BlockDTO[] = [];
    const seen = new Set<string>();
    const collect = (ents: Entity[]) => {
      for (const e of ents) {
        if ((e as any).type !== 'INSERT') continue;
        const name: string = (e as any).blockName;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const def = file.blocks.get(name);
        if (!def) continue;
        collected.push({
          name: def.name,
          basePoint: { ...def.basePoint },
          entities: (def.entities as Entity[]).map((be) => entityToSnapshot(be)),
          isAnonymous: def.isAnonymous,
        });
        if (def.entities?.length) collect(def.entities as Entity[]);
      }
    };
    collect(entities);
    return collected;
  }

  private collectDimStyles(entities: Entity[], file: DxfFile): DimStyleDTO[] {
    const names = new Set<string>();
    for (const e of entities) {
      if ((e as any).type === 'DIMENSION') {
        // The field is `styleName`; `dimStyleName` never existed, so dimension
        // styles were silently dropped from every copy.
        const sn: string = (e as any).styleName ?? '';
        if (sn) names.add(sn);
      }
    }
    const result: DimStyleDTO[] = [];
    for (const name of names) {
      const ds = file.dimStyles.get(name);
      if (!ds) continue;
      result.push({ name, props: { ...(ds as any) } });
    }
    return result;
  }

  private collectLinetypes(file: DxfFile): LinetypeDTO[] {
    const result: LinetypeDTO[] = [];
    file.lineTypes.forEach((def: ILineTypeDef, name: string) => {
      result.push({ name, description: def.description, pattern: [...def.pattern] });
    });
    return result;
  }

  private generateBlockName(file: DxfFile): string {
    let n = 1;
    while (file.blocks.has(`Clipboard_${n}`)) n++;
    return `Clipboard_${n}`;
  }
}

// â”€â”€â”€ Snapshot helpers (module-level, no circular deps) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function entityToSnapshot(entity: Entity): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const key of Object.keys(entity)) {
    if (key.startsWith('_')) continue; // skip private cache fields
    const val = (entity as any)[key];
    if (typeof val === 'function') continue;
    snap[key] = deepClone(val);
  }
  return snap;
}

/**
 * Reconstruct an Entity from a plain-object snapshot.
 *
 * Strategy: use `Object.create(entityPrototype)` + field assignment so we
 * don't need per-type constructor argument mapping. We look up the prototype
 * from a lazily-built registry.
 */
function snapshotToEntity(snap: Record<string, unknown>): Entity | null {
  const type = snap['type'] as string;
  if (!type) return null;
  try {
    const proto = getEntityPrototype(type);
    if (!proto) return null;
    const ent = Object.create(proto) as Entity;
    // Assign all snapshot fields.
    for (const [k, v] of Object.entries(snap)) {
      if (k === 'selected') continue;
      (ent as any)[k] = deepClone(v);
    }
    // Assign a fresh entity id so it doesn't collide with existing entities.
    ent.id = nextSnapshotId();
    ent.selected = false;
    ent.refreshCaches?.();
    return ent;
  } catch {
    return null;
  }
}

// Lazy entity prototype registry â€” built once on first access.
const _protoRegistry = new Map<string, object>();
let _protoRegistryLoaded = false;

async function buildProtoRegistry(): Promise<void> {
  if (_protoRegistryLoaded) return;
  _protoRegistryLoaded = true;
  try {
    const em = await import('../models/entity.model');
    const ex = await import('../models/entity-extended.model');
    const img = await import('../models/image-entity.model');
    const tbl = await import('../models/table-entity.model');

    const register = (Cls: any) => {
      // Instantiate with dummy args to get the prototype; then discard.
      let inst: any = null;
      const attempts = [
        () => new Cls(0, 0),
        () => new Cls(0, 0, 0),
        () => new Cls(0, 0, 1),
        () => new Cls([], false),
        () => new Cls('', 0, 0),
        () => new Cls(0, 0, 1, 2),
      ];
      for (const attempt of attempts) {
        try { inst = attempt(); break; } catch { /* try next */ }
      }
      if (inst) _protoRegistry.set(inst.type, Object.getPrototypeOf(inst));
    };

    register(em.PointEntity);
    register(em.LineEntity);
    register(em.CircleEntity);
    register(em.ArcEntity);
    register(em.PolylineEntity);
    register(ex.TextEntity);
    register(ex.EllipseEntity);
    register(ex.SplineEntity);
    register(ex.LeaderEntity);
    register(ex.DimensionEntity);
    register(ex.HatchEntity);
    register(ex.InsertEntity);
    register(img.ImageEntity);
    register(tbl.TableEntity);
  } catch { /* module load failure â€” entity reconstruction will be skipped */ }
}

// Kick off registry build immediately on service module load.
buildProtoRegistry();

function getEntityPrototype(type: string): object | null {
  return _protoRegistry.get(type) ?? null;
}

let _nextSnapId = 800_000;
function nextSnapshotId(): number { return _nextSnapId++; }

// â”€â”€â”€ Entity translation (inlined to avoid circular import with tools/geometry-utils) â”€â”€

/**
 * Translate a cloned entity in-place by (dx, dy).
 * Mirrors tools/geometry-utils.ts `moveEntityInPlace` without importing from
 * the tools layer (which would create a circular dependency).
 */
function moveEntityDelta(e: Entity, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const any = e as any;
  const type: string = any.type ?? '';

  switch (type) {
    case 'LINE':
      any.x1 += dx; any.y1 += dy; any.x2 += dx; any.y2 += dy; break;
    case 'CIRCLE':
    case 'ARC':
      any.cx += dx; any.cy += dy; break;
    case 'ELLIPSE':
      any.cx += dx; any.cy += dy; break;
    case 'POLYLINE':
      if (Array.isArray(any.pts)) any.pts = any.pts.map((p: IPoint) => ({ ...p, x: p.x + dx, y: p.y + dy }));
      break;
    case 'SPLINE':
      if (Array.isArray(any.controlPoints)) {
        any.controlPoints = any.controlPoints.map((p: IPoint) => ({ ...p, x: p.x + dx, y: p.y + dy }));
      }
      break;
    case 'POINT':
      any.x += dx; any.y += dy; break;
    case 'TEXT':
    case 'MTEXT':
      any.x += dx; any.y += dy; break;
    case 'LEADER':
    case 'MLEADER':
      if (Array.isArray(any.pts)) any.pts = any.pts.map((p: IPoint) => ({ ...p, x: p.x + dx, y: p.y + dy }));
      break;
    case 'DIMENSION':
      if (any.p1) any.p1 = { ...any.p1, x: any.p1.x + dx, y: any.p1.y + dy };
      if (any.p2) any.p2 = { ...any.p2, x: any.p2.x + dx, y: any.p2.y + dy };
      if (any.dimLinePoint) any.dimLinePoint = { ...any.dimLinePoint, x: any.dimLinePoint.x + dx, y: any.dimLinePoint.y + dy };
      break;
    case 'HATCH':
      if (Array.isArray(any.boundaries)) {
        any.boundaries = any.boundaries.map((loop: any) =>
          Array.isArray(loop)
            ? loop.map((edge: any) => translateHatchEdge(edge, dx, dy))
            : loop,
        );
      }
      if (any.boundarySpec?.loops) {
        const spec = any.boundarySpec;
        any.boundarySpec = {
          ...spec,
          loops: spec.loops.map((loop: any) => ({
            ...loop,
            frozen: loop.frozen ? loop.frozen.map((f: any) => ({
              ...f,
              p0: { x: f.p0.x + dx, y: f.p0.y + dy },
              p1: { x: f.p1.x + dx, y: f.p1.y + dy },
              ...(f.center ? { center: { x: f.center.x + dx, y: f.center.y + dy } } : {}),
            })) : loop.frozen,
          })),
          seedPoint: spec.seedPoint ? { x: spec.seedPoint.x + dx, y: spec.seedPoint.y + dy } : spec.seedPoint,
        };
      }
      if (typeof any.originX === 'number') any.originX += dx;
      if (typeof any.originY === 'number') any.originY += dy;
      break;
    case 'INSERT':
    case 'IMAGE':
    case 'TABLE':
      any.x += dx; any.y += dy; break;
    default:
      // Best-effort: translate primary point if present.
      if (typeof any.x === 'number' && typeof any.y === 'number') { any.x += dx; any.y += dy; }
  }
  e.refreshCaches?.();
}

function translateHatchEdge(edge: any, dx: number, dy: number): any {
  const ne = { ...edge };
  if (edge.start) ne.start = { x: edge.start.x + dx, y: edge.start.y + dy };
  if (edge.end) ne.end = { x: edge.end.x + dx, y: edge.end.y + dy };
  if (edge.center) ne.center = { x: edge.center.x + dx, y: edge.center.y + dy };
  if (edge.vertices) ne.vertices = edge.vertices.map((v: IPoint) => ({ x: v.x + dx, y: v.y + dy }));
  return ne;
}

// â”€â”€â”€ Deep clone â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function deepClone(v: unknown): unknown {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepClone);
  const out: Record<string, unknown> = {};
  for (const k in v as object) out[k] = deepClone((v as Record<string, unknown>)[k]);
  return out;
}
