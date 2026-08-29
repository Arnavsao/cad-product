import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { CadAction } from '../models/ai-action.model';
import type { ICommand } from '../../../core/models/command.model';
import { PasteEntitiesCmd } from '../../../core/models/command.model';
import type { Entity } from '../../../core/models/entity.model';
import { LibrarySearchService } from '../services/library-search.service';
import { generateComponent, type GeneratorParams } from '../shared/component-generators';
import { TranslateEntitiesCmd } from '../shared/translate-entities.cmd';
import { COMPONENT_FAMILIES, type ParamSpec } from '../models/component-family.model';
import { Layer } from '../../../core/models/layer.model';

interface InsertParams {
  /** Free-text description of what to insert (e.g. "retaining wall"). */
  query: string;
  /** Component-specific parameters (e.g. {thickness: 500, height: 3000}). */
  params?: Record<string, number | string | boolean>;
  /** Insertion point in world coordinates. Defaults to (0,0). */
  at?: { x: number; y: number };
}

function normaliseParams(
  rawParams: Record<string, number | string | boolean>,
  specs: ParamSpec[],
): Record<string, number | string | boolean> {
  const result: Record<string, number | string | boolean> = {};
  for (const spec of specs) {
    const raw = rawParams[spec.key];
    if (raw === undefined || raw === null) {
      result[spec.key] = spec.default;
      continue;
    }
    // Unit normalisation: if spec is a length in mm and user passed "m" suffix
    // or a float < 100 (looks like metres), convert to mm.
    if (spec.type === 'length' && typeof raw === 'number') {
      // Heuristic: if value < 100 it's almost certainly metres, not mm
      result[spec.key] = raw < 100 ? raw * 1000 : raw;
    } else {
      result[spec.key] = raw;
    }
  }
  return result;
}

export function makeLibraryInsertTool(search: LibrarySearchService): AiTool<InsertParams> {
  return {
    id: 'library.insert',
    title: 'Insert Component',
    description: 'Find and insert a library component or parametric component by description. Supports: retaining wall, box culvert, drainage channel, inspection chamber, pipe culvert — and any saved library item.',
    category: 'library',
    permissions: ['insert:library'],

    validate(action, ctx): AiToolValidationResult {
      const { query } = action.parameters;
      if (!query || typeof query !== 'string') {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'MISSING_QUERY', severity: 'error', message: 'Provide a description of what to insert.' }],
          warnings: [],
        };
      }

      const best = search.findBest(query);
      if (!best) {
        const all = search.search(query, 3);
        const suggestions = all.map(r =>
          r.kind === 'library' ? `"${r.item.name}"` : `"${r.family.name}"`,
        ).join(', ');
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{
            code: 'COMPONENT_NOT_FOUND', severity: 'error',
            message: `Could not find a component matching "${query}".${suggestions ? ` Did you mean: ${suggestions}?` : ''}`,
          }],
          warnings: [],
        };
      }

      return {
        ok: true, confidence: best.score, affectedIds: [], riskClass: 'review',
        errors: [],
        warnings: [{
          code: 'COMPONENT_RESOLVED', severity: 'warning',
          message: best.kind === 'library'
            ? `Will insert library item: "${best.item.name}"`
            : `Will generate parametric: "${best.family.name}" with supplied params.`,
        }],
      };
    },

    compile(action, ctx): ICommand[] {
      const { query, params = {}, at = { x: 0, y: 0 } } = action.parameters;
      const best = search.findBest(query);
      if (!best) return [];

      let entities: Entity[] = [];

      if (best.kind === 'library') {
        // Rehydrate saved library entities.
        entities = ctx.library._hydrateEntities(best.item.entities);
      } else {
        // Parametric: normalise params and generate.
        const family = best.family;
        const normalised = normaliseParams(
          params as Record<string, number | string | boolean>,
          family.params,
        );
        const generated = generateComponent(family.id, normalised as GeneratorParams);
        if (!generated || !generated.length) return [];
        entities = generated;
      }

      if (!entities.length) return [];

      // Centre the group on the insertion point.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const e of entities) {
        const bb = typeof e.bbox === 'function' ? e.bbox() : null;
        if (bb) {
          if (bb.x < minX) minX = bb.x;
          if (bb.y < minY) minY = bb.y;
          if (bb.x + bb.w > maxX) maxX = bb.x + bb.w;
          if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
        }
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const dx = (at.x || 0) - (isFinite(cx) ? cx : 0);
      const dy = (at.y || 0) - (isFinite(cy) ? cy : 0);

      const file = ctx.doc.activeFile;
      const cmds: ICommand[] = [];

      // Ensure required layers exist.
      const layerNames = new Set(entities.map(e => e.layer));
      for (const name of layerNames) {
        if (!file.layers.has(name)) {
          const layerRef = file.layers;
          const existed = layerRef.has(name);
          cmds.push({
            execute() { if (!layerRef.has(name)) layerRef.set(name, new Layer(name)); },
            undo() { if (!existed) layerRef.delete(name); },
          });
        }
      }

      // Translate to insertion point, then paste.
      cmds.push(new TranslateEntitiesCmd(entities, dx, dy, ctx.hooks));
      cmds.push(new PasteEntitiesCmd(entities, file, ctx.hooks));

      return cmds;
    },

    describe(action, _ids): string {
      return `Inserted component "${action.parameters.query}" at (${action.parameters.at?.x ?? 0}, ${action.parameters.at?.y ?? 0}).`;
    },
  };
}
