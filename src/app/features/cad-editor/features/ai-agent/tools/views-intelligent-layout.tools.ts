import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand } from '../../../core/models/command.model';
import type { DetectedView } from '../models/ai-view.model';
import type { IBBox } from '../../../core/models/entity.model';
import type { Entity } from '../../../core/models/entity.model';
import { TranslateEntitiesCmd } from '../shared/translate-entities.cmd';
import { CompoundCmd } from '../../../core/models/command.model';

// ── Shared helpers ────────────────────────────────────────────────────────────

const EPS = 1e-9;

function entitiesByIds(ids: number[], ctx: AiToolContext): Entity[] {
  const set = new Set(ids);
  return ctx.doc.activeFile.entities.filter(e => set.has(e.id));
}

// ── views.autoLayout ─────────────────────────────────────────────────────────
//
// Greedy shelf / skyline bin-packing:
//   1. Sort views by area descending (largest first — helps packing efficiency).
//   2. Walk views left-to-right per shelf; when a view doesn't fit on the
//      current shelf, open a new one below (with a gutter gap between shelves).
//   3. Once packed, translate the whole group so its top-left corner lands at
//      (originX, originY) — defaulting to the current group's own top-left so
//      the drawing doesn't jump away from the screen.
//   4. Every per-view translation becomes one TranslateEntitiesCmd; all wrap
//      in a single CompoundCmd → one Ctrl+Z undoes the whole reorganisation.

interface AutoLayoutParams {
  columns?: number;         // max views per row (0 = auto)
  gutterH?: number;         // horizontal gap between views (world units, default 5% of median width)
  gutterV?: number;         // vertical gap between shelves (same default)
  origin?: 'current' | 'zero';  // where to anchor the packed group
}

function autoGutter(views: DetectedView[]): number {
  const widths = views.map(v => v.bbox.w).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] || 1;
  return Math.max(median * 0.08, 10);
}

export function computeAutoLayout(
  views: DetectedView[],
  opts: AutoLayoutParams = {},
): { dx: number; dy: number; view: DetectedView }[] {
  if (views.length === 0) return [];

  const g = autoGutter(views);
  const gh = opts.gutterH ?? g;
  const gv = opts.gutterV ?? g;

  // Sort largest area first.
  const sorted = [...views].sort((a, b) => (b.bbox.w * b.bbox.h) - (a.bbox.w * a.bbox.h));

  // Auto-column count: √n rounded to nearest int, clamped between 1 and n.
  const n = sorted.length;
  const cols = Math.min(
    Math.max(1, opts.columns || Math.round(Math.sqrt(n))),
    n,
  );

  // Derive a row-width limit from the widest `cols` views.
  const rowWidth = sorted
    .slice(0, cols)
    .reduce((s, v) => s + v.bbox.w, 0) + gh * (cols - 1);

  // Greedy shelf packing.
  const moves: { dx: number; dy: number; view: DetectedView }[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let shelfH = 0;
  let colsInRow = 0;

  for (const v of sorted) {
    // Start new shelf if this view would exceed the row width OR column limit.
    if (colsInRow > 0 && (cursorX + v.bbox.w > rowWidth + EPS || colsInRow >= cols)) {
      cursorX = 0;
      cursorY -= shelfH + gv;
      shelfH = 0;
      colsInRow = 0;
    }

    const newX = cursorX;
    const newY = cursorY;
    moves.push({
      view: v,
      dx: newX - v.bbox.x,
      dy: newY - (v.bbox.y + v.bbox.h), // align top edges (world Y is up)
    });

    cursorX += v.bbox.w + gh;
    shelfH = Math.max(shelfH, v.bbox.h);
    colsInRow++;
  }

  // Shift so the packed group's top-left matches the original group's top-left.
  if (opts.origin !== 'zero') {
    const origMinX = Math.min(...views.map(v => v.bbox.x));
    const origMaxY = Math.max(...views.map(v => v.bbox.y + v.bbox.h));
    const packedMinX = Math.min(...moves.map(m => m.view.bbox.x + m.dx));
    const packedMaxY = Math.max(...moves.map(m => m.view.bbox.y + m.view.bbox.h + m.dy));
    const shiftX = origMinX - packedMinX;
    const shiftY = origMaxY - packedMaxY;
    for (const m of moves) {
      m.dx += shiftX;
      m.dy += shiftY;
    }
  }

  return moves;
}

export function makeViewsAutoLayoutTool(): AiTool<AutoLayoutParams> {
  return {
    id: 'views.autoLayout',
    title: 'Auto-Reorganize Views',
    description: 'Pack all detected views into a compact grid using shelf-packing. columns: max views per row (0 = auto). gutterH/gutterV: horizontal/vertical gap in drawing units.',
    category: 'layout',
    permissions: ['mutate:layout'],

    validate(action, ctx): AiToolValidationResult {
      const views = ctx.viewDetection.detect();
      if (views.length < 2) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'INSUFFICIENT_VIEWS', severity: 'error', message: `Need at least 2 views; detected ${views.length}.` }],
          warnings: [],
        };
      }
      const moves = computeAutoLayout(views, action.parameters);
      const affected = moves.filter(m => Math.abs(m.dx) > EPS || Math.abs(m.dy) > EPS)
        .flatMap(m => m.view.entityIds);
      return {
        ok: true, confidence: 1, affectedIds: affected,
        riskClass: 'review', errors: [],
        warnings: [{ code: 'AUTO_LAYOUT_PREVIEW', severity: 'warning', message: `Will reorganise ${views.length} views into a ${action.parameters.columns || 'auto'}-column grid. Preview before applying.` }],
      };
    },

    compile(action, ctx): ICommand[] {
      const views = ctx.viewDetection.detect();
      if (views.length < 2) return [];
      const moves = computeAutoLayout(views, action.parameters);
      const cmds: ICommand[] = [];
      for (const m of moves) {
        if (Math.abs(m.dx) < EPS && Math.abs(m.dy) < EPS) continue;
        const ents = entitiesByIds(m.view.entityIds, ctx);
        if (ents.length) cmds.push(new TranslateEntitiesCmd(ents, m.dx, m.dy, ctx.hooks));
      }
      return cmds.length <= 1 ? cmds : [new CompoundCmd(cmds)];
    },

    describe(_action, affectedIds): string {
      return `Auto-reorganized layout (${affectedIds.length} entities repositioned).`;
    },
  };
}

