import type { DxfFile } from '../models/layer.model';
import type { Entity, IPoint } from '../models/entity.model';

/**
 * Serializes editor Entity instances into the bridge "drafting entity" JSON
 * format consumed by DxfImportService._loadFromJsonEntities.
 *
 * Lossless round-trip goals:
 *   • ELLIPSE/SPLINE keep native geometry (not sampled to polylines)
 *   • HATCH keeps every boundary loop + gradient/solid metadata
 *   • XLINE, LEADER, POINT preserved natively
 *   • TEXT carries font, widthFactor, obliqueAngle, isMText
 *   • INSERT references recursively flattened with full affine transform
 */

/** Affine transform used when flattening INSERT→block hierarchies. */
interface Xf {
  /** Transform a block-local point to the parent coordinate system. */
  pt(lx: number, ly: number): { x: number; y: number };
  /** Transform a vector (no translation), for axes, offsets and tangents. */
  vec(lx: number, ly: number): { x: number; y: number };
  /** Scale a scalar length (radius, height, etc.) by the uniform scale factor. */
  len(d: number): number;
  /** Accumulated rotation in radians — added to angle-bearing entities. */
  rot: number;
}

const IDENTITY: Xf = {
  pt: (x, y) => ({ x, y }),
  vec: (x, y) => ({ x, y }),
  len: (d) => d,
  rot: 0,
};

