import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand } from '../../../core/models/command.model';
import type { IBBox, Entity } from '../../../core/models/entity.model';

// ── Shared ────────────────────────────────────────────────────────────────────

/** Zoom the canvas viewport to fit a world-space bbox with padding. */
function zoomToBBox(ctx: AiToolContext, bbox: IBBox): void {
  const vm = ctx.vm;
  const pad = 60;
  const sW = vm.canvasWidth - pad * 2;
  const sH = vm.canvasHeight - pad * 2;
  if (bbox.w <= 0 || bbox.h <= 0 || sW <= 0 || sH <= 0) return;

  vm.scale = Math.min(sW / bbox.w, sH / bbox.h);
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  vm.panX = vm.canvasWidth / 2 - cx * vm.scale;
  vm.panY = vm.canvasHeight / 2 + cy * vm.scale;
  vm.markDirty();
  vm.markGridDirty();
}

// ── view.zoomTo ────────────────────────────────────────────────────────────────

interface ZoomParams { view: string; }

export function makeViewZoomToTool(): AiTool<ZoomParams> {
  return {
    id: 'view.zoomTo',
    title: 'Zoom to View',
    description: 'Pan and zoom the canvas to fit a detected view. Identify the view by label or keyword (top/bottom/left/right/first/last). Navigation only — not undoable.',
    category: 'navigation',
    permissions: ['navigate'],
    noHistory: true,

    validate(action, ctx): AiToolValidationResult {
      const { view } = action.parameters;
      if (!view || typeof view !== 'string') {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'MISSING_VIEW', severity: 'error', message: 'Specify which view to zoom to.' }],
          warnings: [],
        };
      }
      const detected = ctx.viewDetection.findView(view);
      if (!detected) {
        const all = ctx.viewDetection.detect();
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'VIEW_NOT_FOUND', severity: 'error', message: `No view matches "${view}". Detected: ${all.map(v => v.label).join(', ') || 'none'}.` }],
          warnings: [],
        };
      }
      return { ok: true, confidence: 1, affectedIds: [], riskClass: 'safe', errors: [], warnings: [] };
    },

    compile(action, ctx): ICommand[] {
      const detected = ctx.viewDetection.findView(action.parameters.view);
      if (!detected) return [];
      return [{
        execute() { zoomToBBox(ctx, detected.bbox); },
        undo() { /* navigation — not reversible via command stack */ },
      }];
    },

    describe(action, _ids): string {
      return `Zoomed to view "${action.parameters.view}".`;
    },
  };
}

// ── view.isolate ───────────────────────────────────────────────────────────────
//
// Hides every entity that is NOT part of the target view, then zooms to it.
// The hide is undoable (entity.visible toggled with before-state captured);
// the zoom is a navigation side-effect that runs in execute().

interface IsolateParams { view: string; }

export function makeViewIsolateTool(): AiTool<IsolateParams> {
  return {
    id: 'view.isolate',
    title: 'Isolate View',
    description: 'Hide everything except the named view and zoom to it. Undo restores visibility. Identify the view by label or keyword.',
    category: 'navigation',
    permissions: ['navigate', 'mutate:entities'],

    validate(action, ctx): AiToolValidationResult {
      const { view } = action.parameters;
      if (!view || typeof view !== 'string') {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'MISSING_VIEW', severity: 'error', message: 'Specify which view to isolate.' }],
          warnings: [],
        };
      }
      const detected = ctx.viewDetection.findView(view);
      if (!detected) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'VIEW_NOT_FOUND', severity: 'error', message: `No view matches "${view}".` }],
          warnings: [],
        };
      }
      return {
        ok: true, confidence: 1, affectedIds: detected.entityIds, riskClass: 'review',
        errors: [],
        warnings: [{ code: 'ISOLATE_HIDES_REST', severity: 'warning', message: `Hides all entities outside "${detected.label}". Use Undo to restore.` }],
      };
    },

    compile(action, ctx): ICommand[] {
      const detected = ctx.viewDetection.findView(action.parameters.view);
      if (!detected) return [];
      const keep = new Set(detected.entityIds);
      const file = ctx.doc.activeFile;
      const toHide: Entity[] = file.entities.filter(e => !keep.has(e.id) && e.visible);
      const hooks = ctx.hooks;

      return [{
        execute() {
          for (const e of toHide) e.visible = false;
          hooks.markDirty();
          zoomToBBox(ctx, detected.bbox);
        },
        undo() {
          for (const e of toHide) e.visible = true;
          hooks.markDirty();
        },
      }];
    },

    describe(action, _ids): string {
      return `Isolated view "${action.parameters.view}" (hid all other entities).`;
    },
  };
}
