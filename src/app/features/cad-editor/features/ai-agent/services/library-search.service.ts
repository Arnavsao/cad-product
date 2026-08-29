import { Injectable, inject } from '@angular/core';
import { LibraryService } from '../../../core/services/library.service';
import type { ILibraryItem } from '../../../core/models/library.model';
import { COMPONENT_FAMILIES, type ComponentFamily } from '../models/component-family.model';

export interface LibrarySearchResult {
  kind: 'library';
  item: ILibraryItem;
  score: number;
}

export interface FamilySearchResult {
  kind: 'parametric';
  family: ComponentFamily;
  score: number;
}

export type ComponentSearchResult = LibrarySearchResult | FamilySearchResult;

/**
 * LibrarySearchService — two-stage retrieval.
 *
 * Stage 1 (lexical): score = sum of (matchedChars / queryLen) for each token
 *   found in the item's name + tags + keywords (case-insensitive, partial).
 * Stage 2 (parametric families): same scoring against COMPONENT_FAMILIES.keywords.
 *
 * Returns ranked results so the AI tool can present the top match or
 * ask for disambiguation when scores are close.
 */
@Injectable({ providedIn: 'root' })
export class LibrarySearchService {
  private lib = inject(LibraryService);

  /**
   * Search both the user library and parametric families.
   * Returns results sorted by descending score, with score > 0 only.
   */
  search(query: string, limit = 5): ComponentSearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const libResults = this._searchLibrary(q);
    const famResults = this._searchFamilies(q);

    const combined: ComponentSearchResult[] = [
      ...libResults.map(r => ({ kind: 'library' as const, ...r })),
      ...famResults.map(r => ({ kind: 'parametric' as const, ...r })),
    ];

    return combined
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Top-1 result if score is above the high-confidence threshold. */
  findBest(query: string): ComponentSearchResult | null {
    const results = this.search(query, 1);
    if (!results.length || results[0].score < 0.35) return null;
    return results[0];
  }

  private _searchLibrary(q: string): { item: ILibraryItem; score: number }[] {
    return this.lib.items()
      .map(item => {
        const haystack = [item.name, item.category, ...item.tags].join(' ').toLowerCase();
        return { item, score: this._scoreToken(q, haystack) };
      })
      .filter(r => r.score > 0);
  }

  private _searchFamilies(q: string): { family: ComponentFamily; score: number }[] {
    return COMPONENT_FAMILIES.map(fam => {
      const haystack = [fam.name, fam.category, fam.description, ...fam.keywords].join(' ').toLowerCase();
      return { family: fam, score: this._scoreToken(q, haystack) };
    }).filter(r => r.score > 0);
  }

  /**
   * Token-based score: split query into words, check substring presence in haystack.
   * Score = avg(per-token match weight), where longer token matches score higher.
   */
  private _scoreToken(query: string, haystack: string): number {
    // Direct full-phrase bonus
    if (haystack.includes(query)) return 1.0;

    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.length) return 0;

    let total = 0;
    for (const tok of tokens) {
      if (haystack.includes(tok)) {
        total += tok.length / query.length;
      }
    }
    return total;
  }
}
