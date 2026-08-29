import { Injectable, inject, signal } from '@angular/core';
import { ViewModelService } from './view-model.service';
import { ThemeService } from './theme.service';
import type { ISnapResult } from './snapping.service';
import type { IPoint } from '../models/entity.model';

const MAX_ACQUIRED = 7;
const HOVER_DELAY_MS = 300;

export interface ITrackGuide {
  anchor: IPoint;
  type: 'H' | 'V'; // Horizontal, Vertical
}

export interface ITrackResult {
  wx: number;
  wy: number;
  guides: ITrackGuide[];
}

@Injectable({ providedIn: 'root' })
export class ObjectSnapTrackingService {
  private vm = inject(ViewModelService);
  private theme = inject(ThemeService);

  readonly enabled = signal(false);

  private acquiredPoints: IPoint[] = [];
  private hoverTimer: any = null;
  private hoverCandidate: IPoint | null = null;
  
  private activeGuides: ITrackGuide[] = [];

  toggle(): void {
    this.enabled.update((v) => !v);
    if (!this.enabled()) {
      this.clear();
    }
  }

  clear(): void {
    this.acquiredPoints = [];
    this.clearHover();
    this.activeGuides = [];
    this.vm.markDirty();
  }

  private clearHover(): void {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    this.hoverCandidate = null;
  }

  /** Called by SnappingService on every mouse move */
  onMouseMove(wx: number, wy: number, sx: number, sy: number, currentOsnap: ISnapResult | null): void {
    if (!this.enabled()) return;

    if (currentOsnap) {
      const pt = { x: currentOsnap.x, y: currentOsnap.y };
      
      if (!this.hoverCandidate || this.distSq(this.hoverCandidate, pt) > 1e-9) {
        this.clearHover();
        this.hoverCandidate = pt;
        // AutoCAD shows a tiny '+' when acquired. We'll wait 300ms.
        this.hoverTimer = setTimeout(() => {
          this.toggleAcquiredPoint(pt);
          this.clearHover();
          this.vm.markDirty();
        }, HOVER_DELAY_MS);
      }
    } else {
      this.clearHover();
    }
  }

  private toggleAcquiredPoint(pt: IPoint): void {
    const idx = this.acquiredPoints.findIndex(p => this.distSq(p, pt) < 1e-9);
    if (idx !== -1) {
      // Un-acquire
      this.acquiredPoints.splice(idx, 1);
    } else {
      // Acquire
      this.acquiredPoints.push(pt);
      if (this.acquiredPoints.length > MAX_ACQUIRED) {
        this.acquiredPoints.shift();
      }
    }
  }

  private distSq(p1: IPoint, p2: IPoint): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return dx * dx + dy * dy;
  }

  setActiveTracking(guides: ITrackGuide[] | null): void {
    this.activeGuides = guides || [];
  }

  getTrackingCandidates(wx: number, wy: number, worldTol: number): ITrackResult | null {
    if (!this.enabled() || this.acquiredPoints.length === 0) return null;

    let bestGuides: ITrackGuide[] = [];
    let bestDist = worldTol;
    let snappedPt = { x: wx, y: wy };
    
    // 1. Check for intersections between guides from DIFFERENT points
    for (let i = 0; i < this.acquiredPoints.length; i++) {
      for (let j = 0; j < this.acquiredPoints.length; j++) {
        if (i === j) continue;
        const p1 = this.acquiredPoints[i];
        const p2 = this.acquiredPoints[j];
        
        // H from p1, V from p2 -> intersection is (p2.x, p1.y)
        const ix = p2.x;
        const iy = p1.y;
        
        const dist = Math.hypot(wx - ix, wy - iy);
        if (dist < bestDist) {
          bestDist = dist;
          snappedPt = { x: ix, y: iy };
          bestGuides = [
            { anchor: p1, type: 'H' },
            { anchor: p2, type: 'V' }
          ];
        }
      }
    }

    if (bestGuides.length === 2) {
      return { wx: snappedPt.x, wy: snappedPt.y, guides: bestGuides };
    }

    // 2. Check individual guides
    let foundGuide: ITrackGuide | null = null;
    bestDist = worldTol;
    let closestPt = { x: wx, y: wy };

    for (const pt of this.acquiredPoints) {
      // H guide
      const distH = Math.abs(wy - pt.y);
      if (distH < bestDist) {
        bestDist = distH;
        foundGuide = { anchor: pt, type: 'H' };
        closestPt = { x: wx, y: pt.y };
      }
      
      // V guide
      const distV = Math.abs(wx - pt.x);
      if (distV < bestDist) {
        bestDist = distV;
        foundGuide = { anchor: pt, type: 'V' };
        closestPt = { x: pt.x, y: wy };
      }
    }

    if (foundGuide) {
       return { wx: closestPt.x, wy: closestPt.y, guides: [foundGuide] };
    }

    return null;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.enabled()) return;
    const palette = this.theme.canvas();

    // Render acquired points (small green cross)
    if (this.acquiredPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = palette.snapMarker; // usually green
      ctx.lineWidth = 1.5;
      const sz = 4;
      
      for (const pt of this.acquiredPoints) {
        const s = this.vm.w2s(pt.x, pt.y);
        ctx.beginPath();
        ctx.moveTo(s.x - sz, s.y);
        ctx.lineTo(s.x + sz, s.y);
        ctx.moveTo(s.x, s.y - sz);
        ctx.lineTo(s.x, s.y + sz);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Render active tracking guides
    if (this.activeGuides.length > 0) {
      ctx.save();
      ctx.strokeStyle = palette.snapMarker; // Same color as snap marker
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      const W = this.vm.canvasWidth;
      const H = this.vm.canvasHeight;

      for (const guide of this.activeGuides) {
        const s = this.vm.w2s(guide.anchor.x, guide.anchor.y);
        ctx.beginPath();
        if (guide.type === 'H') {
          ctx.moveTo(0, s.y);
          ctx.lineTo(W, s.y);
        } else {
          ctx.moveTo(s.x, 0);
          ctx.lineTo(s.x, H);
        }
        ctx.stroke();
      }
      
      ctx.restore();
    }
  }
}
