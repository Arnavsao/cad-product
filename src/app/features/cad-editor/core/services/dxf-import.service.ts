import { Injectable, inject } from '@angular/core';
import DxfParser from 'dxf-parser';
import { DxfFile, Layer } from '../models/layer.model';
import {
  Entity,
  LineEntity,
  CircleEntity,
  ArcEntity,
  PolylineEntity,
  PointEntity,
} from '../models/entity.model';
import {
  TextEntity,
  EllipseEntity,
  SplineEntity,
  HatchEntity,
  InsertEntity,
  XLineEntity,
  LeaderEntity,
  DimensionEntity,
  ViewportEntity,
  MLeaderEntity,
  JoggedRadiusDimensionEntity,
} from '../models/entity-extended.model';
import type { IDxfHatchData } from '../models/entity-extended.model';
import { DocumentService } from './document.service';
import { ViewModelService } from './view-model.service';
import { CommandStackService } from './command-stack.service';
import { DrawOrderService } from './draw-order.service';
import { AddFileCmd } from '../models/command.model';
import { DocumentManagerService } from './document-manager.service';
import { translateEntityRaw } from '../../tools/geometry-utils';
import { buildFrozenSpecFromFrozenLoops, dxfEdgeLoopToFrozen, frozenLoopToPolygon } from '../models/hatch-boundary.model';
import type { IFrozenEdge } from '../models/hatch-boundary.model';
import type { IPoint } from '../models/entity.model';
import { translateEntitiesInPlace } from '../../tools/geometry-utils';
import { DxfHatchHandler } from './dxf-hatch-handler';
import { attDefFromDxf, attribFromDxf } from '../models/block-attribute.model';

import { validateAc1032Header } from '../utils/dxf-header-validator';
import { scanRawDxfObjects, scanDxfTables, scanDimStyleOverrides } from '../utils/dxf-scanner';
import type { IDxfDimStyleData } from '../utils/dxf-scanner';
import { decodeMtext, decodeTextCodes } from '../utils/text-control-codes';
import type { RawDxfObject } from '../models/entity.model';
import { DXF_ACI_COLORS } from '../registries/aci-colors';
import { FontResolverService } from './font-resolver.service';
import { StartupProfilerService } from './startup-profiler.service';

/**
 * Port of 40-dxf-import.js. Parses DXF text into a DxfFile and appends to DOC.
 * Auto-positions multi-file drawings horizontally.
 *
 * Imports are pushed onto the command stack so Ctrl+Z removes the uploaded file
 * and Ctrl+Y restores it.
 */
@Injectable({ providedIn: 'root' })
export class DxfImportService {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private cmds = inject(CommandStackService);
  private drawOrder = inject(DrawOrderService);
  private docManager = inject(DocumentManagerService);
  private profiler = inject(StartupProfilerService);

