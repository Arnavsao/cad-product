import type { DocumentService } from '../services/document.service';
import type { Entity } from '../models/entity.model';

/**
 * "Analyze Drawing Extents" — diagnostic helper for zoom drift / lost geometry.
 *
 * Computes per-type bbox statistics plus a list of suspicious entities. Call
 * via `DocumentService.analyzeExtents()` from the browser console.
 *
 * Suspicious heuristics:
 *   - bbox contains NaN/Infinity
 *   - bbox far from drawing centroid (>5σ in either axis)
 *   - bbox area > 100× median (outsized)
 *   - zero-size bbox (intentional for XLINE/INSERT stubs, flagged as info)
 */
export interface IExtentsReport {
  fileCount: number;
  totalEntities: number;
  visibleEntities: number;
  /** Combined bounds across all visible entities (raw entity bbox, no INSERT recursion). */
  bounds: { minX: number; maxX: number; minY: number; maxY: number; w: number; h: number } | null;
  /** Counts and combined bbox per entity type. */
  perType: Record<string, {
    count: number;
    minX: number; maxX: number; minY: number; maxY: number;
  }>;
  /** Entities flagged for review (sorted worst-first). */
  suspicious: Array<{
    id: number;
    type: string;
    layer: string;
    bbox: { x: number; y: number; w: number; h: number } | null;
    reason: string;
  }>;
}

export function analyzeDrawingExtents(doc: DocumentService): IExtentsReport {
  const perType: IExtentsReport['perType'] = {};
  const allBoxes: Array<{ e: Entity; b: { x: number; y: number; w: number; h: number } }> = [];
  let totalEntities = 0;
  let visibleEntities = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const suspicious: IExtentsReport['suspicious'] = [];

  for (const file of doc.files) {
    for (const e of file.entities) {
      totalEntities++;
      if (!e.visible) continue;
      visibleEntities++;

      const type = (e as any).type ?? 'UNKNOWN';
      const layer = (e as any).layer ?? '';
      let b: { x: number; y: number; w: number; h: number } | null = null;
      try {
        if (typeof e.bbox === 'function') b = e.bbox();
      } catch (err) {
        suspicious.push({ id: e.id, type, layer, bbox: null, reason: `bbox() threw: ${(err as Error).message}` });
        continue;
      }

      if (!b) {
        suspicious.push({ id: e.id, type, layer, bbox: null, reason: 'bbox() returned null' });
        continue;
      }

      const finite = Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h);
      if (!finite) {
        suspicious.push({ id: e.id, type, layer, bbox: b, reason: 'bbox contains NaN/Infinity' });
        continue;
      }

      const slot = perType[type] ?? (perType[type] = { count: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      slot.count++;
      slot.minX = Math.min(slot.minX, b.x);
      slot.maxX = Math.max(slot.maxX, b.x + b.w);
      slot.minY = Math.min(slot.minY, b.y);
      slot.maxY = Math.max(slot.maxY, b.y + b.h);

      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);

      allBoxes.push({ e, b });
    }
  }

  // Statistical outlier detection: anything whose centroid is > 5σ from the median centroid.
  if (allBoxes.length > 3) {
    const cxs = allBoxes.map((bb) => bb.b.x + bb.b.w / 2);
    const cys = allBoxes.map((bb) => bb.b.y + bb.b.h / 2);
    const medianX = median(cxs);
    const medianY = median(cys);
    const mads = (vals: number[], m: number) => median(vals.map((v) => Math.abs(v - m)));
    const madX = Math.max(1e-9, mads(cxs, medianX));
    const madY = Math.max(1e-9, mads(cys, medianY));
    const THRESH = 50; // MAD multiplier — anything beyond is clearly outside the cluster
    for (const { e, b } of allBoxes) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const dxNorm = Math.abs(cx - medianX) / madX;
      const dyNorm = Math.abs(cy - medianY) / madY;
      if (dxNorm > THRESH || dyNorm > THRESH) {
        suspicious.push({
          id: e.id,
          type: (e as any).type,
          layer: (e as any).layer ?? '',
          bbox: b,
          reason: `outlier centroid (${dxNorm.toFixed(0)}× MAD x, ${dyNorm.toFixed(0)}× MAD y) at (${cx.toFixed(1)}, ${cy.toFixed(1)})`,
        });
      }
    }
  }

  // Outsized bbox: > 100× median area
  if (allBoxes.length > 3) {
    const areas = allBoxes.map((bb) => Math.max(0, bb.b.w) * Math.max(0, bb.b.h));
    const medianArea = median(areas);
    if (medianArea > 0) {
      for (const { e, b } of allBoxes) {
        const a = Math.max(0, b.w) * Math.max(0, b.h);
        if (a > medianArea * 100) {
          suspicious.push({
            id: e.id,
            type: (e as any).type,
            layer: (e as any).layer ?? '',
            bbox: b,
            reason: `oversized bbox (${(a / medianArea).toFixed(0)}× median area = ${a.toFixed(0)})`,
          });
        }
      }
    }
  }

  const bounds = allBoxes.length
    ? { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY }
    : null;

  return { fileCount: doc.files.length, totalEntities, visibleEntities, bounds, perType, suspicious };
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Console-friendly pretty-printer. */
export function logExtentsReport(report: IExtentsReport): void {
  console.group('%cDrawing Extents Report', 'font-weight: bold; color: #f0a030');
  console.log('Files:', report.fileCount, '— Entities:', report.totalEntities, `(${report.visibleEntities} visible)`);
  if (report.bounds) {
    const b = report.bounds;
    console.log(`Bounds: X [${b.minX.toFixed(2)} .. ${b.maxX.toFixed(2)}]  Y [${b.minY.toFixed(2)} .. ${b.maxY.toFixed(2)}]  → ${b.w.toFixed(2)} × ${b.h.toFixed(2)}`);
  } else {
    console.warn('No usable entity bboxes — zoomExtents would fall back to reset().');
  }
  if (Object.keys(report.perType).length) {
    console.groupCollapsed('Per-type bounds');
    for (const [type, s] of Object.entries(report.perType)) {
      console.log(`${type.padEnd(10)} ×${String(s.count).padStart(4)}  X [${s.minX.toFixed(1)} .. ${s.maxX.toFixed(1)}]  Y [${s.minY.toFixed(1)} .. ${s.maxY.toFixed(1)}]`);
    }
    console.groupEnd();
  }
  if (report.suspicious.length) {
    console.groupCollapsed(`%c⚠ ${report.suspicious.length} suspicious entities`, 'color: #f56565; font-weight: bold');
    for (const s of report.suspicious) {
      console.log(`#${s.id}  ${s.type}  layer="${s.layer}"  — ${s.reason}`, s.bbox);
    }
    console.groupEnd();
  } else {
    console.log('%c✓ No suspicious entities detected.', 'color: #68d391');
  }
  console.groupEnd();
}

