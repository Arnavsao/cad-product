import {
  AfterViewInit,
  Component,
  HostListener,
  OnInit,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
  effect,
  inject,
  signal,
  Injector,
  output,
  ChangeDetectionStrategy,
  input
} from '@angular/core';
import { Location } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { AccountButtonComponent } from '../../shared/ui/account-button.component';
import { relativeTime } from '../../shared/ui/pipes/relative-time.pipe';
import { rotateEntityInPlace, snapshotEntity } from './tools/geometry-utils';

import { CanvasComponent } from './features/canvas/canvas.component';
import { ToolbarComponent } from './features/toolbar/toolbar.component';
import { SidebarComponent } from './features/sidebar/sidebar.component';
import { LayersPanelComponent } from './features/panels/layers-panel.component';
import { PropertiesPanelComponent } from './features/panels/properties-panel.component';
import { SettingsPanelComponent } from './features/settings/settings-panel.component';
import { BlocksPanelComponent } from './features/panels/blocks-panel.component';
import { CommandLineComponent } from './features/command-line/command-line.component';
import { StatusBarComponent } from './features/status-bar/status-bar.component';
import { TextEditorOverlayComponent } from './features/text-editor/text-editor-overlay.component';
import { TextEditorService } from './features/text-editor/text-editor.service';
import { TextEditorRibbonComponent } from './features/toolbar/text-editor-ribbon.component';
import { TableEditorOverlayComponent } from './features/table-editor/table-editor-overlay.component';
import { TableEditorService } from './features/table-editor/table-editor.service';
import { InsertTableDialogComponent } from './features/table-editor/insert-table-dialog.component';
import { SymbolPickerOverlayComponent } from './features/symbol-picker/symbol-picker-overlay.component';
import { ToolManagerService } from './core/services/tool-manager.service';
import { CommandStackService } from './core/services/command-stack.service';
import { DocumentService } from './core/services/document.service';
import { ViewModelService } from './core/services/view-model.service';
import { SelectTool } from './tools/select/select-tool';
import { ArrayTool } from './tools/modify/array-tool';
import { DistTool } from './tools/inquiry/dist-tool';
import { AreaTool } from './tools/inquiry/area-tool';
import { IdTool } from './tools/inquiry/id-tool';
import { ListTool } from './tools/inquiry/list-tool';
import { AutosaveService } from './core/services/autosave.service';
import { DrawingPersistenceService } from './core/services/drawing-persistence.service';
import { DrawingBrowserService } from './features/drawing-browser/drawing-browser.service';
import { DrawingBrowserComponent } from './features/drawing-browser/drawing-browser.component';
import { PanTool } from './tools/select/pan-tool';
import { LineTool } from './tools/draw/line-tool';
import { CenterlineTool } from './tools/draw/centerline-tool';
import { CenterMarkTool } from './tools/draw/centermark-tool';
import { RectTool } from './tools/draw/rect-tool';
import { PolylineTool } from './tools/draw/polyline-tool';
import { ArcTool } from './tools/draw/arc-tool';
import { PointTool } from './tools/draw/point-tool';
import { TextTool } from './tools/draw/text-tool';
import { EllipseTool } from './tools/draw/ellipse-tool';
import { DeleteTool } from './tools/select/delete-tool';
import { MoveTool } from './tools/modify/move-tool';
import { RotateTool } from './tools/modify/rotate-tool';
import { ScaleTool } from './tools/modify/scale-tool';
import { MirrorTool } from './tools/modify/mirror-tool';
import { StretchTool } from './tools/modify/stretch-tool';
import { TrimTool } from './tools/modify/trim-tool';
import { OffsetTool } from './tools/modify/offset-tool';
import { FilletTool } from './tools/modify/fillet-tool';
import { ChamferTool } from './tools/modify/chamfer-tool';
import { BlendTool } from './tools/modify/blend-tool';
import { JoinTool } from './tools/modify/join-tool';
import { ExtendTool } from './tools/modify/extend-tool';
import { TorientTool } from './tools/modify/torient-tool';
import { MatchPropTool } from './tools/modify/matchprop-tool';
import { XLineTool, XLineHorTool, XLineVerTool } from './tools/draw/xline-tool';
import { SplineTool } from './tools/draw/spline-tool';
import { DrawOrderTool, DrawOrderMode } from './tools/modify/draw-order-tool';
import { ViewportsPanelComponent } from './features/panels/viewports-panel.component';
import { PdfExportService } from './core/services/pdf-export.service';
import { DxfImportService } from './core/services/dxf-import.service';
import { ExportService } from './core/services/export.service';
import { PlotDialogComponent } from './features/plot-dialog/plot-dialog.component';
import { PlotDialogService } from './features/plot-dialog/plot-dialog.service';
import { NotificationService } from '../../core/services/notification.service';
import { ExportManagerService } from './core/services/export/export-manager.service';
import { SnappingService } from './core/services/snapping.service';
import { DynamicInputService } from './core/services/dynamic-input.service';
import { CommandPromptService } from './core/services/command-prompt.service';
import { ViewportManagerService } from './core/services/viewport-manager.service';
import { ThemeService } from './core/services/theme.service';
import type { Entity } from './core/models/entity.model';
import { DeleteMultipleCmd, ExplodeInsertCmd, CompoundCmd, ModifyPropertiesCmd } from './core/models/command.model';
import { PasteTool } from './tools/modify/paste-tool';
import { CopyTool } from './tools/modify/copy-tool';
import { CadClipboardService } from './core/services/cad-clipboard.service';
import { LibraryPanelComponent } from './features/library/library-panel.component';
import { SaveToLibraryModalComponent } from './features/library/save-to-library-modal.component';
import { SaveToLibraryModalService } from './features/library/save-to-library-modal.service';
import { CreateBlockDialogComponent } from './features/block-dialogs/create-block-dialog.component';
import { CreateBlockDialogService } from './features/block-dialogs/create-block-dialog.service';
import { InsertBlockDialogComponent } from './features/block-dialogs/insert-block-dialog.component';
import { InsertBlockDialogService } from './features/block-dialogs/insert-block-dialog.service';
import { AttribPromptDialogComponent } from './features/block-dialogs/attrib-prompt-dialog.component';
import { AttribPromptDialogService } from './features/block-dialogs/attrib-prompt-dialog.service';
import { ContextMenuService } from './core/services/context-menu.service';
import { LibraryService } from './core/services/library.service';
import { FileImportService } from './core/services/file-import.service';
import { CommandRegistryService } from './core/services/command-registry.service';
import { DrawingTransferService } from './core/services/drawing-transfer.service';
import { EntityJsonSerializer } from './core/services/entity-json.serializer';
import { WorkspacePanelService } from './features/workspace-panel/workspace-panel.service';
import { DrawOrderService } from './core/services/draw-order.service';
import { BlockEditorService } from './core/services/block-editor.service';
import { BlockEditorBarComponent } from './features/block-editor/block-editor-bar.component';
import { DimTextEditorOverlayComponent } from './features/dim-text-editor/dim-text-editor-overlay.component';
import { DimTextEditorService } from './features/dim-text-editor/dim-text-editor.service';
import { WorkspaceTabsComponent } from './features/workspace-tabs/workspace-tabs.component';
import { LayoutManagerService } from './core/services/layout-manager.service';
import { PageSetupDialogComponent } from './features/page-setup/page-setup-dialog.component';
import { PageSetupDialogService } from './features/page-setup/page-setup-dialog.service';
import { LayoutManagerDialogComponent } from './features/layout-manager/layout-manager-dialog.component';
import { LayoutManagerDialogService } from './features/layout-manager/layout-manager-dialog.service';
import { DimStyleDialogComponent } from './features/dim-style-dialog/dim-style-dialog.component';
import { DimStyleDialogService } from './features/dim-style-dialog/dim-style-dialog.service';
import { FindDialogComponent } from './features/find-dialog/find-dialog.component';
import { FindDialogService } from './features/find-dialog/find-dialog.service';
import { DocumentTabsComponent } from './features/document-tabs/document-tabs.component';
import { DocumentManagerService } from './core/services/document-manager.service';
import { AiAgentPanelComponent } from './features/ai-agent/ai-agent-panel.component';
import { AiToolRegistryService } from './features/ai-agent/services/ai-tool-registry.service';
import { CursorSizeTool } from './tools/options/cursor-size-tool';
import { PickboxTool } from './tools/options/pickbox-tool';
import { VportsDialogComponent } from './features/vports-dialog/vports-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-cad-editor',
  standalone: true,
  imports: [
    CanvasComponent,
    ToolbarComponent,
    SidebarComponent,
    LayersPanelComponent,
    PropertiesPanelComponent,
    SettingsPanelComponent,
    BlocksPanelComponent,
    ViewportsPanelComponent,
    CommandLineComponent,
    StatusBarComponent,
    TextEditorOverlayComponent,
    TableEditorOverlayComponent,
    InsertTableDialogComponent,
    SymbolPickerOverlayComponent,
    PlotDialogComponent,
    LibraryPanelComponent,
    SaveToLibraryModalComponent,
    CreateBlockDialogComponent,
    InsertBlockDialogComponent,
    AttribPromptDialogComponent,
    BlockEditorBarComponent,
    WorkspaceTabsComponent,
    PageSetupDialogComponent,
    LayoutManagerDialogComponent,
    DimStyleDialogComponent,
    FindDialogComponent,
    DrawingBrowserComponent,
    DocumentTabsComponent,
    TextEditorRibbonComponent,
    AiAgentPanelComponent,
    VportsDialogComponent,
    DimTextEditorOverlayComponent,
    AccountButtonComponent
  ],
  templateUrl: './cad-editor.html',
  styleUrl: './cad-editor.scss',
  encapsulation: ViewEncapsulation.None,
})
export class CadEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  private injector = inject(Injector);
  readonly initialDxf = input<string>(undefined);

  /**
   * Cloud drawing to open, bound from `/editor/:id` by
   * `withComponentInputBinding()`. Undefined on a bare `/editor` (a scratch
   * drawing that has not been saved yet).
   */
  readonly id = input<string>(undefined);

  /**
   * Where the header's back button goes. Embedded hosts pass `[exitUrl]="null"`
   * to keep the browser-history behaviour they had before this app grew a
   * dashboard of its own.
   */
  readonly exitUrl = input<string | null>('/dashboard');

  readonly save = output<string>();
  readonly close = output<void>();

  isLoading = signal(false);

  commandLine?: CommandLineComponent;

  private location = inject(Location);
  private router = inject(Router);
  private title = inject(Title);

  /**
   * Leave the editor. `close` was declared but never emitted, so embedding
   * hosts had no way to react; it now fires before the navigation so a host
   * can tear its wrapper down either way.
   */
  goBack(): void {
    this.close.emit();
    const url = this.exitUrl();
    if (url) void this.router.navigateByUrl(url);
    else this.location.back();
  }

  rotateDocument() {
    const angleRad = Math.PI / 2; // 90 degrees
    const entities = this.doc.activeFile.entities;
    if (!entities.length) return;

    // We'll rotate around the origin (0,0) by default, or you can compute a bounding box center.
    // For a whole drawing, rotating around (0,0) is standard.
    const cx = 0;
    const cy = 0;

    const snapshots = entities.map(ent => ({
      ent,
      snap: snapshotEntity(ent)
    }));

    this.cmds.push({
      execute: () => {
        entities.forEach(ent => rotateEntityInPlace(ent, cx, cy, angleRad));
        this.doc.bump();
        this.vm.markContentDirty();
      },
      undo: () => {
        snapshots.forEach(s => Object.assign(s.ent, s.snap));
        this.doc.bump();
        this.vm.markContentDirty();
      }
    });

    this.vm.zoomExtentsWhenReady(this.doc);
  }

  protected toolMgr = inject(ToolManagerService);
  protected cmds = inject(CommandStackService);
  protected doc = inject(DocumentService);
  protected vm = inject(ViewModelService);
  protected dxfImport = inject(DxfImportService);
  protected get exporter() { return this.injector.get(ExportService); }
  protected get pdfExporter() { return this.injector.get(PdfExportService); }
  protected snap = inject(SnappingService);
  protected dynInput = inject(DynamicInputService);
  protected cmdPrompt = inject(CommandPromptService);
  protected vps = inject(ViewportManagerService);
  protected textEditor = inject(TextEditorService);
  protected tableEditor = inject(TableEditorService);
  protected get plotDialog() { return this.injector.get(PlotDialogService); }
  protected get exportMgr() { return this.injector.get(ExportManagerService); }
  protected theme = inject(ThemeService);
  protected get saveToLibraryModal() { return this.injector.get(SaveToLibraryModalService); }
  protected contextMenu = inject(ContextMenuService);
  protected get library() { return this.injector.get(LibraryService); }
  protected get fileImport() { return this.injector.get(FileImportService); }
  protected notify = inject(NotificationService);
  protected get drawingTransfer() { return this.injector.get(DrawingTransferService); }
  protected cmdRegistry = inject(CommandRegistryService);
  protected panelService = inject(WorkspacePanelService);
  protected drawOrder = inject(DrawOrderService);
  protected get blockEditor() { return this.injector.get(BlockEditorService); }
  protected layoutMgr = inject(LayoutManagerService);
  protected get pageSetupDialog() { return this.injector.get(PageSetupDialogService); }
  protected get layoutManagerDialog() { return this.injector.get(LayoutManagerDialogService); }
  protected get dimStyleDialog() { return this.injector.get(DimStyleDialogService); }
  protected get findDialog() { return this.injector.get(FindDialogService); }
  protected docManager = inject(DocumentManagerService);
  // Persistence: browser-storage save/open plus autosave crash recovery.
  protected autosave = inject(AutosaveService);
  protected persist = inject(DrawingPersistenceService);
  protected drawingBrowser = inject(DrawingBrowserService);
  /** Ticks once a minute so the "Autosaved Nm ago" label stays truthful. */
  private nowTick = signal(0);
  private savedAgoTimer: ReturnType<typeof setInterval> | null = null;
  protected cadClipboard = inject(CadClipboardService);
  protected dimTextEditor = inject(DimTextEditorService);
  private _aiTools = inject(AiToolRegistryService);

  protected get createBlockDialog() { return this.injector.get(CreateBlockDialogService); }
  protected get insertBlockDialog() { return this.injector.get(InsertBlockDialogService); }
  protected get attribPromptDialog() { return this.injector.get(AttribPromptDialogService); }
  isDraggingFiles = signal<boolean>(false);
  isDraggingOverCanvas = signal<boolean>(false);
  private dragEnterCount = 0;

  /** Set once `ngAfterViewInit` has run its startup sequence. */
  private viewReady = false;

  /** The `/editor/:id` value the startup sequence (or the effect) last acted on. */
  private handledId: string | null = null;

  constructor() {
    // Forward DXF exports from the Plot dialog to the parent app's `save`
    // output so host integrations (parent route, embedding shell) keep
    // receiving the DXF string the way they did under the legacy menu.
    effect(() => {
      const dxf = this.exportMgr.lastDxfSave();
      if (dxf) this.save.emit(dxf);
    });

    // Browser tab title tracks the active drawing, with AutoCAD's dirty dot.
    effect(() => {
      const docs = this.docManager.documents();
      const activeId = this.docManager.activeTabId;
      const doc = docs.find((d) => d.tabId === activeId);
      const name = doc?.file.name?.trim() || 'Drawing';
      this.title.setTitle(`${name}${doc?.isDirty ? ' •' : ''} — CADOnline`);
    });

    // Later `/editor/:id` changes (Save As rewrites the URL, the dashboard
    // deep-links into an already-open editor). The first id is handled by
    // `ngAfterViewInit` so it keeps its place in the startup ordering.
    effect(() => {
      const id = this.id();
      if (!this.viewReady || !id || id === this.handledId) return;
      this.handledId = id;
      // Already showing this drawing (e.g. the URL we just rewrote after Save
      // As) — bring its tab forward and do nothing else. Re-opening would
      // discard the very edits that produced the id.
      const openTab = this.persist.tabForRemoteId(id);
      if (openTab) {
        this.docManager.activateDocument(openTab);
        return;
      }
      void this.persist.openRemote(id);
    });
  }

  ngOnInit(): void {
    this.toolMgr.register('select', (i) => new SelectTool(i));
    this.toolMgr.register('pan', (i) => new PanTool(i));
    this.toolMgr.register('line', (i) => new LineTool(i));
    this.toolMgr.register('centerline', (i) => new CenterlineTool(i));
    this.toolMgr.register('centermark', (i) => new CenterMarkTool(i));
    this.toolMgr.register('rect', (i) => new RectTool(i));

    this.toolMgr.registerAsync('polygon', async (i) => new (await import('./tools/draw/polygon-tool')).PolygonTool(i));
    this.toolMgr.register('polyline', (i) => new PolylineTool(i));
    this.toolMgr.register('arc', (i) => new ArcTool(i, '3p'));
    this.toolMgr.register('arc_sce', (i) => new ArcTool(i, 'sce'));
    this.toolMgr.register('arc_sca', (i) => new ArcTool(i, 'sca'));
    this.toolMgr.register('arc_scl', (i) => new ArcTool(i, 'scl'));
    this.toolMgr.register('arc_cse', (i) => new ArcTool(i, 'cse'));
    this.toolMgr.register('arc_csa', (i) => new ArcTool(i, 'csa'));
    this.toolMgr.register('arc_csl', (i) => new ArcTool(i, 'csl'));
    this.toolMgr.register('arc_sea', (i) => new ArcTool(i, 'sea'));
    this.toolMgr.register('arc_sed', (i) => new ArcTool(i, 'sed'));
    this.toolMgr.register('arc_ser', (i) => new ArcTool(i, 'ser'));
    this.toolMgr.register('arc_cont', (i) => new ArcTool(i, 'cont'));
    this.toolMgr.register('point', (i) => new PointTool(i));
    this.toolMgr.register('text', (i) => new TextTool(i));
    this.toolMgr.register('ellipse', (i) => new EllipseTool(i, 'center'));
    this.toolMgr.register('ellipse_axis', (i) => new EllipseTool(i, 'axis'));
    this.toolMgr.register('ellipse_arc', (i) => new EllipseTool(i, 'arc'));
    this.toolMgr.register('move', (i) => new MoveTool(i));
    this.toolMgr.register('rotate', (i) => new RotateTool(i));
    this.toolMgr.register('torient', (i) => new TorientTool(i));
    this.toolMgr.register('scale', (i) => new ScaleTool(i));
    this.toolMgr.register('mirror', (i) => new MirrorTool(i));
    this.toolMgr.register('stretch', (i) => new StretchTool(i));
    this.toolMgr.register('trim', (i) => new TrimTool(i));
    this.toolMgr.register('offset', (i) => new OffsetTool(i));
    this.toolMgr.register('fillet', (i) => new FilletTool(i));
    this.toolMgr.register('chamfer', (i) => new ChamferTool(i));
    this.toolMgr.register('blend_curves', (i) => new BlendTool(i));
    this.toolMgr.register('join', (i) => new JoinTool(i));
    this.toolMgr.register('extend', (i) => new ExtendTool(i));
    this.toolMgr.register('matchprop', (i) => new MatchPropTool(i));

    // ARRAY — one class, three modes (AutoCAD ARRAYRECT / ARRAYPOLAR / ARRAYPATH).
    // Bare 'array' defaults to rectangular, matching AutoCAD's AR alias.
    this.toolMgr.register('array', (i) => new ArrayTool(i, 'rect'));
    this.toolMgr.register('arrayrect', (i) => new ArrayTool(i, 'rect'));
    this.toolMgr.register('arraypolar', (i) => new ArrayTool(i, 'polar'));
    this.toolMgr.register('arraypath', (i) => new ArrayTool(i, 'path'));

    // Inquiry / measurement — read-only, never touch the undo stack.
    this.toolMgr.register('dist', (i) => new DistTool(i));
    this.toolMgr.register('area', (i) => new AreaTool(i));
    this.toolMgr.register('id', (i) => new IdTool(i));
    this.toolMgr.register('list', (i) => new ListTool(i));
    this.toolMgr.register('draworder', (i) => new DrawOrderTool(i));
    this.toolMgr.register('xline', (i) => new XLineTool(i));
    this.toolMgr.register('xline_hor', (i) => new XLineHorTool(i));
    this.toolMgr.register('xline_ver', (i) => new XLineVerTool(i));
    this.toolMgr.register('spline', (i) => new SplineTool(i));
    this.toolMgr.registerAsync('dimension', async (i) => new (await import('./tools/draw/dimension-tool')).DimensionTool(i));
    this.toolMgr.registerAsync('dimlinear', async (i) => new (await import('./tools/draw/dim-linear-tool')).DimLinearTool(i));
    this.toolMgr.registerAsync('dimaligned', async (i) => new (await import('./tools/draw/dim-aligned-tool')).DimAlignedTool(i));
    this.toolMgr.registerAsync('dimangular', async (i) => new (await import('./tools/draw/dim-angular-tool')).DimAngularTool(i));
    this.toolMgr.registerAsync('dimarc', async (i) => new (await import('./tools/draw/dim-arc-tool')).DimArcTool(i));
    this.toolMgr.registerAsync('dimradius', async (i) => new (await import('./tools/draw/dim-radius-tool')).DimRadiusTool(i));
    this.toolMgr.registerAsync('dimdiameter', async (i) => new (await import('./tools/draw/dim-diameter-tool')).DimDiameterTool(i));
    this.toolMgr.registerAsync('dimordinate', async (i) => new (await import('./tools/draw/dim-ordinate-tool')).DimOrdinateTool(i));
    this.toolMgr.registerAsync('dimjogged', async (i) => new (await import('./tools/draw/dimjogged-tool')).DimJoggedTool(i));
    this.toolMgr.registerAsync('mleader', async (i) => new (await import('./tools/draw/leader-tool')).LeaderTool(i));
    this.toolMgr.registerAsync('qleader', async (i) => new (await import('./tools/draw/leader-tool')).LeaderTool(i, 'qleader'));
    this.toolMgr.registerAsync('leader_add', async (i) => new (await import('./tools/draw/leader-add-tool')).LeaderAddTool(i));
    this.toolMgr.registerAsync('leader_remove', async (i) => new (await import('./tools/draw/leader-remove-tool')).LeaderRemoveTool(i));
    this.toolMgr.registerAsync('leader_align', async (i) => new (await import('./tools/draw/leader-align-tool')).LeaderAlignTool(i));
    this.toolMgr.registerAsync('leader_collect', async (i) => new (await import('./tools/draw/leader-collect-tool')).LeaderCollectTool(i));
    this.toolMgr.registerAsync('hatch', async (i) => new (await import('./tools/draw/hatch-tool')).HatchTool(i));
    this.toolMgr.registerAsync('viewport', async (i) => new (await import('./tools/draw/viewport-tool')).ViewportTool(i));
    this.toolMgr.registerAsync('mview', async (i) => new (await import('./tools/draw/mview-tool')).MViewTool(i));
    this.toolMgr.registerAsync('symbol', async (i) => new (await import('./tools/draw/symbol-tool')).SymbolTool(i));
    this.toolMgr.registerAsync('image', async (i) => new (await import('./tools/draw/image-tool')).ImageTool(i));
    this.toolMgr.registerAsync('circle', async (i) => new (await import('./tools/draw/circle-tool')).CircleTool(i, 'radius'));
    this.toolMgr.registerAsync('circle_dia', async (i) => new (await import('./tools/draw/circle-tool')).CircleTool(i, 'diameter'));
    this.toolMgr.registerAsync('circle_2p', async (i) => new (await import('./tools/draw/circle-tool')).CircleTool(i, '2p'));
    this.toolMgr.registerAsync('circle_3p', async (i) => new (await import('./tools/draw/circle-tool')).CircleTool(i, '3p'));
    this.toolMgr.registerAsync('circle_ttr', async (i) => new (await import('./tools/draw/circle-tool')).CircleTool(i, 'ttr'));
    this.toolMgr.registerAsync('circle_ttt', async (i) => new (await import('./tools/draw/circle-tool')).CircleTool(i, 'ttt'));
    this.toolMgr.registerAsync('table', async (i) => new (await import('./tools/draw/table-tool')).TableTool(i));
    this.toolMgr.registerAsync('create_block', async (i) => new (await import('./tools/block/create-block-tool')).CreateBlockTool(i));
    this.toolMgr.registerAsync('insert_block', async (i) => new (await import('./tools/block/insert-block-tool')).InsertBlockTool(i));
    this.toolMgr.registerAsync('explode', async (i) => new (await import('./tools/block/explode-tool')).ExplodeTool(i));
    this.toolMgr.register('erase', (i) => new DeleteTool(i));
    this.toolMgr.registerAsync('insert_library_item', async (i) => new (await import('./tools/block/insert-library-item.tool')).InsertLibraryItemTool(i));
    this.toolMgr.register('paste', (i) => new PasteTool(i));
    this.toolMgr.register('copy', (i) => new CopyTool(i));
    this.toolMgr.registerAsync('plot_window', async (i) => new (await import('./tools/plot-window-tool')).PlotWindowTool(i));
    this.toolMgr.register('cursorsize', (i) => new CursorSizeTool(i));
    this.toolMgr.register('pickboxsize', (i) => new PickboxTool(i));
    this.toolMgr.setTool('select');

    // Register system UI actions (they do not activate as Canvas Tools)
    this.cmdRegistry.registerAction('layers', () => this.panelService.open('layers'));
    this.cmdRegistry.registerAction('properties', () => this.panelService.open('properties'));
    this.cmdRegistry.registerAction('library', () => this.panelService.open('library'));
    this.cmdRegistry.registerAction('settings', () => this.panelService.open('settings'));
    this.cmdRegistry.registerAction('blocks', () => this.panelService.open('blocks'));
    this.cmdRegistry.registerAction('viewports', () => this.panelService.open('viewports'));
    this.cmdRegistry.registerAction('dimstyle', () => this.dimStyleDialog.open());
    this.cmdRegistry.registerAction('find', () => this.findDialog.open());

    // ── File management (browser-storage persistence) ────────────────────
    // SAVE overwrites in place once a drawing has been saved; the first save
    // has no name yet, so it falls through to the Save As dialog.
    this.cmdRegistry.registerAction('save', () => void this.saveDrawing());
    this.cmdRegistry.registerAction('saveas', () => this.drawingBrowser.open('save'));
    this.cmdRegistry.registerAction('open', () => this.drawingBrowser.open('open'));
    this.cmdRegistry.registerAction('drawings', () => this.drawingBrowser.open('open'));
    this.cmdRegistry.registerAction('newdrawing', () => this.docManager.createDocument());

    this.initPersistence();
    this.cmdRegistry.registerAction('bedit', () => {
      const sel = this.doc.getSelectedEntities();
      const ins = sel.find((e: any) => e.type === 'INSERT');
      if (ins) this.openBlockEditor(ins);
      else alert('Select a block reference first.');
    });
    this.cmdRegistry.registerAction('bclose', () => {
      if (!this.blockEditor.isActive()) return;
      const save = confirm('Save changes to block "' + this.blockEditor.editingBlockName() + '"?');
      if (save) this.blockEditor.save();
      else this.blockEditor.discard();
    });

    // â”€â”€ Print / Plot / Export / Publish commands (command bar + shortcuts) â”€â”€
    this.cmdRegistry.registerAction('plot', () => this.plotDialog.open({ format: 'pdf' }));
    this.cmdRegistry.registerAction('export', () => this.plotDialog.open({ format: 'pdf' }));
    this.cmdRegistry.registerAction('publish', () => {
      this.notify.info(
        'PUBLISH â€” Batch Sheet-Set publishing coming in a future release. Use PLOT to export individual sheets.',
        7000,
      );
    });
    this.cmdRegistry.registerAction('exportpdf', () => this.plotDialog.open({ format: 'pdf' }));
    this.cmdRegistry.registerAction('exportpng', () => this.plotDialog.open({ format: 'png' }));
    this.cmdRegistry.registerAction('exportjpg', () => this.plotDialog.open({ format: 'jpg' }));
    this.cmdRegistry.registerAction('exportsvg', () => this.plotDialog.open({ format: 'svg' }));
    this.cmdRegistry.registerAction('exportdxf', () => this.plotDialog.open({ format: 'dxf' }));


    // â”€â”€ Layout / Paper Space commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.cmdRegistry.registerAction('layout', () => {
      this.layoutManagerDialog.open();
    });
    this.cmdRegistry.registerAction('mview', () => {
      if (this.layoutMgr.isModelSpace()) {
        this.notify.info('MVIEW â€” Switch to a Layout tab first to create viewports.', 4000);
        return;
      }
      this.toolMgr.setTool('mview');
    });
    this.cmdRegistry.registerAction('mv', () => this.cmdRegistry.execute('mview'));
    this.cmdRegistry.registerAction('pagesetup', () => {
      if (this.layoutMgr.isModelSpace()) {
        this.notify.info('PAGESETUP â€” Switch to a Layout tab to configure its page setup.', 4000);
        return;
      }
      this.pageSetupDialog.open(this.layoutMgr.activeLayoutId());
    });
    this.cmdRegistry.registerAction('mspace', () => {
      if (this.layoutMgr.isModelSpace()) return;
      const layout = this.layoutMgr.activeLayout();
      const firstVp = layout.viewports[0];
      if (firstVp) this.layoutMgr.enterMspace(firstVp.id);
      else this.notify.info('MSPACE â€” Create a viewport (MVIEW) first.', 3000);
    });
    this.cmdRegistry.registerAction('ms', () => this.cmdRegistry.execute('mspace'));
    this.cmdRegistry.registerAction('pspace', () => {
      if (this.layoutMgr.workspaceMode() !== 'MSPACE') return;
      this.layoutMgr.exitMspace();
    });
    this.cmdRegistry.registerAction('ps', () => this.cmdRegistry.execute('pspace'));

    // â”€â”€ Clipboard commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.cmdRegistry.registerAction('copy', () => this.toolMgr.setTool('copy'));
    this.cmdRegistry.registerAction('copybase', () => {
      const pt = prompt('Specify base point (x,y):');
      if (!pt) return;
      const [xs, ys] = pt.split(',').map((s) => parseFloat(s.trim()));
      if (isNaN(xs) || isNaN(ys)) return;
      CopyTool.basePointFirst = true;
      CopyTool.pendingBasePoint = { x: xs, y: ys };
      this.toolMgr.setTool('copy');
    });
    this.cmdRegistry.registerAction('cutclip', () => this.cutClipboard());
    this.cmdRegistry.registerAction('pasteclip', () => this.pasteFromClipboard());
    this.cmdRegistry.registerAction('pasteorig', () => this.pasteOriginal());
    this.cmdRegistry.registerAction('pasteblock', () => this.pasteAsBlock());
  }

  /**
   * Startup sequence, in priority order: the routed cloud drawing wins, then
   * an `initialDxf` handed in by a host component, then a drawing parked in
   * `DrawingTransferService`.
   */
  async ngAfterViewInit(): Promise<void> {

    const routedId = this.id();
    if (routedId) {
      this.handledId = routedId;
      this.isLoading.set(true);
      try {
        await this.persist.openRemote(routedId);
      } finally {
        this.isLoading.set(false);
      }
    }

    const initialDxf = this.initialDxf();
    if (initialDxf) {
      this.doc.clear();
      this.cmds.clear();
      this.vps.clear();
      try {
        this.isLoading.set(true);
        await this.dxfImport.loadDxfDataAsync(initialDxf, 'gad.dxf');
        this.vm.zoomExtentsWhenReady(this.doc);
      } catch (err) {
        console.error('Failed to load initial DXF:', err);
      } finally {
        this.isLoading.set(false);
      }
    }

    // Check for a drawing handed over by a host application (see DrawingTransferService)
    const transfer = this.drawingTransfer.consume();
    if (transfer) {

      try {
        this.isLoading.set(true);
        // Load the DXF/JSON payload directly from the workspace
        await this.dxfImport.loadDxfDataAsync(transfer.dxf, transfer.filename);

        this.vm.zoomExtentsWhenReady(this.doc);

        // Retire the untouched `Drawing1` scaffolding tab.
        this.docManager.closeBlankDocuments(this.doc.activeFileId);
      } catch (err) {
        console.error(`Failed to load transfer DXF ${transfer.filename}:`, err);
        this.notify.error('Failed to load drawing — the file may be in an unsupported format.', 5000);
      } finally {
        // Consumed for good: `consume()` never cleared the hand-off, so the
        // same drawing was re-opened on every subsequent visit to /editor.
        this.drawingTransfer.clear();
        this.isLoading.set(false);
      }
    }

    this.doc.bump();
    this.viewReady = true;
  }

  undo(): void { this.cmds.undo(); }
  redo(): void { this.cmds.redo(); }

  onUploadClick(input: HTMLInputElement): void {
    input.click();
  }

  downloadAsJson(): void {
    const file = this.docManager.activeDocument?.file;
    if (!file) { this.notify.warning('No drawing open.', 3000); return; }

    const payload = EntityJsonSerializer.serializeFile(file);
    if (!payload.entities.length) { this.notify.warning('No entities to export.', 3000); return; }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (file.name || 'drawing').replace(/\.(dxf|json)$/i, '') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.notify.success(`Exported ${payload.entities.length} entities → JSON`, 2500);
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    this.fileImport.handleFiles(files);

    input.value = '';
  }

  /**
   * Open the AutoCAD-style Plot dialog. PDF / PNG / DXF are all driven from
   * the same dialog so users get consistent paper / scale / area / DPI
   * controls regardless of format. Legacy per-format menu items are gone.
   */
  onPlotClick(): void {
    this.plotDialog.open();
  }

  setActivePanel(panel: any): void {
    if (panel) this.panelService.open(panel);
    else this.panelService.close();
  }

  /**
   * Drag-over handler on the canvas main element.
   * Required to allow drops (must call preventDefault to signal "droppable").
   */
  onDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  /**
   * Canvas specific drag handlers for visual feedback.
   */
  onCanvasDragEnter(e: DragEvent): void {
    e.preventDefault();
    if (this._hasFiles(e)) this.isDraggingOverCanvas.set(true);
  }

  onCanvasDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.isDraggingOverCanvas.set(false);
  }

  /**
   * Drop handler â€” fired when a Library card or file is dragged and dropped onto the canvas.
   */
  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDraggingOverCanvas.set(false);

    // If there are files dropped, pass to FileImportService and ignore Library items
    if (e.dataTransfer?.files?.length) {
      this._handleWindowDrop(e);
      return;
    }

    const itemId = e.dataTransfer?.getData('text/plain');
    if (!itemId) return;

    const item = this.library.items().find(i => i.id === itemId);
    if (!item) return;

    // Convert drop screen position to world coordinates.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const world = this.vm.s2w(px, py);
    this.library.insertItem(item, world);
  }

  /**
   * Right-click on canvas â†’ show context menu with library-aware actions.
   */
  onCanvasContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.toolMgr.activeToolName() === 'paste') {
      const tool = this.toolMgr.activeTool as PasteTool | null;
      tool?.confirmAtCursor?.();
      this.contextMenu.hide();
      return;
    }
    const selected = this.doc.getSelectedEntities();
    if (!selected.length) {
      // Show paste option on empty canvas if clipboard has content.
      if (this.cadClipboard.payload) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        this.contextMenu.show(e.clientX - rect.left, e.clientY - rect.top, [
          {
            label: 'Paste',
            icon: '📋',
            action: () => { this.contextMenu.hide(); this.pasteFromClipboard(); },
          },
          {
            label: 'Paste Original',
            icon: '📌',
            action: () => { this.contextMenu.hide(); this.pasteOriginal(); },
          },
        ], rect.width, rect.height);
      } else {
        this.contextMenu.hide();
      }
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const inserts = selected.filter((ent: any) => ent.type === 'INSERT');
    const hasInserts = inserts.length > 0;
    const isSingleInsert = inserts.length === 1;

    const textBearing = selected.filter((ent: any) =>
      ent.type === 'TEXT' || ent.type === 'LEADER' || ent.type === 'MLEADER' || ent.type === 'DIMENSION'
    );
    const hasTextBearing = textBearing.length > 0;

    const items: any[] = [];

    // Text-specific actions
    if (hasTextBearing) {
      items.push({
        label: 'Rotate Text',
        action: () => {
          this.contextMenu.hide();
          const val = prompt('Enter rotation angle in degrees:');
          if (val !== null && val !== '') {
            const deg = parseFloat(val);
            if (!Number.isNaN(deg)) {
              const oldValues = textBearing.map((ent: any) => ({
                id: ent.id,
                value: ent.type === 'TEXT' ? ent.rotationDeg : ent.textRotationOverrideDeg
              }));
              this.cmds.push(new ModifyPropertiesCmd(
                textBearing,
                textBearing[0].type === 'TEXT' ? 'rotationDeg' : 'textRotationOverrideDeg',
                deg,
                oldValues,
                { markDirty: () => this.vm.markContentDirty() }
              ));
            }
          }
        }
      });
      items.push({
        label: 'Reset Rotation',
        action: () => {
          this.contextMenu.hide();
          const cmdList: any[] = [];
          for (const ent of textBearing) {
            const key = ent.type === 'TEXT' ? 'rotationDeg' : 'textRotationOverrideDeg';
            const oldVal = (ent as any)[key];
            const newVal = ent.type === 'TEXT' ? 0 : null;
            cmdList.push(new ModifyPropertiesCmd(
              [ent],
              key,
              newVal,
              [{ id: ent.id, value: oldVal }],
              { markDirty: () => this.vm.markContentDirty() }
            ));
          }
          this.cmds.push(new CompoundCmd(cmdList));
        }
      });
      items.push({
        label: 'Match Rotation',
        action: () => {
          this.contextMenu.hide();
          const firstEnt = textBearing[0] as any;
          const targetRot = firstEnt.type === 'TEXT' ? firstEnt['rotationDeg'] : (firstEnt['textRotationOverrideDeg'] ?? 0);
          const cmdList: any[] = [];
          for (const ent of textBearing) {
            const key = ent.type === 'TEXT' ? 'rotationDeg' : 'textRotationOverrideDeg';
            const oldVal = (ent as any)[key];
            cmdList.push(new ModifyPropertiesCmd(
              [ent],
              key,
              targetRot,
              [{ id: ent.id, value: oldVal }],
              { markDirty: () => this.vm.markContentDirty() }
            ));
          }
          this.cmds.push(new CompoundCmd(cmdList));
        }
      });
      items.push({ label: '', separator: true, action: () => { } });
    }

    // Block-specific actions
    if (isSingleInsert) {
      items.push({
        label: 'Edit Block',
        action: () => {
          this.contextMenu.hide();
          this.openBlockEditor(inserts[0] as any);
        },
      });
      items.push({
        label: 'Select All References',
        action: () => {
          this.contextMenu.hide();
          this.selectAllBlockReferences((inserts[0] as any).blockName);
        },
      });
    }
    if (hasInserts) {
      items.push({
        label: 'Explode',
        action: () => {
          this.contextMenu.hide();
          for (const ins of inserts) {
            const file = this.doc.getFileOfEntity(ins) ?? this.doc.activeFile;
            this.cmds.push(new ExplodeInsertCmd(ins as any, file, { markDirty: () => this.vm.markContentDirty(), refreshBlocks: () => this.doc.bump() }));
          }
        },
      });
      items.push({ label: '', separator: true, action: () => { } });
    }

    items.push(
      {
        label: 'Add to Library',
        icon: '⊕',
        action: () => {
          this.saveToLibraryModal.open(selected);
          this.contextMenu.hide();
        },
      },
      { label: 'â”€â”€ Draw Order â”€â”€', separator: true, action: () => { } },
      { label: 'Bring To Front', icon: '⬆', action: () => { this.contextMenu.hide(); this.drawOrder.bringToFront(selected, this.doc.activeFile); } },
      { label: 'Send To Back', icon: '⬇', action: () => { this.contextMenu.hide(); this.drawOrder.sendToBack(selected, this.doc.activeFile); } },
      { label: 'Bring Forward', icon: '↑', action: () => { this.contextMenu.hide(); this.drawOrder.bringForward(selected, this.doc.activeFile); } },
      { label: 'Send Backward', icon: '↓', action: () => { this.contextMenu.hide(); this.drawOrder.sendBackward(selected, this.doc.activeFile); } },
      {
        label: 'Bring Above Object...', icon: '↗', action: () => {
          this.contextMenu.hide();
          this.toolMgr.setTool('draworder');
          (this.toolMgr.activeTool as DrawOrderTool).activateWithMode(selected, DrawOrderMode.WAITING_REFERENCE_ABOVE);
        }
      },
      {
        label: 'Send Under Object...', icon: '↘', action: () => {
          this.contextMenu.hide();
          this.toolMgr.setTool('draworder');
          (this.toolMgr.activeTool as DrawOrderTool).activateWithMode(selected, DrawOrderMode.WAITING_REFERENCE_UNDER);
        }
      },
      { label: '', separator: true, action: () => { } },
      {
        label: 'Copy',
        icon: '⎘',
        action: () => {
          this.contextMenu.hide();
          this.copyToClipboard();
        },
      },
      {
        label: 'Cut',
        icon: '✂',
        action: () => {
          this.contextMenu.hide();
          this.cutClipboard();
        },
      },
      ...(this.cadClipboard.payload ? [{
        label: 'Paste',
        icon: '📋',
        action: () => {
          this.contextMenu.hide();
          this.pasteFromClipboard();
        },
      }] : []),
      {
        label: 'Delete',
        icon: '✕',
        danger: true,
        action: () => {
          this.contextMenu.hide();
          this.deleteSelected();
        },
      },
    );
    this.contextMenu.show(x, y, items, rect.width, rect.height);
  }

  /** Double-click on canvas â†’ open the properties panel pinned to the activated entity. */
  onEntityActivated(ent?: Entity, sx?: number, sy?: number): void {
    if (ent && ent.type.startsWith('DIM')) {
      this.dimTextEditor.openForEdit(ent as any, sx!, sy!);
    } else if (ent && (ent.type === 'TEXT' || ent.type === 'MTEXT' || ent.type === 'LEADER')) {
      this.textEditor.openForEdit(ent as any, sx, sy);
    } else if (ent && ent.type === 'TABLE') {
      this.tableEditor.openForEdit(ent as any);
    } else if (ent && ent.type === 'INSERT') {
      this.openBlockEditor(ent as any);
    } else {
      this.panelService.open('properties');
    }
  }

  openBlockEditor(insert: any): void {
    const blockName = insert?.blockName;
    if (!blockName) return;
    this.blockEditor.open(blockName);
  }

  selectAllBlockReferences(blockName: string): void {
    const file = this.doc.activeFile;
    for (const e of file.entities) {
      e.selected = (e as any).type === 'INSERT' && (e as any).blockName === blockName;
    }
    this.vm.markContentDirty();
  }


  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.contextMenu.state().visible) {
      this.contextMenu.hide();
    }
  }

  // --- Window Drag & Drop file import overlay ---
  private _hasFiles(e: DragEvent): boolean {
    if (!e.dataTransfer) return false;
    // dataTransfer.types is an array or DOMStringList checking for 'Files'
    return Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
  }

  @HostListener('window:dragenter', ['$event'])
  onWindowDragEnter(e: DragEvent): void {
    if (!this._hasFiles(e)) return;
    e.preventDefault();
    this.dragEnterCount++;
    this.isDraggingFiles.set(true);
  }

  @HostListener('window:dragover', ['$event'])
  onWindowDragOver(e: DragEvent): void {
    if (!this._hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  @HostListener('window:dragleave', ['$event'])
  onWindowDragLeave(e: DragEvent): void {
    if (!this._hasFiles(e)) return;
    e.preventDefault();
    this.dragEnterCount--;
    if (this.dragEnterCount <= 0) {
      this.dragEnterCount = 0;
      this.isDraggingFiles.set(false);
      this.isDraggingOverCanvas.set(false);
    }
  }

  @HostListener('window:drop', ['$event'])
  onWindowDrop(e: DragEvent): void {
    this._handleWindowDrop(e);
  }

  private _handleWindowDrop(e: DragEvent): void {
    this.dragEnterCount = 0;
    this.isDraggingFiles.set(false);
    this.isDraggingOverCanvas.set(false);

    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      e.stopPropagation(); // Prevent the event from bubbling up and triggering twice
      const files = Array.from(e.dataTransfer.files);
      this.fileImport.handleFiles(files);
    }
  }

  private isEditingText(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement;
    if (!target) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  /**
   * Human-readable age of the last autosave, for the header indicator.
   *
   * Reads the `lastSavedAt` signal AND `nowTick`, so the label re-renders as
   * time passes instead of freezing at "just now" - this app is zoneless, so
   * nothing else would ever mark it dirty.
   */
  protected savedAgo(): string {
    const ts = this.autosave.lastSavedAt();
    this.nowTick();
    if (!ts) return '';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  }

  /**
   * SAVE / Ctrl+S. Pushes the active drawing to the user's account, overwriting
   * the bound cloud record; a drawing that has never been saved has no record
   * to overwrite, so `saveActive()` opens Save As for it.
   */
  protected async saveDrawing(): Promise<void> {
    await this.persist.saveActive();
  }

  /**
   * Header cloud indicator. Reads `nowTick` as well as the state signals so the
   * relative timestamp keeps ticking — nothing else marks this zoneless
   * component dirty as time passes.
   */
  protected cloudLabel(): string {
    this.nowTick();
    switch (this.persist.cloudState()) {
      case 'saving':
        return 'Saving…';
      case 'saved': {
        const ts = this.persist.lastCloudSaveAt();
        return ts ? `Saved to cloud ${relativeTime(ts)}` : 'Saved to cloud';
      }
      case 'dirty':
        return 'Unsaved changes';
      case 'offline':
        return 'Saved locally — offline';
      case 'conflict':
        return 'Version conflict';
      default:
        return '';
    }
  }

  /**
   * Native "leave site?" prompt. The router's `unsavedChangesGuard` covers
   * in-app navigation; this covers reloads and closing the tab, which the
   * router never sees. Browsers ignore custom text, so only `returnValue` is set.
   */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (!this.persist.anyDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  }

  ngOnDestroy(): void {
    // Autosave attaches window-level visibilitychange / beforeunload listeners
    // and owns an interval; both must be released with the component.
    this.autosave.stop();
    if (this.savedAgoTimer !== null) {
      clearInterval(this.savedAgoTimer);
      this.savedAgoTimer = null;
    }
  }

  /**
   * Start autosave and surface anything left over from a previous session.
   *
   * A recovery record only survives when a tab was dirty and never explicitly
   * saved — i.e. the browser closed or crashed mid-edit — so its presence is
   * a strong signal that the user lost work and wants it back.
   */
  private initPersistence(): void {
    // Zoneless: nothing re-renders on its own, so drive the relative-time
    // labels from a signal we bump ourselves. Outside the IndexedDB guard —
    // the cloud state has to keep ticking even where local storage is blocked.
    this.savedAgoTimer = setInterval(() => this.nowTick.update((v) => v + 1), 60_000);

    if (!this.persist.isAvailable()) {
      console.warn('IndexedDB unavailable — crash recovery and offline caching are disabled.');
      return;
    }

    this.autosave.start();

    void this.autosave.hasRecovery().then((has) => {
      if (!has) return;
      this.notify.warning('Unsaved work from a previous session was recovered — open My Drawings to restore it.', 9000);
    });
  }


  // Single merged keydown handler â€” Angular Ivy only fires ONE @HostListener per
  // event name per component class, so all keydown logic must live in one method.
  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    // â”€â”€ Ctrl/Cmd global shortcuts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Undo/redo/select-all/copy/paste are always active regardless of focus
    // (e.g. command-line input), but NOT while the inline text/table editor
    // is open (those manage their own undo history).
    if (this.textEditor.state() === null && this.tableEditor.state() === null) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.cmds.redo();
        else this.cmds.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.cmds.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.selectAll();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        this.copyToClipboard();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        this.cutClipboard();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.pasteOriginal();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.pasteAsBlock();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.pasteFromClipboard();
        return;
      }

      // â”€â”€ Plot / Export shortcuts (AutoCAD parity) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      //   Ctrl+P â†’ Plot dialog Â· Ctrl+Shift+P â†’ Quick Plot (last settings)
      //   Ctrl+E â†’ Export dialog
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (this.plotDialog.isOpen()) return;
        if (e.shiftKey) {
          // Quick Plot: re-run last plot; fall back to the dialog if none yet.
          if (!this.exportMgr.quickPlot()) this.plotDialog.open({ format: 'pdf' });
        } else {
          this.plotDialog.open({ format: 'pdf' });
        }
        return;
      }
      // ── File management ──────────────────────────────────────────────────
      // Ctrl+S       → Save (overwrite, or Save As on a never-saved drawing)
      // Ctrl+Shift+S → Save As
      // Ctrl+O       → Open / My Drawings
      // preventDefault matters here: Ctrl+S would otherwise trigger the
      // browser's own "Save page as" dialog and Ctrl+O its file picker.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (this.drawingBrowser.isOpen()) return;
        if (e.shiftKey) this.drawingBrowser.open('save');
        else void this.saveDrawing();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        if (!this.drawingBrowser.isOpen()) this.drawingBrowser.open('open');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (!this.plotDialog.isOpen()) this.plotDialog.open({ format: 'pdf' });
        return;
      }

      // â”€â”€ Document Management shortcuts (AutoCAD parity) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Ctrl+Tab â†’ Next Drawing
      // Ctrl+Shift+Tab â†’ Previous Drawing
      // Ctrl+W â†’ Close Active Drawing
      // Ctrl+Shift+T â†’ Reopen Last Closed
      if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          this.docManager.prevDocument();
        } else {
          this.docManager.nextDocument();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (this.docManager.activeDocument) {
          // Async now: answering "Save changes?" performs a real cloud save and
          // the close waits for it. Nothing here needs the outcome.
          void this.docManager.closeDocument(this.docManager.activeDocument.tabId);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        this.docManager.reopenLastClosedDocument();
        return;
      }
    }

    // AutoCAD-style temporary ortho override: Shift held inverts ortho state.
    // Fires regardless of focus so it works from the canvas or DI field.
    // Suppressed if the active tool is 'trim' or 'extend', which use Shift to swap tools instead.
    if (e.key === 'Shift' && !this.snap.orthoOverride()) {
      const activeName = this.toolMgr.activeTool?.name;
      if (activeName !== 'trim' && activeName !== 'extend') {
        this.snap.orthoOverride.set(true);
      }
    }

    // â”€â”€ Keys below only apply when no text/table editor is active and focus
    //    is NOT inside a plain text input/textarea/select.
    if (this.isEditingText(e) || this.textEditor.state() !== null || this.tableEditor.state() !== null) return;

    if (e.key === 'Delete' || (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey)) {
      // Backspace inside Polyline/Leader removes the last vertex; only handle
      // here when the active tool isn't mid-operation and Delete is intentional.
      if (this.toolMgr.activeTool?.getAnchor?.()) return;
      if (this.deleteSelected()) {
        e.preventDefault();
        return;
      }
    }
    // AutoCAD-style Enter / Space at idle â†’ repeat the last non-{select,pan} tool.
    if (e.key === 'Enter' || e.key === ' ') {
      if (this.dynInput.visible()) return;
      if (this.toolMgr.activeTool?.getAnchor?.()) return;
      if (this.toolMgr.activeToolName() === 'create_block' && this.toolMgr.activeTool?.getPhase?.() === 'select') return;
      if (this.toolMgr.toggleLastOrSelect()) {
        // stopImmediatePropagation prevents the canvas component's own
        // window:keydown handler from running on the same event â€” that
        // handler forwards the key to activeTool.onKeyDown, which would
        // hand Enter/Space straight to the tool we JUST activated.
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
    }
    if (e.key === 'Escape') {
      if (this.blockEditor.isActive()) {
        const save = confirm('Save changes to block "' + this.blockEditor.editingBlockName() + '"?');
        if (save) this.blockEditor.save();
        else this.blockEditor.discard();
        return;
      }
      this.toolMgr.setTool('select');
      this.snap.clear();
      return;
    }
    if (e.key === 'F3') { e.preventDefault(); this.snap.toggleOsnap(); return; }
    if (e.key === 'F7') { e.preventDefault(); this.snap.toggleGrid(); return; }
    if (e.key === 'F8') { e.preventDefault(); this.snap.toggleOrtho(); return; }
    if (e.key === 'F10') { e.preventDefault(); this.snap.togglePolar(); return; }
    if (e.key === 'F11') { e.preventDefault(); this.snap.toggleOtrack(); return; }
    if (e.key === 'F12') { e.preventDefault(); this.dynInput.toggleDyn(); return; }

    // Skip modifier combos and non-printable keys.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1 || e.key === ' ') return;

    // Route letter keys to active command options first (e.g. U=Undo, C=Close, T=Trim).
    if (/^[a-zA-Z]$/.test(e.key) && this.cmdPrompt.invokeOptionByKey(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    // While the editable dynamic-input overlay is visible, route typing to its primary field.
    if (this.dynInput.visible()) {
      const ok = this.dynInput.focusPrimaryField(e.key);
      if (ok) {
        e.preventDefault();
        return;
      }
    }

    // When DYN is enabled and no tool is active, route to the near-cursor command
    // search so the user can start commands without moving to the bottom bar.
    const activeToolName = this.toolMgr.activeToolName();
    const toolIsIdle = !activeToolName || activeToolName === 'select' || activeToolName === 'pan';
    if (this.dynInput.dynEnabled() && toolIsIdle) {
      this.dynInput.activateDynSearch(e.key);
      e.preventDefault();
      return;
    }

    // Otherwise, route typing to the command-bar search.
    if (this.commandLine) {
      e.preventDefault();
      this.commandLine.focusWithChar(e.key);
    }
  }

  /* -------------------------------------------------------------------- */
  /*  Centralized shortcut actions                                          */
  /* -------------------------------------------------------------------- */

  /** Ctrl+A â€” select every visible, unlocked entity across visible files. */
  private selectAll(): void {
    for (const file of this.doc.files) {
      if (!file.visible || file.locked) continue;
      for (const ent of file.entities) {
        if (!ent.visible) continue;
        const lay = file.layers.get(ent.layer);
        if (lay && (lay.frozen || !lay.visible || lay.locked)) continue;
        ent.selected = true;
      }
    }
    this.vm.markContentDirty();
  }

  /** Ctrl+C â€” copy selected entities to the CAD clipboard. */
  private copyToClipboard(): void {
    const sel = this.doc.getSelectedEntities();
    if (!sel.length) return;
    this.cadClipboard.copy(sel);
    this.notify.info(`${sel.length} object${sel.length === 1 ? '' : 's'} copied to clipboard`, 1800);
  }

  /** Ctrl+X â€” cut (copy + delete) selected entities. */
  private cutClipboard(): void {
    const sel = this.doc.getSelectedEntities();
    if (!sel.length) return;
    this.cadClipboard.cut(sel);
    this.notify.info(`${sel.length} object${sel.length === 1 ? '' : 's'} cut to clipboard`, 1800);
  }

  /**
   * Ctrl+V / PASTECLIP â€” activate the paste placement tool. Tries in order:
   *   1. In-memory CadClipboardService payload
   *   2. LocalStorage (cross-tab)
   *   3. System clipboard JSON (cross-instance)
   */
  private pasteFromClipboard(): void {
    // ALWAYS try reading system clipboard first (it now handles CAD JSON AND plain text)
    this.cadClipboard.readFromSystemClipboard().then((ok) => {
      if (ok) {
        PasteTool.mode = 'pasteclip';
        this.toolMgr.setTool('paste');
      } else {
        // Fall back to in-memory payload or localStorage
        if (this.cadClipboard.payload || this.cadClipboard.loadFromLocalStorage()) {
          PasteTool.mode = 'pasteclip';
          this.toolMgr.setTool('paste');
        }
      }
    });
  }

  /**
   * Ctrl+Shift+V / PASTEORIG â€” paste at original coordinates (no tool, instant).
   */
  private pasteOriginal(): void {
    this.cadClipboard.readFromSystemClipboard().then((ok) => {
      if (!ok) {
        if (!this.cadClipboard.payload) this.cadClipboard.loadFromLocalStorage();
      }
      if (!this.cadClipboard.payload) return;
      const placed = this.cadClipboard.pasteOriginal();
      if (placed.length) {
        this.notify.info(`Pasted ${placed.length} object${placed.length === 1 ? '' : 's'} at original coordinates`, 2000);
      }
    });
  }

  /**
   * Ctrl+Alt+V / PASTEBLOCK â€” activate paste tool in PASTEBLOCK mode.
   */
  private pasteAsBlock(): void {
    this.cadClipboard.readFromSystemClipboard().then((ok) => {
      if (!ok) {
        if (!this.cadClipboard.payload) this.cadClipboard.loadFromLocalStorage();
      }
      if (!this.cadClipboard.payload) return;
      PasteTool.mode = 'pasteblock';
      this.toolMgr.setTool('paste');
    });
  }

  /** Delete â€” remove the current selection through the undoable command stack. */
  private deleteSelected(): boolean {
    const sel = this.doc.getSelectedEntities();
    if (!sel.length) return false;
    this.cmds.push(new DeleteMultipleCmd(sel, (e: any) => this.doc.getFileOfEntity(e), {
      markDirty: () => this.vm.markContentDirty(),
      refreshBlocks: () => this.doc.bump(),
    }));
    this.snap.clear();
    return true;
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Shift') this.snap.orthoOverride.set(false);
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    // Avoid a sticky Shift override if focus leaves the window with the key held.
    if (this.snap.orthoOverride()) this.snap.orthoOverride.set(false);

  }
}
