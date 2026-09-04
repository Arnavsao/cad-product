import { DXF_ACI_COLORS } from '../registries/aci-colors';
import { LINETYPE_DEFINITIONS } from '../registries/linetype-definitions';
import { getActiveCanvasPalette } from '../services/theme.service';
import { displayColor } from '../utils/theme-color-mapper';
import { mapColorForPlot, PlotStyle } from '../utils/plot-color-mapper';

export interface IPoint {
  x: number;
  y: number;
}

export interface IBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ISnapPoint extends IPoint {
  label?: string;
}

export interface IPropertySchema {
  key: string;
  label: string;
  /** number | boolean | color | layer | linetype | lineweight | dropdown | hatch-pattern | read-only | text (default) */
  type: string;
  category?: string;
  precision?: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  editable?: boolean;
  readOnly?: boolean;
  value?: unknown;
  /** Dropdown options. For `hatch-pattern`, defaults to Object.keys(HATCH_PATTERNS). */
  options?: string[];
}

// Loose types — these get tightened once we port DocumentService + ViewModelService.
// Keep `any` here so model classes have zero Angular dependency (per conversion rule 2).
export type DocLike = any;
export type ViewModelLike = any;

export let _getEntityIdFn: () => number = () => {
  return _fallbackEid++;
};
let _fallbackEid = 1;

export function setEntityIdGenerator(fn: () => number) {
  _getEntityIdFn = fn;
}

export function getNextEntityId(): number {
  return _getEntityIdFn();
}

export interface DxfTag {
  code: number;
  value: string | number | boolean;
}

export interface RawDxfObject {
  handle: string;
  ownerHandle: string;
  entityType: string;
  originalTags: DxfTag[];
}

export class Entity {
  id: number;
  type: string;

  // AC1032 properties
  handle?: string; // Group 5
  ownerHandle?: string; // Group 330
  layer = 'Layer 0'; // Group 8
  colorNumber = 256;          // 256 = BYLAYER, 0 = BYBLOCK
  color: string | null = null; // Optional RGB direct override
  lineType = 'BYLAYER';
  lineTypeScale = 1.0;
  lineWeight = -1;            // -1 = BYLAYER, -2 = BYBLOCK, -3 = DEFAULT
  visible = true;             // Group 60
  plotStyle?: string;
  transparency?: number;
  material?: string;
  inPaperSpace = false; // Phase 3: Paper space flag

  // XDATA & Dictionaries
  xdata?: Record<string, any>;
  extensionDictionaries?: Record<string, any>;
  rawDxfObject?: RawDxfObject; // Full original block for export

  // Selection / Editor State
  selected = false;
  drawOrder = 0;

  /**
   * Monotonic geometry revision. Bumped by `refreshCaches()` whenever cached
   * geometry is invalidated, which is the project's universal signal that the
   * entity's renderable shape may have changed. Consumed by the spatial index,
   * topology cache, and (later) the hatch dependency graph to detect staleness
   * without diffing field-by-field.
   */
  revision = 0;

  // Cache fields (invalidated on edit).
  protected _bbox: IBBox | null = null;
  protected _snapPoints: ISnapPoint[] | null = null;
  protected lineWidth?: number;

  // Allow free-form properties (subclasses add fields dynamically; tools/services
  // may stamp metadata onto entities).
  [key: string]: any;

  constructor(type: string) {
    this.id = getNextEntityId();
    this.type = type;
  }

  /** Resolved STORED CAD color (handles BYLAYER, BYBLOCK, ACI, or RGB).
   *  Returns the raw color as it lives in the document — NO theme mapping.
   *  Use this for DXF export, properties UI, and anywhere the actual CAD
   *  data matters. For on-screen rendering, use `resolvedDisplayColor`. */
  resolvedColor(doc: DocLike, byBlockColor: string | null = null): string {
    if (this.color) return this.color;
    if (this.colorNumber === 0) return byBlockColor || '#ffffff';
    if (this.colorNumber !== 256 && this.colorNumber >= 0 && this.colorNumber < 256) {
      return DXF_ACI_COLORS[this.colorNumber];
    }
    const lay = doc?.layers?.get(this.layer);
    return lay ? lay.color : '#ffffff';
  }

  /** Display color for the editor canvas. Maps stored white↔black per active
   *  editor theme; passes other colors through. Editor-only — exporters MUST
   *  use `resolvedPlotColor` instead so the user's plot-style choice applies. */
  resolvedDisplayColor(doc: DocLike, byBlockColor: string | null = null): string {
    return displayColor(this.resolvedColor(doc, byBlockColor), doc);
  }

  /** Plot color for PDF/PNG export. Applies the .ctb-equivalent plot style
   *  (color / monochrome / grayscale) on top of the stored CAD color. Theme
   *  has no input here — only IPlotOptions.plotStyle + IPlotOptions.background. */
  resolvedPlotColor(
    doc: DocLike,
    plotStyle: PlotStyle,
    lightBg: boolean,
    byBlockColor: string | null = null,
  ): string {
    return mapColorForPlot(
      this.resolvedColor(doc, byBlockColor),
      { style: plotStyle, lightBg },
    );
  }

