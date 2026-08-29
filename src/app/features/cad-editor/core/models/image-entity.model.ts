import { Entity, IBBox, IPoint, ISnapPoint, IPropertySchema, ViewModelLike, DocLike } from './entity.model';

/**
 * Raster image entity (PNG/JPG/JPEG/SVG/WEBP).
 *
 * Coords:
 *   `(x, y)` is the BOTTOM-LEFT corner in world space. World Y is up, so the
 *   image extends to the right (+x) and up (+y), occupying `width × height`
 *   world units. Rotation is in radians around the bottom-left corner.
 *
 * Loading model:
 *   `src` is a data URL (after file upload) or external URL. The first `draw()`
 *   call kicks off an async `HTMLImageElement` load. While loading, a dashed
 *   placeholder rectangle renders. When loaded, the cached `_img` is reused on
 *   every frame.
 *
 * NOT deferred to DXF round-trip in this turn — real DXF IMAGE entities need
 * IMAGEDEF + IMAGEDEF_REACTOR records and external file links, which is a
 * separate piece. ImageEntities live in the in-memory document and survive
 * undo/redo / copy-paste / save-load of the editor's session only.
 */
export class ImageEntity extends Entity {
  /** Source URL — typically a `data:image/...;base64,...` after file upload. */
  src: string;
  /** Original filename (for display in properties). */
  fileName: string;
  x: number;
  y: number;
  /** World-units extent. Independent of intrinsic pixel size; set on insert. */
  width: number;
  height: number;
  /** Rotation in radians (CCW in world space). */
  rotation: number;
  /** 0..1 — passed through `ctx.globalAlpha`. */
  opacity: number;
  /** CSS-filter brightness percent. 100 = identity. */
  brightness: number;
  /** CSS-filter contrast percent. 100 = identity. */
  contrast: number;

  /** Cached `HTMLImageElement`. Lazy-initialized on first draw(). */
  private _img: HTMLImageElement | null = null;
  /** Load state — drives the loading-placeholder fallback. */
  private _imgState: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  /** When state transitions to 'loaded', stash the natural pixel size for ScaleX/Y readouts. */
  private _naturalW = 0;
  private _naturalH = 0;

  constructor(src: string, x: number, y: number, width: number, height: number, rotation = 0, opacity = 1) {
    super('IMAGE');
    this.src = src;
    this.fileName = '';
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.rotation = rotation;
    this.opacity = opacity;
    this.brightness = 100;
    this.contrast = 100;

    if (src) {
      this._imgState = 'loading';
      const img = new Image();
      img.onload = () => {
        this._img = img;
        this._naturalW = img.naturalWidth || img.width;
        this._naturalH = img.naturalHeight || img.height;
        this._imgState = 'loaded';
      };
      img.onerror = () => {
        this._imgState = 'error';
      };
      img.src = src;
    }
  }

  /** Scale X/Y getters surface the current width/height as a fraction of the natural pixel size. */
  get scaleX(): number {
    if (!this._naturalW) return 1;
    return this.width / this._naturalW;
  }
  set scaleX(v: number) {
    if (!this._naturalW || !Number.isFinite(v)) return;
    this.width = Math.max(0.001, this._naturalW * v);
  }
  get scaleY(): number {
    if (!this._naturalH) return 1;
    return this.height / this._naturalH;
  }
  set scaleY(v: number) {
    if (!this._naturalH || !Number.isFinite(v)) return;
    this.height = Math.max(0.001, this._naturalH * v);
  }

  /** Rotation surfaced as degrees for property-panel UX. */
  get rotationDeg(): number { return this.rotation * 180 / Math.PI; }
  set rotationDeg(deg: number) {
    const d = Number(deg);
    if (Number.isFinite(d)) this.rotation = d * Math.PI / 180;
  }

  private _ensureLoaded(vm: ViewModelLike): void {
    if (this._imgState !== 'idle') return;
    if (!this.src) return;
    this._imgState = 'loading';
    const img = new Image();
    img.onload = () => {
      this._img = img;
      this._naturalW = img.naturalWidth || img.width;
      this._naturalH = img.naturalHeight || img.height;
      this._imgState = 'loaded';
      vm.markDirty?.();
    };
    img.onerror = () => {
      this._imgState = 'error';
      vm.markDirty?.();
    };
    img.src = this.src;
  }

