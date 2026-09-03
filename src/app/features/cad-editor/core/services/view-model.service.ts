import { Injectable, signal, inject, Injector } from '@angular/core';
import type { DocumentService } from './document.service';
import { DocumentManagerService } from './document-manager.service';

export interface IPoint2 { x: number; y: number; }

export interface IProxyVm {
  scale: number;
  cumulativeScale: number;
  annoScale?: number;
  w2s(wx: number, wy: number): IPoint2;
  s2w(sx: number, sy: number): IPoint2;
}

@Injectable({ providedIn: 'root' })
export class ViewModelService {
  private injector = inject(Injector);
  private get docManager(): DocumentManagerService {
    return this.injector.get(DocumentManagerService) as DocumentManagerService;
  }

  readonly cursorX = signal('0.000');
  readonly cursorY = signal('0.000');

  get scale(): number { return this.docManager.activeDocument?.vmState.scale ?? 1; }
  set scale(v: number) { if (this.docManager.activeDocument) this.docManager.activeDocument.vmState.scale = v; }

  get panX(): number { return this.docManager.activeDocument?.vmState.panX ?? 0; }
  set panX(v: number) { if (this.docManager.activeDocument) this.docManager.activeDocument.vmState.panX = v; }

  get panY(): number { return this.docManager.activeDocument?.vmState.panY ?? 0; }
  set panY(v: number) { if (this.docManager.activeDocument) this.docManager.activeDocument.vmState.panY = v; }

  get lastCursorWorld(): IPoint2 { return this.docManager.activeDocument?.vmState.lastCursorWorld ?? { x: 0, y: 0 }; }
  set lastCursorWorld(v: IPoint2) { if (this.docManager.activeDocument) this.docManager.activeDocument.vmState.lastCursorWorld = v; }

  get previewHiddenIds(): Set<number> | null { return this.docManager.activeDocument?.vmState.previewHiddenIds ?? null; }
  set previewHiddenIds(v: Set<number> | null) { if (this.docManager.activeDocument) this.docManager.activeDocument.vmState.previewHiddenIds = v; }

  dirty = true;
  gridDirty = true;

  /**
   * Content epoch — bumped ONLY when document content or entity selection
   * changes (addEntity, removeEntity, setSelected, command execution, etc.).
   * Panels / computeds that react to selection must read this signal; they
   * should NOT react to pan/zoom to avoid O(n) work on every viewport tick.
   */
  readonly version = signal(0);

  /**
   * View epoch — bumped on pan, zoom, resize, and theme changes.
   * In-place overlay editors (text, table) read this to reposition themselves
   * on every viewport change WITHOUT triggering content-heavy recomputes.
   */
  readonly viewEpoch = signal(0);

  canvasWidth = 0;
  canvasHeight = 0;

  // The center of the active viewport (or the entire canvas if not split)
  // Used to correctly map screen coordinates to world coordinates when tiled.
  vpCenterX = 0;
  vpCenterY = 0;

  // Custom Cursor Configurations
  cursorSize = 5; // Percentage of screen size (1-100)
  pickboxSize = 3; // Half-width of pickbox in pixels (changed from 4 to match AutoCAD default)

  /** Mark the canvas layer as needing a redraw (does NOT bump any Angular signal). */
  markDirty(): void {
    this.dirty = true;
  }

  /** Mark canvas + bump the VIEW epoch (pan/zoom/resize). */
  markViewDirty(): void {
    this.dirty = true;
    this.viewEpoch.update((v) => v + 1);
  }

  /** Mark canvas + bump the CONTENT epoch (entities added/removed/selected). */
  markContentDirty(): void {
    this.dirty = true;
    this.version.update((v) => v + 1);
  }

  markGridDirty(): void {
    this.gridDirty = true;
  }

  w2s(wx: number, wy: number): IPoint2 {
    return { x: wx * this.scale + this.panX + this.vpCenterX, y: -wy * this.scale + this.panY + this.vpCenterY };
  }

  s2w(sx: number, sy: number): IPoint2 {
    return { x: (sx - this.panX - this.vpCenterX) / this.scale, y: -(sy - this.panY - this.vpCenterY) / this.scale };
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.s2w(sx, sy);
    this.scale = Math.max(1e-7, Math.min(1e6, this.scale * factor));
    const after = this.w2s(before.x, before.y);
    this.panX += sx - after.x;
    this.panY += sy - after.y;
    this.dirty = true;
    this.gridDirty = true;
    this.viewEpoch.update((v) => v + 1);
  }

  /**
   * The default view: world origin at the centre of the active viewport, at a
   * default zoom. `animate` is off by default because the first paint calls this
   * before anything is on screen — there is nothing to animate away from.
   *
   * Note `panX`/`panY` are ZERO here, not `w / 2`. `w2s()` already offsets every
   * point by `vpCenter`, which `ModelViewportService.updateVmCenter()` sets to the
   * canvas centre even when the canvas is not split. Adding half the canvas again
   * put the origin at (w, h) — the bottom-right corner — which is why focusing an
   * empty drawing appeared to do nothing.
   */
  reset(animate = false): void {
    const w = this.canvasWidth;
    const h = this.canvasHeight;
    if (!w || !h) return;
    const targetScale = Math.min(w, h) / 200;
    if (animate && this.scale > 0) {
      this.animateTo(targetScale, 0, 0, 250);
      return;
    }
    this.scale = targetScale;
    this.panX = 0;
    this.panY = 0;
    this.dirty = true;
    this.gridDirty = true;
    this.viewEpoch.update((v) => v + 1);
  }

