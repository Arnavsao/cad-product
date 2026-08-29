import type { Entity } from '../core/models/entity.model';
import type { DxfFile } from '../core/models/layer.model';
import {
  ViewModelService,
  createProxyVm,
} from '../core/services/view-model.service';
import type { DocumentService } from '../core/services/document.service';
import {
  ICommand,
  CompoundCmd,
  ModifyGeometryCmd,
} from '../core/models/command.model';
import { snapshotEntity } from './geometry-utils';

/**
 * Live-drag preview infrastructure for the multi-object modify tools
 * (move / rotate / scale / mirror).
 *
 * ## Why this exists
 *
 * The previous implementation mutated every selected entity on *every* mouse
 * move: restore-snapshot → re-apply transform → `refreshCaches()`. Each
 * `refreshCaches()` bumps the entity `revision`, which invalidates the spatial
 * index, topology face cache and snapping intersection cache — all of which the
 * canvas rebuilds on the very next frame (snapping runs before the tool on each
 * mousemove). With N selected entities that is an O(N · drawing-size) cascade
 * per frame, so even ~10-50 objects made the drag unusable.
 *
 * The fix: never touch the real entities during the drag. Instead we
 *
 *   1. hide the originals (`beginDragPreview` → `vm.previewHiddenIds`), and
 *   2. draw a "ghost" of the selection through a *composed view transform*
 *      (`drawTransformGhost`) — zero clones, zero geometry mutation, zero
 *      cache invalidation.
 *
 * The actual geometry change is applied exactly once, on commit
 * (`commitEntityTransforms`), as a single batched undo step.
 */

/** A rigid/affine transform to preview, expressed in world coordinates. */
export type GhostTransform =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'rotate'; cx: number; cy: number; rad: number }
  | { kind: 'scale'; cx: number; cy: number; factor: number }
  | { kind: 'mirror'; x1: number; y1: number; x2: number; y2: number };

/** Affine params consumed by `createProxyVm`: world = (tx,ty) + R(rotDeg)·diag(sx,sy)·local. */
interface IProxyParams { tx: number; ty: number; sx: number; sy: number; rotDeg: number; }

/**
 * Express each transform as a single affine that `createProxyVm` can apply.
 * Derivations (M = transform applied to a local point P, A = a point on the
 * mirror line, C = pivot):
 *   move   : M(P) = P + (dx,dy)
 *   scale  : M(P) = f·P + C(1−f)
 *   rotate : M(P) = R(θ)·P + (C − R(θ)·C)
 *   mirror : M(P) = Refl_φ·P + (A − Refl_φ·A),  Refl_φ = R(2φ)·diag(1,−1)
 */
function ghostProxyParams(t: GhostTransform): IProxyParams {
  switch (t.kind) {
    case 'move':
      return { tx: t.dx, ty: t.dy, sx: 1, sy: 1, rotDeg: 0 };
    case 'scale':
      return {
        tx: t.cx * (1 - t.factor),
        ty: t.cy * (1 - t.factor),
        sx: t.factor,
        sy: t.factor,
        rotDeg: 0,
      };
    case 'rotate': {
      const cos = Math.cos(t.rad);
      const sin = Math.sin(t.rad);
      return {
        tx: t.cx * (1 - cos) + t.cy * sin,
        ty: t.cy * (1 - cos) - t.cx * sin,
        sx: 1,
        sy: 1,
        rotDeg: (t.rad * 180) / Math.PI,
      };
    }
    case 'mirror': {
      const phi = Math.atan2(t.y2 - t.y1, t.x2 - t.x1);
      const c2 = Math.cos(2 * phi);
      const s2 = Math.sin(2 * phi);
      return {
        tx: t.x1 - (t.x1 * c2 + t.y1 * s2),
        ty: t.y1 - (t.x1 * s2 - t.y1 * c2),
        sx: 1,
        sy: -1,
        rotDeg: (-2 * phi * 180) / Math.PI,
      };
    }
  }
}

/**
 * Hide `entities` from `DocumentService.drawAll()` for the duration of a drag
 * so the originals don't paint underneath the moving ghost.
 */
export function beginDragPreview(vm: ViewModelService, entities: Entity[]): void {
  vm.previewHiddenIds = new Set(entities.map((e: any) => e.id));
  vm.markDirty();
}

/** Stop hiding originals. Safe to call when no preview is active. */
export function endDragPreview(vm: ViewModelService): void {
  if (vm.previewHiddenIds) {
    vm.previewHiddenIds = null;
    vm.markDirty();
  }
}