  /** Setup common canvas properties before drawing */
  setupContext(
    ctx: CanvasRenderingContext2D,
    vm: ViewModelLike,
    doc: DocLike,
    byBlockColor: string | null = null,
  ): void {
    // Plot pipeline (PDF preview / PNG export) sets `_plotStyle` + `_plotLightBg`
    // on the doc just before draw. Honor that so non-PDF exporters that route
    // through entity.draw() still respect Color / Monochrome / Grayscale.
    // Editor canvas leaves these undefined → falls back to display mapping.
    if (doc?._plotStyle) {
      ctx.strokeStyle = this.resolvedPlotColor(
        doc,
        doc._plotStyle as PlotStyle,
        !!doc._plotLightBg,
        byBlockColor,
      );
    } else {
      ctx.strokeStyle = this.resolvedDisplayColor(doc, byBlockColor);
    }
    ctx.fillStyle = ctx.strokeStyle;

    // Lineweights stored as hundredths of mm (e.g. 25 = 0.25 mm).
    // Convert to screen px at 96 dpi = 3.7795 px/mm.
    const PX_PER_MM = 3.7795;
    let lw = this.lineWeight;

    if (lw <= 0) {
      const lay = doc?.layers?.get(this.layer);
      if (lay && lay.lineWeight > 0) lw = lay.lineWeight;
      else lw = 25; // default 0.25 mm
    }
    const lw_mm = lw / 100;
    ctx.lineWidth = Math.max(1, lw_mm * PX_PER_MM);

    // Linetype resolution (case-insensitive)
    let ltName = (this.lineType || 'BYLAYER').toUpperCase();
    if (ltName === 'BYLAYER') {
      const lay = doc?.layers?.get(this.layer);
      if (lay && lay.lineType) ltName = lay.lineType.toUpperCase();
    }
    if (ltName === 'BYBLOCK') ltName = 'CONTINUOUS';

    if (ltName === 'CONTINUOUS' || ltName === '' || ltName === 'BYLAYER') {
      ctx.setLineDash([]);
      return;
    }

    let basePattern: number[] | null = null;
    if (doc?.lineTypes) {
      (doc.lineTypes as Map<string, { pattern: number[] }>).forEach((v, k) => {
        if (k.toUpperCase() === ltName) {
          basePattern = v.pattern;
        }
      });
    }
    if (!basePattern && LINETYPE_DEFINITIONS[ltName]) {
      basePattern = LINETYPE_DEFINITIONS[ltName].pattern;
    }

    if (!basePattern || basePattern.length === 0) {
      ctx.setLineDash([]);
      return;
    }

    const globalLtScale = (typeof window !== 'undefined' && (window as any).LTSCALE) || 1.0;
    const entityLtScale = Math.max(0.001, this.lineTypeScale || 1.0);
    const scaleFactor = globalLtScale * entityLtScale * (vm?.scale ?? 1);

    const dashArray = basePattern.map((v: number) => {
      const px = Math.abs(v) * scaleFactor;
      return Math.max(px, v === 0 ? 1 : 0.5);
    });

    if (dashArray.some((v: number) => v > 0.5)) ctx.setLineDash(dashArray);
    else ctx.setLineDash([]);
  }

  /** Override in subclass: draw entity on ctx with ViewModel vm */
  draw(_ctx: CanvasRenderingContext2D, _vm: ViewModelLike, _doc: DocLike, _byBlockColor: string | null = null): void {
    /* override */
  }

  /** Override: snap candidate points */
  snapPoints(): ISnapPoint[] {
    return [];
  }

  /** Override: rough bounding box in world coords */
  bbox(): IBBox | null {
    return null;
  }

  /** Fast bounding box approximation for spatial indexing. */
  fastBbox(): IBBox | null {
    return this.bbox();
  }

  /** Override: hit-test against screen-space point */
  hitTest(_sx: number, _sy: number, _vm: ViewModelLike, _tol = 6): boolean {
    return false;
  }

  /** Override: get dynamic measurement string for dimensions */
  getMeasurementText(doc: DocLike): string {
    return '';
  }

  /** Draw selection highlight (dashed accent overlay) */
  drawSelected(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    if (!this.selected) return;
    ctx.save();
    ctx.strokeStyle = getActiveCanvasPalette().selection;
    ctx.lineWidth = (this.lineWidth || 1) + 2;
    ctx.setLineDash([6, 4]);
    ctx.globalAlpha = 0.55;
    this.draw(ctx, vm, doc, byBlockColor);
    ctx.restore();
  }

