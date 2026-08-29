import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { CadAction } from '../models/ai-action.model';
import type { ICommand } from '../../../core/models/command.model';

interface SelectParams {
  mode?: 'replace' | 'add' | 'remove';
}

export function makeQuerySelectEntitiesTool(): AiTool<SelectParams> {
  return {
    id: 'query.selectEntities',
    title: 'Select Entities',
    description: 'Select entities by type, layer, color, or spatial query. Use mode "replace" (default), "add", or "remove".',
    category: 'selection',
    permissions: ['read'],
    noHistory: true,

    validate(action, ctx): AiToolValidationResult {
      const entities = ctx.resolveTarget(action.target);
      if (entities.length === 0) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'TARGET_EMPTY', severity: 'error', message: 'No visible entities match the selection criteria.' }],
          warnings: [],
        };
      }
      return {
        ok: true, confidence: 1, affectedIds: entities.map(e => e.id),
        riskClass: 'safe', errors: [], warnings: [],
      };
    },

    compile(action, ctx): ICommand[] {
      const entities = ctx.resolveTarget(action.target);
      const mode = action.parameters.mode ?? 'replace';
      return [{
        execute() {
          if (mode === 'replace') {
            ctx.doc.setSelection(entities, { notify: false });
          } else if (mode === 'add') {
            ctx.doc.setSelection([...ctx.doc.getSelectedEntities(), ...entities], { notify: false });
          } else {
            const removeSet = new Set(entities.map(e => e.id));
            const remaining = ctx.doc.getSelectedEntities().filter(e => !removeSet.has(e.id));
            ctx.doc.setSelection(remaining, { notify: false });
          }
          ctx.vm.markDirty();
        },
        undo() { /* selection changes are not undoable */ },
      }];
    },

    describe(_action, affectedIds): string {
      return `Selected ${affectedIds.length} entit${affectedIds.length === 1 ? 'y' : 'ies'}.`;
    },
  };
}
