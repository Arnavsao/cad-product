import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { provideI18nTesting } from '../../../testing/i18n-testing';
import { TranslatedTitleStrategy } from './translated-title.strategy';

@Component({ standalone: true, template: '' })
class Blank {}

/**
 * Route `title`s are translation keys. The default strategy would print the
 * key, and could not react to a language change at all; this one must do
 * both, and must stay out of the way of pages that set their own title.
 */
describe('TranslatedTitleStrategy', () => {
  let router: Router;
  let title: Title;
  let transloco: TranslocoService;

  beforeEach(async () => {
    // Other specs leave a language in storage; LanguageService would adopt it
    // on its first effect run and undo the switch this spec makes.
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideI18nTesting(),
        provideRouter([
          { path: 'trash', title: 'dashboard.shell.nav.trash', component: Blank },
          { path: 'editor', title: 'CADO', component: Blank },
          { path: 'site', component: Blank },
        ]),
        { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
      ],
    });
    router = TestBed.inject(Router);
    title = TestBed.inject(Title);
    transloco = TestBed.inject(TranslocoService);
    transloco.setAvailableLangs(['en', 'de']);
    await transloco.load('en').toPromise();
    TestBed.tick(); // let LanguageService's own effect settle on English first
  });

  it('resolves the key and appends the product name', async () => {
    await router.navigateByUrl('/trash');
    expect(title.getTitle()).toBe('Trash · CADO');
  });

  it('uses a key that does not resolve as a literal, so the editor keeps a bare product name', async () => {
    await router.navigateByUrl('/editor');
    expect(title.getTitle()).toBe('CADO');
  });

  it('re-translates when the language changes', async () => {
    await router.navigateByUrl('/trash');
    transloco.setTranslation({ 'dashboard.shell.nav.trash': 'Papierkorb', 'app.title.format': '{{page}} · {{appName}}' }, 'de');
    transloco.setActiveLang('de');
    TestBed.tick();
    expect(title.getTitle()).toBe('Papierkorb · CADO');
  });

  it('leaves a title the page set itself alone on a language change', async () => {
    await router.navigateByUrl('/trash');
    title.setTitle('Bridge_GAD.dxf • — CADO'); // what the editor does
    transloco.setTranslation({ 'dashboard.shell.nav.trash': 'Papierkorb' }, 'de');
    transloco.setActiveLang('de');
    TestBed.tick();
    expect(title.getTitle()).toBe('Bridge_GAD.dxf • — CADO');
  });

  it('does not touch the title on a route without one', async () => {
    await router.navigateByUrl('/trash');
    title.setTitle('Set by the site shell');
    await router.navigateByUrl('/site');
    expect(title.getTitle()).toBe('Set by the site shell');
  });
});
