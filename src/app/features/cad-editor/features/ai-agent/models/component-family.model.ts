/**
 * Parameter specification for a parametric library component.
 * Kept in a separate file so it can be used by generators and the AI tool
 * without importing Angular services.
 */
export interface ParamSpec {
  key: string;
  label: string;
  type: 'length' | 'count' | 'angle' | 'enum' | 'boolean';
  /** Drawing unit for length params (mm assumed if omitted). */
  unit?: 'mm' | 'm';
  min?: number;
  max?: number;
  default: number | string | boolean;
  options?: string[];
}

export interface ComponentFamily {
  /** Matches the AI's `query` param (case-insensitive fuzzy). */
  id: string;
  name: string;
  category: string;
  description: string;
  /** Expanded keywords the fuzzy matcher searches against. */
  keywords: string[];
  params: ParamSpec[];
}

/** All built-in parametric component families for Phase 3. */
export const COMPONENT_FAMILIES: ComponentFamily[] = [
  {
    id: 'retaining-wall',
    name: 'Retaining Wall',
    category: 'Bridge Elements',
    description: 'Simple vertical retaining wall with base slab — cross section view.',
    keywords: ['retaining wall', 'ret wall', 'earth retaining', 'breast wall'],
    params: [
      { key: 'height', label: 'Wall Height', type: 'length', unit: 'mm', min: 500, max: 20000, default: 3000 },
      { key: 'thickness', label: 'Wall Thickness', type: 'length', unit: 'mm', min: 200, max: 3000, default: 500 },
      { key: 'baseLength', label: 'Base Slab Length', type: 'length', unit: 'mm', min: 500, max: 6000, default: 2500 },
      { key: 'baseThickness', label: 'Base Slab Thickness', type: 'length', unit: 'mm', min: 200, max: 1000, default: 400 },
      { key: 'layer', label: 'Layer', type: 'enum', default: 'STRUCTURAL', options: ['STRUCTURAL', 'ARCHITECTURE', 'Layer 0'] },
    ],
  },
  {
    id: 'box-culvert',
    name: 'Box Culvert',
    category: 'Bridge Elements',
    description: 'Single-cell RCC box culvert — cross section schematic.',
    keywords: ['box culvert', 'culvert', 'rcc box', 'box drain', 'rectangular culvert'],
    params: [
      { key: 'clearWidth', label: 'Clear Width', type: 'length', unit: 'mm', min: 500, max: 10000, default: 2000 },
      { key: 'clearHeight', label: 'Clear Height', type: 'length', unit: 'mm', min: 500, max: 6000, default: 1500 },
      { key: 'wallThickness', label: 'Wall Thickness', type: 'length', unit: 'mm', min: 150, max: 600, default: 300 },
      { key: 'slabThickness', label: 'Slab Thickness', type: 'length', unit: 'mm', min: 150, max: 600, default: 300 },
      { key: 'layer', label: 'Layer', type: 'enum', default: 'STRUCTURAL', options: ['STRUCTURAL', 'ARCHITECTURE', 'Layer 0'] },
    ],
  },
  {
    id: 'drainage-channel',
    name: 'Drainage Channel',
    category: 'Road Elements',
    description: 'Trapezoidal or rectangular open drainage channel — cross section.',
    keywords: ['drainage channel', 'drain', 'channel', 'open drain', 'trapezoidal channel', 'side drain'],
    params: [
      { key: 'bottomWidth', label: 'Bottom Width', type: 'length', unit: 'mm', min: 300, max: 3000, default: 600 },
      { key: 'depth', label: 'Depth', type: 'length', unit: 'mm', min: 200, max: 2000, default: 600 },
      { key: 'sideSlope', label: 'Side Slope (H:V)', type: 'enum', default: '1:1', options: ['0:1', '1:2', '1:1', '3:2', '2:1'] },
      { key: 'wallThickness', label: 'Wall Thickness', type: 'length', unit: 'mm', min: 100, max: 400, default: 150 },
      { key: 'layer', label: 'Layer', type: 'enum', default: 'DRAINAGE', options: ['DRAINAGE', 'ROAD', 'Layer 0'] },
    ],
  },
  {
    id: 'inspection-chamber',
    name: 'Inspection Chamber',
    category: 'Bridge Elements',
    description: 'Rectangular inspection / maintenance chamber — plan + section.',
    keywords: ['chamber', 'inspection chamber', 'manhole', 'inspection pit', 'maintenance chamber'],
    params: [
      { key: 'length', label: 'Internal Length', type: 'length', unit: 'mm', min: 500, max: 4000, default: 1200 },
      { key: 'width', label: 'Internal Width', type: 'length', unit: 'mm', min: 500, max: 4000, default: 900 },
      { key: 'depth', label: 'Depth', type: 'length', unit: 'mm', min: 500, max: 5000, default: 1800 },
      { key: 'wallThickness', label: 'Wall Thickness', type: 'length', unit: 'mm', min: 150, max: 400, default: 225 },
      { key: 'layer', label: 'Layer', type: 'enum', default: 'STRUCTURAL', options: ['STRUCTURAL', 'DRAINAGE', 'Layer 0'] },
    ],
  },
  {
    id: 'pipe-culvert',
    name: 'Pipe Culvert',
    category: 'Bridge Elements',
    description: 'Circular pipe culvert — cross section with headwall.',
    keywords: ['pipe culvert', 'circular culvert', 'pipe drain', 'hume pipe', 'np3', 'rcc pipe'],
    params: [
      { key: 'diameter', label: 'Pipe Diameter', type: 'length', unit: 'mm', min: 300, max: 2400, default: 900 },
      { key: 'headwallHeight', label: 'Headwall Height', type: 'length', unit: 'mm', min: 500, max: 3000, default: 1500 },
      { key: 'headwallThickness', label: 'Headwall Thickness', type: 'length', unit: 'mm', min: 200, max: 600, default: 300 },
      { key: 'layer', label: 'Layer', type: 'enum', default: 'STRUCTURAL', options: ['STRUCTURAL', 'DRAINAGE', 'Layer 0'] },
    ],
  },
];
