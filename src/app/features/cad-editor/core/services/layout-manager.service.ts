/**
 * LayoutManagerService
 *
 * Central service managing all Layouts (Model tab + Layout tabs) and the
 * workspace mode state machine (MODEL / PSPACE / MSPACE).
 *
 * Analogous to AutoCAD's Layout Manager, plus the MSPACE/PSPACE command pair.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Layout,
  PaperViewport,
  WorkspaceMode,
  type IPageSetup,
  defaultPageSetup,
  paperViewportFromEntity,
  VIEWPORT_SCALE_PRESETS,
} from '../models/layout.model';
import { ViewModelService } from './view-model.service';
import { DocumentService } from './document.service';
import { setNewEntitySpaceProvider } from '../models/command.model';

const MODEL_TAB_ID = '__MODEL__';

@Injectable({ providedIn: 'root' })
export class LayoutManagerService {
  private vm  = inject(ViewModelService);
  private doc = inject(DocumentService);

  // ── State ───────────────────────────────────────────────────────────────────

  /** All layouts in order. First item is always the Model tab. */
  private _layouts = signal<Layout[]>([
    new Layout('Model', 0, true),
    new Layout('Layout1', 1),
  ]);

  /** Id of the currently active layout/tab. */
  private _activeId = signal<string>(MODEL_TAB_ID);

  /** Reactive version bump for subscribers that need a change notification. */
  readonly version = signal(0);

  /**
   * The viewport being edited through in MSPACE, as a plain field: the view
   * model reads it on every w2s/s2w call, so it must not be a signal lookup.
   */
  private _mspaceVp: PaperViewport | null = null;

  constructor() {
    this.vm.setMspaceCameraSource(() => this._mspaceVp);
    setNewEntitySpaceProvider(() => this.doc.activeSpace());
  }

  // ── Saved page setups ────────────────────────────────────────────────────────
  private _savedPageSetups = signal<IPageSetup[]>([]);

  // ── Public computed signals ──────────────────────────────────────────────────

  readonly layouts = this._layouts.asReadonly();

  readonly activeLayoutId = this._activeId.asReadonly();

  readonly activeLayout = computed<Layout>(() => {
    const id  = this._activeId();
    const all = this._layouts();
    return all.find((l) => l.id === id) ?? all[0];
  });

  /** true when the Model tab is the current workspace. */
  readonly isModelSpace = computed(() => this._activeId() === MODEL_TAB_ID);

  /**
   * Current workspace editing mode:
   *   MODEL   — Model tab active.
   *   PSPACE  — Layout tab active, editing paper space.
   *   MSPACE  — Layout tab active, editing through a viewport.
   */
  readonly workspaceMode = computed<WorkspaceMode>(() => {
    if (this.isModelSpace()) return 'MODEL';
    const layout = this.activeLayout();
    return layout.activeMspaceViewportId ? 'MSPACE' : 'PSPACE';
  });

  /** The viewport currently being edited in MSPACE, or null. */
  readonly activeMspaceViewport = computed<PaperViewport | null>(() => {
    const layout = this.activeLayout();
    if (!layout.activeMspaceViewportId) return null;
    return layout.viewports.find((vp) => vp.id === layout.activeMspaceViewportId) ?? null;
  });

  readonly savedPageSetups = this._savedPageSetups.asReadonly();

  // ── Layout CRUD ─────────────────────────────────────────────────────────────

  /** Create a new layout tab. Returns the created layout. */
  createLayout(name?: string): Layout {
    const all   = this._layouts();
    const order = all.length;
    const n     = name ?? ('Layout' + order);
    const layout = new Layout(n, order);
    this._layouts.set([...all, layout]);
    this.bump();
    return layout;
  }

  renameLayout(id: string, name: string): void {
    if (id === MODEL_TAB_ID) return; // cannot rename Model
    this._layouts.update((all) =>
      all.map((l) => {
        if (l.id !== id) return l;
        const copy = Object.create(Object.getPrototypeOf(l)) as Layout;
        Object.assign(copy, l);
        copy.name = name.trim() || l.name;
        return copy;
      }),
    );
    this.bump();
  }

  duplicateLayout(id: string): Layout {
    const all    = this._layouts();
    const source = all.find((l) => l.id === id);
    if (!source) throw new Error('Layout not found: ' + id);
    const newOrder = all.length;
    const newName  = source.name + ' Copy';
    const copy     = source.clone(newName, newOrder);
    this._layouts.set([...all, copy]);
    this.bump();
    return copy;
  }

  /** Delete a layout. Refuses to delete the Model tab or the last remaining layout. */
  deleteLayout(id: string): void {
    if (id === MODEL_TAB_ID) return;
    const all = this._layouts();
    const nonModelLayouts = all.filter((l) => !l.isModel);
    if (nonModelLayouts.length <= 1) return; // keep at least one layout
    // Leave the doomed tab first so the Model view is restored properly.
    if (this._activeId() === id) {
      this.activateLayout(MODEL_TAB_ID);
    }
    const next = all.filter((l) => l.id !== id);
    // Re-index orders
    let order = 0;
    for (const l of next) l.order = order++;
    this._layouts.set(next);
    this.bump();
  }

  /** Reorder layouts by providing a new ordered list of ids (Model id must stay first). */
  reorderLayouts(orderedIds: string[]): void {
    const map = new Map(this._layouts().map((l) => [l.id, l]));
    const reordered: Layout[] = [];
    let i = 0;
    for (const id of orderedIds) {
      const l = map.get(id);
      if (l) { l.order = i++; reordered.push(l); }
    }
    this._layouts.set(reordered);
    this.bump();
  }

  /** Switch to a layout (or Model) tab. Exits MSPACE if we were in it. */
  activateLayout(id: string): void {
    const all = this._layouts();
    const target = all.find((l) => l.id === id);
    if (!target) return;
    // Exit MSPACE from the previous layout before switching
    const prev = this.activeLayout();
    if (prev.activeMspaceViewportId) {
      this._exitMspace(prev);
    }
    // Remember the view of the tab we are leaving (AutoCAD keeps one view per tab).
    if (prev.id !== id) {
      prev.savedView = { scale: this.vm.scale, panX: this.vm.panX, panY: this.vm.panY };
    }
    // A selection belongs to one space: model entities selected on the Model
    // tab must not stay highlighted (at paper-mm coordinates) on a layout.
    if (prev.isModel !== target.isModel) {
      this.doc.clearSelection();
    }
    this._activeId.set(id);
    this._mspaceVp = null;
    this.doc.activeSpace.set(target.isModel ? 'model' : 'paper');

    if (!target.isModel && !target.initialized) {
      target.initialized = true;
      if (target.viewports.length === 0) {
        // A drawing opened from DXF brings its own VIEWPORT entities: adopt
        // them so the paper renderer draws the model through them. Otherwise
        // AutoCAD creates one viewport covering the printable area the first
        // time a layout is opened, zoomed to the model extents.
        if (!this._adoptViewportEntities(target)) {
          this._createDefaultViewport(target);
        }
      }
    }

    if (target.savedView) {
      this.vm.scale = target.savedView.scale;
      this.vm.panX  = target.savedView.panX;
      this.vm.panY  = target.savedView.panY;
      this.vm.markViewDirty();
      this.vm.markGridDirty();
    } else if (!target.isModel) {
      this.zoomToPaper(target, false);
    } else {
      this.vm.zoomExtentsWhenReady(this.doc);
    }
    this.vm.markDirty();
    this.vm.markGridDirty();
    this.bump();
  }

  // ── View helpers ─────────────────────────────────────────────────────────────

  /**
   * Fit the whole paper sheet in the canvas (AutoCAD's initial layout view and
   * ZOOM Extents in paper space). Retries a few frames if the canvas has not
   * been measured yet.
   */
  zoomToPaper(layout: Layout = this.activeLayout(), animate = true, _retries = 30): void {
    if (layout.isModel) return;
    const w = this.vm.canvasWidth;
    const h = this.vm.canvasHeight;
    if (!w || !h) {
      if (_retries > 0) requestAnimationFrame(() => this.zoomToPaper(layout, animate, _retries - 1));
      return;
    }
    const pw = layout.paperWidthMm;
    const ph = layout.paperHeightMm;
    const pad = 0.06;
    const targetScale = Math.min((w * (1 - 2 * pad)) / pw, (h * (1 - 2 * pad)) / ph);
    // `w2s()` adds vpCenter, so the pan is just the offset of the sheet midpoint.
    const targetPanX = -(pw / 2) * targetScale;
    const targetPanY =  (ph / 2) * targetScale;
    if (animate && this.vm.scale > 0) {
      this.vm.animateTo(targetScale, targetPanX, targetPanY, 250);
    } else {
      this.vm.scale = targetScale;
      this.vm.panX  = targetPanX;
      this.vm.panY  = targetPanY;
      this.vm.markViewDirty();
      this.vm.markGridDirty();
    }
  }

  /**
   * ZOOM Extents for the active tab: model extents on the Model tab, the paper
   * sheet on a layout tab, and the model extents *through the viewport* in MSPACE.
   */
  zoomExtents(): void {
    const layout = this.activeLayout();
    if (layout.isModel) { this.vm.zoomExtents(this.doc); return; }
    const vp = this.activeMspaceViewport();
    if (vp) {
      this.fitViewportToExtents(vp);
      this.vm.markDirty();
      this.bump();
      return;
    }
    this.zoomToPaper(layout, true);
  }

  /** Zoom a viewport camera by `factor` about the model point currently under (sx, sy). */
  zoomViewportCamera(vp: PaperViewport, factor: number, worldAnchor?: { x: number; y: number }): void {
    if (vp.locked) return;
    const oldScale = vp.camScale;
    const newScale = Math.max(1e-6, Math.min(1e7, oldScale / factor));
    if (worldAnchor) {
      // Keep the anchor point fixed on paper: c' = a + (c - a) * new/old
      const k = newScale / oldScale;
      vp.camCenterX = worldAnchor.x + (vp.camCenterX - worldAnchor.x) * k;
      vp.camCenterY = worldAnchor.y + (vp.camCenterY - worldAnchor.y) * k;
    }
    vp.camScale = newScale;
    vp.scalePreset = null;
    this.vm.markViewDirty();
  }

  /** Pan a viewport camera by a screen delta (pixels), given the paper zoom (px per mm). */
  panViewportCamera(vp: PaperViewport, dxPx: number, dyPx: number, pxPerMm: number): void {
    if (vp.locked || pxPerMm <= 0) return;
    const worldPerPx = vp.camScale / pxPerMm;
    vp.camCenterX -= dxPx * worldPerPx;
    vp.camCenterY += dyPx * worldPerPx;
    this.vm.markViewDirty();
  }

  /** Set a viewport camera so the model extents fill the viewport (ZOOM Extents inside a viewport). */
  fitViewportToExtents(vp: PaperViewport): void {
    this._initViewportCamera(vp);
    this.vm.markViewDirty();
  }

  /**
   * Turn the layout's paper-space VIEWPORT entities into PaperViewports.
   * Returns true when at least one drawable viewport was adopted.
   */
  private _adoptViewportEntities(layout: Layout): boolean {
    let adopted = 0;
    for (const file of this.doc.files) {
      for (const e of file.entities as any[]) {
        if (!e.inPaperSpace || e.type !== 'VIEWPORT') continue;
        if (e.layoutId && e.layoutId !== layout.id) continue;
        const vp = paperViewportFromEntity(e);
        if (!vp) continue;
        vp.name = 'Viewport ' + (layout.viewports.length + 1);
        // A viewport whose DXF view is empty gets the model extents, as AutoCAD does.
        if (!(e.viewHeight > 0)) this._initViewportCamera(vp);
        layout.viewports.push(vp);
        adopted++;
      }
    }
    return adopted > 0;
  }


  private _createDefaultViewport(layout: Layout): void {
    const m = layout.pageSetup.margins;
    const w = layout.paperWidthMm  - m.left - m.right;
    const h = layout.paperHeightMm - m.top  - m.bottom;
    if (w <= 0 || h <= 0) return;
    const vp = new PaperViewport(m.left, m.bottom, w, h);
    vp.name = 'Viewport 1';
    this._initViewportCamera(vp);
    layout.viewports.push(vp);
  }

  // ── Page setup ───────────────────────────────────────────────────────────────

  applyPageSetup(layoutId: string, setup: IPageSetup): void {
    this._layouts.update((all) =>
      all.map((l) => {
        if (l.id !== layoutId) return l;
        const c = this._shallowCloneLayout(l);
        c.pageSetup = { ...setup, margins: { ...setup.margins } };
        return c;
      }),
    );
    this.vm.markDirty();
    this.bump();
  }

  /** Save a page setup as a reusable named preset. */
  savePageSetup(setup: IPageSetup): void {
    this._savedPageSetups.update((all) => {
      const filtered = all.filter((s) => s.name !== setup.name);
      return [...filtered, { ...setup, margins: { ...setup.margins } }];
    });
  }

  // ── Viewport management ──────────────────────────────────────────────────────

  /** Add a viewport to the active layout (paper-space coordinates in mm). */
  addViewportToActiveLayout(xMm: number, yMm: number, wMm: number, hMm: number): PaperViewport {
    const layout = this.activeLayout();
    if (layout.isModel) throw new Error('Cannot add viewports to the Model tab.');
    const vp = new PaperViewport(xMm, yMm, wMm, hMm);
    // Default the viewport camera to show model extents
    this._initViewportCamera(vp);
    layout.viewports.push(vp);
    this.vm.markDirty();
    this.bump();
    return vp;
  }

  removeViewportFromLayout(layoutId: string, vpId: string): void {
    const layout = this._layouts().find((l) => l.id === layoutId);
    if (!layout) return;
    const idx = layout.viewports.findIndex((vp) => vp.id === vpId);
    if (idx === -1) return;
    const [vp] = layout.viewports.splice(idx, 1);
    // An adopted viewport is backed by a VIEWPORT entity; erase that too or
    // the viewport comes back on the next open.
    if (vp.sourceEntity) this.doc.removeEntity(vp.sourceEntity as any);
    if (layout.activeMspaceViewportId === vpId) {
      layout.activeMspaceViewportId = null;
      this._mspaceVp = null;
      this.doc.activeSpace.set('paper');
    }
    this.vm.markContentDirty();
    this.bump();
  }

  // ── Viewport selection (PSPACE) ─────────────────────────────────────────────

  /** Select a viewport as an object on the sheet. Non-additive clears the others and any entity selection. */
  selectViewport(vp: PaperViewport, additive = false): void {
    const layout = this.activeLayout();
    if (additive) {
      vp.selected = !vp.selected;
    } else {
      for (const v of layout.viewports) v.selected = v === vp;
      this.doc.clearSelection();
    }
    this.vm.markDirty();
    this.bump();
  }

  /** Deselect every viewport on the active layout. Returns true if any was selected. */
  clearViewportSelection(): boolean {
    let changed = false;
    for (const vp of this.activeLayout().viewports) {
      if (vp.selected) { vp.selected = false; changed = true; }
    }
    if (changed) { this.vm.markDirty(); this.bump(); }
    return changed;
  }

  /** ERASE for viewports: remove the selected viewports of the active layout. */
  deleteSelectedViewports(): boolean {
    const layout = this.activeLayout();
    if (layout.isModel) return false;
    const doomed = layout.viewports.filter((v) => v.selected);
    if (!doomed.length) return false;
    for (const vp of doomed) this.removeViewportFromLayout(layout.id, vp.id);
    return true;
  }

  // ── MSPACE / PSPACE switching ────────────────────────────────────────────────

  /**
   * Enter Model Space through a specific viewport (AutoCAD: double-click inside viewport).
   * Sets the active viewport and switches the canvas to route model-space events through it.
   */
  enterMspace(vpId: string): void {
    const layout = this.activeLayout();
    if (layout.isModel) return;
    const vp = layout.viewports.find((v) => v.id === vpId);
    if (!vp) return;
    layout.activeMspaceViewportId = vpId;
    for (const v of layout.viewports) v.selected = false;
    this._mspaceVp = vp;
    // Editing the model now: pick/snap/create model entities, seen through the viewport.
    this.doc.activeSpace.set('model');
    this.doc.clearSelection();
    this.vm.markViewDirty();
    this.bump();
  }

  /**
   * Exit MSPACE back to PSPACE (AutoCAD: double-click outside viewport / type PS).
   */
  exitMspace(): void {
    const layout = this.activeLayout();
    this._exitMspace(layout);
    this.doc.clearSelection();
    this.vm.markViewDirty();
    this.bump();
  }

  private _exitMspace(layout: Layout): void {
    layout.activeMspaceViewportId = null;
    this._mspaceVp = null;
    if (!layout.isModel) this.doc.activeSpace.set('paper');
  }

  // ── Paper-space entity helpers ────────────────────────────────────────────────

  /** Add an entity to the active layout's paper-space entity list. */
  addPaperEntity(entity: any): void {
    const layout = this.activeLayout();
    if (layout.isModel) return;
    entity.inPaperSpace = true;
    this.doc.addEntity(entity);
    this.vm.markDirty();
    this.bump();
  }

  removePaperEntity(entity: any): void {
    const layout = this.activeLayout();
    this.doc.removeEntity(entity);
    this.vm.markDirty();
    this.bump();
  }

  // ── Reset ────────────────────────────────────────────────────────────────────

  /** Reset to default state (Model + Layout1). Used on document clear. */
  reset(): void {
    this._layouts.set([
      new Layout('Model', 0, true),
      new Layout('Layout1', 1),
    ]);
    this._activeId.set(MODEL_TAB_ID);
    this._mspaceVp = null;
    this._savedPageSetups.set([]);
    this.doc.activeSpace.set('model');
    this.bump();
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  bump(): void {
    this.version.update((v) => v + 1);
  }

  private _shallowCloneLayout(l: Layout): Layout {
    const c = Object.create(Object.getPrototypeOf(l)) as Layout;
    Object.assign(c, l);
    return c;
  }

  /**
   * Set the viewport's camera so it shows the current model extents centred.
   * Falls back to a 1:100 scale if the model is empty.
   */
  private _initViewportCamera(vp: PaperViewport): void {
    const b = this.doc.getValidDrawingBounds(false, false);
    if (!b || vp.w <= 0 || vp.h <= 0) {
      // Empty model: 1:1 with the world origin at the viewport's lower-left,
      // which is what an empty AutoCAD layout shows.
      vp.camScale    = 1;
      vp.camCenterX  = vp.w / 2;
      vp.camCenterY  = vp.h / 2;
      vp.scalePreset = null;
      return;
    }
    let extW = b.maxX - b.minX;
    let extH = b.maxY - b.minY;
    if (extW < 1e-6) extW = 1;
    if (extH < 1e-6) extH = 1;
    // Fit extents with a small margin, like ZOOM Extents in the viewport.
    const pad = 1.04;
    vp.camScale    = Math.max((extW * pad) / vp.w, (extH * pad) / vp.h);
    vp.camCenterX  = (b.minX + b.maxX) / 2;
    vp.camCenterY  = (b.minY + b.maxY) / 2;
    vp.scalePreset = null;
  }
}
