import { TranslocoService } from '@jsverse/transloco';
import { translateOr } from './translate-or';

/**
 * `translateOr` is what keeps the editor usable when a translation is absent.
 * The registries hold their English in TypeScript rather than in `en.json`, so
 * this is the only thing standing between a missing key and a drafter seeing
 * `editor.cmd.fillet.radius.message` mid-command.
 */
describe('translateOr', () => {
  const fake = (result: string): TranslocoService => ({ translate: () => result }) as unknown as TranslocoService;

  it('returns the translation when one exists', () => {
    expect(translateOr(fake('Rayon'), 'editor.cmd.x.y.opt.R.label', 'Radius')).toBe('Rayon');
  });

  it('falls back to English when Transloco echoes the key back', () => {
    const key = 'editor.cmd.x.y.opt.R.label';
    expect(translateOr(fake(key), key, 'Radius')).toBe('Radius');
  });

  it('falls back to English on an empty translation', () => {
    expect(translateOr(fake(''), 'some.key', 'Radius')).toBe('Radius');
  });

  it('falls back to English with no Transloco at all', () => {
    // Embedded hosts may never call provideI18n(); specs inject these services
    // without a Transloco provider. Both must render English, not throw.
    expect(translateOr(null, 'some.key', 'Radius')).toBe('Radius');
    expect(translateOr(undefined, 'some.key', 'Radius')).toBe('Radius');
  });

  it('returns empty for empty English without consulting Transloco', () => {
    const spy = jasmine.createSpyObj<TranslocoService>('TranslocoService', ['translate']);
    expect(translateOr(spy, 'some.key', '')).toBe('');
    expect(spy.translate).not.toHaveBeenCalled();
  });
});
