import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
  effect,
  output
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ViewModelService, niceGridStep } from '../../core/services/view-model.service';
import { DocumentService } from '../../core/services/document.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { SnappingService } from '../../core/services/snapping.service';
import { GripManagerService } from '../../core/services/grip-manager.service';
import { ViewportManagerService } from '../../core/services/viewport-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { CommandPromptService } from '../../core/services/command-prompt.service';
import { DynamicInputOverlayComponent } from '../dynamic-input/dynamic-input-overlay.component';
import { HatchRegenScheduler } from '../../core/services/hatch-regen-scheduler.service';
import { HatchDebugService } from '../../core/services/hatch-debug.service';
import { TopologyDebugService } from '../../core/services/topology-debug.service';
import { ThemeService } from '../../core/services/theme.service';
import { TextEditorService } from '../text-editor/text-editor.service';
import { LayoutManagerService } from '../../core/services/layout-manager.service';
import { AssociationGraphService } from '../../core/services/association-graph.service';
import { PaperSpaceRendererService } from '../../core/services/paper-space-renderer.service';
import type { Entity } from '../../core/models/entity.model';
import { hitTestAll, deselectAll } from '../../tools/select/select-tool';
import { drawTransformGhost } from '../../tools/drag-preview';
import { ModelViewportService } from '../../core/services/model-viewport.service';
import { createProxyVm } from '../../core/services/view-model.service';
import { VportsDialogService } from '../vports-dialog/vports-dialog.service';
import { ViewportConfigType } from '../../core/models/viewport-config.model';

