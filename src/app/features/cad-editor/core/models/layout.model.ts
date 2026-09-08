/**
 * Layout / Paper Space data model.
 *
 * A Layout represents an AutoCAD-style "Paper Space" sheet:
 *   - One or more PaperViewports that look into Model Space
 *   - Paper-space entities (title blocks, annotations, tables)
 *   - A PageSetup (paper size, orientation, scale, margins)
 *
 * The Model tab is represented as a special singleton Layout with `isModel = true`.
 * It has no viewports and no paper-space entities — just the raw model draw.
 */
import type { Entity } from './entity.model';
import type { PlotPaper, PlotOrientation, PlotScale, PlotStyle } from './plot-options.model';
import { getPaperSizeMm } from './plot-options.model';

// ─── ID generator ─────────────────────────────────────────────────────────────

let _layoutId = 1;
let _vpId     = 1;

export function generateLayoutId(): string {
  return 'layout_' + (_layoutId++);
}

export function generatePaperViewportId(): string {
  return 'pvp_' + (_vpId++);
}

// ─── Page Setup ───────────────────────────────────────────────────────────────

/**
 * AutoCAD-style Page Setup (equivalent to a named .ctb page setup).
 * Saved separately from a layout so setups can be reused across sheets.
 */
export interface IPageSetup {
  /** Optional name for a saved/reusable setup (e.g. "A1 Landscape PDF"). */
  name?: string;
  paper: PlotPaper;
  /** Only used when paper === 'Custom'. */
  customPaperMm?: { w: number; h: number };
  orientation: PlotOrientation;
  /** 'fit' = auto-scale to page; number = world-units per mm ratio. */
  scale: PlotScale;
  /** Page margins in mm. */
  margins: { top: number; bottom: number; left: number; right: number };
  plotStyle: PlotStyle;
  dpi: number;
  /** Show a plot stamp in the printable area. */
  plotStamp: boolean;
}

export function defaultPageSetup(paper: PlotPaper = 'A4'): IPageSetup {
  return {
    paper,
    orientation: 'landscape',
    scale: 'fit',
    margins: { top: 10, bottom: 10, left: 10, right: 10 },
    plotStyle: 'color',
    dpi: 300,
    plotStamp: false,
  };
}

/** Resolve the final mm dimensions of a page setup (orientation applied). */
export function resolvePageSetupMm(setup: IPageSetup): { w: number; h: number } {
  const raw = getPaperSizeMm(setup.paper, setup.customPaperMm);
  if (setup.orientation === 'portrait') {
    return { w: Math.min(raw.w, raw.h), h: Math.max(raw.w, raw.h) };
  }
  return { w: Math.max(raw.w, raw.h), h: Math.min(raw.w, raw.h) };
}

// ─── Paper-Space Viewport ─────────────────────────────────────────────────────

/**
 * A "window into Model Space" placed on a paper sheet.
 *
 * Paper-space coordinates are in millimetres, relative to the sheet's lower-left
 * corner (origin = (0, 0), X right, Y up — matching AutoCAD paper space).
 *
 * camCenterX/Y is the model-space world point visible at the centre of this
 * viewport. camScale = world-units per paper-mm (e.g. for 1:100, camScale = 100).
 */
export class PaperViewport {
  readonly id: string;
  name: string;

  // Backing fields, used when the viewport was created in the editor. A
  // viewport adopted from a DXF VIEWPORT entity reads and writes the entity
  // instead (see `sourceEntity`), so the drawing round-trips through export
  // without a separate sync step.
  private _x = 0;
  private _y = 0;
  private _w = 0;
  private _h = 0;
  private _camCenterX = 0;
  private _camCenterY = 0;
  private _camScale = 1;

  // ── Paper placement (mm from sheet lower-left origin) ──

  /** Left edge. */
  get x(): number { const s = this.sourceEntity; return s ? s.cx - s.w / 2 : this._x; }
  set x(v: number) { const s = this.sourceEntity; if (s) s.cx = v + s.w / 2; else this._x = v; }

  /** Bottom edge. */
  get y(): number { const s = this.sourceEntity; return s ? s.cy - s.h / 2 : this._y; }
  set y(v: number) { const s = this.sourceEntity; if (s) s.cy = v + s.h / 2; else this._y = v; }

  /** Width. Changing it keeps the left edge in place. */
  get w(): number { return this.sourceEntity ? this.sourceEntity.w : this._w; }
  set w(v: number) {
    const s = this.sourceEntity;
    if (s) { const left = s.cx - s.w / 2; s.w = v; s.cx = left + v / 2; }
    else this._w = v;
  }

