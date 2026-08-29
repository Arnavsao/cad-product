import type { IPoint } from '../models/entity.model';
import type {
  IDxfHatchArcEdge,
  IDxfHatchData,
  IDxfHatchEdge,
  IDxfHatchEdgePath,
  IDxfHatchEllipseEdge,
  IDxfHatchGradient,
  IDxfHatchLineEdge,
  IDxfHatchPatternLine,
  IDxfHatchPolylinePath,
  IDxfHatchSplineEdge,
} from '../models/entity-extended.model';

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

const DEG2RAD = Math.PI / 180;

/**
 * Lossless HATCH handler for dxf-parser.
 *
 * HATCH is a context-sensitive counted format: code 10 can mean elevation,
 * a polyline vertex, a line/arc center, a spline control point, or a seed
 * point.  This handler therefore drains the record once, then parses each
 * counted section structurally instead of flattening repeated group codes.
 */
export class DxfHatchHandler {
  readonly ForEntityName = 'HATCH';

  parseEntity(scanner: IDxfScanner, curr: IDxfGroup): any {
    const groups: IDxfGroup[] = [];
    let next = scanner.next();
    while (!scanner.isEOF()) {
      if (next.code === 0) break;
      groups.push({ code: next.code, value: next.value });
      next = scanner.next();
    }

    const entity: any = { type: curr.value };
    this._parseGroups(entity, groups);
    return entity;
  }

  private _parseGroups(entity: any, groups: IDxfGroup[]): void {
    const hatch: IDxfHatchData = {
      schemaVersion: 1,
      rawTags: [{ code: 0, value: 'HATCH' }, ...groups.map((g) => ({ code: g.code, value: g.value }))],
      elevation: { x: 0, y: 0, z: 0 },
      extrusion: { x: 0, y: 0, z: 1 },
      pattern: {
        name: 'SOLID', solidFill: true, associative: false,
        style: 0, type: 1, angle: 0, scale: 1, double: false,
        definitionLines: [],
      },
      boundaryPaths: [],
      seedPoints: [],
      parseWarnings: [],
    };
    const legacyBoundaries: any[] = [];

    let i = 0;
    while (i < groups.length) {
      const g = groups[i];
      switch (g.code) {
        // Common entity fields used by DxfImportService. The entire original
        // sequence is still retained in hatch.rawTags, including unknown tags.
        case 5: entity.handle = String(g.value); i++; break;
        case 330: entity.ownerHandle = String(g.value); i++; break;
        case 6: entity.lineType = String(g.value); i++; break;
        case 8: entity.layer = String(g.value); i++; break;
        case 48: entity.lineTypeScale = this._num(g.value, 1); i++; break;
        case 60: entity.visible = this._num(g.value, 0) === 0; i++; break;
        case 62: entity.colorIndex = this._num(g.value, 256); i++; break;
        case 370: entity.lineweight = this._num(g.value, -1); i++; break;
        case 420: entity.color = this._num(g.value, 0); i++; break;
        case 440: entity.transparency = this._num(g.value, 0); i++; break;

        // Hatch plane (OCS).
        case 10:
          if (i + 2 < groups.length && groups[i + 1].code === 20 && groups[i + 2].code === 30) {
            hatch.elevation = {
              x: this._num(g.value),
              y: this._num(groups[i + 1].value),
              z: this._num(groups[i + 2].value),
            };
            i += 3;
          } else i++;
          break;
        case 210:
          if (i + 2 < groups.length && groups[i + 1].code === 220 && groups[i + 2].code === 230) {
            hatch.extrusion = {
              x: this._num(g.value),
              y: this._num(groups[i + 1].value),
              z: this._num(groups[i + 2].value, 1),
            };
            i += 3;
          } else i++;
          break;

        case 2: hatch.pattern.name = String(g.value); entity.patternName = hatch.pattern.name; i++; break;
        case 70: hatch.pattern.solidFill = this._num(g.value) !== 0; entity.solid = hatch.pattern.solidFill; i++; break;
        case 71: hatch.pattern.associative = this._num(g.value) !== 0; entity.associative = hatch.pattern.associative; i++; break;
        case 75: hatch.pattern.style = this._num(g.value); entity.hatchStyle = hatch.pattern.style; i++; break;
        case 76: hatch.pattern.type = this._num(g.value); entity.patternType = hatch.pattern.type; i++; break;
        case 52: hatch.pattern.angle = this._num(g.value); entity.patternAngle = hatch.pattern.angle; i++; break;
        case 41: hatch.pattern.scale = this._num(g.value, 1); entity.patternScale = hatch.pattern.scale; i++; break;
        case 77: hatch.pattern.double = this._num(g.value) !== 0; entity.doubleHatch = hatch.pattern.double; i++; break;

        case 91:
          i = this._parseBoundaryPaths(groups, i + 1, this._num(g.value), hatch, legacyBoundaries);
          break;
        case 78:
          i = this._parsePatternLines(groups, i + 1, this._num(g.value), hatch.pattern.definitionLines, hatch.parseWarnings);
          break;
        case 47: hatch.pixelSize = this._num(g.value); i++; break;
        case 98:
          i = this._parseSeedPoints(groups, i + 1, this._num(g.value), hatch.seedPoints, hatch.parseWarnings);
          break;
        case 450:
          i = this._parseGradient(groups, i, hatch);
          break;
        default:
          i++;
          break;
      }
    }

    entity.patternDefinitionLines = hatch.pattern.definitionLines;
    entity.boundaries = legacyBoundaries;
    entity.dxfHatch = hatch;
  }

