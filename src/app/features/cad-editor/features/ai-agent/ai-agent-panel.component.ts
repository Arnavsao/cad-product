import {
  Component, inject, signal, ViewChild, ElementRef, AfterViewChecked, OnDestroy,
  ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AiOrchestratorService } from './services/ai-orchestrator.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { AiModelService } from './services/ai-model.service';
import type { AiTurnEvent, ActionResult, PendingPlan, ValidationIssue } from './models/ai-action.model';
import type { LayoutReport, LayoutIssue } from './tools/views-intelligent-layout.tools';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  plan?: PendingPlan;
  results?: ActionResult[];
  issues?: ValidationIssue[];
  layoutReport?: LayoutReport;
  isError?: boolean;
  isClarify?: boolean;
}

let msgIdSeq = 0;
function nextId() { return `msg_${++msgIdSeq}`; }

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-ai-agent-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="ai-panel">
    
      <!-- Header: model selector + settings -->
      <div class="ai-header">
        <select class="ai-model-select"
          [ngModel]="modelSvc.selectedId()"
          (ngModelChange)="onModelChange($event)"
          [title]="modelSvc.selected.hint">
          @for (m of modelSvc.models; track m) {
            <option [value]="m.id">{{ m.label }}</option>
          }
        </select>
        <button type="button" class="ai-gear-btn"
          [class.active]="showSettings()"
          (click)="showSettings.set(!showSettings())"
        title="API key settings">⚙</button>
        <button type="button" class="ai-clear-btn" (click)="clearHistory()" title="Clear conversation">🗑</button>
      </div>
    
      <!-- Settings popover: backend config -->
      @if (showSettings()) {
        <div class="ai-settings">
          <!-- Ollama server URL (shown for local models) -->
          @if (isOllama()) {
            <label class="ai-settings-label">Ollama server URL</label>
            <div class="ai-key-row">
              <input class="ai-key-input"
                type="text"
                placeholder="http://localhost:11434"
                [ngModel]="modelSvc.ollamaUrl()"
                (ngModelChange)="onOllamaUrlChange($event)"
                autocomplete="off" spellcheck="false" />
              </div>
              <p class="ai-settings-note">
                Self-hosted — no API key or rate limits. The server must allow this app's
                origin (set OLLAMA_ORIGINS=* on the server).
              </p>
            }
            <!-- OpenRouter API key (shown for cloud models) -->
            @if (isOpenRouter()) {
              @if (needsDataConsent()) {
                <div class="ai-settings-consent">
                  <p class="ai-settings-note ai-settings-warn">
                    ⚠ OpenRouter is a third-party, external AI provider. Using it sends a summary
                    of your drawing (layers, entity counts/types, selection — not the raw file) and
                    your prompts to OpenRouter's servers to generate a response.
                  </p>
                  <button type="button" class="ai-consent-btn" (click)="grantDataConsent()">
                    I understand — continue
                  </button>
                </div>
              } @else {
                <label class="ai-settings-label">OpenRouter API key</label>
                <div class="ai-key-row">
                  <input class="ai-key-input"
                    [type]="showKey() ? 'text' : 'password'"
                    placeholder="sk-or-v1-…"
                    [ngModel]="modelSvc.apiKey()"
                    (ngModelChange)="onKeyChange($event)"
                    autocomplete="off" spellcheck="false" />
                    <button type="button" class="ai-key-toggle" (click)="showKey.set(!showKey())">
                      {{ showKey() ? '🙈' : '👁' }}
                    </button>
                  </div>
                  <p class="ai-settings-note" [class.ai-settings-warn]="needsKey()">
                    {{ needsKey()
                    ? '⚠ This model needs a key. Paste your OpenRouter key above.'
                    : 'Stored only in this browser. Sent directly to OpenRouter. Never commit it.' }}
                  </p>
                }
              }
              <!-- Regex selected -->
              @if (modelSvc.selected.kind === 'local') {
                <p class="ai-settings-note">
                  Offline regex parser — no configuration needed.
                </p>
              }
            </div>
          }
    
          <!-- Message list -->
          <div class="ai-messages" #scrollContainer>
    
            @if (messages().length === 0) {
              <div class="ai-welcome">
                <p>Ask me to modify your drawing in plain English.</p>
                <div class="ai-examples">
                  <button type="button" class="ai-example-chip" (click)="sendExample('Change all circles to red')">Change all circles to red</button>
                  <button type="button" class="ai-example-chip" (click)="sendExample('Hide layer DIM')">Hide layer DIM</button>
                  <button type="button" class="ai-example-chip" (click)="sendExample('Move top view 5m to the right')">Move top view 5m right</button>
                  <button type="button" class="ai-example-chip" (click)="sendExample('Distribute views evenly')">Distribute views evenly</button>
                  <button type="button" class="ai-example-chip" (click)="sendExample('Reorganize all views into 3 columns')">Auto-reorganize (3 cols)</button>
                  <button type="button" class="ai-example-chip" (click)="sendExample('Center all views')">Center all views</button>
                  <button type="button" class="ai-example-chip" (click)="sendExample('Check layout for overlaps')">Check layout</button>
                  <button type="button" class="ai-example-chip" (click)="sendExample('Zoom to top view')">Zoom to view</button>
                  <button type="button" class="ai-example-chip" (click)="sendExample('Rename layer DIM to ANNOT')">Rename layer</button>
                  <button type="button" class="ai-example-chip" (click)="sendExample('Generate a box culvert GAD 2m wide 1.5m high')">Generate culvert GAD</button>
                </div>
              </div>
            }
    
            @for (msg of messages(); track trackMsg($index, msg)) {
              <!-- User bubble -->
              @if (msg.role === 'user') {
                <div class="ai-msg ai-msg--user">
                  <span class="ai-msg-bubble">{{ msg.content }}</span>
                </div>
              }
              <!-- Assistant bubble -->
              @if (msg.role === 'assistant') {
                <div class="ai-msg ai-msg--assistant">
                  <span class="ai-msg-avatar">✦</span>
                  <div class="ai-msg-body">
                    <!-- Copy button (hover, not on thinking placeholder) -->
                    @if (msg.content !== '__thinking__') {
                      <button
                        type="button"
                        class="ai-copy-btn"
                        [class.ai-copied]="copiedId() === msg.id"
                        (click)="copyMessage(msg)"
                        [title]="copiedId() === msg.id ? 'Copied!' : 'Copy message'">
                        {{ copiedId() === msg.id ? '✓' : '⎘' }}
                      </button>
                    }
                    <!-- Thinking indicator -->
                    @if (msg.content === '__thinking__') {
                      <div class="ai-thinking">
                        <span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>
                      </div>
                    }
                    <!-- Regular text -->
                    @if (msg.content !== '__thinking__') {
                      <p class="ai-msg-text"
                        [class.ai-msg-error]="msg.isError"
                        [class.ai-msg-clarify]="msg.isClarify">
                        {{ msg.content }}
                      </p>
                    }
                    <!-- Validation warnings -->
                    @if (msg.issues && msg.issues.length > 0) {
                      <div class="ai-warnings">
                        @for (issue of msg.issues; track issue) {
                          <div class="ai-warning">
                            ⚠ {{ issue.message }}
                          </div>
                        }
                      </div>
                    }
                    <!-- Preview / Confirm card -->
                    @if (msg.plan) {
                      <div class="ai-confirm-card">
                        <div class="ai-confirm-meta">
                          <span class="ai-risk-badge ai-risk-{{ msg.plan.riskClass }}">
                            {{ riskLabel(msg.plan.riskClass) }}
                          </span>
                          <span class="ai-confirm-count">{{ msg.plan.affectedCount }} entities affected</span>
                        </div>
                        <div class="ai-confirm-preview">{{ msg.plan.preview }}</div>
                        <div class="ai-confirm-actions">
                          <button type="button" class="ai-btn ai-btn-apply"
                            [disabled]="thinking()"
                            (click)="applyPlan(msg)">
                            Apply
                          </button>
                          <button type="button" class="ai-btn ai-btn-cancel"
                            (click)="cancelPlan(msg)">
                            Cancel
                          </button>
                        </div>
                      </div>
                    }
                    <!-- Applied results: show undo affordance -->
                    @if (msg.results && msg.results.length > 0) {
                      <div class="ai-applied-row">
                        @if (cmdStack.canUndo()) {
                          <button type="button" class="ai-btn ai-btn-undo"
                            (click)="undo()">
                            ↩ Undo
                          </button>
                        }
                      </div>
                    }
                    <!-- Layout validation report card -->
                    @if (msg.layoutReport) {
                      <div class="ai-report-card">
                        <div class="ai-report-header">
                          <span class="ai-report-badge" [class.ai-report-pass]="msg.layoutReport.passed" [class.ai-report-fail]="!msg.layoutReport.passed">
                            {{ msg.layoutReport.passed ? '✓ Passed' : '✗ Issues found' }}
                          </span>
                          <span class="ai-report-meta">{{ msg.layoutReport.viewCount }} view{{ msg.layoutReport.viewCount === 1 ? '' : 's' }} analysed</span>
                        </div>
                        @if (msg.layoutReport.issues.length > 0) {
                          @for (issue of msg.layoutReport.issues; track issue) {
                            <div
                              class="ai-report-issue"
                              [class.ai-issue-error]="issue.severity === 'error'"
                              [class.ai-issue-warning]="issue.severity === 'warning'"
                              [class.ai-issue-info]="issue.severity === 'info'">
                              <span class="ai-issue-icon">{{ issueIcon(issue.severity) }}</span>
                              <span class="ai-issue-msg">{{ issue.message }}</span>
                            </div>
                          }
                        } @else {
                          <p class="ai-report-none">No layout issues found.</p>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            }
          </div>
    
          <!-- Input area -->
          <div class="ai-input-area">
            <textarea
              #inputEl
              class="ai-input"
              rows="2"
              placeholder="Describe what you want to do…"
              [(ngModel)]="inputText"
              (keydown)="onKeydown($event)"
              [disabled]="thinking()"
            ></textarea>
            @if (!thinking()) {
              <button type="button" class="ai-send-btn"
                [disabled]="!inputText().trim()"
                (click)="send()">
                ▶
              </button>
            }
            @if (thinking()) {
              <button type="button" class="ai-stop-btn"
                (click)="stop()" title="Stop generating">
                ■
              </button>
            }
          </div>
    
        </div>
    `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
      overflow: hidden;
    }
    .ai-panel {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: transparent;
      font-size: 12px;
      color: var(--cad-text-primary, #e0e4ea);
    }

    /* ── Header (model selector) ────────────────────────────────── */
    .ai-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--cad-border, #2c3340);
      flex-shrink: 0;
    }
    .ai-model-select {
      flex: 1;
      background: var(--cad-bg-input, rgba(255,255,255,0.05));
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 5px;
      color: var(--cad-text-primary, #e0e4ea);
      font-size: 11px;
      padding: 4px 6px;
      cursor: pointer;
      outline: none;
    }
    .ai-model-select:focus { border-color: var(--cad-accent, #4f8ef7); }
    .ai-gear-btn, .ai-clear-btn {
      background: none;
      border: 1px solid transparent;
      border-radius: 5px;
      cursor: pointer;
      color: var(--cad-text-dim, #7f8694);
      font-size: 13px;
      padding: 3px 6px;
      line-height: 1;
    }
    .ai-gear-btn:hover, .ai-clear-btn:hover { color: var(--cad-text-primary, #e0e4ea); }
    .ai-gear-btn.active {
      color: var(--cad-accent, #4f8ef7);
      border-color: var(--cad-border, #2c3340);
      background: var(--cad-accent-tint, rgba(79,142,247,0.12));
    }

    /* ── Settings popover ───────────────────────────────────────── */
    .ai-settings {
      padding: 8px 10px;
      border-bottom: 1px solid var(--cad-border, #2c3340);
      background: var(--cad-bg-panel-solid, #1f2530);
      flex-shrink: 0;
    }
    .ai-settings-label {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--cad-text-dim, #7f8694);
      margin-bottom: 4px;
    }
    .ai-key-row { display: flex; gap: 4px; }
    .ai-key-input {
      flex: 1;
      background: var(--cad-bg-input, rgba(255,255,255,0.05));
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 5px;
      color: var(--cad-text-primary, #e0e4ea);
      font-family: var(--cad-font-mono, monospace);
      font-size: 11px;
      padding: 4px 6px;
      outline: none;
    }
    .ai-key-input:focus { border-color: var(--cad-accent, #4f8ef7); }
    .ai-key-toggle {
      background: none; border: 1px solid var(--cad-border, #2c3340);
      border-radius: 5px; cursor: pointer; padding: 2px 6px; font-size: 12px;
    }
    .ai-settings-note {
      margin: 6px 0 0;
      font-size: 10px;
      color: var(--cad-text-dim, #7f8694);
      line-height: 1.4;
    }
    .ai-settings-warn { color: #fbbf24; }
    .ai-settings-consent { display: flex; flex-direction: column; gap: 8px; }
    .ai-consent-btn {
      align-self: flex-start;
      background: var(--cad-accent, #4f8ef7);
      color: #fff;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      padding: 5px 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .ai-consent-btn:hover { filter: brightness(1.1); }

    /* ── Header ─────────────────────────────────────────────────── */

    .ai-panel-title {
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.04em;
      color: var(--cad-text-primary, #e0e4ea);
    }
    .ai-icon { color: var(--cad-accent, #4f8ef7); margin-right: 4px; }
    .ai-clear-btn {
      background: none; border: none; cursor: pointer;
      color: var(--cad-text-dim, #7f8694); font-size: 11px; padding: 2px 4px;
    }
    .ai-clear-btn:hover { color: var(--cad-text-primary, #e0e4ea); }

    /* ── Messages ───────────────────────────────────────────────── */
    .ai-messages {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;

      /* Firefox */
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.15) transparent;
    }
    /* Webkit (Chrome / Edge / Safari) */
    .ai-messages::-webkit-scrollbar {
      width: 6px;
    }
    .ai-messages::-webkit-scrollbar-track {
      background: transparent;
    }
    .ai-messages::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.15);
      border-radius: 3px;
    }
    .ai-messages::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.25);
    }
    .ai-welcome p {
      color: var(--cad-text-dim, #7f8694);
      font-size: 11px;
      margin: 0 0 8px;
    }
    .ai-examples { display: flex; flex-wrap: wrap; gap: 5px; }
    .ai-example-chip {
      background: var(--cad-bg-hover, rgba(255,255,255,0.05));
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 10px;
      color: var(--cad-text-secondary, #b8bdc8);
      font-size: 10px;
      padding: 3px 8px;
      cursor: pointer;
    }
    .ai-example-chip:hover { background: var(--cad-accent-tint, rgba(79,142,247,0.12)); }

    .ai-msg { display: flex; }
    .ai-msg--user { justify-content: flex-end; }
    .ai-msg-bubble {
      background: var(--cad-accent, #4f8ef7);
      color: #fff;
      border-radius: 10px 10px 2px 10px;
      padding: 6px 10px;
      max-width: 85%;
      word-break: break-word;
    }
    .ai-msg--assistant { align-items: flex-start; gap: 6px; }
    .ai-msg-avatar {
      flex-shrink: 0;
      width: 22px; height: 22px;
      display: flex; align-items: center; justify-content: center;
      background: var(--cad-accent-tint, rgba(79,142,247,0.15));
      border-radius: 50%;
      color: var(--cad-accent, #4f8ef7);
      font-size: 10px;
    }
    .ai-msg-body { flex: 1; min-width: 0; position: relative; }
    .ai-msg-text {
      margin: 0;
      color: var(--cad-text-primary, #e0e4ea);
      line-height: 1.5;
      word-break: break-word;
    }
    .ai-msg-error { color: #f87171; }
    .ai-msg-clarify { color: var(--cad-text-secondary, #b8bdc8); font-style: italic; }

    /* ── Thinking dots ──────────────────────────────────────────── */
    .ai-thinking { display: flex; gap: 4px; padding: 4px 0; }
    .ai-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--cad-text-dim, #7f8694);
      animation: ai-bounce 1.2s infinite ease-in-out;
    }
    .ai-dot:nth-child(2) { animation-delay: 0.2s; }
    .ai-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes ai-bounce {
      0%,80%,100% { transform: translateY(0); }
      40% { transform: translateY(-4px); }
    }

    /* ── Warnings ───────────────────────────────────────────────── */
    .ai-warnings { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
    .ai-warning {
      font-size: 10px; color: #fbbf24;
      background: rgba(251,191,36,0.08);
      border-radius: 4px; padding: 3px 6px;
    }

    /* ── Confirm card ───────────────────────────────────────────── */
    .ai-confirm-card {
      margin-top: 8px;
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 6px;
      background: var(--cad-bg-panel-solid, #1f2530);
      padding: 8px 10px;
    }
    .ai-confirm-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .ai-risk-badge {
      font-size: 10px; font-weight: 600; border-radius: 4px; padding: 1px 6px; text-transform: uppercase;
    }
    .ai-risk-safe { background: rgba(52,211,153,0.15); color: #34d399; }
    .ai-risk-review { background: rgba(251,191,36,0.15); color: #fbbf24; }
    .ai-risk-destructive { background: rgba(248,113,113,0.15); color: #f87171; }
    .ai-confirm-count { font-size: 10px; color: var(--cad-text-dim, #7f8694); }
    .ai-confirm-preview {
      font-size: 10px; color: var(--cad-text-secondary, #b8bdc8);
      white-space: pre-wrap; word-break: break-all;
      max-height: 80px; overflow-y: auto;
      margin-bottom: 8px;
    }
    .ai-confirm-actions { display: flex; gap: 6px; }

    /* ── Applied row ────────────────────────────────────────────── */
    .ai-applied-row { margin-top: 6px; }

    /* ── Layout validation report card ─────────────────────────────── */
    .ai-report-card {
      margin-top: 8px;
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 6px;
      background: var(--cad-bg-panel-solid, #1f2530);
      padding: 8px 10px;
    }
    .ai-report-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .ai-report-badge {
      font-size: 11px;
      font-weight: 700;
      border-radius: 4px;
      padding: 2px 7px;
    }
    .ai-report-pass { background: rgba(52,211,153,0.15); color: #34d399; }
    .ai-report-fail { background: rgba(248,113,113,0.15); color: #f87171; }
    .ai-report-meta { font-size: 10px; color: var(--cad-text-dim, #7f8694); }
    .ai-report-issue {
      display: flex;
      align-items: flex-start;
      gap: 5px;
      font-size: 11px;
      padding: 3px 0;
      border-top: 1px solid rgba(255,255,255,0.04);
      line-height: 1.45;
    }
    .ai-issue-icon { flex-shrink: 0; }
    .ai-issue-msg { flex: 1; }
    .ai-issue-error  .ai-issue-msg { color: #f87171; }
    .ai-issue-warning .ai-issue-msg { color: #fbbf24; }
    .ai-issue-info   .ai-issue-msg { color: var(--cad-text-secondary, #b8bdc8); }
    .ai-report-none {
      font-size: 11px;
      color: var(--cad-text-dim, #7f8694);
      margin: 2px 0 0;
    }

    /* ── Buttons ────────────────────────────────────────────────── */
    .ai-btn {
      border: none; border-radius: 4px; cursor: pointer;
      font-size: 11px; font-family: inherit; padding: 4px 10px;
      transition: opacity 0.1s;
    }
    .ai-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .ai-btn-apply { background: var(--cad-accent, #4f8ef7); color: #fff; }
    .ai-btn-apply:not(:disabled):hover { opacity: 0.85; }
    .ai-btn-cancel {
      background: var(--cad-bg-hover, rgba(255,255,255,0.06));
      color: var(--cad-text-secondary, #b8bdc8);
      border: 1px solid var(--cad-border, #2c3340);
    }
    .ai-btn-cancel:hover { background: var(--cad-bg-hover, rgba(255,255,255,0.1)); }
    .ai-btn-undo {
      background: transparent;
      color: var(--cad-accent, #4f8ef7);
      border: 1px solid var(--cad-accent, #4f8ef7);
      font-size: 10px; padding: 2px 8px;
    }
    .ai-btn-undo:hover { background: var(--cad-accent-tint, rgba(79,142,247,0.12)); }

    /* ── Copy button ─────────────────────────────────────────────── */
    .ai-copy-btn {
      position: absolute;
      top: 2px;
      right: 2px;
      background: var(--cad-bg-panel-solid, #1f2530);
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 4px;
      color: var(--cad-text-dim, #7f8694);
      font-size: 12px;
      padding: 1px 5px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
      line-height: 1;
    }
    .ai-msg-body:hover .ai-copy-btn { opacity: 1; }
    .ai-copy-btn:hover { color: var(--cad-text-primary, #e0e4ea); }
    .ai-copied { opacity: 1 !important; color: #34d399 !important; border-color: #34d399 !important; }

    /* ── Stop button ─────────────────────────────────────────────── */
    .ai-stop-btn {
      width: 30px; height: 30px;
      border: none; border-radius: 6px;
      background: #f87171;
      color: #fff;
      cursor: pointer;
      font-size: 11px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .ai-stop-btn:hover { opacity: 0.85; }

    /* ── Input area ─────────────────────────────────────────────── */
    .ai-input-area {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      padding: 8px 10px;
      border-top: 1px solid var(--cad-border, #2c3340);
      flex-shrink: 0;
    }
    .ai-input {
      flex: 1;
      background: var(--cad-bg-input, rgba(255,255,255,0.05));
      border: 1px solid var(--cad-border, #2c3340);
      border-radius: 6px;
      color: var(--cad-text-primary, #e0e4ea);
      font-family: var(--cad-font-ui, inherit);
      font-size: 12px;
      padding: 6px 8px;
      resize: none;
      outline: none;
      line-height: 1.4;
    }
    .ai-input:focus { border-color: var(--cad-accent, #4f8ef7); }
    .ai-input:disabled { opacity: 0.5; }
    .ai-send-btn {
      width: 30px; height: 30px;
      border: none; border-radius: 6px;
      background: var(--cad-accent, #4f8ef7);
      color: #fff;
      cursor: pointer;
      font-size: 13px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .ai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .ai-send-btn:not(:disabled):hover { opacity: 0.85; }
    .ai-spin {
      display: inline-block;
      animation: ai-spin 1s linear infinite;
    }
    @keyframes ai-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `],
})
export class AiAgentPanelComponent implements AfterViewChecked, OnDestroy {
  protected orchestrator = inject(AiOrchestratorService);
  protected cmdStack = inject(CommandStackService);
  protected modelSvc = inject(AiModelService);