  /** Height. Changing it keeps the bottom edge and the viewport scale in place. */
  get h(): number { return this.sourceEntity ? this.sourceEntity.h : this._h; }
  set h(v: number) {
    const s = this.sourceEntity;
    if (s) {
      const bottom = s.cy - s.h / 2;
      const scale = this.camScale;
      s.h = v;
      s.cy = bottom + v / 2;
      s.viewHeight = scale * v;
    } else this._h = v;
  }

  // ── Model-space camera ──

  /** World-space X of the model point shown at viewport centre. */
  get camCenterX(): number { return this.sourceEntity ? this.sourceEntity.viewCenter.x : this._camCenterX; }
  set camCenterX(v: number) {
    const s = this.sourceEntity;
    if (s) s.viewCenter = { ...s.viewCenter, x: v }; else this._camCenterX = v;
  }

  /** World-space Y of the model point shown at viewport centre. */
  get camCenterY(): number { return this.sourceEntity ? this.sourceEntity.viewCenter.y : this._camCenterY; }
  set camCenterY(v: number) {
    const s = this.sourceEntity;
    if (s) s.viewCenter = { ...s.viewCenter, y: v }; else this._camCenterY = v;
  }

  /**
   * World-units per paper-mm.
   * e.g. 1:100 → camScale = 100  (100 world-units = 1 mm on paper)
   * e.g. 1:1   → camScale = 1
   * On an adopted viewport this is the DXF view height over the paper height.
   */
  get camScale(): number {
    const s = this.sourceEntity;
    if (!s) return this._camScale;
    return s.viewHeight > 0 && s.h > 0 ? s.viewHeight / s.h : 1;
  }
  set camScale(v: number) {
    const s = this.sourceEntity;
    if (s) s.viewHeight = v * s.h; else this._camScale = v;
  }

  /** Named scale preset label ('1:100', '1:50', …) or null when freely zoomed. */
  scalePreset: string | null = null;

  locked    = false;
  visible   = true;
  selected  = false;

  /**
   * Per-viewport layer freeze overrides.
   * Key = layer name.  Value = true (visible in this VP) / false (frozen in this VP).
   * Layers not in this map follow the global layer visible/frozen setting.
   */
  layerOverrides: Map<string, boolean> = new Map();

  /**
   * The paper-space VIEWPORT entity this viewport was adopted from (DXF
   * import), or null for viewports created in the editor. Camera changes are
   * mirrored back onto it so the drawing round-trips through DXF export.
   */
  sourceEntity: IViewportEntityLike | null = null;

