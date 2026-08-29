import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { CadAction } from '../models/ai-action.model';
import type { ICommand } from '../../../core/models/command.model';
import { ModifyLayerPropertyCmd, CompoundCmd } from '../../../core/models/command.model';

/**
 * layer.isolate — makes a single layer visible; hides all others.
 * Produces one ModifyLayerPropertyCmd per layer that actually needs to change,
 * all wrapped in a CompoundCmd so a single Ctrl+Z restores everything.
 */
export function makeLayerIsolateTool(): AiTool {
  return {
    id: 'layer.isolate',
    title: 'Isolate Layer',
    description: 'Make one layer visible and hide all others.',
    category: 'layer',
    permissions: ['mutate:layers'],

    validate(action, ctx): AiToolValidationResult {
      if (action.target.kind !== 'layer') {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'INVALID_TARGET', severity: 'error', message: 'Target must be a layer.' }],
          warnings: [],
        };
      }
      const layer = ctx.doc.activeFile.layers.get(action.target.layer);
      if (!layer) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'LAYER_NOT_FOUND', severity: 'error', message: `Layer "${action.target.layer}" does not exist.` }],
          warnings: [],
        };
      }
      const totalLayers = ctx.doc.activeFile.layers.size;
      return {
        ok: true, confidence: 1, affectedIds: [], riskClass: 'review',
        errors: [],
        warnings: [{
          code: 'ISOLATE_HIDES_LAYERS', severity: 'warning',
          message: `This will hide ${totalLayers - 1} other layer(s). Use Undo to restore.`,
        }],
      };
    },

    compile(action, ctx): ICommand[] {
      if (action.target.kind !== 'layer') return [];
      const targetName = action.target.layer.toLowerCase();
      const file = ctx.doc.activeFile;
      const hooks = ctx.hooks;
      const subCmds: ICommand[] = [];

      for (const [name, layer] of file.layers) {
        const shouldBeVisible = name.toLowerCase() === targetName;
        if (layer.visible !== shouldBeVisible) {
          subCmds.push(new ModifyLayerPropertyCmd(
            layer as unknown as Record<string, unknown>,
            { visible: layer.visible },
            { visible: shouldBeVisible },
            hooks,
          ));
        }
      }

      if (subCmds.length === 0) return [];
      return subCmds.length === 1 ? subCmds : [new CompoundCmd(subCmds)];
    },

    describe(action, _ids): string {
      const layerName = action.target.kind === 'layer' ? action.target.layer : '?';
      return `Isolated layer "${layerName}" — all other layers are now hidden.`;
    },
  };
}
