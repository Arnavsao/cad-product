import type { Entity } from './entity.model';
import type { DxfFile, IBlockDef } from './layer.model';
import { frozenLoopToPolygon } from './hatch-boundary.model';

export interface ICommand {
  execute(): void;
  undo(): void;
}

export interface IModifyEntitiesCmdHooks {
  /** Called after execute/undo to mark the view dirty. */
  markDirty(): void;
  /** Optional refresh hook for the properties panel. */
  refreshProperties?(): void;
}

/** AddEntityCmd — push a single entity onto its file. */
export class AddEntityCmd implements ICommand {
  constructor(
    private readonly entity: Entity,
    private readonly file: DxfFile,
    private readonly hooks: IModifyEntitiesCmdHooks & { refreshBlocks?(): void },
  ) {}

  execute(): void {
    if (!this.file.entities.includes(this.entity)) {
      this.file.entities.push(this.entity);
    }
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }

  undo(): void {
    const idx = this.file.entities.indexOf(this.entity);
    if (idx !== -1) this.file.entities.splice(idx, 1);
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }
}

export class PasteEntitiesCmd implements ICommand {
  constructor(
    private readonly entities: Entity[],
    private readonly file: DxfFile,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    for (const e of this.entities) {
      if (!this.file.entities.includes(e)) this.file.entities.push(e);
    }
    this.hooks.markDirty();
  }

  undo(): void {
    for (const e of this.entities) {
      const idx = this.file.entities.indexOf(e);
      if (idx !== -1) this.file.entities.splice(idx, 1);
    }
    this.hooks.markDirty();
  }
}

export class DeleteEntityCmd implements ICommand {
  constructor(
    private readonly entity: Entity,
    private readonly file: DxfFile,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    const idx = this.file.entities.indexOf(this.entity);
    if (idx !== -1) this.file.entities.splice(idx, 1);
    this.hooks.markDirty();
  }

  undo(): void {
    if (!this.file.entities.includes(this.entity)) this.file.entities.push(this.entity);
    this.hooks.markDirty();
  }
}

export class DeleteMultipleCmd implements ICommand {
  private readonly cmds: DeleteEntityCmd[];
  /** INSERT entities being deleted — tracked for auto-purge on execute. */
  private readonly deletedInserts: Array<{ file: DxfFile; blockName: string }>;
  /** Block definitions removed by auto-purge — restored on undo. */
  private purgedDefs: Array<{ file: DxfFile; def: IBlockDef }> = [];
  private readonly hooks: IModifyEntitiesCmdHooks & { refreshBlocks?(): void };

  constructor(entities: Entity[], fileOfEntity: (e: Entity) => DxfFile | null, hooks: IModifyEntitiesCmdHooks & { refreshBlocks?(): void }) {
    this.hooks = hooks;
    this.cmds = entities
      .map((e: any) => {
        const f = fileOfEntity(e);
        return f ? new DeleteEntityCmd(e, f, hooks) : null;
      })
      .filter((c): c is DeleteEntityCmd => c !== null);
    // Track INSERT references for auto-purge
    this.deletedInserts = entities
      .filter((e: any) => e.type === 'INSERT' && e.blockName)
      .map((e: any) => {
        const f = fileOfEntity(e);
        return f ? { file: f, blockName: e.blockName as string } : null;
      })
      .filter((x): x is { file: DxfFile; blockName: string } => x !== null);
  }

  execute(): void {
    this.purgedDefs = [];
    for (const c of this.cmds) c.execute();
    // Auto-purge: if all references to a block are gone, remove its definition
    const seen = new Set<string>();
    for (const { file, blockName } of this.deletedInserts) {
      const key = blockName;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!file.blocks.has(blockName)) continue;
      const hasRefs = file.entities.some((e: any) => e.type === 'INSERT' && e.blockName === blockName);
      if (!hasRefs) {
        this.purgedDefs.push({ file, def: file.blocks.get(blockName)! });
        file.blocks.delete(blockName);
      }
    }
    // Always bump doc.version when any INSERT ref count changed
    if (this.deletedInserts.length) this.hooks.refreshBlocks?.();
  }

  undo(): void {
    // Restore purged block definitions first so entities can reference them again
    for (const { file, def } of this.purgedDefs) {
      file.blocks.set(def.name, def);
    }
    for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i].undo();
    if (this.deletedInserts.length) this.hooks.refreshBlocks?.();
  }
}