  /**
   * Draw preselection (hover) highlight — dashed accent overlay shown when the
   * cursor hovers over an entity in modify-tool modes (fillet, chamfer, trim,
   * extend, join, match-properties, etc.). Reusable across all tools.
   *
   * @param style  Optional override: `'hover'` (default) for preselection glow,
   *               `'selected'` for a persistent first-selection highlight,
   *               `'target'` for a cyan target highlight (EXTEND tool).
   */
  drawHovered(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, style: 'hover' | 'selected' | 'target' | 'preview' = 'hover'): void {
    const palette = getActiveCanvasPalette();
    ctx.save();
    if (style === 'selected') {
      ctx.strokeStyle = palette.selection;
      ctx.lineWidth = (this.lineWidth || 1) + 2.5;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.9;
    } else if (style === 'target') {
      ctx.strokeStyle = palette.target;
      ctx.lineWidth = (this.lineWidth || 1) + 2.5;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.9;
    } else if (style === 'preview') {
      // Blue selection preview glow
      ctx.strokeStyle = 'rgba(0, 153, 255, 0.85)';
      ctx.lineWidth = (this.lineWidth || 1) + 3;
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.95;
    } else {
      ctx.strokeStyle = palette.hover;
      ctx.lineWidth = (this.lineWidth || 1) + 2;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.85;
    }
    this.draw(ctx, vm, doc);
    ctx.restore();
  }

  /**
   * Resolve the effective (displayed) value for a property key.
   * The base implementation returns `this[key]`. Subclasses override this
   * to resolve null/undefined through cascading defaults (e.g. DimensionEntity
   * resolves through DimensionStyle).
   *
   * The Properties Panel calls this instead of reading `entity[key]` directly
   * so that inputs never appear empty when the entity has an effective value.
   */
  getEffectivePropertyValue(key: string, _doc?: any): any {
    return (this as any)[key];
  }

  /** Default property schema (subclasses extend) */
  getPropertiesSchema(): IPropertySchema[] {
    return [
      { key: 'layer', label: 'Layer', type: 'layer', category: 'General' },
      { key: 'colorNumber', label: 'Color', type: 'color', category: 'General' },
      { key: 'lineType', label: 'Linetype', type: 'linetype', category: 'General' },
      { key: 'lineTypeScale', label: 'Linetype Scale', type: 'number', category: 'General', precision: 2, step: 0.1, min: 0.01 },
      { key: 'lineWeight', label: 'Lineweight', type: 'lineweight', category: 'General' },
      { key: 'drawOrder', label: 'Draw Order', type: 'number', category: 'General', readOnly: true },
    ];
  }

  /** Apply a property change, then trigger dependent geometry resolution */
  applyPropertyChange(key: string, value: any): void {
    switch (key) {
      case 'layer':
      case 'colorNumber':
      case 'color':
      case 'lineType':
        (this as any)[key] = value;
        if (key === 'color' && value) this.colorNumber = -1;
        if (key === 'colorNumber' && value !== -1) this.color = null;
        break;
      case 'lineWeight':
        this.lineWeight = parseInt(value, 10);
        break;
      case 'lineTypeScale':
        this.lineTypeScale = Math.max(0.001, Math.min(100, parseFloat(value)));
        break;
      default:
        (this as any)[key] = value;
        break;
    }
    this.resolveDependentGeometry(key);
    this.refreshCaches();
  }

  /** Invalidate cached geometry — also bumps `revision` so downstream
   *  indexes (spatial, topology, hatch deps) can detect the change. */
  refreshCaches(): void {
    this._bbox = null;
    this._snapPoints = null;
    this.revision++;
  }

  /** Override: resolve dependent properties after a property change */
  resolveDependentGeometry(_triggerKey: string): void {
    /* override */
  }

  /** Draw grip handles at snap points. Snap-point cache is invalidated by
   *  `refreshCaches()` whenever geometry mutates (every grip drag, every
   *  command), so reading the cached value here is safe and avoids
   *  re-bucketing endpoints / midpoints on every redraw frame. */
  drawGrips(ctx: CanvasRenderingContext2D, vm: ViewModelLike): void {
    const palette = getActiveCanvasPalette();
    ctx.save();
    ctx.fillStyle = this.selected ? palette.gripFillSelected : palette.gripFillUnselected;
    for (const pt of this.snapPoints()) {
      const s = vm.w2s(pt.x, pt.y);
      ctx.beginPath();
      ctx.rect(s.x - 3, s.y - 3, 6, 6);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Deep-clone this entity into a fresh instance with a new id */
  clone(): this {
    const fresh = Object.create(Object.getPrototypeOf(this)) as this;
    fresh.id = getNextEntityId();
    for (const key of Object.keys(this)) {
      if (key === 'id' || key === 'selected') continue;
      const val = (this as any)[key];
      if (Array.isArray(val)) {
        // Deep-clone arrays: if the element is itself an array (e.g. IHatchEdge[][])
        // clone that inner array too; otherwise shallow-clone plain objects.
        (fresh as any)[key] = val.map((v: any) => {
          if (Array.isArray(v)) return v.map((vv: any) => (vv && typeof vv === 'object' ? { ...vv } : vv));
          return v && typeof v === 'object' ? { ...v } : v;
        });
      } else {
        (fresh as any)[key] = val;
      }
    }
    fresh.selected = false;
    return fresh;
  }
}

/* ---- POINT ---- */
export class PointEntity extends Entity {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    super('POINT');
    this.x = x;
    this.y = y;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike): void {
    const s = vm.w2s(this.x, this.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    this.setupContext(ctx, vm, doc);
    ctx.fill();
  }

  override snapPoints(): ISnapPoint[] {
    return [{ x: this.x, y: this.y }];
  }

  override bbox(): IBBox {
    return { x: this.x - 0.1, y: this.y - 0.1, w: 0.2, h: 0.2 };
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const s = vm.w2s(this.x, this.y);
    return Math.hypot(sx - s.x, sy - s.y) <= tol;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'x', label: 'Position X', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'y', label: 'Position Y', type: 'number', category: 'Geometry', precision: 3 },
    ];
  }
}