  protected thinking = this.orchestrator.thinking;
  protected messages = signal<ChatMessage[]>([]);
  protected inputText = signal('');
  protected showSettings = signal(false);
  protected showKey = signal(false);
  protected copiedId = signal<string | null>(null);

  /** ID of the current thinking placeholder (for stop). */
  private _thinkingMsgId: string | null = null;

  /** True when the selected model is an LLM but no API key is set. */
  protected needsKey(): boolean {
    return this.modelSvc.selected.kind === 'openrouter' && !this.modelSvc.hasApiKey();
  }

  protected isOllama(): boolean {
    return this.modelSvc.selected.kind === 'ollama';
  }

  protected isOpenRouter(): boolean {
    return this.modelSvc.selected.kind === 'openrouter';
  }

  /** True when OpenRouter is selected but the user hasn't acknowledged that drawing data leaves the browser. */
  protected needsDataConsent(): boolean {
    return this.isOpenRouter() && !this.modelSvc.hasDataConsent();
  }

  protected grantDataConsent(): void {
    this.modelSvc.grantDataConsent();
  }

  protected onModelChange(id: string): void {
    this.modelSvc.setModel(id as any);
    // Auto-open settings if the chosen model needs configuration.
    if (this.needsKey()) this.showSettings.set(true);
  }

