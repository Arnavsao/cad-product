import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';
import { DEFAULT_THEME_ID, findTheme } from './theme-registry';

/** Keys ThemeService owns; cleared between tests so each starts cold. */
const KEYS = ['cad.theme', 'theme', 'cad.theme.dark', 'cad.theme.light', 'cad.theme.bg', 'cad.theme.migrated.monokai'];

/** A fresh service, since the initial theme is resolved in a field initializer. */
function build(): ThemeService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ThemeService] });
  return TestBed.inject(ThemeService);
}

describe('ThemeService', () => {
  beforeEach(() => KEYS.forEach((k) => localStorage.removeItem(k)));
  afterAll(() => KEYS.forEach((k) => localStorage.removeItem(k)));

  it('defaults the dark ground to Monokai', () => {
    expect(DEFAULT_THEME_ID.dark).toBe('monokai');
    expect(findTheme('monokai')?.kind).toBe('dark');
  });

  it('boots a first-time visitor on the default dark theme', () => {
    expect(build().themeId()).toBe('monokai');
  });

  // ── one-time migration off the previous dark default ───────────────────────

  it('moves a user still on the old dark default onto Monokai', () => {
    localStorage.setItem('cad.theme', 'cad-dark');
    localStorage.setItem('cad.theme.dark', 'cad-dark');

    expect(build().themeId()).toBe('monokai');
    // The per-ground preference must move too, or the header toggle would come
    // straight back to the old theme.
    expect(localStorage.getItem('cad.theme.dark')).toBe('monokai');
  });

  it('updates the pre-paint background so the first frame is not the old colour', () => {
    localStorage.setItem('cad.theme', 'cad-dark');
    localStorage.setItem('cad.theme.bg', '#181c22');

    build();
    expect(localStorage.getItem('cad.theme.bg')).toBe(findTheme('monokai')!.canvas.canvasBg);
  });

  it('leaves a user who picked a different theme alone', () => {
    localStorage.setItem('cad.theme', 'abyss');
    localStorage.setItem('cad.theme.dark', 'abyss');

    expect(build().themeId()).toBe('abyss');
    expect(localStorage.getItem('cad.theme.dark')).toBe('abyss');
  });

  it('does not touch a light-theme choice', () => {
    localStorage.setItem('cad.theme', 'cad-light');

    expect(build().themeId()).toBe('cad-light');
  });

  it('runs only once — re-picking the old theme afterwards sticks', async () => {
    localStorage.setItem('cad.theme', 'cad-dark');
    build();
    expect(localStorage.getItem('cad.theme')).toBe('monokai');

    // The user deliberately goes back to CAD Dark; a second boot must respect it.
    const service = build();
    service.setTheme('cad-dark');
    expect(service.themeId()).toBe('cad-dark');
    // The choice is persisted by an effect, which has to flush before the next
    // instance reads storage.
    await TestBed.inject(ApplicationRef).whenStable();
    expect(build().themeId()).toBe('cad-dark');
  });

  it('marks the migration done even for a user who had nothing stored', () => {
    build();
    expect(localStorage.getItem('cad.theme.migrated.monokai')).toBe('1');
  });

  // ── unrelated behaviour that the migration must not disturb ────────────────

  it('ignores an unknown theme id', () => {
    const service = build();
    service.setTheme('no-such-theme');
    expect(service.themeId()).toBe('monokai');
  });

  it('returns to the last chosen theme for a ground', async () => {
    const service = build();
    service.setTheme('abyss');
    // `setMode` reads the per-ground preference out of storage, which the
    // persisting effect has to have written first.
    await TestBed.inject(ApplicationRef).whenStable();
    service.setMode('light');
    expect(service.mode()).toBe('light');
    service.setMode('dark');
    expect(service.themeId()).toBe('abyss');
  });
});
