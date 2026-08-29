import { Injectable, inject } from '@angular/core';
import { DocumentService } from '../../../core/services/document.service';
import { ViewModelService } from '../../../core/services/view-model.service';
import { SpatialIndexService } from '../../../core/services/spatial-index.service';
import { LibraryService } from '../../../core/services/library.service';
import { ViewDetectionService } from './view-detection.service';
import type { AiTool, AiToolContext } from '../models/ai-tool.model';
import type { TargetSelector } from '../models/ai-action.model';
import { resolveTarget } from './target-selector';

// ── Tool imports (registered at construction time) ────────────────────────────
import { makeQuerySelectEntitiesTool } from '../tools/query-select-entities.tool';
import { makeEntitiesChangeColorTool } from '../tools/entities-change-color.tool';
import { makeEntitiesChangeLayerTool } from '../tools/entities-change-layer.tool';
import { makeEntitiesChangeLineweightTool } from '../tools/entities-change-lineweight.tool';
import { makeEntitiesDeleteTool } from '../tools/entities-delete.tool';
import { makeLayerSetVisibleTool } from '../tools/layer-set-visible.tool';
import { makeLayerLockTool } from '../tools/layer-lock.tool';
import { makeLayerIsolateTool } from '../tools/layer-isolate.tool';
import { makeEntitiesMoveTool } from '../tools/entities-move.tool';
import { makeViewsMoveTool } from '../tools/views-move.tool';
import {
  makeViewsAlignTool, makeViewsDistributeTool, makeViewsSpaceTool,
} from '../tools/views-layout.tools';
import { makeLibraryInsertTool } from '../tools/library-insert.tool';
import { makeEntitiesReplaceTool } from '../tools/entities-replace.tool';
import {
  makeViewsAutoLayoutTool, makeViewsCenterTool, makeLayoutValidateTool,
} from '../tools/views-intelligent-layout.tools';
import { makeGenerateDrawingTool } from '../tools/generate-drawing.tool';
import { makeViewZoomToTool, makeViewIsolateTool } from '../tools/view-navigation.tools';
import { makeLayerRenameTool } from '../tools/layer-rename.tool';
import { makeAddDimensionTool } from '../tools/annotation-add-dimension.tool';
import { LibrarySearchService } from './library-search.service';
import { GenerationPlannerService } from './generation-planner.service';
import { AiLayoutReportService } from './ai-layout-report.service';

@Injectable({ providedIn: 'root' })
export class AiToolRegistryService {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private spatial = inject(SpatialIndexService);
  private library = inject(LibraryService);
  private viewDetection = inject(ViewDetectionService);
  private librarySearch = inject(LibrarySearchService);
  private planner = inject(GenerationPlannerService);
  private layoutReportSvc = inject(AiLayoutReportService);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _tools = new Map<string, AiTool<any>>();

  constructor() {
    // Register all tools once at startup.
    const allTools = [
      // Phase 1
      makeQuerySelectEntitiesTool(),
      makeEntitiesChangeColorTool(),
      makeEntitiesChangeLayerTool(),
      makeEntitiesChangeLineweightTool(),
      makeEntitiesDeleteTool(),
      makeLayerSetVisibleTool(),
      makeLayerLockTool(),
      makeLayerIsolateTool(),
      // Phase 2
      makeEntitiesMoveTool(),
      makeViewsMoveTool(),
      makeViewsAlignTool(),
      makeViewsDistributeTool(),
      makeViewsSpaceTool(),
      // Phase 3
      makeLibraryInsertTool(this.librarySearch),
      makeEntitiesReplaceTool(this.librarySearch),
      // Phase 4
      makeViewsAutoLayoutTool(),
      makeViewsCenterTool(),
      makeLayoutValidateTool(),
      // Phase 5
      makeGenerateDrawingTool(this.planner),
      // Feature completions
      makeViewZoomToTool(),
      makeViewIsolateTool(),
      makeLayerRenameTool(),
      makeAddDimensionTool(),
    ];
    for (const tool of allTools) {
      this._tools.set(tool.id, tool);
    }
  }

  get(id: string): AiTool<any> | undefined {
    return this._tools.get(id);
  }

  getAll(): AiTool<any>[] {
    return [...this._tools.values()];
  }

  /**
   * Build the shared tool context. Called by ActionRouterService before
   * every validate/compile call.
   */
  buildContext(): AiToolContext {
    const doc = this.doc;
    const vm = this.vm;
    const spatial = this.spatial;
    const library = this.library;
    const viewDetection = this.viewDetection;

    return {
      doc,
      vm,
      spatial,
      library,
      viewDetection,
      layoutReport: this.layoutReportSvc,
      hooks: {
        markDirty: () => vm.markDirty(),
        refreshProperties: () => {},
      },
      resolveTarget: (sel: TargetSelector) => resolveTarget(sel, doc),
    };
  }

  /**
   * Compact tool descriptions for inclusion in the LLM system prompt.
   * Schema kept simple for Phase 1 — no full JSON Schema generation.
   */
  getToolDescriptions(): string {
    return this.getAll()
      .map(t => `- ${t.id}: ${t.description}`)
      .join('\n');
  }
}
