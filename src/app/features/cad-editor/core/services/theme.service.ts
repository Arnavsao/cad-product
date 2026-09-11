import { Injectable, computed, effect, signal } from '@angular/core';

import {
  CAD_THEMES,
  CadThemeKind,
  DEFAULT_THEME_ID,
  ICadCanvasPalette,
  ICadTheme,
  PREVIOUS_DEFAULT_DARK_THEME_ID,
  findTheme,
} from './theme-registry';

export type { ICadCanvasPalette, ICadTheme, CadThemeKind } from './theme-registry';
export { CAD_THEMES } from './theme-registry';

/** Kept as the historical name for a theme's ground; identical to CadThemeKind. */
export type CadThemeMode = CadThemeKind;

/** Active theme id. */
const STORAGE_KEY = 'cad.theme';
/** Which account the remembered theme belongs to. @see ThemeService.applyRemote */
const OWNER_KEY = 'cad.theme.owner';
/** Ground only ('dark' | 'light') — read by index.html before first paint and
 *  by any host application that embeds the editor. */
const LEGACY_KEY = 'theme';
/** Last theme chosen per ground, so the header toggle returns to it. */
const PREFERRED_KEY: Record<CadThemeKind, string> = {
  dark: 'cad.theme.dark',
  light: 'cad.theme.light',
};
/** Resolved background of the active theme, so the pre-paint script in
 *  index.html can match it and avoid a flash of the wrong colour. */
const BG_KEY = 'cad.theme.bg';
/** Resolved accent, for the same reason: the boot splash's mark is drawn in it. */
const ACCENT_KEY = 'cad.theme.accent';
/** Marker for the one-time move off the previous dark default (see `migrate`). */
const MIGRATION_KEY = 'cad.theme.migrated.monokai';

const FALLBACK: ICadTheme = findTheme(DEFAULT_THEME_ID.dark) ?? CAD_THEMES[0];

/**
 * Module-level cache of the active palette so non-DI consumers (entity
 * draw() methods, exporters) can resolve theme-aware colors without an
 * injector. Kept in sync by ThemeService's effect().
 */
let _activeTheme: ICadTheme = FALLBACK;

/** Read the active palette from non-DI code (entity draw methods, etc). */
export function getActiveCanvasPalette(): ICadCanvasPalette {
  return _activeTheme.canvas;
}

/** Returns true if the editor is currently on a light ground. */
export function isLightTheme(): boolean {
  return _activeTheme.kind === 'light';
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* SSR or storage-disabled environments — ignore. */
  }
}

/**
 * One-time move off the superseded dark default.
 *
 * The active theme is persisted on every `applyToDocument`, so a returning user
 * who never opened the picker still has the OLD default written to storage —
 * which wins over `DEFAULT_THEME_ID` and would keep them on it forever. This
 * rewrites only the keys still holding that exact id, then drops a marker so it
 * never runs twice and never overrides a later deliberate choice.
 *
 * Accepted trade-off: a stored value cannot distinguish "chose CAD Dark" from
 * "was given CAD Dark", so someone who deliberately picked the old default is
 * moved once. Re-picking it sticks, because the marker is already set.
 */
