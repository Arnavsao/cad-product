/**
 * Safe arithmetic + CAD coordinate parser for the Dynamic Input overlay.
 *
 * Supported expression syntax (in numeric fields):
 *   - Numbers: `100`, `-1.5`, `.5`
 *   - Math: `+`, `-`, `*`, `/`, parentheses
 *   - Unary minus: `-5`, `-(2+3)`
 *
 * Supported CAD vector syntax (in fields that accept a vector):
 *   - `@dx,dy` — relative offset from anchor (the `@` is decorative; commit logic also accepts plain `dx,dy`)
 *   - `len<angle` — polar: length at angle in degrees
 *   - `dx,dy` — same as relative
 *
 * Recursive descent — no `eval()`, no identifiers, no global function calls.
 */

export function evalExpression(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (!tokens) return null;
  const parser = new Parser(tokens);
  const value = parser.parseExpr();
  if (value === null || !parser.atEnd()) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

export interface ICadVector {
  /** Vector kind: cartesian (dx,dy) or polar (length, angleDeg). */
  kind: 'cartesian' | 'polar';
  dx?: number;
  dy?: number;
  length?: number;
  angleDeg?: number;
}

/**
 * Parse a CAD-style vector input. Returns null on invalid.
 *
 * Examples:
 *   "@100,50"  → { kind: 'cartesian', dx: 100, dy: 50 }
 *   "100,50"   → { kind: 'cartesian', dx: 100, dy: 50 }
 *   "100<45"   → { kind: 'polar', length: 100, angleDeg: 45 }
 *   "10+5,20"  → { kind: 'cartesian', dx: 15, dy: 20 }
 */
export function parseCadVector(text: string): ICadVector | null {
  const t = text.trim().replace(/^@/, '');
  if (!t) return null;
  const ltIdx = indexOfTop(t, '<');
  if (ltIdx !== -1) {
    const lenText = t.slice(0, ltIdx);
    const angText = t.slice(ltIdx + 1);
    const length = evalExpression(lenText);
    const angleDeg = evalExpression(angText);
    if (length === null || angleDeg === null) return null;
    return { kind: 'polar', length, angleDeg };
  }
  const commaIdx = indexOfTop(t, ',');
  if (commaIdx !== -1) {
    const left = t.slice(0, commaIdx);
    const right = t.slice(commaIdx + 1);
    const dx = evalExpression(left);
    const dy = evalExpression(right);
    if (dx === null || dy === null) return null;
    return { kind: 'cartesian', dx, dy };
  }
  return null;
}

/** Find the first occurrence of `ch` that is NOT inside parentheses. Returns -1 if absent. */
function indexOfTop(s: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === ch) return i;
  }
  return -1;
}

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenize(text: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      out.push({ type: 'op', value: c });
      i++;
      continue;
    }
    if (c === '(') { out.push({ type: 'lparen' }); i++; continue; }
    if (c === ')') { out.push({ type: 'rparen' }); i++; continue; }
    if (c === '.' || (c >= '0' && c <= '9')) {
      let j = i;
      let dotSeen = c === '.';
      while (j < text.length) {
        const d = text[j + 1];
        if (d === undefined) break;
        if (d >= '0' && d <= '9') { j++; continue; }
        if (d === '.' && !dotSeen) { dotSeen = true; j++; continue; }
        break;
      }
      const slice = text.slice(i, j + 1);
      const n = Number(slice);
      if (!Number.isFinite(n)) return null;
      out.push({ type: 'num', value: n });
      i = j + 1;
      continue;
    }
    return null;
  }
  return out;
}

class Parser {
  pos = 0;
  constructor(private tokens: Token[]) {}

  atEnd(): boolean { return this.pos >= this.tokens.length; }
  peek(): Token | undefined { return this.tokens[this.pos]; }

  parseExpr(): number | null {
    let left = this.parseTerm();
    if (left === null) return null;
    while (!this.atEnd()) {
      const t = this.peek();
      if (!t || t.type !== 'op' || (t.value !== '+' && t.value !== '-')) break;
      this.pos++;
      const right = this.parseTerm();
      if (right === null) return null;
      left = t.value === '+' ? left + right : left - right;
    }
    return left;
  }

  parseTerm(): number | null {
    let left = this.parseFactor();
    if (left === null) return null;
    while (!this.atEnd()) {
      const t = this.peek();
      if (!t || t.type !== 'op' || (t.value !== '*' && t.value !== '/')) break;
      this.pos++;
      const right = this.parseFactor();
      if (right === null) return null;
      if (t.value === '*') left = left * right;
      else {
        if (right === 0) return null;
        left = left / right;
      }
    }
    return left;
  }

  parseFactor(): number | null {
    const t = this.peek();
    if (!t) return null;
    if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
      this.pos++;
      const inner = this.parseFactor();
      if (inner === null) return null;
      return t.value === '-' ? -inner : inner;
    }
    if (t.type === 'num') {
      this.pos++;
      return t.value;
    }
    if (t.type === 'lparen') {
      this.pos++;
      const inner = this.parseExpr();
      const close = this.peek();
      if (!close || close.type !== 'rparen') return null;
      this.pos++;
      return inner;
    }
    return null;
  }
}
