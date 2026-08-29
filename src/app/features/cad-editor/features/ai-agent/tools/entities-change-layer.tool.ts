import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { CadAction } from '../models/ai-action.model';
import type { ICommand, IModifyEntitiesCmdHooks } from '../../../core/models/command.model';
import { ModifyPropertiesCmd } from '../../../core/models/command.model';
import { Layer } from '../../../core/models/layer.model';

interface ChangeLayerParams {
  layer: string;
}

/**
 * Inline undoable command for adding a layer.
 * Kept here rather than in command.model.ts to minimise modifications to
 * existing files. Can be promoted to command.model.ts in a later refactor.
 */
class AddLayerCmd implements ICommand {
  constructor(
    private readonly name: string,
    private readonly layers: Map<string, Layer>,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}
  execute(): void {
    if (!this.layers.has(this.name)) {
      this.layers.set(this.name, new Layer(this.name));
      this.hooks.markDirty();
    }
  }
  undo(): void {
    this.layers.delete(this.name);
    this.hooks.markDirty();
  }
}

export function makeEntitiesChangeLayerTool(): AiTool<ChangeLayerParams> {
  return {
    id: 'entities.changeLayer',
    title: 'Change Entity Layer',
    description: 'Move entities to a different layer. If the layer does not exist it will be created automatically.',
    category: 'entity',
    permissions: ['mutate:entities'],

    validate(action, ctx): AiToolValidationResult {
      const entities = ctx.resolveTarget(action.target);
      if (entities.length === 0) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'TARGET_EMPTY', severity: 'error', message: 'No visible entities match.' }],
          warnings: [],
        };
      }

      const { layer } = action.parameters;
      if (!layer || typeof layer !== 'string' || !layer.trim()) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'MISSING_LAYER', severity: 'error', message: 'A target layer name is required.' }],
          warnings: [],
        };
      }

      const warnings = [];
      if (!ctx.doc.activeFile.layers.has(layer)) {
        warnings.push({
          code: 'LAYER_WILL_BE_CREATED', severity: 'warning' as const,
          message: `Layer "${layer}" does not exist and will be created.`,
        });
      }

      return {
        ok: true, confidence: 1, affectedIds: entities.map(e => e.id),
        riskClass: 'safe', errors: [], warnings,
      };
    },

    compile(action, ctx): ICommand[] {
      const entities = ctx.resolveTarget(action.target);
      if (entities.length === 0) return [];

      const { layer } = action.parameters;
      const hooks = ctx.hooks;
      const file = ctx.doc.activeFile;
      const cmds: ICommand[] = [];

      if (!file.layers.has(layer)) {
        cmds.push(new AddLayerCmd(layer, file.layers, hooks));
      }

      cmds.push(new ModifyPropertiesCmd(
        entities, 'layer', layer,
        entities.map(e => ({ id: e.id, value: e.layer })),
        hooks,
      ));

      return cmds;
    },

    describe(action, affectedIds): string {
      return `Moved ${affectedIds.length} entit${affectedIds.length === 1 ? 'y' : 'ies'} to layer "${action.parameters.layer}".`;
    },
  };
}
