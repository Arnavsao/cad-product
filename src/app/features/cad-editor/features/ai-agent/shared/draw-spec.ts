import {
  LineEntity, CircleEntity, ArcEntity, PolylineEntity, type Entity, type IPoint,
} from '../../../core/models/entity.model';
import {
  TextEntity, EllipseEntity, HatchEntity, DimensionEntity, type IHatchEdge, type TextJustify,
} from '../../../core/models/entity-extended.model';
import { buildFrozenSpec } from '../../../core/models/hatch-boundary.model';

/**
 * Primitive drawing specs the LLM may emit. Every length is in drawing units
 * (millimetres), every angle in degrees CCW from +X, every coordinate absolute
 * world space. Kept deliberately flat so a JSON-only model can produce them.
 */
interface SpecBase {
  layer?: string;
  /** ACI index (1..255) or "#rrggbb". Omit for BYLAYER. */
  color?: number | string;
  /** DXF linetype name: CONTINUOUS, HIDDEN, CENTER, DASHED, DASHDOT, PHANTOM. */
  lineType?: string;
  /** Hundredths of a mm (0.35 mm → 35). */
  lineWeight?: number;
}

export type DrawSpec =
  | (SpecBase & { type: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (SpecBase & { type: 'polyline'; points: IPoint[]; closed?: boolean })
  | (SpecBase & { type: 'rect'; x: number; y: number; w: number; h: number })
  | (SpecBase & { type: 'circle'; cx: number; cy: number; r: number })
  | (SpecBase & { type: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number })
  | (SpecBase & { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation?: number })
  | (SpecBase & { type: 'text'; x: number; y: number; text: string; height?: number; rotation?: number; justify?: TextJustify })
  | (SpecBase & { type: 'hatch'; points: IPoint[]; pattern?: string; scale?: number; angle?: number })
  | (SpecBase & { type: 'dimension'; x1: number; y1: number; x2: number; y2: number; offset?: number });

export const DRAW_SPEC_TYPES = ['line', 'polyline', 'rect', 'circle', 'arc', 'ellipse', 'text', 'hatch', 'dimension'] as const;

/** Default ACI colour for the layers the knowledge block recommends. */
const LAYER_COLORS: Record<string, number> = {
  'A-WALL': 7, 'A-WALL-PRHT': 8, 'A-DOOR': 3, 'A-GLAZ': 4, 'A-FLOR': 8, 'A-FURN': 6, 'A-AREA': 8,
  'A-ANNO-TEXT': 7, 'A-ANNO-DIMS': 3, 'A-ANNO-SYMB': 2, 'A-GRID': 8,
  'S-COLS': 7, 'S-BEAM': 7, 'S-SLAB': 8, 'S-FNDN': 7, 'S-GRID': 8,
  'C-ROAD': 7, 'C-ROAD-CNTR': 1, 'C-STRM': 4, 'C-SSWR': 3, 'C-TOPO': 8, 'C-PROP': 1,
  'E-LITE': 2, 'E-POWR': 1, 'P-SANR': 3, 'M-HVAC': 5, 'L-PLNT': 3,
  CL: 1, HIDDEN: 8, HATCH: 8, DIM: 3, STRUCTURAL: 7, DRAINAGE: 4, ROAD: 7,
};

export function defaultLayerColor(name: string): number {
  return LAYER_COLORS[name.toUpperCase()] ?? 7;
}

const MAX_COORD = 1e8;

export interface SpecIssue { index: number; message: string; }

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
}

function pts(v: unknown, min: number): v is IPoint[] {
  return Array.isArray(v) && v.length >= min && v.every(p => p && num(p.x) && num(p.y));
}

/** Structural validation of one spec. Returns a message or null when it is sound. */
export function validateSpec(s: DrawSpec): string | null {
  if (!s || typeof s !== 'object') return 'spec is not an object';
  switch (s.type) {
    case 'line':
      if (![s.x1, s.y1, s.x2, s.y2].every(num)) return 'line needs finite x1,y1,x2,y2';
      if (s.x1 === s.x2 && s.y1 === s.y2) return 'line has zero length';
      return null;
    case 'polyline':
      return pts(s.points, 2) ? null : 'polyline needs at least two {x,y} points';
    case 'rect':
      if (![s.x, s.y, s.w, s.h].every(num)) return 'rect needs finite x,y,w,h';
      if (s.w === 0 || s.h === 0) return 'rect has zero width or height';
      return null;
    case 'circle':
      if (![s.cx, s.cy, s.r].every(num)) return 'circle needs finite cx,cy,r';
      return s.r > 0 ? null : 'circle radius must be positive';
    case 'arc':
      if (![s.cx, s.cy, s.r, s.startAngle, s.endAngle].every(num)) return 'arc needs finite cx,cy,r,startAngle,endAngle';
      return s.r > 0 ? null : 'arc radius must be positive';
    case 'ellipse':
      if (![s.cx, s.cy, s.rx, s.ry].every(num)) return 'ellipse needs finite cx,cy,rx,ry';
      return s.rx > 0 && s.ry > 0 ? null : 'ellipse radii must be positive';
    case 'text':
      if (![s.x, s.y].every(num)) return 'text needs finite x,y';
      if (typeof s.text !== 'string' || !s.text.trim()) return 'text needs non-empty text';
      if (s.height !== undefined && !(num(s.height) && s.height > 0)) return 'text height must be positive';
      return null;
    case 'hatch':
      return pts(s.points, 3) ? null : 'hatch needs a closed boundary of at least three points';
    case 'dimension':
      if (![s.x1, s.y1, s.x2, s.y2].every(num)) return 'dimension needs finite x1,y1,x2,y2';
      if (s.x1 === s.x2 && s.y1 === s.y2) return 'dimension has zero length';
      return null;
    default:
      return `unknown primitive type "${(s as { type?: unknown }).type}" (use ${DRAW_SPEC_TYPES.join('/')})`;
  }
}

export function validateSpecs(specs: unknown): { ok: DrawSpec[]; issues: SpecIssue[] } {
  const ok: DrawSpec[] = [];
  const issues: SpecIssue[] = [];
  if (!Array.isArray(specs)) return { ok, issues: [{ index: -1, message: 'entities must be an array' }] };
  specs.forEach((s, index) => {
    const msg = validateSpec(s as DrawSpec);
    if (msg) issues.push({ index, message: msg });
    else ok.push(s as DrawSpec);
  });
  return { ok, issues };
}

function applyBase(e: Entity, s: SpecBase, fallbackLayer: string): Entity {
  e.layer = (s.layer && s.layer.trim()) || fallbackLayer;
  if (typeof s.color === 'number' && s.color >= 0 && s.color <= 255) e.colorNumber = Math.round(s.color);
  else if (typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color)) e.color = s.color.toLowerCase();
  if (s.lineType && typeof s.lineType === 'string') e.lineType = s.lineType.toUpperCase();
  if (typeof s.lineWeight === 'number' && Number.isFinite(s.lineWeight)) e.lineWeight = Math.round(s.lineWeight);
  return e;
}

