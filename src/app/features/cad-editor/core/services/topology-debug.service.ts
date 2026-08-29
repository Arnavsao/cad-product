import { Injectable, inject } from '@angular/core';
import type { IPoint } from '../models/entity.model';
import type { IFace } from './topology/types';
import { DocumentService } from './document.service';

/**
 * TopologyDebugService — diagnostic overlay for the V2 region-detection pipeline.
 *
 * Captures the last `findRegionAtWithIslandsV2` invocation (candidate set,
 * extracted faces, picked face, islands) and paints a translucent overlay on
 * the canvas so you can see exactly what the topology engine produced for a
 * given click. Pairs with the hatch-strip-bug investigation: tells you whether
 * the bug lives in candidate selection, face extraction, or face ranking.
 *
 * Toggle via Ctrl+Shift+T (canvas component) or:
 *   ng.getService(TopologyDebugService).enabled = true
 *
 * When disabled, capture is a no-op — zero cost on the hot path.
 */

export interface ITopologyDebugCapture {
  click: IPoint;
  candidateIds: number[];
  /** All CCW interior faces (signedArea > 0) from the arrangement. */
  faces: IFace[];
  /** Index in `faces` of the face `pickFaceContaining` returned. -1 if none. */
  pickedFaceId: number;
  /** Ids of faces classified as direct islands. */
  islandFaceIds: number[];
}

@Injectable({ providedIn: 'root' })
export class TopologyDebugService {
  private doc = inject(DocumentService);

  enabled = false;

  /** Most recent V2 run (or null). Replaced on every captured call. */
  lastCapture: ITopologyDebugCapture | null = null;

  /** Conditional logger — gated by `enabled`. Use for path discriminators. */
  log(label: string, data?: unknown): void {
    if (!this.enabled) return;
  }

  capture(c: ITopologyDebugCapture): void {
    if (!this.enabled) return;
    this.lastCapture = c;
    // Console summary — same data the user can also see visually.
    const interior = c.faces.filter((f) => f.signedArea > 0);
    const picked = c.pickedFaceId >= 0 ? c.faces[c.pickedFaceId] : null;
    // Console logs removed
  }

  clear(): void {
    this.lastCapture = null;
  }

  drawOverlay(
    ctx: CanvasRenderingContext2D,
    vm: { w2s(x: number, y: number): { x: number; y: number } },
  ): void {
    if (!this.enabled || !this.lastCapture) return;
    const cap = this.lastCapture;

    ctx.save();
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // 1. Candidate entity bboxes — dashed cyan outline.
    const entities = this.doc.activeFile.entities;
    const candidateSet = new Set(cap.candidateIds);
    ctx.strokeStyle = 'rgba(0, 200, 220, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const e of entities) {
      if (!candidateSet.has(e.id)) continue;
      const b = e.bbox?.();
      if (!b) continue;
      const tl = vm.w2s(b.x, b.y);
      const br = vm.w2s(b.x + b.w, b.y + b.h);
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }
    ctx.setLineDash([]);

    // 2. All CCW interior faces — z-order: others first, islands, then picked on top.
    const interior = cap.faces.filter((f) => f.signedArea > 0);
    const islandSet = new Set(cap.islandFaceIds);
    const draw = (f: IFace, fill: string | null, stroke: string, lineW: number) => {
      if (f.polygon.length < 2) return;
      ctx.beginPath();
      const p0 = vm.w2s(f.polygon[0].x, f.polygon[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < f.polygon.length; i++) {
        const p = vm.w2s(f.polygon[i].x, f.polygon[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineW;
      ctx.stroke();
    };

    // 2a. Non-picked, non-island CCW faces — thin grey outline.
    for (const f of interior) {
      if (f.id === cap.pickedFaceId) continue;
      if (islandSet.has(f.id)) continue;
      draw(f, null, 'rgba(140, 140, 140, 0.5)', 1);
    }
    // 2b. Island faces — translucent blue fill.
    for (const f of interior) {
      if (!islandSet.has(f.id)) continue;
      draw(f, 'rgba(60, 120, 240, 0.20)', 'rgba(60, 120, 240, 0.9)', 1.25);
    }
    // 2c. Picked face — translucent red fill, on top.
    for (const f of interior) {
      if (f.id !== cap.pickedFaceId) continue;
      draw(f, 'rgba(240, 60, 60, 0.22)', 'rgba(240, 60, 60, 0.95)', 1.5);
    }

    // 3. Face labels — `#id:area` at polygon centroid.
    ctx.fillStyle = 'rgba(20, 20, 20, 0.95)';
    for (const f of interior) {
      const c = polygonCentroid(f.polygon);
      if (!c) continue;
      const s = vm.w2s(c.x, c.y);
      const tag = `#${f.id}:${f.signedArea.toFixed(1)}`;
      // White halo for readability over filled faces.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(tag, s.x, s.y);
      ctx.fillText(tag, s.x, s.y);
    }

    // 4. Click crosshair.
    const cs = vm.w2s(cap.click.x, cap.click.y);
    ctx.strokeStyle = 'rgba(255, 200, 0, 1)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cs.x - 8, cs.y);
    ctx.lineTo(cs.x + 8, cs.y);
    ctx.moveTo(cs.x, cs.y - 8);
    ctx.lineTo(cs.x, cs.y + 8);
    ctx.stroke();

    ctx.restore();
  }
}

function polygonCentroid(poly: IPoint[]): IPoint | null {
  if (poly.length < 3) return null;
  let cx = 0,
    cy = 0,
    a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % poly.length];
    const cross = p0.x * p1.y - p1.x * p0.y;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
    a += cross;
  }
  if (Math.abs(a) < 1e-12) return null;
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
