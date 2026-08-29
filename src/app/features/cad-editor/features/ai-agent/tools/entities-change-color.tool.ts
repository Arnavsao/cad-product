import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { CadAction } from '../models/ai-action.model';
import type { ICommand } from '../../../core/models/command.model';
import { ModifyPropertiesCmd } from '../../../core/models/command.model';

interface ChangeColorParams {
  /** ACI integer (1–255) or CSS hex string (#rrggbb). */
  color: number | string;
}

export function makeEntitiesChangeColorTool(): AiTool<ChangeColorParams> {
  return {
    id: 'entities.changeColor',
    title: 'Change Entity Color',
    description: 'Change the color of entities. color: ACI number (1=red,2=yellow,3=green,4=cyan,5=blue,6=magenta,7=white) or hex string.',
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

      const { color } = action.parameters;
      if (typeof color === 'number') {
        if (!Number.isInteger(color) || color < 0 || color > 256) {
          return {
            ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
            errors: [{ code: 'INVALID_COLOR', severity: 'error', message: 'ACI color must be an integer 0–256.' }],
            warnings: [],
          };
        }
      } else if (typeof color === 'string') {
        if (!/^#[0-9a-f]{6}$/i.test(color)) {
          return {
            ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
            errors: [{ code: 'INVALID_COLOR', severity: 'error', message: 'Color string must be a hex color like #ff0000.' }],
            warnings: [],
          };
        }
      } else {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'INVALID_COLOR', severity: 'error', message: 'color must be an ACI number or a hex string.' }],
          warnings: [],
        };
      }

      const warnings = [];
      const lockedCount = entities.filter(e => {
        const lay = ctx.doc.activeFile.layers.get(e.layer);
        return lay?.locked;
      }).length;
      if (lockedCount > 0) {
        warnings.push({
          code: 'LOCKED_LAYER_ENTITIES', severity: 'warning' as const,
          message: `${lockedCount} entities are on locked layers and will be skipped.`,
        });
      }

      return {
        ok: true, confidence: 1, affectedIds: entities.map(e => e.id),
        riskClass: 'safe', errors: [], warnings,
      };
    },

    compile(action, ctx): ICommand[] {
      const entities = ctx.resolveTarget(action.target).filter(e => {
        const lay = ctx.doc.activeFile.layers.get(e.layer);
        return !lay?.locked;
      });
      if (entities.length === 0) return [];

      const { color } = action.parameters;
      const hooks = ctx.hooks;
      const cmds: ICommand[] = [];

      if (typeof color === 'number') {
        // ACI: set colorNumber, clear any direct RGB override
        cmds.push(new ModifyPropertiesCmd(
          entities, 'colorNumber', color,
          entities.map(e => ({ id: e.id, value: e.colorNumber })),
          hooks,
        ));
        cmds.push(new ModifyPropertiesCmd(
          entities, 'color', null,
          entities.map(e => ({ id: e.id, value: e.color })),
          hooks,
        ));
      } else {
        // Hex: set direct color, keep colorNumber as BYLAYER (256)
        cmds.push(new ModifyPropertiesCmd(
          entities, 'color', color,
          entities.map(e => ({ id: e.id, value: e.color })),
          hooks,
        ));
      }

      return cmds;
    },

    describe(action, affectedIds): string {
      const c = action.parameters.color;
      const colorLabel = typeof c === 'number' ? `ACI ${c}` : c;
      return `Changed color of ${affectedIds.length} entit${affectedIds.length === 1 ? 'y' : 'ies'} to ${colorLabel}.`;
    },
  };
}