/** Snapshot-based geometry modify (grip drags, transforms). */
export class ModifyGeometryCmd implements ICommand {
  constructor(
    private readonly entity: Entity,
    private readonly before: Record<string, unknown>,
    private readonly after: Record<string, unknown>,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    for (const key in this.after) (this.entity as any)[key] = deepCloneValue(this.after[key]);
    this.entity.refreshCaches();
    this.hooks.markDirty();
  }

  undo(): void {
    for (const key in this.before) (this.entity as any)[key] = deepCloneValue(this.before[key]);
    this.entity.refreshCaches();
    this.hooks.markDirty();
  }
}

/**
 * Deep-clone a snapshot value so the entity never holds a reference to the
 * stored before/after data.  Handles the shapes produced by `snapshotEntity`:
 * plain objects (IPoint), arrays of objects (pts, controlPoints, cells),
 * primitives (number, string, boolean, null/undefined).
 */
function deepCloneValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;                 // primitive
  if (Array.isArray(v)) return v.map(deepCloneValue);  // array
  // Plain object (IPoint, cell, boundarySpec, etc.)
  const out: Record<string, unknown> = {};
  for (const k in v as Record<string, unknown>) {
    out[k] = deepCloneValue((v as Record<string, unknown>)[k]);
  }
  return out;
}

export class ModifyFilePropertyCmd implements ICommand {
  constructor(
    private readonly file: DxfFile,
    private readonly before: Record<string, unknown>,
    private readonly after: Record<string, unknown>,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    for (const k in this.after) (this.file as any)[k] = this.after[k];
    this.hooks.markDirty();
  }
  undo(): void {
    for (const k in this.before) (this.file as any)[k] = this.before[k];
    this.hooks.markDirty();
  }
}

/**
 * Layer property change (color, lineType, lineWeight, visible, …). Same
 * shape as ModifyFilePropertyCmd but operates on a Layer object so the
 * Layers panel can stay on the command stack (rule 9 in CAD Core Principles).
 */
export class ModifyLayerPropertyCmd implements ICommand {
  constructor(
    private readonly layer: { [k: string]: unknown },
    private readonly before: Record<string, unknown>,
    private readonly after: Record<string, unknown>,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    for (const k in this.after) (this.layer as any)[k] = this.after[k];
    this.hooks.markDirty();
  }
  undo(): void {
    for (const k in this.before) (this.layer as any)[k] = this.before[k];
    this.hooks.markDirty();
  }
}

export interface IDocumentTarget {
  files: DxfFile[];
  activeFileId: string | null;
  activeLayerName: string;
  bump(): void;
}

/** AddFileCmd — adds/removes a DxfFile from the document. Used by DXF import to make uploads undoable. */
import { DocumentManagerService } from '../services/document-manager.service';

export class AddFileCmd implements ICommand {
  private readonly prevActiveFileId: string | null;
  private readonly prevActiveLayerName: string;

  constructor(
    private readonly file: DxfFile,
    private readonly doc: IDocumentTarget,
    private readonly hooks: IModifyEntitiesCmdHooks & { markGridDirty?(): void },
    private readonly docManager?: DocumentManagerService,
  ) {
    this.prevActiveFileId = doc.activeFileId;
    this.prevActiveLayerName = doc.activeLayerName;
  }

  execute(): void {
    if (this.docManager) {
      this.docManager.openDocument(this.file);
    } else {
      if (!this.doc.files.includes(this.file)) {
        this.doc.files.push(this.file);
      }
      this.doc.activeFileId = this.file.id;
      this.doc.activeLayerName = this.file.layers.keys().next().value ?? 'Layer 0';
      this.doc.bump();
    }
    this.hooks.markDirty();
    this.hooks.markGridDirty?.();
  }

  undo(): void {
    if (this.docManager) {
      // Forced close runs synchronously (no save prompt to await), so undo
      // still completes within this turn despite the promise-returning API.
      void this.docManager.closeDocument(this.file.id, true);
    } else {
      const idx = this.doc.files.indexOf(this.file);
      if (idx !== -1) this.doc.files.splice(idx, 1);
      this.doc.activeFileId = this.prevActiveFileId;
      this.doc.activeLayerName = this.prevActiveLayerName;
      this.doc.bump();
    }
    this.hooks.markDirty();
    this.hooks.markGridDirty?.();
  }
}

