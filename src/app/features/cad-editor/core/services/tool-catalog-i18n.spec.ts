import { Injectable, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Translation, TranslocoLoader, TranslocoService, provideTransloco } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { ToolCatalogService } from './tool-catalog.service';

@Injectable()
class FakeLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(lang === 'fr' ? { 'editor.tool.line.title': 'Ligne', 'editor.toolSection.draw': 'Dessin' } : {});
  }
}

/**
 * A language switch, or a language file arriving after first paint, must
 * re-translate the toolbar. Both used to be missed: titles were computed once
 * and the change-tracking read `getActiveLang()`, which is not a signal.
 */
describe('ToolCatalogService — translation revision', () => {
  let catalog: ToolCatalogService;
  let transloco: TranslocoService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideTransloco({
          config: { availableLangs: ['en', 'fr'], defaultLang: 'en', fallbackLang: 'en', reRenderOnLangChange: true },
          loader: FakeLoader,
        }),
        ToolCatalogService,
      ],
    });
    catalog = TestBed.inject(ToolCatalogService);
    transloco = TestBed.inject(TranslocoService);
  });

  it('bumps the revision when the language changes and when its file loads', (done) => {
    const before = catalog.translationRevision();
    transloco.setActiveLang('fr');
    transloco.load('fr').subscribe(() => {
      TestBed.tick();
      expect(catalog.translationRevision()).toBeGreaterThan(before);
      done();
    });
  });

  it('returns translated titles once the language file is loaded', (done) => {
    transloco.setActiveLang('fr');
    transloco.load('fr').subscribe(() => {
      const draw = catalog.getGrouped().find((s) => s.tools.some((t) => t.id === 'line'))!;
      expect(draw.label).toBe('Dessin');
      const line = draw.tools.find((t) => t.id === 'line')!;
      expect(line.title.startsWith('Ligne')).toBeTrue();
      expect(line.title).toContain('(L)');
      done();
    });
  });
});
