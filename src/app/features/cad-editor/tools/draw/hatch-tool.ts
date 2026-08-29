import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { CircleEntity, PolylineEntity, type Entity, type IPoint } from '../../core/models/entity.model';
import { EllipseEntity, HatchEntity, IHatchEdge } from '../../core/models/entity-extended.model';
import type { IHatchBoundarySpec, IBoundaryLoop } from '../../core/models/hatch-boundary.model';
import { buildFrozenSpec, loopSignature } from '../../core/models/hatch-boundary.model';
import type { IEntityAnchor } from '../../core/models/entity-anchor.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd, DeleteEntityCmd, CompoundCmd } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';
import { TopologyService } from '../../core/services/topology.service';
import { TopologyDebugService } from '../../core/services/topology-debug.service';
import { pointInPolygon } from '../../core/utils/region-topology';
import type { RegionResult } from '../../core/utils/region-topology';

/**
 * Hatch tool â€” fill-bucket semantics.
 *
 * On click:
 *   1. Run the V2 topology solver (modular pipeline from core/services/topology/*).
 *      Falls back to V1 if V2 returns null â€” same coverage, different pipeline.
 *      The solver finds the smallest closed face containing the click, resolving
 *      every intersection so overlapping geometry produces correct sub-faces.
 *      Inner holes (islands) are detected and subtracted via even-odd fill.
 *   2. Fallback: if no closed face surrounds the click, hit-test for a single
 *      closed entity under the cursor (associative single-entity mode).
 *
 * Every created HatchEntity now carries a `boundarySpec` (Phase 3) alongside
 * the legacy `boundaries` / `boundaryEntIds` fields. The spec is what the
 * Phase 4 dependency graph will track; the legacy fields keep the renderer
 * working unchanged for DXF-imported hatches that have no spec yet.
 */
export class HatchTool implements ITool {
  readonly name = 'hatch';
  private previewRegion: IPoint[] | null = null;
  private previewIslands: IPoint[][] = [];
  private previewEntity: Entity | null = null;
  private previewEntIds: number[] | null = null;
  private lastCreatedHatch: HatchEntity | null = null;
  private _originalPattern: string | null = null;
  private cur: IPoint = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get topology() { return this.injector.get(TopologyService) as TopologyService; }
  private get topoDebug() { return this.injector.get(TopologyDebugService) as TopologyDebugService; }

  onMouseMove(wx: number, wy: number, sx: number, sy: number, _e: MouseEvent): void {
    this.cur = { x: wx, y: wy };
    this.previewRegion = null;
    this.previewIslands = [];
    this.previewEntity = null;

    const result = this._detectRegion(wx, wy);
    if (result && result.polygon.length >= 3) {
      this.previewRegion = result.polygon;
      this.previewIslands = result.islands;
      this.previewEntIds = result.entIds;
    } else {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit && this.isHatchableBoundary(hit.entity)) {
        this.previewEntity = hit.entity;
        this.previewEntIds = [hit.entity.id];
      }
    }
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;

    // We detect the region first so we can match its entities against associative hatches.
    const result = this._detectRegion(wx, wy);

    // Detect existing hatch under click.
    const existingHatches = this.doc.activeFile.entities.filter(
      (ent): ent is HatchEntity => ent instanceof HatchEntity
    );
    let hatchToDelete: HatchEntity | null = null;
    
    for (const h of existingHatches.slice().reverse()) {
      let containCount = 0;

      // 1. If it has a frozen spec, test the frozen polygon
      if (h.boundarySpec) {
        for (const loop of h.boundarySpec.loops) {
          if (loop.frozen && loop.frozen.length >= 3) {
            const pts = loop.frozen.map((e: any) => e.p0);
            if (pointInPolygon(pts, wx, wy)) containCount++;
          }
        }
      }
      // 2. Legacy region test
      else if (h.boundaries && h.boundaries.length) {
        for (const loop of h.boundaries) {
          const pts: IPoint[] = [];
          for (const edge of loop) {
            if (edge.start) pts.push(edge.start);
            if (edge.end) pts.push(edge.end);
          }
          if (pts.length >= 3 && pointInPolygon(pts, wx, wy)) containCount++;
        }
      }

      if (containCount % 2 === 1) {
        hatchToDelete = h;
        break;
      }
    }