/** Multi-entity property change (color, layer, lineType, etc.) */
export class ModifyPropertiesCmd implements ICommand {
  constructor(
    private readonly entities: Entity[],
    private readonly key: string,
    private readonly value: unknown,
    private readonly oldValues: { id: number; value: unknown }[],
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    for (const ent of this.entities) {
      if (ent.applyPropertyChange) ent.applyPropertyChange(this.key, this.value);
      else (ent as any)[this.key] = this.value;
    }
    this.hooks.markDirty();
    this.hooks.refreshProperties?.();
  }

  undo(): void {
    for (const ent of this.entities) {
      const old = this.oldValues.find((v) => v.id === ent.id);
      if (!old) continue;
      if (ent.applyPropertyChange) ent.applyPropertyChange(this.key, old.value);
      else (ent as any)[this.key] = old.value;
    }
    this.hooks.markDirty();
  }
}

/** Reorder entities (Bring to front, send to back, etc.) */
export class ReorderEntitiesCmd implements ICommand {
  constructor(
    private readonly entities: Entity[],
    private readonly before: { id: number; drawOrder: number }[],
    private readonly after: { id: number; drawOrder: number }[],
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    for (const ent of this.entities) {
      const state = this.after.find((s) => s.id === ent.id);
      if (state) ent.drawOrder = state.drawOrder;
    }
    this.hooks.markDirty();
    this.hooks.refreshProperties?.();
  }

  undo(): void {
    for (const ent of this.entities) {
      const state = this.before.find((s) => s.id === ent.id);
      if (state) ent.drawOrder = state.drawOrder;
    }
    this.hooks.markDirty();
    this.hooks.refreshProperties?.();
  }
}

/**
 * Records an automatic hatch regeneration as a reversible undo step.
 *
 * This command is pushed via `CommandStackService.record()` (not `push()`)
 * because the scheduler has already mutated the hatch before enqueueing it.
 * On undo, the old spec is restored; the scheduler will re-detect on the next
 * frame and push a fresh regen if the entity state still warrants one.
 *
 * Both `execute()` and `undo()` also clear the boundary-related legacy fields
 * when the new/old spec is non-null so the draw() / bbox() paths stay
 * consistent with the spec.
 */
export class RegenerateHatchCmd implements ICommand {
  constructor(
    private readonly hatch: HatchEntity,
    private readonly oldSpec: IHatchBoundarySpec | null,
    private readonly oldAssociative: boolean,
    private readonly oldBoundaryEntIds: number[],
    private readonly newSpec: IHatchBoundarySpec | null,
    private readonly newAssociative: boolean,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    this.hatch.boundarySpec = this.newSpec;
    this.hatch.associative = this.newAssociative;
    if (!this.newAssociative) this.hatch.boundaryEntIds = [];
    this.hatch.refreshCaches();
    this.hooks.markDirty();
  }

  undo(): void {
    this.hatch.boundarySpec = this.oldSpec;
    this.hatch.associative = this.oldAssociative;
    this.hatch.boundaryEntIds = [...this.oldBoundaryEntIds];
    this.hatch.refreshCaches();
    this.hooks.markDirty();
  }
}

export class CompoundCmd implements ICommand {
  constructor(private readonly cmds: ICommand[]) {}

  execute(): void {
    for (const cmd of this.cmds) {
      cmd.execute();
    }
  }

  undo(): void {
    for (let i = this.cmds.length - 1; i >= 0; i--) {
      this.cmds[i].undo();
    }
  }
}

/* ============================================================
   BLOCK COMMANDS
   Port of CreateBlockCmd + ExplodeInsertCmd from 22-command-stack.js.
   Imports kept inline to avoid circular reference issues.
============================================================ */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import {
  InsertEntity,
  HatchEntity,
  TextEntity,
  EllipseEntity,
  SplineEntity,
  LeaderEntity,
  DimensionEntity,
  type IHatchEdge,
} from './entity-extended.model';
import { LineEntity, CircleEntity, ArcEntity, PolylineEntity, PointEntity, type IPoint } from './entity.model';
import type { IHatchBoundarySpec } from './hatch-boundary.model';

/** Create a block from selected entities. Removes them from the file and
 *  inserts a single INSERT reference at the chosen base point. */
export class CreateBlockCmd implements ICommand {
  private insertEntity: InsertEntity | null = null;