// ── views.center ──────────────────────────────────────────────────────────────
//
// Translate all views together so their combined bounding box is centred on
// (0, 0) in world space — or on a user-specified centre point.

interface CenterParams {
  cx?: number;   // target world X centre, default 0
  cy?: number;   // target world Y centre, default 0
}

export function makeViewsCenterTool(): AiTool<CenterParams> {
  return {
    id: 'views.center',
    title: 'Center All Views',
    description: 'Translate all detected views so their combined centre lands at (cx, cy) in world coordinates. Defaults to world origin (0,0).',
    category: 'layout',
    permissions: ['mutate:layout'],

    validate(action, ctx): AiToolValidationResult {
      const views = ctx.viewDetection.detect();
      if (views.length === 0) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'NO_VIEWS', severity: 'error', message: 'No views detected in the drawing.' }],
          warnings: [],
        };
      }
      const affected = views.flatMap(v => v.entityIds);
      return { ok: true, confidence: 1, affectedIds: affected, riskClass: 'review', errors: [], warnings: [] };
    },

    compile(action, ctx): ICommand[] {
      const views = ctx.viewDetection.detect();
      if (views.length === 0) return [];

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const v of views) {
        if (v.bbox.x < minX) minX = v.bbox.x;
        if (v.bbox.y < minY) minY = v.bbox.y;
        if (v.bbox.x + v.bbox.w > maxX) maxX = v.bbox.x + v.bbox.w;
        if (v.bbox.y + v.bbox.h > maxY) maxY = v.bbox.y + v.bbox.h;
      }

      const groupCx = (minX + maxX) / 2;
      const groupCy = (minY + maxY) / 2;
      const targetCx = action.parameters.cx ?? 0;
      const targetCy = action.parameters.cy ?? 0;
      const dx = targetCx - groupCx;
      const dy = targetCy - groupCy;

      if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return [];

      const cmds: ICommand[] = views.map(v => {
        const ents = entitiesByIds(v.entityIds, ctx);
        return new TranslateEntitiesCmd(ents, dx, dy, ctx.hooks);
      });

      return cmds.length <= 1 ? cmds : [new CompoundCmd(cmds)];
    },

    describe(_action, affectedIds): string {
      return `Centred all views (${affectedIds.length} entities repositioned).`;
    },
  };
}