/**
 * Draw a transformed ghost of `entities` without mutating them or allocating
 * clones. Each entity is rendered through a proxy view-model that composes the
 * requested transform on top of its owning file's transform, so the ghost lands
 * exactly where the committed entity will (it mirrors `drawAll()`'s per-file
 * `createProxyVm` + `e.draw(ctx, fileVm, file)` path).
 *
 * Called from a tool's `drawPreview()` — i.e. once per render frame — so it must
 * stay allocation-light.
 */
export function drawTransformGhost(
  ctx: CanvasRenderingContext2D,
  vm: ViewModelService,
  doc: DocumentService,
  entities: Entity[],
  t: GhostTransform,
): void {
  if (!entities.length) return;

  // Group by owning file so each entity draws through its own file transform
  // and layer table — identical to DocumentService.drawAll().
  const byFile = new Map<DxfFile, Entity[]>();
  for (const e of entities) {
    const f = (doc.getFileOfEntity(e) ?? doc.activeFile) as DxfFile;
    const arr = byFile.get(f);
    if (arr) arr.push(e);
    else byFile.set(f, [e]);
  }

  // --- NEW: Draw the original position faded out ---
  ctx.save();
  ctx.globalAlpha = 0.25; // Faded like AutoCAD
  for (const [file, ents] of byFile) {
    const fileVm = createProxyVm(vm, file.x, file.y, file.scale, file.scale, file.rotation);
    for (const e of ents) {
      e.draw(ctx, fileVm, file);
    }
  }
  ctx.restore();
  // ------------------------------------------------

  const p = ghostProxyParams(t);

  const scale = vm.scale;
  const panX = vm.panX + vm.vpCenterX;
  const panY = vm.panY + vm.vpCenterY;

  ctx.save();
  // We need to apply M_w2s * Ghost * M_w2s^-1 to the screen-coordinate points.
  // Canvas applies transformations in the reverse order of the calls.
  // 1. M_w2s (Forward: World -> Screen)
  ctx.translate(panX, panY);
  ctx.scale(scale, -scale);
  
  // 2. Ghost affine transform in world coords
  ctx.translate(p.tx, p.ty);
  ctx.scale(p.sx, p.sy);
  if (p.rotDeg !== 0) {
    ctx.rotate((p.rotDeg * Math.PI) / 180);
  }
  
  // 3. M_w2s^-1 (Inverse: Screen -> World)
  ctx.scale(1 / scale, -1 / scale);
  ctx.translate(-panX, -panY);

  for (const [file, ents] of byFile) {
    const fileVm = createProxyVm(vm, file.x, file.y, file.scale, file.scale, file.rotation);
    for (const e of ents) {
      ctx.save();
      e.draw(ctx, fileVm, file);
      // Selection-style overlay so the ghost reads as the active drag set,
      // matching how a selected entity renders in drawAll (solid + dashed).
      const wasSelected = e.selected;
      e.selected = true;
      e.drawSelected(ctx, fileVm, file);
      e.selected = wasSelected;
      ctx.restore();
    }
  }
  
  ctx.restore();
}

/**
 * Commit a transform to the real entities as a single, atomic undo step.
 *
 * Preconditions: the entities are still in their pre-drag state (the drag only
 * ever drew a ghost). For each snapshot we apply the transform in place, capture
 * the resulting "after" state, and bundle one `ModifyGeometryCmd` per entity
 * into a single `CompoundCmd`.
 *
 * The command is `record()`-ed (not `push()`-ed) because the mutation has
 * already been applied here — re-executing would double-apply it. Undo/redo
 * restore the before/after snapshots normally.
 *
 * @returns true if at least one entity was modified.
 */
export function commitEntityTransforms(
  snapshots: { ent: Entity; snap: Record<string, unknown> }[],
  applyInPlace: (e: Entity) => void,
  cmds: { record(cmd: ICommand): void },
  vm: ViewModelService,
): boolean {
  const targetIds = new Set(snapshots.map(s => s.ent.id));
  const commands: ICommand[] = [];
  for (const { ent, snap } of snapshots) {
    // If it's an associative hatch and its boundaries are NOT all in the selection set,
    // explicitly break associativity because it's being transformed independently!
    if (ent.type === 'HATCH' && (ent as any).associative) {
      const hatch = ent as any;
      const boundaryIds = hatch.boundaryEntIds ?? [];
      const allBoundariesSelected = boundaryIds.length > 0 && boundaryIds.every((id: number) => targetIds.has(id));
      if (!allBoundariesSelected) {
        hatch.associative = false;
        if (hatch.boundarySpec) hatch.boundarySpec.associative = false;
      }
    }
    applyInPlace(ent);
    const after = snapshotEntity(ent);
    commands.push(
      new ModifyGeometryCmd(ent, snap, after, { markDirty: () => vm.markDirty() }),
    );
  }
  if (!commands.length) return false;
  cmds.record(new CompoundCmd(commands));
  vm.markDirty();
  return true;
}