  /** Load DXF text asynchronously using a Web Worker. Returns number of entities loaded, or rejects on error. */
  async loadDxfDataAsync(fileText: string, filename: string): Promise<number> {
    this.profiler.markStart('DXF Import Total (Async)');
    
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(new URL('../workers/dxf-parser.worker', import.meta.url), { type: 'module' });
        
        worker.onmessage = (e) => {
          if (e.data.success) {
            try {
              let loadedCount: number;
              if (e.data.isJsonEntities) {
                // JSON entity array from bridge workspace generator
                loadedCount = this._loadFromJsonEntities(e.data.entities, e.data.filename);
              } else {
                loadedCount = this.processParsedDxf(e.data.dxf, fileText, filename);
              }
              this.profiler.markEnd('DXF Import Total (Async)');
              worker.terminate();
              resolve(loadedCount);
            } catch (err) {
              worker.terminate();
              reject(err);
            }
          } else {
            worker.terminate();
            reject(new Error(e.data.error || 'Worker failed'));
          }
        };

        worker.onerror = (err) => {
          console.error('DXF Worker Error:', err);
          worker.terminate();
          reject(new Error('Web Worker failed to initialize or execute.'));
        };
        
        worker.onmessageerror = (err) => {
          console.error('DXF Worker Message Error:', err);
          worker.terminate();
          reject(new Error('Web Worker message serialization failed.'));
        };

        worker.postMessage({ fileText, filename });
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Synchronous processing of the already-parsed DXF object. */
  private processParsedDxf(dxf: any, fileText: string, filename: string): number {
    try {
      this.profiler.markStart('DXF Validation & Scanning');
      const headerValidation = validateAc1032Header(fileText);
      if (!headerValidation.isValid) {
        console.warn('DXF Header validation warnings:', headerValidation.errors);
      }

      const rawObjects = scanRawDxfObjects(fileText);
      const rawObjMap = new Map<string, RawDxfObject>();
      for (const ro of rawObjects) {
        if (ro.handle) rawObjMap.set(ro.handle, ro);
      }

      // dxf-parser exposes only the viewPort/lineType/layer tables, so the
      // DIMSTYLE and STYLE tables are scanned out of the raw text ourselves.
      const {
        dimStyles: parsedDimStyles,
        textStyles: parsedTextStyles,
        layers: parsedLayers,
      } = scanDxfTables(fileText);
      // Per-entity DIMSTYLE overrides (DIMLFAC & friends) live in XDATA, which
      // dxf-parser discards the values of.
      const dimOverrides = scanDimStyleOverrides(rawObjects);

      this.profiler.markEnd('DXF Validation & Scanning');

      const dxfFile = new DxfFile(filename);
      dxfFile.metadata = headerValidation.metadata;

      for (const [name, styleData] of parsedDimStyles.entries()) {
        const existing = dxfFile.dimStyles.get(name) ?? new (dxfFile.dimStyles.get('Standard')!.constructor as any)(name);
        Object.assign(existing, styleData);
        dxfFile.dimStyles.set(name, existing);
      }

      for (const [name, style] of parsedTextStyles.entries()) {
        dxfFile.textStyles.set(name, {
          font: style.font,
          widthFactor: style.widthFactor,
          obliqueAngle: style.obliqueAngle,
          fixedHeight: style.fixedHeight,
          bigFont: style.bigFont,
        });
      }

      // Linetypes
      if (dxf.tables?.lineType?.lineTypes) {
        for (const key in dxf.tables.lineType.lineTypes) {
          const lt = dxf.tables.lineType.lineTypes[key];
          dxfFile.lineTypes.set(lt.name, {
            description: lt.description,
            pattern: lt.pattern || [],
          });
        }
      }

      // Layers
      if (dxf.tables?.layer?.layers) {
        for (const key in dxf.tables.layer.layers) {
          const lay = dxf.tables.layer.layers[key];
          const layer = new Layer(lay.name, lay.color || '#ffffff', lay.colorIndex);
          // dxf-parser reads only name/colour/frozen; linetype, lineweight and
          // the plot flag come from our own scan of the same table.
          const scanned = parsedLayers.get(lay.name);
          if (scanned) {
            if (scanned.lineType) layer.lineType = scanned.lineType;
            // Group 370 is in 1/100 mm; negatives are BYLAYER/BYBLOCK/DEFAULT
            // sentinels, which the renderer already treats as "use the default".
            if (typeof scanned.lineWeight === 'number' && scanned.lineWeight > 0) {
              layer.lineWeight = scanned.lineWeight;
            }
            if (scanned.visible === false) layer.visible = false;
            if (scanned.frozen) layer.frozen = true;
            if (scanned.locked) layer.locked = true;
            if (scanned.plot === false) layer.print = false;
          } else if (lay.frozen) {
            layer.frozen = true;
          }
          dxfFile.layers.set(lay.name, layer);
        }
      }
      if (dxfFile.layers.size === 0) {
        // Fallback Layer 0 when the DXF has no LAYER table â€” match AutoCAD's
        // default (ACI 7 magic color), not a custom gray.
        dxfFile.layers.set('Layer 0', new Layer('Layer 0'));
      }

      // Text styles (STYLE table). Our scan above is authoritative; this only
      // fills gaps for parsers that do surface the table.
      const styleTable = dxf.tables?.style?.styles ?? dxf.tables?.style;
      if (styleTable && typeof styleTable === 'object') {
        for (const key in styleTable) {
          const st = styleTable[key];
          if (st && typeof st === 'object') {
            const name = st.name ?? key;
            if (dxfFile.textStyles.has(name)) continue;
            dxfFile.textStyles.set(name, {
              font: st.font ?? st.fontFamily ?? st.primaryFontFileName ?? undefined,
              widthFactor: st.widthFactor ?? st.xScale ?? undefined,
              obliqueAngle: st.obliqueAngle ?? undefined,
            });
          }
        }
      }

      // Blocks
      if (dxf.blocks) {
        for (const blockName in dxf.blocks) {
          const block = dxf.blocks[blockName];
          const blockEnts: Entity[] = [];
          const attDefs: any[] = [];
          if (block.entities) {
            for (const bent of block.entities) {
              if (bent.type === 'ATTDEF') {
                attDefs.push(attDefFromDxf(bent));
                // We still want to remove its raw object from the map if it has a handle
                if (bent.handle) rawObjMap.delete(bent.handle);
                continue;
              }
              const e = this.createEntity(bent, dxfFile, rawObjMap, dimOverrides);
              if (e) blockEnts.push(e);
            }
          }
          dxfFile.blocks.set(blockName, {
            name: blockName,
            basePoint: { x: block.position?.x || 0, y: block.position?.y || 0 },
            entities: blockEnts,
            isAnonymous: blockName.startsWith('*'),
            attDefs: attDefs.length ? attDefs : undefined,
          });
        }
      }

      // Main entities
      let loadedCount = 0;
      if (dxf.entities) {
        for (const ent of dxf.entities) {
          const e = this.createEntity(ent, dxfFile, rawObjMap, dimOverrides);
          if (e) { dxfFile.entities.push(e); loadedCount++; }
        }
      }

      // Collect all raw objects that were not mapped to any parsed entity.
      // First, salvage any LEADER / MLEADER entities that dxf-parser dropped â€”
      // it silently skips them, so they never reach createEntity() above.
      for (const [handle, ro] of rawObjMap.entries()) {
        if (ro.entityType === 'LEADER' || ro.entityType === 'MLEADER') {
          const lead = this.leaderFromRawTags(
            ro.originalTags as Array<{ code: number; value: string | number | boolean }>,
            ro.entityType === 'MLEADER',
            dxfFile
          );
          if (lead) {
            lead.layer = 'Layer 0'; // will be overridden below if group 8 is present
            const tag8 = (ro.originalTags as any[]).find((t: any) => t.code === 8);
            if (tag8) lead.layer = String(tag8.value);
            const tag62 = (ro.originalTags as any[]).find((t: any) => t.code === 62);
            if (tag62) lead.colorNumber = Number(tag62.value);
            dxfFile.entities.push(lead);
            loadedCount++;
          }
          rawObjMap.delete(handle); // consumed â€” don't add to rawUnparsedEntities
        }
      }

      for (const [, ro] of rawObjMap.entries()) {
        dxfFile.rawUnparsedEntities.push(ro);
      }

      // Normalize coordinates so the drawing centroid sits at world origin and
      // the file lands next to any existing drawings. Both shifts are baked
      // directly into entity coordinates so `dxfFile.x/y` stay at 0 â€” this is
      // the invariant tools rely on: cursor world coords == file-local coords.
      this.normalizeAndPlace(dxfFile);

      this.drawOrder.assignInitial(dxfFile.entities);

      this.cmds.push(
        new AddFileCmd(
          dxfFile,
          this.doc,
          {
            markDirty: () => this.vm.markContentDirty(),
            markGridDirty: () => this.vm.markGridDirty(),
          },
          this.docManager
        ),
      );
      this.profiler.markEnd('Add Entities to Doc');
      this.profiler.markEnd('DXF Import Total');
      return loadedCount;
    } catch (err) {
      console.error('[DxfImport] Error parsing DXF:', err);
      return -1;
    }
  }

  /**
   * Load a JSON entity array generated by the bridge workspace exporters
   * (RccBoxDxfExport, PscSlabDxfExport, etc.). These are IDraftingEntity objects
   * with `draftingType`, `layerRef`, and type-specific geometry fields.
   *
   * Handles: Line, Polyline/CADPolyline, Text, Hatch. Other types are skipped.
   */
  private _loadFromJsonEntities(jsonEntities: any[], filename: string): number {
    const dxfFile = new DxfFile(filename.replace(/\.(dxf|json)$/i, '') || 'GAD Drawing');

    // Create a named layer per unique hex color in the payload.
    const colorToLayer = new Map<string, string>();
    const ensureLayer = (ref?: string): string => {
      if (!ref) return 'Layer 0';
      if (!colorToLayer.has(ref)) {
        const layerName = `L_${ref.replace('#', '')}`;
        colorToLayer.set(ref, layerName);
        dxfFile.layers.set(layerName, new Layer(layerName, ref));
      }
      return colorToLayer.get(ref)!;
    };

    const mapLt = (raw?: string): string => {
      const up = (raw ?? '').toUpperCase();
      if (up === 'DASHED') return 'DASHED';
      if (up === 'DOTTED' || up === 'DOT') return 'DOT';
      if (up === 'CENTER') return 'CENTER';
      return 'Continuous';
    };

    // Stamp shared CAD properties on a real Entity class instance.
    const apply = (e: Entity, ent: any): Entity => {
      e.layer = ensureLayer(ent.layerRef);
      e.color = ent.layerRef || null; // direct hex → rendered in exact color
      e.lineType = mapLt(ent.lineType);
      e.visible = true;
      if (ent.viewKey) {
        (e as any).viewKey = ent.viewKey;
      }
      return e;
    };

    const R2D = 180 / Math.PI; // radians → degrees

    for (const ent of jsonEntities) {
      const dtype: string = ent.draftingType ?? '';
      let e: Entity | null = null;

      switch (dtype) {
        // ── Line ─────────────────────────────────────────────────────────────
        case 'Line':
        case 'CADLine': {
          const s = ent.start ?? { x: 0, y: 0 };
          const f = ent.end   ?? { x: 0, y: 0 };
          e = new LineEntity(s.x, s.y, f.x, f.y);
          break;
        }

        // ── Polyline ─────────────────────────────────────────────────────────
        case 'Polyline':
        case 'CADPolyline': {
          const raw = ent.vertices ?? [];
          const pts = raw.map((v: any) => ({
            x: v.point?.x ?? v.x ?? 0,
            y: v.point?.y ?? v.y ?? 0,
          }));
          if (pts.length >= 2) {
            const pl = new PolylineEntity(pts, !!ent.isClosed);
            const bulges: number[] = raw.map((v: any) => v.bulge ?? 0);
            if (bulges.some((b: number) => b !== 0)) pl.bulges = bulges;
            e = pl;
          }
          break;
        }

        // ── Text / MText ──────────────────────────────────────────────────────
        case 'Text':
        case 'CADText':
        case 'MText': {
          const p = ent.position ?? ent.startPoint ?? { x: 0, y: 0 };
          const t = new TextEntity(p.x, p.y, ent.text ?? '', ent.height ?? 200, ent.rotation ?? 0, {
            isMText: !!(ent.isMText ?? dtype === 'MText'),
            mtextWidth: ent.mtextWidth ?? 0,
          });
          const h = ent.alignment === 'left' ? 'L' : ent.alignment === 'right' ? 'R' : 'C';
          const v = ent.baseline === 'top' ? 'T' : ent.baseline === 'middle' ? 'M' : 'B';
          (t as any).justify = /^[TMB][LCR]$/.test(ent.justify ?? '') ? ent.justify : v + h;
          (t as any).halign = h === 'L' ? 0 : h === 'R' ? 2 : 1;
          (t as any).valign = v === 'T' ? 3 : v === 'M' ? 2 : 0;
          (t as any).isMText = !!(ent.isMText ?? dtype === 'MText');
          if (ent.font)         (t as any).font         = ent.font;
          if (ent.widthFactor  != null && ent.widthFactor  !== 1) (t as any).widthFactor  = ent.widthFactor;
          if (ent.obliqueAngle != null && ent.obliqueAngle !== 0) (t as any).obliqueAngle = ent.obliqueAngle;
          if (ent.bold)      (t as any).bold      = true;
          if (ent.italic)    (t as any).italic    = true;
          if (ent.underline) (t as any).underline = true;
          e = t;
          break;
        }

        // ── Arc ───────────────────────────────────────────────────────────────
        case 'Arc':
        case 'CADArc': {
          const c = ent.center ?? { x: 0, y: 0 };
          // Exporter angles are in radians; ArcEntity expects degrees.
          e = new ArcEntity(
            c.x, c.y, ent.radius ?? 0,
            (ent.startAngle ?? 0) * R2D,
            (ent.endAngle   ?? 0) * R2D,
            true,
          );
          break;
        }

        // ── Circle ────────────────────────────────────────────────────────────
        case 'Circle':
        case 'CADCircle': {
          const c = ent.center ?? { x: 0, y: 0 };
          e = new CircleEntity(c.x, c.y, ent.radius ?? 0);
          break;
        }

        // ── Hatch ─────────────────────────────────────────────────────────────
        case 'Hatch': {
          // Prefer multi-loop boundaryLoops (written by new serializer).
          // Fall back to single-loop boundaryPoints for older JSON files.
          const importedHatch = isDxfHatchData(ent.dxfHatch) ? cloneDxfHatchData(ent.dxfHatch) : null;
          const loops: any[][] = importedHatch
            ? dxfHatchPathsToBoundaries(importedHatch)
            : ent.boundaryLoops ?? (ent.boundaryPoints?.length >= 3 ? [ent.boundaryPoints] : []);
          if (loops.length > 0 && loops[0].length >= 3) {
            const boundaries = importedHatch
              ? loops
              : loops.map((ring: any[]) => [{ vertices: ring.map((p: any) => ({ x: p.x, y: p.y })) }]);
            const pat   = importedHatch?.pattern.name ?? ent.patternName ?? 'SOLID';
            const solid = (importedHatch?.pattern.solidFill ?? !!ent.solid) || String(pat).toUpperCase() === 'SOLID';
            const h = new HatchEntity(boundaries as any, pat, ent.scale ?? 1, ent.angle ?? 0, solid);
            if (ent.hatchStyle)     (h as any).hatchStyle = ent.hatchStyle;
            if (ent.gradientType)   h.gradientType   = ent.gradientType;
            if (ent.gradientColor1) h.gradientColor1 = ent.gradientColor1;
            if (ent.gradientColor2) h.gradientColor2 = ent.gradientColor2;
            if (ent.gradientAngle != null) h.gradientAngle = ent.gradientAngle;
            if (Array.isArray(ent.patternDefinitionLines) && ent.patternDefinitionLines.length) {
              h.customPatternLines = ent.patternDefinitionLines.map((line: any) => ({
                angle: line.angle ?? 0,
                x0: line.x0 ?? 0,
                y0: line.y0 ?? 0,
                dx: line.dx ?? 0,
                dy: line.dy ?? 0,
                dashArray: Array.isArray(line.dashArray) ? [...line.dashArray] : [],
              }));
            }
            if (ent.patternType === 'User-defined' || ent.patternType === 'Custom' || ent.patternType === 'Predefined') {
              h.patternType = ent.patternType;
            }
            h.doubleHatch = !!ent.doubleHatch;
            h.associative = !!ent.associative;
            if (importedHatch) applyDxfHatchData(h, importedHatch);
            e = h;
          }
          break;
        }

        // ── Ellipse (lossless — not a polyline approximation) ─────────────────
        case 'Ellipse': {
          const c = ent.center ?? { x: 0, y: 0 };
          e = new EllipseEntity(
            c.x, c.y,
            ent.rx ?? 0, ent.ry ?? ent.rx ?? 0,
            ent.rotation ?? 0,
            ent.startAngle ?? 0,
            ent.endAngle ?? (Math.PI * 2),
          );
          break;
        }

        // ── Spline (lossless — control points + knots) ────────────────────────
        case 'Spline': {
          const cps = (ent.controlPoints ?? []).map((p: any) => ({ x: p.x, y: p.y }));
          if (cps.length >= 2) {
            e = new SplineEntity(cps, ent.knots ?? [], ent.degree ?? 3);
          }
          break;
        }

        // ── Point ─────────────────────────────────────────────────────────────
        case 'Point': {
          const p = ent.position ?? { x: 0, y: 0 };
          e = new PointEntity(p.x, p.y);
          break;
        }

        // ── XLine (construction line) ─────────────────────────────────────────
        case 'XLine': {
          const p = ent.position ?? { x: 0, y: 0 };
          e = new XLineEntity(p.x, p.y, ent.angle ?? 0);
          break;
        }

        // ── Leader ────────────────────────────────────────────────────────────
        case 'Leader': {
          const verts = (ent.vertices ?? []).map((p: any) => ({ x: p.x, y: p.y }));
          if (verts.length >= 1) {
            const la = new LeaderEntity(verts, ent.text ?? '', ent.height ?? 2.5);
            if (ent.arrowSize != null) la.arrowSize = ent.arrowSize;
            if (ent.arrowType)         la.arrowType = ent.arrowType;
            if (ent.font)              la.font       = ent.font;
            e = la;
          }
          break;
        }

        // ── Aagento custom dimension ──────────────────────────────────────────
        case 'AagentoDimension':
        case 'Dimension': {
          if (ent.p1 && ent.p2) {
            e = new DimensionEntity(ent.p1, ent.p2, ent.textLoc);
          }
          break;
        }

        default:
          // Unknown draftingType — skip silently.
          break;
      }

      if (e) {
        apply(e, ent);
        dxfFile.entities.push(e);
      }
    }

    // --- Simple Auto-Layout for Workspace JSON Payloads ---
    // The workspace bridge generators output all views centered at origin (0,0).
    // The backend Python script normally handles the layout for DXF downloads.
    // When opened directly in the editor via JSON, we need to space them out 
    // horizontally so they don't overlap into a garbled mess.
    const viewGroups = new Map<string, Entity[]>();
    for (const e of dxfFile.entities) {
      const key = (e as any).viewKey;
      if (key) {
        if (!viewGroups.has(key)) viewGroups.set(key, []);
        viewGroups.get(key)!.push(e);
      }
    }

    if (viewGroups.size > 0) {
      let currentX = 0;
      const SPACING = 2000; // 2000 units horizontal spacing between views

      for (const group of viewGroups.values()) {
        if (group.length === 0) continue;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        // Calculate bounding box for the entire view group
        for (const e of group) {
          const b = e.bbox();
          if (!b) continue;
          if (b.x < minX) minX = b.x;
          if (b.y < minY) minY = b.y;
          if (b.x + b.w > maxX) maxX = b.x + b.w;
          if (b.y + b.h > maxY) maxY = b.y + b.h;
        }

        if (minX === Infinity) continue;

        // Space out by moving the group's left edge to currentX
        const dx = currentX - minX;
        if (dx !== 0) {
          for (const e of group) {
            translateEntityRaw(e, dx, 0);
          }
        }

        // Advance currentX to the right edge of this view + spacing
        currentX += (maxX - minX) + SPACING;
      }
    }

    this.normalizeAndPlace(dxfFile);
    this.drawOrder.assignInitial(dxfFile.entities);

    this.cmds.push(
      new AddFileCmd(
        dxfFile,
        this.doc,
        { markDirty: () => this.vm.markContentDirty(), markGridDirty: () => this.vm.markGridDirty() },
        this.docManager,
      ),
    );

    return dxfFile.entities.length;
  }

  private createEntity(
    ent: any,
    dxfFile: DxfFile,
    rawObjMap: Map<string, RawDxfObject>,
    dimOverrides: Map<string, IDxfDimStyleData> = new Map(),
  ): Entity | null {
    let e: Entity | null = null;

    switch (ent.type) {
      case 'LINE':
        if (ent.vertices?.length >= 2) {
          e = new LineEntity(ent.vertices[0].x, ent.vertices[0].y, ent.vertices[1].x, ent.vertices[1].y);
        }
        break;
      case 'CIRCLE':
        if (ent.center) e = new CircleEntity(ent.center.x, ent.center.y, ent.radius);
        break;
      case 'ARC': {
        const sa = ent.startAngle !== undefined ? (ent.startAngle * 180) / Math.PI : 0;
        const ea = ent.endAngle !== undefined ? (ent.endAngle * 180) / Math.PI : 360;
        if (ent.center) e = new ArcEntity(ent.center.x, ent.center.y, ent.radius, sa, ea);
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const raw: any[] = ent.vertices ?? [];
        const pts = raw.map((v: any) => ({ x: v.x, y: v.y }));
        if (pts.length) {
          const pl = new PolylineEntity(pts, !!ent.shape);
          // Group 42 — arc bulge on the vertex that starts the segment. Dropping
          // it flattened every curved polyline to chords.
          const bulges = raw.map((v: any) => Number(v.bulge ?? 0) || 0);
          if (bulges.some((b) => b !== 0)) pl.bulges = bulges;
          // Groups 40/41 per vertex (or 43 constant) — segment widths. A
          // tapered 0 → w → 0 run is how AutoCAD draws a filled arrowhead, so
          // without these the "TO INDORE JN. →" arrows lose their heads.
          const constW = Number(ent.width ?? ent.constantWidth ?? 0) || 0;
          const widths = raw.map((v: any) => ({
            start: Number(v.startWidth ?? constW) || constW,
            end: Number(v.endWidth ?? constW) || constW,
          }));
          if (widths.some((w) => w.start > 0 || w.end > 0)) pl.widths = widths;
          e = pl;
        }
        break;
      }
      // ATTRIB is a TEXT subclass carrying a block attribute's value, so it
      // shares this branch. It used to fall through into the VIEWPORT case,
      // which needs a centre/width/height and so always produced nothing.
      case 'ATTRIB':
      case 'ATTDEF':
      case 'TEXT':
      case 'MTEXT': {
        // Attribute flag bit 1 marks the value invisible.
        if (ent.type === 'ATTRIB' && (Number(ent.attributeFlags ?? 0) & 1) !== 0) break;
        if (ent.type === 'ATTDEF') {
          // An ATTDEF outside any block is drawn by AutoCAD as its *tag* — the
          // section markers "A1"/"A2" in a GA are exactly this. dxf-parser
          // names its fields differently from TEXT and skips 72/74 entirely.
          if (ent.invisible) break;
          ent = {
            ...ent,
            text: ent.tag ?? ent.text ?? '',
            styleName: ent.textStyle,
            xScale: ent.scale,
            halign: Number(this._rawTagValue(rawObjMap, ent.handle, 72) ?? 0) || 0,
            valign: Number(this._rawTagValue(rawObjMap, ent.handle, 74) ?? 0) || 0,
          };
        }
        let rot = ent.rotation || 0;
        if (rot) rot = (rot * Math.PI) / 180;
        const options = {
          halign: ent.halign,
          valign: ent.valign,
          attachmentPoint: ent.attachmentPoint,
          mtextWidth: ent.type === 'MTEXT' ? ent.width || 0 : 0,
          colorNumber: ent.colorIndex !== undefined ? ent.colorIndex : 256,
          isMText: ent.type === 'MTEXT',
        };
        // ── Control codes ────────────────────────────────────────────────────
        // Both encodings reach the canvas verbatim otherwise, so a heading
        // stored as `%%UHALF ELEVATION` renders with the code visible instead
        // of underlined, and `\pxqr;TO DAHODE JN.` shows its paragraph tag.
        const rawText: string = ent.text ?? '';
        const mtext = ent.type === 'MTEXT' ? decodeMtext(rawText) : null;
        // MTEXT may still carry the older %% escapes inside its decoded text.
        const plain = decodeTextCodes(mtext ? mtext.text : rawText);
        const decodedText = plain.text;

        // Resolve the STYLE table entry. dxf-parser's TEXT handler has no
        // `case 7`, so the name only ever arrives via the raw tags.
        const styleName =
          ent.styleName ?? ent.textStyleName ?? this._rawTagValue(rawObjMap, ent.handle, 7);
        const textStyle = styleName ? dxfFile.textStyles.get(styleName) : undefined;

        // A style's fixed height (group 40) applies when the entity has none.
        let height = ent.textHeight ?? ent.height ?? 0;
        if (!(height > 0) && textStyle?.fixedHeight && textStyle.fixedHeight > 0) {
          height = textStyle.fixedHeight;
        }
        if (!(height > 0)) height = 2.5;
        // `\H0.7x;` scales the height relative to the entity's own.
        if (mtext?.heightFactor) height *= mtext.heightFactor;

        let x = ent.startPoint?.x ?? ent.position?.x ?? 0;
        let y = ent.startPoint?.y ?? ent.position?.y ?? 0;
        // Justified TEXT is anchored at group 11, not group 10: for centred or
        // right-justified text group 10 is merely where the first character
        // lands. Using it shifted every centred label left by half its width.
        // Aligned (3) and Fit (5) run between the two points, so they anchor at
        // the midpoint and take their rotation from the pair.
        if (ent.type !== 'MTEXT') {
          const ep = ent.endPoint;
          const h = Number(options.halign ?? 0), v = Number(options.valign ?? 0);
          if (ep && Number.isFinite(ep.x) && Number.isFinite(ep.y) && (h !== 0 || v !== 0)) {
            if (h === 3 || h === 5) {
              rot = Math.atan2(ep.y - y, ep.x - x);
              x = (x + ep.x) / 2;
              y = (y + ep.y) / 2;
              options.halign = 1;
            } else {
              x = ep.x;
              y = ep.y;
            }
          }
        }
        e = new TextEntity(x, y, decodedText, height, rot, options);

        if (typeof styleName === 'string' && styleName.length) {
          (e as TextEntity).styleName = styleName;
        }
        if (decodedText !== rawText) (e as TextEntity).rawText = rawText;
        if (mtext?.underline || plain.underline) (e as TextEntity).underline = true;
        if (mtext?.overline || plain.overline) (e as TextEntity).overline = true;
        if (mtext?.strikethrough) (e as TextEntity).strikethrough = true;

        // --- MTEXT width fallback: read group 41 from raw tags if dxf-parser missed it ---
        if (ent.type === 'MTEXT' && (e as TextEntity).mtextWidth === 0 && ent.handle) {
          const rawObj = rawObjMap.get(ent.handle);
          if (rawObj) {
            const tag41 = rawObj.originalTags.find((t: any) => t.code === 41);
            if (tag41) {
              const w = parseFloat(String(tag41.value));
              if (Number.isFinite(w) && w > 0) {
                (e as TextEntity).mtextWidth = w;
              }
            }
          }
        }

        // Enable word-wrapping for MTEXT whenever a bounding box width is defined.
        if (ent.type === 'MTEXT' && (e as TextEntity).mtextWidth > 0) {
          (e as TextEntity).autoWrap = true;
        }

        // ── Width factor (group 41) and oblique angle (group 51) ─────────────
        // dxf-parser exposes group 41 as `xScale`, never as `widthFactor`, and
        // does not read group 51 at all — hence the raw-tag fallbacks.
        //
        // Group 41 is TEXT-only here: on MTEXT the same code is the reference
        // rectangle *width*, so reading it as a factor stretches a 166-unit
        // column of notes to 166x its size.
        let hasEntityWidthFactor = false;
        if (ent.type !== 'MTEXT') {
          const rawWidthFactor = ent.widthFactor ?? ent.xScale
            ?? Number(this._rawTagValue(rawObjMap, ent.handle, 41) ?? NaN);
          if (Number.isFinite(rawWidthFactor) && rawWidthFactor > 0) {
            (e as TextEntity).widthFactor = rawWidthFactor;
            hasEntityWidthFactor = true;
          }
        }

        const rawOblique = ent.obliqueAngle
          ?? Number(this._rawTagValue(rawObjMap, ent.handle, 51) ?? NaN);
        let hasEntityOblique = false;
        if (Number.isFinite(rawOblique) && rawOblique !== 0) {
          (e as TextEntity).obliqueAngle = rawOblique * Math.PI / 180;
          hasEntityOblique = true;
        }

        // ── Font ─────────────────────────────────────────────────────────────
        // Precedence: an MTEXT `\f` code, then the entity's own font, then the
        // STYLE table entry. Without the STYLE table every drawing rendered in
        // one fallback face regardless of what it asked for.
        let resolvedFont: string | null = mtext?.font ?? null;
        if (textStyle) {
          if (!resolvedFont && textStyle.font) resolvedFont = textStyle.font;
          // Style values apply only where the entity gave none of its own.
          if (!hasEntityWidthFactor && textStyle.widthFactor !== undefined && textStyle.widthFactor > 0) {
            (e as TextEntity).widthFactor = textStyle.widthFactor;
          }
          if (!hasEntityOblique && textStyle.obliqueAngle !== undefined && textStyle.obliqueAngle !== 0) {
            (e as TextEntity).obliqueAngle = textStyle.obliqueAngle * Math.PI / 180;
          }
        }
        if (ent.font) resolvedFont = ent.font;
        if (resolvedFont) {
          (e as TextEntity).font = FontResolverService.resolve(resolvedFont);
        }
        break;
      }
      case 'POINT':
        if (ent.position) e = new PointEntity(ent.position.x, ent.position.y);
        break;
      case 'ELLIPSE': {
        const rx = ent.majorAxisEndPoint ? Math.hypot(ent.majorAxisEndPoint.x, ent.majorAxisEndPoint.y) : 10;
        const ry = rx * (ent.axisRatio ?? 1);
        const rot = ent.majorAxisEndPoint ? Math.atan2(ent.majorAxisEndPoint.y, ent.majorAxisEndPoint.x) : 0;
        if (ent.center) e = new EllipseEntity(ent.center.x, ent.center.y, rx, ry, rot, ent.startAngle ?? 0, ent.endAngle ?? Math.PI * 2);
        break;
      }
      case 'SPLINE':
        e = new SplineEntity(ent.controlPoints ?? ent.points ?? [], ent.knotValues ?? [], ent.degreeOfSplineCurve ?? 3);
        break;
      case 'HATCH':
      case 'SOLID':
      case 'TRACE': {
        if (ent.type === 'SOLID' || ent.type === 'TRACE') {
          const pts = ent.points;
          if (pts?.length >= 3) {
            const edges = [];
            for (let i = 0; i < pts.length; i++) {
              edges.push({ type: 'LINE', start: pts[i], end: pts[(i + 1) % pts.length] });
            }
            e = new HatchEntity([edges]);
            (e as HatchEntity).solid = true;
          }
        } else if (ent.boundaries) {
          const normalizedBoundaries = ent.boundaries.map(normalizeHatchBoundary);
          e = new HatchEntity(
            normalizedBoundaries,
            ent.patternName ?? 'ANSI31',
            ent.patternScale ?? 1,
            ent.patternAngle ?? 0,
            !!ent.solid,
          );
          // Phase 6: build a frozen boundarySpec so grips / transforms /
          // Phase-4 dependency tracking all work on imported hatches.
          // dxf-parser v1.1.2 does not expose group-330 source-entity handles
          // within boundary paths, so imported hatches are always non-associative.
          if (e instanceof HatchEntity && normalizedBoundaries.length > 0) {
            // Preserve true curve edges (arcs / ellipses) instead of flattening
            // the boundary to a straight-segment polygon, so curved hatch
            // boundaries render as smooth curves.
            const outerFrozen = dxfEdgeLoopToFrozen(normalizedBoundaries[0] ?? []);
            if (outerFrozen.length >= 1) {
              const islandFrozen = normalizedBoundaries.slice(1)
                .map(dxfEdgeLoopToFrozen)
                .filter((f: IFrozenEdge[]) => f.length >= 1);
              const flat = frozenLoopToPolygon(outerFrozen);
              if (flat.length >= 3) {
                const seedPt = ent.dxfHatch?.seedPoints?.[0] ?? polygonCentroid(flat);
                (e as HatchEntity).boundarySpec = buildFrozenSpecFromFrozenLoops(
                  outerFrozen, islandFrozen, [], seedPt,
                );
              }
            }
          }
          
          if (e instanceof HatchEntity) {
            if (isDxfHatchData(ent.dxfHatch)) applyDxfHatchData(e, ent.dxfHatch);
            if (ent.gradientType) e.gradientType = ent.gradientType;
            if (ent.gradientAngle !== undefined) e.gradientAngle = ent.gradientAngle;
            if (ent.gradientShift !== undefined) e.gradientShift = ent.gradientShift;
            if (ent.gradientSingleColor !== undefined) e.gradientSingleColor = ent.gradientSingleColor;
            
            if (ent.gradientColor1) e.gradientColor1 = ent.gradientColor1;
            else if (ent.gradientColor1Idx !== undefined) e.gradientColor1 = DXF_ACI_COLORS[ent.gradientColor1Idx];

            if (ent.gradientColor2) e.gradientColor2 = ent.gradientColor2;
            else if (ent.gradientColor2Idx !== undefined) e.gradientColor2 = DXF_ACI_COLORS[ent.gradientColor2Idx];

            // Store DXF-embedded custom pattern definition lines so the renderer
            // can draw patterns not in the built-in registry.
            if (Array.isArray(ent.patternDefinitionLines) && ent.patternDefinitionLines.length > 0) {
              e.customPatternLines = ent.patternDefinitionLines;
            }

            // Hatch style (Normal=0, Outer=1, Ignore=2)
            if (ent.hatchStyle === 0) e.hatchStyle = 'Normal';
            else if (ent.hatchStyle === 1) e.hatchStyle = 'Outer';
            else if (ent.hatchStyle === 2) e.hatchStyle = 'Ignore';

            // Pattern type (code 76: 0=User-defined, 1=Predefined, 2=Custom)
            if (ent.patternType === 0) e.patternType = 'User-defined';
            else if (ent.patternType === 1) e.patternType = 'Predefined';
            else if (ent.patternType === 2) e.patternType = 'Custom';

            // Pattern double flag (code 77)
            if (ent.doubleHatch !== undefined) e.doubleHatch = !!ent.doubleHatch;
          }
        }
        break;
      }
      case 'INSERT': {
        const sx = ent.xScale ?? 1;
        const sy = ent.yScale ?? 1;
        if (ent.position) {
          const ins = new InsertEntity(ent.name, ent.position.x, ent.position.y, sx, sy, ent.rotation || 0);
          ins._blockDef = dxfFile.blocks.get(ent.name) ?? null;
          if (ent.attribs) {
            for (const a of ent.attribs) ins.attribs.push(attribFromDxf(a));
          } else if (ent.attributes) {
            for (const a of ent.attributes) ins.attribs.push(attribFromDxf(a));
          }
          e = ins;
        }
        break;
      }
      case 'XLINE': {
        const bp = ent.startPoint ?? ent.position ?? { x: 0, y: 0 };
        const uv = ent.unitVector ?? ent.direction ?? { x: 1, y: 0 };
        e = new XLineEntity(bp.x, bp.y, Math.atan2(uv.y, uv.x));
        break;
      }
      case 'LEADER': {
        // dxf-parser has no LEADER support â€” all real work is done in the
        // raw-object salvage loop. This branch handles any rare case where
        // dxf-parser does surface a LEADER with vertices.
        let pts = (ent.vertices ?? ent.points ?? [])
          .map((v: any) => ({ x: v.x ?? v.position?.x, y: v.y ?? v.position?.y }))
          .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));

        let rawArrowStyle = ent.arrowStyle ?? ent.arrowHeadType ?? null;
        let dimStyleName  = ent.styleName ?? ent.dimensionStyleName ?? ent.dimStyleName ?? '';
        let annotHeight   = 0;
        let hasArrow      = true;
        let nVertices     = 0;

        // â”€â”€ Raw-tag extraction (correct DXF LEADER group codes per spec) â”€â”€â”€â”€â”€
        const rawHandle = ent.handle ?? null;
        const rawObj = rawHandle ? rawObjMap.get(rawHandle) : null;
        if (rawObj) {
          const tags = rawObj.originalTags as Array<{ code: number; value: string | number | boolean }>;

          // Group 10/20 = vertex X/Y (repeated for each vertex)
          if (pts.length === 0) {
            const xCoords: number[] = [];
            const yCoords: number[] = [];
            for (const t of tags) {
              if (t.code === 10) xCoords.push(Number(t.value));
              else if (t.code === 20) yCoords.push(Number(t.value));
            }
            for (let i = 0; i < Math.min(xCoords.length, yCoords.length); i++) {
              const x = xCoords[i], y = yCoords[i];
              if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
            }
          }

          for (const t of tags) {
            if (t.code === 3)  dimStyleName = String(t.value);  // dimension style name
            else if (t.code === 40) annotHeight = Number(t.value);  // text annotation height
            else if (t.code === 71) hasArrow = Number(t.value) !== 0; // arrowhead flag
            else if (t.code === 76) nVertices = Number(t.value);     // vertex count
            else if (t.code === 77) rawArrowStyle = Number(t.value); // arrowhead style
          }
          if (nVertices > 0 && pts.length > nVertices) pts = pts.slice(0, nVertices);
        }

        if (pts.length >= 2) {
          // Arrow size comes from DIMASZ in the referenced dimension style.
          const dimStyle = dxfFile.dimStyles.get(dimStyleName);
          const height = (annotHeight > 0 ? annotHeight : null)
            ?? dimStyle?.textHeight
            ?? ent.textHeight
            ?? 2.5;

          const lead = new LeaderEntity(pts, '', height);
          lead['arrowAspect'] = 2;

          if (dimStyle && typeof dimStyle.arrowSize === 'number' && dimStyle.arrowSize > 0) {
            lead.arrowSize = dimStyle.arrowSize;
          }

          if (!hasArrow) (lead as any).arrowType = 'none';

          if (rawArrowStyle !== null && hasArrow) {
            const arrowMap: Record<number, string> = {
              0: 'closed', 1: 'dot', 2: 'open', 3: 'closed', 4: 'none',
            };
            const mapped = arrowMap[Number(rawArrowStyle)];
            if (mapped) (lead as any).arrowType = mapped;
          }

          const last = pts[pts.length - 1];
          const prev = pts[pts.length - 2];
          lead.attachmentSide = last.x >= prev.x ? 'right' : 'left';

          const leadRot = ent.textRotation ?? ent.rotation;
          if (leadRot !== undefined && leadRot !== null && Number.isFinite(Number(leadRot))) {
            lead.textRotationOverride = Number(leadRot) * Math.PI / 180;
          }
          e = lead;
        }
        break;
      }
      case 'MLEADER': {
        // dxf-parser exposes MLEADER content differently across versions; collect any vertex stream we can find.
        let pts: any[] = [];
        if (Array.isArray(ent.leaderLines)) {
          for (const line of ent.leaderLines) {
            if (Array.isArray(line?.vertices) && line.vertices.length >= 2) {
              pts = line.vertices;
              break;
            }
          }
        }
        if (!pts.length && Array.isArray(ent.vertices)) pts = ent.vertices;
        const cleaned = pts
          .map((v: any) => ({ x: v.x ?? v.position?.x, y: v.y ?? v.position?.y }))
          .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (cleaned.length >= 2) {
          const lead = new LeaderEntity(cleaned, ent.text ?? ent.contextData?.defaultText ?? '');
          lead['arrowAspect'] = 2;
          lead.type = 'MLEADER';
          const leadRot = ent.textRotation ?? ent.rotation ?? ent.rawDxfObject?.textRotation ?? ent.rawDxfObject?.rotation;
          if (leadRot !== undefined && leadRot !== null && Number.isFinite(Number(leadRot))) {
            lead.textRotationOverride = Number(leadRot) * Math.PI / 180;
          }
          e = lead;
        }
        break;
      }
      case 'MLINE': {
        // Treat as a single-stroke polyline along the reference vertices.
        const verts = (ent.vertices ?? [])
          .map((v: any) => v.position ?? v)
          .map((p: any) => ({ x: p?.x, y: p?.y }))
          .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (verts.length >= 2) e = new PolylineEntity(verts, !!ent.closed);
        break;
      }
      case 'DIMENSION': {
        // Best-effort linear/aligned dimension. dxf-parser exposes the field
        // names inconsistently across versions; probe several aliases.
        const p1 =
          ent.xline1Point ?? ent.linearOrAngularPoint1 ?? ent.firstDefinitionPoint ?? ent.start;
        const p2 =
          ent.xline2Point ?? ent.linearOrAngularPoint2 ?? ent.secondDefinitionPoint ?? ent.end;
        // DXF group 10 â€” definition point of the dimension line itself.
        const defPt = ent.defaultPoint ?? ent.definitionPoint ?? ent.anchorPoint;
        // Jogged Radius dimensions use dimension type 4 and AcDbRadialDimensionLarge
        const dimType = ent.dimensionType ?? (ent.rawDxfObject && ent.rawDxfObject.dimensionType);
        const isJogged = (dimType & 7) === 4 && ent.linearOrAngularPoint1 && ent.linearOrAngularPoint2;
        
        if (isJogged) {
          const overrideCenter = defPt; // Group 10
          const arcPoint = ent.diameterOrRadiusPoint; // Group 15
          const trueCenter = ent.linearOrAngularPoint1; // Group 13
          const jogPoint = ent.linearOrAngularPoint2; // Group 14
          
          if (overrideCenter && arcPoint && trueCenter && jogPoint) {
            const dim = new JoggedRadiusDimensionEntity(
              trueCenter,
              overrideCenter,
              arcPoint,
              jogPoint
            );
            dim['arrowAspect'] = 2;
            if (ent.middleOfText) dim.textPoint = ent.middleOfText;
            if (typeof ent.text === 'string' && ent.text.length) dim.textOverride = ent.text;
            const styleName = ent.styleName ?? ent.dimensionStyleName ?? ent.dimStyleName;
            if (typeof styleName === 'string' && styleName.length) dim.styleName = styleName;
            
            const rDeg = ent.textRotation ?? ent.rotation ?? ent.rawDxfObject?.textRotation ?? ent.rawDxfObject?.rotation;
            if (rDeg !== undefined && rDeg !== null && Number.isFinite(Number(rDeg))) {
              dim.textRotationOverride = Number(rDeg) * Math.PI / 180;
            }
            
            e = dim;
          }
        } else if (p1 && p2 && Number.isFinite(p1.x) && Number.isFinite(p2.x)) {
          const dimLinePt =
            defPt && Number.isFinite(defPt.x) && Number.isFinite(defPt.y) ? defPt : undefined;
          const dim = new DimensionEntity(p1, p2, dimLinePt);
          dim['arrowAspect'] = 2;
          if (typeof ent.text === 'string' && ent.text.length) dim.textOverride = ent.text;

          // Preserve DXF dimension style name. dxf-parser's DIMENSION handler
          // has no `case 3`, so without the raw-tag fallback every dimension
          // resolves to `Standard` — and inherits its 4-decimal precision.
          let styleName = ent.styleName ?? ent.dimensionStyleName ?? ent.dimStyleName;
          if (typeof styleName !== 'string' || !styleName.length) {
            styleName = this._rawTagValue(rawObjMap, ent.handle, 3);
          }
          if (typeof styleName === 'string' && styleName.length) dim.styleName = styleName;

          // ── Dimension-style overrides carried as XDATA on the entity ──────
          // DIMLFAC scales the measurement (a span drawn 68.5333 units long
          // reports 10280 at factor 150); DIMSCALE scales only the visuals.
          // Both must be applied: a style may set DIMSCALE 150 while every
          // entity referencing it overrides back to 1.
          const ov = ent.handle ? dimOverrides.get(ent.handle) : undefined;
          if (ov) {
            if (typeof ov.linearFactor === 'number' && ov.linearFactor > 0) {
              dim.linearFactor = ov.linearFactor;
            }
            if (typeof ov.globalScale === 'number' && ov.globalScale > 0) {
              dim.globalScale = ov.globalScale;
            }
            if (typeof ov.unitPrecision === 'number') dim.unitPrecision = ov.unitPrecision;
            if (typeof ov.textOffset === 'number') dim.textOffset = ov.textOffset;
            if (typeof ov.arrowSize === 'number') dim.arrowSize = ov.arrowSize;
            if (typeof ov.textHeight === 'number') dim.textHeight = ov.textHeight;
          }

          // Rotation (group 50). Base type 0 is a rotated/horizontal/vertical
          // linear dimension, which measures the *projection* onto that axis —
          // an absent group 50 means 0°, not "aligned". Base type 1 is aligned
          // and keeps `rotation` null so the point-to-point distance is used.
          if ((dimType & 7) === 0) {
            const ang = Number(ent.angle ?? 0);
            dim.rotation = (Number.isFinite(ang) ? ang : 0) * Math.PI / 180;
          }

          // AutoCAD's own text position (group 11). Authoritative whenever the
          // "text at user-defined location" bit is set, which is what keeps
          // dense drawings from collapsing into overlapping labels.
          if (ent.middleOfText && Number.isFinite(ent.middleOfText.x) && Number.isFinite(ent.middleOfText.y)) {
            dim.textPoint = { x: ent.middleOfText.x, y: ent.middleOfText.y };
          }

          // Group 42 — AutoCAD's cached measurement, already DIMLFAC-scaled.
          if (Number.isFinite(Number(ent.actualMeasurement))) {
            dim.actualMeasurement = Number(ent.actualMeasurement);
          }

          const rDeg = ent.textRotation ?? ent.rawDxfObject?.textRotation ?? ent.rawDxfObject?.rotation;
          if (rDeg !== undefined && rDeg !== null && Number.isFinite(Number(rDeg))) {
            dim.textRotationOverride = Number(rDeg) * Math.PI / 180;
          }

          e = dim;
        }
        break;
      }
      case 'VIEWPORT': {
        // VIEWPORT entities have a center, width, height, and view properties
        if (ent.center && ent.width !== undefined && ent.height !== undefined) {
          e = new ViewportEntity(ent.center.x, ent.center.y, ent.width, ent.height);
          if (ent.viewCenter) {
            (e as ViewportEntity).viewCenter = { x: ent.viewCenter.x, y: ent.viewCenter.y };
          }
          if (ent.viewHeight !== undefined) (e as ViewportEntity).viewHeight = ent.viewHeight;
          if (ent.viewTarget) {
            (e as ViewportEntity).viewTarget = { x: ent.viewTarget.x, y: ent.viewTarget.y, z: ent.viewTarget.z };
          }
        }
        break;
      }
      case 'WIPEOUT':
      case 'REGION':
      case 'BODY':
      case '3DSOLID':
      case 'IMAGE':
      case 'RAY':
        // Silently skip â€” converting these poorly is worse than dropping them.
        break;
      default:
        console.warn(`Unsupported DXF entity: ${ent.type}`);
    }

