import { Injectable, signal } from '@angular/core';

const MAX = 8;
const STORAGE_KEY = 'cad.recentColors.v1';

/**
 * Holds the last few colors any ColorPicker instance has committed so that
 * all pickers in the app show a consistent "recent" row. Persisted to
 * localStorage so the list survives page reloads.
 */
@Injectable({ providedIn: 'root' })
export class RecentColorsService {
  /** Most-recent-first list of canonical `#rrggbb` hex strings. */
  readonly colors = signal<string[]>(this._load());

  /** Record `hex` as the most recently used color. Duplicates are pulled
   *  to the front rather than appended again. */
  push(hex: string): void {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    const lower = hex.toLowerCase();
    const next = [lower, ...this.colors().filter((c) => c.toLowerCase() !== lower)].slice(0, MAX);
    this.colors.set(next);
    this._save(next);
  }

  private _load(): string[] {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, MAX);
    } catch {
      return [];
    }
  }

  private _save(list: string[]): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // localStorage may be unavailable (private mode, quota); swallow.
    }
  }
}
