import { environment } from '../../../../../../environments/environment';
export type AiModelId =
  | 'regex'
  | 'gemma-4-31b'
  | 'qwen3-coder-480b'
  | 'ollama-gemma4-31b'
  | 'ollama-qwen35-35b'
  | 'ollama-deepseek-v4';

export interface AiModelOption {
  id: AiModelId;
  label: string;
  /** Model slug/name sent to the backend, or null for the local regex parser. */
  slug: string | null;
  kind: 'local' | 'openrouter' | 'ollama';
  /** Short hint shown in the dropdown. */
  hint: string;
}

/**
 * Available reasoning backends.
 *
 * - `local`      → built-in deterministic regex parser (no network).
 * - `openrouter` → OpenRouter cloud API (needs an API key, may rate-limit).
 * - `ollama`     → self-hosted Ollama server (OpenAI-compatible endpoint).
 *
 * NOTE: cloud slugs occasionally change. If a model returns 404, list the
 * current slugs via GET {server}/api/tags (Ollama) or openrouter.ai/models.
 */
export const AI_MODELS: AiModelOption[] = [
  {
    id: 'regex',
    label: 'Regex (offline)',
    slug: null,
    kind: 'local',
    hint: 'Fast, deterministic, no API key needed',
  },

  // ── Self-hosted Ollama models (recommended — no rate limits) ───────────────
  {
    id: 'ollama-gemma4-31b',
    label: 'Gemma 4 31B (local)',
    slug: 'gemma4:31b',
    kind: 'ollama',
    hint: 'Self-hosted · balanced accuracy + latency (recommended)',
  },
  {
    id: 'ollama-qwen35-35b',
    label: 'Qwen 3.6 35B (local)',
    slug: 'qwen3.6:35b',
    kind: 'ollama',
    hint: 'Self-hosted · best for complex/logic-heavy commands',
  },
  {
    id: 'ollama-deepseek-v4',
    label: 'DeepSeek V4 Pro (local→cloud)',
    slug: 'deepseek-v4-pro:cloud',
    kind: 'ollama',
    hint: 'Self-hosted proxy to DeepSeek cloud',
  },

  // ── OpenRouter cloud (fallback — free tier rate-limits) ────────────────────
  {
    id: 'gemma-4-31b',
    label: 'Gemma 4 31B (OpenRouter)',
    slug: 'google/gemma-4-31b-it:free',
    kind: 'openrouter',
    hint: 'Cloud · free tier may rate-limit',
  },
  {
    id: 'qwen3-coder-480b',
    label: 'Qwen3 Coder (OpenRouter)',
    slug: 'qwen/qwen3-coder:free',
    kind: 'openrouter',
    hint: 'Cloud · free tier may rate-limit',
  },
];

/** Default base URL for the self-hosted Ollama server. */
export const DEFAULT_OLLAMA_URL = environment.defaultOllamaUrl;

export function getModelOption(id: AiModelId): AiModelOption {
  return AI_MODELS.find(m => m.id === id) ?? AI_MODELS[0];
}