@Component({
  selector: 'app-cad-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DynamicInputOverlayComponent],
  template: `
    <div class="cad-canvas-area" (click)="closeAllVpMenus()">
      <div #wrap
           class="canvas-wrap"
           (contextmenu)="$event.preventDefault()">
        <canvas #grid class="canvas-grid"></canvas>
        <canvas #main class="canvas-main"></canvas>
        <canvas #dynamic class="canvas-dynamic"></canvas>
        <app-dynamic-input-overlay #dynOverlay></app-dynamic-input-overlay>

        <!-- Model Space Tiled Viewport Interactive HTML Overlays (Positioned at Bottom-Left Corner of Each Tile) -->
        @if (layoutMgr.isModelSpace() && modelVps.tiles.length > 0) {
          @for (t of modelVps.tiles; track t.id) {
            <div class="tile-header-overlay"
                 [style.left.px]="t.rect.x * (wrapRef.nativeElement?.clientWidth || 0) + 6"
                 [style.top.px]="(t.rect.y + t.rect.h) * (wrapRef.nativeElement?.clientHeight || 0) - 28"
                 [class.active]="t.active"
                 (click)="onTileClick(t, $event)">
              
              <!-- [+] Viewport Config Dropdown -->
              <div class="vp-control-btn" (click)="$event.stopPropagation(); toggleVpMenu(t.id)">
                [+]
                @if (activeVpMenuId() === t.id) {
                  <div class="vp-dropdown-menu">
                    <div class="menu-item" (click)="setTileConfig('Single')">1 Viewport (Single)</div>
                    <div class="menu-item" (click)="setTileConfig('Two: Vertical')">2 Viewports (Vertical)</div>
                    <div class="menu-item" (click)="setTileConfig('Two: Horizontal')">2 Viewports (Horizontal)</div>
                    <div class="menu-item" (click)="setTileConfig('Four: Equal')">4 Viewports (Grid 2x2)</div>
                    <div class="menu-divider"></div>
                    <div class="menu-item" (click)="openVportsDialog()">Viewports Configuration... (VPORTS)</div>
                  </div>
                }
              </div>

              <!-- [Top] View Orientation Dropdown -->
              <div class="vp-control-btn" (click)="$event.stopPropagation(); toggleViewMenu(t.id)">
                [{{ t.viewName }}]
                @if (activeViewMenuId() === t.id) {
                  <div class="vp-dropdown-menu">
                    <div class="menu-item" (click)="setTileView(t, 'Top')">Top</div>
                    <div class="menu-item" (click)="setTileView(t, 'Bottom')">Bottom</div>
                    <div class="menu-item" (click)="setTileView(t, 'Left')">Left</div>
                    <div class="menu-item" (click)="setTileView(t, 'Right')">Right</div>
                    <div class="menu-item" (click)="setTileView(t, 'Front')">Front</div>
                    <div class="menu-item" (click)="setTileView(t, 'Back')">Back</div>
                    <div class="menu-item" (click)="setTileView(t, 'SW Isometric')">SW Isometric</div>
                    <div class="menu-item" (click)="setTileView(t, 'SE Isometric')">SE Isometric</div>
                  </div>
                }
              </div>

              <!-- [2D Wireframe] Visual Style Dropdown -->
              <div class="vp-control-btn" (click)="$event.stopPropagation(); toggleStyleMenu(t.id)">
                [{{ t.visualStyle }}]
                @if (activeStyleMenuId() === t.id) {
                  <div class="vp-dropdown-menu">
                    <div class="menu-item" (click)="setTileStyle(t, '2D Wireframe')">2D Wireframe</div>
                    <div class="menu-item" (click)="setTileStyle(t, 'Conceptual')">Conceptual</div>
                    <div class="menu-item" (click)="setTileStyle(t, 'Realistic')">Realistic</div>
                    <div class="menu-item" (click)="setTileStyle(t, 'Shaded')">Shaded</div>
                  </div>
                }
              </div>
            </div>
          }
        }
      </div>

      <!-- Floating canvas toolbar — matches original #canvas-toolbar -->
      <div class="canvas-toolbar">
        <button type="button" class="cv-btn" title="Undo (Ctrl+Z)" (click)="undoRequested.emit()">↩</button>
        <button type="button" class="cv-btn" title="Redo (Ctrl+Y)" (click)="redoRequested.emit()">↪</button>
        <button type="button" class="cv-btn" title="Zoom Extents" (click)="zoomExtents()">⛶</button>
        <button type="button" class="cv-btn" title="Zoom In" (click)="zoomIn()">+</button>
        <button type="button" class="cv-btn" title="Zoom Out" (click)="zoomOut()">−</button>
        
        <!-- Viewports Split Selector -->
        @if (layoutMgr.isModelSpace()) {
          <select class="cv-select" title="Viewport Layout" [ngModel]="modelVps.activeConfigName()" (ngModelChange)="modelVps.applyConfig($event)">
            <option value="Single">1 View (Single)</option>
            <option value="Two: Vertical">2 Views (Vertical)</option>
            <option value="Two: Horizontal">2 Views (Horizontal)</option>
            <option value="Three: Right">3 Views (Right)</option>
            <option value="Three: Left">3 Views (Left)</option>
            <option value="Four: Equal">4 Views (Grid 2x2)</option>
          </select>
        }

        <select class="cv-select" title="Active Layer" [(ngModel)]="activeLayer" (ngModelChange)="onLayerChange($event)">
          @for (layerName of layerNames(); track layerName) {
            <option [value]="layerName">{{ layerName }}</option>
          }
        </select>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; height: 100%; }
    .cad-canvas-area { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--cad-bg-canvas); }
    .canvas-wrap { position: absolute; inset: 0; cursor: crosshair; overflow: hidden; }
    .canvas-grid, .canvas-main, .canvas-dynamic { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .canvas-grid { z-index: 1; }
    .tile-header-overlay {
      position: absolute;
      z-index: 30;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      background: rgba(15, 23, 42, 0.85);
      border-bottom-right-radius: 4px;
      font-family: monospace;
      font-size: 11px;
      color: #94a3b8;
      user-select: none;
      
      &.active {
        color: #60a5fa;
        background: rgba(15, 23, 42, 0.95);
      }
    }
    .vp-control-btn {
      position: relative;
      cursor: pointer;
      padding: 1px 4px;
      border-radius: 2px;
      &:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #ffffff;
      }
    }
    .vp-dropdown-menu {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 4px;
      background: #1e293b;
      border: 1px solid #475569;
      border-radius: 4px;
      box-shadow: 0 -4px 12px rgba(0,0,0,0.5);
      min-width: 180px;
      z-index: 100;
      padding: 4px 0;
    }
    .menu-item {
      padding: 6px 12px;
      font-size: 11px;
      color: #e2e8f0;
      cursor: pointer;
      white-space: nowrap;
      &:hover {
        background: #2563eb;
        color: #ffffff;
      }
    }
    .menu-divider {
      height: 1px;
      background: #334155;
      margin: 4px 0;
    }
    .canvas-main { pointer-events: none; z-index: 10; }
    .canvas-dynamic { pointer-events: none; z-index: 20; }
    .cv-mode {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.06em;
      padding: 2px 8px;
      color: var(--cad-text-secondary);
    }
    .cv-mode-on {
      color: var(--cad-yellow);
      background: var(--cad-accent-tint) !important;
      box-shadow: inset 0 0 0 1px var(--cad-yellow);
    }
    .cv-mode-override {
      box-shadow: inset 0 0 0 1px var(--cad-accent), 0 0 6px var(--cad-accent-glow);
    }
  `],
})
export class CanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('wrap', { static: true }) wrapRef!: ElementRef<HTMLDivElement>;
  @ViewChild('grid', { static: true }) gridRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('main', { static: true }) mainRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('dynamic', { static: true }) dynamicRef!: ElementRef<HTMLCanvasElement>;

  readonly undoRequested = output<void>();
  readonly redoRequested = output<void>();
  /** Emitted when the user double-clicks an entity. Parent typically opens the properties panel. */
  readonly entityActivated = output<{
    entity: Entity;
    sx: number;
    sy: number;
}>();

  activeLayer = 'Layer 0';

  private vm = inject(ViewModelService);
  readonly doc = inject(DocumentService);
  private toolMgr = inject(ToolManagerService);
  protected snap = inject(SnappingService);
  protected grips = inject(GripManagerService);
  protected dynInput = inject(DynamicInputService);
  private cmdPrompt = inject(CommandPromptService);
  protected vps = inject(ViewportManagerService);
  protected modelVps = inject(ModelViewportService);
  protected vportsDialogSvc = inject(VportsDialogService);
  protected layoutMgr = inject(LayoutManagerService);

  readonly activeVpMenuId = signal<string | null>(null);
  readonly activeViewMenuId = signal<string | null>(null);
  readonly activeStyleMenuId = signal<string | null>(null);

  toggleVpMenu(id: string): void {
    this.activeVpMenuId.update((prev) => (prev === id ? null : id));
    this.activeViewMenuId.set(null);
    this.activeStyleMenuId.set(null);
  }

  toggleViewMenu(id: string): void {
    this.activeViewMenuId.update((prev) => (prev === id ? null : id));
    this.activeVpMenuId.set(null);
    this.activeStyleMenuId.set(null);
  }

  toggleStyleMenu(id: string): void {
    this.activeStyleMenuId.update((prev) => (prev === id ? null : id));
    this.activeVpMenuId.set(null);
    this.activeViewMenuId.set(null);
  }

  closeAllVpMenus(): void {
    this.activeVpMenuId.set(null);
    this.activeViewMenuId.set(null);
    this.activeStyleMenuId.set(null);
  }

  setTileConfig(name: ViewportConfigType): void {
    this.modelVps.applyConfig(name);
    this.closeAllVpMenus();
  }

  setTileView(tile: any, viewName: string): void {
    tile.viewName = viewName;
    this.closeAllVpMenus();
    this.vm.markDirty();
  }

  setTileStyle(tile: any, visualStyle: string): void {
    tile.visualStyle = visualStyle;
    this.closeAllVpMenus();
    this.vm.markDirty();
  }

  openVportsDialog(): void {
    this.vportsDialogSvc.open();
    this.closeAllVpMenus();
  }

  onTileClick(tile: any, e?: MouseEvent): void {
    if (e) e.stopPropagation();
    this.closeAllVpMenus();
    this.modelVps.setActiveTile(tile.id);
  }
  protected paperRenderer = inject(PaperSpaceRendererService);
  private assocGraph = inject(AssociationGraphService);
  // Injected for side-effect: forces Angular to construct HatchRegenScheduler
  // eagerly so its constructor can register doc.preDrawHook before the first
  // render frame. The variable is intentionally unused beyond that.
  private _hatchRegen = inject(HatchRegenScheduler);
  protected hatchDebug = inject(HatchDebugService);
  protected topologyDebug = inject(TopologyDebugService);
  private theme = inject(ThemeService);
  // NgZone removed — provideZonelessChangeDetection() is active; runOutsideAngular() is a no-op.

  @ViewChild('dynOverlay', { static: false }) dynOverlay?: DynamicInputOverlayComponent;
  get gridEnabled() { return this.snap.gridEnabled; }
  private textEditor = inject(TextEditorService);

  constructor() {
    effect(() => {
      const tool = this.toolMgr.activeToolName();
      if (this.wrapRef?.nativeElement) {
        const cursorHint = this.toolMgr.activeTool?.getCursor?.();
        if (cursorHint === 'pickbox' || cursorHint === 'crosshair' || (tool !== 'pan' && !cursorHint)) {
          this.wrapRef.nativeElement.style.cursor = 'none';
        } else {
          this.wrapRef.nativeElement.style.cursor = resolveCadCursor(tool, cursorHint);
        }
      }
    });
    // Force a full repaint when the theme changes so canvas-runtime colors
    // (grid, snap marker, grips) re-resolve through ThemeService. Keyed on the
    // theme id, not the ground, so switching between two dark themes repaints.
    effect(() => {
      this.theme.revision();
      this.vm.markDirty();
      this.vm.markGridDirty();
    });
  }

  /** Reactive list of layer names for the dropdown — memoised via computed().
   *  Only re-evaluates when vm.version() changes (entity add/remove/layer change).
   *  A plain function would allocate a new array on every template CD cycle. */
  readonly layerNames = computed(() => {
    this.vm.version(); // reactive dependency — invalidates on content changes
    return Array.from(this.doc.activeFile.layers.keys());
  });

  onLayerChange(name: string): void {
    this.doc.activeLayerName = name;
  }

  private gridCtx!: CanvasRenderingContext2D;
  private mainCtx!: CanvasRenderingContext2D;
  private dynamicCtx!: CanvasRenderingContext2D;
  private rafId = 0;
  private firstResize = true;
  private resizeObserver?: ResizeObserver;

  private boundOnMouseDown!: (e: MouseEvent) => void;
  private boundOnMouseMove!: (e: MouseEvent) => void;
  private boundOnMouseUp!: (e: MouseEvent) => void;
  private boundOnDblClick!: (e: MouseEvent) => void;
  private boundOnWheel!: (e: WheelEvent) => void;

  private isPanning = false;
  private panStart = { sx: 0, sy: 0, px: 0, py: 0 };

  private mouseX = -1000;
  private mouseY = -1000;
  private _lastMouseEvent: MouseEvent | null = null;
  private mouseInCanvas = false;

  // Tracks whether a new mousemove arrived since the last RAF frame, so we
  // only run snap.resolve() (the expensive O(k) snap scan) once per frame.
  private _pendingMouseMove = false;
  private _lastSnapSx = -1000;
  private _lastSnapSy = -1000;

  // ── Dynamic-layer dirty flag ────────────────────────────────────────────────
  // The dynamic canvas (crosshair, snap marker, tool preview, grips) previously
  // cleared and re-drew unconditionally at 60fps — even when nothing changed.
  // Now it only redraws when this flag is true, dramatically reducing GPU work
  // on idle frames (mouse still, no tool active, no grip drag).
  //
  //   Set true by: onMouseMove (cursor moved), renderFrame when vm.dirty fires
  //                (content change → preview update needed), onKeyDown Escape.
  //   Cleared by: the dynamic-layer draw path at the start of each render pass.
  private _dynamicNeedsRedraw = true; // true initially to ensure the first frame draws

  // ── Offscreen static-content backing-store cache ──────────────────────────
  // Strategy: render all NON-selected, NON-preview entities into an offscreen
  // canvas whenever scale/content/theme/canvas-size change. On subsequent frames
  // where only pan changed, blit the cache with a pixel-offset instead of
  // calling drawAll() again — O(1) blit vs O(n) draw.
  private _bgCanvas: HTMLCanvasElement | null = null;
  private _bgCtx: CanvasRenderingContext2D | null = null;
  private _bgCacheKey = '';          // serialised key for cache invalidation
  private _bgPanX = 0;               // panX at the time the cache was rendered
  private _bgPanY = 0;               // panY at the time the cache was rendered

  ngAfterViewInit(): void {
    this.gridCtx = this.gridRef.nativeElement.getContext('2d')!;
    this.mainCtx = this.mainRef.nativeElement.getContext('2d')!;
    this.dynamicCtx = this.dynamicRef.nativeElement.getContext('2d')!;
    this.resize();

    this.boundOnMouseDown = this.onMouseDown.bind(this);
    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnMouseUp = this.onMouseUp.bind(this);
    this.boundOnDblClick = this.onDblClick.bind(this);
    this.boundOnWheel = this.onWheel.bind(this);

    // Angular 20 zoneless: NgZone.runOutsideAngular() is a no-op. DOM event listeners
    // and the RAF loop already run outside Angular change detection by default.
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.wrapRef.nativeElement);

    const wrap = this.wrapRef.nativeElement;
    wrap.addEventListener('mousedown', this.boundOnMouseDown);
    wrap.addEventListener('mousemove', this.boundOnMouseMove);
    wrap.addEventListener('mouseup', this.boundOnMouseUp);
    wrap.addEventListener('dblclick', this.boundOnDblClick);
    wrap.addEventListener('wheel', this.boundOnWheel as any, { passive: false });

    wrap.addEventListener('mouseenter', () => { this.mouseInCanvas = true; this._dynamicNeedsRedraw = true; });
    wrap.addEventListener('mouseleave', () => { this.mouseInCanvas = false; this.isPanning = false; this._dynamicNeedsRedraw = true; });

    this.renderFrame();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    
    if (this.wrapRef?.nativeElement) {
      const wrap = this.wrapRef.nativeElement;
      wrap.removeEventListener('mousedown', this.boundOnMouseDown);
      wrap.removeEventListener('mousemove', this.boundOnMouseMove);
      wrap.removeEventListener('mouseup', this.boundOnMouseUp);
      wrap.removeEventListener('dblclick', this.boundOnDblClick);
      wrap.removeEventListener('wheel', this.boundOnWheel as any);
    }
  }

  private resize(): void {
    const wrap = this.wrapRef.nativeElement;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    this.gridRef.nativeElement.width = this.mainRef.nativeElement.width = this.dynamicRef.nativeElement.width = w;
    this.gridRef.nativeElement.height = this.mainRef.nativeElement.height = this.dynamicRef.nativeElement.height = h;
    this.vm.canvasWidth = w;
    this.vm.canvasHeight = h;
    this.modelVps.updateVmCenter();
    // Invalidate the backing-store cache — canvas size changed.
    this._bgCacheKey = '';
    if (this.firstResize) {
      this.vm.reset();
      this.firstResize = false;
    }
    this.vm.markDirty();
    this.vm.markGridDirty();
  }

  private renderFrame = (): void => {
    // ── Dynamic-dirty: capture the pre-frame state before processMouseMove
    // can potentially set _dynamicNeedsRedraw again (it won't in practice, but
    // capturing first is the cleaner pattern).
    const dynDirtyPre = this._dynamicNeedsRedraw;
    this._dynamicNeedsRedraw = false;

    // Flush any pending mouse position at most once per frame.
    this.processMouseMove();
    this.drawGrid();

    if (this.vm.dirty) {
      this.vm.dirty = false;
      // Content changed → tool preview / grips need a dynamic-layer refresh too.
      this._dynamicNeedsRedraw = true;

      const c = this.mainRef.nativeElement;
      const W = c.width;
      const H = c.height;

      const isTiled = this.layoutMgr.isModelSpace() && this.modelVps.tiles.length > 1;

      if (isTiled) {
        this.mainCtx.clearRect(0, 0, W, H);
        this.drawModelSpaceTiledViewports(this.mainCtx, W, H);
      } else {
        // ── Build the cache-key for the static layer ─────────────────────────
        const hasPreviewHidden = !!this.vm.previewHiddenIds;
        const themeMode = this.theme.revision();
        const cacheKey = [
          this.vm.version(),
          this.vm.scale.toFixed(6),
          W, H,
          hasPreviewHidden ? 1 : 0,
          themeMode,
          this.layoutMgr.workspaceMode(),
          this.vm.vpCenterX.toFixed(1),
          this.vm.vpCenterY.toFixed(1),
        ].join('|');

        const panX = this.vm.panX;
        const panY = this.vm.panY;

        if (cacheKey !== this._bgCacheKey) {
          // Cache is stale — re-render the full static layer into the bg canvas.
          this._bgCacheKey = cacheKey;
          this._bgPanX = panX;
          this._bgPanY = panY;

          if (!this._bgCanvas || this._bgCanvas.width !== W || this._bgCanvas.height !== H) {
            this._bgCanvas = document.createElement('canvas');
            this._bgCanvas.width = W;
            this._bgCanvas.height = H;
            this._bgCtx = this._bgCanvas.getContext('2d')!;
          }

          const bgCtx = this._bgCtx!;
          bgCtx.clearRect(0, 0, W, H);

          if (this.layoutMgr.isModelSpace()) {
            this.doc.drawAll(bgCtx);
            this.vps.drawAll(bgCtx);
            this.mainCtx.clearRect(0, 0, W, H);
            this.mainCtx.drawImage(this._bgCanvas, 0, 0);
          } else {
            const layout = this.layoutMgr.activeLayout();
            this.paperRenderer.render(bgCtx, layout, layout.activeMspaceViewportId);
            this.mainCtx.clearRect(0, 0, W, H);
            this.mainCtx.drawImage(this._bgCanvas, 0, 0);
          }
        } else if (this._bgCanvas) {
          // Cache is valid — blit with a pan-delta offset (O(1) copy).
          const dx = panX - this._bgPanX;
          const dy = panY - this._bgPanY;
          this.mainCtx.clearRect(0, 0, W, H);
          this.mainCtx.drawImage(this._bgCanvas, dx, dy);

          // If the delta exceeds 15% of the canvas width/height, force a fresh
          // cache render to avoid a large clipped gap on the trailing edge.
          if (Math.abs(dx) > W * 0.15 || Math.abs(dy) > H * 0.15) {
            this._bgPanX = panX;
            this._bgPanY = panY;
            const bgCtx = this._bgCtx!;
            bgCtx.clearRect(0, 0, W, H);
            if (this.layoutMgr.isModelSpace()) {
              this.doc.drawAll(bgCtx);
              this.vps.drawAll(bgCtx);
            } else {
              const layout = this.layoutMgr.activeLayout();
              this.paperRenderer.render(bgCtx, layout, layout.activeMspaceViewportId);
            }
            this.mainCtx.clearRect(0, 0, W, H);
            this.mainCtx.drawImage(this._bgCanvas, 0, 0);
          }
        } else {
          // No cache yet — full draw.
          this.mainCtx.clearRect(0, 0, W, H);
          if (this.layoutMgr.isModelSpace()) {
            this.doc.drawAll(this.mainCtx);
            this.vps.drawAll(this.mainCtx);
          } else {
            const layout = this.layoutMgr.activeLayout();
            this.paperRenderer.render(this.mainCtx, layout, layout.activeMspaceViewportId);
          }
        }
      }
    }

    // ── Dynamic layer (crosshair, snaps, tool preview, grips) ─────────────
    // OPTIMISATION: previously unconditional at 60fps. Now only redraws when:
    //   • the mouse moved this frame  (_dynamicNeedsRedraw set by onMouseMove)
    //   • document content changed    (_dynamicNeedsRedraw set above when vm.dirty)
    //   • a grip drag is in progress  (grips.dragging — must update every frame)
    // On idle frames (mouse still, no tool active, nothing changed) this is skipped,
    // saving: clearRect + drawCrosshair + snap.render + grips.render + debug overlays.
    const shouldDrawDynamic = dynDirtyPre || this._dynamicNeedsRedraw || this.grips.dragging;
    if (shouldDrawDynamic) {
      this._dynamicNeedsRedraw = false;
      const dc = this.dynamicRef.nativeElement;
      this.dynamicCtx.clearRect(0, 0, dc.width, dc.height);

      this.drawCrosshair(this.dynamicCtx);

      try {
        let anchor = this.toolMgr.activeTool?.getAnchor?.() ?? null;
        if (!anchor && this.grips.dragStartWorld) {
          anchor = { x: this.grips.dragStartWorld.x, y: this.grips.dragStartWorld.y };
        }
        this.snap.render(this.dynamicCtx, anchor);
        this.toolMgr.activeTool?.drawPreview?.(this.dynamicCtx);
        const textEditState = this.textEditor.state();
        if (textEditState?.isNew) {
          textEditState.entity.draw(this.dynamicCtx, this.vm, this.doc);
        }
        // Live grip-drag preview: the dragged entities are hidden from the static
        // cache (previewHiddenIds) so the drag doesn't force a full-scene redraw.
        // Paint them here at their current (already-mutated) geometry with an
        // identity ghost transform — only the few dragged entities redraw per
        // frame, so large drawings stay at interactive frame rates.
        if (this.grips.dragging) {
          const dragged = this.grips.getDraggedEntities();
          if (dragged.length) {
            drawTransformGhost(this.dynamicCtx, this.vm, this.doc, dragged, { kind: 'move', dx: 0, dy: 0 });
          }
        }
        if (!this.vm.previewHiddenIds || this.grips.dragging) this.grips.render(this.dynamicCtx);
        this.hatchDebug.drawOverlay(this.dynamicCtx, this.vm, this.doc.activeFile.entities);
        this.topologyDebug.drawOverlay(this.dynamicCtx, this.vm);
      } catch (err) {
        console.error('Tool preview error:', err);
      }
      this.syncDynamicInput();
      this.syncCommandPrompt();
    }

    this.rafId = requestAnimationFrame(this.renderFrame);
  };

  private syncCommandPrompt(): void {
    const activeTool = this.toolMgr.activeTool;
    // Use getCommandId() to get the sub-mode registry key (e.g. 'circle_2p')
    // rather than the tool's activation name ('circle'), so the correct prompt
    // and option chips are shown after an in-place mode switch.
    const cmd = activeTool?.getCommandId?.() ?? this.toolMgr.activeToolName();
    const phase = activeTool?.getPhase?.() ?? null;
    this.cmdPrompt.sync(cmd, phase);
  }

  private syncDynamicInput(): void {
    // Inform the DynamicInputService whether a real drawing/modify tool is
    // active, so the DYN overlay can show command guidance even when there
    // are no coordinate input fields (e.g. circle before center is picked).
    const toolName = this.toolMgr.activeToolName();
    const isToolActive = !!(toolName && toolName !== 'select' && toolName !== 'pan');
    this.dynInput.setToolActive(isToolActive);

    // Active tool's DI state wins (e.g., LineTool while placing a new line).
    // When no tool is publishing, fall through to the grip manager so a
    // grip drag still gets a Distance / Angle readout under the cursor.
    const toolState = this.toolMgr.activeTool?.getDynamicInputState?.() ?? null;
    const state = toolState ?? this.grips.getDragDynamicState();
    this.dynInput.setState(state);
  }

  private drawGrid(targetCtx?: CanvasRenderingContext2D, targetW?: number, targetH?: number): void {
    if (!targetCtx) {
      if (!this.vm.gridDirty) return;
      this.vm.gridDirty = false;
    }

    const canvas = this.gridRef.nativeElement;
    const W = targetW ?? canvas.width;
    const H = targetH ?? canvas.height;
    const ctx = targetCtx ?? this.gridCtx;
    
    if (!targetCtx) ctx.clearRect(0, 0, W, H);
    if (!this.gridEnabled()) return;

    const step = niceGridStep(this.vm.scale);
    const step2 = step * 10;
    const palette = this.theme.canvas();

    const tl = this.vm.s2w(0, 0);
    const br = this.vm.s2w(W, H);
    const x0 = Math.floor(Math.min(tl.x, br.x) / step) * step;
    const x1 = Math.ceil(Math.max(tl.x, br.x) / step) * step;
    const y0 = Math.floor(Math.min(tl.y, br.y) / step) * step;
    const y1 = Math.ceil(Math.max(tl.y, br.y) / step) * step;

    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.gridMinor;
    ctx.beginPath();
    for (let wx = x0; wx <= x1; wx += step) {
      if (Math.abs(wx % step2) < step * 0.01) continue;
      const sx = this.vm.w2s(wx, 0).x;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let wy = y0; wy <= y1; wy += step) {
      if (Math.abs(wy % step2) < step * 0.01) continue;
      const sy = this.vm.w2s(0, wy).y;
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
    }
    ctx.stroke();

    ctx.strokeStyle = palette.gridMajor;
    ctx.beginPath();
    for (let wx = Math.floor(x0 / step2) * step2; wx <= x1; wx += step2) {
      const sx = this.vm.w2s(wx, 0).x;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let wy = Math.floor(y0 / step2) * step2; wy <= y1; wy += step2) {
      const sy = this.vm.w2s(0, wy).y;
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
    }
    ctx.stroke();

    const ox = this.vm.w2s(0, 0);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = palette.axisX;
    ctx.beginPath();
    ctx.moveTo(0, ox.y);
    ctx.lineTo(W, ox.y);
    ctx.stroke();
    ctx.strokeStyle = palette.axisY;
    ctx.beginPath();
    ctx.moveTo(ox.x, 0);
    ctx.lineTo(ox.x, H);
    ctx.stroke();
  }

  /* ---------- Mouse ---------- */

  onMouseDown(e: MouseEvent): void {
    const { sx, sy } = this.toLocal(e);

    // ── Model-space tiled viewport focus ──
    if (this.layoutMgr.isModelSpace() && this.modelVps.tiles.length > 1) {
      const W = this.mainRef.nativeElement.width;
      const H = this.mainRef.nativeElement.height;
      const tile = this.modelVps.tileAt(sx, sy, W, H);
      if (tile && tile.id !== this.modelVps.activeTileId) {
        this.modelVps.setActiveTile(tile.id);
      }
    }

    const isPanGesture = e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && this.toolMgr.activeToolName() === 'pan');
    if (isPanGesture) {
      this.isPanning = true;
      const activeTile = this.modelVps.activeTile;
      if (this.layoutMgr.isModelSpace() && this.modelVps.tiles.length > 1 && activeTile) {
        this.panStart = { sx: e.clientX, sy: e.clientY, px: activeTile.panX, py: activeTile.panY };
      } else {
        this.panStart = { sx: e.clientX, sy: e.clientY, px: this.vm.panX, py: this.vm.panY };
      }
      this.wrapRef.nativeElement.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    // ── Paper-space viewport interaction ──
    // Active tool='viewport' creates new viewports; otherwise click inside a
    // viewport activates it and either resizes, moves, or pans the camera.
    if (e.button === 0 && this.toolMgr.activeToolName() !== 'viewport') {
      // If clicking inside an EXISTING viewport, activate it on first click
      const hoveredVp = this.vps.vpAt(sx, sy);
      if (hoveredVp && hoveredVp.id !== this.vps.activeId) {
        this.vps.activate(hoveredVp.id);
      }
      // Try the manager's drag interception (border/header/pan inside viewport)
      if (this.vps.startDrag(sx, sy)) {
        this.wrapRef.nativeElement.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      // No viewport claim — if there was an active viewport and we clicked
      // outside it, deactivate so the model-space tools resume.
      const active = this.vps.active;
      if (active && !active.containsPoint(sx, sy)) {
        this.vps.deactivateAll();
      }
    }

    // Grip editing belongs to the Select tool. Let active draw/modify tools
    // receive endpoint clicks even when a previous selection left grips visible
    // (EXTEND, for example, commits by clicking near the previewed endpoint).
    if (e.button === 0
      && this.toolMgr.activeToolName() === 'select'
      && this.grips.visible()
      && !((this.toolMgr.activeTool as any)?.isWindowSelecting?.())) {
      const g = this.grips.getGripAt(sx, sy);
      if (g) {
        this.grips.beginDrag(g);
        return;
      }
    }

    const anchor = this.toolMgr.activeTool?.getAnchor?.() ?? null;
    const r = this.snap.resolve(sx, sy, anchor);
    this.toolMgr.activeTool?.onMouseDown?.(r.wx, r.wy, sx, sy, e);
    if (this.toolMgr.activeToolName() === 'pan' && e.button === 0) {
      this.wrapRef.nativeElement.style.cursor = 'grabbing';
    }
    if (this.grips.visible() && this.toolMgr.activeToolName() === 'select') {
      this.grips.generate();
    }
  }

  onMouseMove(e: MouseEvent): void {
    // Mark the dynamic canvas as needing a redraw. The crosshair, snap marker
    // and tool preview must refresh whenever the cursor position changes.
    this._dynamicNeedsRedraw = true;
    if (this.isPanning) {
      const activeTile = this.modelVps.activeTile;
      if (this.layoutMgr.isModelSpace() && this.modelVps.tiles.length > 1 && activeTile) {
        activeTile.panX = this.panStart.px + (e.clientX - this.panStart.sx);
        activeTile.panY = this.panStart.py + (e.clientY - this.panStart.sy);
      } else {
        this.vm.panX = this.panStart.px + (e.clientX - this.panStart.sx);
        this.vm.panY = this.panStart.py + (e.clientY - this.panStart.sy);
      }
      this.vm.markDirty();
      this.vm.markGridDirty();
    }
    const { sx, sy } = this.toLocal(e);
    this.mouseX = sx;
    this.mouseY = sy;
    this.mouseInCanvas = true;

    // Viewport drag (pan/move/resize) takes precedence over tool moves
    if (this.vps.isDragging()) {
      this.vps.updateDrag(sx, sy);
      return;
    }

    // Update cursor style if hovering on a viewport handle/edge
    if (this.toolMgr.activeToolName() !== 'viewport') {
      const cur = this.vps.cursorFor(sx, sy);
      if (cur) this.wrapRef.nativeElement.style.cursor = cur;
      else if (!this.isPanning) {
        this.wrapRef.nativeElement.style.cursor = resolveCadCursor(this.toolMgr.activeToolName(), this.toolMgr.activeTool?.getCursor?.());
      }
    }

    // Mark that the mouse moved so the RAF loop will run snap.resolve() once.
    // We intentionally do NOT call snap.resolve() here to avoid O(k) snap
    // work at 100+ Hz — it runs at most once per ~16ms frame in renderFrame.
    this._lastMouseEvent = e;
    this._pendingMouseMove = true;
  }

  /** Called once per RAF frame from renderFrame to process the latest mouse position. */
  private processMouseMove(): void {
    if (!this._pendingMouseMove) return;
    this._pendingMouseMove = false;

    const sx = this.mouseX;
    const sy = this.mouseY;
    if (sx === this._lastSnapSx && sy === this._lastSnapSy && !this.isPanning) return;
    this._lastSnapSx = sx;
    this._lastSnapSy = sy;

    // Throttled cursor position update (was in raw mousemove — moved here to
    // cap Angular signal updates at RAF rate instead of raw mouse-poll rate).
    this.dynInput.setCursor(sx, sy);

    let anchor = this.toolMgr.activeTool?.getAnchor?.() ?? null;
    if (!anchor && this.grips.dragStartWorld) {
      anchor = { x: this.grips.dragStartWorld.x, y: this.grips.dragStartWorld.y };
    } else if (!anchor && this.grips.activeGrip) {
      anchor = { x: this.grips.activeGrip.x, y: this.grips.activeGrip.y };
    }
    const r = this.snap.resolve(sx, sy, anchor);
    this.vm.lastCursorWorld = { x: r.wx, y: r.wy };
    this.vm.cursorX.set(r.wx.toFixed(3));
    this.vm.cursorY.set(r.wy.toFixed(3));

    if (this.grips.dragging) {
      this.grips.updateDrag(r.wx, r.wy);
      this.vm.markDirty();
      return;
    }
    if (this.grips.visible()) {
      if ((this.toolMgr.activeTool as any)?.isWindowSelecting?.()) {
        this.grips.setHover(null);
      } else {
        this.grips.setHover(this.grips.getGripAt(sx, sy));
      }
    }

    if (!this.isPanning) {
      this.toolMgr.activeTool?.onMouseMove?.(r.wx, r.wy, sx, sy, this._lastMouseEvent!);
    }
  }

  onMouseUp(e: MouseEvent): void {
    if (this.isPanning) {
      this.isPanning = false;
      this.wrapRef.nativeElement.style.cursor = resolveCadCursor(this.toolMgr.activeToolName(), this.toolMgr.activeTool?.getCursor?.());
      return;
    }
    if (this.vps.isDragging()) {
      this.vps.endDrag();
      this.wrapRef.nativeElement.style.cursor = resolveCadCursor(this.toolMgr.activeToolName(), this.toolMgr.activeTool?.getCursor?.());
      return;
    }
    if (this.grips.dragging) {
      this.grips.commitDrag();
      this.grips.generate();
      this.vm.markDirty();
      return;
    }
    const { sx, sy } = this.toLocal(e);
    const anchor = this.toolMgr.activeTool?.getAnchor?.() ?? null;
    const r = this.snap.resolve(sx, sy, anchor);
    this.toolMgr.activeTool?.onMouseUp?.(r.wx, r.wy, sx, sy, e);
    if (this.toolMgr.activeToolName() === 'pan' && e.button === 0) {
      this.wrapRef.nativeElement.style.cursor = 'grab';
    }
  }

  onWheel(e: WheelEvent): void {
    const rect = this.wrapRef.nativeElement.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // Wheel inside an active viewport zooms the viewport camera; otherwise zoom main view
    if (this.vps.handleWheel(e, cx, cy)) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;

    if (this.layoutMgr.isModelSpace() && this.modelVps.tiles.length > 1) {
      const W = this.mainRef.nativeElement.width;
      const H = this.mainRef.nativeElement.height;
      const tile = this.modelVps.tileAt(cx, cy, W, H);
      if (tile) {
        if (tile.id !== this.modelVps.activeTileId) {
          this.modelVps.setActiveTile(tile.id);
        }
        const tx = tile.rect.x * W;
        const ty = tile.rect.y * H;
        const tw = tile.rect.w * W;
        const th = tile.rect.h * H;
        const tileCx = tx + tw / 2;
        const tileCy = ty + th / 2;
        const mouseRelX = cx - tileCx;
        const mouseRelY = cy - tileCy;

        const oldScale = tile.scale;
        const newScale = tile.scale * factor;
        tile.scale = newScale;
        tile.panX = (tile.panX - mouseRelX) * (newScale / oldScale) + mouseRelX;
        tile.panY = (tile.panY - mouseRelY) * (newScale / oldScale) + mouseRelY;

        this.vm.markDirty();
        this.modelVps.bump();
        return;
      }
    }

    this.vm.zoomAt(factor, cx, cy);
  }

  /**
   * Double-click handler.
   *
   * In MODEL mode: hit-test entity and emit entityActivated.
   * In PSPACE mode: double-click inside a viewport → enter MSPACE.
   * In MSPACE mode: double-click OUTSIDE the active viewport → exit to PSPACE.
   */
  onDblClick(e: MouseEvent): void {
    if (e.button !== 0) return;
    const { sx, sy } = this.toLocal(e);
    const mode = this.layoutMgr.workspaceMode();

    // ── PSPACE: enter MSPACE on dblclick inside a viewport ────────────────
    if (mode === 'PSPACE') {
      const layout = this.layoutMgr.activeLayout();
      const geom = this.paperRenderer.computePaperGeometry(layout);
      const vp = this.paperRenderer.viewportAtScreen(sx, sy, layout, geom);
      if (vp) {
        e.stopPropagation();
        this.layoutMgr.enterMspace(vp.id);
        this.vm.markDirty();
        return;
      }
    }

    // ── MSPACE: exit to PSPACE on dblclick outside the active viewport ────
    if (mode === 'MSPACE') {
      const layout = this.layoutMgr.activeLayout();
      const geom = this.paperRenderer.computePaperGeometry(layout);
      const vp = this.layoutMgr.activeMspaceViewport();
      if (vp) {
        const tl = geom.mm2s(vp.x, vp.y + vp.h);
        const br = geom.mm2s(vp.x + vp.w, vp.y);
        const insideVp = sx >= tl.x && sx <= br.x && sy >= tl.y && sy <= br.y;
        if (!insideVp) {
          e.stopPropagation();
          this.layoutMgr.exitMspace();
          this.vm.markDirty();
          return;
        }
      }
    }

    // ── MODEL / MSPACE entity activation ──────────────────────────────────
    if (mode !== 'PSPACE') {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (!hit) return;
      e.stopPropagation();
      deselectAll(this.doc);
      hit.entity.selected = true;
      this.vm.markContentDirty();
      this.entityActivated.emit({ entity: hit.entity, sx, sy });
    }
  }

  zoomIn(): void {
    this.vm.zoomAt(1.5, this.vm.canvasWidth / 2, this.vm.canvasHeight / 2);
  }
  zoomOut(): void {
    this.vm.zoomAt(1 / 1.5, this.vm.canvasWidth / 2, this.vm.canvasHeight / 2);
  }
  zoomExtents(): void {
    this.vm.zoomExtents(this.doc);
  }
  toggleGrid(): void {
    this.snap.toggleGrid();
  }

  /** Returns the main canvas as a PNG data URL. */
  snapshotPng(): string {
    return this.mainRef.nativeElement.toDataURL('image/png');
  }

  private toLocal(e: MouseEvent): { wx: number; wy: number; sx: number; sy: number } {
    const rect = this.wrapRef.nativeElement.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    let w: { x: number, y: number };

    if (this.layoutMgr.workspaceMode() === 'MSPACE') {
      const layout = this.layoutMgr.activeLayout();
      const geom = this.paperRenderer.computePaperGeometry(layout);
      w = this.paperRenderer.screenToModelWorld(sx, sy, layout.activeMspaceViewportId!, layout, geom);
    } else {
      w = this.vm.s2w(sx, sy);
    }

    return { wx: w.x, wy: w.y, sx, sy };
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) {
      return;
    }
    // Space is reserved for the AutoCAD-style command flow now (command bar
    // confirm, DI confirm, idle repeat-last). Hold-space-pan is gone; pan via
    // middle-mouse, Alt+drag, or the pan tool.
    if (e.key === 'Shift' && !this.grips.visible()) {
      this.grips.setVisible(true);
    }
    if (e.key === 'Escape' && this.grips.dragging) {
      this.grips.cancelDrag();
      this._dynamicNeedsRedraw = true; // ensure the drag preview clears on next frame
      return;
    }
    // Ctrl+Shift+H — toggle hatch dependency debug overlay.
    if (e.key === 'H' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      this.hatchDebug.enabled = !this.hatchDebug.enabled;
      this.vm.markDirty();
      return;
    }
    // Ctrl+Shift+T — toggle topology pipeline debug overlay.
    if (e.key === 'T' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      this.topologyDebug.enabled = !this.topologyDebug.enabled;
      if (!this.topologyDebug.enabled) this.topologyDebug.clear();
      // eslint-disable-next-line no-console
      this.vm.markDirty();
      return;
    }
    
    // Map Spacebar to Enter to mimic AutoCAD behavior for tools.
    let forwardedEvent = e;
    if (e.key === ' ') {
      forwardedEvent = new Proxy(e, {
        get(target, prop) {
          if (prop === 'key' || prop === 'code') return 'Enter';
          return Reflect.get(target, prop);
        }
      });
    }
    this.toolMgr.activeTool?.onKeyDown?.(forwardedEvent);
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent): void {
    if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) {
      return;
    }

    // Forward to active tool first (for Shift key tracking in Trim/Extend)
    this.toolMgr.activeTool?.onKeyUp?.(e);

    if (e.key === 'Shift' && this.grips.visible() && !this.grips.dragging) {
      this.grips.setVisible(false);
    }
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D): void {
    if (!this.mouseInCanvas || this.isPanning || this.toolMgr.activeToolName() === 'pan') return;
    const hint = this.toolMgr.activeTool?.getCursor?.();
    const isPickbox = hint === 'pickbox' || this.toolMgr.activeToolName() === 'select';
    const isCrosshair = hint === 'crosshair' || !hint;
    
    if (!isPickbox && !isCrosshair) return; // Allow OS to handle grab/extend

    const mx = this.mouseX;
    const my = this.mouseY;
    
    const sizePct = this.vm.cursorSize / 100;
    // Crosshair length based on max dimension
    const lineLen = Math.max(this.vm.canvasWidth, this.vm.canvasHeight) * sizePct / 2;
    const box = this.vm.pickboxSize;

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    // Use difference blending if canvas has bright background (not supported universally but useful for CAD)
    ctx.globalCompositeOperation = 'difference'; 
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    
    if (isPickbox) {
      // Draw lines touching the box
      ctx.moveTo(mx - lineLen, my);
      ctx.lineTo(mx - box, my);
      ctx.moveTo(mx + box, my);
      ctx.lineTo(mx + lineLen, my);
      
      ctx.moveTo(mx, my - lineLen);
      ctx.lineTo(mx, my - box);
      ctx.moveTo(mx, my + box);
      ctx.lineTo(mx, my + lineLen);
      
      // Draw pickbox
      ctx.rect(mx - box, my - box, box * 2, box * 2);
    } else {
      // Just crosshair
      ctx.moveTo(mx - lineLen, my);
      ctx.lineTo(mx + lineLen, my);
      ctx.moveTo(mx, my - lineLen);
      ctx.lineTo(mx, my + lineLen);
    }
    
    ctx.stroke();
    ctx.restore();
  }


  private drawModelSpaceTiledViewports(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const tiles = this.modelVps.tiles;
    if (!tiles.length) return;

    // Save the global VM state (which currently reflects the active tile)
    const activePanX = this.vm.panX;
    const activePanY = this.vm.panY;
    const activeScale = this.vm.scale;
    const activeVpX = this.vm.vpCenterX;
    const activeVpY = this.vm.vpCenterY;

    for (const t of tiles) {
      const tx = Math.floor(t.rect.x * W);
      const ty = Math.floor(t.rect.y * H);
      const tw = Math.floor(t.rect.w * W);
      const th = Math.floor(t.rect.h * H);

      // Mutate global VM so drawing methods naturally resolve for this tile
      this.vm.panX = t.panX;
      this.vm.panY = t.panY;
      this.vm.scale = t.scale;
      this.vm.vpCenterX = tx + tw / 2;
      this.vm.vpCenterY = ty + th / 2;

      ctx.save();
      ctx.beginPath();
      ctx.rect(tx, ty, tw, th);
      ctx.clip();

      // 1. Draw Background
      ctx.fillStyle = this.theme.canvas().canvasBg;
      ctx.fillRect(tx, ty, tw, th);

      // 2. Draw Grid (requires its own save/restore since it translates)
      ctx.save();
      this.drawGrid(ctx, W, H);
      ctx.restore();

      // 3. Draw Entities (natively uses VM and spatial culling!)
      this.doc.drawAll(ctx);

      ctx.restore();

      // Tile border highlight (Blue if active, Slate if inactive)
      ctx.strokeStyle = t.active ? '#2563eb' : '#334155';
      ctx.lineWidth = t.active ? 2.5 : 1;
      ctx.strokeRect(tx, ty, tw, th);
    }

    // Restore the global VM to the active tile
    this.vm.panX = activePanX;
    this.vm.panY = activePanY;
    this.vm.scale = activeScale;
    this.vm.vpCenterX = activeVpX;
    this.vm.vpCenterY = activeVpY;
  }
}