/* ---- LINE ---- */
export class LineEntity extends Entity {
  x1: number;
  y1: number;
  x2: number;
  y2: number;

  constructor(x1: number, y1: number, x2: number, y2: number) {
    super('LINE');
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }

  get length(): number {
    return Math.hypot(this.x2 - this.x1, this.y2 - this.y1);
  }

  get angle(): number {
    return (Math.atan2(this.y2 - this.y1, this.x2 - this.x1) * 180) / Math.PI;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    const a = vm.w2s(this.x1, this.y1);
    const b = vm.w2s(this.x2, this.y2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    this.setupContext(ctx, vm, doc, byBlockColor);
    ctx.stroke();
  }

  override snapPoints(): ISnapPoint[] {
    return [
      { x: this.x1, y: this.y1, label: 'endpoint' },
      { x: this.x2, y: this.y2, label: 'endpoint' },
      { x: (this.x1 + this.x2) / 2, y: (this.y1 + this.y2) / 2, label: 'midpoint' },
    ];
  }

  override bbox(): IBBox {
    if (this._bbox) return this._bbox;
    const x = Math.min(this.x1, this.x2);
    const y = Math.min(this.y1, this.y2);
    this._bbox = { x, y, w: Math.abs(this.x2 - this.x1), h: Math.abs(this.y2 - this.y1) };
    return this._bbox;
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const a = vm.w2s(this.x1, this.y1);
    const b = vm.w2s(this.x2, this.y2);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(sx - a.x, sy - a.y) <= tol;
    const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / len2));
    const px = a.x + t * dx - sx;
    const py = a.y + t * dy - sy;
    return Math.hypot(px, py) <= tol;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'x1', label: 'Start X', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'y1', label: 'Start Y', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'x2', label: 'End X', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'y2', label: 'End Y', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'length', label: 'Length', type: 'number', category: 'Geometry', precision: 3, editable: true },
      { key: 'angle', label: 'Angle', type: 'number', category: 'Geometry', precision: 1, suffix: '°' },
    ];
  }

  override applyPropertyChange(key: string, value: any): void {
    if (key === 'length') {
      const dx = this.x2 - this.x1;
      const dy = this.y2 - this.y1;
      const ang = Math.atan2(dy, dx);
      const len = Math.max(0.001, parseFloat(value));
      this.x2 = this.x1 + len * Math.cos(ang);
      this.y2 = this.y1 + len * Math.sin(ang);
    } else if (key === 'angle') {
      const dx = this.x2 - this.x1;
      const dy = this.y2 - this.y1;
      const len = Math.hypot(dx, dy);
      const ang = (parseFloat(value) * Math.PI) / 180;
      this.x2 = this.x1 + len * Math.cos(ang);
      this.y2 = this.y1 + len * Math.sin(ang);
    } else {
      super.applyPropertyChange(key, value);
    }
  }
}

/* ---- CIRCLE ---- */
export class CircleEntity extends Entity {
  cx: number;
  cy: number;
  r: number;

  constructor(cx: number, cy: number, r: number) {
    super('CIRCLE');
    this.cx = cx;
    this.cy = cy;
    this.r = r;
  }

  get diameter(): number {
    return this.r * 2;
  }

  get area(): number {
    return Math.PI * this.r * this.r;
  }

  get circumference(): number {
    return 2 * Math.PI * this.r;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    ctx.beginPath();
    safeCanvasArc(ctx, vm, this.cx, this.cy, this.r, 0, 2 * Math.PI, true);
    this.setupContext(ctx, vm, doc, byBlockColor);
    ctx.stroke();
  }

  override snapPoints(): ISnapPoint[] {
    return [
      { x: this.cx, y: this.cy, label: 'center' },
      { x: this.cx + this.r, y: this.cy, label: 'quadrant' },
      { x: this.cx - this.r, y: this.cy, label: 'quadrant' },
      { x: this.cx, y: this.cy + this.r, label: 'quadrant' },
      { x: this.cx, y: this.cy - this.r, label: 'quadrant' },
    ];
  }

