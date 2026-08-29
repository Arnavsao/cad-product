import { Injectable, inject } from '@angular/core';
import { CommandStackService } from '../../../core/services/command-stack.service';
import { CompoundCmd } from '../../../core/models/command.model';
import { AiToolRegistryService } from './ai-tool-registry.service';
import { ValidationPipelineService } from './validation-pipeline.service';
import type { CadAction, ActionResult, ValidationIssue, PendingPlan, Permission } from '../models/ai-action.model';

export type ExecuteMode = 'validate' | 'commit';

export interface BatchValidationResult {
  ok: boolean;
  requiresConfirmation: boolean;
  affectedCount: number;
  affectedIds: number[];
  riskClass: 'safe' | 'review' | 'destructive';
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** All sessions are granted all Phase-1 + Phase-2 + Phase-3 permissions. */
const SESSION_PERMISSIONS: Permission[] = [
  'read', 'mutate:entities', 'mutate:layers', 'mutate:layout', 'insert:library', 'navigate',
];

@Injectable({ providedIn: 'root' })
export class ActionRouterService {
  private registry = inject(AiToolRegistryService);
  private pipeline = inject(ValidationPipelineService);
  private cmdStack = inject(CommandStackService);

  /**
   * Validate a batch of actions without executing anything.
   * Used by the orchestrator to decide safe vs review vs reject.
   */
  validate(actions: CadAction[]): BatchValidationResult {
    const ctx = this.registry.buildContext();
    const allAffectedIds: number[] = [];
    const issues: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    let requiresConfirmation = false;
    let overallRisk: 'safe' | 'review' | 'destructive' = 'safe';

    for (const action of actions) {
      const tool = this.registry.get(action.action);
      if (!tool) {
        issues.push({
          code: 'UNKNOWN_TOOL',
          severity: 'error',
          message: `Unknown action '${action.action}'.`,
        });
        return {
          ok: false,
          requiresConfirmation: false,
          affectedCount: 0,
          affectedIds: [],
          riskClass: 'safe',
          issues,
          warnings,
        };
      }

      const result = this.pipeline.run(action, tool, ctx, SESSION_PERMISSIONS);

      if (!result.ok) {
        return {
          ok: false,
          requiresConfirmation: false,
          affectedCount: 0,
          affectedIds: [],
          riskClass: 'safe',
          issues: result.errors,
          warnings: result.warnings,
        };
      }

      allAffectedIds.push(...result.affectedIds);
      issues.push(...result.errors);
      warnings.push(...result.warnings);
      if (result.requiresConfirmation) requiresConfirmation = true;

      // Escalate overall risk level
      if (result.riskClass === 'destructive') overallRisk = 'destructive';
      else if (result.riskClass === 'review' && overallRisk !== 'destructive') overallRisk = 'review';
    }

    return {
      ok: true,
      requiresConfirmation,
      affectedCount: allAffectedIds.length,
      affectedIds: [...new Set(allAffectedIds)],
      riskClass: overallRisk,
      issues,
      warnings,
    };
  }

  /**
   * Compile and commit all actions as a single CompoundCmd (one undo step).
   * Always call validate() first; this method assumes validation passed.
   */
  commit(actions: CadAction[]): ActionResult[] {
    const ctx = this.registry.buildContext();
    const results: ActionResult[] = [];
    const allCmds: import('../../../core/models/command.model').ICommand[] = [];

    for (const action of actions) {
      const tool = this.registry.get(action.action);
      if (!tool) {
        results.push({
          action: action.action,
          status: 'rejected',
          affectedIds: [],
          message: `Unknown action '${action.action}'.`,
        });
        continue;
      }

      try {
        // Use the tool's own validation to resolve the true affected set
        // (view/layout tools operate on detected views, not on target entities).
        const validated = tool.validate(action, ctx);
        const affectedIds = validated.affectedIds;

        if (tool.category === 'selection' || tool.noHistory) {
          // Selection and navigation are executed directly, NOT pushed to history.
          for (const cmd of tool.compile(action, ctx)) cmd.execute();
          results.push({
            action: action.action,
            status: 'applied',
            affectedIds,
            message: tool.describe(action, affectedIds),
          });
        } else {
          const cmds = tool.compile(action, ctx);
          allCmds.push(...cmds);
          results.push({
            action: action.action,
            status: 'applied',
            affectedIds,
            message: tool.describe(action, affectedIds),
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          action: action.action,
          status: 'rejected',
          affectedIds: [],
          message: `Execution error: ${msg}`,
          issues: [{ code: 'EXECUTION_ERROR', severity: 'error', message: msg }],
        });
      }
    }

    // Push all document-mutation commands as a single atomic undo step.
    if (allCmds.length > 0) {
      const compound = allCmds.length === 1 ? allCmds[0] : new CompoundCmd(allCmds);
      this.cmdStack.push(compound);
    }

    return results;
  }
}