  constructor(
    private readonly name: string,
    private readonly basePoint: { x: number; y: number },
    private readonly entities: Entity[],
    private readonly file: DxfFile,
    private readonly activeLayer: string,
    private readonly hooks: IModifyEntitiesCmdHooks & { refreshBlocks?(): void },
    private readonly description = '',
  ) {}

  execute(): void {
    this.file.blocks.set(this.name, {
      name: this.name,
      basePoint: { x: this.basePoint.x, y: this.basePoint.y },
      entities: [...this.entities],
      isAnonymous: this.name.startsWith('*'),
      description: this.description,
    });
    for (const e of this.entities) {
      const idx = this.file.entities.indexOf(e);
      if (idx !== -1) this.file.entities.splice(idx, 1);
    }
    this.insertEntity = new InsertEntity(this.name, this.basePoint.x, this.basePoint.y);
    this.insertEntity.layer = this.activeLayer;
    this.insertEntity._blockDef = this.file.blocks.get(this.name) ?? null;
    this.file.entities.push(this.insertEntity);
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }

  undo(): void {
    if (this.insertEntity) {
      const idx = this.file.entities.indexOf(this.insertEntity);
      if (idx !== -1) this.file.entities.splice(idx, 1);
    }
    for (const e of this.entities) {
      if (!this.file.entities.includes(e)) this.file.entities.push(e);
    }
    const anyRef = this.file.entities.some((e: any) => e.type === 'INSERT' && e.blockName === this.name);
    if (!anyRef) this.file.blocks.delete(this.name);
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }
}

/** Explode an InsertEntity into its constituent entities, applying the
 *  insert's transform (translate + scale + rotate). BYBLOCK colors are
 *  resolved to the insert's own color. Nested INSERTs are preserved. */
export class ExplodeInsertCmd implements ICommand {
  private newEntities: Entity[] = [];

  constructor(
    private readonly insertEnt: InsertEntity,
    private readonly file: DxfFile,
    private readonly hooks: IModifyEntitiesCmdHooks & { refreshBlocks?(): void },
  ) {}