  override bbox(): IBBox {
    if (this._bbox) return this._bbox;
    this._bbox = { x: this.cx - this.r, y: this.cy - this.r, w: this.r * 2, h: this.r * 2 };
    return this._bbox;
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const c = vm.w2s(this.cx, this.cy);
    const rS = this.r * (vm.cumulativeScale ?? vm.scale);
    const dst = Math.hypot(sx - c.x, sy - c.y);
    return Math.abs(dst - rS) <= tol;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'cx', label: 'Center X', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'cy', label: 'Center Y', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'r', label: 'Radius', type: 'number', category: 'Geometry', precision: 3, min: 0.001 },
      { key: 'diameter', label: 'Diameter', type: 'number', category: 'Geometry', precision: 3, min: 0.002 },
      { key: 'area', label: 'Area', type: 'number', category: 'Geometry', precision: 3, readOnly: true },
      { key: 'circumference', label: 'Circumference', type: 'number', category: 'Geometry', precision: 3, readOnly: true },
    ];
  }

  override applyPropertyChange(key: string, value: any): void {
    if (key === 'diameter') {
      const d = Math.max(0.001, parseFloat(value));
      this.r = d / 2;
    } else if (key === 'r') {
      this.r = Math.max(0.0005, parseFloat(value));
    } else {
      super.applyPropertyChange(key, value);
    }
    this.resolveDependentGeometry(key);
  }
}

/* ---- ARC ---- */
export class ArcEntity extends Entity {
  cx: number;
  cy: number;
  r: number;
  startAngle: number; // degrees, CCW from +X
  endAngle: number;
  ccw: boolean;

  constructor(cx: number, cy: number, r: number, startAngle: number, endAngle: number, ccw = true) {
    super('ARC');
    this.cx = cx;
    this.cy = cy;
    this.r = r;
    this.startAngle = startAngle;
    this.endAngle = endAngle;
    this.ccw = ccw;
  }

  get arcLength(): number {
    return (Math.abs(this.getSweep()) * Math.PI) / 180 * this.r;
  }

  private _sa(): number {
    return (-this.startAngle * Math.PI) / 180;
  }

  private _ea(): number {
    return (-this.endAngle * Math.PI) / 180;
  }

  getStartPoint(): IPoint {
    const a = (this.startAngle * Math.PI) / 180;
    return { x: this.cx + this.r * Math.cos(a), y: this.cy + this.r * Math.sin(a) };
  }

  getEndPoint(): IPoint {
    const a = (this.endAngle * Math.PI) / 180;
    return { x: this.cx + this.r * Math.cos(a), y: this.cy + this.r * Math.sin(a) };
  }

  getMidPoint(): IPoint {
    const ma = (this._angleAtSweepFraction(0.5) * Math.PI) / 180;
    return { x: this.cx + this.r * Math.cos(ma), y: this.cy + this.r * Math.sin(ma) };
  }

  getSweep(): number {
    const norm = (a: number) => ((a % 360) + 360) % 360;
    const sa = norm(this.startAngle);
    const ea = norm(this.endAngle);
    return this.ccw ? ((ea - sa + 360) % 360 || 360) : -((sa - ea + 360) % 360 || 360);
  }

  private _angleAtSweepFraction(fraction: number): number {
    return this.startAngle + this.getSweep() * fraction;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    const startA = (this.startAngle * Math.PI) / 180;
    const endA = (this.endAngle * Math.PI) / 180;
    ctx.beginPath();
    safeCanvasArc(ctx, vm, this.cx, this.cy, this.r, startA, endA, this.ccw);
    this.setupContext(ctx, vm, doc, byBlockColor);
    ctx.stroke();
  }

  override snapPoints(): ISnapPoint[] {
    const sa = (this.startAngle * Math.PI) / 180;
    const ea = (this.endAngle * Math.PI) / 180;
    const ma = (this._angleAtSweepFraction(0.5) * Math.PI) / 180;
    const pts: ISnapPoint[] = [
      { x: this.cx + this.r * Math.cos(sa), y: this.cy + this.r * Math.sin(sa), label: 'endpoint' },
      { x: this.cx + this.r * Math.cos(ea), y: this.cy + this.r * Math.sin(ea), label: 'endpoint' },
      { x: this.cx + this.r * Math.cos(ma), y: this.cy + this.r * Math.sin(ma), label: 'midpoint' },
      { x: this.cx, y: this.cy, label: 'center' },
    ];
    const quads = [0, 90, 180, 270];
    const norm = (a: number) => ((a % 360) + 360) % 360;
    const sn = norm(this.startAngle);
    const sweep = Math.abs(this.getSweep());
    for (const q of quads) {
      const t = this.ccw ? (norm(q) - sn + 360) % 360 : (sn - norm(q) + 360) % 360;
      if (t <= sweep) {
        const qa = (q * Math.PI) / 180;
        pts.push({ x: this.cx + this.r * Math.cos(qa), y: this.cy + this.r * Math.sin(qa), label: 'quadrant' });
      }
    }
    return pts;
  }

