import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand } from '../../../core/models/command.model';
import { PasteEntitiesCmd, CompoundCmd } from '../../../core/models/command.model';
import { Layer } from '../../../core/models/layer.model';
import { GenerationPlannerService } from '../services/generation-planner.service';
import { runLayoutValidation } from './views-intelligent-layout.tools';
import type { DetectedView } from '../models/ai-view.model';

interface GenerateParams {
  /** Free-text drawing goal, e.g. "box culvert GAD". */
  query: string;
  /** Overall parameters applied to the primary component family. */
  params?: Record<string, number | string | boolean>;
}

/**
 * generate.drawing — the Phase-5 multi-agent drawing generator.
 *
 * Planner → GenerationPlannerService picks a template & composes positioned
 *           geometry for every sub-view.
 * CAD     → component generators build the geometry (deterministic).
 * Layout  → sub-views are placed into the template grid up front.
 * Validate→ runLayoutValidation() runs on the generated sub-view bboxes; any
 *           hard error blocks the commit (the AI never ships a broken sheet).
 *
 * Everything commits as ONE CompoundCmd, so a single Ctrl+Z removes the whole
 * generated drawing.
 */
export function makeGenerateDrawingTool(planner: GenerationPlannerService): AiTool<GenerateParams> {
  return {
    id: 'generate.drawing',
    title: 'Generate Drawing',
    description: 'Generate a complete engineering drawing (GAD) from a description. Templates: box culvert GAD, retaining wall GAD, drainage layout. params apply to the primary component (e.g. clearWidth, clearHeight).',
    category: 'library',
    permissions: ['insert:library', 'mutate:layout'],

    validate(action, ctx): AiToolValidationResult {
      const { query } = action.parameters;
      if (!query || typeof query !== 'string') {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'MISSING_QUERY', severity: 'error', message: 'Describe the drawing to generate (e.g. "box culvert GAD").' }],
          warnings: [],
        };
      }

      const template = planner.findTemplate(query);
      if (!template) {
        const names = planner.templates.map(t => t.name).join(', ');
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'TEMPLATE_NOT_FOUND', severity: 'error', message: `No drawing template matches "${query}". Available: ${names}.` }],
          warnings: [],
        };
      }

      // Dry-run the generation to validate the resulting layout.
      const result = planner.generate(query, action.parameters.params ?? {});
      if (!result || result.entities.length === 0) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'GENERATION_FAILED', severity: 'error', message: 'The template produced no geometry.' }],
          warnings: [],
        };
      }

      // Validation-agent gate: check the generated sub-view layout.
      const pseudoViews: DetectedView[] = result.steps.map((s, i) => ({
        id: `gen_${i}`, label: s.title, bbox: s.bbox, entityIds: [],
      }));
      const report = runLayoutValidation(pseudoViews);
      const errors = report.issues
        .filter(i => i.severity === 'error')
        .map(i => ({ code: i.code, severity: 'error' as const, message: i.message }));

      if (errors.length > 0) {
        return { ok: false, confidence: 1, affectedIds: [], riskClass: 'review', errors, warnings: [] };
      }

      return {
        ok: true, confidence: 0.9, affectedIds: [], riskClass: 'review',
        errors: [],
        warnings: [{
          code: 'GENERATION_PREVIEW', severity: 'warning',
          message: `Will generate "${template.name}": ${result.viewCount} views, ${result.entities.length} entities. Review before applying.`,
        }],
      };
    },

    compile(action, ctx): ICommand[] {
      const result = planner.generate(action.parameters.query, action.parameters.params ?? {});
      if (!result || result.entities.length === 0) return [];

      const file = ctx.doc.activeFile;
      const cmds: ICommand[] = [];

      // Ensure all referenced layers exist (undoable).
      const layerNames = new Set(result.entities.map(e => e.layer));
      for (const name of layerNames) {
        if (!file.layers.has(name)) {
          const layerRef = file.layers;
          cmds.push({
            execute() { if (!layerRef.has(name)) layerRef.set(name, new Layer(name)); },
            undo() { layerRef.delete(name); },
          });
        }
      }

      // Paste the whole generated drawing in one shot.
      cmds.push(new PasteEntitiesCmd(result.entities, file, ctx.hooks));

      return [new CompoundCmd(cmds)];
    },

    describe(action, _ids): string {
      const result = planner.generate(action.parameters.query, action.parameters.params ?? {});
      if (!result) return `Generated drawing for "${action.parameters.query}".`;
      return `Generated "${result.template.name}" — ${result.viewCount} views, ${result.entities.length} entities.`;
    },
  };
}
