import type { ICommand, IModifyEntitiesCmdHooks } from '../../../core/models/command.model';
import type { DocumentService } from '../../../core/services/document.service';
import type { ViewModelService } from '../../../core/services/view-model.service';
import type { SpatialIndexService } from '../../../core/services/spatial-index.service';
import type { LibraryService } from '../../../core/services/library.service';
import type { Entity } from '../../../core/models/entity.model';
import type { CadAction, ValidationIssue, Permission, TargetSelector } from './ai-action.model';
import type { ViewDetectionService } from '../services/view-detection.service';
import type { AiLayoutReportService } from '../services/ai-layout-report.service';

export interface AiToolContext {
  doc: DocumentService;
  vm: ViewModelService;
  spatial: SpatialIndexService;
  library: LibraryService;
  viewDetection: ViewDetectionService;
  layoutReport: AiLayoutReportService;
  hooks: IModifyEntitiesCmdHooks;
  resolveTarget(sel: TargetSelector): Entity[];
}

export interface AiToolValidationResult {
  ok: boolean;
  confidence: number;
  affectedIds: number[];
  riskClass: 'safe' | 'review' | 'destructive';
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface AiTool<P = Record<string, unknown>> {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: 'selection' | 'entity' | 'layer' | 'view' | 'layout' | 'library' | 'annotation' | 'navigation';
  readonly permissions: Permission[];
  /** If true, action goes directly to commit; category:'selection' always bypasses history. */
  readonly noHistory?: boolean;

  validate(action: CadAction<P>, ctx: AiToolContext): AiToolValidationResult;

  /**
   * Pure compile: produce ICommand[] without pushing to CommandStackService.
   * The ActionRouter is the only caller and wraps the result in CompoundCmd.
   * MUST NOT mutate any service or entity directly.
   */
  compile(action: CadAction<P>, ctx: AiToolContext): ICommand[];

  /** Human-readable past-tense summary for the assistant reply. */
  describe(action: CadAction<P>, affectedIds: number[]): string;
}
