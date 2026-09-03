import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LOCALES, UpdatePreferencesDto } from './dto/preferences.dto';
import { localeToWire } from './users.mapper';
import { LOCALES as CLIENT_LOCALES } from '../../../src/app/core/i18n/locales';

/**
 * Guards the one piece of the i18n design with no other safety net.
 *
 * The shipped-language list exists twice: `src/app/core/i18n/locales.ts` is the
 * source of truth for what the picker offers, and `LOCALES` here is the
 * server-side write guard. `npm run i18n:validate` checks the client list
 * against the translation files, but nothing checked the two *lists* against
 * each other -- so adding a 15th language to the frontend alone would leave the
 * server rejecting it with a 400 that points nowhere near the cause.
 */
describe('locale registry', () => {
  it('stays in step with the client registry', () => {
    expect([...LOCALES].sort()).toEqual([...CLIENT_LOCALES.map((l) => l.code)].sort());
  });

  it('accepts every shipped locale on write', async () => {
    for (const locale of LOCALES) {
      const errors = await validate(plainToInstance(UpdatePreferencesDto, { locale }));
      expect({ locale, count: errors.length }).toEqual({ locale, count: 0 });
    }
  });

  it('rejects a locale the app cannot load', async () => {
    const errors = await validate(plainToInstance(UpdatePreferencesDto, { locale: 'klingon' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('degrades an unrecognised stored value to English instead of failing /me', () => {
    expect(localeToWire('klingon')).toBe('en');
    expect(localeToWire(null)).toBe('en');
    expect(localeToWire(undefined)).toBe('en');
    expect(localeToWire('ja')).toBe('ja');
  });
});
