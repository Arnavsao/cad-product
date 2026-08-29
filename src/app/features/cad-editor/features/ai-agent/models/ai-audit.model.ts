import type { CadAction, ActionResult } from './ai-action.model';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditOutcome = 'applied' | 'previewed' | 'rejected' | 'error' | 'clarify';

export interface AiAuditRecord {
  /** Client-generated UUID — stable identifier across retries. */
  id: string;
  /** ISO timestamp of the turn. */
  ts: string;
  /** The raw user prompt that triggered this turn. */
  prompt: string;
  /** Drawing id at time of turn (`DxfFile.id`). */
  drawingId: string;
  /** DocumentService.version() snapshot at turn start. */
  contextRevision: number;
  /** All actions the model emitted, in order. */
  actions: CadAction[];
  /** Per-action execution results (empty for clarify/error turns). */
  results: ActionResult[];
  /** Aggregated outcome of the whole turn. */
  outcome: AuditOutcome;
  /** Natural-language assistant summary / error / clarifying question. */
  assistantText: string;
  /** Resolved entity ids affected by the turn (union across all actions). */
  affectedEntityIds: number[];
  /** LLM model id that produced the actions. */
  modelId: string;
  /** Time from send() to final event, ms. */
  durationMs: number;
}

/** Minimal session header stored in localStorage. */
export interface AiSessionMeta {
  id: string;
  drawingId: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}
