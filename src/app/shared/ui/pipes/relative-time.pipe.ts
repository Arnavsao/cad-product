import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { LanguageService } from '../../../core/i18n/language.service';

export interface RelativeTimeOptions {
  /** BCP 47 tag for `Intl.RelativeTimeFormat` and the date fallback. Default English. */
  locale?: string;
  /** Text for anything under 45 seconds old. Default "just now". */
  justNow?: string;
}

/**
 * "just now" / "6 minutes ago" / "3 hours ago" / "2 days ago", or a locale date
 * once older than a week. Ported from the editor's drawing browser.
 *
 * The phrases come from `Intl.RelativeTimeFormat`, so every shipped language
 * gets its own grammar (plural forms, word order) without a translation key per
 * unit. Only "just now" is ours — `Intl` renders 0 seconds as "now", which reads
 * as a countdown rather than a timestamp.
 */
export function relativeTime(ts: number, now: number = Date.now(), opts: RelativeTimeOptions = {}): string {
  const locale = opts.locale ?? 'en';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) return opts.justNow ?? 'just now';
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 7) return new Date(ts).toLocaleDateString(locale);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'long' });
  if (m < 60) return rtf.format(-m, 'minute');
  if (h < 24) return rtf.format(-h, 'hour');
  return rtf.format(-d, 'day');
}

/**
 * `{{ drawing.updatedAt | relativeTime }}` — accepts ISO strings, epoch ms or
 * Dates; empty string for null/invalid input. Re-evaluates when the input
 * changes or the UI language changes (hence `pure: false` — the work is a few
 * integer divisions, and the language is read from a signal), not as the clock
 * ticks — lists refresh on their own cadence.
 */
@Pipe({ name: 'relativeTime', standalone: true, pure: false })
export class RelativeTimePipe implements PipeTransform {
  private readonly language = inject(LanguageService);
  private readonly transloco = inject(TranslocoService);

  transform(value: string | number | Date | null | undefined): string {
    if (value == null || value === '') return '';
    const ts = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(ts)) return '';
    return relativeTime(ts, Date.now(), {
      locale: this.language.localeCode(),
      justNow: this.transloco.translate('shared.relativeTime.justNow'),
    });
  }
}
