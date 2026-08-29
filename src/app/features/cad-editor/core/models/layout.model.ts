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

  // ── Paper placement (mm from sheet lower-left origin) ──
  x: number;   // left edge
  y: number;   // bottom edge
  w: number;   // width
  h: number;   // height

  // ── Model-space camera ──
  /** World-space X of the model point shown at viewport centre. */
  camCenterX = 0;
  /** World-space Y of the model point shown at viewport centre. */
  camCenterY = 0;
  /**
   * World-units per paper-mm.
   * e.g. 1:100 → camScale = 100  (100 world-units = 1 mm on paper)
   * e.g. 1:1   → camScale = 1
   */
  camScale = 1;

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
