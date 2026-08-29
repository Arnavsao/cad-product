import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { CadAction } from '../models/ai-action.model';
import type { ICommand } from '../../../core/models/command.model';
import { CompoundCmd, DeleteMultipleCmd, PasteEntitiesCmd } from '../../../core/models/command.model';
import type { Entity } from '../../../core/models/entity.model';
import { LibrarySearchService } from '../services/library-search.service';
import { generateComponent, type GeneratorParams } from '../shared/component-generators';
import { TranslateEntitiesCmd } from '../shared/translate-entities.cmd';
import { COMPONENT_FAMILIES } from '../models/component-family.model';

interface ReplaceParams {
  /** What to replace with: a description passed to library search. */
  with: string;
  /** Component-specific parameters for parametric items. */
  params?: Record<string, number | string | boolean>;
}

export function makeEntitiesReplaceTool(search: LibrarySearchService): AiTool<ReplaceParams> {
  return {
    id: 'entities.replace',
    title: 'Replace Selected Entities',
    description: 'Delete the current selection and replace it with a component from the library or a parametric component.',
    category: 'library',
    permissions: ['mutate:entities', 'insert:library'],

    validate(action, ctx): AiToolValidationResult {
      const selected = ctx.doc.getSelectedEntities();
      if (!selected.length) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'destructive',
          errors: [{ code: 'TARGET_EMPTY', severity: 'error', message: 'Select the entities you want to replace first.' }],
          warnings: [],
        };
      }

      const { with: query } = action.parameters;
      if (!query) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'destructive',
          errors: [{ code: 'MISSING_REPLACEMENT', severity: 'error', message: 'Specify what to replace the selection with.' }],
          warnings: [],
        };
      }

      const best = search.findBest(query);
      if (!best) {
        return {
          ok: false, confidence: 1, affectedIds: selected.map(e => e.id), riskClass: 'destructive',
          errors: [{ code: 'COMPONENT_NOT_FOUND', severity: 'error', message: `Could not find a component matching "${query}".` }],
          warnings: [],
        };
      }

      return {
        ok: true, confidence: best.score,
        affectedIds: selected.map(e => e.id), riskClass: 'destructive',
        errors: [],
        warnings: [{
          code: 'REPLACE_DESTRUCTIVE', severity: 'warning',
          message: `Will delete ${selected.length} selected entities and insert "${best.kind === 'library' ? best.item.name : best.family.name}".`,
        }],
      };
    },

    compile(action, ctx): ICommand[] {
      const selected = ctx.doc.getSelectedEntities();
      if (!selected.length) return [];

      const { with: query, params = {} } = action.parameters;
      const best = search.findBest(query);
      if (!best) return [];

      // Compute centroid of the deleted selection to place replacement there.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const e of selected) {
        const bb = typeof e.bbox === 'function' ? e.bbox() : null;
        if (bb) {
          if (bb.x < minX) minX = bb.x; if (bb.y < minY) minY = bb.y;
          if (bb.x + bb.w > maxX) maxX = bb.x + bb.w;
          if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
        }
      }
      const insertAt = {
        x: isFinite(minX + maxX) ? (minX + maxX) / 2 : 0,
        y: isFinite(minY + maxY) ? (minY + maxY) / 2 : 0,
      };

      let newEntities: Entity[] = [];
      if (best.kind === 'library') {
        newEntities = ctx.library._hydrateEntities(best.item.entities);
      } else {
        const fam = best.family;
        const normalised: Record<string, number | string | boolean> = {};
        for (const spec of fam.params) {
          const raw = (params as any)[spec.key];
          normalised[spec.key] = raw !== undefined
            ? (spec.type === 'length' && typeof raw === 'number' && raw < 100 ? raw * 1000 : raw)
            : spec.default;
        }
        const generated = generateComponent(fam.id, normalised as GeneratorParams);
        if (generated) newEntities = generated;
      }

      if (!newEntities.length) return [];

      const file = ctx.doc.activeFile;

      // Centre new entities over the insertion point.
      let nMinX = Infinity, nMinY = Infinity, nMaxX = -Infinity, nMaxY = -Infinity;
      for (const e of newEntities) {
        const bb = typeof e.bbox === 'function' ? e.bbox() : null;
        if (bb) {
          if (bb.x < nMinX) nMinX = bb.x; if (bb.y < nMinY) nMinY = bb.y;
          if (bb.x + bb.w > nMaxX) nMaxX = bb.x + bb.w;
          if (bb.y + bb.h > nMaxY) nMaxY = bb.y + bb.h;
        }
      }
      const ncx = isFinite(nMinX + nMaxX) ? (nMinX + nMaxX) / 2 : 0;
      const ncy = isFinite(nMinY + nMaxY) ? (nMinY + nMaxY) / 2 : 0;

      const cmds: ICommand[] = [
        new DeleteMultipleCmd(selected, e => ctx.doc.getFileOfEntity(e), ctx.hooks),
        new TranslateEntitiesCmd(newEntities, insertAt.x - ncx, insertAt.y - ncy, ctx.hooks),
        new PasteEntitiesCmd(newEntities, file, ctx.hooks),
      ];

      return [new CompoundCmd(cmds)];
    },

    describe(action, affectedIds): string {
      return `Replaced ${affectedIds.length} entit${affectedIds.length === 1 ? 'y' : 'ies'} with "${action.parameters.with}".`;
    },
  };
}
