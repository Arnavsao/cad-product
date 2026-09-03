import { DEFAULT_LOCALE, LOCALES, findLocale, resolveLocale } from './locales';

/**
 * `resolveLocale` decides what language a first-time visitor sees, from the
 * browser's own `navigator.languages`. Getting it wrong is a bad first
 * impression that the user cannot easily explain, so the widening rules are
 * pinned here.
 */
describe('locales', () => {
  it('offers the fourteen AutoCAD languages, English first', () => {
    expect(LOCALES.length).toBe(14);
    expect(LOCALES[0].code).toBe(DEFAULT_LOCALE);
    expect(new Set(LOCALES.map((l) => l.code)).size).withContext('codes must be unique').toBe(14);
  });

  it('labels every language in itself, never in English', () => {
    // The picker is useless to a monolingual user otherwise.
    expect(findLocale('de')!.label).toBe('Deutsch');
    expect(findLocale('ja')!.label).toBe('日本語');
    expect(findLocale('ru')!.label).toBe('Русский');
  });

  it('matches an exact tag', () => {
    expect(resolveLocale('pt-BR')!.code).toBe('pt-BR');
    expect(resolveLocale('cs')!.code).toBe('cs');
  });

  it('widens a regional tag to the base language', () => {
    expect(resolveLocale('de-AT')!.code).toBe('de');
    expect(resolveLocale('fr-CA')!.code).toBe('fr');
    expect(resolveLocale('es-MX')!.code).toBe('es');
  });

  it('sends every Portuguese variant to pt-BR, the only one shipped', () => {
    // pt-PT is not a perfect fit, but it is far closer than English.
    expect(resolveLocale('pt')!.code).toBe('pt-BR');
    expect(resolveLocale('pt-PT')!.code).toBe('pt-BR');
  });

  it('routes Chinese by script, not by base language', () => {
    // The two Chinese files differ in CAD terminology, not just characters, so
    // picking the wrong one is a real error rather than a cosmetic one.
    expect(resolveLocale('zh-TW')!.code).toBe('zh-Hant');
    expect(resolveLocale('zh-HK')!.code).toBe('zh-Hant');
    expect(resolveLocale('zh-MO')!.code).toBe('zh-Hant');
    expect(resolveLocale('zh-Hant')!.code).toBe('zh-Hant');
    expect(resolveLocale('zh-CN')!.code).toBe('zh-Hans');
    expect(resolveLocale('zh')!.code).toBe('zh-Hans');
    expect(resolveLocale('zh-SG')!.code).toBe('zh-Hans');
  });

  it('is case-insensitive about the tag', () => {
    expect(resolveLocale('DE-de')!.code).toBe('de');
    expect(resolveLocale('ZH-tw')!.code).toBe('zh-Hant');
  });

  it('returns undefined for a language we do not ship', () => {
    // Deliberately not "English": callers need to tell "no match" from
    // "matched English" — onboarding uses that to decide whether to ask.
    expect(resolveLocale('sv')).toBeUndefined();
    expect(resolveLocale('ar')).toBeUndefined();
    expect(resolveLocale('')).toBeUndefined();
    expect(resolveLocale(null)).toBeUndefined();
  });

  it('ignores an unknown code rather than trusting it', () => {
    expect(findLocale('klingon')).toBeUndefined();
    expect(findLocale(undefined)).toBeUndefined();
  });
});
