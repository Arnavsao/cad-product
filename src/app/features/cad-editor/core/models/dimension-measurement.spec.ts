import { DimensionEntity } from './entity-extended.model';
import { DimensionStyle, DEFAULT_DIM_STYLE, createDefaultDimStyles } from './dimension-style.model';

/**
 * The measurement half of AutoCAD-parity for imported dimensions.
 *
 * Numbers here come from RTM-S&C-GAD-BR-NO.384-DHD-IND: a bridge GA drawn at
 * plot scale, where every dimension carries a DIMLFAC override in XDATA and
 * the drawing-unit lengths are 1/150th of what the labels read.
 */
describe('DimensionEntity measurement', () => {
  const styleWith = (init: Partial<DimensionStyle>) =>
    new DimensionStyle('test', { unitPrecision: 0, ...init });

  it('applies DIMLFAC so a scaled drawing reports real-world sizes', () => {
    // 68.5333 drawing units at DIMLFAC 150 is the 10280 mm overall slab length.
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 68.5333, y: 0 });
    dim.rotation = 0;
    dim.linearFactor = 150;
    expect(dim.formatMeasurement(styleWith({}))).toBe('10280');
  });

  it('reports the raw length when no factor is set', () => {
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 68.5333, y: 0 });
    dim.rotation = 0;
    expect(dim.formatMeasurement(styleWith({ unitPrecision: 4 }))).toBe('68.5333');
  });

  it('prefers the per-entity factor over the style factor', () => {
    // One drawing routinely mixes factors for details at different scales.
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 20, y: 0 });
    dim.rotation = 0;
    dim.linearFactor = 150;
    expect(dim.formatMeasurement(styleWith({ linearFactor: 50 }))).toBe('3000');
  });

  it('falls back to the style factor when the entity has none', () => {
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 20, y: 0 });
    dim.rotation = 0;
    expect(dim.formatMeasurement(styleWith({ linearFactor: 50 }))).toBe('1000');
  });

  it('treats a zero or negative factor as 1 rather than collapsing the value', () => {
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 20, y: 0 });
    dim.rotation = 0;
    dim.linearFactor = 0;
    expect(dim.formatMeasurement(styleWith({}))).toBe('20');
  });

  it('honours DIMDEC, so a style asking for 0 decimals gets none', () => {
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 0.1333, y: 0 });
    dim.rotation = 0;
    dim.linearFactor = 150;
    expect(dim.formatMeasurement(styleWith({ unitPrecision: 0 }))).toBe('20');
  });

  it('measures the projection for a rotated dimension, not the diagonal', () => {
    // p1->p2 spans 2.48 units diagonally but only 0.2503 along the 0deg axis;
    // AutoCAD labels it 25 at DIMLFAC 100.
    const dim = new DimensionEntity({ x: 92.12203618, y: 166.03339612 }, { x: 91.87173779, y: 168.50071002 });
    dim.rotation = 0;
    dim.linearFactor = 100;
    expect(dim.formatMeasurement(styleWith({}))).toBe('25');
  });

  it('measures point-to-point for an aligned dimension', () => {
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 3, y: 4 });
    expect(dim.rotation).toBeNull();
    expect(dim.formatMeasurement(styleWith({}))).toBe('5');
  });

  it('substitutes <> in a text override with the scaled measurement', () => {
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 0.1333, y: 0 });
    dim.rotation = 0;
    dim.linearFactor = 150;
    dim.textOverride = '<>mm GAP';
    expect(dim.resolveDisplayText(styleWith({}))).toBe('20mm GAP');
  });

  it('leaves a literal override alone, factor or not', () => {
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 65.26, y: 0 });
    dim.rotation = 0;
    dim.linearFactor = 50;
    dim.textOverride = '10280\\X(OVERALL SLAB LENGTH)';
    expect(dim.resolveDisplayText(styleWith({}))).toBe('10280\\X(OVERALL SLAB LENGTH)');
  });
});

describe('DimensionEntity visual scale', () => {
  it('prefers the per-entity DIMSCALE over the style', () => {
    // ECSL_150 sets DIMSCALE 150 while every entity overrides back to 1;
    // taking the style value alone renders text and arrows 150x oversized.
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 10, y: 0 });
    dim.globalScale = 1;
    expect(dim.effectiveGlobalScale(new DimensionStyle('s', { globalScale: 150 }))).toBe(1);
  });

  it('uses the style scale when the entity has no override', () => {
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dim.effectiveGlobalScale(new DimensionStyle('s', { globalScale: 150 }))).toBe(150);
  });

  it('treats DXF DIMSCALE 0 ("derive from annotation scale") as 1', () => {
    const dim = new DimensionEntity({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dim.effectiveGlobalScale(new DimensionStyle('s', { globalScale: 0 }))).toBe(1);
  });
});

describe('dimension style defaults', () => {
  it('renders a missing style the same as a present Standard', () => {
    // These two used to disagree: the fallback had unitPrecision 2 and the map
    // entry 4, so an unresolved style silently changed the reading.
    const standard = createDefaultDimStyles().get('Standard')!;
    expect(DEFAULT_DIM_STYLE.unitPrecision).toBe(standard.unitPrecision);
    expect(DEFAULT_DIM_STYLE.extensionGap).toBe(standard.extensionGap);
    expect(DEFAULT_DIM_STYLE.extensionPast).toBe(standard.extensionPast);
  });

  it('defaults linearFactor to 1 so unscaled drawings are unaffected', () => {
    expect(new DimensionStyle('x').linearFactor).toBe(1);
  });
});
