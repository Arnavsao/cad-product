import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand } from '../../../core/models/command.model';
import type { Entity } from '../../../core/models/entity.model';
import type { MoveDirection } from '../models/ai-view.model';
import { TranslateEntitiesCmd, resolveMoveVector } from '../shared/translate-entities.cmd';

interface ViewMoveParams {
  /** Which view to move: a label substring or a keyword (top/bottom/left/right/first/last). */
  view: string;
  dx?: number;
  dy?: number;
  distance?: number;
  direction?: MoveDirection;
}

/** Resolve the member entities of a named view from the active file. */
function viewEntities(entityIds: number[], ctx: AiToolContext): Entity[] {
  const set = new Set(entityIds);
  return ctx.doc.activeFile.entities.filter(e => set.has(e.id));
}

export function makeViewsMoveTool(): AiTool<ViewMoveParams> {
  return {
    id: 'views.move',
    title: 'Move a View',
    description: 'Move a single detected view (drawing) by {dx,dy} or {distance, direction}. Identify the view by label or keyword (e.g. "top", "first").',
    category: 'layout',
    permissions: ['mutate:layout'],

    validate(action, ctx): AiToolValidationResult {
      const { view } = action.parameters;
      if (!view || typeof view !== 'string') {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'MISSING_VIEW', severity: 'error', message: 'Specify which view to move.' }],
          warnings: [],
        };
      }

      const detected = ctx.viewDetection.findView(view);
      if (!detected) {
        const all = ctx.viewDetection.detect();
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{
            code: 'VIEW_NOT_FOUND', severity: 'error',
            message: `Could not find a view matching "${view}". Detected ${all.length} view(s): ${all.map(v => v.label).join(', ') || 'none'}.`,
          }],
          warnings: [],
        };
      }

      const vec = resolveMoveVector(action.parameters);
      if (!vec || (vec.dx === 0 && vec.dy === 0)) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'MISSING_VECTOR', severity: 'error', message: 'Specify a non-zero dx/dy or distance and direction.' }],
          warnings: [],
        };
      }

      return {
        ok: true, confidence: 1, affectedIds: detected.entityIds,
        riskClass: 'review', errors: [], warnings: [],
      };
    },

    compile(action, ctx): ICommand[] {
      const detected = ctx.viewDetection.findView(action.parameters.view);
      const vec = resolveMoveVector(action.parameters);
      if (!detected || !vec) return [];
      const entities = viewEntities(detected.entityIds, ctx);
      if (entities.length === 0) return [];
      return [new TranslateEntitiesCmd(entities, vec.dx, vec.dy, ctx.hooks)];
    },

    describe(action, affectedIds): string {
      const vec = resolveMoveVector(action.parameters);
      const v = vec ? `(${vec.dx}, ${vec.dy})` : '';
      return `Moved view "${action.parameters.view}" by ${v} (${affectedIds.length} entities).`;
    },
  };
}
