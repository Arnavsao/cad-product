import { Pipe, PipeTransform, inject } from '@angular/core';
import { LanguageService } from '../../../core/i18n/language.service';

/**
 * The named styles Angular's `DatePipe` offers, plus `monthYear` for a date
 * that has no day. Mapped to `Intl.DateTimeFormat` options, which need no
 * per-locale data shipped in the bundle.
 */
export type LocaleDateStyle = 'shortDate' | 'mediumDate' | 'longDate' | 'fullDate' | 'short' | 'medium' | 'monthYear';

const STYLES: Record<LocaleDateStyle, Intl.DateTimeFormatOptions> = {
  shortDate: { dateStyle: 'short' },
  mediumDate: { dateStyle: 'medium' },
  longDate: { dateStyle: 'long' },
  fullDate: { dateStyle: 'full' },
  short: { dateStyle: 'short', timeStyle: 'short' },
  medium: { dateStyle: 'medium', timeStyle: 'short' },
  monthYear: { month: 'long', year: 'numeric' },
};

/**
 * A date formatted in the UI language.
 *
 * Angular's `DatePipe` formats with `LOCALE_ID`, which is fixed at bootstrap
 * (and `en-US` here), so a Japanese user reading a Japanese dashboard still
 * saw "Sep 11, 2026". This pipe reads `LanguageService.localeCode()` and uses
 * `Intl`, so "2026年9月11日" follows the language switch without a reload and
 * without registering fourteen locale-data files.
 *
 * Impure on purpose: a pure pipe memoises on its arguments, and the language
 * is not one of them. The signal read inside `transform` is what marks the
 * view for refresh when the language changes; `pure: false` is what makes the
 * pipe actually recompute on that refresh.
 */
@Pipe({ name: 'localeDate', standalone: true, pure: false })
export class LocaleDatePipe implements PipeTransform {
  private readonly language = inject(LanguageService);

  transform(value: string | number | Date | null | undefined, style: LocaleDateStyle = 'mediumDate'): string {
    if (value === null || value === undefined || value === '') return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const locale = this.language.localeCode();
    try {
      return new Intl.DateTimeFormat(locale, STYLES[style] ?? STYLES.mediumDate).format(date);
    } catch {
      // An Intl implementation without this locale: still a readable date.
      return date.toLocaleDateString();
    }
  }
}