  constructor(x: number, y: number, w: number, h: number) {
    this.id   = generatePaperViewportId();
    this.name = 'Viewport ' + _vpId;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  /** Whether layerName is visible in this viewport. */
  isLayerVisible(layerName: string): boolean {
    if (this.layerOverrides.has(layerName)) {
      return this.layerOverrides.get(layerName) ?? true;
    }
    return true; // follow global setting
  }

  /**
   * Apply a named scale preset.
   * worldUnitsPerMm is the camScale value (e.g. 100 for 1:100).
   */
  applyScalePreset(label: string, worldUnitsPerMm: number): void {
    this.camScale    = worldUnitsPerMm;
    this.scalePreset = label;
  }

  clone(): PaperViewport {
    const c = new PaperViewport(this.x, this.y, this.w, this.h);
    c.name           = this.name;
    c.camCenterX     = this.camCenterX;
    c.camCenterY     = this.camCenterY;
    c.camScale       = this.camScale;
    c.scalePreset    = this.scalePreset;
    c.locked         = this.locked;
    c.visible        = this.visible;
    c.layerOverrides = new Map(this.layerOverrides);
    return c;
  }
}

/** The subset of `ViewportEntity` a layout needs to adopt it as a PaperViewport. */
export interface IViewportEntityLike {
  cx: number;
  cy: number;
  w: number;
  h: number;
  viewCenter: { x: number; y: number };
  viewHeight: number;
  /** DXF group 69. `1` is the paper-space view itself, never a window onto the model. */
  dxfViewportId?: number;
  /** DXF group 68. `<= 0` means the viewport is switched off. */
  dxfStatus?: number;
}

/**
 * Build a PaperViewport from a paper-space VIEWPORT entity, or null when the
 * entity is not a drawable window: the paper view (id 1), a switched-off
 * viewport, or a degenerate rectangle.
 *
 * DXF stores the centre + size on paper and the model view as centre + height
 * in model units; `camScale` is world-units per paper-mm, so it is simply
 * viewHeight / h.
 */
export function paperViewportFromEntity(e: IViewportEntityLike): PaperViewport | null {
  if (e.dxfViewportId === 1) return null;
  if (e.dxfStatus !== undefined && e.dxfStatus <= 0) return null;
  if (!(e.w > 0) || !(e.h > 0)) return null;
  const vp = new PaperViewport(e.cx - e.w / 2, e.cy - e.h / 2, e.w, e.h);
  vp.camCenterX = e.viewCenter?.x ?? 0;
  vp.camCenterY = e.viewCenter?.y ?? 0;
  vp.camScale   = e.viewHeight > 0 ? e.viewHeight / e.h : 1;
  vp.sourceEntity = e;
  return vp;
}

// ─── Standard viewport scale presets ─────────────────────────────────────────

export interface IViewportScalePreset {
  label: string;
  /** World-units per paper-mm (= camScale). */
  worldPerMm: number;
}

export const VIEWPORT_SCALE_PRESETS: ReadonlyArray<IViewportScalePreset> = [
  { label: '1:1',     worldPerMm: 1      },
  { label: '1:2',     worldPerMm: 2      },
  { label: '1:5',     worldPerMm: 5      },
  { label: '1:10',    worldPerMm: 10     },
  { label: '1:20',    worldPerMm: 20     },
  { label: '1:50',    worldPerMm: 50     },
  { label: '1:100',   worldPerMm: 100    },
  { label: '1:200',   worldPerMm: 200    },
  { label: '1:500',   worldPerMm: 500    },
  { label: '1:1000',  worldPerMm: 1000   },
  { label: '2:1',     worldPerMm: 0.5    },
  { label: '5:1',     worldPerMm: 0.2    },
  { label: '10:1',    worldPerMm: 0.1    },
];

// ─── Layout ───────────────────────────────────────────────────────────────────

/**
 * A Layout = one sheet in the project.
 *
 * The singleton Model Layout has `isModel = true` and fixed id `'__MODEL__'`.
 * It has no viewports / paper entities; its page setup drives model-tab plotting.
 */
export class Layout {
  readonly id: string;
  name: string;
  /** Tab order — lower = further left. Model is always 0. */
  order: number;
  /** true only for the singleton Model tab. */
  isModel: boolean;

  /** Paper-space entities (title blocks, annotations, tables, images). */
  entities: Entity[] = [];

  /** Viewports placed on this sheet. */
  viewports: PaperViewport[] = [];

  /** Page setup for this layout. */
  pageSetup: IPageSetup;

  /** Id of the viewport currently active for MSPACE editing. null = PSPACE mode. */
  activeMspaceViewportId: string | null = null;

  /**
   * Last main-canvas view (pan/zoom) used on this tab. AutoCAD keeps an
   * independent view per layout tab, so switching tabs never disturbs the
   * zoom of another tab. null = never shown yet → zoom to the paper sheet.
   */
  savedView: { scale: number; panX: number; panY: number } | null = null;

  /**
   * true once the layout has been shown for the first time. AutoCAD creates
   * the default viewport on a layout's first activation, not at creation.
   */
  initialized = false;

  constructor(name: string, order: number, isModel = false) {
    this.id      = isModel ? '__MODEL__' : generateLayoutId();
    this.name    = name;
    this.order   = order;
    this.isModel = isModel;
    this.pageSetup = defaultPageSetup(isModel ? 'A4' : 'A1');
  }

  /** Paper width in mm (orientation applied). */
  get paperWidthMm(): number {
    return resolvePageSetupMm(this.pageSetup).w;
  }

  /** Paper height in mm (orientation applied). */
  get paperHeightMm(): number {
    return resolvePageSetupMm(this.pageSetup).h;
  }

  clone(newName: string, newOrder: number): Layout {
    const c = new Layout(newName, newOrder, false);
    c.pageSetup = {
      ...this.pageSetup,
      margins: { ...this.pageSetup.margins },
    };
    c.entities  = this.entities.map((e: any) => e.clone());
    c.viewports = this.viewports.map((vp) => vp.clone());
    c.initialized = this.initialized;
    return c;
  }
}

// ─── Workspace mode ───────────────────────────────────────────────────────────

/**
 * The three possible workspace editing modes.
 *
 * MODEL   — Model tab is active; standard model-space editing.
 * PSPACE  — A Layout tab is active; editing paper-space (annotations, viewports).
 * MSPACE  — A Layout tab is active AND the user entered a viewport;
 *            editing model-space through the active viewport's camera.
 */
export type WorkspaceMode = 'MODEL' | 'PSPACE' | 'MSPACE';
