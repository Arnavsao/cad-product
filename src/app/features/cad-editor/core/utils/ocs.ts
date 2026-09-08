/**
 * Object Coordinate System (OCS) helpers.
 *
 * Planar DXF entities — INSERT, CIRCLE, ARC, LWPOLYLINE, TEXT, SOLID and the
 * like — store their points in the coordinate system of their own plane, which
 * is defined by the extrusion normal (groups 210/220/230). For almost every
 * entity that normal is +Z and OCS coincides with WCS, which is why most
 * importers get away with ignoring it.
 *
 * AutoCAD's MIRROR command is the common exception: it writes a mirrored planar
 * entity with the normal flipped to (0, 0, -1) and the coordinates left in the
 * mirrored frame. A block reference stored at OCS x = -404 then actually sits at
 * WCS x = +404. Read as WCS it lands far off the sheet, mirrored — the "stray
 * drawing" a user sees on import.
 *
 * The mapping is the DXF reference's Arbitrary Axis Algorithm.
 */
export interface IVec3 {
  x: number;
  y: number;
  z: number;
}

/** The reference picks Wy over Wz once the normal is within 1/64 of the Z axis. */
const ARBITRARY_AXIS_EPS = 1 / 64;
const ZERO_EPS = 1e-9;

/** True when the normal is absent or the default +Z, so OCS equals WCS. */
export function isWcsNormal(n: IVec3 | null | undefined): boolean {
  if (!n) return true;
  return Math.abs(n.x) < ZERO_EPS && Math.abs(n.y) < ZERO_EPS && n.z > 0;
}

/** True for the mirrored plane AutoCAD writes: normal (0, 0, -1). */
export function isFlippedNormal(n: IVec3 | null | undefined): boolean {
  return !!n && Math.abs(n.x) < ZERO_EPS && Math.abs(n.y) < ZERO_EPS && n.z < 0;
}

function cross(a: IVec3, b: IVec3): IVec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function unit(v: IVec3): IVec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** The OCS axes for a normal, per the Arbitrary Axis Algorithm. */
export function ocsAxes(n: IVec3): { ax: IVec3; ay: IVec3; az: IVec3 } {
  const az = unit(n);
  const nearZ = Math.abs(az.x) < ARBITRARY_AXIS_EPS && Math.abs(az.y) < ARBITRARY_AXIS_EPS;
  const ref: IVec3 = nearZ ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const ax = unit(cross(ref, az));
  const ay = cross(az, ax);
  return { ax, ay, az };
}

/**
 * Maps an OCS point to WCS, projected onto the XY plane for the 2D editor.
 * A missing or +Z normal returns the point unchanged (as a fresh object).
 */
export function ocsToWcs(
  p: { x: number; y: number; z?: number },
  n: IVec3 | null | undefined,
): { x: number; y: number } {
  if (isWcsNormal(n)) return { x: p.x, y: p.y };
  const { ax, ay, az } = ocsAxes(n as IVec3);
  const z = p.z ?? 0;
  return {
    x: p.x * ax.x + p.y * ay.x + z * az.x,
    y: p.x * ax.y + p.y * ay.y + z * az.y,
  };
}