  private _parseBoundaryPaths(
    groups: IDxfGroup[],
    start: number,
    count: number,
    hatch: IDxfHatchData,
    legacy: any[],
  ): number {
    let i = start;
    for (let pathIndex = 0; pathIndex < count; pathIndex++) {
      if (groups[i]?.code !== 92) {
        hatch.parseWarnings.push(`Boundary path ${pathIndex + 1}/${count} is missing group 92.`);
        break;
      }
      const flags = this._num(groups[i].value);
      i++;
      const parsed = (flags & 2) !== 0
        ? this._parsePolylinePath(groups, i, flags, hatch.parseWarnings)
        : this._parseEdgePath(groups, i, flags, hatch.parseWarnings);
      i = parsed.next;
      const refs = this._parseSourceHandles(groups, i, hatch.parseWarnings);
      i = refs.next;
      parsed.path.sourceBoundaryHandles = refs.handles;
      hatch.boundaryPaths.push(parsed.path);
      legacy.push(parsed.legacy);
    }
    return i;
  }

  private _parsePolylinePath(
    groups: IDxfGroup[],
    start: number,
    flags: number,
    warnings: string[],
  ): { next: number; path: IDxfHatchPolylinePath; legacy: any } {
    let i = start;
    let hasBulges = false;
    let closed = false;
    let count = 0;
    if (groups[i]?.code === 72) { hasBulges = this._num(groups[i].value) !== 0; i++; }
    else warnings.push('Polyline HATCH path is missing group 72.');
    if (groups[i]?.code === 73) { closed = this._num(groups[i].value) !== 0; i++; }
    else warnings.push('Polyline HATCH path is missing group 73.');
    if (groups[i]?.code === 93) { count = this._num(groups[i].value); i++; }
    else warnings.push('Polyline HATCH path is missing group 93.');

    const vertices: IDxfHatchPolylinePath['vertices'] = [];
    for (let n = 0; n < count; n++) {
      const point = this._readPoint(groups, i, 10, 20);
      if (!point.value) {
        warnings.push(`Polyline HATCH path ended after ${n}/${count} vertices.`);
        i = point.next;
        break;
      }
      i = point.next;
      let bulge: number | undefined;
      if (groups[i]?.code === 42) {
        bulge = this._num(groups[i].value);
        i++;
      }
      vertices.push({ point: point.value, ...(bulge !== undefined ? { bulge } : {}) });
    }

    const path: IDxfHatchPolylinePath = {
      kind: 'polyline', flags, hasBulges, closed, vertices, sourceBoundaryHandles: [],
    };
    return {
      next: i,
      path,
      legacy: {
        polyline: {
          vertices: vertices.map((v) => ({ x: v.point.x, y: v.point.y, bulge: v.bulge ?? 0 })),
          closed,
          hasBulges,
        },
      },
    };
  }

