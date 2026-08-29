import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { LlmGatewayService } from './llm-gateway.service';
import { CadContextService } from './cad-context.service';
import { ActionRouterService } from './action-router.service';
import { AiPreviewService } from './ai-preview.service';
import { AiLayoutReportService } from './ai-layout-report.service';
import { AiAuditService } from './ai-audit.service';
import { AiSessionService } from './ai-session.service';
import { AiModelService } from './ai-model.service';
import type { CadAction, AiTurnEvent, ActionResult, PendingPlan } from '../models/ai-action.model';
import type { AiAuditRecord, AuditOutcome } from '../models/ai-audit.model';

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

function generatePlanId(): string {
  return 'plan_' + Math.random().toString(36).slice(2, 10);
}

@Injectable({ providedIn: 'root' })
export class AiOrchestratorService {
  private gateway = inject(LlmGatewayService);
  private context = inject(CadContextService);
  private router = inject(ActionRouterService);
  private preview = inject(AiPreviewService);
  private layoutReportSvc = inject(AiLayoutReportService);
  private audit = inject(AiAuditService);
  private session = inject(AiSessionService);
  private modelSvc = inject(AiModelService);

  /** In-memory conversation history (user ↔ assistant turns). */
  private _history: ChatHistoryEntry[] = this.session.loadHistory();

  /** Pending plans awaiting user confirmation keyed by planId. */
  private _pendingPlans = new Map<string, { plan: PendingPlan; actions: CadAction[] }>();

  /** True while an LLM round-trip is in progress. */
  readonly thinking = signal(false);