  private animRafId: number | null = null;

  animateTo(targetScale: number, targetPanX: number, targetPanY: number, durationMs = 250): void {
    if (this.animRafId !== null) {
      cancelAnimationFrame(this.animRafId);
      this.animRafId = null;
    }
    const startScale = this.scale;
    const startPanX = this.panX;
    const startPanY = this.panY;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const ease = 1 - Math.pow(1 - progress, 3); // Cubic ease-out

      this.scale = startScale + (targetScale - startScale) * ease;
      this.panX = startPanX + (targetPanX - startPanX) * ease;
      this.panY = startPanY + (targetPanY - startPanY) * ease;

      this.markViewDirty();
      this.markGridDirty();
      this.viewEpoch.update((v) => v + 1);

      if (progress < 1) {
        this.animRafId = requestAnimationFrame(step);
      } else {
        this.animRafId = null;
      }
    };

    this.animRafId = requestAnimationFrame(step);
  }

  zoomExtentsWhenReady(doc: DocumentService, _retries = 30): void {
    if (!this.canvasWidth || !this.canvasHeight) {
      if (_retries > 0) {
        requestAnimationFrame(() => this.zoomExtentsWhenReady(doc, _retries - 1));
      } else {
        this.reset();
      }
      return;
    }
    this.zoomExtents(doc, 0.05, true);
  }

  zoomExtents(doc: DocumentService, padRatio = 0.05, animate = true): void {
    const bounds = doc.getValidDrawingBounds(false, false);
    if (!bounds) {
      // Nothing drawn yet — focus the origin rather than leaving the view wherever
      // the user last panned it.
      this.reset(animate);
      return;
    }

    let minX = bounds.minX;
    let minY = bounds.minY;
    let maxX = bounds.maxX;
    let maxY = bounds.maxY;
    if (Math.abs(maxX - minX) < 1e-4 && Math.abs(maxY - minY) < 1e-4) {
      minX -= 50; maxX += 50;
      minY -= 50; maxY += 50;
    }

    const w = this.canvasWidth;
    const h = this.canvasHeight;
    const cw = w * (1 - 2 * padRatio);
    const ch = h * (1 - 2 * padRatio);

    const rw = cw / (maxX - minX);
    const rh = ch / (maxY - minY);
    const targetScale = Math.min(rw, rh);

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    // Centre the drawing on the active viewport. `w2s()` adds `vpCenter`, so the
    // pan is the offset of the drawing's midpoint alone — see `reset()`.
    const targetPanX = -midX * targetScale;
    const targetPanY = midY * targetScale;

    if (animate && w && h && this.scale > 0) {
      this.animateTo(targetScale, targetPanX, targetPanY, 250);
    } else {
      this.scale = targetScale;
      this.panX = targetPanX;
      this.panY = targetPanY;
      this.markViewDirty();
      this.markGridDirty();
      this.viewEpoch.update((v) => v + 1);
    }
  }
}

export function createProxyVm(
  parentVm: ViewModelService | IProxyVm,
  localPanX: number,
  localPanY: number,
  localScaleX: number,
  localScaleY: number,
  localRotationDeg: number,
): IProxyVm {
  const rad = (localRotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const avgScale = (Math.abs(localScaleX) + Math.abs(localScaleY)) / 2;

  const cumulativeScale = ('cumulativeScale' in parentVm ? (parentVm as any).cumulativeScale : parentVm.scale) * avgScale;

  return {
    get scale() { return parentVm.scale; },
    get cumulativeScale() { return cumulativeScale; },
    annoScale: (parentVm as any).annoScale,

    w2s(wx: number, wy: number): IPoint2 {
      const rx = wx * cos - wy * sin;
      const ry = wx * sin + wy * cos;
      const lx = rx * localScaleX + localPanX;
      const ly = ry * localScaleY + localPanY;
      return parentVm.w2s(lx, ly);
    },

    s2w(sx: number, sy: number): IPoint2 {
      const pw = parentVm.s2w(sx, sy);
      const lx = (pw.x - localPanX) / localScaleX;
      const ly = (pw.y - localPanY) / localScaleY;
      const rx = lx * cos + ly * sin;
      const ry = -lx * sin + ly * cos;
      return { x: rx, y: ry };
    },
  };
}

/** Choose a "nice" grid spacing given the current scale */
export function niceGridStep(scale: number): number {
  const target = 50;
  const raw = target / scale;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  for (const mult of [1, 2, 5, 10]) {
    if (base * mult * scale >= target) return base * mult;
  }
  return base * 10;
}
