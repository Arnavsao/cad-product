import { Pipe, PipeTransform } from '@angular/core';

/**
 * "just now" / "6m ago" / "3h ago" / "2d ago", or a locale date once older
 * than a week. Ported from the editor's drawing browser.
 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * `{{ drawing.updatedAt | relativeTime }}` — accepts ISO strings, epoch ms or
 * Dates; empty string for null/invalid input. Pure: it re-evaluates when the
 * input changes, not as the clock ticks — lists refresh on their own cadence.
 */
@Pipe({ name: 'relativeTime', standalone: true })
export class RelativeTimePipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined): string {
    if (value == null || value === '') return '';
    const ts = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(ts) ? relativeTime(ts) : '';
  }
}
