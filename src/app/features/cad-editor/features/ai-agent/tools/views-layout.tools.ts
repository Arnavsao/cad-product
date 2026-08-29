import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand } from '../../../core/models/command.model';
import type { Entity } from '../../../core/models/entity.model';
import type { DetectedView } from '../models/ai-view.model';
import type { ValidationIssue } from '../models/ai-action.model';
import { TranslateEntitiesCmd } from '../shared/translate-entities.cmd';

// ── Shared helpers ────────────────────────────────────────────────────────────

interface ViewMove { view: DetectedView; dx: number; dy: number; }

type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'centerx' | 'centery';
type Axis = 'horizontal' | 'vertical';

const EPS = 1e-9;

function entitiesByIds(ids: number[], ctx: AiToolContext): Entity[] {
  const set = new Set(ids);
  return ctx.doc.activeFile.entities.filter(e => set.has(e.id));
}

/** Build TranslateEntitiesCmd[] from a set of per-view deltas. Router compounds them. */
function buildMoveCommands(moves: ViewMove[], ctx: AiToolContext): ICommand[] {
  const cmds: ICommand[] = [];
  for (const m of moves) {
    if (Math.abs(m.dx) < EPS && Math.abs(m.dy) < EPS) continue;
    const ents = entitiesByIds(m.view.entityIds, ctx);
    if (ents.length) cmds.push(new TranslateEntitiesCmd(ents, m.dx, m.dy, ctx.hooks));
  }
  return cmds;
}

function affectedFromMoves(moves: ViewMove[]): number[] {
  const out: number[] = [];
  for (const m of moves) {
    if (Math.abs(m.dx) < EPS && Math.abs(m.dy) < EPS) continue;
    out.push(...m.view.entityIds);
  }
  return out;
}

// ── Layout math (pure) ────────────────────────────────────────────────────────

function computeAlign(views: DetectedView[], edge: AlignEdge): ViewMove[] {
  const cx = (v: DetectedView) => v.bbox.x + v.bbox.w / 2;
  const cy = (v: DetectedView) => v.bbox.y + v.bbox.h / 2;

  let target: number;
  switch (edge) {
    case 'left': target = Math.min(...views.map(v => v.bbox.x)); break;
    case 'right': target = Math.max(...views.map(v => v.bbox.x + v.bbox.w)); break;
    case 'centerx': target = views.reduce((s, v) => s + cx(v), 0) / views.length; break;
    case 'top': target = Math.max(...views.map(v => v.bbox.y + v.bbox.h)); break;
    case 'bottom': target = Math.min(...views.map(v => v.bbox.y)); break;
    case 'centery': target = views.reduce((s, v) => s + cy(v), 0) / views.length; break;
  }

  return views.map(v => {
    switch (edge) {
      case 'left': return { view: v, dx: target - v.bbox.x, dy: 0 };
      case 'right': return { view: v, dx: target - (v.bbox.x + v.bbox.w), dy: 0 };
      case 'centerx': return { view: v, dx: target - cx(v), dy: 0 };
      case 'top': return { view: v, dx: 0, dy: target - (v.bbox.y + v.bbox.h) };
      case 'bottom': return { view: v, dx: 0, dy: target - v.bbox.y };
      case 'centery': return { view: v, dx: 0, dy: target - cy(v) };
    }
  });
}

function computeDistribute(views: DetectedView[], axis: Axis): ViewMove[] {
  const horizontal = axis === 'horizontal';
  const pos = (v: DetectedView) => horizontal ? v.bbox.x : v.bbox.y;
  const size = (v: DetectedView) => horizontal ? v.bbox.w : v.bbox.h;

  const sorted = [...views].sort((a, b) => pos(a) - pos(b));
  const n = sorted.length;
  const spanStart = pos(sorted[0]);
  const spanEnd = pos(sorted[n - 1]) + size(sorted[n - 1]);
  const totalSize = sorted.reduce((s, v) => s + size(v), 0);
  const gap = (spanEnd - spanStart - totalSize) / (n - 1);

  const moves: ViewMove[] = [];
  let cursor = spanStart;
  for (const v of sorted) {
    const newPos = cursor;
    const delta = newPos - pos(v);
    moves.push(horizontal ? { view: v, dx: delta, dy: 0 } : { view: v, dx: 0, dy: delta });
    cursor += size(v) + gap;
  }
  return moves;
}

function computeSpace(views: DetectedView[], axis: Axis, spacing: number): ViewMove[] {
  const horizontal = axis === 'horizontal';
  const pos = (v: DetectedView) => horizontal ? v.bbox.x : v.bbox.y;
  const size = (v: DetectedView) => horizontal ? v.bbox.w : v.bbox.h;

  const sorted = [...views].sort((a, b) => pos(a) - pos(b));
  const moves: ViewMove[] = [];
  let cursor = pos(sorted[0]) + size(sorted[0]); // first view stays put
  moves.push(horizontal ? { view: sorted[0], dx: 0, dy: 0 } : { view: sorted[0], dx: 0, dy: 0 });

  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i];
    const newPos = cursor + spacing;
    const delta = newPos - pos(v);
    moves.push(horizontal ? { view: v, dx: delta, dy: 0 } : { view: v, dx: 0, dy: delta });
    cursor = newPos + size(v);
  }
  return moves;
}