  override draw(ctx: CanvasRenderingContext2D, vm: ViewModelLike, doc: DocLike, byBlockColor: string | null = null): void {
    this._ensureLoaded(vm);
    const s = vm.w2s(this.x, this.y);
    const sw = this.width * vm.scale;
    const sh = this.height * vm.scale;

    if (this._imgState !== 'loaded' || !this._img) {
      // Placeholder — dashed orange rectangle while loading or on error.
      ctx.save();
      ctx.translate(s.x, s.y);
      if (this.rotation) ctx.rotate(-this.rotation);
      ctx.strokeStyle = this._imgState === 'error' ? 'rgba(239,68,68,0.85)' : 'rgba(240,160,48,0.65)';
      ctx.fillStyle = 'rgba(240,160,48,0.05)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 4]);
      ctx.fillRect(0, -sh, sw, sh);
      ctx.strokeRect(0, -sh, sw, sh);
      // Diagonal X marker
      ctx.beginPath();
      ctx.moveTo(0, -sh); ctx.lineTo(sw, 0);
      ctx.moveTo(sw, -sh); ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(s.x, s.y);
    if (this.rotation) ctx.rotate(-this.rotation);
    ctx.globalAlpha = Math.max(0, Math.min(1, this.opacity));
    if (this.brightness !== 100 || this.contrast !== 100) {
      ctx.filter = `brightness(${this.brightness}%) contrast(${this.contrast}%)`;
    }
    // World y is up → image extends upward from (x,y). In screen space (y inverted), that's negative.
    ctx.drawImage(this._img, 0, -sh, sw, sh);
    ctx.restore();
  }

  override snapPoints(): ISnapPoint[] {
    const x1 = this.x, y1 = this.y;
    const x2 = this.x + this.width, y2 = this.y + this.height;
    // Note: rotation is not applied to snap points yet — same approximation as hitTest.
    return [
      { x: x1, y: y1, label: 'corner' },
      { x: x2, y: y1, label: 'corner' },
      { x: x2, y: y2, label: 'corner' },
      { x: x1, y: y2, label: 'corner' },
      { x: (x1 + x2) / 2, y: (y1 + y2) / 2, label: 'center' },
    ];
  }

  override bbox(): IBBox {
    // Axis-aligned envelope of the rotated rectangle.
    if (!this.rotation) {
      return { x: this.x, y: this.y, w: this.width, h: this.height };
    }
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const corners: IPoint[] = [
      { x: 0, y: 0 },
      { x: this.width, y: 0 },
      { x: this.width, y: this.height },
      { x: 0, y: this.height },
    ].map((p: any) => ({ x: this.x + p.x * cos - p.y * sin, y: this.y + p.x * sin + p.y * cos }));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  override hitTest(sx: number, sy: number, vm: ViewModelLike): boolean {
    // Approximate: axis-aligned screen-space rectangle from the image's world bbox.
    // For un-rotated images this is exact; for rotated ones it's a generous envelope.
    const b = this.bbox();
    const a = vm.w2s(b.x, b.y);
    const c = vm.w2s(b.x + b.w, b.y + b.h);
    const left = Math.min(a.x, c.x), right = Math.max(a.x, c.x);
    const top = Math.min(a.y, c.y), bottom = Math.max(a.y, c.y);
    return sx >= left && sx <= right && sy >= top && sy <= bottom;
  }

  override getPropertiesSchema(): IPropertySchema[] {
    return [
      ...super.getPropertiesSchema(),
      { key: 'fileName', label: 'File', type: 'read-only', category: 'General', value: this.fileName || '(no name)' },
      { key: 'x', label: 'Position X', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'y', label: 'Position Y', type: 'number', category: 'Geometry', precision: 3 },
      { key: 'width', label: 'Width', type: 'number', category: 'Geometry', precision: 3, min: 0.001 },
      { key: 'height', label: 'Height', type: 'number', category: 'Geometry', precision: 3, min: 0.001 },
      { key: 'rotationDeg', label: 'Rotation', type: 'number', category: 'Geometry', precision: 1, suffix: '°' },
      { key: 'scaleX', label: 'Scale X', type: 'number', category: 'Geometry', precision: 3, step: 0.05, min: 0.001 },
      { key: 'scaleY', label: 'Scale Y', type: 'number', category: 'Geometry', precision: 3, step: 0.05, min: 0.001 },
      { key: 'opacity', label: 'Opacity', type: 'number', category: 'Display', precision: 2, step: 0.05, min: 0, max: 1 },
      { key: 'brightness', label: 'Brightness %', type: 'number', category: 'Display', precision: 0, step: 5, min: 0, max: 300 },
      { key: 'contrast', label: 'Contrast %', type: 'number', category: 'Display', precision: 0, step: 5, min: 0, max: 300 },
    ];
  }
}