  execute(): void {
    const blockDef = this.file.blocks.get(this.insertEnt.blockName);
    if (!blockDef?.entities) return;

    const rad = (this.insertEnt.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const bpx = blockDef.basePoint?.x ?? 0;
    const bpy = blockDef.basePoint?.y ?? 0;
    const sx = this.insertEnt.sx;
    const sy = this.insertEnt.sy;
    const tx = this.insertEnt.x;
    const ty = this.insertEnt.y;
    const rotDeg = this.insertEnt.rotation;
    const avgScale = (Math.abs(sx) + Math.abs(sy)) / 2;

    /** Transform a local block point into world space (returns a fresh point). */
    const tp = (lx: number, ly: number): IPoint => {
      const sxL = (lx - bpx) * sx;
      const syL = (ly - bpy) * sy;
      return { x: tx + (sxL * cos - syL * sin), y: ty + (sxL * sin + syL * cos) };
    };
    const tpp = (p: IPoint): IPoint => tp(p.x, p.y);

    /** Deep-transform a hatch clone's boundary geometry (without mutating the
     *  block definition — clone() already returned a fully independent copy). */
    const transformHatch = (h: HatchEntity): void => {
      // ── Step 1: freeze associative specs ─────────────────────────────────
      // An associative boundarySpec stores anchor entity-IDs from inside the
      // block definition. Those IDs will NOT exist in model space after explode,
      // so the renderer would find nothing and draw a blank hatch.
      // We resolve this by freezing the spec from the legacy `boundaries` field
      // (always populated in parallel for DXF-imported hatches) and marking the
      // hatch non-associative so the renderer uses the frozen geometry.
      if (h.boundarySpec?.associative) {
        if (Array.isArray(h.boundaries) && h.boundaries.length) {
          // Build frozen loops from the legacy boundary edges.
          const frozenLoops = h.boundaries.map((loop, idx) => {
            const frozen = Array.isArray(loop)
              ? loop.map((edge): any => ({
                  kind: 'LINE' as const,
                  p0: edge.start ? { ...edge.start } : { x: 0, y: 0 },
                  p1: edge.end   ? { ...edge.end }   : { x: 0, y: 0 },
                  ...(edge.center ? { center: { ...edge.center } } : {}),
                  ...(typeof edge.radius === 'number' ? { r: edge.radius } : {}),
                  ...(typeof edge.startAngle === 'number' ? { a0: (edge.startAngle * Math.PI) / 180 } : {}),
                  ...(typeof edge.endAngle   === 'number' ? { a1: (edge.endAngle   * Math.PI) / 180 } : {}),
                }))
              : [];
            return { role: (idx === 0 ? 'outer' : 'island') as 'outer' | 'island', frozen, signedArea: 0, signature: '' };
          });
          h.boundarySpec = {
            ...h.boundarySpec,
            associative: false,
            loops: frozenLoops,
            contributingEntityIds: [],
          };
        } else {
          // No legacy boundaries either — just disassociate so the hatch at
          // least doesn't crash trying to look up missing entity IDs.
          h.boundarySpec = { ...h.boundarySpec, associative: false, contributingEntityIds: [] };
        }
      }

      // Clear legacy associative IDs — the boundary entities are block-local.
      h.boundaryEntIds = [];
      h.associative = false;

      // ── Step 2: transform raw boundary edges ─────────────────────────────
      if (Array.isArray(h.boundaries)) {
        h.boundaries = h.boundaries.map((loop) =>
          Array.isArray(loop)
            ? loop.map((edge): IHatchEdge => {
                const ne: IHatchEdge = { ...edge };
                if (edge.start) ne.start = tpp(edge.start);
                if (edge.end) ne.end = tpp(edge.end);
                if (edge.center) ne.center = tpp(edge.center);
                if (edge.vertices) ne.vertices = edge.vertices.map(tpp);
                if (typeof edge.radius === 'number') ne.radius = edge.radius * avgScale;
                if (typeof edge.startAngle === 'number') ne.startAngle = edge.startAngle + rotDeg;
                if (typeof edge.endAngle === 'number') ne.endAngle = edge.endAngle + rotDeg;
                return ne;
              })
            : loop,
        );
      }

      // ── Step 3: transform frozen spec edges ──────────────────────────────
      if (h.boundarySpec) {
        const spec = h.boundarySpec;
        h.boundarySpec = {
          ...spec,
          associative: false,
          contributingEntityIds: [],
          loops: spec.loops.map((loop) => ({
            ...loop,
            frozen: loop.frozen
              ? loop.frozen.map((f) => {
                  const nf = { ...f, p0: tpp(f.p0), p1: tpp(f.p1) };
                  if (f.center) nf.center = tpp(f.center);
                  if (typeof f.r === 'number') nf.r = f.r * avgScale;
                  if (typeof f.rx === 'number') nf.rx = f.rx * Math.abs(sx);
                  if (typeof f.ry === 'number') nf.ry = f.ry * Math.abs(sy);
                  if (typeof f.rot === 'number') nf.rot = f.rot + rad;
                  if (typeof f.a0 === 'number') nf.a0 = f.a0 + rad;
                  if (typeof f.a1 === 'number') nf.a1 = f.a1 + rad;
                  return nf;
                })
              : loop.frozen,
          })),
          seedPoint: spec.seedPoint ? tpp(spec.seedPoint) : spec.seedPoint,
        };
      }

      // ── Step 4: transform origin, scale, angle ───────────────────────────
      const o = tp(h.originX ?? 0, h.originY ?? 0);
      h.originX = o.x;
      h.originY = o.y;
      h.scale *= avgScale;
      h.angle += rotDeg;
    };

    this.newEntities = [];
    for (const e of blockDef.entities) {
      // Clone preserves ALL properties (text content/formatting, hatch
      // pattern/boundaries, dimension styles, etc.) — then we bake in the
      // insert's transform. Entities the old code couldn't reconstruct (TEXT,
      // MTEXT, HATCH, ELLIPSE, SPLINE, DIMENSION, LEADER…) are no longer lost.
      const clone = (e as Entity).clone();

      if (clone instanceof LineEntity) {
        const p1 = tp(clone.x1, clone.y1);
        const p2 = tp(clone.x2, clone.y2);
        clone.x1 = p1.x; clone.y1 = p1.y; clone.x2 = p2.x; clone.y2 = p2.y;
      } else if (clone instanceof CircleEntity) {
        const c = tp(clone.cx, clone.cy);
        clone.cx = c.x; clone.cy = c.y; clone.r *= avgScale;
      } else if (clone instanceof ArcEntity) {
        const c = tp(clone.cx, clone.cy);
        clone.cx = c.x; clone.cy = c.y; clone.r *= avgScale;
        clone.startAngle += rotDeg; clone.endAngle += rotDeg;
      } else if (clone instanceof EllipseEntity) {
        const c = tp(clone.cx, clone.cy);
        clone.cx = c.x; clone.cy = c.y;
        clone.rx *= Math.abs(sx); clone.ry *= Math.abs(sy);
        clone.rotation += rad;
      } else if (clone instanceof PolylineEntity) {
        clone.pts = clone.pts.map(tpp);
      } else if (clone instanceof SplineEntity) {
        clone.controlPoints = clone.controlPoints.map(tpp);
      } else if (clone instanceof PointEntity) {
        const p = tp(clone.x, clone.y);
        clone.x = p.x; clone.y = p.y;
      } else if (clone instanceof TextEntity) {
        const p = tp(clone.x, clone.y);
        clone.x = p.x; clone.y = p.y;
        clone.height *= avgScale;
        clone.rotation += rad;
        if (clone.mtextWidth) clone.mtextWidth *= Math.abs(sx);
      } else if (clone instanceof LeaderEntity) {
        clone.pts = clone.pts.map(tpp);
        clone.height *= avgScale;
        clone.landingLength *= avgScale;
        clone.arrowSize *= avgScale;
      } else if (clone instanceof DimensionEntity) {
        clone.p1 = tpp(clone.p1);
        clone.p2 = tpp(clone.p2);
        clone.dimLinePoint = tpp(clone.dimLinePoint);
      } else if (clone instanceof HatchEntity) {
        transformHatch(clone);
      } else if (clone instanceof InsertEntity) {
        const p = tp(clone.x, clone.y);
        clone.x = p.x; clone.y = p.y;
        clone.sx *= sx; clone.sy *= sy;
        clone.rotation += rotDeg;
      } else {
        // Best-effort fallback for any other entity type: at least translate
        // its primary insertion point so it isn't visually orphaned.
        const anyC = clone as any;
        if (typeof anyC.x === 'number' && typeof anyC.y === 'number') {
          const p = tp(anyC.x, anyC.y);
          anyC.x = p.x; anyC.y = p.y;
        }
      }

      // BYBLOCK color resolves to the insert's color; layer falls back to the
      // insert's layer when the child has none / the placeholder 'INSERT'.
      const childColor = (e as any).colorNumber;
      clone.layer = e.layer && e.layer !== 'INSERT' ? e.layer : this.insertEnt.layer;
      clone.colorNumber = childColor === 0 ? this.insertEnt.colorNumber : childColor;
      if (typeof (clone as any).refreshCaches === 'function') (clone as any).refreshCaches();
      this.newEntities.push(clone);    }

    const idx = this.file.entities.indexOf(this.insertEnt);
    if (idx !== -1) this.file.entities.splice(idx, 1);
    for (const ne of this.newEntities) this.file.entities.push(ne);
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }

  undo(): void {
    for (const ne of this.newEntities) {
      const idx = this.file.entities.indexOf(ne);
      if (idx !== -1) this.file.entities.splice(idx, 1);
    }
    if (!this.file.entities.includes(this.insertEnt)) {
      this.file.entities.push(this.insertEnt);
    }
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }
}

export class ExplodePolylineCmd implements ICommand {
  private newEntities: Entity[] = [];

