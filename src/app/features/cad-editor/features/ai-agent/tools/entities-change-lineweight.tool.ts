import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { CadAction } from '../models/ai-action.model';
import type { ICommand } from '../../../core/models/command.model';
import { ModifyPropertiesCmd } from '../../../core/models/command.model';

interface ChangeLineweightParams {
  /**
   * DXF lineweight in hundredths of a millimeter.
   * Common values: 0=0mm, 5, 9, 13, 15, 18, 20, 25(=0.25mm), 30, 35, 40, 50, 53, 60, 70, 80, 100, 120, 140, 158, 200, 211.
   * Special: -1=BYLAYER, -2=BYBLOCK, -3=DEFAULT.
   */
  lineWeight: number;
}

const VALID_LINEWEIGHTS = new Set([
  -3, -2, -1, 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60,
  70, 80, 90, 100, 106, 120, 140, 158, 200, 211,
]);

export function makeEntitiesChangeLineweightTool(): AiTool<ChangeLineweightParams> {
  return {
    id: 'entities.changeLineweight',
    title: 'Change Entity Lineweight',
    description: 'Change the lineweight of entities. lineWeight is in hundredths of mm (e.g., 25 = 0.25mm). Use -1 for BYLAYER.',
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

      const { lineWeight } = action.parameters;
      if (!Number.isInteger(lineWeight)) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'INVALID_LINEWEIGHT', severity: 'error', message: 'lineWeight must be an integer.' }],
          warnings: [],
        };
      }

      const warnings = [];
      if (!VALID_LINEWEIGHTS.has(lineWeight)) {
        // Snap to nearest valid value.
        const nearest = [...VALID_LINEWEIGHTS].reduce((a, b) =>
          Math.abs(b - lineWeight) < Math.abs(a - lineWeight) ? b : a,
        );
        warnings.push({
          code: 'LINEWEIGHT_SNAPPED', severity: 'warning' as const,
          message: `Lineweight ${lineWeight} is not a standard DXF value. Will use ${nearest} instead.`,
          fix: `Use ${nearest}`,
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

      let { lineWeight } = action.parameters;
      // Snap to nearest valid
      if (!VALID_LINEWEIGHTS.has(lineWeight)) {
        lineWeight = [...VALID_LINEWEIGHTS].reduce((a, b) =>
          Math.abs(b - lineWeight) < Math.abs(a - lineWeight) ? b : a,
        );
      }

      return [new ModifyPropertiesCmd(
        entities, 'lineWeight', lineWeight,
        entities.map(e => ({ id: e.id, value: e.lineWeight })),
        ctx.hooks,
      )];
    },

    describe(action, affectedIds): string {
      const lw = action.parameters.lineWeight;
      const label = lw === -1 ? 'BYLAYER' : lw === -2 ? 'BYBLOCK' : lw === -3 ? 'DEFAULT' : `${lw / 100}mm`;
      return `Set lineweight to ${label} on ${affectedIds.length} entit${affectedIds.length === 1 ? 'y' : 'ies'}.`;
    },
  };
}
