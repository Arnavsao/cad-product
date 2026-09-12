import type { AiTool, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand } from '../../../core/models/command.model';
import { PasteEntitiesCmd, CompoundCmd } from '../../../core/models/command.model';
import type { Entity, IPoint } from '../../../core/models/entity.model';
import { buildEntities, type DrawSpec } from '../shared/draw-spec';
import { ensureLayerCmds } from '../shared/ensure-layers.cmd';

export type WallSide = 'N' | 'S' | 'E' | 'W';

export interface RoomOpening {
  /** Wall the opening sits in. */
  wall: WallSide;
  /** Distance from the wall's start corner (W→E for N/S walls, S→N for E/W walls) to the opening's near jamb, mm. */
  offset: number;
  /** Clear opening width, mm. */
  width: number;
  /** Doors only: which side of the wall the leaf swings into. Default 'in'. */
  swing?: 'in' | 'out';
  /** Doors only: hinge at the start-corner jamb ('start', default) or the far jamb ('end'). */
  hinge?: 'start' | 'end';
}

export interface DrawRoomParams {
  /** Room name for the label (e.g. "BEDROOM 1"). */
  name?: string;
  /** Bottom-left corner of the INTERNAL clear space, mm. */
  x: number;
  y: number;
  /** Internal clear width (X) and depth (Y), mm. */
  width: number;
  depth: number;
  /** Wall thickness, mm. Default 230. */
  wallThickness?: number;
  doors?: RoomOpening[];
  windows?: RoomOpening[];
  /** Model-space text height for the label. Default 350 (3.5 mm at 1:100). */
  textHeight?: number;
  /** Add overall dimensions outside the walls. Default false. */
  dimensions?: boolean;
  /** Layer overrides. */
  wallLayer?: string;
  doorLayer?: string;
  windowLayer?: string;
  textLayer?: string;
}

interface Segment { a: IPoint; b: IPoint; }