  private _parseEdgePath(
    groups: IDxfGroup[],
    start: number,
    flags: number,
    warnings: string[],
  ): { next: number; path: IDxfHatchEdgePath; legacy: any } {
    let i = start;
    if (groups[i]?.code !== 93) {
      warnings.push('Edge HATCH path is missing group 93.');
      return { next: i, path: { kind: 'edges', flags, edges: [], sourceBoundaryHandles: [] }, legacy: { edges: [] } };
    }
    const count = this._num(groups[i].value);
    i++;
    const edges: IDxfHatchEdge[] = [];
    const legacyEdges: any[] = [];

    for (let edgeIndex = 0; edgeIndex < count; edgeIndex++) {
      if (groups[i]?.code !== 72) {
        warnings.push(`Edge HATCH path is missing type group 72 at edge ${edgeIndex + 1}/${count}.`);
        break;
      }
      const type = this._num(groups[i].value);
      i++;
      const parsed = this._parseEdge(groups, i, type, warnings);
      if (!parsed) break;
      i = parsed.next;
      edges.push(parsed.edge);
      legacyEdges.push(parsed.legacy);
    }

    return {
      next: i,
      path: { kind: 'edges', flags, edges, sourceBoundaryHandles: [] },
      legacy: { edges: legacyEdges },
    };
  }

  private _parseEdge(
    groups: IDxfGroup[],
    start: number,
    type: number,
    warnings: string[],
  ): { next: number; edge: IDxfHatchEdge; legacy: any } | null {
    let i = start;
    if (type === 1) {
      const startPoint = this._readPoint(groups, i, 10, 20); i = startPoint.next;
      const endPoint = this._readPoint(groups, i, 11, 21); i = endPoint.next;
      if (!startPoint.value || !endPoint.value) {
        warnings.push('Line HATCH edge is missing a start or end point.');
        return null;
      }
      const edge: IDxfHatchLineEdge = { kind: 'line', start: startPoint.value, end: endPoint.value };
      return { next: i, edge, legacy: { type: 'LINE', start: edge.start, end: edge.end } };
    }
    if (type === 2) {
      const center = this._readPoint(groups, i, 10, 20); i = center.next;
      const radius = this._readNumber(groups, i, 40); i = radius.next;
      const startAngle = this._readNumber(groups, i, 50); i = startAngle.next;
      const endAngle = this._readNumber(groups, i, 51); i = endAngle.next;
      let counterClockwise = true;
      if (groups[i]?.code === 73) { counterClockwise = this._num(groups[i].value) !== 0; i++; }
      if (!center.value || radius.value === null || startAngle.value === null || endAngle.value === null) {
        warnings.push('Arc HATCH edge is incomplete.');
        return null;
      }
      const edge: IDxfHatchArcEdge = {
        kind: 'arc', center: center.value, radius: radius.value,
        startAngleDeg: startAngle.value, endAngleDeg: endAngle.value, counterClockwise,
      };
      return {
        next: i,
        edge,
        legacy: {
          type: 'ARC', center: edge.center, radius: edge.radius,
          startAngle: edge.startAngleDeg * DEG2RAD, endAngle: edge.endAngleDeg * DEG2RAD,
          isCcw: edge.counterClockwise,
        },
      };
    }
    if (type === 3) {
      const center = this._readPoint(groups, i, 10, 20); i = center.next;
      const major = this._readPoint(groups, i, 11, 21); i = major.next;
      const ratio = this._readNumber(groups, i, 40); i = ratio.next;
      const startAngle = this._readNumber(groups, i, 50); i = startAngle.next;
      const endAngle = this._readNumber(groups, i, 51); i = endAngle.next;
      let counterClockwise = true;
      if (groups[i]?.code === 73) { counterClockwise = this._num(groups[i].value) !== 0; i++; }
      if (!center.value || !major.value || ratio.value === null || startAngle.value === null || endAngle.value === null) {
        warnings.push('Ellipse HATCH edge is incomplete.');
        return null;
      }
      const edge: IDxfHatchEllipseEdge = {
        kind: 'ellipse', center: center.value, majorAxisEndPoint: major.value,
        axisRatio: ratio.value, startAngle: startAngle.value, endAngle: endAngle.value, counterClockwise,
      };
      return {
        next: i,
        edge,
        legacy: {
          type: 'ELLIPSE', center: edge.center, majorAxisEndPoint: edge.majorAxisEndPoint,
          axisRatio: edge.axisRatio, startAngle: edge.startAngle * DEG2RAD,
          endAngle: edge.endAngle * DEG2RAD, isCcw: edge.counterClockwise,
        },
      };
    }
    if (type === 4) return this._parseSplineEdge(groups, i, warnings);
    warnings.push(`Unsupported HATCH edge type ${type}.`);
    return null;
  }