    // Mode 1: topology region detection (V2 with V1 fallback).
    if (result && result.polygon.length >= 3) {
      if (result.entIds.length === 1 && result.islands.length === 0) {
        const ent = this.doc.activeFile.entities.find((x: Entity) => x.id === result.entIds[0]);
        if (ent && this.isHatchableBoundary(ent)) {
          this.topoDebug.log(
            `PATH: topologyâ†’single-entity (entIds=[${result.entIds[0]}], no islands) â†’ placeAssociativeMulti`,
          );
          this.placeAssociativeMulti([ent], { x: wx, y: wy }, hatchToDelete);
          this.onMouseMove(wx, wy, sx, sy, e);
          return;
        }
      }
      this.topoDebug.log(
        `PATH: topology face â†’ placeRegion (ents=[${result.entIds.join(',')}], islands=${result.islands.length})`,
      );
      this.placeRegion(result.polygon, result.islands, result.entIds, { x: wx, y: wy }, hatchToDelete);
      this.onMouseMove(wx, wy, sx, sy, e);
      return;
    }

    // Mode 2: single-entity fallback.
    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (hit && this.isHatchableBoundary(hit.entity)) {
      this.topoDebug.log(
        `PATH: hitTest fallback (entity=${hit.entity.id}) â†’ placeAssociativeMulti`,
      );
      this.placeAssociativeMulti([hit.entity], { x: wx, y: wy }, hatchToDelete);
      this.onMouseMove(wx, wy, sx, sy, e);
    } else {
      this.topoDebug.log('PATH: no region detected, no hatchable entity under cursor â€” no-op');
    }
  }

  getPhase(): string { return 'select'; }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    const isHoverPreview = !!this.doc.previewHatchPattern;
    const region = this.previewRegion;
    const islands = this.previewIslands;
    const entity = this.previewEntity;

    // Suppress overlapping preview if we are still hovering over the hatch we just created!
    if (this.lastCreatedHatch && this.lastCreatedHatch.associative && this.previewEntIds) {
      if (this.previewEntIds.length === this.lastCreatedHatch.boundaryEntIds.length &&
          this.previewEntIds.every(id => this.lastCreatedHatch!.boundaryEntIds.includes(id))) {
        return; // Don't draw a preview, the existing hatch is already showing the new pattern!
      }
    }

    if (region && region.length >= 3) {
      // 1. Draw the actual pattern preview
      const pattern = this.doc.previewHatchPattern || this.doc.activeHatchPattern || 'ANSI31';
      const allBoundaries: IHatchEdge[][] = [];
      const outerEdges: IHatchEdge[] = [];
      for (let i = 0; i < region.length; i++) {
        const a = region[i];
        const b = region[(i + 1) % region.length];
        outerEdges.push({ type: 'LINE', start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
      }
      allBoundaries.push(outerEdges);

      for (const island of islands) {
        const islandEdges: IHatchEdge[] = [];
        for (let i = 0; i < island.length; i++) {
          const a = island[i];
          const b = island[(i + 1) % island.length];
          islandEdges.push({ type: 'LINE', start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
        }
        allBoundaries.push(islandEdges);
      }

      let scale = 1;
      // Do not auto-scale based on bounding box; use a consistent scale for all hatches
      if (pattern !== 'SOLID') {
        scale = (this.doc as any).activeHatchScale || 1;
      }
      const tempHatch = new HatchEntity(allBoundaries, pattern, scale, 0, pattern === 'SOLID');
      tempHatch.associative = false;
      tempHatch.layer = this.doc.activeLayer;

      ctx.save();
      ctx.globalAlpha = 0.5;
      tempHatch.draw(ctx, this.vm, this.doc);
      ctx.restore();

      // 2. Draw the orange boundary highlight
      ctx.save();
      ctx.strokeStyle = 'rgba(240, 160, 48, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);

      ctx.beginPath();
      const p0 = this.vm.w2s(region[0].x, region[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < region.length; i++) {
        const p = this.vm.w2s(region[i].x, region[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();

      for (const island of this.previewIslands) {
        if (island.length < 3) continue;
        const ip0 = this.vm.w2s(island[0].x, island[0].y);
        ctx.moveTo(ip0.x, ip0.y);
        for (let i = 1; i < island.length; i++) {
          const p = this.vm.w2s(island[i].x, island[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
      }

      ctx.stroke();
      ctx.restore();
    } else if (entity) {
      // 1. Draw the actual pattern preview for entity
      const pattern = this.doc.previewHatchPattern || this.doc.activeHatchPattern || 'ANSI31';
      let scale = 1;
      if (pattern !== 'SOLID') {
        scale = (this.doc as any).activeHatchScale || 1;
      }
      const tempHatch = new HatchEntity([entity.id], pattern, scale, 0, pattern === 'SOLID');
      tempHatch.associative = true;
      tempHatch.layer = this.doc.activeLayer;

      ctx.save();
      ctx.globalAlpha = 0.5;
      tempHatch.draw(ctx, this.vm, this.doc);
      ctx.restore();

      // 2. Draw the orange boundary highlight
      ctx.save();
      ctx.strokeStyle = 'rgba(240, 160, 48, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      entity.draw(ctx, this.vm, this.doc);
      ctx.restore();
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.previewRegion = null;
      this.previewIslands = [];
      this.previewEntity = null;
      this.tools.setTool('select');
      return;
    }
    // 'B' â€” BHATCH: hatch every closed region in the drawing in one command.
    if (e.key === 'b' || e.key === 'B') {
      this.batchHatch();
    }
  }

  deactivate(): void {
    this.previewRegion = null;
    this.previewIslands = [];
    this.previewEntity = null;
    if (this._originalPattern !== null && this.lastCreatedHatch) {
      this.lastCreatedHatch.pattern = this._originalPattern;
      this._originalPattern = null;
    }
    this.lastCreatedHatch = null;
  }

  previewPatternOnLast(pattern: string | null): void {
    if (this.lastCreatedHatch) {
      if (pattern !== null) {
        if (this._originalPattern === null) {
          this._originalPattern = this.lastCreatedHatch.pattern;
        }
        this.lastCreatedHatch.pattern = pattern;
      } else {
        if (this._originalPattern !== null) {
          this.lastCreatedHatch.pattern = this._originalPattern;
          this._originalPattern = null;
        }
      }
      this.vm.markContentDirty();
    }
  }

  applyPatternToLast(pattern: string): void {
    if (this.lastCreatedHatch) {
      this.lastCreatedHatch.pattern = pattern;
      this._originalPattern = null;
      this.vm.markContentDirty();
    }
  }

  /* â”€â”€â”€ Region detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  /**
   * Try V2 pipeline first; fall back to V1 if V2 returns null.
   * Both return `RegionResult`-compatible objects.
   */
  private _detectRegion(wx: number, wy: number): RegionResult | null {
    const v2 = this.topology.findRegionAtWithIslandsV2(wx, wy);
    if (v2) return v2;
    this.topoDebug.log('_detectRegion: V2 returned null â†’ trying V1 fallback');
    const v1 = this.topology.findRegionAtWithIslands(wx, wy);
    if (v1) this.topoDebug.log(`_detectRegion: V1 succeeded (ents=[${v1.entIds.join(',')}])`);
    else this.topoDebug.log('_detectRegion: V1 also returned null');
    return v1;
  }

  /* â”€â”€â”€ Hatch placement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  /**
   * Place an associative single-entity hatch. The entity's full outline
   * becomes the boundary. `boundarySpec` carries an anchor for Phase 4.
   */
  private placeAssociativeMulti(
    ents: Entity[],
    seedPoint: IPoint,
    deleteHatch: HatchEntity | null,
  ): void {
    const pattern = this.doc.activeHatchPattern || 'ANSI31';
    const ids = ents.map((e: any) => e.id);
    // Derive scale from the bounding box of all boundary entities.
    let scale = 1;
    if (pattern !== 'SOLID') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ent of ents) {
        const b = ent.bbox();
        if (!b) continue;
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.w > maxX) maxX = b.x + b.w;
        if (b.y + b.h > maxY) maxY = b.y + b.h;
      }
      if (isFinite(minX)) scale = defaultHatchScale(maxX - minX, maxY - minY);
    }
    const hatch = new HatchEntity(ids, pattern, scale, 0, pattern === 'SOLID');
    hatch.associative = true;
    hatch.layer = this.doc.activeLayer;
    hatch.boundarySpec = this._buildAnchorSpec(ents, seedPoint);

    this._commitHatch(hatch, deleteHatch);
  }

  /**
   * Place a non-associative region hatch from a topology-detected polygon.
   * `boundarySpec` carries frozen edge loops for Phase 4 dependency tracking.
   */
  private placeRegion(
    polygon: IPoint[],
    islands: IPoint[][],
    entIds: number[],
    seedPoint: IPoint,
    deleteHatch: HatchEntity | null,
  ): void {
    const pattern = this.doc.activeHatchPattern || 'ANSI31';
    const allBoundaries: IHatchEdge[][] = [];

    const outerEdges: IHatchEdge[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      outerEdges.push({ type: 'LINE', start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
    }
    allBoundaries.push(outerEdges);

    for (const island of islands) {
      const islandEdges: IHatchEdge[] = [];
      for (let i = 0; i < island.length; i++) {
        const a = island[i];
        const b = island[(i + 1) % island.length];
        islandEdges.push({ type: 'LINE', start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
      }
      allBoundaries.push(islandEdges);
    }

    // Derive scale from polygon bounding box.
    let scale = 1;
    // Do not auto-scale based on bounding box; use a consistent scale for all hatches
    if (pattern !== 'SOLID') {
      scale = (this.doc as any).activeHatchScale || 1;
    }
    const hatch = new HatchEntity(allBoundaries, pattern, scale, 0, pattern === 'SOLID');
    hatch.associative = true;
    hatch.boundaryEntIds = entIds;
    hatch.layer = this.doc.activeLayer;
    hatch.boundarySpec = this._buildFrozenSpec(polygon, islands, entIds, seedPoint);
    hatch.boundarySpec.associative = true;

    this._commitHatch(hatch, deleteHatch);
  }

  private _commitHatch(hatch: HatchEntity, deleteHatch: HatchEntity | null): void {
    const hooks = { markDirty: () => this.vm.markContentDirty() };
    const addCmd = new AddEntityCmd(hatch, this.doc.activeFile, hooks);
    if (deleteHatch) {
      const delCmd = new DeleteEntityCmd(deleteHatch, this.doc.activeFile, hooks);
      this.cmds.push(new CompoundCmd([delCmd, addCmd]));
    } else {
      this.cmds.push(addCmd);
    }
    this.lastCreatedHatch = hatch;
    this._originalPattern = null;
  }

  /* â”€â”€â”€ BHATCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  /**
   * Hatch every closed CCW region in the active drawing in a single undoable
   * command. Triggered by pressing 'B' while the hatch tool is active.
   *
   * Algorithm:
   *   1. Ask `TopologyService.findAllRegions()` for all closed CCW faces in the
   *      planar arrangement of the entire drawing.
   *   2. Skip regions whose centroid already falls inside an existing hatch.
   *   3. Skip degenerate regions (area < minArea, < 3 vertices).
   *   4. Create one non-associative `HatchEntity` per surviving region, with
   *      the centroid as the `seedPoint`.
   *   5. Bundle all `AddEntityCmd`s in one `CompoundCmd` so undo removes them
   *      all at once.
   *
   * This mirrors AutoCAD's `-BHATCH` / `HATCH` > "Select all" workflow.
   *
   * Performance note: `findAllRegions` is an O(EÂ²) global computation. For
   * very large drawings (> 5000 entities), this may take a few hundred
   * milliseconds. A future Phase 7+ enhancement can move it to a Web Worker.
   */
  batchHatch(): void {
    const regions = this.topology.findAllRegions();
    if (!regions.length) return;

    const pattern = this.doc.activeHatchPattern || 'ANSI31';
    const file = this.doc.activeFile;
    const hooks = { markDirty: () => this.vm.markContentDirty() };

    // Build a quick set of seed points from existing hatches so we can skip
    // regions that are already covered.
    const coveredSeedPts = file.entities
      .filter((e): e is HatchEntity => e instanceof HatchEntity)
      .flatMap((h) => (h.boundarySpec ? [h.boundarySpec.seedPoint] : []));

    const isCoveredSeed = (cx: number, cy: number): boolean =>
      coveredSeedPts.some((s) => Math.hypot(s.x - cx, s.y - cy) < 1);

    // Minimum region area filter â€” skip regions smaller than a 1Ã—1 unit square.
    // Prevents hatching micro-slivers produced by near-coincident intersections.
    const MIN_AREA = 1;

    const addCmds: AddEntityCmd[] = [];

    for (const polygon of regions) {
      if (polygon.length < 3) continue;

      // Shoelace area
      let area = 0;
      for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        area += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
      }
      area = Math.abs(area) / 2;
      if (area < MIN_AREA) continue;

      // Centroid
      const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
      const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
      if (isCoveredSeed(cx, cy)) continue;

      const spec = buildFrozenSpec(polygon, [], [], { x: cx, y: cy });

      // Build legacy boundaries for DXF compat (export.service fallback)
      const edges: IHatchEdge[] = polygon.map((p, i) => ({
        type: 'LINE',
        start: { x: p.x, y: p.y },
        end: { x: polygon[(i + 1) % polygon.length].x, y: polygon[(i + 1) % polygon.length].y },
      }));
      // Derive scale from polygon bounding box so the pattern is visible at any drawing scale.
      let hatchScale = 1;
      if (pattern !== 'SOLID') {
        let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
        for (const p of polygon) {
          if (p.x < bMinX) bMinX = p.x; if (p.y < bMinY) bMinY = p.y;
          if (p.x > bMaxX) bMaxX = p.x; if (p.y > bMaxY) bMaxY = p.y;
        }
        if (isFinite(bMinX)) hatchScale = defaultHatchScale(bMaxX - bMinX, bMaxY - bMinY);
      }
      const hatch = new HatchEntity([edges], pattern, hatchScale, 0, pattern === 'SOLID');
      hatch.associative = false;
      hatch.layer = this.doc.activeLayer;
      hatch.boundarySpec = spec;

      addCmds.push(new AddEntityCmd(hatch, file, hooks));
    }

    if (!addCmds.length) return;

    this.cmds.push(
      addCmds.length === 1 ? addCmds[0] : new CompoundCmd(addCmds),
    );
    this.vm.markDirty();
  }

  /* â”€â”€â”€ BoundarySpec builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  /** Delegates to the shared helper in hatch-boundary.model.ts. */
  private _buildFrozenSpec(
    polygon: IPoint[],
    islands: IPoint[][],
    entIds: number[],
    seedPoint: IPoint,
  ): IHatchBoundarySpec {
    return buildFrozenSpec(polygon, islands, entIds, seedPoint);
  }

  /**
   * Build an anchor-based (associative) spec for a single-entity hatch.
   * Phase 3: one anchor per entity with t0=0, t1=1 (full curve).
   * Phase 4 will refine this to per-edge anchors from the topology face.
   */
  private _buildAnchorSpec(ents: Entity[], seedPoint: IPoint): IHatchBoundarySpec {
    const anchors: IEntityAnchor[] = ents.map((e: any) => ({
      entityId: e.id,
      subIndex: 0,
      t0: 0,
      t1: 1,
      reversed: false,
    }));

    const outerLoop: IBoundaryLoop = {
      role: 'outer',
      anchors,
      signedArea: 0,
      signature: '',
    };
    outerLoop.signature = loopSignature(outerLoop);

    return {
      associative: true,
      loops: [outerLoop],
      contributingEntityIds: ents.map((e: any) => e.id),
      seedPoint: { x: seedPoint.x, y: seedPoint.y },
      tolerance: 1e-4,
      revision: 0,
    };
  }

  /* â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  private isHatchableBoundary(ent: Entity): boolean {
    if (ent.type === 'POLYLINE' || ent instanceof PolylineEntity) {
      const e = ent as any;
      return !!e.pts && e.pts.length >= 3 && (e.closed || isLoopClosed(e.pts));
    }
    if (ent.type === 'CIRCLE' || ent instanceof CircleEntity) {
      return true;
    }
    if (ent.type === 'ELLIPSE' || ent instanceof EllipseEntity) {
      const e = ent as any;
      const sweep = Math.abs((e.endAngle ?? Math.PI * 2) - (e.startAngle ?? 0));
      return sweep >= Math.PI * 2 - 1e-6;
    }
    return false;
  }
}

function isLoopClosed(pts: IPoint[]): boolean {
  if (pts.length < 3) return false;
  const a = pts[0];
  const b = pts[pts.length - 1];
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
}

/**
 * Compute a dynamic default hatch pattern scale that keeps the hatch
 * visually identifiable regardless of drawing size.
 *
 * Strategy: target ~35 hatch lines across the boundary's longest diagonal.
 * ANSI31 (and most standard patterns) have a base spacing of 3.175 units at
 * scale=1, so:  ideal = diagonal / (35 Ã— 3.175).
 * The result is then snapped to the nearest power-of-10 so the scale property
 * stays a clean number (1, 10, 100, 1000, â€¦).
 *
 * Examples:
 *   100 Ã— 80   â†’ diagonal â‰ˆ 128  â†’ ideal â‰ˆ 1.15  â†’ scale = 1
 *   1000 Ã— 800 â†’ diagonal â‰ˆ 1281 â†’ ideal â‰ˆ 11.5  â†’ scale = 10
 *   10000Ã— 8000â†’ diagonal â‰ˆ 12806â†’ ideal â‰ˆ 115   â†’ scale = 100
 */
function defaultHatchScale(w: number, h: number): number {
  const diagonal = Math.hypot(w, h);
  if (diagonal < 1e-6) return 1;
  // 3.175 is the standard ANSI31 base line spacing at scale=1.
  const ideal = diagonal / (35 * 3.175);
  if (ideal <= 0) return 1;
  // Round to nearest power of 10.
  const exp = Math.round(Math.log10(ideal));
  return Math.pow(10, exp);
}
