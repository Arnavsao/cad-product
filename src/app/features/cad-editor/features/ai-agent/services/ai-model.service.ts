import { Injectable, signal } from '@angular/core';
import { AI_MODELS, getModelOption, DEFAULT_OLLAMA_URL, type AiModelId, type AiModelOption } from '../models/ai-model';

const LS_MODEL_KEY = 'cad_ai_model_v1';
const LS_API_KEY = 'cad_ai_openrouter_key_v1';
const LS_OLLAMA_URL = 'cad_ai_ollama_url_v1';
const LS_DATA_CONSENT_KEY = 'cad_ai_openrouter_data_consent_v1';

/**
 * Holds the user's chosen reasoning backend, OpenRouter API key, and the
 * self-hosted Ollama server URL.
 *
 * SECURITY: the API key is stored only in localStorage on this device and
 * sent directly to OpenRouter from the browser. It is never written to source
 * or committed. Anyone with DevTools access on this machine can read it, so
 * use a key scoped/limited to this app and rotate it if it leaks.
 */
@Injectable({ providedIn: 'root' })
export class AiModelService {
  readonly models = AI_MODELS;

  readonly selectedId = signal<AiModelId>(this._loadModel());
  readonly apiKey = signal<string>(this._loadKey());
  readonly ollamaUrl = signal<string>(this._loadOllamaUrl());

  get selected(): AiModelOption {
    return getModelOption(this.selectedId());
  }

  setModel(id: AiModelId): void {
    this.selectedId.set(id);
    try { localStorage.setItem(LS_MODEL_KEY, id); } catch { /* ignore */ }
  }

  setApiKey(key: string): void {
    const trimmed = key.trim();
    this.apiKey.set(trimmed);
    try {
      if (trimmed) localStorage.setItem(LS_API_KEY, trimmed);
      else localStorage.removeItem(LS_API_KEY);
    } catch { /* ignore */ }
  }

  hasApiKey(): boolean {
    return this.apiKey().length > 0;
  }

  /**
   * Whether the user has acknowledged that drawing content (entity/layer
   * summaries, not raw files) is sent to OpenRouter — a third-party, external
   * LLM provider — as part of the AI assistant's context. Ollama is excluded:
   * it's a self-hosted/local server the user points at themselves.
   */
  hasDataConsent(): boolean {
    try {
      return localStorage.getItem(LS_DATA_CONSENT_KEY) === '1';
    } catch {
      return false;
    }
  }

  grantDataConsent(): void {
    try { localStorage.setItem(LS_DATA_CONSENT_KEY, '1'); } catch { /* ignore */ }
  }

  setOllamaUrl(url: string): void {
    // Normalise: trim and strip any trailing slash so we can append paths.
    const trimmed = url.trim().replace(/\/+$/, '');
    this.ollamaUrl.set(trimmed || DEFAULT_OLLAMA_URL);
    try { localStorage.setItem(LS_OLLAMA_URL, this.ollamaUrl()); } catch { /* ignore */ }
  }

  private _loadModel(): AiModelId {
    try {
      const saved = localStorage.getItem(LS_MODEL_KEY) as AiModelId | null;
      if (saved && AI_MODELS.some(m => m.id === saved)) return saved;
    } catch { /* ignore */ }
    return 'regex';
  }

  private _loadKey(): string {
    try {
      return localStorage.getItem(LS_API_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private _loadOllamaUrl(): string {
    try {
      return localStorage.getItem(LS_OLLAMA_URL) || DEFAULT_OLLAMA_URL;
    } catch {
      return DEFAULT_OLLAMA_URL;
    }
  }
}
