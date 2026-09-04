import { DxfTag, RawDxfObject } from '../models/entity.model';

/**
 * A lightweight lexical scanner that parses a DXF file into raw tag blocks.
 * Used to preserve unsupported entities and metadata (XDATA/Dictionaries) that
 * the primary dxf-parser drops.
 */
export function scanRawDxfObjects(fileText: string): RawDxfObject[] {
  const lines = fileText.split(/\r?\n/);
  const objects: RawDxfObject[] = [];
  
  let inEntitiesSection = false;
  let inBlocksSection = false;
  let currentObj: RawDxfObject | null = null;
  
  for (let i = 0; i < lines.length; i += 2) {
    if (i + 1 >= lines.length) break;
    
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();

    if (code === 0 && value === 'SECTION') {
      const sectionName = (lines[i + 3] || '').trim();
      if (sectionName === 'ENTITIES') inEntitiesSection = true;
      if (sectionName === 'BLOCKS') inBlocksSection = true;
      i += 2; // skip the section name lines
      continue;
    }

    if (code === 0 && value === 'ENDSEC') {
      inEntitiesSection = false;
      inBlocksSection = false;
      if (currentObj) {
        objects.push(currentObj);
        currentObj = null;
      }
      continue;
    }

    // We only capture objects in ENTITIES or BLOCKS section
    if (inEntitiesSection || inBlocksSection) {
      if (code === 0) {
        // Start of a new object
        if (currentObj) {
          objects.push(currentObj);
        }
        currentObj = {
          handle: '',
          ownerHandle: '',
          entityType: value,
          originalTags: []
        };
      }
      
      if (currentObj) {
        currentObj.originalTags.push({ code, value });
        if (code === 5) currentObj.handle = value;
        if (code === 330) currentObj.ownerHandle = value;
      }
    }
  }

  if (currentObj) {
    objects.push(currentObj);
  }

  return objects;
}

/** One entry of the DXF STYLE table (text styles). */
export interface IDxfTextStyleData {
  name: string;
  /** Table entry handle (group 5) — DIMSTYLE references text styles by handle. */
  handle?: string;
  /** Group 3 — primary font file, e.g. `arial.ttf`, `romans.shx`. */
  font?: string;
  /** Group 4 — bigfont file (CJK). */
  bigFont?: string;
  /** Group 40 — fixed text height. 0 means "prompt per entity" (variable). */
  fixedHeight?: number;
  /** Group 41 — width factor. */
  widthFactor?: number;
  /** Group 50 — oblique angle, in degrees. */
  obliqueAngle?: number;
  /** Group 71 — 2 = backwards, 4 = upside down. */
  generationFlags?: number;
}

/**
 * One entry of the DXF LAYER table.
 *
 * `dxf-parser` reads only name, colour and the frozen bit, so linetype and —
 * more visibly — lineweight never reach the renderer, flattening every line in
 * the drawing to the same thickness.
 */
export interface IDxfLayerData {
  name: string;
  /** Group 62. Negative means the layer is switched off; the colour is `abs()`. */
  colorIndex?: number;
  /** Group 62 sign — false when the layer is off. */
  visible?: boolean;
  /** Group 70 bit 1. */
  frozen?: boolean;
  /** Group 70 bit 4. */
  locked?: boolean;
  /** Group 6 — linetype name. */
  lineType?: string;
  /** Group 370 — lineweight in 1/100 mm. Negative values are BYLAYER/BYBLOCK/DEFAULT. */
  lineWeight?: number;
  /** Group 290 — plot flag. */
  plot?: boolean;
}

/**
 * One entry of the DXF DIMSTYLE table, already mapped onto the field names used
 * by `DimensionStyle` so it can be `Object.assign`ed straight onto one.
 */
export interface IDxfDimStyleData {
  name?: string;
  arrowSize?: number;
  arrowAspect?: number;
  extensionGap?: number;
  extensionPast?: number;
  textHeight?: number;
  textOffset?: number;
  linearFactor?: number;
  globalScale?: number;
  unitPrecision?: number;
  unitFormat?: string;
  unitPrefix?: string;
  unitSuffix?: string;
  decimalSeparator?: '.' | ',';
  suppressTrailingZeros?: boolean;
  roundOff?: number;
  /** DIMTAD — 0 centred, 1 above, 2 outside, 3 JIS, 4 below. */
  textAbove?: number;
  /** DIMTMOVE — 0 move with dim line, 1 add leader, 2 free. */
  textMovement?: number;
  /** DIMTXSTY, resolved from the group-340 handle against the STYLE table. */
  textStyleName?: string;
}

/* -------------------------------------------------------------------------- */
/* DIMSTYLE variable codes                                                     */
/* -------------------------------------------------------------------------- */

/** DIMLFAC — linear measurement factor. The single most important one here. */
export const DIMVAR_DIMLFAC = 144;
/** DIMSCALE — overall feature scale. */
export const DIMVAR_DIMSCALE = 40;
/** DIMDEC — decimal places for primary units. */
export const DIMVAR_DIMDEC = 271;

