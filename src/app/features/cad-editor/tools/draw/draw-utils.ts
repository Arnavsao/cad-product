/** Shared formatters used by tool dynamic labels and typed-input echoes. */

export function formatLen(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const fixed = n.toFixed(3);
  return fixed.replace(/\.?0+$/, '') || '0';
}

/** Normalize to (-180, 180] then return without unit. */
export function formatAngleDeg(deg: number): string {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  if (Math.abs(a) < 1e-6) return '0';
  return Math.abs(a - Math.round(a)) < 1e-3 ? String(Math.round(a)) : a.toFixed(1);
}

export function formatAngleRad(rad: number): string {
  return formatAngleDeg(rad * 180 / Math.PI);
}
