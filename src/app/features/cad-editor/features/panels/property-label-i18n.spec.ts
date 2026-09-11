import { Injectable, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Translation, TranslocoLoader, provideTransloco } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { injectTranslocoOptional, translateOr } from '../../../../core/i18n/translate-or';
import { PROPERTY_CATEGORY_KEYS, PROPERTY_LABEL_KEYS } from './property-label-keys';
import en from '../../../../../../public/i18n/en.json';

@Injectable()
class FrenchLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(lang === 'fr' ? { 'editor.ui.props.label.layer': 'Calque' } : {});
  }
}

/**
 * The Properties palette shows AutoCAD's own property names, and the editor is
 * embeddable in a host that never calls `provideI18n()`. Both paths matter:
 * with a provider the drafter gets their language, without one they must still
 * get English rather than a raw key.
 */
describe('Properties palette labels', () => {
  it('maps every label and category key to English text in en.json', () => {
    const strings = en as Record<string, string>;
    const missing = [...Object.values(PROPERTY_LABEL_KEYS), ...Object.values(PROPERTY_CATEGORY_KEYS)]
      .filter((key) => !strings[key]);
    expect(missing).toEqual([]);
  });

  it('keeps the English label as the key’s own text', () => {
    const strings = en as Record<string, string>;
    for (const [english, key] of Object.entries(PROPERTY_LABEL_KEYS)) {
      expect(strings[key]).toBe(english);
    }
  });

  describe('without a Transloco provider', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    });

    it('resolves the service to null instead of throwing', () => {
      // TranslocoService is providedIn:'root', so a plain
      // inject(..., { optional: true }) would construct it here and throw
      // NG0201 on TRANSLOCO_TRANSPILER. The helper must absorb that.
      const transloco = TestBed.runInInjectionContext(() => injectTranslocoOptional());
      expect(transloco).toBeNull();
    });

    it('falls back to the English label', () => {
      const transloco = TestBed.runInInjectionContext(() => injectTranslocoOptional());
      expect(translateOr(transloco, PROPERTY_LABEL_KEYS['Layer'], 'Layer')).toBe('Layer');
    });
  });

  describe('with a Transloco provider', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          provideTransloco({
            config: { availableLangs: ['en', 'fr'], defaultLang: 'fr', fallbackLang: 'fr', reRenderOnLangChange: true },
            loader: FrenchLoader,
          }),
        ],
      });
    });

    it('translates the label', (done) => {
      const transloco = TestBed.runInInjectionContext(() => injectTranslocoOptional())!;
      transloco.load('fr').subscribe(() => {
        expect(translateOr(transloco, PROPERTY_LABEL_KEYS['Layer'], 'Layer')).toBe('Calque');
        done();
      });
    });
  });
});