function isEditableTarget(t: EventTarget | Element | null): boolean {
  if (!t || !(t as Element).tagName) return false;
  const el = t as HTMLElement;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * AutoCAD-style pickbox cursor — a crosshair with a small square at center.
 * Encoded as an SVG data URI so the OS cursor engine renders it at zero latency.
 */
const PICKBOX_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Crect x='12' y='12' width='8' height='8' fill='none' stroke='white' stroke-width='1.5'/%3E%3Cline x1='16' y1='2' x2='16' y2='10' stroke='white' stroke-width='1'/%3E%3Cline x1='16' y1='22' x2='16' y2='30' stroke='white' stroke-width='1'/%3E%3Cline x1='2' y1='16' x2='10' y2='16' stroke='white' stroke-width='1'/%3E%3Cline x1='22' y1='16' x2='30' y2='16' stroke='white' stroke-width='1'/%3E%3C/svg%3E") 16 16, crosshair`;

/**
 * Extend cursor — crosshair with a plus/extension indicator.
 * Encoded as an SVG data URI for zero-latency OS rendering.
 */
const EXTEND_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cline x1='16' y1='2' x2='16' y2='10' stroke='white' stroke-width='1'/%3E%3Cline x1='16' y1='22' x2='16' y2='30' stroke='white' stroke-width='1'/%3E%3Cline x1='2' y1='16' x2='10' y2='16' stroke='white' stroke-width='1'/%3E%3Cline x1='22' y1='16' x2='30' y2='16' stroke='white' stroke-width='1'/%3E%3Cline x1='20' y1='12' x2='26' y2='12' stroke='%23FFA500' stroke-width='2'/%3E%3Cline x1='23' y1='9' x2='23' y2='15' stroke='%23FFA500' stroke-width='2'/%3E%3C/svg%3E") 16 16, crosshair`;

/**
 * Universal cursor resolver for the CAD canvas. Tools declare a cursor hint
 * via getCursor(); this maps that hint (and the tool name) to a CSS cursor.
 *
 * Known hints: 'pickbox', 'crosshair', 'grab', 'grabbing', 'move', 'rotate'.
 * Extensible — just add entries to the switch.
 */
function resolveCadCursor(toolName: string, cursorHint?: string): string {
  if (cursorHint) {
    switch (cursorHint) {
      case 'pickbox': return 'none';
      case 'extend': return EXTEND_CURSOR;
      case 'grab': return 'grab';
      case 'grabbing': return 'grabbing';
      case 'move': return 'move';
      case 'crosshair': return 'none';
      // Future: 'rotate', 'scale', 'text', etc.
    }
  }
  // Fallback: pan tool gets grab, everything else hides the OS cursor (software-rendered).
  return toolName === 'pan' ? 'grab' : 'none';
}