    if (e) {
      e.layer = ent.layer || dxfFile.layers.keys().next().value || 'Layer 0';
      if (ent.colorIndex !== undefined) e.colorNumber = ent.colorIndex;
      if (ent.color !== undefined && typeof ent.color === 'number' && ent.colorIndex === undefined) {
        const hex = ent.color.toString(16).padStart(6, '0');
        e.color = '#' + hex;
      }
      if (ent.lineType) e.lineType = ent.lineType;
      if (ent.lineweight !== undefined) e.lineWeight = ent.lineweight;
      // Per-entity linetype scale (DXF group 48). dxf-parser uses both spellings across versions.
      const lts = ent.lineTypeScale ?? ent.linetypeScale;
      if (typeof lts === 'number' && Number.isFinite(lts) && lts > 0) {
        e.lineTypeScale = lts;
      }
      // Preserve DXF handle so subsequent xref/dimension-override logic can match by id.
      if (typeof ent.handle === 'string' && ent.handle.length) {
        (e as any).handle = ent.handle;
        if (rawObjMap.has(ent.handle)) {
          e.rawDxfObject = rawObjMap.get(ent.handle);
          rawObjMap.delete(ent.handle);
        }
      }
      if (typeof ent.ownerHandle === 'string' && ent.ownerHandle.length) {
        (e as any).ownerHandle = ent.ownerHandle;
      }
      if (ent.inPaperSpace) {
        e.inPaperSpace = true;
      }
    }
    return e;
  }

  /**
   * Reads a group code straight off the raw tag block for an entity.
   *
   * `dxf-parser`'s handlers cover only a subset of each entity's groups — TEXT
   * has no `case 7` (style name) and DIMENSION no `case 3` (dimension style) —
   * so anything they skip has to be recovered from the tags the lexical scanner
   * kept.
   *
   * @returns the trimmed value, or `undefined` when the tag is absent.
   */
  private _rawTagValue(
    rawObjMap: Map<string, RawDxfObject>,
    handle: string | undefined,
    code: number,
  ): string | undefined {
    if (!handle) return undefined;
    const raw = rawObjMap.get(handle);
    if (!raw) return undefined;
    const tag = raw.originalTags.find((t) => Number(t.code) === code);
    if (!tag) return undefined;
    const value = String(tag.value).trim();
    return value.length ? value : undefined;
  }

  private leaderFromRawTags(
    tags: Array<{ code: number; value: string | number | boolean }>,
    isMLeader: boolean,
    dxfFile?: DxfFile
  ): LeaderEntity | null {
    const xCoords: number[] = [];
    const yCoords: number[] = [];
    let dimStyleName = '';
    let annotHeight = 0;    // group 40 = text annotation height
    let arrowFlag = 1;      // group 71 = arrowhead on/off (1 = yes)
    let hasArrow = true;
    let arrowStyle: number | null = null;
    let nVertices = 0;      // group 76

    for (const t of tags) {
      // Per DXF spec for LEADER entity (AcDbLeader subclass):
      if (t.code === 10) xCoords.push(Number(t.value));     // vertex X
      else if (t.code === 20) yCoords.push(Number(t.value)); // vertex Y
      else if (t.code === 3)  dimStyleName = String(t.value); // dimension style name
      else if (t.code === 40) annotHeight  = Number(t.value); // text annotation height
      else if (t.code === 71) arrowFlag    = Number(t.value); // arrowhead flag
      else if (t.code === 72) { /* leader path type â€” straight/spline; ignore for now */ }
      else if (t.code === 76) nVertices    = Number(t.value); // number of vertices
      else if (t.code === 77) arrowStyle   = Number(t.value); // arrowhead style override
    }
    hasArrow = arrowFlag !== 0;

    // Build vertex list. Pair xCoords[i] with yCoords[i].
    const pts: IPoint[] = [];
    const count = nVertices > 0
      ? Math.min(nVertices, xCoords.length, yCoords.length)
      : Math.min(xCoords.length, yCoords.length);
    for (let i = 0; i < count; i++) {
      const x = xCoords[i], y = yCoords[i];
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }

    if (pts.length < 2) return null;

    // Resolve annotation text height: use group-40 value when present,
    // otherwise fall back to the dim style's text height.
    const dimStyle = dxfFile?.dimStyles.get(dimStyleName);
    const height = (annotHeight > 0 ? annotHeight : null)
      ?? dimStyle?.textHeight
      ?? 2.5;

    const lead = new LeaderEntity(pts, '', height);
    lead['arrowAspect'] = 2;
    if (isMLeader) lead.type = 'MLEADER';

    // Arrow size: DXF LEADER has NO per-entity arrow size override.
    // It must come from DIMASZ in the referenced dimension style.
    if (dimStyle && typeof dimStyle.arrowSize === 'number' && dimStyle.arrowSize > 0) {
      lead.arrowSize = dimStyle.arrowSize;
    }

    // Arrowhead visible flag.
    if (!hasArrow) (lead as any).arrowType = 'none';

    // Arrowhead style override (not standard DXF but some exporters emit it).
    if (arrowStyle !== null && hasArrow) {
      const arrowMap: Record<number, string> = {
        0: 'closed', 1: 'dot', 2: 'open', 3: 'closed', 4: 'none',
      };
      const mapped = arrowMap[Number(arrowStyle)];
      if (mapped) (lead as any).arrowType = mapped;
    }

    // Landing line direction derived from the last two vertices.
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    lead.attachmentSide = last.x >= prev.x ? 'right' : 'left';

    return lead;
  }

  /**
   * Compute the imported drawing's extents, then translate every entity so:
   *
   *   1. The drawing's centroid sits at world origin (eliminates precision
   *      issues for surveyed/geo-referenced DXFs and gives tools a predictable
   *      coordinate space â€” cursor world coords == file-local coords).
   *
   *   2. Multi-file imports land beside any already-loaded file in world
   *      space, without using `dxfFile.x/y` as a file transform (tools write
   *      to file-local space, and a non-zero file transform would double-
   *      offset every newly drawn entity).
   *
   * The total shift is stored on `dxfFile.importOffset` so DXF export can
   * restore the original world placement. `dxfFile.x/y` stay at 0.
   */
  private normalizeAndPlace(dxfFile: DxfFile): void {
    const ownExtents = extentsOf(dxfFile.entities);
    if (!ownExtents) return;

    // Step 1 â€” normalize: shift so the drawing centroid is at (0, 0).
    const ownCx = (ownExtents.minX + ownExtents.maxX) / 2;
    const ownCy = (ownExtents.minY + ownExtents.maxY) / 2;
    let placementDx = 0;
    let placementDy = 0;

    // Step 2 â€” multi-file layout: when other files are already loaded, push
    // this drawing to the right of the rightmost existing file (in world
    // space), keeping its centre on the existing files' vertical midline.
    if (this.doc.files.length > 0) {
      const otherExtents = combinedWorldExtents(this.doc.files);
      if (otherExtents) {
        const ownWidth = ownExtents.maxX - ownExtents.minX;
        const otherWidth = otherExtents.maxX - otherExtents.minX;
        const gap = Math.max(20, (otherWidth + ownWidth) * 0.05);
        placementDx = otherExtents.maxX + gap + ownWidth / 2;
        placementDy = (otherExtents.minY + otherExtents.maxY) / 2;
      }
    }

    const dx = -ownCx + placementDx;
    const dy = -ownCy + placementDy;
    translateEntitiesInPlace(dxfFile.entities, dx, dy);

    // Round-trip anchor: on DXF export, adding `importOffset` to every entity
    // coordinate restores the original drawing's world placement. Step-1
    // (normalization) is undone; step-2 (editor layout) is not â€” the layout
    // shift was a UX convenience, not part of the source DXF.
    dxfFile.importOffset = { x: ownCx - placementDx, y: ownCy - placementDy };
  }
}