  override bbox(): IBBox {
    if (this._bbox) return this._bbox;
    // Tight arc bbox: include endpoints + any swept quadrant extrema
    const saRad = (this.startAngle * Math.PI) / 180;
    const eaRad = (this.endAngle * Math.PI) / 180;
    const sx0 = this.cx + this.r * Math.cos(saRad);
    const sy0 = this.cy + this.r * Math.sin(saRad);
    const ex = this.cx + this.r * Math.cos(eaRad);
    const ey = this.cy + this.r * Math.sin(eaRad);
    let minX = Math.min(sx0, ex), minY = Math.min(sy0, ey);
    let maxX = Math.max(sx0, ex), maxY = Math.max(sy0, ey);
    const norm = (a: number) => ((a % 360) + 360) % 360;
    const sn = norm(this.startAngle);
    const sweep = Math.abs(this.getSweep());
    const quads = [0, 90, 180, 270];
    for (const q of quads) {
      const t = this.ccw ? (norm(q) - sn + 360) % 360 : (sn - norm(q) + 360) % 360;
      if (t <= sweep) {
        const qa = (q * Math.PI) / 180;
        const qx = this.cx + this.r * Math.cos(qa);
        const qy = this.cy + this.r * Math.sin(qa);
        if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
      }
    }
    this._bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    return this._bbox;
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const c = vm.w2s(this.cx, this.cy);
    const rS = this.r * (vm.cumulativeScale ?? vm.scale);
    if (Math.abs(Math.hypot(sx - c.x, sy - c.y) - rS) > tol) return false;
    const angle = (Math.atan2(-(sy - c.y), sx - c.x) * 180) / Math.PI;
    const norm = (a: number) => ((a % 360) + 360) % 360;
    const sa = norm(this.startAngle);
    const sweep = Math.abs(this.getSweep());
    const t = this.ccw ? (norm(angle) - sa + 360) % 360 : (sa - norm(angle) + 360) % 360;
    return t <= sweep + 5;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'cx', label: 'Center X', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'cy', label: 'Center Y', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'r', label: 'Radius', type: 'number', category: 'Geometry', precision: 3, min: 0.001 },
      { key: 'startAngle', label: 'Start Angle', type: 'number', category: 'Geometry', precision: 1, suffix: '°' },
      { key: 'endAngle', label: 'End Angle', type: 'number', category: 'Geometry', precision: 1, suffix: '°' },
      {
        key: 'arcLength',
        label: 'Arc Length',
        type: 'read-only',
        category: 'Geometry',
        value: ((Math.abs(this.getSweep()) * Math.PI) / 180 * this.r).toFixed(3),
      },
    ];
  }
}

/* ---- POLYLINE bulge helper ---- */
/**
 * Compute arc centre/radius from an AutoCAD-style DXF bulge value.
 * bulge = tan(θ/4) where θ is the signed central angle (+ = CCW, − = CW).
 * Returns null when the chord is degenerate or the arc is essentially straight.
 */

/**
 * Draw a circular arc safely on a canvas.
 * When the screen radius is large (zoomed in far), ctx.arc() with an off-screen
 * center and huge radius causes GPU floating-point precision failures in some
 * browsers — the arc becomes invisible. In that case we sample the arc in world
 * space and project each point to screen, which is always precise.
 *
 * @param startA  start angle in radians (world convention: CCW from +X)
 * @param endA    end angle in radians   (world convention: CCW from +X)
 * @param ccwWorld  true = CCW in world coords (= clockwise on canvas due to Y-flip)
 */
export function safeCanvasArc(
  ctx: CanvasRenderingContext2D,
  vm: ViewModelLike,
  cx: number, cy: number, r: number,
  startA: number, endA: number,
  ccwWorld: boolean,
): void {
  const scale = (vm as any).cumulativeScale ?? (vm as any).scale ?? 1;
  const rS = r * scale;

  // Below this threshold ctx.arc() is reliable on all browsers.
  if (rS < 5000) {
    const c = vm.w2s(cx, cy);
    ctx.arc(c.x, c.y, rS, -startA, -endA, ccwWorld);
    return;
  }

  // Large radius: sample the arc in world space and project to screen.
  // Compute the sweep angle, clamped to ±2π.
  let sweep: number;
  if (ccwWorld) {
    sweep = endA - startA;
    if (sweep <= 0) sweep += 2 * Math.PI;
  } else {
    sweep = endA - startA;
    if (sweep >= 0) sweep -= 2 * Math.PI;
  }

  // Choose step size: ~2 screen-px chord error per segment.
  // chord ≈ rS * dθ → dθ = 2 / rS.  Minimum 32 steps for any arc.
  const absStep = Math.max(2 / rS, Math.abs(sweep) / 1024);
  const steps = Math.ceil(Math.abs(sweep) / absStep);
  const dθ = sweep / steps;

  for (let i = 0; i <= steps; i++) {
    const a = startA + dθ * i;
    const wx = cx + r * Math.cos(a);
    const wy = cy + r * Math.sin(a);
    const s = vm.w2s(wx, wy);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
}

export function arcGeomFromBulge(
  start: IPoint, end: IPoint, bulge: number,
): { cx: number; cy: number; r: number; startA: number; endA: number; ccw: boolean } | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLen = Math.hypot(dx, dy);
  if (chordLen < 1e-9) return null;

  const includedAngle = 4 * Math.atan(bulge);
  const halfAngle = includedAngle / 2;
  const sinH = Math.sin(halfAngle);
  if (Math.abs(sinH) < 1e-12) return null;

  const radius = (chordLen / 2) / sinH; // signed

  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const perpX = -dy / chordLen;
  const perpY = dx / chordLen;

  // Centre offset: r·cos(θ/2) from chord midpoint along perpendicular.
  // Using cos (not sagitta) works for both minor and major arcs.
  const d = Math.abs(radius) * Math.cos(halfAngle);
  const sign = bulge > 0 ? 1 : -1;
  const cx = midX + sign * d * perpX;
  const cy = midY + sign * d * perpY;
  const r = Math.abs(radius);

  return {
    cx, cy, r,
    startA: Math.atan2(start.y - cy, start.x - cx),
    endA: Math.atan2(end.y - cy, end.x - cx),
    ccw: bulge > 0,
  };
}

