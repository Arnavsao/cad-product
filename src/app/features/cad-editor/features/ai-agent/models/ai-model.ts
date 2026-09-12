export type AiProviderKind = 'local' | 'anthropic' | 'openrouter';

export type AiModelId =
  | 'regex'
  | 'claude-opus-5'
  | 'claude-sonnet-5'
  | 'claude-haiku-4-5'
  | 'or-claude-sonnet-5'
  | 'or-claude-opus-5'
  | 'or-custom';

export interface AiModelOption {
  id: AiModelId;
  label: string;
  /**
   * Model slug sent to the provider, or null when the slug comes from
   * elsewhere: the local regex parser has none, and `or-custom` reads the
   * user-typed slug from settings.
   */
  slug: string | null;
  kind: AiProviderKind;
  /** Short hint shown in the dropdown. */
  hint: string;
  /**
   * Anthropic only: opt into server-side refusal fallbacks so a safety
   * decline is re-run on a sibling model inside the same request.
   */
  fallbacks?: boolean;
}

/**
 * Available reasoning backends.
 *
 * - `local`      → built-in deterministic regex parser (no network).
 * - `anthropic`  → Claude, called directly from the browser with the user's
 *                  Anthropic API key (Messages API).
 * - `openrouter` → OpenRouter (OpenAI-compatible chat completions) with the
 *                  user's OpenRouter key. Fixed Claude slugs plus a free-text
 *                  slug so any model on openrouter.ai/models can be used
 *                  without a code change.
 */
export const AI_MODELS: AiModelOption[] = [
  {
    id: 'regex',
    label: 'Regex (offline)',
    slug: null,
    kind: 'local',
    hint: 'Fast, deterministic, no API key needed',
  },

  // ── Claude direct (Anthropic API) ────────────────────────────────────────
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    slug: 'claude-opus-5',
    kind: 'anthropic',
    hint: 'Anthropic · best drafting judgement (recommended)',
    fallbacks: true,
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    slug: 'claude-sonnet-5',
    kind: 'anthropic',
    hint: 'Anthropic · fast, strong on everyday edits',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    slug: 'claude-haiku-4-5',
    kind: 'anthropic',
    hint: 'Anthropic · cheapest, simple commands',
  },

  // ── OpenRouter ───────────────────────────────────────────────────────────
  {
    id: 'or-claude-sonnet-5',
    label: 'Claude Sonnet 5 (OpenRouter)',
    slug: 'anthropic/claude-sonnet-5',
    kind: 'openrouter',
    hint: 'OpenRouter · needs an OpenRouter key',
  },
  {
    id: 'or-claude-opus-5',
    label: 'Claude Opus 5 (OpenRouter)',
    slug: 'anthropic/claude-opus-5',
    kind: 'openrouter',
    hint: 'OpenRouter · needs an OpenRouter key',
  },
  {
    id: 'or-custom',
    label: 'Custom slug (OpenRouter)',
    slug: null,
    kind: 'openrouter',
    hint: 'OpenRouter · type any model slug in settings',
  },
];

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function getModelOption(id: AiModelId): AiModelOption {
  return AI_MODELS.find(m => m.id === id) ?? AI_MODELS[0];
}

/** Human-readable provider name for consent and key-storage notices. */
export function providerLabel(kind: AiProviderKind): string {
  switch (kind) {
    case 'anthropic': return 'Anthropic';
    case 'openrouter': return 'OpenRouter';
    default: return 'CADO';
  }
}
