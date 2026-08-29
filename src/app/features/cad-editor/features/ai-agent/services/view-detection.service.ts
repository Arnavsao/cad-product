import { Injectable, inject } from '@angular/core';
import { DocumentService } from '../../../core/services/document.service';
import type { Entity, IBBox } from '../../../core/models/entity.model';
import type { DetectedView } from '../models/ai-view.model';

interface BBoxed {
  ent: Entity;
  bb: IBBox;
}

/**
 * ViewDetectionService — clusters model-space entities into logical "views"
 * (plan / elevation / section / detail) by spatial proximity.
 *
 * Algorithm (near-linear):
 *   1. Compute bbox for every top-level entity (skip those without one).
 *   2. Derive an adaptive gap from the median entity extent.
 *   3. Union-Find: bucket each entity's gap-expanded bbox into a uniform grid;
 *      entities sharing a grid cell are unioned. This connects neighbours
 *      without an O(n²) pairwise scan.
 *   4. Group by root → clusters; compute each cluster's combined bbox + a label
 *      taken from the first TEXT/MTEXT member.
 *
 * Results are cached by DocumentService.version() so repeated calls within the
 * same document revision are free.
 */
@Injectable({ providedIn: 'root' })
export class ViewDetectionService {
  private doc = inject(DocumentService);

  private _rev = -1;
  private _cache: DetectedView[] = [];

  detect(): DetectedView[] {
    const rev = this.doc.version();
    if (rev === this._rev) return this._cache;

    const items = this._collectBBoxed();
    this._cache = items.length === 0 ? [] : this._cluster(items);
    this._rev = rev;
    return this._cache;
  }

  /** Find a single view by a loose label or positional keyword. */
  findView(query: string): DetectedView | null {
    const views = this.detect();
    if (views.length === 0) return null;

    const q = query.trim().toLowerCase();

    // 1. Label substring match.
    const byLabel = views.find(v => v.label.toLowerCase().includes(q));
    if (byLabel) return byLabel;

    // 2. Positional keywords.
    if (/\btop\b/.test(q)) return this._extreme(views, v => v.bbox.y + v.bbox.h, 'max');
    if (/\bbottom\b/.test(q)) return this._extreme(views, v => v.bbox.y, 'min');
    if (/\bleft\b/.test(q)) return this._extreme(views, v => v.bbox.x, 'min');
    if (/\bright\b/.test(q)) return this._extreme(views, v => v.bbox.x + v.bbox.w, 'max');
    if (/\b(first|1st)\b/.test(q)) return views[0];
    if (/\b(last)\b/.test(q)) return views[views.length - 1];

    return null;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _collectBBoxed(): BBoxed[] {
    const out: BBoxed[] = [];
    const file = this.doc.activeFile;
    for (const ent of file.entities) {
      const lay = file.layers.get(ent.layer);
      if (lay && (!lay.visible || lay.frozen)) continue;
      const bb = typeof ent.bbox === 'function' ? ent.bbox() : null;
      if (bb && isFinite(bb.x) && isFinite(bb.y) && isFinite(bb.w) && isFinite(bb.h)) {
        out.push({ ent, bb });
      }
    }
    return out;
  }

  private _cluster(items: BBoxed[]): DetectedView[] {
    const n = items.length;

    // Adaptive gap from median extent.
    const extents = items.map(i => Math.max(i.bb.w, i.bb.h)).sort((a, b) => a - b);
    const median = extents[Math.floor(extents.length / 2)] || 1;
    const gap = Math.max(median * 1.5, 1e-6);
    const cell = gap;

    // Union-Find.
    const parent = new Array(n).fill(0).map((_, i) => i);
    const find = (x: number): number => {
      let r = x;
      while (parent[r] !== r) r = parent[r];
      while (parent[x] !== r) { const next = parent[x]; parent[x] = r; x = next; }
      return r;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    // Bucket each gap-expanded bbox into grid cells; union co-located entities.
    const cellMap = new Map<string, number>(); // cellKey → first entity index seen
    for (let i = 0; i < n; i++) {
      const bb = items[i].bb;
      const x0 = Math.floor((bb.x - gap) / cell);
      const y0 = Math.floor((bb.y - gap) / cell);
      const x1 = Math.floor((bb.x + bb.w + gap) / cell);
      const y1 = Math.floor((bb.y + bb.h + gap) / cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = `${cx},${cy}`;
          const prev = cellMap.get(key);
          if (prev === undefined) cellMap.set(key, i);
          else union(prev, i);
        }
      }
    }

    // Group by root.
    const groups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const arr = groups.get(r);
      if (arr) arr.push(i);
      else groups.set(r, [i]);
    }

    // Build DetectedView per group.
    const views: DetectedView[] = [];
    for (const indices of groups.values()) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let label: string | null = null;
      const entityIds: number[] = [];

      for (const idx of indices) {
        const { ent, bb } = items[idx];
        entityIds.push(ent.id);
        if (bb.x < minX) minX = bb.x;
        if (bb.y < minY) minY = bb.y;
        if (bb.x + bb.w > maxX) maxX = bb.x + bb.w;
        if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
        if (!label && (ent.type === 'TEXT' || ent.type === 'MTEXT')) {
          const t = (ent as unknown as { text?: string }).text;
          if (t && t.trim()) label = t.trim().slice(0, 24);
        }
      }

      const bbox: IBBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      const id = `view_${Math.round((minX + maxX) / 2)}_${Math.round((minY + maxY) / 2)}`;
      views.push({ id, label: label ?? '', bbox, entityIds });
    }

    // Stable ordering: top-to-bottom, then left-to-right.
    views.sort((a, b) => (b.bbox.y + b.bbox.h) - (a.bbox.y + a.bbox.h) || a.bbox.x - b.bbox.x);
    views.forEach((v, i) => { if (!v.label) v.label = `View ${i + 1}`; });

    return views;
  }

  private _extreme(
    views: DetectedView[],
    key: (v: DetectedView) => number,
    dir: 'min' | 'max',
  ): DetectedView {
    return views.reduce((best, v) =>
      dir === 'max'
        ? (key(v) > key(best) ? v : best)
        : (key(v) < key(best) ? v : best),
    );
  }
}
