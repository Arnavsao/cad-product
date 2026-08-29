/**
 * Drawing generation templates — the "Planner Agent" knowledge base.
 *
 * Each template describes a complete engineering drawing (e.g. a box-culvert
 * GAD) as an ordered set of sub-views. A sub-view references a parametric
 * component family (from component-family.model.ts) plus a title and a grid
 * slot. The deterministic generator composes these into positioned geometry —
 * the AI only chooses the template id and supplies overall parameters.
 *
 * This keeps the "multi-agent" pipeline deterministic:
 *   Planner  → picks a template + params (this file)
 *   CAD      → runs each family's generator (component-generators.ts)
 *   Layout   → places sub-views into the template grid (positions below)
 *   Validate → Phase-4 layout checker runs on the result
 */

export interface DrawingSubView {
  /** Parametric component family id (see COMPONENT_FAMILIES). */
  familyId: string;
  /** Title text drawn above the sub-view. */
  title: string;
  /** Zero-based grid slot: column + row. */
  col: number;
  row: number;
  /**
   * Per-sub-view parameter overrides merged on top of the template-wide params.
   * Lets one template show, e.g., the same culvert at two scales/orientations.
   */
  paramOverrides?: Record<string, number | string | boolean>;
}

export interface DrawingTemplate {
  id: string;
  name: string;
  /** Keywords the planner fuzzy-matches the user's goal against. */
  keywords: string[];
  /** Component family whose ParamSpec defines the user-facing parameters. */
  primaryFamilyId: string;
  /** Sub-views composing the full drawing. */
  subViews: DrawingSubView[];
  /** Grid gutter between slots, in drawing units (mm). */
  gutter: number;
}

export const DRAWING_TEMPLATES: DrawingTemplate[] = [
  {
    id: 'box-culvert-gad',
    name: 'Box Culvert GAD',
    keywords: ['box culvert gad', 'culvert gad', 'culvert drawing', 'box culvert drawing', 'culvert general arrangement', 'gad box culvert'],
    primaryFamilyId: 'box-culvert',
    gutter: 3000,
    subViews: [
      { familyId: 'box-culvert', title: 'CROSS SECTION', col: 0, row: 0 },
      { familyId: 'box-culvert', title: 'LONGITUDINAL SECTION', col: 1, row: 0 },
      { familyId: 'inspection-chamber', title: 'PLAN', col: 0, row: 1 },
    ],
  },
  {
    id: 'retaining-wall-gad',
    name: 'Retaining Wall GAD',
    keywords: ['retaining wall gad', 'retaining wall drawing', 'ret wall gad', 'retaining wall general arrangement', 'wall gad'],
    primaryFamilyId: 'retaining-wall',
    gutter: 2500,
    subViews: [
      { familyId: 'retaining-wall', title: 'CROSS SECTION', col: 0, row: 0 },
      { familyId: 'retaining-wall', title: 'ELEVATION', col: 1, row: 0 },
    ],
  },
  {
    id: 'drainage-gad',
    name: 'Drainage Layout',
    keywords: ['drainage gad', 'drainage layout', 'drainage drawing', 'drain layout', 'channel gad', 'drainage general arrangement'],
    primaryFamilyId: 'drainage-channel',
    gutter: 2000,
    subViews: [
      { familyId: 'drainage-channel', title: 'TYPICAL SECTION', col: 0, row: 0 },
      { familyId: 'inspection-chamber', title: 'CHAMBER DETAIL', col: 1, row: 0 },
      { familyId: 'pipe-culvert', title: 'PIPE CROSSING', col: 2, row: 0 },
    ],
  },
];

export function findDrawingTemplate(query: string): DrawingTemplate | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  // 1. Direct keyword containment, longest keyword first for specificity.
  let best: { tpl: DrawingTemplate; score: number } | null = null;
  for (const tpl of DRAWING_TEMPLATES) {
    for (const kw of tpl.keywords) {
      if (q.includes(kw)) {
        const score = kw.length;
        if (!best || score > best.score) best = { tpl, score };
      }
    }
  }
  if (best) return best.tpl;

  // 2. Token overlap fallback.
  const tokens = q.split(/\s+/).filter(Boolean);
  for (const tpl of DRAWING_TEMPLATES) {
    const hay = [tpl.name, ...tpl.keywords].join(' ').toLowerCase();
    const hits = tokens.filter(t => hay.includes(t)).length;
    if (hits >= 2) return tpl;
  }

  return null;
}