  constructor(
    private readonly poly: PolylineEntity,
    private readonly file: DxfFile,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    if (!this.poly.pts || this.poly.pts.length < 2) return;
    const pts = this.poly.pts;
    const closed = this.poly.closed;
    const count = closed ? pts.length : pts.length - 1;

    for (let i = 0; i < count; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const line = new LineEntity(p1.x, p1.y, p2.x, p2.y);
      line.layer = this.poly.layer;
      line.color = this.poly.color;
      line.lineType = this.poly.lineType;
      line.lineWeight = this.poly.lineWeight;
      this.newEntities.push(line);
    }

    const idx = this.file.entities.indexOf(this.poly);
    if (idx !== -1) {
      this.file.entities.splice(idx, 1, ...this.newEntities);
    }
    this.hooks.markDirty();
  }

  undo(): void {
    if (!this.newEntities.length) return;
    const firstIdx = this.file.entities.indexOf(this.newEntities[0]);
    if (firstIdx !== -1) {
      this.file.entities.splice(firstIdx, this.newEntities.length, this.poly);
    }
    this.hooks.markDirty();
  }

  redo(): void {
    this.execute();
  }
}

export function extractPolygonsFromHatch(hatch: HatchEntity, doc?: DxfFile): IPoint[][] {
  const polys: IPoint[][] = [];

  // 1. Stored boundaries (most reliable raw coordinates)
  if (hatch.boundaries && hatch.boundaries.length > 0) {
    for (const loop of hatch.boundaries) {
      if (!loop || !loop.length) continue;
      const pts: IPoint[] = [];
      for (const edge of loop) {
        if (edge.start) pts.push({ x: edge.start.x, y: edge.start.y });
        if (edge.end) pts.push({ x: edge.end.x, y: edge.end.y });
      }
      const clean = pts.filter((p, idx, arr) => idx === 0 || Math.hypot(p.x - arr[idx - 1].x, p.y - arr[idx - 1].y) > 1e-5);
      if (clean.length >= 3) polys.push(clean);
    }
  }

  // 2. BoundarySpec loops next if boundaries gave nothing
  if (polys.length === 0 && hatch.boundarySpec?.loops?.length) {
    for (const loop of hatch.boundarySpec.loops) {
      if (loop.frozen?.length) {
        const pts = frozenLoopToPolygon(loop.frozen);
        if (pts.length >= 3) polys.push(pts);
      }
    }
  }

  // 3. Associative contributing entities if still nothing
  if (polys.length === 0 && hatch.boundarySpec?.associative && doc?.entities) {
    for (const id of hatch.boundarySpec.contributingEntityIds) {
      const ent = doc.entities.find((e: any) => e.id === id);
      if (!ent) continue;
      if (ent instanceof PolylineEntity && ent.pts?.length >= 3) {
        polys.push(ent.pts.map(p => ({ x: p.x, y: p.y })));
      } else if (ent instanceof CircleEntity) {
        const c = ent as CircleEntity;
        const pts: IPoint[] = [];
        for (let i = 0; i < 36; i++) {
          const a = (i * Math.PI * 2) / 36;
          pts.push({ x: c.cx + Math.cos(a) * c.r, y: c.cy + Math.sin(a) * c.r });
        }
        polys.push(pts);
      }
    }
  }

  return polys;
}

export class ExplodeHatchCmd implements ICommand {
  private newEntities: Entity[] = [];