function hatchScaleFor(points: IPoint[], requested?: number): number {
  if (typeof requested === 'number' && requested > 0) return requested;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  if (diagonal < 1e-6) return 1;
  const exp = Math.round(Math.log10(diagonal / (35 * 3.175)));
  return Math.pow(10, exp);
}

/**
 * Turn validated specs into unattached entities. Pure: nothing is added to a
 * document here — the tool wraps the result in AddEntity/Paste commands.
 */
export function buildEntities(specs: DrawSpec[], fallbackLayer: string): Entity[] {
  const out: Entity[] = [];
  for (const s of specs) {
    switch (s.type) {
      case 'line':
        out.push(applyBase(new LineEntity(s.x1, s.y1, s.x2, s.y2), s, fallbackLayer));
        break;
      case 'polyline':
        out.push(applyBase(new PolylineEntity(s.points.map(p => ({ x: p.x, y: p.y })), !!s.closed), s, fallbackLayer));
        break;
      case 'rect': {
        const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w);
        const y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
        out.push(applyBase(new PolylineEntity([
          { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
        ], true), s, fallbackLayer));
        break;
      }
      case 'circle':
        out.push(applyBase(new CircleEntity(s.cx, s.cy, s.r), s, fallbackLayer));
        break;
      case 'arc':
        out.push(applyBase(new ArcEntity(s.cx, s.cy, s.r, s.startAngle, s.endAngle, true), s, fallbackLayer));
        break;
      case 'ellipse':
        out.push(applyBase(new EllipseEntity(s.cx, s.cy, s.rx, s.ry, ((s.rotation ?? 0) * Math.PI) / 180), s, fallbackLayer));
        break;
      case 'text': {
        const t = new TextEntity(s.x, s.y, s.text, s.height ?? 250, s.rotation ?? 0);
        if (s.justify) t.justify = s.justify;
        out.push(applyBase(t, s, fallbackLayer));
        break;
      }
      case 'hatch': {
        const polygon = s.points.map(p => ({ x: p.x, y: p.y }));
        const edges: IHatchEdge[] = polygon.map((p, i) => ({
          type: 'LINE', start: p, end: polygon[(i + 1) % polygon.length],
        }));
        const pattern = (s.pattern ?? 'ANSI31').toUpperCase();
        const solid = pattern === 'SOLID';
        const h = new HatchEntity([edges], pattern, solid ? 1 : hatchScaleFor(polygon, s.scale), s.angle ?? 0, solid);
        h.associative = false;
        const cx = polygon.reduce((a, p) => a + p.x, 0) / polygon.length;
        const cy = polygon.reduce((a, p) => a + p.y, 0) / polygon.length;
        h.boundarySpec = buildFrozenSpec(polygon, [], [], { x: cx, y: cy });
        out.push(applyBase(h, s, fallbackLayer));
        break;
      }
      case 'dimension': {
        const p1 = { x: s.x1, y: s.y1 }, p2 = { x: s.x2, y: s.y2 };
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const off = s.offset ?? Math.max(len * 0.15, 100);
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const dimLine = { x: mid.x - (dy / len) * off, y: mid.y + (dx / len) * off };
        out.push(applyBase(new DimensionEntity(p1, p2, dimLine), s, fallbackLayer));
        break;
      }
    }
  }
  return out;
}

/** Union bbox of entities that report one. */
export function entitiesBBox(entities: Entity[]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of entities) {
    const bb = typeof e.bbox === 'function' ? e.bbox() : null;
    if (!bb || !isFinite(bb.x) || !isFinite(bb.w)) continue;
    if (bb.x < minX) minX = bb.x; if (bb.y < minY) minY = bb.y;
    if (bb.x + bb.w > maxX) maxX = bb.x + bb.w; if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
  }
  return isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}
