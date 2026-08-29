import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { CadAction } from '../models/ai-action.model';
import type { ICommand } from '../../../core/models/command.model';
import { DeleteMultipleCmd } from '../../../core/models/command.model';

export function makeEntitiesDeleteTool(): AiTool {
  return {
    id: 'entities.delete',
    title: 'Delete Entities',
    description: 'Permanently delete entities from the drawing. Always requires confirmation.',
    category: 'entity',
    permissions: ['mutate:entities'],

    validate(action, ctx): AiToolValidationResult {
      const entities = ctx.resolveTarget(action.target);
      if (entities.length === 0) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'destructive',
          errors: [{ code: 'TARGET_EMPTY', severity: 'error', message: 'No visible entities match.' }],
          warnings: [],
        };
      }

      const lockedCount = entities.filter(e => ctx.doc.activeFile.layers.get(e.layer)?.locked).length;
      const warnings = lockedCount > 0 ? [{
        code: 'LOCKED_LAYER_ENTITIES', severity: 'warning' as const,
        message: `${lockedCount} entities are on locked layers and will be skipped.`,
      }] : [];

      return {
        ok: true, confidence: 1, affectedIds: entities.map(e => e.id),
        riskClass: 'destructive', errors: [], warnings,
      };
    },

    compile(action, ctx): ICommand[] {
      const entities = ctx.resolveTarget(action.target).filter(e => {
        return !ctx.doc.activeFile.layers.get(e.layer)?.locked;
      });
      if (entities.length === 0) return [];
      return [new DeleteMultipleCmd(entities, e => ctx.doc.getFileOfEntity(e), ctx.hooks)];
    },

    describe(_action, affectedIds): string {
      return `Deleted ${affectedIds.length} entit${affectedIds.length === 1 ? 'y' : 'ies'}.`;
    },
  };
}