function n(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Start point, direction and outward normal of the wall centreline side `w`. */
function wallFrame(p: DrawRoomParams, w: WallSide): { start: IPoint; dir: IPoint; out: IPoint; length: number } {
  const { x, y, width, depth } = p;
  switch (w) {
    case 'S': return { start: { x, y }, dir: { x: 1, y: 0 }, out: { x: 0, y: -1 }, length: width };
    case 'N': return { start: { x, y: y + depth }, dir: { x: 1, y: 0 }, out: { x: 0, y: 1 }, length: width };
    case 'W': return { start: { x, y }, dir: { x: 0, y: 1 }, out: { x: -1, y: 0 }, length: depth };
    case 'E': return { start: { x: x + width, y }, dir: { x: 0, y: 1 }, out: { x: 1, y: 0 }, length: depth };
  }
}

/** Split a straight wall face into segments, dropping the opening spans. */
function splitFace(start: IPoint, dir: IPoint, length: number, gaps: Array<[number, number]>): Segment[] {
  const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
  const segs: Segment[] = [];
  let cursor = 0;
  const at = (t: number): IPoint => ({ x: start.x + dir.x * t, y: start.y + dir.y * t });
  for (const [g0, g1] of sorted) {
    if (g0 > cursor) segs.push({ a: at(cursor), b: at(g0) });
    cursor = Math.max(cursor, g1);
  }
  if (cursor < length) segs.push({ a: at(cursor), b: at(length) });
  return segs;
}

/** Deterministic room geometry. Exported for tests. */
export function buildRoomSpecs(p: DrawRoomParams): DrawSpec[] {
  const t = p.wallThickness ?? 230;
  const wallLayer = p.wallLayer ?? 'A-WALL';
  const doorLayer = p.doorLayer ?? 'A-DOOR';
  const windowLayer = p.windowLayer ?? 'A-GLAZ';
  const textLayer = p.textLayer ?? 'A-ANNO-TEXT';
  const specs: DrawSpec[] = [];
  const doors = (p.doors ?? []).filter(o => n(o.offset) && n(o.width) && o.width > 0);
  const windows = (p.windows ?? []).filter(o => n(o.offset) && n(o.width) && o.width > 0);
  const gapsFor = (w: WallSide): Array<[number, number]> =>
    [...doors, ...windows].filter(o => o.wall === w).map(o => [o.offset, o.offset + o.width]);

  // Wall faces: inner face at the clear line, outer face offset by t. The
  // outer face runs the full extent including corners so corners close.
  for (const side of ['S', 'N', 'W', 'E'] as WallSide[]) {
    const f = wallFrame(p, side);
    const gaps = gapsFor(side);
    const outerStart = {
      x: f.start.x + f.out.x * t - f.dir.x * t,
      y: f.start.y + f.out.y * t - f.dir.y * t,
    };
    for (const s of splitFace(f.start, f.dir, f.length, gaps)) {
      specs.push({ type: 'line', x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y, layer: wallLayer, lineWeight: 50 });
    }
    for (const s of splitFace(outerStart, f.dir, f.length + 2 * t, gaps.map(([a, b]) => [a + t, b + t] as [number, number]))) {
      specs.push({ type: 'line', x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y, layer: wallLayer, lineWeight: 50 });
    }
    // Jamb returns across the wall thickness at each opening.
    for (const [g0, g1] of gaps) {
      for (const g of [g0, g1]) {
        const a = { x: f.start.x + f.dir.x * g, y: f.start.y + f.dir.y * g };
        specs.push({ type: 'line', x1: a.x, y1: a.y, x2: a.x + f.out.x * t, y2: a.y + f.out.y * t, layer: wallLayer, lineWeight: 50 });
      }
    }
  }

  // Doors: leaf line from the hinge jamb + 90° swing arc.
  for (const d of doors) {
    const f = wallFrame(p, d.wall);
    const hingeT = (d.hinge ?? 'start') === 'start' ? d.offset : d.offset + d.width;
    const hinge = { x: f.start.x + f.dir.x * hingeT, y: f.start.y + f.dir.y * hingeT };
    const inward = (d.swing ?? 'in') === 'in' ? { x: -f.out.x, y: -f.out.y } : { x: f.out.x, y: f.out.y };
    // The hinge sits on the face the leaf swings from.
    const faceShift = (d.swing ?? 'in') === 'in' ? 0 : t;
    const h = { x: hinge.x + f.out.x * faceShift, y: hinge.y + f.out.y * faceShift };
    const leafEnd = { x: h.x + inward.x * d.width, y: h.y + inward.y * d.width };
    specs.push({ type: 'line', x1: h.x, y1: h.y, x2: leafEnd.x, y2: leafEnd.y, layer: doorLayer, lineWeight: 25 });
    const towardFar = (d.hinge ?? 'start') === 'start' ? { x: f.dir.x, y: f.dir.y } : { x: -f.dir.x, y: -f.dir.y };
    const a0 = (Math.atan2(towardFar.y, towardFar.x) * 180) / Math.PI;
    const a1 = (Math.atan2(inward.y, inward.x) * 180) / Math.PI;
    // Sweep the short way from the closed position to the open leaf.
    const ccw = (((a1 - a0) % 360) + 360) % 360 <= 180;
    specs.push({
      type: 'arc', cx: h.x, cy: h.y, r: d.width,
      startAngle: ccw ? a0 : a1, endAngle: ccw ? a1 : a0,
      layer: doorLayer, lineWeight: 13,
    });
  }

  // Windows: frame lines on both faces + a glazing line mid-wall.
  for (const w of windows) {
    const f = wallFrame(p, w.wall);
    const a = { x: f.start.x + f.dir.x * w.offset, y: f.start.y + f.dir.y * w.offset };
    const b = { x: a.x + f.dir.x * w.width, y: a.y + f.dir.y * w.width };
    for (const k of [0, 0.5, 1]) {
      const sx = f.out.x * t * k, sy = f.out.y * t * k;
      specs.push({
        type: 'line', x1: a.x + sx, y1: a.y + sy, x2: b.x + sx, y2: b.y + sy,
        layer: windowLayer, lineWeight: k === 0.5 ? 13 : 25,
      });
    }
  }

  // Label: name + area.
  const th = p.textHeight ?? 350;
  const cx = p.x + p.width / 2, cy = p.y + p.depth / 2;
  const area = (p.width * p.depth) / 1e6;
  if (p.name && p.name.trim()) {
    specs.push({ type: 'text', x: cx, y: cy + th * 0.5, text: p.name.trim().toUpperCase(), height: th, justify: 'MC', layer: textLayer });
    specs.push({ type: 'text', x: cx, y: cy - th * 0.7, text: `${area.toFixed(2)} m²`, height: th * 0.7, justify: 'MC', layer: textLayer });
  } else {
    specs.push({ type: 'text', x: cx, y: cy, text: `${area.toFixed(2)} m²`, height: th * 0.7, justify: 'MC', layer: textLayer });
  }

  if (p.dimensions) {
    const off = th * 2.5;
    specs.push({ type: 'dimension', x1: p.x, y1: p.y - t, x2: p.x + p.width, y2: p.y - t, offset: off, layer: 'A-ANNO-DIMS' });
    specs.push({ type: 'dimension', x1: p.x + p.width + t, y1: p.y, x2: p.x + p.width + t, y2: p.y + p.depth, offset: off, layer: 'A-ANNO-DIMS' });
  }

  return specs;
}

export function makeDrawRoomTool(): AiTool<DrawRoomParams> {
  const validateParams = (p: DrawRoomParams): string | null => {
    if (!p || ![p.x, p.y, p.width, p.depth].every(n)) return 'Provide x, y (bottom-left of the clear space), width and depth in millimetres.';
    if (p.width <= 0 || p.depth <= 0) return 'Room width and depth must be positive.';
    if (p.wallThickness !== undefined && !(n(p.wallThickness) && p.wallThickness > 0)) return 'wallThickness must be a positive number of millimetres.';
    for (const o of [...(p.doors ?? []), ...(p.windows ?? [])]) {
      if (!['N', 'S', 'E', 'W'].includes(o.wall)) return `Opening wall must be N, S, E or W (got "${o.wall}").`;
      const len = o.wall === 'N' || o.wall === 'S' ? p.width : p.depth;
      if (!n(o.offset) || !n(o.width) || o.offset < 0 || o.width <= 0 || o.offset + o.width > len) {
        return `Opening on wall ${o.wall} (offset ${o.offset}, width ${o.width}) does not fit inside a ${len} mm wall.`;
      }
    }
    return null;
  };

  return {
    id: 'draw.room',
    title: 'Draw Room',
    description:
      'Draw a rectangular walled room in plan: double-line walls with closed corners, door openings with leaf + swing arc, windows with glazing line, a centred name/area label, optional overall dimensions. ' +
      'parameters: {name?, x, y, width, depth, wallThickness? (230), doors?:[{wall:"N"|"S"|"E"|"W", offset, width, swing?:"in"|"out", hinge?:"start"|"end"}], windows?:[{wall, offset, width}], dimensions?, textHeight? (350)}. ' +
      'x,y is the bottom-left corner of the INTERNAL clear space; offsets run W→E on N/S walls and S→N on E/W walls. Adjacent rooms share a wall: place the next room at x + width + wallThickness. All mm.',
    category: 'entity',
    permissions: ['mutate:entities'],

    validate(action, ctx): AiToolValidationResult {
      const msg = validateParams(action.parameters);
      if (msg) {
        return { ok: false, confidence: 1, affectedIds: [], riskClass: 'safe', errors: [{ code: 'INVALID_ROOM', severity: 'error', message: msg }], warnings: [] };
      }
      const specs = buildRoomSpecs(action.parameters);
      const layers = new Set(specs.map(s => s.layer!).filter(l => !ctx.doc.activeFile.layers.has(l)));
      const warnings = layers.size
        ? [{ code: 'LAYERS_CREATED', severity: 'warning' as const, message: `Will create layers ${[...layers].join(', ')}.` }]
        : [];
      return { ok: true, confidence: 0.95, affectedIds: [], riskClass: 'safe', errors: [], warnings };
    },

    compile(action, ctx): ICommand[] {
      if (validateParams(action.parameters)) return [];
      const file = ctx.doc.activeFile;
      const entities: Entity[] = buildEntities(buildRoomSpecs(action.parameters), ctx.doc.activeLayerName);
      return [new CompoundCmd([...ensureLayerCmds(entities, file), new PasteEntitiesCmd(entities, file, ctx.hooks)])];
    },

    describe(action): string {
      const p = action.parameters;
      const name = p.name ? `"${p.name}"` : 'a room';
      const openings = (p.doors?.length ?? 0) + (p.windows?.length ?? 0);
      return `Drew ${name} ${(p.width / 1000).toFixed(2)} × ${(p.depth / 1000).toFixed(2)} m${openings ? ` with ${openings} opening${openings === 1 ? '' : 's'}` : ''}.`;
    },
  };
}
