import type { AiTool, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand } from '../../../core/models/command.model';
import { PasteEntitiesCmd, CompoundCmd } from '../../../core/models/command.model';
import { buildEntities, validateSpecs, type DrawSpec, DRAW_SPEC_TYPES } from '../shared/draw-spec';
import { ensureLayerCmds } from '../shared/ensure-layers.cmd';

export interface DrawEntitiesParams {
  /** Primitives to add, in world millimetres. */
  entities: DrawSpec[];
  /** Layer used by specs that do not name one. Defaults to the active layer. */
  layer?: string;
}

/** Above this many primitives the plan is shown for review before it commits. */
const REVIEW_THRESHOLD = 25;
const HARD_CAP = 600;

/**
 * draw.entities — the model's pencil. Any shape the other tools do not cover
 * (furniture, fixtures, road edges, symbols, sketches) arrives as a flat list
 * of primitives, is validated structurally, and commits as ONE undo step.
 */
export function makeDrawEntitiesTool(): AiTool<DrawEntitiesParams> {
  return {
    id: 'draw.entities',
    title: 'Draw Entities',
    description:
      `Draw new geometry from a list of primitives (world mm, y up, angles in degrees). parameters: {entities:[...], layer?}. ` +
      `Each entity is one of: {type:"line",x1,y1,x2,y2} | {type:"polyline",points:[{x,y}],closed?} | {type:"rect",x,y,w,h} (x,y = bottom-left) | ` +
      `{type:"circle",cx,cy,r} | {type:"arc",cx,cy,r,startAngle,endAngle} | {type:"ellipse",cx,cy,rx,ry,rotation?} | ` +
      `{type:"text",x,y,text,height?,rotation?,justify?:"MC"|"BL"|...} | {type:"hatch",points:[{x,y}],pattern?:"ANSI31"|"SOLID"|"EARTH"|...,scale?,angle?} | ` +
      `{type:"dimension",x1,y1,x2,y2,offset?}. Every entity may carry layer, color (ACI or "#rrggbb"), lineType, lineWeight (hundredths mm). ` +
      `Use for furniture, fixtures, symbols, road edges, sketches — anything draw.room, draw.grid, library.insert and generate.drawing do not cover.`,
    category: 'entity',
    permissions: ['mutate:entities'],

    validate(action, ctx): AiToolValidationResult {
      const { ok, issues } = validateSpecs(action.parameters?.entities);
      const fail = (code: string, message: string): AiToolValidationResult => ({
        ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
        errors: [{ code, severity: 'error', message }], warnings: [],
      });

      if (issues.length && issues[0].index === -1) return fail('MISSING_ENTITIES', 'Provide an "entities" array of primitives to draw.');
      if (ok.length === 0) {
        const detail = issues.slice(0, 3).map(i => `#${i.index}: ${i.message}`).join('; ');
        return fail('NO_VALID_ENTITIES', `Nothing valid to draw. ${detail || `Allowed types: ${DRAW_SPEC_TYPES.join(', ')}.`}`);
      }
      if (ok.length > HARD_CAP) return fail('TOO_MANY_ENTITIES', `That is ${ok.length} primitives; keep a single command under ${HARD_CAP}.`);

      const warnings = issues.slice(0, 5).map(i => ({
        code: 'SPEC_SKIPPED', severity: 'warning' as const, message: `Skipped primitive #${i.index}: ${i.message}.`,
      }));
      const layer = action.parameters.layer ?? ctx.doc.activeLayerName;
      const newLayers = new Set<string>();
      for (const s of ok) {
        const l = (s.layer && s.layer.trim()) || layer;
        if (!ctx.doc.activeFile.layers.has(l)) newLayers.add(l);
      }
      if (newLayers.size) {
        warnings.push({ code: 'LAYERS_CREATED', severity: 'warning', message: `Will create layer${newLayers.size > 1 ? 's' : ''} ${[...newLayers].join(', ')}.` });
      }
      const lockedTarget = ctx.doc.activeFile.layers.get(layer)?.locked;
      if (lockedTarget) return fail('LAYER_LOCKED', `Layer ${layer} is locked. Unlock it or draw on another layer.`);

      return {
        ok: true, confidence: 0.95, affectedIds: [],
        riskClass: ok.length > REVIEW_THRESHOLD ? 'review' : 'safe',
        errors: [], warnings,
      };
    },

    compile(action, ctx): ICommand[] {
      const { ok } = validateSpecs(action.parameters?.entities);
      const file = ctx.doc.activeFile;
      const entities = buildEntities(ok, action.parameters.layer ?? ctx.doc.activeLayerName)
        .filter(e => !file.layers.get(e.layer)?.locked);
      if (!entities.length) return [];
      return [new CompoundCmd([...ensureLayerCmds(entities, file), new PasteEntitiesCmd(entities, file, ctx.hooks)])];
    },

    describe(action): string {
      const { ok } = validateSpecs(action.parameters?.entities);
      const byType = new Map<string, number>();
      for (const s of ok) byType.set(s.type, (byType.get(s.type) ?? 0) + 1);
      const parts = [...byType].map(([t, n]) => `${n} ${t}${n === 1 ? '' : 's'}`);
      return `Drew ${parts.join(', ') || 'nothing'}.`;
    },
  };
}