  constructor(
    private readonly hatch: HatchEntity,
    private readonly file: DxfFile,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    const polys = extractPolygonsFromHatch(this.hatch, this.file);

    // Safety guard: if no polygons could be extracted, DO NOT delete hatch (prevents hiding/disappearing)
    if (polys.length === 0) return;

    // Create standalone PolylineEntity shapes for each inner shape/loop!
    for (const pts of polys) {
      if (pts.length >= 3) {
        const polyEnt = new PolylineEntity(pts, true);
        polyEnt.layer = this.hatch.layer;
        polyEnt.colorNumber = this.hatch.colorNumber;
        this.newEntities.push(polyEnt);
      }
    }

    if (this.newEntities.length === 0) return;

    const idx = this.file.entities.indexOf(this.hatch);
    if (idx !== -1) {
      this.file.entities.splice(idx, 1, ...this.newEntities);
    }
    this.hooks.markDirty();
  }

  undo(): void {
    if (!this.newEntities.length) return;
    const firstIdx = this.file.entities.indexOf(this.newEntities[0]);
    if (firstIdx !== -1) {
      this.file.entities.splice(firstIdx, this.newEntities.length, this.hatch);
    }
    this.hooks.markDirty();
  }

  redo(): void {
    this.execute();
  }
}

export class GenerateHatchBoundaryCmd implements ICommand {
  private newPolys: PolylineEntity[] = [];

  constructor(
    private readonly hatch: HatchEntity,
    private readonly file: DxfFile,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    const polys = extractPolygonsFromHatch(this.hatch, this.file);
    for (const pts of polys) {
      if (pts.length >= 3) {
        const polyEnt = new PolylineEntity(pts, true);
        polyEnt.layer = this.hatch.layer;
        polyEnt.colorNumber = this.hatch.colorNumber;
        this.newPolys.push(polyEnt);
      }
    }
    if (!this.newPolys.length) return;
    this.file.entities.push(...this.newPolys);
    this.hooks.markDirty();
  }

  undo(): void {
    for (const p of this.newPolys) {
      const idx = this.file.entities.indexOf(p);
      if (idx !== -1) this.file.entities.splice(idx, 1);
    }
    this.hooks.markDirty();
  }

  redo(): void {
    this.execute();
  }
}