export function getValidDrawingBounds(doc: DocumentService, useSelection = false, log = false): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const items: Array<{ minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number }> = [];

  for (const file of doc.files) {
    if (!file.visible) continue;
    const rad = (file.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const tx = (lx: number, ly: number) => ({
      x: file.x + (lx * file.scale * cos - ly * file.scale * sin),
      y: file.y + (lx * file.scale * sin + ly * file.scale * cos),
    });

    for (const ent of file.entities as Entity[]) {
      if (!ent.visible) continue;
      // Filter out temporary, deleted, or paper-space entities
      if ((ent as any).deleted || (ent as any).isTemporary || (ent as any).inPaperSpace) continue;
      if (useSelection && !ent.selected) continue;

      const lay = file.layers.get(ent.layer);
      // Skip frozen or invisible layers
      if (lay && (lay.frozen || !lay.visible)) continue;

      const b = ent.bbox?.();
      if (!b) continue;

      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.w) || !Number.isFinite(b.h)) continue;
      if (b.w <= 0 || b.h <= 0) continue;

      // Reject massively out of bounds items (e.g. infinite lines with w > 1e7)
      if (b.w > 10000000 || b.h > 10000000) continue;

      if (log) {
        console.log((ent as any).type, ent.id, b);
      }

      const corners = [
        tx(b.x, b.y),
        tx(b.x + b.w, b.y),
        tx(b.x, b.y + b.h),
        tx(b.x + b.w, b.y + b.h),
      ];

      const eminX = Math.min(...corners.map(c => c.x));
      const emaxX = Math.max(...corners.map(c => c.x));
      const eminY = Math.min(...corners.map(c => c.y));
      const emaxY = Math.max(...corners.map(c => c.y));

      items.push({
        minX: eminX,
        maxX: emaxX,
        minY: eminY,
        maxY: emaxY,
        cx: (eminX + emaxX) / 2,
        cy: (eminY + emaxY) / 2,
      });
    }
  }

  if (items.length === 0) return null;

  let validItems = items;
  if (items.length >= 10) {
    const xs = items.map(i => i.cx).sort((a, b) => a - b);
    const ys = items.map(i => i.cy).sort((a, b) => a - b);

    const q1X = xs[Math.floor(xs.length * 0.25)];
    const q3X = xs[Math.floor(xs.length * 0.75)];
    const iqrX = Math.max(q3X - q1X, 1000);

    const q1Y = ys[Math.floor(ys.length * 0.25)];
    const q3Y = ys[Math.floor(ys.length * 0.75)];
    const iqrY = Math.max(q3Y - q1Y, 1000);

    const minCx = q1X - 2.5 * iqrX;
    const maxCx = q3X + 2.5 * iqrX;
    const minCy = q1Y - 2.5 * iqrY;
    const maxCy = q3Y + 2.5 * iqrY;

    const filtered = items.filter(i => i.cx >= minCx && i.cx <= maxCx && i.cy >= minCy && i.cy <= maxCy);
    if (filtered.length > 0) validItems = filtered;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of validItems) {
    if (item.minX < minX) minX = item.minX;
    if (item.maxX > maxX) maxX = item.maxX;
    if (item.minY < minY) minY = item.minY;
    if (item.maxY > maxY) maxY = item.maxY;
  }

  return { minX, minY, maxX, maxY };
}

export function debugExtents(doc: DocumentService): void {
  const results: Array<{ id: number; type: string; layer: string; bbox: any; area: number }> = [];

  for (const file of doc.files) {
    for (const ent of file.entities as Entity[]) {
      const b = ent.bbox?.();
      if (!b) continue;
      
      const area = (b.w > 0 && b.h > 0 && Number.isFinite(b.w) && Number.isFinite(b.h)) ? (b.w * b.h) : 0;
      
      results.push({
        id: ent.id,
        type: (ent as any).type || 'UNKNOWN',
        layer: ent.layer,
        bbox: b,
        area
      });
    }
  }

  results.sort((a, b) => b.area - a.area);

  console.group('%cDebug Extents', 'font-weight: bold; color: #4299e1');
  console.log(`Found ${results.length} entities with bounding boxes. Sorted by area (descending):`);
  console.table(results.map(r => ({
    'Entity ID': r.id,
    'Type': r.type,
    'Layer': r.layer,
    'Area': Math.round(r.area),
    'Bounds': `[${Math.round(r.bbox.x)}, ${Math.round(r.bbox.y)}] ${Math.round(r.bbox.w)}x${Math.round(r.bbox.h)}`
  })));
  console.groupEnd();
}
