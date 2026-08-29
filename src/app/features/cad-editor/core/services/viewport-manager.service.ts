import { Injectable, inject, signal } from '@angular/core';
import { Viewport, ResizeSide } from '../models/viewport.model';
import { ViewModelService, createProxyVm } from './view-model.service';
import { DocumentService } from './document.service';

/**
 * Owns all paper-space viewports + handles their interactions.
 * Port of `ViewportManager` from 45-viewport-system.js.
 *
 * Viewports are paper-space rectangles painted ON TOP of the main canvas
 * content. Each one has its own camera (scale/pan) and renders the entire
 * document independently through `buildProxyVm()` — exactly like
 * AutoCAD layout viewports.
 */
@Injectable({ providedIn: 'root' })
export class ViewportManagerService {
  private vm = inject(ViewModelService);
  private doc = inject(DocumentService);

  /** Reactive trigger so the side panel re-renders on add/remove/activate. */
  readonly version = signal(0);

  viewports: Viewport[] = [];
  activeId: string | null = null;

  /** Current drag state — `null` when idle. */
  private drag: {
    type: 'pan' | 'move' | 'resize';
    vp: Viewport;
    startSx: number;
    startSy: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    origPanX: number;
    origPanY: number;
    side?: ResizeSide;
  } | null = null;

  get active(): Viewport | null {
    return this.viewports.find((v) => v.id === this.activeId) ?? null;
  }

  add(x: number, y: number, w: number, h: number): Viewport {
    const vp = new Viewport(x, y, w, h, { scale: this.vm.scale, panX: this.vm.panX, panY: this.vm.panY });
    this.viewports.push(vp);
    this.activate(vp.id);
    this.vm.markDirty();
    this.bump();
    return vp;
  }

  remove(id: string): void {
    const idx = this.viewports.findIndex((v) => v.id === id);
    if (idx === -1) return;
    this.viewports.splice(idx, 1);
    if (this.activeId === id) this.activeId = null;
    this.vm.markDirty();
    this.bump();
  }

  activate(id: string | null): void {
    for (const v of this.viewports) v.active = false;
    const vp = id ? this.viewports.find((v) => v.id === id) : null;
    if (vp) vp.active = true;
    this.activeId = vp?.id ?? null;
    this.vm.markDirty();
    this.bump();
  }

  deactivateAll(): void {
    this.activate(null);
  }

  /** Split screen layout preset: 1 (single), 2-V (vertical), 2-H (horizontal), or 4 (grid) */
  splitScreen(type: '1' | '2-V' | '2-H' | '4'): void {
    const W = this.vm.canvasWidth || 800;
    const H = this.vm.canvasHeight || 600;
    const margin = 20;

    this.viewports = [];
    this.activeId = null;

    if (type === '1') {
      this.add(margin, margin, W - 2 * margin, H - 2 * margin);
    } else if (type === '2-V') {
      const w = Math.max(50, (W - 3 * margin) / 2);
      const h = Math.max(50, H - 2 * margin);
      this.add(margin, margin, w, h);
      this.add(margin * 2 + w, margin, w, h);
    } else if (type === '2-H') {
      const w = Math.max(50, W - 2 * margin);
      const h = Math.max(50, (H - 3 * margin) / 2);
      this.add(margin, margin, w, h);
      this.add(margin, margin * 2 + h, w, h);
    } else if (type === '4') {
      const w = Math.max(50, (W - 3 * margin) / 2);
      const h = Math.max(50, (H - 3 * margin) / 2);
      this.add(margin, margin, w, h);
      this.add(margin * 2 + w, margin, w, h);
      this.add(margin, margin * 2 + h, w, h);
      this.add(margin * 2 + w, margin * 2 + h, w, h);
    }

    this.vm.markDirty();
    this.bump();
  }

  /** Top-most viewport whose rectangle contains the screen point, or null. */
  vpAt(sx: number, sy: number): Viewport | null {
    let hit: Viewport | null = null;
    for (const vp of this.viewports) {
      if (vp.containsPoint(sx, sy)) hit = vp;
    }
    return hit;
  }

  /** Render all viewports on top of the main canvas content. */
  drawAll(ctx: CanvasRenderingContext2D): void {
    for (const vp of this.viewports) this.drawOne(ctx, vp);
  }

