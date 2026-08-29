import { Injectable, inject } from '@angular/core';
import { ViewModelService } from './view-model.service';
import type { IBlockDef } from '../models/layer.model';
import type { Entity, IBBox } from '../models/entity.model';

const THUMB_SIZE = 48;

@Injectable({ providedIn: 'root' })
export class BlockThumbnailService {
  private vm = inject(ViewModelService);
  private cache = new Map<string, { version: number; dataUrl: string }>();
  private canvas: HTMLCanvasElement | null = null;

  invalidate(name?: string): void {
    if (name) this.cache.delete(name);
    else this.cache.clear();
  }

  getThumbnail(def: IBlockDef, docVersion = 0): string {
    const entry = this.cache.get(def.name);
    if (entry && entry.version === docVersion) return entry.dataUrl;
    const dataUrl = this.render(def);
    this.cache.set(def.name, { version: docVersion, dataUrl });
    return dataUrl;
  }

  private render(def: IBlockDef): string {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = THUMB_SIZE;
      this.canvas.height = THUMB_SIZE;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);

    const entities = def.entities;
    if (!entities.length) return '';

    const union = this.computeUnion(entities);
    if (!union || union.w === 0 || union.h === 0) return '';

    const pad = 4;
    const drawSize = THUMB_SIZE - pad * 2;
    const scaleX = drawSize / union.w;
    const scaleY = drawSize / union.h;
    const scale = Math.min(scaleX, scaleY);

    const cx = union.x + union.w / 2;
    const cy = union.y + union.h / 2;

    const proxyVm: any = {
      scale,
      panX: THUMB_SIZE / 2 - cx * scale,
      panY: THUMB_SIZE / 2 + cy * scale,
      w2s: (wx: number, wy: number) => ({
        x: wx * scale + (THUMB_SIZE / 2 - cx * scale),
        y: -wy * scale + (THUMB_SIZE / 2 + cy * scale),
      }),
      canvasWidth: THUMB_SIZE,
      canvasHeight: THUMB_SIZE,
      previewHiddenIds: null,
    };

    ctx.save();
    ctx.strokeStyle = '#89b4fa';
    ctx.fillStyle = '#89b4fa';
    ctx.lineWidth = 1;
    for (const e of entities) {
      try { e.draw(ctx, proxyVm, null as any); } catch { /* skip */ }
    }
    ctx.restore();

    return this.canvas.toDataURL('image/png');
  }

  private computeUnion(entities: Entity[]): IBBox | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of entities) {
      const b = e.bbox?.();
      if (!b || !isFinite(b.w) || !isFinite(b.h)) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
}
