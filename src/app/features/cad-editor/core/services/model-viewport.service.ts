import { Injectable, inject, signal } from '@angular/core';
import {
  IModelViewportTile,
  VIEWPORT_CONFIG_PRESETS,
  ViewportConfigType
} from '../models/viewport-config.model';
import { ViewModelService } from './view-model.service';

@Injectable({ providedIn: 'root' })
export class ModelViewportService {
  private vm = inject(ViewModelService);

  readonly activeConfigName = signal<ViewportConfigType>('Single');
  readonly version = signal<number>(0);

  tiles: IModelViewportTile[] = [];
  activeTileId: string | null = null;

  constructor() {
    this.applyConfig('Single');
  }

  get activeTile(): IModelViewportTile | null {
    return this.tiles.find((t) => t.id === this.activeTileId) ?? this.tiles[0] ?? null;
  }

  applyConfig(configName: ViewportConfigType): void {
    const preset = VIEWPORT_CONFIG_PRESETS.find((p) => p.name === configName) ?? VIEWPORT_CONFIG_PRESETS[0];
    this.activeConfigName.set(preset.name);

    const baseScale = this.vm.scale > 0 ? this.vm.scale : 1;
    const basePanX = this.vm.panX;
    const basePanY = this.vm.panY;

    this.tiles = preset.tiles.map((rect, idx) => ({
      id: `tile_${idx}_${Date.now()}`,
      rect,
      scale: baseScale,
      panX: 0,
      panY: 0,
      viewName: rect.label ?? 'Top',
      visualStyle: '2D Wireframe',
      active: idx === 0
    }));

    this.activeTileId = this.tiles[0]?.id ?? null;
    this.updateVmCenter();
    this.bump();
    this.vm.markDirty();
  }

  updateVmCenter(): void {
    const active = this.activeTile;
    if (active && this.tiles.length > 1) {
      const w = this.vm.canvasWidth || 800;
      const h = this.vm.canvasHeight || 600;
      this.vm.vpCenterX = (active.rect.x + active.rect.w / 2) * w;
      this.vm.vpCenterY = (active.rect.y + active.rect.h / 2) * h;
    } else {
      this.vm.vpCenterX = (this.vm.canvasWidth || 800) / 2;
      this.vm.vpCenterY = (this.vm.canvasHeight || 600) / 2;
    }
  }

  setActiveTile(id: string): void {
    for (const t of this.tiles) {
      t.active = t.id === id;
    }
    this.activeTileId = id;
    this.updateVmCenter();
    const active = this.activeTile;
    if (active) {
      this.vm.scale = active.scale;
      this.vm.panX = active.panX;
      this.vm.panY = active.panY;
    }
    this.bump();
    this.vm.markDirty();
  }

  tileAt(sx: number, sy: number, canvasW: number, canvasH: number): IModelViewportTile | null {
    if (this.tiles.length <= 1 || !canvasW || !canvasH) return this.tiles[0] ?? null;
    const rx = sx / canvasW;
    const ry = sy / canvasH;

    for (const t of this.tiles) {
      const { x, y, w, h } = t.rect;
      if (rx >= x && rx <= x + w && ry >= y && ry <= y + h) {
        return t;
      }
    }
    return this.tiles[0] ?? null;
  }

  updateTileCamera(tileId: string, scale: number, panX: number, panY: number): void {
    const t = this.tiles.find((tile) => tile.id === tileId);
    if (t) {
      t.scale = scale;
      t.panX = panX;
      t.panY = panY;
    }
  }

  bump(): void {
    this.version.update((v) => v + 1);
  }
}