/* ---- POLYLINE ---- */
export class PolylineEntity extends Entity {
  pts: IPoint[];
  closed: boolean;
  globalWidth?: number;
  /** DXF-style per-vertex bulge values (bulges[i] is the bulge for segment pts[i] → pts[i+1]). */
  bulges?: number[];
  /**
   * DXF segment widths (groups 40/41): widths[i] applies to segment
   * pts[i] → pts[i+1], tapering from `start` to `end`. Absent or all-zero means
   * a hairline stroked at the entity's lineweight.
   */
  widths?: Array<{ start: number; end: number }>;

  constructor(pts: IPoint[], closed = false) {
    super('POLYLINE');
    this.pts = pts;
    this.closed = closed;
  }

  /** True when any segment carries a DXF width and must be drawn as a filled band. */
  get hasWidth(): boolean {
    return !!this.widths?.some((w) => w && (w.start > 0 || w.end > 0));
  }

  /**
   * Draws segments that carry DXF widths as filled bands.
   *
   * A straight segment becomes a quadrilateral tapering between its two
   * widths — so a 0 → w → 0 pair of segments is a filled arrowhead, exactly as
   * AutoCAD draws it. Bulged segments are stroked at their mean width, which is
   * indistinguishable at drawing scale and avoids offsetting an arc.
   */
  private _drawWide(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null): void {
    this.setupContext(ctx, vm, doc, byBlockColor);
    ctx.setLineDash([]);
    const hairline = ctx.lineWidth;
    const n = this.pts.length;
    const segCount = this.closed ? n : n - 1;
    const scale = vm.cumulativeScale ?? vm.scale;

    for (let i = 0; i < segCount; i++) {
      const j = (i + 1) % n;
      const w = this.widths?.[i] ?? { start: 0, end: 0 };
      const bulge = this.bulges?.[i] ?? 0;
      const a = vm.w2s(this.pts[i].x, this.pts[i].y);
      const b = vm.w2s(this.pts[j].x, this.pts[j].y);

      if (Math.abs(bulge) > 1e-9) {
        const g = arcGeomFromBulge(this.pts[i], this.pts[j], bulge);
        ctx.beginPath();
        if (g) {
          const cS = vm.w2s(g.cx, g.cy);
          const sS = vm.w2s(g.cx + g.r * Math.cos(g.startA), g.cy + g.r * Math.sin(g.startA));
          ctx.arc(cS.x, cS.y, Math.hypot(sS.x - cS.x, sS.y - cS.y), -g.startA, -g.endA, g.ccw);
        } else {
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        ctx.lineWidth = Math.max(hairline, ((w.start + w.end) / 2) * scale);
        ctx.stroke();
        continue;
      }

      if (w.start <= 0 && w.end <= 0) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.lineWidth = hairline;
        ctx.stroke();
        continue;
      }

      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const nx = -dy / len, ny = dx / len;
      const hs = (w.start * scale) / 2, he = (w.end * scale) / 2;
      ctx.beginPath();
      ctx.moveTo(a.x + nx * hs, a.y + ny * hs);
      ctx.lineTo(b.x + nx * he, b.y + ny * he);
      ctx.lineTo(b.x - nx * he, b.y - ny * he);
      ctx.lineTo(a.x - nx * hs, a.y - ny * hs);
      ctx.closePath();
      ctx.fill();
    }
  }

