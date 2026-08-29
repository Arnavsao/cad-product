import { Injectable } from '@angular/core';
import type { Entity, IBBox } from '../../../core/models/entity.model';
import { TextEntity } from '../../../core/models/entity-extended.model';
import { generateComponent } from '../shared/component-generators';
import { COMPONENT_FAMILIES } from '../models/component-family.model';
import {
  DRAWING_TEMPLATES, findDrawingTemplate, type DrawingTemplate,
} from '../models/drawing-template.model';

export interface GenerationStep {
  title: string;
  familyId: string;
  /** Entities for this sub-view, already translated into the sheet grid. */
  entities: Entity[];
  /** Final world-space bbox of this sub-view (after placement). */
  bbox: IBBox;
}

export interface GenerationResult {
  template: DrawingTemplate;
  steps: GenerationStep[];
  /** Flat list of every entity to paste (titles included). */
  entities: Entity[];
  /** Number of sub-views generated. */
  viewCount: number;
}

/**
 * GenerationPlannerService — the deterministic core of the "drawing generation"
 * agent pipeline (Phase 5).
 *
 * Planner : findDrawingTemplate() chooses a template from the goal.
 * CAD     : generateComponent() builds each sub-view's geometry.
 * Layout  : sub-views are placed into the template's grid (no detection
 *           round-trip needed — positions are computed up front, so the whole
 *           drawing commits atomically as one CompoundCmd).
 *
 * The result is purely data (Entity[]); committing is the tool's job.
 */
@Injectable({ providedIn: 'root' })
export class GenerationPlannerService {
  readonly templates = DRAWING_TEMPLATES;

  findTemplate(query: string): DrawingTemplate | null {
    return findDrawingTemplate(query);
  }

  /**
   * Build a complete drawing from a template id (or fuzzy query) and overall
   * parameters. Returns null if no template matches.
   */
  generate(
    query: string,
    params: Record<string, number | string | boolean> = {},
  ): GenerationResult | null {
    const template = this.findTemplate(query);
    if (!template) return null;

    // Normalise overall params against the primary family's ParamSpec.
    const primary = COMPONENT_FAMILIES.find(f => f.id === template.primaryFamilyId);
    const baseParams = this._normalise(params, primary?.params ?? []);

    // First pass: generate each sub-view at origin to measure its size.
    const raw = template.subViews.map(sv => {
      const fam = COMPONENT_FAMILIES.find(f => f.id === sv.familyId);
      const merged = { ...baseParams, ...this._normalise(sv.paramOverrides ?? {}, fam?.params ?? []) };
      const ents = generateComponent(sv.familyId, merged) ?? [];
      return { sv, ents, bbox: this._groupBBox(ents) };
    });

    // Column widths and row heights from the largest cell in each col/row.
    const colW = new Map<number, number>();
    const rowH = new Map<number, number>();
    for (const r of raw) {
      const w = r.bbox?.w ?? 0;
      const h = r.bbox?.h ?? 0;
      colW.set(r.sv.col, Math.max(colW.get(r.sv.col) ?? 0, w));
      rowH.set(r.sv.row, Math.max(rowH.get(r.sv.row) ?? 0, h));
    }

    const g = template.gutter;
    const titleH = g * 0.6;

    // Cumulative grid offsets.
    const colX = new Map<number, number>();
    let xAcc = 0;
    const maxCol = Math.max(...raw.map(r => r.sv.col));
    for (let c = 0; c <= maxCol; c++) {
      colX.set(c, xAcc);
      xAcc += (colW.get(c) ?? 0) + g;
    }

    const rowY = new Map<number, number>();
    let yAcc = 0;
    const maxRow = Math.max(...raw.map(r => r.sv.row));
    // Rows go downward (world Y decreases as row increases).
    for (let rIdx = 0; rIdx <= maxRow; rIdx++) {
      rowY.set(rIdx, yAcc);
      yAcc -= (rowH.get(rIdx) ?? 0) + g + titleH;
    }

    // Second pass: place each sub-view + title.
    const steps: GenerationStep[] = [];
    const allEntities: Entity[] = [];

    for (const r of raw) {
      if (!r.bbox) continue;
      const slotX = colX.get(r.sv.col) ?? 0;
      const slotTop = rowY.get(r.sv.row) ?? 0;

      // Move sub-view so its top-left aligns to the slot.
      const dx = slotX - r.bbox.x;
      const dy = (slotTop - titleH) - (r.bbox.y + r.bbox.h); // top edge below the title band
      for (const e of r.ents) this._translate(e, dx, dy);

      // Title text above the sub-view.
      const title = new TextEntity(slotX, slotTop, r.sv.title, titleH * 0.5);
      title.layer = 'DIM';
      allEntities.push(title);

      const placedBBox = this._groupBBox(r.ents) ?? r.bbox;
      steps.push({ title: r.sv.title, familyId: r.sv.familyId, entities: r.ents, bbox: placedBBox });
      allEntities.push(...r.ents);
    }

    return { template, steps, entities: allEntities, viewCount: steps.length };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _normalise(
    params: Record<string, number | string | boolean>,
    specs: { key: string; type: string; default: number | string | boolean }[],
  ): Record<string, number | string | boolean> {
    const out: Record<string, number | string | boolean> = {};
    for (const spec of specs) {
      const raw = params[spec.key];
      if (raw === undefined || raw === null) {
        out[spec.key] = spec.default;
      } else if (spec.type === 'length' && typeof raw === 'number' && raw < 100) {
        out[spec.key] = raw * 1000; // metres → mm heuristic
      } else {
        out[spec.key] = raw;
      }
    }
    return out;
  }

  private _groupBBox(entities: Entity[]): IBBox | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let has = false;
    for (const e of entities) {
      const bb = typeof e.bbox === 'function' ? e.bbox() : null;
      if (bb && isFinite(bb.x)) {
        has = true;
        if (bb.x < minX) minX = bb.x;
        if (bb.y < minY) minY = bb.y;
        if (bb.x + bb.w > maxX) maxX = bb.x + bb.w;
        if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
      }
    }
    return has ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
  }

  private _translate(e: Entity, dx: number, dy: number): void {
    const ent = e as any;
    switch (ent.type) {
      case 'LINE': ent.x1 += dx; ent.y1 += dy; ent.x2 += dx; ent.y2 += dy; break;
      case 'CIRCLE': case 'ARC': case 'ELLIPSE': ent.cx += dx; ent.cy += dy; break;
      case 'POLYLINE': case 'LEADER':
        if (Array.isArray(ent.pts)) for (const p of ent.pts) { p.x += dx; p.y += dy; }
        break;
      case 'TEXT': case 'POINT': case 'INSERT': case 'XLINE': case 'IMAGE': case 'TABLE':
        ent.x += dx; ent.y += dy; break;
      default:
        if (typeof ent.x === 'number') ent.x += dx;
        if (typeof ent.y === 'number') ent.y += dy;
    }
    if (typeof e.refreshCaches === 'function') e.refreshCaches();
  }
}
