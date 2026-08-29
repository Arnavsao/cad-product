/**
 * Paper-space Viewport — a "window into model space" with its own independent
 * camera. NOT a model-space entity. Lives in ViewportManager, not in
 * DocumentService.activeFile.entities.
 *
 * Port of `ViewportEntity` from 45-viewport-system.js (intentionally renamed
 * `Viewport` to avoid collision with the legacy model-space stub in
 * entity-extended.model.ts).
 */
import type { IPoint } from './entity.model';
import type { IProxyVm } from '../services/view-model.service';

export interface IViewportScale {
  label: string;
  value: number;
}

export const VIEWPORT_SCALES: ReadonlyArray<IViewportScale> = [
  { label: '1:1',    value: 1       },
  { label: '1:2',    value: 0.5     },
  { label: '1:5',    value: 0.2     },
  { label: '1:10',   value: 0.1     },
  { label: '1:20',   value: 0.05    },
  { label: '1:50',   value: 0.02    },
  { label: '1:100',  value: 0.01    },
  { label: '1:200',  value: 0.005   },
  { label: '1:500',  value: 0.002   },
  { label: '1:1000', value: 0.001   },
  { label: '2:1',    value: 2       },
  { label: '5:1',    value: 5       },
  { label: '10:1',   value: 10      },
];

let _vpId = 1;

export type ResizeSide = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export class Viewport {
  readonly id: string;
  name: string;
  readonly type = 'VIEWPORT' as const;

  // Screen-space placement (px, relative to canvas)
  x: number;
  y: number;
  w: number;
  h: number;

  // Independent camera — drives the model-space view inside this viewport
  camScale: number;
  camPanX: number;
  camPanY: number;
  rotation = 0; // future use

  locked = false;
  active = false;
  visible = true;
  /** null = freely zoomable, otherwise the active named preset (e.g. '1:10'). */
  scalePreset: string | null = null;

  /** Per-viewport layer freeze overrides. `false` = frozen IN this viewport. */
  layerOverrides: Map<string, boolean> = new Map();

  background: string | null = null;

  constructor(x: number, y: number, w: number, h: number, parentCam?: { scale: number; panX: number; panY: number }) {
    this.id = 'vp_' + _vpId++;
    this.name = 'Viewport ' + (_vpId - 1);
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.camScale = parentCam?.scale ?? 1;
    this.camPanX = parentCam?.panX ?? 0;
    this.camPanY = parentCam?.panY ?? 0;
  }

  /* ── Camera helpers ──────────────────────────────────── */

  w2s(wx: number, wy: number): IPoint {
    return { x: wx * this.camScale + this.camPanX, y: -wy * this.camScale + this.camPanY };
  }

  s2w(sx: number, sy: number): IPoint {
    return { x: (sx - this.camPanX) / this.camScale, y: -(sy - this.camPanY) / this.camScale };
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    if (this.locked) return;
    const before = this.s2w(sx, sy);
    this.camScale = Math.max(0.01, Math.min(5000, this.camScale * factor));
    const after = this.w2s(before.x, before.y);
    this.camPanX += sx - after.x;
    this.camPanY += sy - after.y;
    this.scalePreset = null;
  }

  /** Build a VM-compatible proxy used to draw model entities through this viewport's camera. */
  buildProxyVm(): IProxyVm {
    const vp = this;
    return {
      scale: vp.camScale,
      cumulativeScale: vp.camScale,
      annoScale: vp.camScale,
      w2s: (wx, wy) => ({ x: wx * vp.camScale + vp.camPanX, y: -wy * vp.camScale + vp.camPanY }),
      s2w: (sx, sy) => ({ x: (sx - vp.camPanX) / vp.camScale, y: -(sy - vp.camPanY) / vp.camScale }),
    };
  }

  /** Apply a named preset scale, keeping the viewport's centre point stable. */
  applyScale(preset: IViewportScale): void {
    const worldCx = (this.x + this.w / 2 - this.camPanX) / this.camScale;
    const worldCy = -(this.y + this.h / 2 - this.camPanY) / this.camScale;
    this.camScale = preset.value;
    this.camPanX = this.x + this.w / 2 - worldCx * this.camScale;
    this.camPanY = this.y + this.h / 2 + worldCy * this.camScale;
    this.scalePreset = preset.label;
  }

  /** Is `layerName` visible in this viewport? Returns true unless an override freezes it. */
  isLayerVisible(layerName: string): boolean {
    if (this.layerOverrides.has(layerName)) return this.layerOverrides.get(layerName) ?? true;
    return true;
  }

  containsPoint(sx: number, sy: number): boolean {
    return sx >= this.x && sx <= this.x + this.w && sy >= this.y && sy <= this.y + this.h;
  }

  /** Returns which border or corner is being hovered (within tolerance), else null. */
  hitBorder(sx: number, sy: number, tol = 8): ResizeSide | null {
    const { x, y, w, h } = this;
    const inX = sx >= x - tol && sx <= x + w + tol;
    const inY = sy >= y - tol && sy <= y + h + tol;
    if (!inX || !inY) return null;
    const onL = Math.abs(sx - x) <= tol;
    const onR = Math.abs(sx - (x + w)) <= tol;
    const onT = Math.abs(sy - y) <= tol;
    const onB = Math.abs(sy - (y + h)) <= tol;
    if (onL && onT) return 'nw';
    if (onR && onT) return 'ne';
    if (onL && onB) return 'sw';
    if (onR && onB) return 'se';
    if (onL) return 'w';
    if (onR) return 'e';
    if (onT) return 'n';
    if (onB) return 's';
    return null;
  }
}