  protected onKeyChange(key: string): void {
    this.modelSvc.setApiKey(key);
  }

  protected onOllamaUrlChange(url: string): void {
    this.modelSvc.setOllamaUrl(url);
  }

  @ViewChild('scrollContainer') private scrollEl?: ElementRef<HTMLDivElement>;
  @ViewChild('inputEl') private inputEl?: ElementRef<HTMLTextAreaElement>;

  private _sub?: Subscription;
  private _shouldScroll = false;

  ngAfterViewChecked(): void {
    if (this._shouldScroll && this.scrollEl) {
      const el = this.scrollEl.nativeElement;
      el.scrollTop = el.scrollHeight;
      this._shouldScroll = false;
    }
  }

  ngOnDestroy(): void {
    this._sub?.unsubscribe();
  }

  protected trackMsg(_: number, m: ChatMessage) { return m.id; }

  protected riskLabel(r: 'safe' | 'review' | 'destructive'): string {
    return r === 'safe' ? '✓ Safe' : r === 'review' ? '⚠ Review' : '⛔ Destructive';
  }

  protected issueIcon(sev: string): string {
    return sev === 'error' ? '⛔' : sev === 'warning' ? '⚠' : 'ℹ';
  }

  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  protected onEnter(e: KeyboardEvent): void {
    if (!e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  protected sendExample(text: string): void {
    this.inputText.set(text);
    this.send();
  }

  protected send(): void {
    const text = this.inputText().trim();
    if (!text || this.thinking()) return;

    if (this.needsDataConsent()) {
      // Surface the consent banner instead of silently sending drawing data
      // to a third-party LLM the user hasn't acknowledged yet.
      this.showSettings.set(true);
      return;
    }

    this.inputText.set('');

    // Add user message.
    this._addMsg({ role: 'user', content: text });

    // Add thinking placeholder.
    const thinkingId = nextId();
    this._thinkingMsgId = thinkingId;
    this._addMsg({ role: 'assistant', content: '__thinking__', id: thinkingId } as any);

    this._sub?.unsubscribe();
    this._sub = this.orchestrator.send(text).subscribe({
      next: (event: AiTurnEvent) => this._handleEvent(event, thinkingId),
      error: (err: unknown) => {
        this._thinkingMsgId = null;
        this._replaceMsg(thinkingId, {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        });
      },
      complete: () => {
        this._thinkingMsgId = null;
      },
    });
  }

  protected async applyPlan(msg: ChatMessage): Promise<void> {
    if (!msg.plan) return;
    const planId = msg.plan.planId;

    // Remove the confirm card optimistically.
    this.messages.update(prev => prev.map(m =>
      m.id === msg.id ? { ...m, plan: undefined } : m,
    ));

    const thinkingId = nextId();
    this._addMsg({ role: 'assistant', content: '__thinking__', id: thinkingId } as any);

    try {
      const results = await this.orchestrator.confirm(planId);
      const allOk = results.every(r => r.status === 'applied');
      const summary = results.map(r => r.message).join(' ');
      this._replaceMsg(thinkingId, {
        role: 'assistant',
        content: allOk ? `✓ ${summary}` : summary,
        results,
        isError: !allOk,
      });
    } catch (err: unknown) {
      const msg2 = err instanceof Error ? err.message : String(err);
      this._replaceMsg(thinkingId, { role: 'assistant', content: `Error: ${msg2}`, isError: true });
    }
  }

  protected cancelPlan(msg: ChatMessage): void {
    if (!msg.plan) return;
    this.orchestrator.cancel(msg.plan.planId);
    this.messages.update(prev => prev.map(m =>
      m.id === msg.id ? { ...m, plan: undefined, content: 'Cancelled.' } : m,
    ));
  }

  protected undo(): void {
    this.cmdStack.undo();
    this._addMsg({ role: 'assistant', content: '↩ Action undone.' });
  }

  protected copyMessage(msg: ChatMessage): void {
    navigator.clipboard.writeText(msg.content).then(() => {
      this.copiedId.set(msg.id);
      setTimeout(() => {
        if (this.copiedId() === msg.id) this.copiedId.set(null);
      }, 1500);
    });
  }

  protected stop(): void {
    this._sub?.unsubscribe();
    this._sub = undefined;
    this.orchestrator.thinking.set(false);
    if (this._thinkingMsgId) {
      this._replaceMsg(this._thinkingMsgId, {
        role: 'assistant',
        content: 'Stopped.',
      });
      this._thinkingMsgId = null;
    }
  }

  protected clearHistory(): void {
    this.orchestrator.clearHistory();
    this.messages.set([]);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _handleEvent(event: AiTurnEvent, thinkingId: string): void {
    switch (event.type) {
      case 'thinking':
        // Already shown.
        break;

      case 'clarify':
        this._replaceMsg(thinkingId, {
          role: 'assistant',
          content: event.question,
          isClarify: true,
        });
        break;

      case 'plan':
        this._replaceMsg(thinkingId, {
          role: 'assistant',
          content: `I'll make ${event.plan.affectedCount} change(s). Please review:`,
          plan: event.plan,
          issues: event.plan.issues,
        });
        break;

      case 'applied':
        this._replaceMsg(thinkingId, {
          role: 'assistant',
          content: `✓ ${event.summary}`,
          results: event.results,
        });
        break;

      case 'report': {
        let parsedReport: LayoutReport | undefined;
        try { parsedReport = JSON.parse(event.reportJson); } catch { /* ignore */ }
        this._replaceMsg(thinkingId, {
          role: 'assistant',
          content: `✓ ${event.summary}`,
          layoutReport: parsedReport,
        });
        break;
      }

      case 'rejected':
        this._replaceMsg(thinkingId, {
          role: 'assistant',
          content: event.message,
          issues: event.issues,
          isError: true,
        });
        break;

      case 'error':
        this._replaceMsg(thinkingId, {
          role: 'assistant',
          content: event.message,
          isError: true,
        });
        break;
    }
  }

  private _addMsg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'role' | 'content'>): void {
    const msg: ChatMessage = { id: nextId(), ...partial };
    this.messages.update(prev => [...prev, msg]);
    this._shouldScroll = true;
  }

  private _replaceMsg(id: string, partial: Partial<ChatMessage> & Pick<ChatMessage, 'role' | 'content'>): void {
    const replacement: ChatMessage = { id, ...partial };
    this.messages.update(prev => prev.map(m => m.id === id ? replacement : m));
    this._shouldScroll = true;
  }
}