// ── layout.validate ───────────────────────────────────────────────────────────
//
// Read-only standards checker — never modifies the drawing. Returns a
// structured report of overlaps, orphan views (too far from others), and
// suspicious spacing irregularities. The AI can present this as a "health
// check" result so the user knows what to fix.

export interface LayoutIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  viewIds?: string[];
}

export interface LayoutReport {
  viewCount: number;
  issues: LayoutIssue[];
  passed: boolean;
}

export function runLayoutValidation(views: DetectedView[]): LayoutReport {
  const issues: LayoutIssue[] = [];

  if (views.length === 0) {
    return { viewCount: 0, issues: [{ code: 'NO_VIEWS', severity: 'info', message: 'No views detected.' }], passed: true };
  }

  // 1. Overlap check.
  for (let i = 0; i < views.length; i++) {
    for (let j = i + 1; j < views.length; j++) {
      const a = views[i].bbox, b = views[j].bbox;
      const overlap =
        a.x < b.x + b.w && a.x + a.w > b.x &&
        a.y < b.y + b.h && a.y + a.h > b.y;
      if (overlap) {
        issues.push({
          code: 'OVERLAP', severity: 'error',
          message: `"${views[i].label}" overlaps with "${views[j].label}".`,
          viewIds: [views[i].id, views[j].id],
        });
      }
    }
  }

  // 2. Spacing consistency — flag if any inter-view gap deviates > 40% from the median.
  if (views.length >= 3) {
    const sorted = [...views].sort((a, b) => a.bbox.x - b.bbox.x);
    const hGaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].bbox.x - (sorted[i - 1].bbox.x + sorted[i - 1].bbox.w);
      if (gap > 0) hGaps.push(gap);
    }
    if (hGaps.length >= 2) {
      const median = hGaps.slice().sort((a, b) => a - b)[Math.floor(hGaps.length / 2)];
      for (let i = 0; i < hGaps.length; i++) {
        const ratio = hGaps[i] / median;
        if (ratio < 0.6 || ratio > 1.4) {
          issues.push({
            code: 'UNEVEN_SPACING', severity: 'warning',
            message: `Horizontal gap ${i + 1} (${Math.round(hGaps[i])} units) deviates from median (${Math.round(median)} units) by ${Math.round(Math.abs(ratio - 1) * 100)}%.`,
          });
        }
      }
    }
  }

  // 3. Unlabelled views.
  const unlabelled = views.filter(v => !v.label || /^View \d+$/.test(v.label));
  if (unlabelled.length > 0) {
    issues.push({
      code: 'UNLABELLED_VIEWS', severity: 'info',
      message: `${unlabelled.length} view(s) have no title text: ${unlabelled.map(v => v.label).join(', ')}.`,
      viewIds: unlabelled.map(v => v.id),
    });
  }

  const passed = issues.every(i => i.severity !== 'error');
  return { viewCount: views.length, issues, passed };
}

export function makeLayoutValidateTool(): AiTool {
  return {
    id: 'layout.validate',
    title: 'Validate Layout',
    description: 'Check the drawing layout for issues: overlapping views, uneven spacing, and unlabelled views. Read-only — does not modify the drawing.',
    category: 'layout',
    permissions: ['read'],
    noHistory: true,

    validate(_action, ctx): AiToolValidationResult {
      const views = ctx.viewDetection.detect();
      return {
        ok: true, confidence: 1, affectedIds: [],
        riskClass: 'safe', errors: [], warnings: [],
      };
    },

    compile(_action, ctx): ICommand[] {
      return [{
        execute() {
          const views = ctx.viewDetection.detect();
          const report = runLayoutValidation(views);
          ctx.layoutReport.set(report);
          ctx.hooks.markDirty();
        },
        undo() { ctx.layoutReport.clear(); },
      }];
    },

    describe(_action, _ids): string {
      return 'Layout validation complete.';
    },
  };
}