function migrateDarkDefault(): void {
  if (readStorage(MIGRATION_KEY)) return;
  // Written first: if any step below throws (quota, disabled storage), the
  // migration is still not retried on the next boot — one attempt is the point.
  writeStorage(MIGRATION_KEY, '1');

  const next = findTheme(DEFAULT_THEME_ID.dark);
  if (!next) return;
  for (const key of [STORAGE_KEY, PREFERRED_KEY.dark]) {
    if (readStorage(key) === PREVIOUS_DEFAULT_DARK_THEME_ID) {
      writeStorage(key, next.id);
      // Keep the pre-paint background in step, or the first frame flashes the
      // old colour before Angular boots and applies the theme.
      writeStorage(BG_KEY, next.canvas.canvasBg);
    }
  }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** Every selectable theme, in picker order. */
  readonly themes = CAD_THEMES;

  /** Id of the active theme. */
  readonly themeId = signal<string>(this.loadInitial().id);

  /** The active theme. */
  readonly theme = computed<ICadTheme>(() => findTheme(this.themeId()) ?? FALLBACK);

  /** Ground of the active theme. Read by the canvas and the root element. */
  readonly mode = computed<CadThemeMode>(() => this.theme().kind);

  readonly canvas = computed<ICadCanvasPalette>(() => this.theme().canvas);

  readonly isLight = computed(() => this.mode() === 'light');

  /** Bumped on every theme change so canvas code can invalidate caches. */
  readonly revision = computed(() => this.themeId());

  constructor() {
    // Push the active theme onto the document: CSS custom properties for the
    // chrome, the `dark-theme` class the app shell styles key off, and the
    // `data-cad-theme` attribute read by cad-editor.scss. The attribute goes on
    // the document element (not just .cad-editor-root) because dialogs and
    // overlays sometimes render outside the editor root via portals.
    effect(() => {
      const theme = this.theme();
      _activeTheme = theme;
      this.applyToDocument(theme);
    });

    // Follow theme changes made in another tab.
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && e.newValue && findTheme(e.newValue)) {
        this.themeId.set(e.newValue);
      } else if (e.key === LEGACY_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        this.setMode(e.newValue);
      }
    });

    // A host application embedding the editor may toggle `dark-theme` on <body>
    // itself; mirror that onto the matching theme.
    const observer = new MutationObserver(() => {
      const kind: CadThemeKind = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
      if (kind !== this.mode()) this.setMode(kind);
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  /**
   * Whether the active theme reflects a deliberate choice rather than a
   * default, in which case the account's stored value must not override it.
   *
   * Seeded from `localStorage` for the same reason as the language: a value
   * there was written by this person picking a theme in this browser, so a
   * reload must not let a stale `/me` answer undo it.
   */
  private chosen = !!findTheme(readStorage(STORAGE_KEY));

  /**
   * Select a theme by id. Unknown ids are ignored.
   *
   * This is the *user's own* choice. A value arriving from `/me` must go
   * through {@link applyRemote}.
   */
  setTheme(id: string): void {
    this.chosen = true;
    if (!findTheme(id) || id === this.themeId()) return;
    this.themeId.set(id);
  }

  /**
   * Apply the theme the account is stored with, unless the person has already
   * picked one in this browser.
   *
   * The same staleness problem as the language: `/me` echoes the full
   * preferences object and can answer after the user has changed the theme,
   * which would snap it back to whatever the account last saved. And the same
   * account rule: a *different* account signing in on this browser gets its
   * own stored theme, because the remembered pick was someone else's.
   */
  applyRemote(id: string | null | undefined, owner?: string | null): void {
    if (owner) {
      const previous = readStorage(OWNER_KEY);
      if (previous !== owner) {
        if (previous) this.chosen = false;
        try {
          localStorage.setItem(OWNER_KEY, owner);
        } catch {
          /* storage-disabled */
        }
      }
    }
    if (!id || this.chosen) return;
    if (!findTheme(id) || id === this.themeId()) return;
    this.themeId.set(id);
  }

  /** Switch ground, returning to the last theme chosen for it. */
  setMode(mode: CadThemeMode): void {
    if (mode === this.mode()) return;
    const preferred = findTheme(readStorage(PREFERRED_KEY[mode])) ?? findTheme(DEFAULT_THEME_ID[mode]);
    if (preferred) this.themeId.set(preferred.id);
  }

  /** Flip between the last-used dark and light theme. */
  toggle(): void {
    this.setMode(this.mode() === 'dark' ? 'light' : 'dark');
  }

  /** @deprecated Use {@link setMode}; kept for callers that predate themes. */
  set(mode: CadThemeMode): void {
    this.setMode(mode);
  }

  private applyToDocument(theme: ICadTheme): void {
    try {
      const body = document.body;
      // Set on <body> rather than :root so these win over the static
      // `.dark-theme` block in theme.scss without needing !important.
      for (const [prop, value] of Object.entries(theme.ui)) {
        body.style.setProperty(prop, value);
      }
      body.classList.toggle('dark-theme', theme.kind === 'dark');
      document.documentElement.setAttribute('data-cad-theme', theme.kind);
      document.documentElement.style.colorScheme = theme.kind;

      localStorage.setItem(STORAGE_KEY, theme.id);
      localStorage.setItem(LEGACY_KEY, theme.kind);
      localStorage.setItem(PREFERRED_KEY[theme.kind], theme.id);
      localStorage.setItem(BG_KEY, theme.canvas.canvasBg);
      localStorage.setItem(ACCENT_KEY, theme.ui['--color-primary'] ?? '');
    } catch {
      /* SSR or storage-disabled environments — ignore. */
    }
  }

  private loadInitial(): ICadTheme {
    // Before the first read: the migration rewrites the very keys we are about
    // to consult.
    migrateDarkDefault();

    const saved = findTheme(readStorage(STORAGE_KEY));
    if (saved) {
      _activeTheme = saved;
      return saved;
    }
    // Fall back to the ground recorded by an older build or by a host app.
    const legacy = readStorage(LEGACY_KEY);
    const kind: CadThemeKind = legacy === 'light' ? 'light' : 'dark';
    const theme = findTheme(DEFAULT_THEME_ID[kind]) ?? FALLBACK;
    _activeTheme = theme;
    return theme;
  }
}
