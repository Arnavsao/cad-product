import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../../../testing/i18n-testing';
import { LanguageService } from '../../../core/i18n/language.service';
import { LocaleDatePipe } from './locale-date.pipe';

/**
 * Dates must read in the UI language, and change with it. Angular's DatePipe
 * is fixed to LOCALE_ID at bootstrap, which is why this pipe exists.
 */
describe('LocaleDatePipe', () => {
  const date = new Date(2026, 8, 11); // 11 September 2026, local time

  let pipe: LocaleDatePipe;
  let language: LanguageService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideI18nTesting()] });
    language = TestBed.inject(LanguageService);
    language.setLocale('en');
    pipe = TestBed.runInInjectionContext(() => new LocaleDatePipe());
  });

  it('formats in the active language', () => {
    expect(pipe.transform(date, 'mediumDate')).toBe(new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date));
    language.setLocale('de');
    expect(pipe.transform(date, 'mediumDate')).toBe(new Intl.DateTimeFormat('de', { dateStyle: 'medium' }).format(date));
    expect(pipe.transform(date, 'mediumDate')).not.toBe(new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date));
  });

  it('handles the styles the templates use', () => {
    language.setLocale('ja');
    expect(pipe.transform(date, 'longDate')).toBe('2026年9月11日');
    expect(pipe.transform('2026-09', 'monthYear')).toBe('2026年9月');
  });

  it('is safe on empty and invalid input', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform('')).toBe('');
    expect(pipe.transform('not a date')).toBe('not a date');
  });
});
