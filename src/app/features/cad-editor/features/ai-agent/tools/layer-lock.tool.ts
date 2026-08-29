import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { CadAction } from '../models/ai-action.model';
import type { ICommand } from '../../../core/models/command.model';
import { ModifyLayerPropertyCmd } from '../../../core/models/command.model';

interface LockParams {
  locked: boolean;
}

export function makeLayerLockTool(): AiTool<LockParams> {
  return {
    id: 'layer.lock',
    title: 'Lock / Unlock Layer',
    description: 'Lock or unlock a layer. locked: true to lock, false to unlock.',
    category: 'layer',
    permissions: ['mutate:layers'],

    validate(action, ctx): AiToolValidationResult {
      if (action.target.kind !== 'layer') {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'INVALID_TARGET', severity: 'error', message: 'Target must be a layer.' }],
          warnings: [],
        };
      }
      const layer = ctx.doc.activeFile.layers.get(action.target.layer);
      if (!layer) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'LAYER_NOT_FOUND', severity: 'error', message: `Layer "${action.target.layer}" does not exist.` }],
          warnings: [],
        };
      }
      return { ok: true, confidence: 1, affectedIds: [], riskClass: 'safe', errors: [], warnings: [] };
    },

    compile(action, ctx): ICommand[] {
      if (action.target.kind !== 'layer') return [];
      const layer = ctx.doc.activeFile.layers.get(action.target.layer);
      if (!layer) return [];
      const { locked } = action.parameters;
      return [new ModifyLayerPropertyCmd(
        layer as unknown as Record<string, unknown>,
        { locked: layer.locked },
        { locked },
        ctx.hooks,
      )];
    },

    describe(action, _ids): string {
      const layerName = action.target.kind === 'layer' ? action.target.layer : '?';
      return `${action.parameters.locked ? 'Locked' : 'Unlocked'} layer "${layerName}".`;
    },
  };
}