  /**
   * Send a user prompt through the full pipeline.
   * Emits a stream of AiTurnEvent and completes when the turn is resolved.
   */
  send(prompt: string): Observable<AiTurnEvent> {
    const subject = new Subject<AiTurnEvent>();

    // Run async, emit events into the subject.
    this._run(prompt, subject).catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      subject.next({ type: 'error', message: msg });
      subject.complete();
    });

    return subject.asObservable();
  }

  /**
   * Confirm a previously emitted 'plan' event.
   * Returns the ActionResult[] so the panel can display per-action outcomes.
   */
  async confirm(planId: string): Promise<ActionResult[]> {
    const entry = this._pendingPlans.get(planId);
    if (!entry) {
      return [{
        action: 'unknown',
        status: 'rejected',
        affectedIds: [],
        message: 'Plan expired or not found.',
      }];
    }
    this._pendingPlans.delete(planId);
    this.preview.clear();

    const results = this.router.commit(entry.actions);
    const summary = results.map(r => r.message).join(' ');
    this._history.push({ role: 'assistant', content: summary });
    this._persist();
    this._writeAudit({
      prompt: '',
      actions: entry.actions,
      results,
      outcome: 'applied',
      assistantText: summary,
    });
    return results;
  }

  /** Cancel a pending plan without applying it. */
  cancel(planId: string): void {
    this._pendingPlans.delete(planId);
    this.preview.clear();
  }

  /** Delegate to CommandStackService via the canvas undo affordance. */
  getHistory(): ChatHistoryEntry[] {
    return [...this._history];
  }

  clearHistory(): void {
    this._history = [];
    this._pendingPlans.clear();
    this.preview.clear();
    this.session.clearHistory();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async _run(prompt: string, subject: Subject<AiTurnEvent>): Promise<void> {
    this.thinking.set(true);
    subject.next({ type: 'thinking' });
    const t0 = Date.now();

    // Clear any stale preview and report from a previous turn.
    this.preview.clear();
    this.layoutReportSvc.clear();

    // Append user message to history.
    this._history.push({ role: 'user', content: prompt });

    try {
      const snapshot = this.context.build();
      const response = await this.gateway.call(prompt, snapshot, this._history);

      if (response.type === 'error') {
        this._history.push({ role: 'assistant', content: response.message });
        this._persist();
        this._writeAudit({ prompt, actions: [], results: [], outcome: 'error', assistantText: response.message, durationMs: Date.now() - t0 });
        subject.next({ type: 'error', message: response.message });
        subject.complete();
        return;
      }

      if (response.type === 'clarify') {
        this._history.push({ role: 'assistant', content: response.question });
        this._persist();
        this._writeAudit({ prompt, actions: [], results: [], outcome: 'clarify', assistantText: response.question, durationMs: Date.now() - t0 });
        subject.next({ type: 'clarify', question: response.question, options: response.options });
        subject.complete();
        return;
      }

      // ── response.type === 'actions' ──────────────────────────────────────
      const { actions } = response;
      if (!actions || actions.length === 0) {
        const msg = 'No actions were generated for that command.';
        this._history.push({ role: 'assistant', content: msg });
        this._persist();
        this._writeAudit({ prompt, actions: [], results: [], outcome: 'error', assistantText: msg, durationMs: Date.now() - t0 });
        subject.next({ type: 'error', message: msg });
        subject.complete();
        return;
      }

      const validation = this.router.validate(actions);

      if (!validation.ok) {
        const msg = validation.issues.map(i => i.message).join(' ');
        this._history.push({ role: 'assistant', content: msg });
        this._persist();
        this._writeAudit({ prompt, actions, results: [], outcome: 'rejected', assistantText: msg, durationMs: Date.now() - t0 });
        subject.next({ type: 'rejected', issues: validation.issues, message: msg });
        subject.complete();
        return;
      }

      if (validation.requiresConfirmation) {
        // Emit plan for user to review and confirm.
        const planId = generatePlanId();
        const plan: PendingPlan = {
          planId,
          actions,
          affectedCount: validation.affectedCount,
          affectedIds: validation.affectedIds,
          issues: validation.warnings,
          riskClass: validation.riskClass,
          preview: this._buildPreviewText(actions, validation.affectedCount),
        };
        this._pendingPlans.set(planId, { plan, actions });
        this.preview.show(validation.affectedIds, validation.riskClass);
        // Audit recorded as 'previewed' — will be updated to 'applied' on confirm.
        this._writeAudit({ prompt, actions, results: [], outcome: 'previewed', assistantText: plan.preview, durationMs: Date.now() - t0 });
        subject.next({ type: 'plan', plan });
        subject.complete();
        return;
      }

      // ── Auto-commit (safe + small blast-radius, no confirmation needed) ──
      const results = this.router.commit(actions);
      const summary = results.map(r => r.message).join(' ');
      this._history.push({ role: 'assistant', content: summary });
      this._persist();
      this._writeAudit({ prompt, actions, results, outcome: 'applied', assistantText: summary, durationMs: Date.now() - t0 });

      // layout.validate produces a structured report — emit it as a card.
      const report = this.layoutReportSvc.current();
      if (report && actions.some(a => a.action === 'layout.validate')) {
        subject.next({ type: 'report', summary, reportJson: JSON.stringify(report) });
      } else {
        subject.next({ type: 'applied', results, summary });
      }
      subject.complete();
    } finally {
      this.thinking.set(false);
    }
  }

  private _buildPreviewText(actions: CadAction[], affectedCount: number): string {
    const lines = actions.map(a => {
      const params = JSON.stringify(a.parameters);
      return `• ${a.action}(${params}) on ${affectedCount} entities`;
    });
    return lines.join('\n');
  }

  /** Persist conversation history to localStorage after each turn. */
  private _persist(): void {
    this.session.saveHistory(this._history);
  }

  /**
   * Write an append-only audit record for the turn.
   * drawingId and contextRevision are read from the live context.
   */
  private _writeAudit(partial: {
    prompt: string;
    actions: CadAction[];
    results: ActionResult[];
    outcome: AuditOutcome;
    assistantText: string;
    durationMs?: number;
  }): void {
    try {
      const snap = this.context.build();
      const affectedEntityIds = partial.results.flatMap(r => r.affectedIds ?? []);
      const record: AiAuditRecord = {
        id: crypto.randomUUID ? crypto.randomUUID() : `rec_${Date.now()}`,
        ts: new Date().toISOString(),
        prompt: partial.prompt,
        drawingId: snap.documentId,
        contextRevision: snap.revision,
        actions: partial.actions,
        results: partial.results,
        outcome: partial.outcome,
        assistantText: partial.assistantText,
        affectedEntityIds,
        modelId: this.modelSvc.selectedId(),
        durationMs: partial.durationMs ?? 0,
      };
      this.audit.write(record);
    } catch { /* audit must never throw */ }
  }
}
