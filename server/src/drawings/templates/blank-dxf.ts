/**
 * The server-side "New drawing" template.
 *
 * Design — byte-for-byte parity with the editor's own writer: this is the exact
 * output `ExportService.buildDxfString()` (src/app/features/cad-editor/core/
 * services/export.service.ts) produces for an empty `DxfFile` — one layer `0`,
 * no blocks, no entities. Emitting anything else would make the very first save
 * of a brand-new drawing a large diff (the importer would drop tags the editor
 * does not model, the exporter would add the ones it does), so `create → open →
 * save` round-trips losslessly only if the two writers agree. If the editor's
 * writer changes, change this with it.
 *
 * Structure: HEADER (`$ACADVER` AC1032 + `$INSUNITS`) · TABLES (LAYER, LTYPE,
 * BLOCK_RECORD) · BLOCKS (`*Model_Space`, `*Paper_Space`) · empty ENTITIES · EOF.
 */

/** `$INSUNITS` codes for the five units the product exposes (plan §1 `Units`). */
export const INSUNITS_BY_UNIT: Record<'mm' | 'cm' | 'm' | 'in' | 'ft', number> = {
  mm: 4,
  cm: 5,
  m: 6,
  in: 1,
  ft: 2,
};

/** Fallback when preferences are unreadable: millimetres. */
export const DEFAULT_INSUNITS = INSUNITS_BY_UNIT.mm;

/** `'mm'` → `4`; unknown input → `DEFAULT_INSUNITS`. */
export function insunitsForUnit(unit: string | null | undefined): number {
  const key = String(unit ?? '').toLowerCase() as keyof typeof INSUNITS_BY_UNIT;
  return INSUNITS_BY_UNIT[key] ?? DEFAULT_INSUNITS;
}

/**
 * Builds the blank DXF text for a given `$INSUNITS` code.
 *
 * @param insunits `$INSUNITS` group-70 value (see `INSUNITS_BY_UNIT`).
 */
export function blankDxf(insunits: number = DEFAULT_INSUNITS): string {
  const units = Number.isFinite(insunits) ? Math.trunc(insunits) : DEFAULT_INSUNITS;

  let dxf = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n`;
  dxf += `9\n$INSUNITS\n70\n${units}\n`;
  dxf += `0\nENDSEC\n`;

  dxf += `0\nSECTION\n2\nTABLES\n`;

  // LAYER — a single layer `0`, visible, colour 7, CONTINUOUS.
  dxf += `0\nTABLE\n2\nLAYER\n70\n1\n`;
  dxf += `0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nContinuous\n`;
  dxf += `0\nENDTAB\n`;

  // LTYPE — the two line types the editor always writes.
  dxf += `0\nTABLE\n2\nLTYPE\n70\n2\n`;
  dxf += `0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n`;
  dxf += `0\nLTYPE\n2\nDASHED\n70\n0\n3\nDashed __ __ __ __ __ __ __ __ __ __ __ __ __ _\n72\n65\n73\n2\n40\n0.5\n49\n0.25\n49\n-0.25\n`;
  dxf += `0\nENDTAB\n`;

  // BLOCK_RECORD — the two mandatory layout records (no user blocks).
  dxf += `0\nTABLE\n2\nBLOCK_RECORD\n70\n2\n`;
  dxf += `0\nBLOCK_RECORD\n2\n*Model_Space\n`;
  dxf += `0\nBLOCK_RECORD\n2\n*Paper_Space\n`;
  dxf += `0\nENDTAB\n`;

  dxf += `0\nENDSEC\n`;

  dxf += `0\nSECTION\n2\nBLOCKS\n`;
  dxf += `0\nBLOCK\n8\n0\n2\n*Model_Space\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n*Model_Space\n1\n\n0\nENDBLK\n8\n0\n`;
  dxf += `0\nBLOCK\n8\n0\n2\n*Paper_Space\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n*Paper_Space\n1\n\n0\nENDBLK\n8\n0\n`;
  dxf += `0\nENDSEC\n`;

  dxf += `0\nSECTION\n2\nENTITIES\n`;
  dxf += `0\nENDSEC\n`;
  dxf += `0\nEOF\n`;
  return dxf;
}