function makeInsertXf(
  tx: number, ty: number,
  sx: number, sy: number,
  rotDeg: number,
  bpx: number, bpy: number,
): Xf {
  const rad  = (rotDeg * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  const avgScale = (Math.abs(sx) + Math.abs(sy)) / 2;
  return {
    pt(lx, ly) {
      const lxb = (lx - bpx) * sx;
      const lyb = (ly - bpy) * sy;
      return {
        x: tx + lxb * cosR - lyb * sinR,
        y: ty + lxb * sinR + lyb * cosR,
      };
    },
    vec(lx, ly) {
      const vx = lx * sx;
      const vy = ly * sy;
      return { x: vx * cosR - vy * sinR, y: vx * sinR + vy * cosR };
    },
    len: (d) => d * avgScale,
    rot: rad,
  };
}

function composeXf(outer: Xf, inner: Xf): Xf {
  return {
    pt(lx, ly) {
      const p = inner.pt(lx, ly);
      return outer.pt(p.x, p.y);
    },
    vec(lx, ly) {
      const v = inner.vec(lx, ly);
      return outer.vec(v.x, v.y);
    },
    len: (d) => outer.len(inner.len(d)),
    rot: outer.rot + inner.rot,
  };
}

export class EntityJsonSerializer {

  /** Serialize every entity in `file` to a JSON payload object.
   *  INSERT references are recursively expanded so all geometry is captured. */
  static serializeFile(file: DxfFile): { entities: any[] } {
    const out: any[] = [];
    EntityJsonSerializer._flatten(file.entities, file, IDENTITY, out, 0);
    return { entities: out };
  }

  // ── Recursive flattener ────────────────────────────────────────────────────

  private static _flatten(
    entities: Entity[],
    file: DxfFile,
    xf: Xf,
    out: any[],
    depth: number,
  ): void {
    if (depth > 12) return; // guard against circular block references

    for (const e of entities) {
      if (e.type === 'INSERT') {
        const ie = e as any;
        // Resolve block definition from cached ref or file.blocks map
        const blockDef: { basePoint?: { x: number; y: number }; entities?: Entity[] } | undefined
          = file.blocks.get(ie.blockName) ?? ie._blockDef ?? undefined;
        if (!blockDef?.entities?.length) continue;

        const bp  = blockDef.basePoint ?? { x: 0, y: 0 };
        const ins = makeInsertXf(
          ie.x ?? 0, ie.y ?? 0,
          ie.sx ?? 1, ie.sy ?? 1,
          ie.rotation ?? 0,
          bp.x, bp.y,
        );
        EntityJsonSerializer._flatten(blockDef.entities, file, composeXf(xf, ins), out, depth + 1);
      } else {
        const json = EntityJsonSerializer._entity(e, file, xf);
        if (json) out.push(json);
      }
    }
  }

  // ── Per-entity serializer ─────────────────────────────────────────────────

  private static _entity(e: Entity, file: DxfFile, xf: Xf): any | null {
    const layerRef = EntityJsonSerializer._color(e, file);
    const lineType = EntityJsonSerializer._lt(e);
    const base     = { id: EntityJsonSerializer._uuid(), sourceEntityId: null, metadata: {}, layerRef };
    const P = (x: number, y: number) => ({ ...xf.pt(x, y), z: 0 });

    switch (e.type) {

      case 'LINE': {
        const le = e as any;
        return { ...base, start: P(le.x1, le.y1), end: P(le.x2, le.y2), lineType, draftingType: 'Line' };
      }

      case 'POLYLINE':
      case 'LWPOLYLINE': {
        const pe = e as any;
        const pts: IPoint[]    = pe.pts ?? [];
        const bulges: number[] = pe.bulges ?? [];
        if (pts.length < 2) return null;
        return {
          ...base,
          vertices: pts.map((p, i) => ({ point: P(p.x, p.y), bulge: bulges[i] ?? 0 })),
          isClosed: !!pe.closed,
          lineType,
          draftingType: 'CADPolyline',
        };
      }

      case 'TEXT':
      case 'MTEXT': {
        const te = e as any;
        const j: string = te.justify ?? 'BL';
        const h = j[1] === 'L' ? 'left' : j[1] === 'R' ? 'right' : 'center';
        const v = j[0] === 'T' ? 'top'  : j[0] === 'M' ? 'middle' : 'bottom';
        return {
          ...base,
          text:         te.text ?? '',
          position:     P(te.x, te.y),
          height:       xf.len(te.height ?? 200),
          alignment:    h,
          baseline:     v,
          justify:       j,
          halign:       te.halign ?? (h === 'left' ? 0 : h === 'right' ? 2 : 1),
          valign:       te.valign ?? (v === 'top' ? 3 : v === 'middle' ? 2 : v === 'bottom' ? 1 : 0),
          rotation:     (te.rotation ?? 0) + xf.rot,
          isMText:      !!te.isMText || e.type === 'MTEXT',
          mtextWidth:   xf.len(te.mtextWidth ?? 0),
          font:         te.font ?? null,
          widthFactor:  te.widthFactor ?? 1,
          obliqueAngle: te.obliqueAngle ?? 0,
          bold:         !!te.bold,
          italic:       !!te.italic,
          underline:    !!te.underline,
          textStyle:    'NOTE_STYLE',
          draftingType: 'Text',
        };
      }

      case 'ARC': {
        const ae = e as any;
        const c = xf.pt(ae.cx, ae.cy);
        const rotDeg = xf.rot * 180 / Math.PI;
        return {
          ...base,
          center:     { ...c, z: 0 },
          radius:     xf.len(ae.r),
          startAngle: ((ae.startAngle ?? 0) + rotDeg) * Math.PI / 180,
          endAngle:   ((ae.endAngle   ?? 0) + rotDeg) * Math.PI / 180,
          lineType,
          draftingType: 'Arc',
        };
      }

      case 'CIRCLE': {
        const ce = e as any;
        const c = xf.pt(ce.cx, ce.cy);
        return {
          ...base,
          center: { ...c, z: 0 },
          radius: xf.len(ce.r),
          lineType,
          draftingType: 'Circle',
        };
      }

      // Ellipse kept as native type — no approximation.
      case 'ELLIPSE': {
        const ee = e as any;
        const c = xf.pt(ee.cx ?? 0, ee.cy ?? 0);
        return {
          ...base,
          center:     { ...c, z: 0 },
          rx:         xf.len(ee.rx ?? 0),
          ry:         xf.len(ee.ry ?? ee.rx ?? 0),
          rotation:   (ee.rotation ?? 0) + xf.rot,
          startAngle: ee.startAngle ?? 0,
          endAngle:   ee.endAngle ?? (Math.PI * 2),
          lineType,
          draftingType: 'Ellipse',
        };
      }

      // Spline kept as native type — control points + knots preserved.
      case 'SPLINE': {
        const se = e as any;
        const cps: IPoint[] = se.controlPoints ?? [];
        if (cps.length < 2) return null;
        return {
          ...base,
          controlPoints: cps.map(p => P(p.x, p.y)),
          knots:         Array.isArray(se.knots) ? [...se.knots] : [],
          degree:        se.degree ?? 3,
          lineType,
          draftingType:  'Spline',
        };
      }

      case 'POINT': {
        const po = e as any;
        return { ...base, position: P(po.x, po.y), lineType, draftingType: 'Point' };
      }

      case 'XLINE': {
        const xe = e as any;
        return {
          ...base,
          position: P(xe.x, xe.y),
          angle:    (xe.angle ?? 0) + xf.rot,
          lineType,
          draftingType: 'XLine',
        };
      }

      case 'LEADER': {
        const la = e as any;
        const leaderPts: IPoint[] = la.pts ?? [];
        if (leaderPts.length < 1) return null;
        return {
          ...base,
          vertices:  leaderPts.map(p => P(p.x, p.y)),
          text:      la.text ?? '',
          height:    xf.len(la.height ?? 2.5),
          arrowSize: xf.len(la.arrowSize ?? 2.5),
          arrowType: la.arrowType ?? 'closed',
          font:      la.font ?? null,
          lineType,
          draftingType: 'Leader',
        };
      }

      case 'HATCH': {
        const he = e as any;
        const loops: any[][] = he.boundaries ?? [];
        // Preserve ALL boundary loops (outer boundary + islands).
        const boundaryLoops: Array<Array<{ x: number; y: number; z: number }>> = [];
        for (const loop of loops) {
          const ring: IPoint[] = [];
          for (const edge of loop) {
            if (Array.isArray(edge.vertices)) ring.push(...edge.vertices);
            else if (edge.start) ring.push(edge.start);
          }
          if (ring.length >= 3) boundaryLoops.push(ring.map(p => P(p.x, p.y)));
        }
        if (!boundaryLoops.length) return null;
        return {
          ...base,
          // First loop for backward compat with loaders that only read boundaryPoints.
          boundaryPoints: boundaryLoops[0],
          // Full multi-loop boundary (outer + islands).
          boundaryLoops,
          patternName:    he.pattern ?? 'SOLID',
          scale:          xf.len(he.scale ?? 1),
          angle:          (he.angle ?? 0) + xf.rot * 180 / Math.PI,
          solid:          !!he.solid,
          hatchStyle:     he.hatchStyle ?? 'Normal',
          gradientType:   he.gradientType   ?? null,
          gradientColor1: he.gradientColor1 ?? null,
          gradientColor2: he.gradientColor2 ?? null,
          gradientAngle:  he.gradientAngle  ?? 0,
          patternType:    he.patternType ?? 'Predefined',
          doubleHatch:    !!he.doubleHatch,
          associative:    !!he.associative,
          // A displayed polygon is not enough to re-create a DXF hatch. Keep
          // the source pattern lines and the complete typed/raw HATCH payload
          // so JSON is a lossless hand-off format rather than a render cache.
          patternDefinitionLines: he.customPatternLines
            ? he.customPatternLines.map((line: any) => ({ ...line, dashArray: [...line.dashArray] }))
            : [],
          dxfHatch: he.dxfHatch ? transformDxfHatchForJson(he.dxfHatch, xf) : null,
          draftingType: 'Hatch',
        };
      }

      case 'DIMENSION': {
        const de = e as any;
        if (!de.p1 || !de.p2) return null;
        const p1 = xf.pt(de.p1.x, de.p1.y);
        const p2 = xf.pt(de.p2.x, de.p2.y);
        const dl = de.dimLinePoint ? xf.pt(de.dimLinePoint.x, de.dimLinePoint.y) : p1;
        return {
          ...base,
          p1:           { ...p1, z: 0 },
          p2:           { ...p2, z: 0 },
          textLoc:      { ...dl, z: 0 },
          realValueMm:  de.length ?? 0,
          textOverride: de.textOverride ?? null,
          styleName:    de.styleName ?? 'Standard',
          dimType:      'LINEAR',
          isVert:       false,
          drawingScale: 100,
          draftingType: 'AagentoDimension',
        };
      }

      default:
        return null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private static _color(e: Entity, file: DxfFile): string {
    if (e.color && typeof e.color === 'string') return e.color;
    const lay = file.layers?.get(e.layer);
    return lay?.color || '#000000';
  }

  private static _lt(e: Entity): string {
    const up = (e.lineType ?? '').toUpperCase();
    if (up === 'DASHED')             return 'DASHED';
    if (up === 'DOT' || up === 'DOTTED') return 'DOTTED';
    if (up === 'CENTER')             return 'CENTER';
    return 'CONTINUOUS';
  }

  private static _uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

/** Transform a lossless HATCH payload when an INSERT is flattened to JSON. */
function transformDxfHatchForJson(source: any, xf: Xf): any {
  const hatch = JSON.parse(JSON.stringify(source));
  const point = (p: any) => xf.pt(p.x, p.y);
  const vector = (p: any) => xf.vec(p.x, p.y);
  const originalScale = Number(hatch.pattern?.scale) || 1;
  const scale = xf.len(originalScale);

  if (hatch.elevation) Object.assign(hatch.elevation, point(hatch.elevation));
  for (const seed of hatch.seedPoints ?? []) Object.assign(seed, point(seed));
  for (const path of hatch.boundaryPaths ?? []) {
    if (path.kind === 'polyline') {
      for (const vertex of path.vertices ?? []) Object.assign(vertex.point, point(vertex.point));
      continue;
    }
    for (const edge of path.edges ?? []) {
      if (edge.kind === 'line') {
        Object.assign(edge.start, point(edge.start)); Object.assign(edge.end, point(edge.end));
      } else if (edge.kind === 'arc') {
        Object.assign(edge.center, point(edge.center));
        edge.radius = xf.len(edge.radius);
        edge.startAngleDeg += xf.rot * 180 / Math.PI; edge.endAngleDeg += xf.rot * 180 / Math.PI;
      } else if (edge.kind === 'ellipse') {
        Object.assign(edge.center, point(edge.center)); Object.assign(edge.majorAxisEndPoint, vector(edge.majorAxisEndPoint));
        edge.startAngle += xf.rot * 180 / Math.PI; edge.endAngle += xf.rot * 180 / Math.PI;
      } else if (edge.kind === 'spline') {
        for (const p of edge.controlPoints ?? []) Object.assign(p, point(p));
        for (const p of edge.fitPoints ?? []) Object.assign(p, point(p));
        if (edge.startTangent) Object.assign(edge.startTangent, vector(edge.startTangent));
        if (edge.endTangent) Object.assign(edge.endTangent, vector(edge.endTangent));
      }
    }
  }
  if (hatch.pattern) {
    hatch.pattern.angle += xf.rot * 180 / Math.PI;
    hatch.pattern.scale = scale;
    for (const line of hatch.pattern.definitionLines ?? []) {
      const base = xf.pt(line.x0 * originalScale, line.y0 * originalScale);
      line.x0 = base.x / scale; line.y0 = base.y / scale;
      line.angle += xf.rot * 180 / Math.PI;
    }
  }
  return hatch;
}
