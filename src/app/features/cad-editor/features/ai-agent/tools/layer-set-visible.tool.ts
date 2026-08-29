import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { CadAction } from '../models/ai-action.model';
import type { ICommand } from '../../../core/models/command.model';
import { ModifyLayerPropertyCmd } from '../../../core/models/command.model';

interface SetVisibleParams {
  visible: boolean;
}

export function makeLayerSetVisibleTool(): AiTool<SetVisibleParams> {
  return {
    id: 'layer.setVisible',
    title: 'Show / Hide Layer',
    description: 'Show or hide a layer. visible: true to show, false to hide.',
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
      if (layer.isProtected && action.parameters.visible === false) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'PROTECTED_LAYER', severity: 'error', message: `Layer "${action.target.layer}" is protected and cannot be hidden.` }],
          warnings: [],
        };
      }
      return { ok: true, confidence: 1, affectedIds: [], riskClass: 'safe', errors: [], warnings: [] };
    },

    compile(action, ctx): ICommand[] {
      if (action.target.kind !== 'layer') return [];
      const layer = ctx.doc.activeFile.layers.get(action.target.layer);
      if (!layer) return [];
      const { visible } = action.parameters;
      return [new ModifyLayerPropertyCmd(
        layer as unknown as Record<string, unknown>,
        { visible: layer.visible },
        { visible },
        ctx.hooks,
      )];
    },

    describe(action, _ids): string {
      const layerName = action.target.kind === 'layer' ? action.target.layer : '?';
      return `${action.parameters.visible ? 'Showed' : 'Hid'} layer "${layerName}".`;
    },
  };
}
