import type { IBBox } from '../../../core/models/entity.model';

// ── Target Selectors ──────────────────────────────────────────────────────────

export interface EntityWhere {
  type?: string | string[];
  layer?: string | string[];
  color?: (string | number)[];
  lineType?: string[];
  withinBBox?: IBBox;
  /** Default true — skip hidden/frozen entities silently. */
  visibleOnly?: boolean;
}

export type TargetSelector =
  | { kind: 'selection' }
  | { kind: 'ids'; ids: number[] }
  | { kind: 'all' }
  | { kind: 'query'; where: EntityWhere }
  | { kind: 'layer'; layer: string };

// ── Action Envelope ───────────────────────────────────────────────────────────

export interface ActionMetadata {
  intentText: string;
  confidence: number;
  rationale?: string;
  requiresConfirmation?: boolean;
  groupId?: string;
}

export interface CadAction<P = Record<string, unknown>> {
  action: string;
  target: TargetSelector;
  parameters: P;
  metadata: ActionMetadata;
}

// ── Result Types ──────────────────────────────────────────────────────────────

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  entityIds?: number[];
  fix?: string;
}

export interface ActionResult {
  action: string;
  status: 'applied' | 'rejected' | 'previewed' | 'undone';
  affectedIds: number[];
  commandId?: string;
  message: string;
  issues?: ValidationIssue[];
}

export interface PendingPlan {
  planId: string;
  actions: CadAction[];
  affectedCount: number;
  affectedIds: number[];
  issues: ValidationIssue[];
  preview: string;
  riskClass: 'safe' | 'review' | 'destructive';
}

export type AiTurnEvent =
  | { type: 'thinking' }
  | { type: 'clarify'; question: string; options?: string[] }
  | { type: 'plan'; plan: PendingPlan }
  | { type: 'applied'; results: ActionResult[]; summary: string }
  | { type: 'report'; summary: string; reportJson: string }
  | { type: 'rejected'; issues: ValidationIssue[]; message: string }
  | { type: 'error'; message: string };

// ── Permissions ───────────────────────────────────────────────────────────────

export type Permission =
  | 'read'
  | 'mutate:entities'
  | 'mutate:layers'
  | 'mutate:layout'
  | 'insert:library'
  | 'navigate';

export const ALL_PERMISSIONS: Permission[] = [
  'read', 'mutate:entities', 'mutate:layers', 'mutate:layout', 'insert:library', 'navigate',
];
