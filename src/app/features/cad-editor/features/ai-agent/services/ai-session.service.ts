import { Injectable, signal } from '@angular/core';
import type { AiSessionMeta } from '../models/ai-audit.model';
import type { ChatHistoryEntry } from './ai-orchestrator.service';

const LS_SESSION_KEY = 'cad_ai_session_v1';
const LS_HISTORY_KEY = 'cad_ai_history_v1';
const MAX_HISTORY_TURNS = 50;  // cap to limit localStorage size

/**
 * AiSessionService — lightweight client-side session persistence.
 *
 * Survives page reloads so the conversation doesn't vanish on refresh.
 * History is capped at MAX_HISTORY_TURNS to keep localStorage small.
 *
 * The server-side session (§12 ai_session table) is out of scope for
 * Phase 5 — this client store is the immediate deliverable.
 */
@Injectable({ providedIn: 'root' })
export class AiSessionService {
  readonly meta = signal<AiSessionMeta>(this._loadMeta());

  // ── History ────────────────────────────────────────────────────────────────

  loadHistory(): ChatHistoryEntry[] {
    try {
      const raw = localStorage.getItem(LS_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  saveHistory(history: ChatHistoryEntry[]): void {
    try {
      const capped = history.slice(-MAX_HISTORY_TURNS);
      localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(capped));
      this.meta.update(m => ({ ...m, updatedAt: new Date().toISOString(), turnCount: capped.filter(h => h.role === 'user').length }));
      this._saveMeta(this.meta());
    } catch { /* storage full — swallow */ }
  }

  clearHistory(): void {
    try { localStorage.removeItem(LS_HISTORY_KEY); } catch { /* ignore */ }
    const fresh = this._freshMeta(this.meta().drawingId);
    this.meta.set(fresh);
    this._saveMeta(fresh);
  }

  // ── Session meta ───────────────────────────────────────────────────────────

  startSession(drawingId: string): void {
    const existing = this._loadMeta();
    if (existing.drawingId === drawingId) return; // same drawing — keep history
    const fresh = this._freshMeta(drawingId);
    this.meta.set(fresh);
    this._saveMeta(fresh);
    // Clear history when starting a new drawing session.
    try { localStorage.removeItem(LS_HISTORY_KEY); } catch { /* ignore */ }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _freshMeta(drawingId = ''): AiSessionMeta {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `sess_${Date.now()}`,
      drawingId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turnCount: 0,
    };
  }

  private _loadMeta(): AiSessionMeta {
    try {
      const raw = localStorage.getItem(LS_SESSION_KEY);
      return raw ? JSON.parse(raw) : this._freshMeta();
    } catch { return this._freshMeta(); }
  }

  private _saveMeta(meta: AiSessionMeta): void {
    try { localStorage.setItem(LS_SESSION_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
  }
}
