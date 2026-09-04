import { Injectable, inject } from '@angular/core';
import type { Entity, IPoint } from '../models/entity.model';
import type { DxfFile } from '../models/layer.model';
import { HatchEntity, InsertEntity } from '../models/entity-extended.model';
import { HATCH_PATTERNS } from '../registries/hatch-patterns';
import { DocumentService } from './document.service';
import { translateEntitiesInPlace } from '../../tools/geometry-utils';
import { attDefToDxf, attribToDxf } from '../models/block-attribute.model';
import { decodeMtext, decodeTextCodes } from '../utils/text-control-codes';

/**
 * Port of DXF export functions from 60-export-command-line.js.
 * PDF/PNG export will land in pdf-export.service.ts.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private doc = inject(DocumentService);

  /**
   * Entity-id → hex handle string for the current export session.
   * Populated by `buildDxfString` before entity iteration so that HATCH
   * group-330 source-object refs can reference the handle of any entity in
   * the file, not just the hatch itself.
   */
  private _entityHandles = new Map<number, string>();

  /** Original imported handle -> handle assigned in the current export. */
  private _sourceHandleMap = new Map<string, string>();

  /** The file currently being exported — used by `_resolveHatchLoops` to
   *  look up contributing entities for associative hatches. */
  private _exportFile: DxfFile | null = null;

  entityToDxf(e: Entity, layerName?: string): string {
    const ent = e as any;
    const layer = ent.layer || layerName || '0';
    const colorCode = ent.colorNumber !== undefined ? ent.colorNumber : 256;
    // Group 5 handle — present when the export pass has pre-assigned handles.
    const handle = this._entityHandles.get(ent.id) || ent.handle;
    const h5 = handle ? `5\n${handle}\n` : '';
    // Group 330 owner handle
    const ownerHandle = ent.ownerHandle;
    const h330 = ownerHandle ? `330\n${ownerHandle}\n` : '';
    
    const paperSpace = ent.inPaperSpace ? `67\n1\n` : '';
    const lt = ent.lineType && ent.lineType !== 'ByLayer' ? `6\n${ent.lineType}\n` : '';
    const header = (type: string) => `0\n${type}\n${h5}${h330}${paperSpace}8\n${layer}\n62\n${colorCode}\n${lt}`;

    let s = '';
    switch (ent.type) {
      case 'LINE':
        s = `${header('LINE')}10\n${ent.x1}\n20\n${ent.y1}\n30\n0.0\n11\n${ent.x2}\n21\n${ent.y2}\n31\n0.0\n`;
        break;
      case 'CIRCLE':
        s = `${header('CIRCLE')}10\n${ent.cx}\n20\n${ent.cy}\n30\n0.0\n40\n${ent.r}\n`;
        break;
      case 'ARC': {
        const sa = ((ent.startAngle % 360) + 360) % 360;
        const ea = ((ent.endAngle % 360) + 360) % 360;
        s = `${header('ARC')}10\n${ent.cx}\n20\n${ent.cy}\n30\n0.0\n40\n${ent.r}\n50\n${sa}\n51\n${ea}\n`;
        break;
      }
      case 'POLYLINE': {
        const closed = ent.closed ? 1 : 0;
        s = `${header('LWPOLYLINE')}90\n${ent.pts.length}\n70\n${closed}\n`;
        // Per-vertex widths (40/41) and bulge (42) ride along with each point so
        // arrowheads and arcs survive a save instead of flattening to hairlines.
        ent.pts.forEach((p: IPoint, i: number) => {
          s += `10\n${p.x}\n20\n${p.y}\n`;
          const w = ent.widths?.[i];
          if (w && (w.start > 0 || w.end > 0)) s += `40\n${w.start}\n41\n${w.end}\n`;
          const bulge = ent.bulges?.[i] ?? 0;
          if (bulge) s += `42\n${bulge}\n`;
        });
        break;
      }
      case 'TEXT': {
        const h = ent.height || 2.5;
        const justify = typeof ent.justify === 'string' ? ent.justify : 'BL';
        // Write back the source string when the import decoded control codes
        // out of it, so `%%UHALF ELEVATION` survives a round-trip instead of
        // being flattened to plain text with the underline silently dropped.
        const body = this._sourceTextFor(ent);
        // Group 7 — the STYLE table entry, without which a reader has no way to
        // recover the font.
        const styleStr = ent.styleName ? `7\n${ent.styleName}\n` : '';

        if (ent.isMText) {
          // Group 50 on MTEXT is radians per the spec, unlike TEXT's degrees.
          const rot = ent.rotation || 0;
          const attachMap: Record<string, number> = { TL: 1, TC: 2, TR: 3, ML: 4, MC: 5, MR: 6, BL: 7, BC: 8, BR: 9 };
          const attach = attachMap[justify] || 7;
          s = `${header('MTEXT')}100\nAcDbMText\n10\n${ent.x}\n20\n${ent.y}\n30\n0.0\n40\n${h}\n41\n${ent.mtextWidth || 0}\n71\n${attach}\n72\n1\n1\n${body}\n${styleStr}50\n${rot}\n`;
        } else {
          const rot = (ent.rotation || 0) * (180 / Math.PI);
          const halign = justify[1] === 'R' ? 2 : justify[1] === 'C' ? 1 : 0;
          const valign = justify[0] === 'T' ? 3 : justify[0] === 'M' ? 2 : 0;
          const alignPoint = halign !== 0 || valign !== 0
            ? `11\n${ent.x}\n21\n${ent.y}\n31\n0.0\n`
            : '';
          const widthStr = ent.widthFactor && ent.widthFactor !== 1 ? `41\n${ent.widthFactor}\n` : '';
          const obliqueStr = ent.obliqueAngle ? `51\n${ent.obliqueAngle * 180 / Math.PI}\n` : '';
          s = `${header('TEXT')}10\n${ent.x}\n20\n${ent.y}\n30\n0.0\n40\n${h}\n1\n${body}\n${styleStr}${widthStr}50\n${rot}\n${obliqueStr}72\n${halign}\n73\n${valign}\n${alignPoint}`;
        }
        break;
      }
      case 'POINT':
        s = `${header('POINT')}10\n${ent.x}\n20\n${ent.y}\n30\n0.0\n`;
        break;
      case 'ELLIPSE': {
        const major = { x: ent.rx * Math.cos(ent.rotation), y: ent.rx * Math.sin(ent.rotation) };
        const ratio = ent.ry / ent.rx;
        const sa = ent.startAngle ?? 0;
        const ea = ent.endAngle ?? (Math.PI * 2);
        s = `${header('ELLIPSE')}10\n${ent.cx}\n20\n${ent.cy}\n30\n0.0\n11\n${major.x}\n21\n${major.y}\n31\n0.0\n40\n${ratio}\n41\n${sa}\n42\n${ea}\n`;
        break;
      }
      case 'SPLINE': {
        const pts = ent.fitPoints?.length ? ent.fitPoints : ent.controlPoints;
        if (!pts?.length || pts.length < 2) return '';
        const degree = ent.degree || 3;
        const knots = ent.knots || [];
        s = `${header('SPLINE')}70\n0\n71\n${degree}\n72\n${knots.length}\n73\n${pts.length}\n74\n${ent.fitPoints?.length || 0}\n`;
        for (const k of knots) s += `40\n${k}\n`;
        for (const p of pts) s += `10\n${p.x}\n20\n${p.y}\n30\n0.0\n`;
        break;
      }

      case 'HATCH':
        s = this._hatchToDxf(e as HatchEntity, layer, colorCode);
        break;

      case 'XLINE': {
        // AutoCAD XLINE: base point + unit direction vector.
        const ux = Math.cos(ent.angle);
        const uy = Math.sin(ent.angle);
        s = `${header('XLINE')}10\n${ent.x}\n20\n${ent.y}\n30\n0.0\n11\n${ux}\n21\n${uy}\n31\n0.0\n`;
        break;
      }

      case 'INSERT': {
        const ins = e as InsertEntity;
        const hasAttribs = ins.attribs.length > 0;
        s = `${header('INSERT')}${hasAttribs ? '66\n1\n' : ''}2\n${ins.blockName}\n10\n${ins.x}\n20\n${ins.y}\n30\n0.0\n41\n${ins.sx}\n42\n${ins.sy}\n43\n1.0\n50\n${ins.rotation}\n`;
        if (hasAttribs) {
          for (const att of ins.attribs) s += attribToDxf(att, layer);
          s += `0\nSEQEND\n8\n${layer}\n`;
        }
        break;
      }

      case 'VIEWPORT': {
        const vp = e as any;
        s = `${header('VIEWPORT')}10\n${vp.cx}\n20\n${vp.cy}\n30\n0.0\n40\n${vp.width}\n41\n${vp.height}\n68\n1\n69\n1\n12\n${vp.viewCenterX}\n22\n${vp.viewCenterY}\n45\n${vp.viewHeight}\n`;
        break;
      }

      case 'MLEADER':
      case 'LEADER': {
        const lead = e as any;
        // Group 71: Arrow head flag, 72: Path type (0=Straight), 73: Creation flag (3=Default)
        let leaderDxf = `${header('LEADER')}100\nAcDbLeader\n3\nStandard\n71\n1\n72\n0\n73\n3\n74\n0\n75\n0\n40\n${lead.height || 2.5}\n41\n0.0\n76\n${lead.pts?.length || 0}\n`;
        if (lead.pts) {
          for (const p of lead.pts) leaderDxf += `10\n${p.x}\n20\n${p.y}\n30\n0.0\n`;
        }
        if (lead.textRotationOverride != null) {
          const rotDeg = lead.textRotationOverride * 180 / Math.PI;
          leaderDxf += `50\n${rotDeg}\n`;
        }
        s = leaderDxf;
        break;
      }

      case 'DIMENSION': {
        const dim = e as any;
        const text = dim.textOverride || '';
        let rotStr = '';
        if (dim.textRotationOverride != null) {
          const rotDeg = dim.textRotationOverride * 180 / Math.PI;
          rotStr = `51\n${rotDeg}\n`;
        }
        
        if (dim.jogPoint) {
          // Jogged Radius Dimension (AcDbRadialDimensionLarge)
          // 70 = 36 (Type 4: Radius + Bit 32: Default block)
          const textMidX = dim.textPoint?.x ?? dim.overrideCenter.x;
          const textMidY = dim.textPoint?.y ?? dim.overrideCenter.y;
          s = `${header('DIMENSION')}100\nAcDbDimension\n2\n*D0\n10\n${dim.overrideCenter.x}\n20\n${dim.overrideCenter.y}\n30\n0.0\n11\n${textMidX}\n21\n${textMidY}\n31\n0.0\n70\n36\n1\n${text}\n3\n${dim.styleName || 'Standard'}\n${rotStr}100\nAcDbRadialDimensionLarge\n15\n${dim.arcPoint.x}\n25\n${dim.arcPoint.y}\n35\n0.0\n13\n${dim.trueCenter.x}\n23\n${dim.trueCenter.y}\n33\n0.0\n14\n${dim.jogPoint.x}\n24\n${dim.jogPoint.y}\n34\n0.0\n`;
        } else {
          // Linear / aligned dimension.
          // Group 11 is where the text actually sits. Emitting the bare
          // midpoint of p1-p2 instead would discard the placement on every
          // save — including the placement the file was imported with.
          const textMidX = dim.textPoint?.x ?? (dim.p1.x + dim.p2.x) / 2;
          const textMidY = dim.textPoint?.y ?? (dim.p1.y + dim.p2.y) / 2;
          const dlpX = dim.dimLinePoint?.x || 0;
          const dlpY = dim.dimLinePoint?.y || 0;
          // A non-null rotation means a rotated linear dimension: base type 0,
          // with its measurement axis in group 50 and the AcDbRotatedDimension
          // subclass after AcDbAlignedDimension. A null rotation is aligned,
          // base type 1. Bit 32 additionally marks group 11 as authoritative.
          const isRotated = typeof dim.rotation === 'number';
          const flags = (isRotated ? 0 : 1) | (dim.textPoint ? 32 : 0);
          const rotatedTail = isRotated
            ? `50\n${dim.rotation * 180 / Math.PI}\n100\nAcDbRotatedDimension\n`
            : '';
          s = `${header('DIMENSION')}100\nAcDbDimension\n2\n*D0\n10\n${dlpX}\n20\n${dlpY}\n30\n0.0\n11\n${textMidX}\n21\n${textMidY}\n31\n0.0\n70\n${flags}\n1\n${text}\n3\n${dim.styleName || 'Standard'}\n${rotStr}100\nAcDbAlignedDimension\n13\n${dim.p1.x}\n23\n${dim.p1.y}\n33\n0.0\n14\n${dim.p2.x}\n24\n${dim.p2.y}\n34\n0.0\n${rotatedTail}`;
        }
        // DIMLFAC / DIMSCALE ride out as the same DSTYLE XDATA AutoCAD uses, so
        // a re-import reads back the values this one was rendered with.
        s += this._serializeDimStyleOverrides(dim);
        break;
      }

      default:
        return '';
    }

    if (s && ent.rawDxfObject) {
      s += this._serializePreservedMetadata(ent.rawDxfObject);
    }
    return s;
  }

  /**
   * The string to write as a text entity's group 1.
   *
   * Imported text keeps its original control codes in `rawText` so a save can
   * emit exactly what it read. But `text` is what the user edits, and an edited
   * entity's `rawText` is stale — writing it back would silently discard the
   * edit. So the original is only reused when decoding it still reproduces the
   * current text; otherwise the edited text wins and the codes are dropped,
   * which is the lossy-but-honest outcome.
   */
  private _sourceTextFor(ent: any): string {
    const raw = ent.rawText;
    if (typeof raw !== 'string' || !raw.length) return ent.text ?? '';
    const decoded = ent.isMText
      ? decodeTextCodes(decodeMtext(raw).text).text
      : decodeTextCodes(raw).text;
    return decoded === ent.text ? raw : (ent.text ?? '');
  }

  /**
   * Emits a dimension's DIMLFAC / DIMSCALE overrides as DSTYLE XDATA — the same
   * encoding AutoCAD uses, so the values survive a round-trip through any
   * reader rather than living only in this app's own format.
   *
   * Skipped when the entity still carries its imported raw tags, since
   * `_serializePreservedMetadata` re-emits the original XDATA and two DSTYLE
   * blocks on one entity would be malformed.
   */
  private _serializeDimStyleOverrides(dim: any): string {
    const hasPreservedXData = Array.isArray(dim.rawDxfObject?.originalTags)
      && dim.rawDxfObject.originalTags.some((t: any) => Number(t.code) === 1001);
    if (hasPreservedXData) return '';

    const parts: string[] = [];
    if (typeof dim.linearFactor === 'number' && dim.linearFactor > 0 && dim.linearFactor !== 1) {
      parts.push(`1070\n144\n1040\n${dim.linearFactor}\n`);
    }
    if (typeof dim.globalScale === 'number' && dim.globalScale > 0 && dim.globalScale !== 1) {
      parts.push(`1070\n40\n1040\n${dim.globalScale}\n`);
    }
    if (!parts.length) return '';
    return `1001\nACAD\n1000\nDSTYLE\n1002\n{\n${parts.join('')}1002\n}\n`;
  }

  private _serializePreservedMetadata(rawObj: any): string {
    if (!rawObj || !Array.isArray(rawObj.originalTags)) return '';
    let out = '';
    let in102 = false;

    for (const tag of rawObj.originalTags) {
      if (tag.code === 102 && typeof tag.value === 'string' && tag.value.startsWith('{')) {
        in102 = true;
      }
      
      if (in102) {
        out += `${tag.code}\n${tag.value}\n`;
        if (tag.code === 102 && typeof tag.value === 'string' && tag.value.startsWith('}')) {
          in102 = false;
        }
      } else if (tag.code >= 1000) {
        // All group codes >= 1000 are XDATA
        out += `${tag.code}\n${tag.value}\n`;
      }
    }
    return out;
  }

  buildDxfString(file: DxfFile): string {
    // ── Coordinate round-trip ──────────────────────────────────────────────
    // If the file was imported with coordinate normalization (large source
    // coords shifted near origin so the editor could handle them precisely),
    // shift entities back to the original world placement before emitting,
    // then restore the editor state afterwards. The shift is symmetric so any
    // exception still leaves the model consistent (try/finally below).
    const offset = file.importOffset;
    if (offset && (offset.x !== 0 || offset.y !== 0)) {
      translateEntitiesInPlace(file.entities, offset.x, offset.y);
    }
    try {
      return this._buildDxfStringInner(file);
    } finally {
      if (offset && (offset.x !== 0 || offset.y !== 0)) {
        translateEntitiesInPlace(file.entities, -offset.x, -offset.y);
      }
    }
  }

  private _buildDxfStringInner(file: DxfFile): string {
    // ── Handle pre-assignment ──────────────────────────────────────────────
    // Every entity in the file gets a sequential hex handle so that:
    //   (a) the exported DXF is more spec-compliant (group 5 present)
    //   (b) HATCH group-330 source-object refs can reference boundary entities
    this._exportFile = file;
    let hc = 1;
    this._entityHandles = new Map<number, string>();
    this._sourceHandleMap = new Map<string, string>();
    const assignHandles = (ents: Entity[]) => {
      for (const e of ents) {
        const assigned = (hc++).toString(16).toUpperCase();
        this._entityHandles.set(e.id, assigned);
        if (typeof (e as any).handle === 'string' && (e as any).handle.length) {
          this._sourceHandleMap.set((e as any).handle, assigned);
        }
      }
    };
    for (const [, block] of file.blocks) {
      if (!block.name?.startsWith?.('*')) assignHandles(block.entities);
    }
    assignHandles(file.entities);

    let dxf = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n`;
    if (file.metadata) {
      if (file.metadata.units) dxf += `9\n$INSUNITS\n70\n${file.metadata.units}\n`;
    }
    dxf += `0\nENDSEC\n`;
    dxf += `0\nSECTION\n2\nTABLES\n`;

    dxf += `0\nTABLE\n2\nLAYER\n70\n${file.layers.size}\n`;
    for (const [name, lay] of file.layers) {
      const flags = lay.frozen ? 1 : lay.visible === false ? 64 : 0;
      // A layer that is off is encoded as a negative colour, not a flag.
      const colorNum = lay.colorNumber || 7;
      const signedColor = lay.visible === false ? -Math.abs(colorNum) : colorNum;
      const lwStr = lay.lineWeight > 0 ? `370\n${lay.lineWeight}\n` : '';
      dxf += `0\nLAYER\n2\n${name}\n70\n${flags}\n62\n${signedColor}\n6\n${lay.lineType || 'Continuous'}\n${lwStr}`;
    }
    dxf += `0\nENDTAB\n`;

    // STYLE table. Without it a re-import has no font information at all, which
    // is precisely the gap that made imported drawings render in one typeface.
    const textStyles = file.textStyles ?? new Map();
    if (textStyles.size) {
      dxf += `0\nTABLE\n2\nSTYLE\n70\n${textStyles.size}\n`;
      for (const [name, st] of textStyles) {
        dxf += `0\nSTYLE\n2\n${name}\n70\n0\n40\n${st.fixedHeight ?? 0}\n`
          + `41\n${st.widthFactor ?? 1}\n50\n${st.obliqueAngle ?? 0}\n71\n0\n42\n2.5\n`
          + `3\n${st.font ?? 'arial.ttf'}\n4\n${st.bigFont ?? ''}\n`;
      }
      dxf += `0\nENDTAB\n`;
    }

    // DIMSTYLE table, so dimension precision and DIMLFAC survive the round-trip.
    if (file.dimStyles?.size) {
      dxf += `0\nTABLE\n2\nDIMSTYLE\n70\n${file.dimStyles.size}\n`;
      for (const [name, ds] of file.dimStyles) {
        const d = ds as any;
        dxf += `0\nDIMSTYLE\n2\n${name}\n70\n0\n`
          + `41\n${d.arrowSize ?? 2.5}\n42\n${d.extensionGap ?? 0.625}\n44\n${d.extensionPast ?? 1.25}\n`
          + `140\n${d.textHeight ?? 2.5}\n147\n${d.textOffset ?? 0.625}\n`
          + `40\n${d.globalScale ?? 1}\n144\n${d.linearFactor ?? 1}\n271\n${d.unitPrecision ?? 2}\n`;
      }
      dxf += `0\nENDTAB\n`;
    }

    dxf += `0\nTABLE\n2\nLTYPE\n70\n2\n`;
    dxf += `0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n`;
    dxf += `0\nLTYPE\n2\nDASHED\n70\n0\n3\nDashed __ __ __ __ __ __ __ __ __ __ __ __ __ _\n72\n65\n73\n2\n40\n0.5\n49\n0.25\n49\n-0.25\n`;
    dxf += `0\nENDTAB\n`;

    let userBlocksCount = 0;
    for (const [blockName] of file.blocks) {
      if (!blockName.startsWith('*')) userBlocksCount++;
    }
    dxf += `0\nTABLE\n2\nBLOCK_RECORD\n70\n${userBlocksCount + 2}\n`;
    dxf += `0\nBLOCK_RECORD\n2\n*Model_Space\n`;
    dxf += `0\nBLOCK_RECORD\n2\n*Paper_Space\n`;
    for (const [blockName, block] of file.blocks) {
      if (blockName.startsWith('*')) continue;
      dxf += `0\nBLOCK_RECORD\n2\n${blockName}\n`;
    }
    dxf += `0\nENDTAB\n`;

    dxf += `0\nENDSEC\n`;

    dxf += `0\nSECTION\n2\nBLOCKS\n`;
    dxf += `0\nBLOCK\n8\n0\n2\n*Model_Space\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n*Model_Space\n1\n\n0\nENDBLK\n8\n0\n`;
    dxf += `0\nBLOCK\n8\n0\n2\n*Paper_Space\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n*Paper_Space\n1\n\n0\nENDBLK\n8\n0\n`;
    for (const [blockName, block] of file.blocks) {
      if (blockName.startsWith('*')) continue;
      dxf += `0\nBLOCK\n8\n0\n2\n${blockName}\n70\n0\n10\n${block.basePoint.x}\n20\n${block.basePoint.y}\n30\n0.0\n3\n${blockName}\n1\n\n`;
      for (const e of block.entities) dxf += this.entityToDxf(e, '0');
      if (block.attDefs) {
        for (const att of block.attDefs) dxf += attDefToDxf(att, '0');
      }
      dxf += `0\nENDBLK\n8\n0\n`;
    }
    dxf += `0\nENDSEC\n`;

    dxf += `0\nSECTION\n2\nENTITIES\n`;
    const sortedEntities = [...file.entities].sort((a, b) => a.drawOrder - b.drawOrder);
    for (const e of sortedEntities) dxf += this.entityToDxf(e, e.layer);
    
    // Dump raw unparsed entities (e.g. Proxy objects, unsupported geometries)
    if (file.rawUnparsedEntities) {
      for (const ro of file.rawUnparsedEntities) {
        for (const tag of ro.originalTags) {
          dxf += `${tag.code}\n${tag.value}\n`;
        }
      }
    }
    
    dxf += `0\nENDSEC\n`;
    dxf += `0\nEOF\n`;
    return dxf;
  }

  /** Build a DXF string for the given view (or active file). */
  exportDXFView(fileId?: string): string {
    const file = fileId ? this.doc.files.find((f) => f.id === fileId) ?? this.doc.activeFile : this.doc.activeFile;
    return this.buildDxfString(file);
  }

  downloadDxf(): void {
    const file = this.doc.activeFile;
    if (!file) return;
    const dxfString = this.buildDxfString(file);
    const blob = new Blob([dxfString], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = (file.name || 'drawing').replace(/\.dxf$/i, '') + '.dxf';
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ─── HATCH-specific helpers ──────────────────────────────────────────── */

  /**
   * Emit a full DXF HATCH entity with AcDbHatch subclass markers.
   *
   * Boundary geometry is sourced in priority order:
   *   1. `boundarySpec.loops[].frozen` — exact polygon stored by Phase 3+
   *   2. `boundarySpec` associative → tessellate contributing entities
   *   3. Legacy `boundaries: IHatchEdge[][]` — from DXF import or old code
   *
   * All boundary loops are emitted as LINE edge sequences (group 72 = 1)
   * forming closed polygons. Curved geometry (circles, ellipses) is
   * tessellated to line segments during export; the internal model retains
   * full parametric curves.
   *
   * Group 330 source-object refs are emitted for associative hatches when
   * every contributing entity was assigned a handle during this export pass.
   */
  private _hatchToDxf(hatch: HatchEntity, layer: string, colorCode: number): string {
    const loops = this._resolveHatchLoops(hatch);
    const preserved = hatch.dxfHatch;
    const preservedPaths = preserved?.boundaryPaths ?? [];
    if (!loops.length && !preservedPaths.length) return '';

    const handle = this._entityHandles.get(hatch.id);
    const h5 = handle ? `5\n${handle}\n` : '';
    const solid = hatch.solid || hatch.pattern === 'SOLID';

    // Can we output group-330 associativity refs?
    const spec = hatch.boundarySpec;
    const canEmitSourceRefs =
      spec?.associative === true &&
      spec.contributingEntityIds.length > 0 &&
      spec.contributingEntityIds.every((id) => this._entityHandles.has(id));
    const canEmitPreservedRefs =
      preserved?.pattern.associative === true &&
      preservedPaths.every((path) => path.sourceBoundaryHandles.every((h) => this._sourceHandleMap.has(h)));
    const assocFlag = canEmitSourceRefs || canEmitPreservedRefs ? 1 : 0;

    let s = `0\nHATCH\n${h5}8\n${layer}\n62\n${colorCode}\n`;
    // AcDbEntity and AcDbHatch subclass markers (required for R2000+ HATCH parsing)
    s += `100\nAcDbEntity\n8\n${layer}\n`;
    s += `100\nAcDbHatch\n`;
    const elevation = preserved?.elevation ?? { x: 0, y: 0, z: 0 };
    const extrusion = preserved?.extrusion ?? { x: 0, y: 0, z: 1 };
    s += `10\n${elevation.x}\n20\n${elevation.y}\n30\n${elevation.z}\n`;
    s += `210\n${extrusion.x}\n220\n${extrusion.y}\n230\n${extrusion.z}\n`;
    s += `2\n${solid ? 'SOLID' : (hatch.pattern || 'ANSI31')}\n`;
    s += `70\n${solid ? 1 : 0}\n`;       // solid fill flag
    s += `71\n${assocFlag}\n`;            // associativity flag
    s += `91\n${preservedPaths.length || loops.length}\n`; // number of boundary paths

    if (preservedPaths.length) {
      for (const path of preservedPaths) s += this._preservedHatchPathToDxf(path, canEmitPreservedRefs);
    } else for (const loop of loops) {
      const pts = loop.polygon;
      const n = pts.length;

      // Path type bit-flags:
      //   bit 0 (1)  = default — always set
      //   bit 1 (2)  = external boundary (outer loop)
      //   bit 3 (8)  = derived (associative, references source objects)
      //   bit 5 (32) = outermost — synonym for external in many readers
      let pathFlags = 1;
      if (loop.role === 'outer') pathFlags |= 2 | 32;
      if (canEmitSourceRefs) pathFlags |= 8;
      s += `92\n${pathFlags}\n`;

      // Edge count — one LINE edge per consecutive vertex pair in the polygon
      s += `93\n${n}\n`;
      for (let j = 0; j < n; j++) {
        const a = pts[j];
        const b = pts[(j + 1) % n];
        s += `72\n1\n`;                   // edge type: LINE
        s += `10\n${a.x}\n20\n${a.y}\n`;
        s += `11\n${b.x}\n21\n${b.y}\n`;
      }

      // Group-330 source-object refs — only on the outer loop (AutoCAD convention)
      if (canEmitSourceRefs && loop.role === 'outer') {
        const ids = spec!.contributingEntityIds;
        s += `97\n${ids.length}\n`;
        for (const id of ids) s += `330\n${this._entityHandles.get(id)!}\n`;
      } else {
        s += `97\n0\n`;
      }
    }

    // Hatch style (group 75): 0=normal, 1=outer, 2=ignore
    const styleCode =
      hatch.hatchStyle === 'Outer' ? 1 : hatch.hatchStyle === 'Ignore' ? 2 : 0;
    s += `75\n${styleCode}\n`;
    // Pattern type (group 76): 0=user-defined, 1=predefined, 2=custom
    const ptCode =
      hatch.patternType === 'User-defined' ? 0 : hatch.patternType === 'Custom' ? 2 : 1;
    s += `76\n${ptCode}\n`;
    s += `52\n${hatch.angle || 0}\n`;     // pattern angle (degrees)
    s += `41\n${hatch.scale || 1}\n`;     // pattern scale
    s += `77\n${hatch.doubleHatch ? 1 : 0}\n`;

    // Pattern definition lines (group 78 = count; then per-line data)
    const patDef = !solid ? HATCH_PATTERNS[hatch.pattern] : null;
    const patLines = !solid
      ? (preserved?.pattern.definitionLines?.length
          ? preserved.pattern.definitionLines
          : hatch.customPatternLines?.length
            ? hatch.customPatternLines
            : patDef?.lines ?? [])
      : [];
    s += `78\n${patLines.length}\n`;
    for (const line of patLines) {
      s += `53\n${line.angle}\n`;                  // line angle
      s += `43\n${line.x0}\n44\n${line.y0}\n`;    // base point
      s += `45\n${line.dx}\n46\n${line.dy}\n`;    // offsets
      s += `79\n${line.dashArray.length}\n`;
      for (const d of line.dashArray) s += `49\n${d}\n`;
    }

    s += `47\n${preserved?.pixelSize ?? 0}\n`;

    const seeds = preserved?.seedPoints?.length
      ? preserved.seedPoints
      : [spec?.seedPoint ?? loops[0]?.polygon[0] ?? { x: 0, y: 0 }];
    s += `98\n${seeds.length}\n`;
    for (const seed of seeds) s += `10\n${seed.x}\n20\n${seed.y}\n`;

    // Gradient properties (AutoCAD 2004+)
    s += this._hatchGradientToDxf(hatch, preserved?.gradient);

    return s;
  }

  /** Serialize an imported boundary path without degrading it into line edges. */
  private _preservedHatchPathToDxf(path: any, preserveRefs: boolean): string {
    let s = `92\n${path.flags}\n`;
    if (path.kind === 'polyline') {
      s += `72\n${path.hasBulges ? 1 : 0}\n73\n${path.closed ? 1 : 0}\n93\n${path.vertices.length}\n`;
      for (const vertex of path.vertices) {
        s += `10\n${vertex.point.x}\n20\n${vertex.point.y}\n`;
        if (vertex.bulge !== undefined) s += `42\n${vertex.bulge}\n`;
      }
    } else {
      s += `93\n${path.edges.length}\n`;
      for (const edge of path.edges) {
        if (edge.kind === 'line') {
          s += `72\n1\n10\n${edge.start.x}\n20\n${edge.start.y}\n11\n${edge.end.x}\n21\n${edge.end.y}\n`;
        } else if (edge.kind === 'arc') {
          s += `72\n2\n10\n${edge.center.x}\n20\n${edge.center.y}\n40\n${edge.radius}\n50\n${edge.startAngleDeg}\n51\n${edge.endAngleDeg}\n73\n${edge.counterClockwise ? 1 : 0}\n`;
        } else if (edge.kind === 'ellipse') {
          s += `72\n3\n10\n${edge.center.x}\n20\n${edge.center.y}\n11\n${edge.majorAxisEndPoint.x}\n21\n${edge.majorAxisEndPoint.y}\n40\n${edge.axisRatio}\n50\n${edge.startAngle}\n51\n${edge.endAngle}\n73\n${edge.counterClockwise ? 1 : 0}\n`;
        } else if (edge.kind === 'spline') {
          s += `72\n4\n94\n${edge.degree}\n73\n${edge.rational ? 1 : 0}\n74\n${edge.periodic ? 1 : 0}\n95\n${edge.knots.length}\n96\n${edge.controlPoints.length}\n`;
          for (const knot of edge.knots) s += `40\n${knot}\n`;
          for (const point of edge.controlPoints) s += `10\n${point.x}\n20\n${point.y}\n`;
          for (const weight of edge.weights) s += `42\n${weight}\n`;
          s += `97\n${edge.fitPoints.length}\n`;
          for (const point of edge.fitPoints) s += `11\n${point.x}\n21\n${point.y}\n`;
          if (edge.startTangent) s += `12\n${edge.startTangent.x}\n22\n${edge.startTangent.y}\n`;
          if (edge.endTangent) s += `13\n${edge.endTangent.x}\n23\n${edge.endTangent.y}\n`;
        }
      }
    }
    const handles = preserveRefs ? path.sourceBoundaryHandles.map((h: string) => this._sourceHandleMap.get(h)!) : [];
    s += `97\n${handles.length}\n`;
    for (const handle of handles) s += `330\n${handle}\n`;
    return s;
  }

  private _hatchGradientToDxf(hatch: HatchEntity, preserved?: any): string {
    if (preserved) {
      let s = `450\n${preserved.isGradient ? 1 : 0}\n451\n${preserved.reserved451}\n`;
      s += `460\n${preserved.angleRad}\n461\n${preserved.centeredShift}\n452\n${preserved.singleColor ? 1 : 0}\n462\n${preserved.tint}\n`;
      s += `453\n${preserved.colors.length}\n`;
      for (const color of preserved.colors) {
        s += `463\n${color.shift}\n`;
        if (color.aci !== undefined) s += `63\n${color.aci}\n`;
        if (color.trueColor !== undefined) s += `421\n${color.trueColor}\n`;
      }
      return s + `470\n${preserved.name}\n`;
    }
    if (!hatch.gradientType) return '';
    const color = (value: string | undefined): number => value?.startsWith('#') ? parseInt(value.slice(1), 16) : 0xffffff;
    const colors = hatch.gradientSingleColor ? [color(hatch.gradientColor1)] : [color(hatch.gradientColor1), color(hatch.gradientColor2)];
    let s = `450\n1\n451\n0\n460\n${(hatch.gradientAngle || 0) * Math.PI / 180}\n461\n${hatch.gradientShift || 0}\n452\n${hatch.gradientSingleColor ? 1 : 0}\n462\n0\n453\n${colors.length}\n`;
    for (const rgb of colors) s += `463\n0\n63\n7\n421\n${rgb}\n`;
    return s + `470\n${hatch.gradientType.toUpperCase()}\n`;
  }

  /**
   * Extract the renderable polygon loops from a HatchEntity, in priority order:
   *   1. Frozen `boundarySpec` loops (fastest, no entity lookup)
   *   2. Associative `boundarySpec` → tessellate contributing entities
   *   3. Legacy `boundaries: IHatchEdge[][]`
   */
  private _resolveHatchLoops(
    hatch: HatchEntity,
  ): { polygon: IPoint[]; role: 'outer' | 'island' }[] {
    const spec = hatch.boundarySpec;

    // Priority 1: frozen spec
    if (spec && !spec.associative) {
      const result: { polygon: IPoint[]; role: 'outer' | 'island' }[] = [];
      for (const loop of spec.loops) {
        const pts = (loop.frozen ?? []).map((edge: any) => ({
          x: edge.p0.x as number,
          y: edge.p0.y as number,
        }));
        if (pts.length >= 3) result.push({ polygon: pts, role: loop.role });
      }
      if (result.length) return result;
    }

    // Priority 2: associative spec → tessellate contributing entity outlines
    if (spec?.associative && this._exportFile) {
      const entityMap = new Map(this._exportFile.entities.map((e: any) => [e.id, e]));
      const result: { polygon: IPoint[]; role: 'outer' | 'island' }[] = [];
      for (const id of spec.contributingEntityIds) {
        const ent = entityMap.get(id);
        if (!ent) continue;
        const pts = this._tessellateEntityOutline(ent);
        if (pts && pts.length >= 3) result.push({ polygon: pts, role: 'outer' });
      }
      if (result.length) return result;
    }

    // Priority 3: legacy IHatchEdge[][]
    if ((hatch as any).boundaries?.length) {
      const boundaries: any[][] = (hatch as any).boundaries;
      return boundaries
        .map((edges, i) => ({
          polygon: legacyEdgesToPolygon(edges),
          role: (i === 0 ? 'outer' : 'island') as 'outer' | 'island',
        }))
        .filter((loop) => loop.polygon.length >= 3);
    }

    return [];
  }

  /**
   * Produce a closed polygon from a single boundary entity for use in the
   * associative hatch DXF export path. Returns null for unsupported types
   * (INSERT, TEXT, etc.) — those are skipped by the caller.
   */
  private _tessellateEntityOutline(e: Entity): IPoint[] | null {
    const ent = e as any;
    const N = 64;
    switch (ent.type) {
      case 'CIRCLE': {
        const pts: IPoint[] = [];
        for (let i = 0; i < N; i++) {
          const t = (i / N) * Math.PI * 2;
          pts.push({ x: ent.cx + ent.r * Math.cos(t), y: ent.cy + ent.r * Math.sin(t) });
        }
        return pts;
      }
      case 'POLYLINE':
        return ent.pts?.length ? (ent.pts as IPoint[]).map((p: IPoint) => ({ x: p.x, y: p.y })) : null;
      case 'ELLIPSE': {
        const cos = Math.cos(ent.rotation || 0);
        const sin = Math.sin(ent.rotation || 0);
        const pts: IPoint[] = [];
        for (let i = 0; i < N; i++) {
          const t = (i / N) * Math.PI * 2;
          const lx = ent.rx * Math.cos(t);
          const ly = ent.ry * Math.sin(t);
          pts.push({ x: ent.cx + lx * cos - ly * sin, y: ent.cy + lx * sin + ly * cos });
        }
        return pts;
      }
      default:
        return null;
    }
  }
}

/**
 * Convert a legacy `IHatchEdge[]` loop to a flat `IPoint[]` polygon by
 * reading the `start` field of each edge (and `vertices` for polyline edges).
 */
function legacyEdgesToPolygon(edges: any[]): IPoint[] {
  const pts: IPoint[] = [];
  for (const edge of edges) {
    if (edge.start && Number.isFinite(edge.start.x)) {
      pts.push({ x: edge.start.x, y: edge.start.y });
    } else if (Array.isArray(edge.vertices)) {
      for (const v of edge.vertices) {
        if (Number.isFinite(v?.x) && Number.isFinite(v?.y)) pts.push({ x: v.x, y: v.y });
      }
    }
  }
  return pts.filter(
    (p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y,
  );
}