function emptyViewsError(detected: DetectedView[], min: number): ValidationIssue {
  return {
    code: 'INSUFFICIENT_VIEWS', severity: 'error',
    message: `Need at least ${min} views to do this, but detected ${detected.length}.`,
  };
}

// ── Tools ─────────────────────────────────────────────────────────────────────

interface AlignParams { edge: AlignEdge; }

export function makeViewsAlignTool(): AiTool<AlignParams> {
  return {
    id: 'views.align',
    title: 'Align Views',
    description: 'Align all detected views by an edge: left, right, top, bottom, centerx (vertical center line), or centery (horizontal center line).',
    category: 'layout',
    permissions: ['mutate:layout'],

    validate(action, ctx): AiToolValidationResult {
      const views = ctx.viewDetection.detect();
      const validEdges: AlignEdge[] = ['left', 'right', 'top', 'bottom', 'centerx', 'centery'];
      if (!validEdges.includes(action.parameters.edge)) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'INVALID_EDGE', severity: 'error', message: `edge must be one of: ${validEdges.join(', ')}.` }],
          warnings: [],
        };
      }
      if (views.length < 2) {
        return { ok: false, confidence: 1, affectedIds: [], riskClass: 'review', errors: [emptyViewsError(views, 2)], warnings: [] };
      }
      const moves = computeAlign(views, action.parameters.edge);
      return { ok: true, confidence: 1, affectedIds: affectedFromMoves(moves), riskClass: 'review', errors: [], warnings: [] };
    },

    compile(action, ctx): ICommand[] {
      const views = ctx.viewDetection.detect();
      if (views.length < 2) return [];
      return buildMoveCommands(computeAlign(views, action.parameters.edge), ctx);
    },

    describe(action, affectedIds): string {
      return `Aligned views to ${action.parameters.edge} (${affectedIds.length} entities moved).`;
    },
  };
}

interface DistributeParams { axis: Axis; }

export function makeViewsDistributeTool(): AiTool<DistributeParams> {
  return {
    id: 'views.distribute',
    title: 'Distribute Views',
    description: 'Distribute all detected views evenly along an axis: horizontal or vertical. First and last views stay fixed.',
    category: 'layout',
    permissions: ['mutate:layout'],

    validate(action, ctx): AiToolValidationResult {
      const views = ctx.viewDetection.detect();
      if (action.parameters.axis !== 'horizontal' && action.parameters.axis !== 'vertical') {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'INVALID_AXIS', severity: 'error', message: 'axis must be "horizontal" or "vertical".' }],
          warnings: [],
        };
      }
      if (views.length < 3) {
        return { ok: false, confidence: 1, affectedIds: [], riskClass: 'review', errors: [emptyViewsError(views, 3)], warnings: [] };
      }
      const moves = computeDistribute(views, action.parameters.axis);
      return { ok: true, confidence: 1, affectedIds: affectedFromMoves(moves), riskClass: 'review', errors: [], warnings: [] };
    },

    compile(action, ctx): ICommand[] {
      const views = ctx.viewDetection.detect();
      if (views.length < 3) return [];
      return buildMoveCommands(computeDistribute(views, action.parameters.axis), ctx);
    },

    describe(action, affectedIds): string {
      return `Distributed views ${action.parameters.axis}ly (${affectedIds.length} entities moved).`;
    },
  };
}

interface SpaceParams { axis: Axis; spacing: number; }

export function makeViewsSpaceTool(): AiTool<SpaceParams> {
  return {
    id: 'views.space',
    title: 'Set View Spacing',
    description: 'Set a fixed gap between consecutive views along an axis (horizontal or vertical). spacing is in drawing units. First view stays fixed.',
    category: 'layout',
    permissions: ['mutate:layout'],

    validate(action, ctx): AiToolValidationResult {
      const views = ctx.viewDetection.detect();
      if (action.parameters.axis !== 'horizontal' && action.parameters.axis !== 'vertical') {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'INVALID_AXIS', severity: 'error', message: 'axis must be "horizontal" or "vertical".' }],
          warnings: [],
        };
      }
      if (typeof action.parameters.spacing !== 'number' || action.parameters.spacing < 0) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'INVALID_SPACING', severity: 'error', message: 'spacing must be a non-negative number.' }],
          warnings: [],
        };
      }
      if (views.length < 2) {
        return { ok: false, confidence: 1, affectedIds: [], riskClass: 'review', errors: [emptyViewsError(views, 2)], warnings: [] };
      }
      const moves = computeSpace(views, action.parameters.axis, action.parameters.spacing);
      return { ok: true, confidence: 1, affectedIds: affectedFromMoves(moves), riskClass: 'review', errors: [], warnings: [] };
    },

    compile(action, ctx): ICommand[] {
      const views = ctx.viewDetection.detect();
      if (views.length < 2) return [];
      return buildMoveCommands(computeSpace(views, action.parameters.axis, action.parameters.spacing), ctx);
    },

    describe(action, affectedIds): string {
      return `Set ${action.parameters.axis} spacing to ${action.parameters.spacing} (${affectedIds.length} entities moved).`;
    },
  };
}
