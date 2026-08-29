import {
  LineEntity, PolylineEntity, CircleEntity,
} from '../../../core/models/entity.model';
import { TextEntity } from '../../../core/models/entity-extended.model';
import type { Entity } from '../../../core/models/entity.model';

/**
 * Deterministic parametric geometry generators.
 *
 * Each function takes validated, unit-normalised params (all lengths in mm)
 * and returns Entity[] positioned with origin at (0,0).
 *
 * The AI tool never calls these directly — the library.insert compile() step
 * calls them after param validation, then TranslateEntitiesCmd moves them to
 * the insertion point.  This keeps geometry 100% deterministic and testable.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyLayer(entities: Entity[], layer: string): Entity[] {
  for (const e of entities) e.layer = layer;
  return entities;
}

function polyRect(x: number, y: number, w: number, h: number, layer = 'Layer 0'): PolylineEntity {
  const pts = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const p = new PolylineEntity(pts, true);
  p.layer = layer;
  return p;
}

function label(text: string, x: number, y: number, height = 100, layer = 'DIM'): TextEntity {
  const t = new TextEntity(x, y, text, height);
  t.layer = layer;
  return t;
}

// ── Retaining Wall ────────────────────────────────────────────────────────────

export interface RetainingWallParams {
  height: number;       // mm
  thickness: number;    // mm
  baseLength: number;   // mm
  baseThickness: number; // mm
  layer: string;
}

export function generateRetainingWall(p: RetainingWallParams): Entity[] {
  const { height, thickness, baseLength, baseThickness, layer } = p;
  const ents: Entity[] = [];

  // Stem (wall body) — origin at bottom-left of stem
  ents.push(polyRect(0, 0, thickness, height, layer));

  // Base slab — centred under stem
  const baseX = -(baseLength - thickness) / 2;
  ents.push(polyRect(baseX, -baseThickness, baseLength, baseThickness, layer));

  // Centre-line (dashed)
  const cl = new LineEntity(thickness / 2, -baseThickness, thickness / 2, height);
  cl.layer = 'CL';
  cl.lineType = 'CENTER';
  ents.push(cl);

  // Labels
  ents.push(label(`H=${(height / 1000).toFixed(2)}m`, thickness + 150, height / 2, 80, 'DIM'));
  ents.push(label(`t=${(thickness / 1000).toFixed(2)}m`, thickness / 2, height + 150, 80, 'DIM'));

  return ents;
}

// ── Box Culvert ───────────────────────────────────────────────────────────────

export interface BoxCulvertParams {
  clearWidth: number;
  clearHeight: number;
  wallThickness: number;
  slabThickness: number;
  layer: string;
}

export function generateBoxCulvert(p: BoxCulvertParams): Entity[] {
  const { clearWidth, clearHeight, wallThickness, slabThickness, layer } = p;
  const ents: Entity[] = [];

  const totalW = clearWidth + 2 * wallThickness;
  const totalH = clearHeight + 2 * slabThickness;

  // Outer rectangle
  ents.push(polyRect(0, 0, totalW, totalH, layer));

  // Inner opening
  ents.push(polyRect(wallThickness, slabThickness, clearWidth, clearHeight, layer));

  // Hatch indication lines (cross-section fill)
  const hatchStep = Math.min(wallThickness, slabThickness) / 2;
  for (let x = 0; x < totalW; x += hatchStep) {
    const l = new LineEntity(x, 0, x + hatchStep, hatchStep);
    l.layer = layer;
    ents.push(l);
  }

  // Labels
  ents.push(label(`${(clearWidth / 1000).toFixed(2)}m`, totalW / 2, -150, 80, 'DIM'));
  ents.push(label(`${(clearHeight / 1000).toFixed(2)}m`, totalW + 150, totalH / 2, 80, 'DIM'));

  return ents;
}

// ── Drainage Channel ──────────────────────────────────────────────────────────

export interface DrainageChannelParams {
  bottomWidth: number;
  depth: number;
  sideSlope: string;  // "H:V" e.g. "1:1"
  wallThickness: number;
  layer: string;
}

function parseSlopeRatio(slope: string): number {
  const parts = slope.split(':');
  const h = parseFloat(parts[0]);
  const v = parseFloat(parts[1] ?? '1');
  return v === 0 ? 0 : h / v; // horizontal offset per unit of vertical
}

export function generateDrainageChannel(p: DrainageChannelParams): Entity[] {
  const { bottomWidth, depth, sideSlope, wallThickness, layer } = p;
  const ents: Entity[] = [];
  const ratio = parseSlopeRatio(sideSlope);
  const topOffset = depth * ratio;

  // Inner channel profile (trapezoidal)
  const innerPts = [
    { x: 0, y: 0 },
    { x: bottomWidth, y: 0 },
    { x: bottomWidth + topOffset, y: depth },
    { x: -topOffset, y: depth },
  ];
  const inner = new PolylineEntity(innerPts, true);
  inner.layer = layer;
  ents.push(inner);

  // Outer channel profile (with wall thickness)
  const outerPts = [
    { x: -wallThickness, y: -wallThickness },
    { x: bottomWidth + wallThickness, y: -wallThickness },
    { x: bottomWidth + topOffset + wallThickness, y: depth + wallThickness },
    { x: -topOffset - wallThickness, y: depth + wallThickness },
  ];
  const outer = new PolylineEntity(outerPts, true);
  outer.layer = layer;
  ents.push(outer);

  // Labels
  ents.push(label(`B=${(bottomWidth / 1000).toFixed(2)}m`, bottomWidth / 2, -250, 80, 'DIM'));
  ents.push(label(`D=${(depth / 1000).toFixed(2)}m`, bottomWidth + topOffset + 200, depth / 2, 80, 'DIM'));

  return ents;
}

// ── Inspection Chamber ────────────────────────────────────────────────────────

export interface InspectionChamberParams {
  length: number;
  width: number;
  depth: number;
  wallThickness: number;
  layer: string;
}

export function generateInspectionChamber(p: InspectionChamberParams): Entity[] {
  const { length, width, wallThickness, layer } = p;
  const ents: Entity[] = [];

  // Plan view (top)
  const outerL = length + 2 * wallThickness;
  const outerW = width + 2 * wallThickness;
  ents.push(polyRect(0, 0, outerL, outerW, layer));
  ents.push(polyRect(wallThickness, wallThickness, length, width, layer));

  // Centre lines
  const clH = new LineEntity(0, outerW / 2, outerL, outerW / 2);
  clH.layer = 'CL'; clH.lineType = 'CENTER';
  const clV = new LineEntity(outerL / 2, 0, outerL / 2, outerW);
  clV.layer = 'CL'; clV.lineType = 'CENTER';
  ents.push(clH, clV);

  ents.push(label(`${(length / 1000).toFixed(2)}m`, outerL / 2, -200, 80, 'DIM'));
  ents.push(label(`${(width / 1000).toFixed(2)}m`, outerL + 200, outerW / 2, 80, 'DIM'));

  return ents;
}

// ── Pipe Culvert ──────────────────────────────────────────────────────────────

export interface PipeCulvertParams {
  diameter: number;
  headwallHeight: number;
  headwallThickness: number;
  layer: string;
}

export function generatePipeCulvert(p: PipeCulvertParams): Entity[] {
  const { diameter, headwallHeight, headwallThickness, layer } = p;
  const ents: Entity[] = [];
  const r = diameter / 2;
  const cx = headwallThickness + r;

  // Headwall (left)
  ents.push(polyRect(0, 0, headwallThickness, headwallHeight, layer));

  // Pipe opening (circle)
  const pipe = new CircleEntity(cx, headwallHeight / 2, r);
  pipe.layer = layer;
  ents.push(pipe);

  // Pipe barrel extension
  const ext = diameter * 3;
  const barrel = new PolylineEntity([
    { x: cx - r, y: headwallHeight / 2 - r },
    { x: cx - r + ext, y: headwallHeight / 2 - r },
    { x: cx - r + ext, y: headwallHeight / 2 + r },
    { x: cx - r, y: headwallHeight / 2 + r },
  ], false);
  barrel.layer = layer;
  ents.push(barrel);

  // CL
  const cl = new LineEntity(0, headwallHeight / 2, cx - r + ext, headwallHeight / 2);
  cl.layer = 'CL'; cl.lineType = 'CENTER';
  ents.push(cl);

  ents.push(label(`Ø${diameter}mm`, cx, headwallHeight + 200, 80, 'DIM'));

  return ents;
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export type GeneratorParams = Record<string, number | string | boolean>;

export function generateComponent(familyId: string, params: GeneratorParams): Entity[] | null {
  switch (familyId) {
    case 'retaining-wall':
      return generateRetainingWall(params as unknown as RetainingWallParams);
    case 'box-culvert':
      return generateBoxCulvert(params as unknown as BoxCulvertParams);
    case 'drainage-channel':
      return generateDrainageChannel(params as unknown as DrainageChannelParams);
    case 'inspection-chamber':
      return generateInspectionChamber(params as unknown as InspectionChamberParams);
    case 'pipe-culvert':
      return generatePipeCulvert(params as unknown as PipeCulvertParams);
    default:
      return null;
  }
}