/** Axis-aligned bounding box of all entities, computed via `bbox()`. Filters extreme spatial outliers. */
function extentsOf(entities: Entity[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const items: Array<{ minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number }> = [];

  for (const e of entities) {
    const bb = e.bbox?.();
    if (!bb) continue;
    if (!Number.isFinite(bb.x) || !Number.isFinite(bb.y) || !Number.isFinite(bb.w) || !Number.isFinite(bb.h)) continue;
    if (bb.w <= 0 || bb.h <= 0) continue;
    if (bb.w > 10000000 || bb.h > 10000000) continue;

    const eminX = bb.x;
    const emaxX = bb.x + bb.w;
    const eminY = bb.y;
    const emaxY = bb.y + bb.h;

    items.push({
      minX: eminX,
      maxX: emaxX,
      minY: eminY,
      maxY: emaxY,
      cx: (eminX + emaxX) / 2,
      cy: (eminY + emaxY) / 2,
    });
  }

  if (items.length === 0) return null;

  let validItems = items;
  if (items.length >= 10) {
    const xs = items.map(i => i.cx).sort((a, b) => a - b);
    const ys = items.map(i => i.cy).sort((a, b) => a - b);

    const q1X = xs[Math.floor(xs.length * 0.25)];
    const q3X = xs[Math.floor(xs.length * 0.75)];
    const iqrX = Math.max(q3X - q1X, 1000);

    const q1Y = ys[Math.floor(ys.length * 0.25)];
    const q3Y = ys[Math.floor(ys.length * 0.75)];
    const iqrY = Math.max(q3Y - q1Y, 1000);

    const minCx = q1X - 2.5 * iqrX;
    const maxCx = q3X + 2.5 * iqrX;
    const minCy = q1Y - 2.5 * iqrY;
    const maxCy = q3Y + 2.5 * iqrY;

    const filtered = items.filter(i => i.cx >= minCx && i.cx <= maxCx && i.cy >= minCy && i.cy <= maxCy);
    if (filtered.length > 0) validItems = filtered;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of validItems) {
    if (item.minX < minX) minX = item.minX;
    if (item.maxX > maxX) maxX = item.maxX;
    if (item.minY < minY) minY = item.minY;
    if (item.maxY > maxY) maxY = item.maxY;
  }

  return { minX, minY, maxX, maxY };
}

/** Combined world-space extents across every visible file (after their own transforms). */
function combinedWorldExtents(files: DxfFile[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let valid = false;
  for (const file of files) {
    if (!file.visible) continue;
    const ext = extentsOf(file.entities);
    if (!ext) continue;
    // Files always have x = y = 0 after normalization, but honour any
    // non-identity transform here for safety / forward-compat.
    const fx = file.x, fy = file.y, sc = file.scale;
    minX = Math.min(minX, fx + ext.minX * sc);
    minY = Math.min(minY, fy + ext.minY * sc);
    maxX = Math.max(maxX, fx + ext.maxX * sc);
    maxY = Math.max(maxY, fy + ext.maxY * sc);
    valid = true;
  }
  return valid ? { minX, minY, maxX, maxY } : null;
}

/**
 * Normalize a single HATCH boundary into the edge-list shape that HatchEntity expects.
 * dxf-parser produces three flavors depending on the source DXF:
 *   - `boundary.edges = [{ type, start, end, ... }]` â€” explicit edge list
 *   - `boundary.polyline = { vertices: [...] }` â€” closed/open polyline boundary
 *   - `boundary.polyline = [{x, y}, ...]` â€” bare vertex array (older builds)
 */
function normalizeHatchBoundary(b: any): any[] {
  if (Array.isArray(b?.edges)) return b.edges;
  const polyline = b?.polyline;
  if (polyline) {
    const rawVerts: any[] = Array.isArray(polyline) ? polyline : (polyline.vertices ?? []);
    const vertices = rawVerts
      .map((v: any) => ({
        x: v?.x ?? v?.point?.x,
        y: v?.y ?? v?.point?.y,
        bulge: v?.bulge ?? 0,
      }))
      .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (vertices.length) return hatchPolylineToEdges(vertices, polyline.closed !== false);
  }
  return [];
}

/** Convert the semantic, source-unit HATCH paths back to editor edge loops. */
function dxfHatchPathsToBoundaries(hatch: IDxfHatchData): any[][] {
  return hatch.boundaryPaths.map((path) => {
    if (path.kind === 'polyline') {
      return hatchPolylineToEdges(
        path.vertices.map((v) => ({ x: v.point.x, y: v.point.y, bulge: v.bulge ?? 0 })),
        path.closed,
      );
    }
    return path.edges.map((edge) => {
      switch (edge.kind) {
        case 'line': return { type: 'LINE', start: edge.start, end: edge.end };
        case 'arc': return {
          type: 'ARC', center: edge.center, radius: edge.radius,
          startAngle: edge.startAngleDeg * Math.PI / 180,
          endAngle: edge.endAngleDeg * Math.PI / 180,
          isCcw: edge.counterClockwise,
        };
        case 'ellipse': return {
          type: 'ELLIPSE', center: edge.center, majorAxisEndPoint: edge.majorAxisEndPoint,
          axisRatio: edge.axisRatio, startAngle: edge.startAngle * Math.PI / 180,
          endAngle: edge.endAngle * Math.PI / 180, isCcw: edge.counterClockwise,
        };
        case 'spline': return {
          type: 'SPLINE', vertices: edge.controlPoints, degree: edge.degree,
          knots: edge.knots, weights: edge.weights, fitPoints: edge.fitPoints,
          startTangent: edge.startTangent, endTangent: edge.endTangent,
        };
      }
    });
  });
}

/**
 * DXF polyline group 42 stores an arc bulge on the vertex that begins the
 * segment. Convert it to the editor's native arc edge instead of flattening
 * it to a chord, while the original bulge remains in `dxfHatch` for export.
 */
function hatchPolylineToEdges(vertices: Array<{ x: number; y: number; bulge?: number }>, closed: boolean): any[] {
  if (vertices.length < 2) return [];
  const end = closed ? vertices.length : vertices.length - 1;
  const edges: any[] = [];
  for (let i = 0; i < end; i++) {
    const start = vertices[i];
    const finish = vertices[(i + 1) % vertices.length];
    const bulge = Number(start.bulge ?? 0);
    if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-12) {
      edges.push({ type: 'LINE', start: { x: start.x, y: start.y }, end: { x: finish.x, y: finish.y } });
      continue;
    }
    const dx = finish.x - start.x;
    const dy = finish.y - start.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-12) continue;
    const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge);
    const midX = (start.x + finish.x) / 2;
    const midY = (start.y + finish.y) / 2;
    const center = { x: midX - dy / chord * centerOffset, y: midY + dx / chord * centerOffset };
    edges.push({
      type: 'ARC', center,
      radius: chord * (1 + bulge * bulge) / (4 * Math.abs(bulge)),
      startAngle: Math.atan2(start.y - center.y, start.x - center.x),
      endAngle: Math.atan2(finish.y - center.y, finish.x - center.x),
      isCcw: bulge > 0,
    });
  }
  return edges;
}

