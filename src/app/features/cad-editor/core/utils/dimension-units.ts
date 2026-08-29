/**
 * Dimension text formatter — Decimal / Engineering / Architectural / Fractional / Scientific.
 *
 * Conventions follow AutoCAD's DIMSTYLE Primary Units tab:
 *   - Decimal:        12.34
 *   - Scientific:     1.23E+01
 *   - Engineering:    1'-0.34"  (1 input unit == 1 inch)
 *   - Architectural:  1'-0 1/2" (denominator = `precision`)
 *   - Fractional:     12 1/2"   (no feet roll-up; denominator = `precision`)
 *
 * `precision` is interpreted per-format:
 *   - decimal / engineering / scientific → number of decimal places (0..8)
 *   - architectural / fractional         → fraction denominator (1, 2, 4, 8, 16, 32, 64, ...)
 */

export type DimUnitFormat = 'decimal' | 'engineering' | 'architectural' | 'fractional' | 'scientific';

export interface DimUnitOptions {
  format?: DimUnitFormat;
  precision?: number;
  prefix?: string;
  suffix?: string;
  decimalSeparator?: '.' | ',';
  suppressTrailingZeros?: boolean;
  /** If > 0, round the value to the nearest multiple of this before formatting. */
  roundOff?: number;
}

export function formatDimensionLength(value: number, opts: DimUnitOptions = {}): string {
  const format = opts.format ?? 'decimal';
  const precision = clampPrecision(opts.precision, format);
  let v = value;
  if (opts.roundOff && opts.roundOff > 0) v = Math.round(v / opts.roundOff) * opts.roundOff;

  let core: string;
  switch (format) {
    case 'decimal':       core = formatDecimal(v, precision, opts); break;
    case 'scientific':    core = formatScientific(v, precision, opts); break;
    case 'engineering':   core = formatEngineering(v, precision, opts); break;
    case 'architectural': core = formatArchitectural(v, precision); break;
    case 'fractional':    core = formatFractional(v, precision); break;
    default:              core = String(v);
  }
  return (opts.prefix ?? '') + core + (opts.suffix ?? '');
}

function clampPrecision(p: number | undefined, format: DimUnitFormat): number {
  if (p === undefined || !Number.isFinite(p)) return defaultPrecision(format);
  if (format === 'architectural' || format === 'fractional') {
    // Must be a positive power-of-2 denominator (1, 2, 4, 8, 16, ...)
    return Math.max(1, Math.min(1024, Math.round(p)));
  }
  return Math.max(0, Math.min(8, Math.round(p)));
}

function defaultPrecision(format: DimUnitFormat): number {
  if (format === 'architectural' || format === 'fractional') return 16;
  return 2;
}

/* -------------------------------------------------------------------------- */

function formatDecimal(value: number, precision: number, opts: DimUnitOptions): string {
  let s = value.toFixed(precision);
  if (opts.suppressTrailingZeros) s = trimTrailingZeros(s);
  if (opts.decimalSeparator === ',') s = s.replace('.', ',');
  return s;
}

function formatScientific(value: number, precision: number, opts: DimUnitOptions): string {
  let s = value.toExponential(precision);
  if (opts.suppressTrailingZeros) {
    s = s.replace(/(\.\d*?)0+(e)/i, '$1$2').replace(/\.(e)/i, '$1');
  }
  // Normalize to AutoCAD-style upper-case E+nn.
  s = s.replace(/e([+-]?)(\d)$/i, (_m, sign, d) => `E${sign || '+'}0${d}`)
       .replace(/e([+-]?)/i, (_m, sign) => `E${sign || '+'}`);
  if (opts.decimalSeparator === ',') s = s.replace('.', ',');
  return s;
}

function formatEngineering(value: number, precision: number, opts: DimUnitOptions): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const feet = Math.floor(abs / 12);
  const inches = abs - feet * 12;
  let inchStr = inches.toFixed(precision);
  if (opts.suppressTrailingZeros) inchStr = trimTrailingZeros(inchStr);
  if (opts.decimalSeparator === ',') inchStr = inchStr.replace('.', ',');
  return `${sign}${feet}'-${inchStr}"`;
}

function formatArchitectural(value: number, denominator: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  let feet = Math.floor(abs / 12);
  let inches = abs - feet * 12;
  let whole = Math.floor(inches);
  let frac = Math.round((inches - whole) * denominator);
  // Carry on overflow (e.g. 0.99 inches rounds to 1)
  if (frac === denominator) {
    frac = 0;
    whole += 1;
    if (whole === 12) { whole = 0; feet += 1; }
  }
  let fracStr = '';
  if (frac > 0) {
    const g = gcd(frac, denominator);
    fracStr = ` ${frac / g}/${denominator / g}`;
  }
  return `${sign}${feet}'-${whole}${fracStr}"`;
}

function formatFractional(value: number, denominator: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  let whole = Math.floor(abs);
  let frac = Math.round((abs - whole) * denominator);
  if (frac === denominator) { frac = 0; whole += 1; }
  let fracStr = '';
  if (frac > 0) {
    const g = gcd(frac, denominator);
    fracStr = ` ${frac / g}/${denominator / g}`;
  }
  return `${sign}${whole}${fracStr}"`;
}

function trimTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}
