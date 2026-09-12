import { buildEntities, validateSpecs, type DrawSpec } from '../shared/draw-spec';
import { buildRoomSpecs } from './draw-room.tool';
import { buildGridSpecs } from './draw-grid.tool';

describe('draw-spec validateSpecs / buildEntities', () => {
  it('accepts every primitive type and builds one entity each', () => {
    const specs: DrawSpec[] = [
      { type: 'line', x1: 0, y1: 0, x2: 100, y2: 0 },
      { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: true },
      { type: 'rect', x: 0, y: 0, w: 50, h: 20 },
      { type: 'circle', cx: 0, cy: 0, r: 5 },
      { type: 'arc', cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: 90 },
      { type: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 5 },
      { type: 'text', x: 0, y: 0, text: 'HELLO', height: 250, justify: 'MC' },
      { type: 'hatch', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], pattern: 'ANSI31' },
      { type: 'dimension', x1: 0, y1: 0, x2: 1000, y2: 0 },
    ];
    const { ok, issues } = validateSpecs(specs);
    expect(issues).toEqual([]);
    const ents = buildEntities(ok, 'Layer 0');
    expect(ents.map(e => e.type)).toEqual(['LINE', 'POLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'TEXT', 'HATCH', 'DIMENSION']);
  });

  it('skips malformed primitives and reports their index', () => {
    const { ok, issues } = validateSpecs([
      { type: 'circle', cx: 0, cy: 0, r: -1 },
      { type: 'line', x1: 0, y1: 0, x2: 0, y2: 0 },
      { type: 'blob' },
      { type: 'circle', cx: 0, cy: 0, r: 5 },
    ]);
    expect(ok.length).toBe(1);
    expect(issues.map(i => i.index)).toEqual([0, 1, 2]);
  });

  it('applies layer, colour, linetype and lineweight overrides', () => {
    const [e] = buildEntities([{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1, layer: 'A-WALL', color: 1, lineType: 'hidden', lineWeight: 35 }], 'Layer 0');
    expect(e.layer).toBe('A-WALL');
    expect(e.colorNumber).toBe(1);
    expect(e.lineType).toBe('HIDDEN');
    expect(e.lineWeight).toBe(35);
  });

  it('normalises a negative-size rect into a closed polyline', () => {
    const [e] = buildEntities([{ type: 'rect', x: 10, y: 10, w: -10, h: -10 }], 'Layer 0') as any[];
    expect(e.closed).toBeTrue();
    const xs = e.pts.map((p: { x: number }) => p.x);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(10);
  });
});

describe('buildRoomSpecs', () => {
  it('draws eight wall lines for a plain room plus a label', () => {
    const specs = buildRoomSpecs({ x: 0, y: 0, width: 4000, depth: 3000, name: 'BED' });
    const walls = specs.filter(s => s.layer === 'A-WALL');
    expect(walls.length).toBe(8);
    const texts = specs.filter(s => s.type === 'text');
    expect(texts.length).toBe(2);
    expect((texts[1] as any).text).toBe('12.00 m²');
  });

  it('breaks the wall at a door and adds leaf + swing', () => {
    const specs = buildRoomSpecs({ x: 0, y: 0, width: 4000, depth: 3000, doors: [{ wall: 'S', offset: 1000, width: 900 }] });
    const doorParts = specs.filter(s => s.layer === 'A-DOOR');
    expect(doorParts.map(s => s.type)).toEqual(['line', 'arc']);
    // South inner face is split into two pieces around the opening.
    const southInner = specs.filter(s => s.type === 'line' && s.layer === 'A-WALL' && s.y1 === 0 && s.y2 === 0);
    expect(southInner.length).toBe(2);
    // Two jamb returns cross the wall thickness.
    const jambs = specs.filter(s => s.type === 'line' && s.layer === 'A-WALL' && s.x1 === s.x2 && (s.x1 === 1000 || s.x1 === 1900));
    expect(jambs.length).toBe(2);
  });

  it('draws three lines per window', () => {
    const specs = buildRoomSpecs({ x: 0, y: 0, width: 4000, depth: 3000, windows: [{ wall: 'N', offset: 500, width: 1500 }] });
    expect(specs.filter(s => s.layer === 'A-GLAZ').length).toBe(3);
  });
});

describe('buildGridSpecs', () => {
  it('repeats a single spacing by count and labels bubbles A.. / 1..', () => {
    const specs = buildGridSpecs({ x: 0, y: 0, xSpacings: 6000, xCount: 3, ySpacings: 5000, yCount: 2 })!;
    const texts = specs.filter(s => s.type === 'text') as any[];
    expect(texts.map(t => t.text)).toEqual(['A', 'B', 'C', 'D', '1', '2', '3']);
    expect(specs.filter(s => s.type === 'line').length).toBe(7);
  });

  it('adds a column at every intersection when columnSize is set', () => {
    const specs = buildGridSpecs({ x: 0, y: 0, xSpacings: [6000, 6000], ySpacings: [5000], columnSize: 400 })!;
    expect(specs.filter(s => s.type === 'rect').length).toBe(6);
    expect(specs.filter(s => s.type === 'hatch').length).toBe(6);
  });

  it('rejects non-positive spacing', () => {
    expect(buildGridSpecs({ x: 0, y: 0, xSpacings: 0, ySpacings: 5000 })).toBeNull();
  });
});
