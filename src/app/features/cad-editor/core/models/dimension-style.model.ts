import type { DimUnitFormat } from '../utils/dimension-units';

export type DimArrowType = 'closed' | 'open' | 'tick' | 'dot' | 'none';

/**
 * Controls where dimension text is placed relative to the dimension line.
 *
 *   'auto'    → smart placement: inside when space permits, outside otherwise
 *   'inside'  → always between extension lines (may overlap arrows if too short)
 *   'outside' → always outside extension lines with a jog leader
 *   'above'   → centred above the dim line (no text offset on either side)
 */
export type DimTextPlacement = 'auto' | 'inside' | 'outside' | 'above';

/**
 * Re-export so existing dimension/leader code keeps working with the
 * `from './dimension-style.model'` import. The canonical home is now
 * `entity-anchor.model.ts`, shared with associative hatch / future fields.
 */
export type { IDimAnchor } from './entity-anchor.model';

/**
 * Reusable dimension style — the data layer behind AutoCAD's DIMSTYLE.
 *
 * One style lives on a `DxfFile.dimStyles` map and can be referenced by any
 * number of `DimensionEntity` instances via `styleName`. Each entity may also
 * carry per-field overrides (nullable fields on the entity); overrides win.
 */
export class DimensionStyle {
  name: string;

  // Lines / arrows
  arrowSize = 2.5;
  arrowAspect = 3; // 3:1 length-to-width proportion
  arrowType: DimArrowType = 'closed';
  extensionGap = 1.0;
  extensionPast = 1.5;

  // Text
  textHeight = 2.5;
  textOffset = 5;

  // Jog settings
  jogAngle = Math.PI / 4; // 45 degrees
  jogHeightFactor = 1.5;
  /**
   * Controls where text is placed relative to the dim line.
   * 'auto' = smart placement based on available space (AutoCAD default).
   */
  textPlacement: DimTextPlacement = 'auto';

  // Primary units
  unitFormat: DimUnitFormat = 'decimal';
  unitPrecision = 2;
  unitPrefix = '';
  unitSuffix = '';
  decimalSeparator: '.' | ',' = '.';
  suppressTrailingZeros = false;
  /** Round measurements to the nearest multiple of this value (0 = off). */
  roundOff = 0;

  /**
   * DIMLFAC — factor applied to the measured length before formatting.
   *
   * This is how a drawing drafted at a plot scale reports real-world sizes: a
   * span drawn 68.5333 units long with `linearFactor` 150 is labelled `10280`.
   * Overridden per entity far more often than it is set on the style, so
   * `DimensionEntity.linearFactor` usually wins — see the DSTYLE XDATA read in
   * `dxf-scanner.ts`.
   */
  linearFactor = 1;

  /**
   * DIMSCALE — multiplies every *visual* size (text height, arrow size, gaps)
   * without touching the measured value. 0 in a DXF means "derive from the
   * annotation scale"; treat that as 1.
   */
  globalScale = 1;

  /** DIMTAD — 0 centred, 1 above the dim line, 2 outside, 3 JIS, 4 below. */
  textAbove = 0;

  /** DIMTMOVE — 0 move with dim line, 1 add a leader, 2 move freely. */
  textMovement = 0;

  /** DIMTXSTY — name of the text style dimension text is drawn in. */
  textStyleName = '';

  constructor(name: string, init?: Partial<DimensionStyle>) {
    this.name = name;
    if (init) Object.assign(this, init);
  }
}

/**
 * AutoCAD's out-of-the-box `Standard` style. Single source of truth: both
 * `DEFAULT_DIM_STYLE` and `createDefaultDimStyles()` build from this, so a
 * dimension whose named style is missing renders identically to one that
 * actually resolves to `Standard`. They used to disagree — the fallback had
 * `unitPrecision: 2` while the map entry had `4`.
 */
const STANDARD_DIM_STYLE_INIT: Partial<DimensionStyle> = {
  arrowSize: 2.5,
  arrowAspect: 3,
  arrowType: 'closed',
  extensionGap: 0.625,
  extensionPast: 1.25,
  textHeight: 2.5,
  textOffset: 5,
  jogAngle: Math.PI / 4,
  jogHeightFactor: 1.5,
  unitFormat: 'decimal',
  unitPrecision: 4,
};

/** Fallback used when a referenced style isn't found in any file. */
export const DEFAULT_DIM_STYLE: DimensionStyle = new DimensionStyle(
  'Standard',
  STANDARD_DIM_STYLE_INIT,
);

/**
 * Standard + ISO-25 defaults. Sizes are tuned roughly to AutoCAD's
 * out-of-the-box values for each style — Standard is the imperial-ish
 * baseline, ISO-25 is a metric-ish style with larger arrows/text and
 * single-decimal precision.
 */
export function createDefaultDimStyles(): Map<string, DimensionStyle> {
  const m = new Map<string, DimensionStyle>();
  m.set('Standard', new DimensionStyle('Standard', STANDARD_DIM_STYLE_INIT));
  m.set('ISO-25', new DimensionStyle('ISO-25', {
    arrowSize: 3.5,
    arrowAspect: 3,
    arrowType: 'closed',
    extensionGap: 1.25,
    extensionPast: 1.25,
    textHeight: 3.5,
    textOffset: 5,
    jogAngle: Math.PI / 4,
    jogHeightFactor: 1.5,
    unitFormat: 'decimal',
    unitPrecision: 1,
  }));
  return m;
}