/** DIMLUNIT (277) → `DimUnitFormat`. 6 (Windows desktop) behaves as decimal. */
const DIM_LUNIT_FORMATS: Record<number, string> = {
  1: 'scientific',
  2: 'decimal',
  3: 'engineering',
  4: 'architectural',
  5: 'fractional',
  6: 'decimal',
};

/**
 * Applies one DIMSTYLE group code to a style record. Shared by the table scan
 * and by the per-entity XDATA override reader, since AutoCAD addresses both
 * with the same variable numbers.
 */
function applyDimVar(style: IDxfDimStyleData, code: number, value: string): void {
  const num = Number(value);
  switch (code) {
    // ── Lines and arrows ────────────────────────────────────────────────
    case 41:  style.arrowSize = num; break;       // DIMASZ
    case 42:  style.extensionGap = num; break;    // DIMEXO
    case 44:  style.extensionPast = num; break;   // DIMEXE
    case 40:  style.globalScale = num; break;     // DIMSCALE
    // ── Text ────────────────────────────────────────────────────────────
    case 140: style.textHeight = num; break;      // DIMTXT
    case 147: style.textOffset = num; break;      // DIMGAP
    case 77:  style.textAbove = num; break;       // DIMTAD
    case 279: style.textMovement = num; break;    // DIMTMOVE
    // ── Primary units ───────────────────────────────────────────────────
    case 144: style.linearFactor = num; break;    // DIMLFAC
    case 271: style.unitPrecision = num; break;   // DIMDEC
    case 45:  style.roundOff = num; break;        // DIMRND
    case 277: {                                   // DIMLUNIT
      const fmt = DIM_LUNIT_FORMATS[num];
      if (fmt) style.unitFormat = fmt;
      break;
    }
    case 278:                                     // DIMDSEP (ASCII code)
      style.decimalSeparator = num === 44 ? ',' : '.';
      break;
    case 78:                                      // DIMZIN — bit 8 = drop trailing zeros
      style.suppressTrailingZeros = (num & 8) !== 0;
      break;
    case 3: {                                     // DIMPOST — "<>" splits prefix/suffix
      const post = value ?? '';
      if (!post) break;
      const at = post.indexOf('<>');
      if (at >= 0) {
        style.unitPrefix = post.slice(0, at);
        style.unitSuffix = post.slice(at + 2);
      } else {
        style.unitSuffix = post;
      }
      break;
    }
    default: break;
  }
}

/**
 * Walks the TABLES section once and returns both the STYLE and DIMSTYLE tables.
 * `dxf-parser` exposes neither (its `tables` only carries viewPort/lineType/layer),
 * so without this every text entity loses its font and every dimension falls back
 * to the `Standard` style — which is why imported dimensions showed four decimals.
 */
export function scanDxfTables(fileText: string): {
  dimStyles: Map<string, IDxfDimStyleData>;
  textStyles: Map<string, IDxfTextStyleData>;
  layers: Map<string, IDxfLayerData>;
} {
  const lines = fileText.split(/\r?\n/);
  const dimStyles = new Map<string, IDxfDimStyleData>();
  const textStyles = new Map<string, IDxfTextStyleData>();
  const layers = new Map<string, IDxfLayerData>();
  /** handle → text style name, for resolving DIMTXSTY (group 340). */
  const styleByHandle = new Map<string, string>();
  /** dim style name → DIMTXSTY handle, resolved after the STYLE table is read. */
  const pendingTextStyle = new Map<string, string>();

  let inTablesSection = false;
  let table: '' | 'DIMSTYLE' | 'STYLE' | 'LAYER' = '';
  let dimStyle: IDxfDimStyleData | null = null;
  let textStyle: IDxfTextStyleData | null = null;
  let layer: IDxfLayerData | null = null;

  const flush = (): void => {
    if (dimStyle?.name) dimStyles.set(dimStyle.name, dimStyle);
    if (textStyle?.name) {
      textStyles.set(textStyle.name, textStyle);
      if (textStyle.handle) styleByHandle.set(textStyle.handle, textStyle.name);
    }
    if (layer?.name) layers.set(layer.name, layer);
    dimStyle = null;
    textStyle = null;
    layer = null;
  };

  for (let i = 0; i < lines.length; i += 2) {
    if (i + 1 >= lines.length) break;

    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();

    if (code === 0 && value === 'SECTION') {
      inTablesSection = (lines[i + 3] || '').trim() === 'TABLES';
      i += 2;
      continue;
    }

    if (code === 0 && value === 'ENDSEC') {
      if (inTablesSection) break; // TABLES is all we need; stop before BLOCKS
      continue;
    }

    if (!inTablesSection) continue;

    if (code === 0 && value === 'TABLE') {
      flush();
      const tableName = (lines[i + 3] || '').trim();
      table = tableName === 'DIMSTYLE' || tableName === 'STYLE' || tableName === 'LAYER'
        ? tableName
        : '';
      i += 2;
      continue;
    }

    if (code === 0 && value === 'ENDTAB') {
      flush();
      table = '';
      continue;
    }

    if (table === 'DIMSTYLE') {
      if (code === 0 && value === 'DIMSTYLE') {
        flush();
        // AutoCAD's arrowheads are noticeably slimmer than this app's 3:1 default.
        dimStyle = { arrowAspect: 2 };
      } else if (dimStyle) {
        if (code === 2) dimStyle.name = value;
        // Group 70 on a table entry is the entry's own flags, not DIMTOL — skip it.
        else if (code === 340) {
          if (dimStyle.name) pendingTextStyle.set(dimStyle.name, value);
        } else if (code !== 70 && code !== 105) {
          applyDimVar(dimStyle, code, value);
        }
      }
    } else if (table === 'LAYER') {
      if (code === 0 && value === 'LAYER') {
        flush();
        layer = { name: '' };
      } else if (layer) {
        switch (code) {
          case 2: layer.name = value; break;
          case 62: {
            const c = Number(value);
            layer.visible = c >= 0;      // a negative colour means "layer off"
            layer.colorIndex = Math.abs(c);
            break;
          }
          case 70: {
            const flags = Number(value);
            layer.frozen = (flags & 1) !== 0 || (flags & 2) !== 0;
            layer.locked = (flags & 4) !== 0;
            break;
          }
          case 6:   layer.lineType = value; break;
          case 370: layer.lineWeight = Number(value); break;
          case 290: layer.plot = value !== '0'; break;
          default: break;
        }
      }
    } else if (table === 'STYLE') {
      if (code === 0 && value === 'STYLE') {
        flush();
        textStyle = { name: '' };
      } else if (textStyle) {
        switch (code) {
          case 5:  textStyle.handle = value; break;
          case 2:  textStyle.name = value; break;
          case 3:  textStyle.font = value; break;
          case 4:  textStyle.bigFont = value; break;
          case 40: textStyle.fixedHeight = Number(value); break;
          case 41: textStyle.widthFactor = Number(value); break;
          case 50: textStyle.obliqueAngle = Number(value); break;
          case 71: textStyle.generationFlags = Number(value); break;
          default: break;
        }
      }
    }
  }

  flush();

  // DIMTXSTY arrives as a handle; resolve it now that STYLE has been read.
  for (const [dimName, handle] of pendingTextStyle) {
    const styleName = styleByHandle.get(handle);
    const ds = dimStyles.get(dimName);
    if (styleName && ds) ds.textStyleName = styleName;
  }

  return { dimStyles, textStyles, layers };
}

