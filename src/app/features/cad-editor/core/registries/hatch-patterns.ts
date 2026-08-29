export interface HatchPatternLine {
  angle: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  dashArray: number[];
}

export interface HatchPattern {
  name: string;
  lines: HatchPatternLine[];
}

export const HATCH_PATTERNS: Record<string, HatchPattern> = {
  // ── Solid / Gradient ──────────────────────────────────────────────────────
  SOLID: { name: 'SOLID', lines: [] },

  // ── Standard ANSI patterns ────────────────────────────────────────────────
  ANSI31: { name: 'ANSI31', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
  ]},
  ANSI32: { name: 'ANSI32', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 9.525, dashArray: [] },
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 9.525, dashArray: [] },
  ]},
  // ANSI30 — 45° + 135° crosshatch (steel section)
  ANSI30: { name: 'ANSI30', lines: [
    { angle: 45,  x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
    { angle: 135, x0: 0, y0: 0, dx: 0, dy: 3.175, dashArray: [] },
  ]},
  // ANSI37 — same as ANSI31 alias used in some bridge templates
  ANSI37: { name: 'ANSI37', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 6.35, dashArray: [] },
  ]},

  // ── Engineering material patterns ─────────────────────────────────────────
  ISO: { name: 'ISO', lines: [
    { angle: 45, x0: 0, y0: 0, dx: 0, dy: 5, dashArray: [10, -2] },
  ]},
  STEEL: { name: 'STEEL', lines: [
    { angle: 45, x0: 0, y0: 0,     dx: 0, dy: 6.35, dashArray: [] },
    { angle: 45, x0: 0, y0: 3.175, dx: 0, dy: 6.35, dashArray: [] },
  ]},

  // AR-CONC — concrete aggregate (uses special stone renderer; lines kept for DXF export reference)
  'AR-CONC': { name: 'AR-CONC', lines: [] },

  // PCC — plain cement concrete (grid + diagonal dashes)
  PCC: { name: 'PCC', lines: [
    { angle: 0,   x0: 0, y0: 0, dx: 0, dy: 12,    dashArray: [] },
    { angle: 90,  x0: 0, y0: 0, dx: 0, dy: 12,    dashArray: [] },
    { angle: 45,  x0: 0, y0: 0, dx: 0, dy: 16.97, dashArray: [3, -3] },
    { angle: 135, x0: 0, y0: 0, dx: 0, dy: 16.97, dashArray: [3, -3] },
  ]},

  // BRICK / AR-B816 — standard brick coursing
  BRICK: { name: 'BRICK', lines: [
    { angle: 0,  x0: 0, y0: 0, dx: 0,  dy: 10, dashArray: [] },
    { angle: 90, x0: 0, y0: 0, dx: 10, dy: 10, dashArray: [10, -10] },
  ]},
  'AR-B816': { name: 'AR-B816', lines: [
    // 8×16 block elevation — two horizontal families + vertical joints
    { angle: 0,   x0: 0, y0: 0, dx: 0,  dy: 4,  dashArray: [] },
    { angle: 90,  x0: 0, y0: 0, dx: 0,  dy: 8,  dashArray: [4, -4] },
    { angle: 90,  x0: 4, y0: 0, dx: 0,  dy: 8,  dashArray: [4, -4] },
  ]},

  // ── Ground / soil patterns ────────────────────────────────────────────────
  // EARTH — engineering earth/subsoil fill (AutoCAD acad.pat standard)
  // Two families of horizontal lines: solid + offset dashed
  EARTH: { name: 'EARTH', lines: [
    { angle: 0, x0: 0, y0: 0,   dx: 0, dy: 5,   dashArray: [] },
    { angle: 0, x0: 0, y0: 2.5, dx: 0, dy: 5,   dashArray: [2.5, -2.5] },
  ]},

  // SAND / AR-SAND — scattered short-dash pattern (3 families at 0°, 15°, 165°)
  SAND: { name: 'SAND', lines: [
    { angle: 0,   x0: 0, y0: 0, dx: 3,   dy: 3, dashArray: [0.5, -4] },
    { angle: 45,  x0: 1, y0: 1, dx: 4,   dy: 4, dashArray: [0.5, -5] },
    { angle: 135, x0: 2, y0: 2, dx: 2.5, dy: 5, dashArray: [0.5, -3] },
  ]},
  'AR-SAND': { name: 'AR-SAND', lines: [
    { angle: 0,   x0: 0, y0: 0, dx: 3,   dy: 3, dashArray: [0.5, -4] },
    { angle: 45,  x0: 1, y0: 1, dx: 4,   dy: 4, dashArray: [0.5, -5] },
    { angle: 135, x0: 2, y0: 2, dx: 2.5, dy: 5, dashArray: [0.5, -3] },
  ]},

  // ── Aggregate / fill patterns ─────────────────────────────────────────────
  // GRAVEL — uses custom organic-stone renderer (lines[] empty intentionally)
  GRAVEL: { name: 'GRAVEL', lines: [] },

  // ── Steel / structural patterns ───────────────────────────────────────────
  // ANGLE — angle-iron section: horizontal + vertical dashes (creates L-shapes)
  ANGLE: { name: 'ANGLE', lines: [
    { angle: 0,  x0: 0, y0: 0, dx: 0, dy: 4.243, dashArray: [4.243, -4.243] },
    { angle: 90, x0: 0, y0: 0, dx: 0, dy: 4.243, dashArray: [4.243, -4.243] },
  ]},

  // ── Tessellated patterns (use dedicated renderers) ────────────────────────
  HEX: { name: 'HEX', lines: [
    { angle: 0,   x0: 0, y0: 0, dx: 0, dy: 17.32, dashArray: [10, -20] },
    { angle: 60,  x0: 0, y0: 0, dx: 0, dy: 17.32, dashArray: [10, -20] },
    { angle: 120, x0: 0, y0: 0, dx: 0, dy: 17.32, dashArray: [10, -20] },
  ]},
  HONEY: { name: 'HONEY', lines: [
    { angle: 30,  x0: 0, y0: 0, dx: 0, dy: 10,    dashArray: [10, -10] },
    { angle: 150, x0: 0, y0: 0, dx: 0, dy: 10,    dashArray: [10, -10] },
    { angle: 90,  x0: 0, y0: 0, dx: 0, dy: 17.32, dashArray: [10, -10] },
  ]},
};