  private drawOne(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (!vp.visible) return;

    // Clipped model content
    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.w, vp.h);
    ctx.clip();
    if (vp.background) {
      ctx.fillStyle = vp.background;
      ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
    }
    const proxyVm = vp.buildProxyVm();
    for (const file of this.doc.files) {
      if (!file.visible) continue;
      ctx.globalAlpha = file.opacity;
      const fileVm = createProxyVm(proxyVm, file.x, file.y, file.scale, file.scale, file.rotation);
      for (const ent of file.entities) {
        if (!ent.visible) continue;
        const lay = file.layers.get(ent.layer);
        if (lay && (lay.frozen || !lay.visible)) continue;
        if (!vp.isLayerVisible(ent.layer)) continue;
        ctx.save();
        ent.draw(ctx, fileVm, file);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Border (outside clip)
    ctx.save();
    ctx.lineWidth = vp.active ? 2.5 : 1.5;
    ctx.setLineDash([]);
    if (vp.locked) ctx.strokeStyle = '#f0a030';
    else if (vp.active) ctx.strokeStyle = '#499bea';
    else ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(vp.x + 0.5, vp.y + 0.5, vp.w - 1, vp.h - 1);
    if (vp.active) {
      ctx.shadowColor = '#499bea';
      ctx.shadowBlur = 8;
      ctx.strokeRect(vp.x + 0.5, vp.y + 0.5, vp.w - 1, vp.h - 1);
    }
    ctx.restore();

    // Resize handles
    if (vp.active && !vp.locked) this.drawHandles(ctx, vp);

    // Label
    ctx.save();
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillStyle = vp.active ? '#499bea' : 'rgba(255,255,255,0.4)';
    let label = vp.name;
    if (vp.locked) label += ' 🔒';
    if (vp.scalePreset) label += '  ' + vp.scalePreset;
    ctx.fillText(label, vp.x + 6, vp.y + 14);
    ctx.restore();
  }

  private drawHandles(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const { x, y, w, h } = vp;
    const pts = [
      { sx: x, sy: y }, { sx: x + w / 2, sy: y }, { sx: x + w, sy: y },
      { sx: x + w, sy: y + h / 2 }, { sx: x + w, sy: y + h },
      { sx: x + w / 2, sy: y + h }, { sx: x, sy: y + h }, { sx: x, sy: y + h / 2 },
    ];
    ctx.save();
    ctx.fillStyle = '#499bea';
    ctx.strokeStyle = '#1a3a5c';
    ctx.lineWidth = 1;
    for (const p of pts) {
      ctx.beginPath();
      ctx.rect(p.sx - 4, p.sy - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── Mouse interaction (called from canvas) ────────────── */

  /** Returns true if the wheel was consumed by a viewport (zoom-in-viewport). */
  handleWheel(e: WheelEvent, sx: number, sy: number): boolean {
    const vp = this.active;
    if (!vp || !vp.containsPoint(sx, sy)) return false;
    if (vp.locked) return true; // consume but no-op
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    vp.zoomAt(factor, sx, sy);
    this.vm.markDirty();
    return true;
  }

  /** Try to start a drag (border-resize → header-move → camera-pan). Returns true if consumed. */
  startDrag(sx: number, sy: number): boolean {
    const active = this.active;
    // 1. Active viewport border handle
    if (active && !active.locked) {
      const side = active.hitBorder(sx, sy);
      if (side) {
        this.drag = {
          type: 'resize', vp: active, side,
          startSx: sx, startSy: sy,
          origX: active.x, origY: active.y, origW: active.w, origH: active.h,
          origPanX: active.camPanX, origPanY: active.camPanY,
        };
        return true;
      }
    }
    // 2. Header strip (top 20 px) of any viewport — moves the whole rectangle
    for (let i = this.viewports.length - 1; i >= 0; i--) {
      const vp = this.viewports[i];
      if (sx >= vp.x && sx <= vp.x + vp.w && sy >= vp.y && sy <= vp.y + 20) {
        this.activate(vp.id);
        this.drag = {
          type: 'move', vp,
          startSx: sx, startSy: sy,
          origX: vp.x, origY: vp.y, origW: vp.w, origH: vp.h,
          origPanX: vp.camPanX, origPanY: vp.camPanY,
        };
        return true;
      }
    }
    // 3. Inside active viewport → pan its camera
    if (active && active.containsPoint(sx, sy) && !active.locked) {
      this.drag = {
        type: 'pan', vp: active,
        startSx: sx, startSy: sy,
        origX: active.x, origY: active.y, origW: active.w, origH: active.h,
        origPanX: active.camPanX, origPanY: active.camPanY,
      };
      return true;
    }
    return false;
  }

  /** Update an in-progress drag. */
  updateDrag(sx: number, sy: number): void {
    if (!this.drag) return;
    const { type, vp } = this.drag;
    if (type === 'pan') {
      vp.camPanX = this.drag.origPanX + (sx - this.drag.startSx);
      vp.camPanY = this.drag.origPanY + (sy - this.drag.startSy);
    } else if (type === 'move') {
      vp.x = this.drag.origX + (sx - this.drag.startSx);
      vp.y = this.drag.origY + (sy - this.drag.startSy);
    } else if (type === 'resize' && this.drag.side) {
      const dx = sx - this.drag.startSx;
      const dy = sy - this.drag.startSy;
      const { origX, origY, origW, origH } = this.drag;
      const MIN = 80;
      const s = this.drag.side;
      if (s.includes('e')) vp.w = Math.max(MIN, origW + dx);
      if (s.includes('s')) vp.h = Math.max(MIN, origH + dy);
      if (s.includes('w')) { vp.x = origX + dx; vp.w = Math.max(MIN, origW - dx); }
      if (s.includes('n')) { vp.y = origY + dy; vp.h = Math.max(MIN, origH - dy); }
    }
    this.vm.markDirty();
  }

  endDrag(): void {
    this.drag = null;
  }

  isDragging(): boolean {
    return this.drag !== null;
  }

  /** Cursor for the hover position — null when no viewport claims it. */
  cursorFor(sx: number, sy: number): string | null {
    const active = this.active;
    if (active) {
      const side = active.hitBorder(sx, sy);
      if (side) {
        const map: Record<ResizeSide, string> = {
          n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
          nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
        };
        return map[side];
      }
      if (active.containsPoint(sx, sy) && !active.locked) return 'crosshair';
    }
    return null;
  }

  /** Toggle layer freeze IN a specific viewport (independent from global frozen state). */
  toggleLayerOverride(vp: Viewport, layerName: string): void {
    const cur = vp.isLayerVisible(layerName);
    vp.layerOverrides.set(layerName, !cur);
    this.vm.markDirty();
    this.bump();
  }

  bump(): void {
    this.version.update((v) => v + 1);
  }

  /** Wipe all viewports — used when loading a new DXF / GAD. */
  clear(): void {
    this.viewports = [];
    this.activeId = null;
    this.drag = null;
    this.bump();
  }
}
