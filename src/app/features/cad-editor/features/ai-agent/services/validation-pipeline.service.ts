import { Injectable } from '@angular/core';
import type { CadAction, ValidationIssue, Permission } from '../models/ai-action.model';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';

/** Blast-radius boundary: above this the risk class is upgraded to 'review'. */
const BLAST_RADIUS_THRESHOLD = 50;

export interface PipelineResult {
  ok: boolean;
  confidence: number;
  affectedIds: number[];
  riskClass: 'safe' | 'review' | 'destructive';
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  requiresConfirmation: boolean;
}

@Injectable({ providedIn: 'root' })
export class ValidationPipelineService {
  /**
   * Run all guards for a single action against its registered tool.
   * Returns a merged result that ActionRouter consumes.
   */
  run(
    action: CadAction,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: AiTool<any>,
    ctx: AiToolContext,
    grantedPermissions: Permission[],
  ): PipelineResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // ── Guard 1: Permission check ────────────────────────────────────────────
    for (const required of tool.permissions) {
      if (!grantedPermissions.includes(required)) {
        errors.push({
          code: 'PERMISSION_DENIED',
          severity: 'error',
          message: `This action requires the '${required}' permission.`,
        });
      }
    }
    if (errors.length > 0) {
      return this._fail(errors, warnings);
    }

    // ── Guard 2: Tool-specific validation (existence, schema, state) ─────────
    const toolResult: AiToolValidationResult = tool.validate(action, ctx);

    errors.push(...toolResult.errors);
    warnings.push(...toolResult.warnings);

    if (!toolResult.ok) {
      return this._fail(errors, warnings, toolResult.affectedIds);
    }

    // ── Guard 3: Blast-radius upgrade ────────────────────────────────────────
    let riskClass = toolResult.riskClass;
    if (riskClass === 'safe' && toolResult.affectedIds.length >= BLAST_RADIUS_THRESHOLD) {
      riskClass = 'review';
      warnings.push({
        code: 'LARGE_BLAST_RADIUS',
        severity: 'warning',
        message: `This will affect ${toolResult.affectedIds.length} entities. Please review before applying.`,
      });
    }

    // ── Guard 4: Confidence scoring ──────────────────────────────────────────
    const modelConf = action.metadata.confidence ?? 1;
    const selectorCertainty = action.target.kind === 'ids' || action.target.kind === 'selection'
      ? 1.0
      : action.target.kind === 'all' ? 0.9 : 0.85;
    const confidence = 0.6 * modelConf + 0.4 * selectorCertainty;

    if (confidence < 0.5) {
      warnings.push({
        code: 'LOW_CONFIDENCE',
        severity: 'warning',
        message: `Low confidence (${(confidence * 100).toFixed(0)}%). Please review before applying.`,
      });
    }

    const requiresConfirmation =
      riskClass !== 'safe' ||
      !!action.metadata.requiresConfirmation ||
      confidence < 0.65;

    return {
      ok: true,
      confidence,
      affectedIds: toolResult.affectedIds,
      riskClass,
      errors,
      warnings,
      requiresConfirmation,
    };
  }

  private _fail(
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    affectedIds: number[] = [],
  ): PipelineResult {
    return {
      ok: false,
      confidence: 0,
      affectedIds,
      riskClass: 'safe',
      errors,
      warnings,
      requiresConfirmation: false,
    };
  }
}
