/**
 * Entity handlers for record types `dxf-parser` ships no support for.
 *
 * Its `dist/entities/` directory covers LINE, ARC, CIRCLE, TEXT, MTEXT,
 * DIMENSION, INSERT, LWPOLYLINE, POLYLINE, VERTEX, POINT, SOLID, SPLINE,
 * ELLIPSE, ATTDEF and 3DFACE. Everything else is skipped silently, which is
 * why an imported drawing could be missing its tables and attribute values
 * with no error anywhere.
 *
 * Registered alongside `DxfHatchHandler` in the parser worker.
 */

/** A minimal DXF group, matching the dxf-parser scanner contract. */
interface IDxfGroup {
  code: number;
  value: any;
}

/** The subset of dxf-parser's scanner used by an entity handler. */
interface IDxfScanner {
  next(): IDxfGroup;
  isEOF(): boolean;
  lastReadGroup: IDxfGroup;
}

/** Drains one entity record into a flat group list. */
function drain(scanner: IDxfScanner): IDxfGroup[] {
  const groups: IDxfGroup[] = [];
  let next = scanner.next();
  while (!scanner.isEOF()) {
    if (next.code === 0) break;
    groups.push({ code: next.code, value: next.value });
    next = scanner.next();
  }
  return groups;
}

/** Copies the groups every entity shares onto the parsed object. */
function applyCommon(entity: any, g: IDxfGroup): boolean {
  switch (g.code) {
    case 5:   entity.handle = g.value; return true;
    case 6:   entity.lineType = g.value; return true;
    case 8:   entity.layer = g.value; return true;
    case 48:  entity.lineTypeScale = Number(g.value); return true;
    case 62:  entity.colorIndex = Number(g.value); return true;
    case 67:  entity.inPaperSpace = Number(g.value) !== 0; return true;
    case 330: if (!entity.ownerHandle) entity.ownerHandle = g.value; return true;
    case 370: entity.lineweight = Number(g.value); return true;
    default:  return false;
  }
}

/**
 * ATTRIB — a block attribute's *value*, as placed in the drawing.
 *
 * Without this, only the ATTDEF templates survive an import and every block
 * instance shows its prompt text rather than the value the drawing carries.
 * The layout groups mirror TEXT, since ATTRIB is a TEXT subclass.
 */
export class DxfAttribHandler {
  readonly ForEntityName = 'ATTRIB';

  parseEntity(scanner: IDxfScanner, curr: IDxfGroup): any {
    const entity: any = { type: curr.value };
    for (const g of drain(scanner)) {
      if (applyCommon(entity, g)) continue;
      switch (g.code) {
        case 1:  entity.text = g.value; break;          // value
        case 2:  entity.tag = g.value; break;           // attribute tag
        case 7:  entity.styleName = g.value; break;
        case 10: entity.startPoint = { x: Number(g.value), y: 0, z: 0 }; break;
        case 20: if (entity.startPoint) entity.startPoint.y = Number(g.value); break;
        case 30: if (entity.startPoint) entity.startPoint.z = Number(g.value); break;
        case 11: entity.endPoint = { x: Number(g.value), y: 0, z: 0 }; break;
        case 21: if (entity.endPoint) entity.endPoint.y = Number(g.value); break;
        case 31: if (entity.endPoint) entity.endPoint.z = Number(g.value); break;
        case 40: entity.textHeight = Number(g.value); break;
        case 41: entity.xScale = Number(g.value); break;
        case 50: entity.rotation = Number(g.value); break;
        case 51: entity.obliqueAngle = Number(g.value); break;
        case 70: entity.attributeFlags = Number(g.value); break;
        case 72: entity.halign = Number(g.value); break;
        case 74: entity.valign = Number(g.value); break;
        default: break;
      }
    }
    return entity;
  }
}

/**
 * VIEWPORT — a paper-space window onto model space.
 *
 * `width`/`height`/`center` are named to match what `DxfImportService`'s
 * VIEWPORT branch already expects, so no import change is needed.
 */
export class DxfViewportHandler {
  readonly ForEntityName = 'VIEWPORT';

  parseEntity(scanner: IDxfScanner, curr: IDxfGroup): any {
    const entity: any = { type: curr.value };
    for (const g of drain(scanner)) {
      if (applyCommon(entity, g)) continue;
      switch (g.code) {
        case 10: entity.center = { x: Number(g.value), y: 0, z: 0 }; break;
        case 20: if (entity.center) entity.center.y = Number(g.value); break;
        case 30: if (entity.center) entity.center.z = Number(g.value); break;
        case 40: entity.width = Number(g.value); break;
        case 41: entity.height = Number(g.value); break;
        case 68: entity.status = Number(g.value); break;
        case 69: entity.viewportId = Number(g.value); break;
        case 12: entity.viewCenter = { x: Number(g.value), y: 0 }; break;
        case 22: if (entity.viewCenter) entity.viewCenter.y = Number(g.value); break;
        case 17: entity.viewTarget = { x: Number(g.value), y: 0, z: 0 }; break;
        case 27: if (entity.viewTarget) entity.viewTarget.y = Number(g.value); break;
        case 37: if (entity.viewTarget) entity.viewTarget.z = Number(g.value); break;
        case 45: entity.viewHeight = Number(g.value); break;
        default: break;
      }
    }
    return entity;
  }
}

/**
 * ACAD_TABLE — a table (title blocks, revision histories, signature blocks).
 *
 * The full table model lives in binary group-310 chunks, which is far more than
 * is needed to draw it: AutoCAD also writes the table's rendered geometry to an
 * anonymous `*T<n>` block and stores an `AcDbBlockReference` on the entity. So
 * this reports the record as an INSERT of that block, which renders the table
 * exactly as AutoCAD drew it.
 *
 * Falls back to `null` when there is no block reference — better to drop the
 * record than to emit an INSERT pointing at nothing.
 */
export class DxfAcadTableHandler {
  readonly ForEntityName = 'ACAD_TABLE';

  parseEntity(scanner: IDxfScanner, curr: IDxfGroup): any {
    const entity: any = { type: 'INSERT', acadTable: true };
    let sawBlockReference = false;

    for (const g of drain(scanner)) {
      if (applyCommon(entity, g)) continue;
      switch (g.code) {
        case 100:
          if (g.value === 'AcDbBlockReference') sawBlockReference = true;
          break;
        case 2:  entity.name = g.value; break;      // the *T<n> block
        case 10: entity.position = { x: Number(g.value), y: 0, z: 0 }; break;
        case 20: if (entity.position) entity.position.y = Number(g.value); break;
        case 30: if (entity.position) entity.position.z = Number(g.value); break;
        // 41/42/43 are deliberately not read: in the AcDbTable subclass those
        // codes carry column widths, not insert scales. The *T block is
        // generated at final size, so scale 1 is correct anyway.
        default: break;
      }
    }

    if (!sawBlockReference || !entity.name || !entity.position) return null;
    return entity;
  }
}
