/**
 * Shared typed-input handling for draw tools.
 *
 * Locale: English-only decimal — `.` is the decimal separator, `,` is the dx/dy/dy delimiter.
 * Buffers accept digits, `.`, `-`, `,`, `<`.
 */

export type ConsumeResult = 'commit' | 'cancel' | 'edit' | 'ignore';

const ALLOWED_CHARS = /^[0-9.\-,<]$/;

export class TypedInputBuffer {
  text = '';

  isActive(): boolean {
    return this.text.length > 0;
  }

  clear(): void {
    this.text = '';
  }

  /**
   * Consume a keyboard event.
   * - Returns 'commit' on Enter when buffer is non-empty.
   * - Returns 'cancel' on Escape when buffer is non-empty (Esc with empty buffer is 'ignore' — caller falls through to tool exit).
   * - Returns 'edit' on accepted printable / Backspace edits.
   * - Returns 'ignore' otherwise (caller may apply default keybindings).
   */
  consume(e: KeyboardEvent): ConsumeResult {
    if (e.ctrlKey || e.metaKey || e.altKey) return 'ignore';

    if (e.key === 'Enter' || e.key === ' ') {
      if (!this.text.length) return 'ignore';
      return 'commit';
    }
    if (e.key === 'Escape') {
      if (!this.text.length) return 'ignore';
      this.text = '';
      return 'cancel';
    }
    if (e.key === 'Backspace') {
      if (!this.text.length) return 'ignore';
      this.text = this.text.slice(0, -1);
      return 'edit';
    }
    if (e.key.length === 1 && ALLOWED_CHARS.test(e.key)) {
      this.text += e.key;
      return 'edit';
    }
    return 'ignore';
  }
}

const NUM = /^-?\d+(?:\.\d+)?$/;

/**
 * Parse "L" or "L<A" (degrees). Returns null on invalid.
 * `fallbackAngleDeg` is used when no `<A` is given (caller passes current cursor direction).
 */
export function parseLengthAngle(
  text: string,
  fallbackAngleDeg: number,
): { length: number; angleDeg: number; explicitAngle: boolean } | null {
  const t = text.trim();
  if (!t) return null;
  const ltIdx = t.indexOf('<');
  if (ltIdx === -1) {
    if (!NUM.test(t)) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { length: n, angleDeg: fallbackAngleDeg, explicitAngle: false };
  }
  const left = t.slice(0, ltIdx);
  const right = t.slice(ltIdx + 1);
  if (!NUM.test(left) || !NUM.test(right)) return null;
  const len = Number(left);
  const ang = Number(right);
  if (!Number.isFinite(len) || len <= 0 || !Number.isFinite(ang)) return null;
  return { length: len, angleDeg: ang, explicitAngle: true };
}

/**
 * Parse "dx,dy" (two strict floats). Trailing/leading commas → null.
 */
export function parseRelative(text: string): { dx: number; dy: number } | null {
  const t = text.trim();
  if (!t || t.indexOf('<') !== -1) return null;
  const parts = t.split(',');
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!NUM.test(a) || !NUM.test(b)) return null;
  const dx = Number(a);
  const dy = Number(b);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return { dx, dy };
}

/**
 * Parse a single non-negative number (radius / sweep input).
 */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!NUM.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse "rx,ry" (two strict positive floats). Trailing/leading commas → null.
 */
export function parsePositivePair(text: string): { a: number; b: number } | null {
  const r = parseRelative(text);
  if (!r) return null;
  if (r.dx <= 0 || r.dy <= 0) return null;
  return { a: r.dx, b: r.dy };
}

/**
 * For line/polyline live preview: returns the "is angle fully specified?" check.
 * If text contains `<` and right side is a valid number, the angle is frozen.
 */
export function hasExplicitAngle(text: string): boolean {
  const ltIdx = text.indexOf('<');
  if (ltIdx === -1) return false;
  const right = text.slice(ltIdx + 1).trim();
  return NUM.test(right);
}
