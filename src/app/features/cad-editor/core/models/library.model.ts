/**
 * CAD Asset Library — data model.
 *
 * ILibraryItem stores serialized entity data (plain JSON objects) rather than
 * rendered images. When inserted, entities are re-hydrated into live class
 * instances with fresh IDs so every insertion is independent.
 *
 * The thumbnail is a data-URI (base64 PNG, 80×80) generated at save time by
 * rendering the entities on an off-screen canvas. It is stored for display
 * only — the actual editable data comes from `entities`.
 */

export interface ILibraryItem {
  /** Unique identifier (crypto.randomUUID or Math.random fallback). */
  id: string;
  name: string;
  category: string;
  description?: string;
  tags: string[];
  /** data-URI base64 PNG thumbnail (80×80 px). */
  thumbnail: string;
  /** JSON-serialized plain entity objects (type + all fields). */
  entities: Record<string, unknown>[];
  /** Snapshot of layer definitions referenced by the entities. */
  layerDefs: Array<{ name: string; color: string; lineType: string }>;
  createdAt: number;
  lastUsedAt: number;
}

export interface ILibraryCategory {
  name: string;
  /** Single emoji or short label used as icon in the filter pill. */
  icon: string;
  isBuiltIn: boolean;
}

export const DEFAULT_CATEGORIES: ILibraryCategory[] = [
  { name: 'Symbols', icon: '◉', isBuiltIn: true },
  { name: 'Annotations', icon: 'T', isBuiltIn: true },
  { name: 'Tables', icon: '⊞', isBuiltIn: true },
  { name: 'Title Blocks', icon: '▦', isBuiltIn: true },
  { name: 'Road Elements', icon: '⊏', isBuiltIn: true },
  { name: 'Bridge Elements', icon: '⊍', isBuiltIn: true },
  { name: 'Railway Elements', icon: '⊟', isBuiltIn: true },
  { name: 'Favorites', icon: '★', isBuiltIn: true },
  { name: 'Custom', icon: '⊕', isBuiltIn: false },
];

/** Generate a simple UUID-like id without crypto dependency. */
export function generateLibraryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'lib_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}
