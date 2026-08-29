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
  VIEWPORT_SCALE_PRESETS,
} from '../models/layout.model';
import { ViewModelService } from './view-model.service';
import { DocumentService } from './document.service';

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
    const next = all.filter((l) => l.id !== id);
    // Re-index orders
    let order = 0;
    for (const l of next) l.order = order++;
    this._layouts.set(next);
    if (this._activeId() === id) {
      this._activeId.set(MODEL_TAB_ID);
    }
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
    this._activeId.set(id);
    this.vm.markDirty();
    this.bump();
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
    layout.viewports.splice(idx, 1);
    if (layout.activeMspaceViewportId === vpId) {
      layout.activeMspaceViewportId = null;
    }
    this.vm.markDirty();
    this.bump();
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
    this.vm.markDirty();
    this.bump();
  }

  /**
   * Exit MSPACE back to PSPACE (AutoCAD: double-click outside viewport / type PS).
   */
  exitMspace(): void {
    const layout = this.activeLayout();
    this._exitMspace(layout);
    this.vm.markDirty();
    this.bump();
  }

  private _exitMspace(layout: Layout): void {
    layout.activeMspaceViewportId = null;
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
    this._savedPageSetups.set([]);
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
    // Use a sensible default: 1:100 scale, centred at origin.
    // Later phases will offer "Zoom to Extents" per viewport.
    vp.camScale   = 100;
    vp.camCenterX = 0;
    vp.camCenterY = 0;
    vp.scalePreset = '1:100';
  }
}
