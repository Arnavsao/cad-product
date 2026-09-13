/**
 * Every feature flag that exists, with its default.
 *
 * **Code is the source of truth for which keys exist**; the `feature_flags`
 * table only records deviations from the defaults below. That ordering is
 * deliberate: a flag read by code that nobody has ever written still has a
 * defined value, a typo in the admin UI cannot invent a key that silently
 * nothing reads, and deleting a row is a clean "back to default" rather than a
 * hole.
 *
 * `internal: true` keeps a flag's payload out of the public `GET /flags`
 * response. The enabled/disabled bit is still published for internal flags that
 * the client must act on; a flag whose very existence should not be public
 * simply is not read by the client.
 */
export interface FlagDefinition {
  /** What this switches, in staff-facing words. */
  description: string;
  /** Value when no row exists. */
  enabled: boolean;
  /** Default structured payload, if the flag carries one. */
  payload?: Record<string, unknown> | null;
  /** Suppress `payload` in the public response. */
  internal?: boolean;
  /** Grouping in the admin UI. */
  group: 'access' | 'features' | 'limits' | 'messaging' | 'billing' | 'privacy';
}

export const FLAG_REGISTRY = {
  'signups.enabled': {
    description: 'Allow new accounts. When off, an unknown Supabase user is refused at first request.',
    enabled: true,
    group: 'access',
  },
  'ai.enabled': {
    description: 'Show the AI drafting assistant in the editor.',
    enabled: true,
    group: 'features',
  },
  'uploads.enabled': {
    description: 'Allow DXF/DWG uploads and imports.',
    enabled: true,
    group: 'features',
  },
  'dwg.storage.enabled': {
    description: 'Allow DWG files to be stored and downloaded (they still cannot be opened).',
    enabled: true,
    group: 'features',
  },
  'uploads.maxBytes': {
    description: 'Lower the upload size limit below MAX_UPLOAD_BYTES. Payload: { "bytes": 52428800 }.',
    enabled: false,
    payload: { bytes: 52_428_800 },
    group: 'limits',
  },
  'maintenance.banner': {
    description: 'Site-wide banner. Payload: { "text": "...", "level": "info" | "warn" }.',
    enabled: false,
    payload: { text: '', level: 'info' },
    group: 'messaging',
  },
  'billing.enforceQuotas': {
    description:
      'Enforce the published plan limits (Free: 3 drawings, 50 MB). OFF by default — turning it on ' +
      'changes behaviour for accounts already over the limit, so decide deliberately.',
    enabled: false,
    group: 'billing',
  },
  'billing.checkout.enabled': {
    description: 'Offer paid checkout on the pricing page.',
    enabled: true,
    group: 'billing',
  },
  'drawings.adminDownload': {
    description:
      'Let an OWNER download a user drawing for support. Off by default: staff do not read customer drawings.',
    enabled: false,
    internal: true,
    group: 'privacy',
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAG_REGISTRY;

export const FLAG_KEYS = Object.keys(FLAG_REGISTRY) as FlagKey[];

/**
 * One registry entry, widened back to `FlagDefinition`.
 *
 * `as const satisfies` above gives us the exact key union (worth a lot: every
 * read is checked against the real list) at the cost of narrowing each value to
 * its own literal shape, where the optional `payload`/`internal` simply do not
 * exist on entries that omit them. Reading through here restores the declared
 * interface, so callers see the optional fields.
 */
export function flagDefinition(key: FlagKey): FlagDefinition {
  return FLAG_REGISTRY[key] as FlagDefinition;
}

export function isFlagKey(key: string): key is FlagKey {
  return Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, key);
}

/** The effective value of one flag, as both the client and the portal see it. */
export interface FlagState {
  key: FlagKey;
  enabled: boolean;
  payload: Record<string, unknown> | null;
}

/** Effective map, keyed by flag. */
export type FlagMap = Record<FlagKey, FlagState>;

/** The registry's own defaults, before any override. */
export function defaultFlags(): FlagMap {
  const out = {} as FlagMap;
  for (const key of FLAG_KEYS) {
    const def = flagDefinition(key);
    out[key] = { key, enabled: def.enabled, payload: def.payload ?? null };
  }
  return out;
}