  private _parseSplineEdge(
    groups: IDxfGroup[],
    start: number,
    warnings: string[],
  ): { next: number; edge: IDxfHatchSplineEdge; legacy: any } | null {
    let i = start;
    const degree = this._take(groups, i, 94); i = degree.next;
    const rational = this._take(groups, i, 73); i = rational.next;
    const periodic = this._take(groups, i, 74); i = periodic.next;
    const knotCount = this._take(groups, i, 95); i = knotCount.next;
    const pointCount = this._take(groups, i, 96); i = pointCount.next;
    if (degree.value === null || rational.value === null || periodic.value === null || knotCount.value === null || pointCount.value === null) {
      warnings.push('Spline HATCH edge header is incomplete.');
      return null;
    }

    const knots: number[] = [];
    for (let n = 0; n < this._num(knotCount.value); n++) {
      const knot = this._readNumber(groups, i, 40); i = knot.next;
      if (knot.value === null) { warnings.push(`Spline HATCH edge ended after ${n} knots.`); break; }
      knots.push(knot.value);
    }
    const controlPoints: IPoint[] = [];
    for (let n = 0; n < this._num(pointCount.value); n++) {
      const point = this._readPoint(groups, i, 10, 20); i = point.next;
      if (!point.value) { warnings.push(`Spline HATCH edge ended after ${n} control points.`); break; }
      controlPoints.push(point.value);
    }
    const weights: number[] = [];
    while (groups[i]?.code === 42 && weights.length < controlPoints.length) {
      weights.push(this._num(groups[i].value, 1));
      i++;
    }
    const fitPoints: IPoint[] = [];
    if (groups[i]?.code === 97) {
      const fitCount = this._num(groups[i].value); i++;
      for (let n = 0; n < fitCount; n++) {
        const point = this._readPoint(groups, i, 11, 21); i = point.next;
        if (!point.value) { warnings.push(`Spline HATCH edge ended after ${n} fit points.`); break; }
        fitPoints.push(point.value);
      }
    }
    const startTangent = this._readPoint(groups, i, 12, 22); i = startTangent.next;
    const endTangent = this._readPoint(groups, i, 13, 23); i = endTangent.next;
    const edge: IDxfHatchSplineEdge = {
      kind: 'spline', degree: this._num(degree.value), rational: this._num(rational.value) !== 0,
      periodic: this._num(periodic.value) !== 0, knots, controlPoints, weights, fitPoints,
      ...(startTangent.value ? { startTangent: startTangent.value } : {}),
      ...(endTangent.value ? { endTangent: endTangent.value } : {}),
    };
    return {
      next: i,
      edge,
      // The renderer's spline edge fallback currently samples the control
      // polygon, while the complete spline definition remains in dxfHatch.
      legacy: { type: 'SPLINE', vertices: controlPoints, degree: edge.degree, knots, weights, fitPoints },
    };
  }

  private _parseSourceHandles(groups: IDxfGroup[], start: number, warnings: string[]): { next: number; handles: string[] } {
    let i = start;
    const handles: string[] = [];
    if (groups[i]?.code !== 97) return { next: i, handles };
    const count = this._num(groups[i].value); i++;
    for (let n = 0; n < count; n++) {
      if (groups[i]?.code !== 330) {
        warnings.push(`HATCH source-boundary list ended after ${n}/${count} handles.`);
        break;
      }
      handles.push(String(groups[i].value));
      i++;
    }
    return { next: i, handles };
  }