/**
 * Back-compat wrapper. Prefer `scanDxfTables` when the STYLE table is also needed
 * — it walks the file once instead of twice.
 */
export function scanDimStyles(fileText: string): Map<string, IDxfDimStyleData> {
  return scanDxfTables(fileText).dimStyles;
}

/**
 * Reads per-entity dimension style overrides out of XDATA.
 *
 * AutoCAD stores "this one dimension differs from its style" as an XDATA block
 * on the entity:
 *
 * ```
 * 1001 ACAD
 * 1000 DSTYLE
 * 1002 {
 * 1070 144      ← DIMLFAC
 * 1040 150.0    ← its value
 * 1002 }
 * ```
 *
 * `dxf-parser` collapses XDATA to `{applicationName, customStrings:['DSTYLE']}`
 * and throws the values away, so this is the only route to them. Without it a
 * dimension whose DIMLFAC is 150 renders its raw drawing-unit length — `68.5333`
 * where AutoCAD shows `10280`.
 *
 * Operates on the already-scanned raw objects rather than re-reading the file.
 *
 * @returns entity handle → dimension style overrides
 */
export function scanDimStyleOverrides(
  rawObjects: RawDxfObject[],
): Map<string, IDxfDimStyleData> {
  const out = new Map<string, IDxfDimStyleData>();

  for (const obj of rawObjects) {
    if (obj.entityType !== 'DIMENSION' || !obj.handle) continue;

    const tags = obj.originalTags as DxfTag[];
    let inAcadXData = false;
    let inDStyle = false;
    let depth = 0;
    let pendingCode: number | null = null;
    let overrides: IDxfDimStyleData | null = null;

    for (const tag of tags) {
      const code = Number(tag.code);

      if (code === 1001) {
        // A new application block ends whatever the previous one was reading.
        inAcadXData = String(tag.value).trim() === 'ACAD';
        inDStyle = false;
        depth = 0;
        pendingCode = null;
        continue;
      }
      if (!inAcadXData) continue;

      if (code === 1000 && String(tag.value).trim() === 'DSTYLE') {
        inDStyle = true;
        continue;
      }
      if (!inDStyle) continue;

      if (code === 1002) {
        const brace = String(tag.value).trim();
        if (brace === '{') depth++;
        else if (brace === '}') {
          depth--;
          if (depth <= 0) { inDStyle = false; pendingCode = null; }
        }
        continue;
      }
      if (depth <= 0) continue;

      // Inside the block, tags alternate: 1070 <dimvar code>, then its value.
      if (pendingCode === null) {
        if (code === 1070) pendingCode = Number(tag.value);
        continue;
      }
      overrides ??= {};
      applyDimVar(overrides, pendingCode, String(tag.value).trim());
      pendingCode = null;
    }

    if (overrides) out.set(obj.handle, overrides);
  }

  return out;
}