function isDxfHatchData(value: any): value is IDxfHatchData {
  return value?.schemaVersion === 1 && Array.isArray(value?.rawTags)
    && Array.isArray(value?.boundaryPaths) && value?.pattern != null;
}

function cloneDxfHatchData(value: IDxfHatchData): IDxfHatchData {
  return JSON.parse(JSON.stringify(value));
}

/** Map preserved DXF-only fields into the editor without throwing away source data. */
function applyDxfHatchData(hatch: HatchEntity, source: IDxfHatchData): void {
  hatch.dxfHatch = cloneDxfHatchData(source);
  hatch.pattern = source.pattern.name;
  hatch.scale = source.pattern.scale;
  hatch.angle = source.pattern.angle;
  hatch.solid = source.pattern.solidFill;
  hatch.associative = source.pattern.associative;
  hatch.doubleHatch = source.pattern.double;
  hatch.customPatternLines = source.pattern.definitionLines.map((line) => ({ ...line, dashArray: [...line.dashArray] }));
  hatch.hatchStyle = source.pattern.style === 1 ? 'Outer' : source.pattern.style === 2 ? 'Ignore' : 'Normal';
  hatch.patternType = source.pattern.type === 0 ? 'User-defined' : source.pattern.type === 2 ? 'Custom' : 'Predefined';

  if (!source.gradient?.isGradient) return;
  hatch.gradientType = source.gradient.name.toLowerCase() as HatchEntity['gradientType'];
  // DXF group 460 is radians; the existing canvas gradient API uses degrees.
  hatch.gradientAngle = source.gradient.angleRad * 180 / Math.PI;
  hatch.gradientShift = source.gradient.centeredShift;
  hatch.gradientSingleColor = source.gradient.singleColor;
  const color = (c: { aci?: number; trueColor?: number } | undefined): string | undefined => {
    if (!c) return undefined;
    if (c.trueColor !== undefined) return '#' + c.trueColor.toString(16).padStart(6, '0');
    return c.aci !== undefined ? DXF_ACI_COLORS[c.aci] : undefined;
  };
  hatch.gradientColor1 = color(source.gradient.colors[0]);
  hatch.gradientColor2 = color(source.gradient.colors[1]);
}

/** Average of all polygon vertices â€” used as the import seed point. */
function polygonCentroid(pts: IPoint[]): IPoint {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}
