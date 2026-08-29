import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand } from '../../../core/models/command.model';
import type { MoveDirection } from '../models/ai-view.model';
import { TranslateEntitiesCmd, resolveMoveVector } from '../shared/translate-entities.cmd';

interface MoveParams {
  dx?: number;
  dy?: number;
  distance?: number;
  direction?: MoveDirection;
}

export function makeEntitiesMoveTool(): AiTool<MoveParams> {
  return {
    id: 'entities.move',
    title: 'Move Entities',
    description: 'Move entities by an explicit vector {dx,dy} or by {distance, direction} where direction is left/right/up/down (drawing units).',
    category: 'entity',
    permissions: ['mutate:entities'],

    validate(action, ctx): AiToolValidationResult {
      const entities = ctx.resolveTarget(action.target);
      if (entities.length === 0) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'TARGET_EMPTY', severity: 'error', message: 'No entities to move. Select entities or specify what to move.' }],
          warnings: [],
        };
      }

      const vec = resolveMoveVector(action.parameters);
      if (!vec) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'MISSING_VECTOR', severity: 'error', message: 'Specify either dx/dy or a distance and direction (left/right/up/down).' }],
          warnings: [],
        };
      }
      if (vec.dx === 0 && vec.dy === 0) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'ZERO_VECTOR', severity: 'error', message: 'The move distance is zero.' }],
          warnings: [],
        };
      }

      const locked = entities.filter(e => ctx.doc.activeFile.layers.get(e.layer)?.locked).length;
      const warnings = locked > 0
        ? [{ code: 'LOCKED_LAYER_ENTITIES', severity: 'warning' as const, message: `${locked} entities are on locked layers and will be skipped.` }]
        : [];

      return {
        ok: true, confidence: 1,
        affectedIds: entities.filter(e => !ctx.doc.activeFile.layers.get(e.layer)?.locked).map(e => e.id),
        riskClass: 'safe', errors: [], warnings,
      };
    },

    compile(action, ctx): ICommand[] {
      const entities = ctx.resolveTarget(action.target)
        .filter(e => !ctx.doc.activeFile.layers.get(e.layer)?.locked);
      const vec = resolveMoveVector(action.parameters);
      if (!vec || entities.length === 0) return [];
      return [new TranslateEntitiesCmd(entities, vec.dx, vec.dy, ctx.hooks)];
    },

    describe(action, affectedIds): string {
      const vec = resolveMoveVector(action.parameters);
      const v = vec ? `(${vec.dx}, ${vec.dy})` : '';
      return `Moved ${affectedIds.length} entit${affectedIds.length === 1 ? 'y' : 'ies'} by ${v}.`;
    },
  };
}
