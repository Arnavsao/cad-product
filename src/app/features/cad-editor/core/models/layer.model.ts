import { DXF_ACI_COLORS } from '../registries/aci-colors';
import { LINETYPE_DEFINITIONS } from '../registries/linetype-definitions';
import type { Entity, RawDxfObject } from './entity.model';
import { DimensionStyle, createDefaultDimStyles } from './dimension-style.model';

import type { IAttDef } from './block-attribute.model';

export function generateId(): string {
  return 'id_' + Math.random().toString(36).substring(2, 11);
}

export interface IBlockDef {
  name: string;
  basePoint: { x: number; y: number };
  entities: Entity[];
  isAnonymous?: boolean;
  attDefs?: IAttDef[];
  description?: string;
}

export interface ILineTypeDef {
  description?: string;
  pattern: number[];
}

export class Layer {
  name: string;
  colorNumber: number;
  color: string;
  visible = true;
  locked = false;
  frozen = false;
  lineType = 'Continuous';
  lineWidth = 0;
  lineWeight = 0;
  isDefpoints: boolean;
  print: boolean;
  isProtected: boolean;

  constructor(name: string, parserColor?: string | null, colorNumber = 7) {
    this.name = name;
    this.colorNumber = colorNumber;

    // Resolve stored color from parserColor → ACI table → fallback white.
    // No theme-aware mutation here: the display mapper handles visibility at
    // paint time so the layer's stored color stays a faithful CAD record.
    let hex = '#ffffff';
    if (typeof parserColor === 'string' && parserColor.startsWith('#')) {
      hex = parserColor;
    } else if (colorNumber >= 0 && colorNumber < 256) {
      hex = DXF_ACI_COLORS[colorNumber];
    }
    this.color = hex;

    this.isDefpoints = name.toUpperCase() === 'DEFPOINTS';
    this.print = !this.isDefpoints;
    this.isProtected = name === 'Layer 0' || name === '0' || this.isDefpoints;
  }
}

export class DxfFile {
  id: string;
  name: string;
  layers: Map<string, Layer> = new Map();
  blocks: Map<string, IBlockDef> = new Map();
  lineTypes: Map<string, ILineTypeDef> = new Map();
  /** Dimension styles available in this drawing. Keyed by style name. */
  dimStyles: Map<string, DimensionStyle> = createDefaultDimStyles();
  /** Text styles from the DXF STYLE table. Keyed by style name. */
  textStyles: Map<string, {
    /** Group 3 — primary font file, e.g. `arial.ttf` or `romans.shx`. */
    font?: string;
    widthFactor?: number;
    obliqueAngle?: number;
    /** Group 40 — fixed height. 0 means each entity carries its own. */
    fixedHeight?: number;
    /** Group 4 — bigfont file (CJK). */
    bigFont?: string;
  }> = new Map();
  /** Style name used for newly-created dimensions. Defaults to "Standard". */
  activeDimStyleName = 'Standard';
  entities: Entity[] = [];
  rawUnparsedEntities: RawDxfObject[] = []; // Preserve unsupported objects
  
  /** Metadata from the original file header */
  metadata: {
    sourceVersion?: string;
    targetVersion?: string;
    units?: string;
    author?: string;
    createdAt?: Date;
  } = {};

  visible = true;
  locked = false;
  opacity = 1.0;
  expanded = true;

  /** Current annotation scale multiplier for model space (CANNOSCALE). Default 1.0 (1:1). */
  cannoScale = 1.0;

  // File-level transform
  x = 0;
  y = 0;
  scale = 1;
  rotation = 0; // degrees

  /**
   * Offset that was subtracted from every entity at import time to normalize
   * the drawing near origin (and bake `autoPosition` into entity coords so
   * `x/y` above stay at 0). On DXF export, add this back to restore the
   * original world placement. `null` for files authored in-editor.
   */
  importOffset: { x: number; y: number } | null = null;

  constructor(name = 'Untitled') {
    this.id = generateId();
    this.name = name;
    Object.keys(LINETYPE_DEFINITIONS).forEach((lt) => {
      this.lineTypes.set(lt, { ...LINETYPE_DEFINITIONS[lt] });
    });
  }
}

/** Ensure a DEFPOINTS layer exists in the given file, creating it if needed */
export function ensureDefpoints(file: DxfFile): Layer | undefined {
  if (!file) return undefined;
  for (const [name, lay] of file.layers) {
    if (name.toUpperCase() === 'DEFPOINTS') return lay;
  }
  const defLay = new Layer('Defpoints', '#555555', 8);
  file.layers.set('Defpoints', defLay);
  return defLay;
}
