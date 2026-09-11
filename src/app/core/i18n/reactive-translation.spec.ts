import { computed, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideI18nTesting } from '../../../testing/i18n-testing';
import { LanguageService } from './language.service';
import { injectTranslateFn } from './translate-fn';

/**
 * Text resolved in TypeScript — menus, placeholders, an owner's display name,
 * the browser tab — used to freeze in whatever language was active when it was
 * first computed. `revision` and `t` are what a `computed()` reads to follow a
 * switch. These tests pin that a switch, and the later arrival of the file,
 * both re-run such a computed.
 */
describe('reactive code-side translation', () => {
  let language: LanguageService;
  let transloco: TranslocoService;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideI18nTesting()] });
    language = TestBed.inject(LanguageService);
    transloco = TestBed.inject(TranslocoService);
    // The testing provider declares only English; the languages these tests
    // switch to have to be declared or Transloco reads "de.x" as a scope.
    transloco.setAvailableLangs(['en', 'de', 'fr']);
    await transloco.load('en').toPromise();
  });

  it('a computed built on language.t() follows a language switch', () => {
    const label = computed(() => language.t()('dashboard.shell.nav.trash'));
    expect(label()).toBe('Trash');

    transloco.setTranslation({ 'dashboard.shell.nav.trash': 'Papierkorb' }, 'de');
    language.setLocale('de');
    TestBed.tick();
    expect(label()).toBe('Papierkorb');
  });

  it('a computed built on injectTranslateFn() re-runs when the file arrives after the switch', () => {
    const t = TestBed.runInInjectionContext(() => injectTranslateFn());
    const label = computed(() => t()('dashboard.shell.nav.trash'));
    expect(label()).toBe('Trash');

    language.setLocale('fr');        // switch first: fr.json is not loaded yet in this test
    TestBed.tick();
    expect(label()).not.toBe('Corbeille');

    transloco.setTranslation({ 'dashboard.shell.nav.trash': 'Corbeille' }, 'fr'); // the file lands
    TestBed.tick();
    expect(label()).toBe('Corbeille');
  });

  it('revision counts both events', () => {
    const start = language.revision();
    language.setLocale('de');
    TestBed.tick();
    expect(language.revision()).toBeGreaterThan(start);
  });
});
