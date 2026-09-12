import { Injectable, signal } from '@angular/core';
import {
  AI_MODELS, getModelOption, providerLabel,
  type AiModelId, type AiModelOption, type AiProviderKind,
} from '../models/ai-model';

const LS_MODEL_KEY = 'cad_ai_model_v2';
const LS_OPENROUTER_KEY = 'cad_ai_openrouter_key_v1';
const LS_ANTHROPIC_KEY = 'cad_ai_anthropic_key_v1';
const LS_OPENROUTER_SLUG = 'cad_ai_openrouter_slug_v1';
const LS_DATA_CONSENT_KEY = 'cad_ai_cloud_data_consent_v1';

/**
 * Holds the user's chosen reasoning backend and the per-provider API keys.
 *
 * SECURITY: keys are stored only in localStorage on this device and sent
 * directly to the provider from the browser. They are never written to source
 * or committed. Anyone with DevTools access on this machine can read them, so
 * use keys scoped/limited to this app and rotate them if they leak.
 */
@Injectable({ providedIn: 'root' })
export class AiModelService {
  readonly models = AI_MODELS;

  readonly selectedId = signal<AiModelId>(this._loadModel());
  readonly openRouterKey = signal<string>(this._load(LS_OPENROUTER_KEY));
  readonly anthropicKey = signal<string>(this._load(LS_ANTHROPIC_KEY));
  readonly openRouterSlug = signal<string>(this._load(LS_OPENROUTER_SLUG));

  get selected(): AiModelOption {
    return getModelOption(this.selectedId());
  }

  /** Provider of the selected model. */
  get kind(): AiProviderKind {
    return this.selected.kind;
  }

  /** True for any backend that sends drawing context off this machine. */
  get isCloud(): boolean {
    return this.kind !== 'local';
  }

  get providerName(): string {
    return providerLabel(this.kind);
  }

  setModel(id: AiModelId): void {
    this.selectedId.set(id);
    try { localStorage.setItem(LS_MODEL_KEY, id); } catch { /* ignore */ }
  }

  /** The API key for the selected provider ('' for the local parser). */
  apiKeyFor(kind: AiProviderKind = this.kind): string {
    if (kind === 'anthropic') return this.anthropicKey();
    if (kind === 'openrouter') return this.openRouterKey();
    return '';
  }

  setApiKey(key: string, kind: AiProviderKind = this.kind): void {
    const trimmed = key.trim();
    if (kind === 'anthropic') {
      this.anthropicKey.set(trimmed);
      this._store(LS_ANTHROPIC_KEY, trimmed);
    } else if (kind === 'openrouter') {
      this.openRouterKey.set(trimmed);
      this._store(LS_OPENROUTER_KEY, trimmed);
    }
  }

  hasApiKey(kind: AiProviderKind = this.kind): boolean {
    return kind === 'local' || this.apiKeyFor(kind).length > 0;
  }

  setOpenRouterSlug(slug: string): void {
    const trimmed = slug.trim();
    this.openRouterSlug.set(trimmed);
    this._store(LS_OPENROUTER_SLUG, trimmed);
  }

  /**
   * Slug actually sent to the provider. `or-custom` reads the user-typed
   * OpenRouter slug; everything else uses the catalogue entry.
   */
  resolvedSlug(): string | null {
    const m = this.selected;
    if (m.id === 'or-custom') return this.openRouterSlug() || null;
    return m.slug;
  }

  /**
   * Whether the user has acknowledged that drawing content (entity/layer
   * summaries, not raw files) is sent to an external LLM provider as part of
   * the assistant's context. One acknowledgement covers every cloud provider.
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

  private _store(key: string, value: string): void {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch { /* ignore */ }
  }

  private _loadModel(): AiModelId {
    try {
      const saved = localStorage.getItem(LS_MODEL_KEY) as AiModelId | null;
      if (saved && AI_MODELS.some(m => m.id === saved)) return saved;
    } catch { /* ignore */ }
    return 'regex';
  }

  private _load(key: string): string {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  }
}