  get length(): number {
    let len = 0;
    const count = this.closed ? this.pts.length : this.pts.length - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % this.pts.length;
      len += Math.hypot(this.pts[j].x - this.pts[i].x, this.pts[j].y - this.pts[i].y);
    }
    return len;
  }

  get area(): number {
    if (!this.closed || this.pts.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < this.pts.length; i++) {
      const j = (i + 1) % this.pts.length;
      area += this.pts[i].x * this.pts[j].y;
      area -= this.pts[j].x * this.pts[i].y;
    }
    return Math.abs(area) / 2;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    if (this.pts.length < 2) return;
    if (this.hasWidth) { this._drawWide(ctx, vm, doc, byBlockColor); return; }
    ctx.beginPath();
    const p0 = vm.w2s(this.pts[0].x, this.pts[0].y);
    ctx.moveTo(p0.x, p0.y);
    const segCount = this.closed ? this.pts.length : this.pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const j = (i + 1) % this.pts.length;
      const bulge = this.bulges?.[i] ?? 0;
      if (Math.abs(bulge) > 1e-9) {
        const g = arcGeomFromBulge(this.pts[i], this.pts[j], bulge);
        if (g) {
          const cS = vm.w2s(g.cx, g.cy);
          const sS = vm.w2s(g.cx + g.r * Math.cos(g.startA), g.cy + g.r * Math.sin(g.startA));
          const rS = Math.hypot(sS.x - cS.x, sS.y - cS.y);
          ctx.arc(cS.x, cS.y, rS, -g.startA, -g.endA, g.ccw);
        } else {
          const p = vm.w2s(this.pts[j].x, this.pts[j].y);
          ctx.lineTo(p.x, p.y);
        }
      } else {
        const p = vm.w2s(this.pts[j].x, this.pts[j].y);
        ctx.lineTo(p.x, p.y);
      }
    }
    if (this.closed) ctx.closePath();
    this.setupContext(ctx, vm, doc, byBlockColor);
    ctx.stroke();
  }

  override snapPoints(): ISnapPoint[] {
    const out: ISnapPoint[] = [];
    this.pts.forEach((p, i) => {
      out.push({ x: p.x, y: p.y, label: i === 0 || i === this.pts.length - 1 ? 'endpoint' : 'vertex' });
      if (i < this.pts.length - 1) {
        out.push({ x: (p.x + this.pts[i + 1].x) / 2, y: (p.y + this.pts[i + 1].y) / 2, label: 'midpoint' });
      }
    });
    if (this.closed && this.pts.length > 2) {
      const first = this.pts[0];
      const last = this.pts[this.pts.length - 1];
      if (Math.hypot(last.x - first.x, last.y - first.y) > 1e-9) {
        out.push({ x: (last.x + first.x) / 2, y: (last.y + first.y) / 2, label: 'midpoint' });
      }
    }
    return out;
  }

  override bbox(): IBBox {
    if (this._bbox) return this._bbox;
    if (!this.pts.length) { this._bbox = { x: 0, y: 0, w: 0, h: 0 }; return this._bbox; }
    let minX = this.pts[0].x, minY = this.pts[0].y, maxX = minX, maxY = minY;
    for (let i = 1; i < this.pts.length; i++) {
      const p = this.pts[i];
      if (p.x < minX) minX = p.x; else if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; else if (p.y > maxY) maxY = p.y;
    }
    this._bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    return this._bbox;
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike, tol = 6): boolean {
    const segmentCount = this.closed ? this.pts.length : this.pts.length - 1;
    for (let i = 0; i < segmentCount; i++) {
      const j = (i + 1) % this.pts.length;
      if (i === j) continue;
      const bulge = this.bulges?.[i] ?? 0;

      if (Math.abs(bulge) > 1e-9) {
        // Arc segment: check if point is at ~radius distance from centre within sweep
        const g = arcGeomFromBulge(this.pts[i], this.pts[j], bulge);
        if (g) {
          const cS = vm.w2s(g.cx, g.cy);
          const rS = Math.hypot(vm.w2s(g.cx + g.r, g.cy).x - cS.x, 0);
          const distFromCenter = Math.hypot(sx - cS.x, sy - cS.y);
          if (Math.abs(distFromCenter - rS) <= tol) {
            // Also check angle is within arc sweep
            const screenAngle = -Math.atan2(sy - cS.y, sx - cS.x); // world angle
            const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            const sa = norm(g.startA);
            let sweep = norm(g.endA - g.startA);
            if (!g.ccw) sweep = norm(g.startA - g.endA);
            const t = g.ccw ? norm(screenAngle - g.startA) : norm(g.startA - screenAngle);
            if (t <= sweep + 0.1) return true;
          }
        }
      } else {
        const a = vm.w2s(this.pts[i].x, this.pts[i].y);
        const b = vm.w2s(this.pts[j].x, this.pts[j].y);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-12) continue;
        const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / len2));
        if (Math.hypot(a.x + t * dx - sx, a.y + t * dy - sy) <= tol) return true;
      }
    }
    return false;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'closed', label: 'Closed', type: 'boolean', category: 'Geometry' },
      { key: 'globalWidth', label: 'Global width', type: 'number', category: 'Geometry', precision: 2 },
      { key: 'length', label: 'Length', type: 'number', category: 'Geometry', precision: 3, readOnly: true },
      { key: 'area', label: 'Area', type: 'number', category: 'Geometry', precision: 3, readOnly: true },
      {
        key: 'vertexCount',
        label: 'Vertex Count',
        type: 'number',
        category: 'Geometry',
        value: this.pts.length,
        readOnly: true,
      },
    ];
  }

  override applyPropertyChange(key: string, value: any): void {
    if (key === 'closed') {
      this.closed = !!value;
    } else {
      super.applyPropertyChange(key, value);
    }
  }
}

/* ---- RECTANGLE (factory — stored as closed polyline) ---- */
export function makeRect(x1: number, y1: number, x2: number, y2: number): PolylineEntity {
  return new PolylineEntity(
    [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ],
    true,
  );
}
