import type { AiTool, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand } from '../../../core/models/command.model';
import { PasteEntitiesCmd, CompoundCmd } from '../../../core/models/command.model';
import { buildEntities, type DrawSpec } from '../shared/draw-spec';
import { ensureLayerCmds } from '../shared/ensure-layers.cmd';

export interface DrawGridParams {
  /** Origin (intersection of grid A/1), mm. */
  x: number;
  y: number;
  /** Bay widths along X (between successive lettered grids), mm. A number repeats. */
  xSpacings: number[] | number;
  /** Bay depths along Y (between successive numbered grids), mm. */
  ySpacings: number[] | number;
  /** How many bays when a single spacing number is given. */
  xCount?: number;
  yCount?: number;
  /** How far grid lines extend beyond the outermost grid, mm. Default 1500. */
  extension?: number;
  /** Bubble radius, mm. Default 400 (8 mm plotted at 1:100). */
  bubbleRadius?: number;
  /** Column size to draw at every intersection, mm. 0 or omitted = no columns. */
  columnSize?: number;
  layer?: string;
  columnLayer?: string;
}

function toList(v: number[] | number, count?: number): number[] | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    const c = count ?? 3;
    if (!Number.isInteger(c) || c < 1 || c > 60) return null;
    return Array(c).fill(v);
  }
  if (!Array.isArray(v) || v.length < 1 || v.length > 60) return null;
  return v.every(s => Number.isFinite(s) && s > 0) ? v : null;
}

function letter(i: number): string {
  // A..Z, then AA, AB… (skip I and O like most offices do).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  let k = i;
  do { s = alphabet[k % alphabet.length] + s; k = Math.floor(k / alphabet.length) - 1; } while (k >= 0);
  return s;
}

/** Deterministic grid geometry. Exported for tests. */
export function buildGridSpecs(p: DrawGridParams): DrawSpec[] | null {
  const xs = toList(p.xSpacings, p.xCount);
  const ys = toList(p.ySpacings, p.yCount);
  if (!xs || !ys || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const layer = p.layer ?? 'S-GRID';
  const colLayer = p.columnLayer ?? 'S-COLS';
  const ext = p.extension ?? 1500;
  const r = p.bubbleRadius ?? 400;
  const xPos = xs.reduce<number[]>((acc, s) => [...acc, acc[acc.length - 1] + s], [p.x]);
  const yPos = ys.reduce<number[]>((acc, s) => [...acc, acc[acc.length - 1] + s], [p.y]);
  const x0 = xPos[0] - ext, x1 = xPos[xPos.length - 1] + ext;
  const y0 = yPos[0] - ext, y1 = yPos[yPos.length - 1] + ext;
  const specs: DrawSpec[] = [];

  xPos.forEach((gx, i) => {
    specs.push({ type: 'line', x1: gx, y1: y0, x2: gx, y2: y1, layer, lineType: 'CENTER', lineWeight: 18 });
    const by = y1 + r;
    specs.push({ type: 'circle', cx: gx, cy: by, r, layer, lineWeight: 25 });
    specs.push({ type: 'text', x: gx, y: by, text: letter(i), height: r * 1.1, justify: 'MC', layer });
  });
  yPos.forEach((gy, j) => {
    specs.push({ type: 'line', x1: x0, y1: gy, x2: x1, y2: gy, layer, lineType: 'CENTER', lineWeight: 18 });
    const bx = x0 - r;
    specs.push({ type: 'circle', cx: bx, cy: gy, r, layer, lineWeight: 25 });
    specs.push({ type: 'text', x: bx, y: gy, text: String(j + 1), height: r * 1.1, justify: 'MC', layer });
  });

  if (p.columnSize && Number.isFinite(p.columnSize) && p.columnSize > 0) {
    const c = p.columnSize;
    for (const gx of xPos) {
      for (const gy of yPos) {
        specs.push({ type: 'rect', x: gx - c / 2, y: gy - c / 2, w: c, h: c, layer: colLayer, lineWeight: 50 });
        specs.push({ type: 'hatch', points: [
          { x: gx - c / 2, y: gy - c / 2 }, { x: gx + c / 2, y: gy - c / 2 },
          { x: gx + c / 2, y: gy + c / 2 }, { x: gx - c / 2, y: gy + c / 2 },
        ], pattern: 'SOLID', layer: colLayer });
      }
    }
  }
  return specs;
}

export function makeDrawGridTool(): AiTool<DrawGridParams> {
  return {
    id: 'draw.grid',
    title: 'Draw Column Grid',
    description:
      'Draw a structural column grid: CENTER-linetype grid lines, lettered bubbles (A,B,C…) along the top, numbered bubbles (1,2,3…) down the left, optional square columns at every intersection. ' +
      'parameters: {x, y (origin = grid A/1), xSpacings: number|number[], ySpacings: number|number[], xCount?, yCount?, extension? (1500), bubbleRadius? (400), columnSize?, layer? (S-GRID), columnLayer? (S-COLS)}. ' +
      'A single spacing plus count repeats it (xSpacings: 6000, xCount: 4 → grids A–E). All mm.',
    category: 'entity',
    permissions: ['mutate:entities'],

    validate(action, ctx): AiToolValidationResult {
      const specs = buildGridSpecs(action.parameters ?? ({} as DrawGridParams));
      if (!specs) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'safe',
          errors: [{ code: 'INVALID_GRID', severity: 'error', message: 'Provide x, y and positive xSpacings/ySpacings (a number with a count, or an array of bay sizes) in millimetres, at most 60 bays each way.' }],
          warnings: [],
        };
      }
      const layers = new Set(specs.map(s => s.layer!).filter(l => !ctx.doc.activeFile.layers.has(l)));
      const warnings = layers.size
        ? [{ code: 'LAYERS_CREATED', severity: 'warning' as const, message: `Will create layers ${[...layers].join(', ')}.` }]
        : [];
      return { ok: true, confidence: 0.95, affectedIds: [], riskClass: specs.length > 200 ? 'review' : 'safe', errors: [], warnings };
    },

    compile(action, ctx): ICommand[] {
      const specs = buildGridSpecs(action.parameters);
      if (!specs) return [];
      const file = ctx.doc.activeFile;
      const entities = buildEntities(specs, ctx.doc.activeLayerName);
      return [new CompoundCmd([...ensureLayerCmds(entities, file), new PasteEntitiesCmd(entities, file, ctx.hooks)])];
    },

    describe(action): string {
      const p = action.parameters;
      const nx = (toList(p.xSpacings, p.xCount)?.length ?? 0) + 1;
      const ny = (toList(p.ySpacings, p.yCount)?.length ?? 0) + 1;
      return `Drew a ${nx} × ${ny} column grid${p.columnSize ? ` with ${nx * ny} columns` : ''}.`;
    },
  };
}
