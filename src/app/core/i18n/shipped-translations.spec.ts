import cs from '../../../../public/i18n/cs.json';
import de from '../../../../public/i18n/de.json';
import en from '../../../../public/i18n/en.json';
import es from '../../../../public/i18n/es.json';
import fr from '../../../../public/i18n/fr.json';
import hu from '../../../../public/i18n/hu.json';
// `it` would shadow Jasmine's `it`, so the Italian bundle is aliased.
import itIT from '../../../../public/i18n/it.json';
import ja from '../../../../public/i18n/ja.json';
import ko from '../../../../public/i18n/ko.json';
import pl from '../../../../public/i18n/pl.json';
import ptBR from '../../../../public/i18n/pt-BR.json';
import ru from '../../../../public/i18n/ru.json';
import zhHans from '../../../../public/i18n/zh-Hans.json';
import zhHant from '../../../../public/i18n/zh-Hant.json';
import { LOCALES } from './locales';

type Bundle = Record<string, string>;
const FILES: Record<string, Bundle> = {
  cs, de, en, es, fr, hu, it: itIT, ja, ko, pl, 'pt-BR': ptBR, ru, 'zh-Hans': zhHans, 'zh-Hant': zhHant,
};

const params = (s: string) =>
  (String(s).match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).map((p) => p.replace(/[{}\s]/g, '')).sort().join(',');
const tags = (s: string) => (String(s).match(/<[^>]+>/g) ?? []).join('');

/**
 * The shipped translation files, checked as data.
 *
 * `scripts/i18n/validate.mjs` covers the same ground in CI, but only when
 * someone runs it. These assertions fail the ordinary test run, which is what
 * catches a hand-edited JSON file before it reaches a user. A broken
 * placeholder renders as literal `{{count}}` on screen; a dropped `<strong>`
 * silently loses emphasis or, worse, leaves an unclosed tag.
 */
describe('shipped translation files', () => {
  it('ships a file for every language the picker offers', () => {
    expect(Object.keys(FILES).sort()).toEqual(LOCALES.map((l) => l.code).sort());
  });

  for (const [lang, bundle] of Object.entries(FILES)) {
    describe(lang, () => {
      it('has no empty values', () => {
        expect(Object.entries(bundle).filter(([, v]) => !String(v).trim()).map(([k]) => k)).toEqual([]);
      });

      it('has no value that is still a translation key', () => {
        const keyish = Object.entries(bundle)
          .filter(([, v]) => /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+){2,}$/.test(String(v)))
          .map(([k]) => k);
        expect(keyish).toEqual([]);
      });

      it('keeps every {{placeholder}} the English has', () => {
        const bad = Object.keys(bundle)
          .filter((k) => k in en && params(bundle[k]) !== params((en as Bundle)[k]))
          .map((k) => `${k}: en=${params((en as Bundle)[k])} ${lang}=${params(bundle[k])}`);
        expect(bad).toEqual([]);
      });

      it('keeps the English HTML markup', () => {
        const bad = Object.keys(bundle).filter((k) => k in en && tags(bundle[k]) !== tags((en as Bundle)[k]));
        expect(bad).toEqual([]);
      });

      it('claims no key that English does not define', () => {
        expect(Object.keys(bundle).filter((k) => !(k in en))).toEqual([]);
      });
    });
  }
});
