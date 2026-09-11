import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { provideI18nTesting } from '../../../testing/i18n-testing';
import { ThemeService } from '../../features/cad-editor/core/services/theme.service';
import { LanguageService } from '../i18n/language.service';
import { MeService } from './me.service';

const preferences = (locale: string, theme = 'monokai') => ({
  units: 'mm', theme, locale, role: null, defaultTemplate: 'blank',
  autosaveIntervalSec: 30, uiState: null, emailOnShare: true, emailOnOrgActivity: true,
});

const meDto = (locale: string, theme?: string) => ({
  id: 'u1', email: 'a@b.c', name: 'A', avatarUrl: null, onboarded: true,
  preferences: preferences(locale, theme),
  billing: { plan: 'free', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, manageable: false },
  workspaces: [], usage: null,
});

/**
 * A preference the user changes must not be undone by a server answer that was
 * already in flight when they changed it.
 *
 * The settings page asks for `/me` as it opens and `PATCH /me/preferences`
 * echoes the whole object back, so both can resolve *after* the picker has
 * moved on. Feeding either straight into the setters made the language snap
 * back to whatever the account last stored — reported as "I select a language
 * and it goes back to English". `applyRemote` is what keeps the newer local
 * choice, and these tests are what stop that regressing.
 */
describe('a stale preferences response never overrules a newer choice', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18nTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('keeps a language picked while /me was still loading', async () => {
    const me = TestBed.inject(MeService);
    const language = TestBed.inject(LanguageService);

    const loading = me.load();
    language.setLocale('de');

    http.expectOne(`${environment.apiUrl}/me`).flush({ data: meDto('en') });
    await loading;

    expect(language.localeCode()).toBe('de');
  });

  it('keeps a language picked while the save of the previous one was in flight', async () => {
    const me = TestBed.inject(MeService);
    const language = TestBed.inject(LanguageService);

    const saving = me.updatePreferences({ locale: 'de' });
    language.setLocale('de');
    language.setLocale('ja');

    http.expectOne(`${environment.apiUrl}/me/preferences`).flush({ data: preferences('de') });
    await saving;

    expect(language.localeCode()).toBe('ja');
  });

  it('keeps a theme picked while /me was still loading', async () => {
    const me = TestBed.inject(MeService);
    const theme = TestBed.inject(ThemeService);

    const loading = me.load();
    const picked = theme.themes.find((t) => t.id !== theme.themeId())!.id;
    theme.setTheme(picked);

    http.expectOne(`${environment.apiUrl}/me`).flush({ data: meDto('en', 'monokai') });
    await loading;

    expect(theme.themeId()).toBe(picked);
  });

  it('keeps the language this browser last used across a reload', async () => {
    // A reload starts a fresh service whose only memory of the choice is
    // localStorage. If the account still holds the old locale — a failed save,
    // or a row written before the server persisted `locale` at all — `/me`
    // must not undo what this browser already knows.
    localStorage.setItem('cad.locale', 'de');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18nTesting(),
      ],
    });
    const localHttp = TestBed.inject(HttpTestingController);
    const me = TestBed.inject(MeService);
    const language = TestBed.inject(LanguageService);
    expect(language.localeCode()).toBe('de');

    const loading = me.load();
    localHttp.expectOne(`${environment.apiUrl}/me`).flush({ data: meDto('en') });
    await loading;

    expect(language.localeCode()).toBe('de');
    localHttp.verify();
  });

  it('still applies the account language when the user has chosen nothing', async () => {
    const me = TestBed.inject(MeService);
    const language = TestBed.inject(LanguageService);

    const loading = me.load();
    http.expectOne(`${environment.apiUrl}/me`).flush({ data: meDto('fr') });
    await loading;

    expect(language.localeCode()).toBe('fr');
  });
});