  private _parsePatternLines(
    groups: IDxfGroup[], start: number, count: number,
    out: IDxfHatchPatternLine[], warnings: string[],
  ): number {
    let i = start;
    for (let n = 0; n < count; n++) {
      const angle = this._take(groups, i, 53); i = angle.next;
      const x0 = this._take(groups, i, 43); i = x0.next;
      const y0 = this._take(groups, i, 44); i = y0.next;
      const dx = this._take(groups, i, 45); i = dx.next;
      const dy = this._take(groups, i, 46); i = dy.next;
      const dashCount = this._take(groups, i, 79); i = dashCount.next;
      if ([angle, x0, y0, dx, dy, dashCount].some((v) => v.value === null)) {
        warnings.push(`Pattern definition line ${n + 1}/${count} is incomplete.`);
        break;
      }
      const dashArray: number[] = [];
      for (let d = 0; d < this._num(dashCount.value); d++) {
        const dash = this._readNumber(groups, i, 49); i = dash.next;
        if (dash.value === null) { warnings.push(`Pattern line ${n + 1} ended after ${d} dashes.`); break; }
        dashArray.push(dash.value);
      }
      out.push({
        angle: this._num(angle.value), x0: this._num(x0.value), y0: this._num(y0.value),
        dx: this._num(dx.value), dy: this._num(dy.value), dashArray,
      });
    }
    return i;
  }

  private _parseSeedPoints(
    groups: IDxfGroup[], start: number, count: number, out: IPoint[], warnings: string[],
  ): number {
    let i = start;
    for (let n = 0; n < count; n++) {
      const point = this._readPoint(groups, i, 10, 20); i = point.next;
      if (!point.value) { warnings.push(`HATCH seed-point list ended after ${n}/${count} points.`); break; }
      out.push(point.value);
    }
    return i;
  }

  private _parseGradient(groups: IDxfGroup[], start: number, hatch: IDxfHatchData): number {
    let i = start;
    const gradient: IDxfHatchGradient = {
      isGradient: this._num(groups[i].value) === 1,
      reserved451: 0, singleColor: false, angleRad: 0, centeredShift: 0,
      tint: 0, colors: [], name: 'LINEAR',
    };
    i++;
    let expectedColors = 0;
    let currentColor: IDxfHatchGradient['colors'][number] | null = null;
    while (i < groups.length) {
      const g = groups[i];
      if (g.code === 470) { gradient.name = String(g.value); i++; break; }
      if (g.code === 451) gradient.reserved451 = this._num(g.value);
      else if (g.code === 452) gradient.singleColor = this._num(g.value) !== 0;
      else if (g.code === 453) expectedColors = this._num(g.value);
      else if (g.code === 460) gradient.angleRad = this._num(g.value);
      else if (g.code === 461) gradient.centeredShift = this._num(g.value);
      else if (g.code === 462) gradient.tint = this._num(g.value);
      else if (g.code === 463) {
        currentColor = { shift: this._num(g.value) };
        gradient.colors.push(currentColor);
      } else if (g.code === 63 && currentColor) currentColor.aci = this._num(g.value);
      else if (g.code === 421 && currentColor) currentColor.trueColor = this._num(g.value);
      else break;
      i++;
    }
    if (expectedColors !== gradient.colors.length) {
      hatch.parseWarnings.push(`HATCH gradient declares ${expectedColors} colors but contains ${gradient.colors.length}.`);
    }
    hatch.gradient = gradient;
    return i;
  }

  private _readPoint(groups: IDxfGroup[], start: number, xCode: number, yCode: number): { value: IPoint | null; next: number } {
    if (groups[start]?.code !== xCode) return { value: null, next: start };
    const x = this._num(groups[start].value);
    if (groups[start + 1]?.code !== yCode) return { value: null, next: start + 1 };
    return { value: { x, y: this._num(groups[start + 1].value) }, next: start + 2 };
  }

  private _readNumber(groups: IDxfGroup[], start: number, code: number): { value: number | null; next: number } {
    if (groups[start]?.code !== code) return { value: null, next: start };
    return { value: this._num(groups[start].value), next: start + 1 };
  }

  private _take(groups: IDxfGroup[], start: number, code: number): { value: any | null; next: number } {
    if (groups[start]?.code !== code) return { value: null, next: start };
    return { value: groups[start].value, next: start + 1 };
  }

  private _num(value: any, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
}
