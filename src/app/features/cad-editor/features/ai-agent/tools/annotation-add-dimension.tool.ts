import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand } from '../../../core/models/command.model';
import { AddEntityCmd } from '../../../core/models/command.model';
import type { IBBox, IPoint } from '../../../core/models/entity.model';
import { DimensionEntity } from '../../../core/models/entity-extended.model';

interface AddDimensionParams {
  /** Explicit endpoints (world coords). If omitted, the current selection's bbox is dimensioned. */
  x1?: number; y1?: number;
  x2?: number; y2?: number;
  /** When dimensioning a bbox: which span to measure. Default 'horizontal'. */
  direction?: 'horizontal' | 'vertical';
  /** Perpendicular offset of the dimension line from the measured segment. */
  offset?: number;
  /** Layer for the new dimension. Default 'DIM'. */
  layer?: string;
}

function selectionBBox(ctx: AiToolContext): IBBox | null {
  const sel = ctx.doc.getSelectedEntities();
  if (!sel.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let has = false;
  for (const e of sel) {
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

/** Resolve dimension endpoints + dim-line point from params (explicit or bbox). */
function resolveDimension(
  params: AddDimensionParams,
  ctx: AiToolContext,
): { p1: IPoint; p2: IPoint; dimLine: IPoint } | null {
  // Explicit endpoints.
  if ([params.x1, params.y1, params.x2, params.y2].every(v => typeof v === 'number')) {
    const p1 = { x: params.x1!, y: params.y1! };
    const p2 = { x: params.x2!, y: params.y2! };
    const off = params.offset ?? ((Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.2) || 100);
    // Offset perpendicular to the segment.
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    return { p1, p2, dimLine: { x: mid.x + nx * off, y: mid.y + ny * off } };
  }

  // Selection bbox.
  const bb = selectionBBox(ctx);
  if (!bb) return null;
  const off = params.offset ?? ((Math.max(bb.w, bb.h) * 0.15) || 100);
  if ((params.direction ?? 'horizontal') === 'vertical') {
    const p1 = { x: bb.x, y: bb.y };
    const p2 = { x: bb.x, y: bb.y + bb.h };
    return { p1, p2, dimLine: { x: bb.x - off, y: (p1.y + p2.y) / 2 } };
  }
  const p1 = { x: bb.x, y: bb.y };
  const p2 = { x: bb.x + bb.w, y: bb.y };
  return { p1, p2, dimLine: { x: (p1.x + p2.x) / 2, y: bb.y - off } };
}

export function makeAddDimensionTool(): AiTool<AddDimensionParams> {
  return {
    id: 'annotation.addDimension',
    title: 'Add Dimension',
    description: 'Add a linear dimension. Provide explicit endpoints {x1,y1,x2,y2}, or select entities first and pass direction (horizontal/vertical) to dimension their bounding box.',
    category: 'annotation',
    permissions: ['mutate:entities'],

    validate(action, ctx): AiToolValidationResult {
      const resolved = resolveDimension(action.parameters, ctx);
      if (!resolved) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'NO_DIMENSION_TARGET', severity: 'error', message: 'Provide endpoints (x1,y1,x2,y2) or select entities to dimension.' }],
          warnings: [],
        };
      }
      const span = Math.hypot(resolved.p2.x - resolved.p1.x, resolved.p2.y - resolved.p1.y);
      if (span < 1e-6) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'ZERO_LENGTH', severity: 'error', message: 'The dimension would have zero length.' }],
          warnings: [],
        };
      }
      return { ok: true, confidence: 1, affectedIds: [], riskClass: 'safe', errors: [], warnings: [] };
    },

    compile(action, ctx): ICommand[] {
      const resolved = resolveDimension(action.parameters, ctx);
      if (!resolved) return [];
      const dim = new DimensionEntity(resolved.p1, resolved.p2, resolved.dimLine);
      dim.layer = action.parameters.layer ?? 'DIM';
      return [new AddEntityCmd(dim, ctx.doc.activeFile, ctx.hooks)];
    },

    describe(action, _ids): string {
      return `Added a ${action.parameters.direction ?? 'linear'} dimension.`;
    },
  };
}
