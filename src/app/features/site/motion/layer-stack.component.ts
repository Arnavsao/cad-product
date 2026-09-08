import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MotionService } from './motion.service';

type Three = typeof import('three');

/** One layer of the stack, bottom to top. Indexes match `LAYERS` below. */
export interface StackLayer {
  id: 'model' | 'walls' | 'openings' | 'dimensions' | 'hatch' | 'paper';
  label: string;
  detail: string;
}

export const STACK_LAYERS: readonly StackLayer[] = [
  { id: 'model', label: 'Model space', detail: 'Full-size geometry on the grid, in real units.' },
  { id: 'walls', label: 'Layer · WALLS', detail: 'Lineweight 0.50 mm. Off, frozen or locked per layer.' },
  { id: 'openings', label: 'Layer · DOORS', detail: 'One door block, placed three times.' },
  { id: 'dimensions', label: 'Layer · DIMS', detail: 'Associative dimensions that follow the geometry.' },
  { id: 'hatch', label: 'Layer · HATCH', detail: 'Boundary-detected hatch, regenerated when walls move.' },
  { id: 'paper', label: 'Paper space', detail: 'An A3 layout with a scaled viewport and title block.' },
];

/* Plan geometry in the landing sheet's viewBox units (960 × 600, 1 unit = 10 mm). */
const WALLS: readonly [number, number, number, number][] = [
  [140, 140, 240, 140], [360, 140, 640, 140], [760, 140, 840, 140],
  [840, 140, 840, 480], [840, 480, 470, 480], [380, 480, 140, 480],
  [140, 480, 140, 140], [560, 140, 560, 200], [560, 280, 560, 480],
  [140, 310, 250, 310], [330, 310, 560, 310],
];
const DOOR_LEAVES: readonly [number, number, number, number][] = [
  [380, 480, 380, 392], [560, 200, 640, 200], [330, 310, 330, 230],
];
/** cx, cy, r, from, to (radians, viewBox orientation). */
const DOOR_SWINGS: readonly [number, number, number, number, number][] = [
  [380, 480, 88, -Math.PI / 2, 0],
  [640, 200, 80, Math.PI / 2, Math.PI],
  [330, 310, 80, Math.PI, Math.PI * 1.5],
];
const WINDOWS: readonly [number, number, number, number][] = [
  [240, 134, 360, 134], [240, 140, 360, 140], [240, 146, 360, 146],
  [640, 134, 760, 134], [640, 140, 760, 140], [640, 146, 760, 146],
];
const DIMS: readonly [number, number, number, number][] = [
  [140, 132, 140, 80], [840, 132, 840, 80], [140, 92, 840, 92],
  [132, 140, 80, 140], [132, 480, 80, 480], [92, 140, 92, 480],
];
const HATCH_RECT = { x: 148, y: 318, w: 404, h: 154 };
const CENTER = { x: 490, y: 310 };
const SCALE = 1 / 100;

/** Spacing between layers when collapsed and when fully exploded. */
const SPACING_MIN = 0.012;
const SPACING_MAX = 0.52;

/**
 * The hero's 3D figure: a drawing pulled apart into what it is made of.
 *
 * At `progress` 0 the floor plan lies flat on the model-space grid with the
 * sheet resting on it; as `progress` goes to 1 the stack explodes into its
 * layers — grid, walls, doors, dimensions, hatch — with the paper-space sheet
 * and its viewport on top, so the visual explains layers and paper space rather
 * than decorating the headline. The pointer tilts the camera a little.
 *
 * Three.js is imported lazily after the view exists, and only when WebGL is
 * available and motion is allowed; otherwise the SVG fallback (a finished,
 * static exploded view) is shown so no visitor sees an empty box. Colours are
 * read from the `--ui-*` tokens and re-read when the theme changes, so all
 * twelve themes recolour the scene.
 */
@Component({
  selector: 'site-layer-stack',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #canvas class="ls__canvas" [hidden]="fallback()" aria-hidden="true"></canvas>
    @if (fallback()) {
      <svg class="ls__fallback" viewBox="0 0 480 360" role="img" aria-label="A floor plan exploded into its layers, with a paper-space sheet on top" focusable="false">
        @for (i of [0, 1, 2, 3, 4]; track i) {
          <g [attr.transform]="'translate(0 ' + (300 - i * 56) + ')'">
            <path class="ls__fb-plane" d="M120 0L360 0L300 -50L60 -50Z" />
          </g>
        }
        <path class="ls__fb-wall" d="M150 296H330L280 250H100Z M215 296L165 250 M265 296L215 250" />
        <path class="ls__fb-thin" d="M150 240H330L280 194H100Z" />
        <path class="ls__fb-dim" d="M150 184H330L280 138H100Z M240 184V138" />
        <path class="ls__fb-thin" d="M150 128H330L280 82H100Z" />
        <path class="ls__fb-sheet" d="M110 80L370 80L310 12L50 12Z" />
        <path class="ls__fb-dim" d="M150 72H330L280 26H100Z" />
      </svg>
    }
  `,
  host: { class: 'site-layer-stack' },
  styles: [
    `
      :host {
        position: relative;
        display: block;
        width: 100%;
        height: 100%;
        min-height: 280px;
      }
      .ls__canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        touch-action: pan-y;
      }
      .ls__fallback { position: absolute; inset: 0; width: 100%; height: 100%; }
      .ls__fb-plane { fill: color-mix(in srgb, var(--ui-surface) 60%, transparent); stroke: var(--ui-border); stroke-width: 1; }
      .ls__fb-wall { fill: none; stroke: var(--ui-text-strong); stroke-width: 3; stroke-linejoin: round; }
      .ls__fb-thin { fill: none; stroke: var(--ui-border-strong); stroke-width: 1.2; }
      .ls__fb-dim { fill: none; stroke: var(--ui-accent); stroke-width: 1.2; }
      .ls__fb-sheet { fill: color-mix(in srgb, var(--ui-surface) 90%, var(--ui-text-strong)); stroke: var(--ui-border-strong); stroke-width: 1; }
    `,
  ],
})
export class SiteLayerStackComponent implements AfterViewInit, OnDestroy {
  /** 0 = collapsed drawing, 1 = fully exploded stack. Driven by the parent's scroll. */
  readonly progress = input(0);

  private readonly motion = inject(MotionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly fallback = signal(false);

  /** Which layer the current progress has "reached", for the legend. */
  readonly activeLayer = computed(() => Math.min(STACK_LAYERS.length - 1, Math.floor(this.progress() * STACK_LAYERS.length)));

  private three: Three | null = null;
  private renderer: import('three').WebGLRenderer | null = null;
  private scene: import('three').Scene | null = null;
  private camera: import('three').PerspectiveCamera | null = null;
  private layers: import('three').Group[] = [];
  private projection: import('three').LineSegments | null = null;
  private sheetMaterial: import('three').MeshStandardMaterial | null = null;
  private materials: { role: string; mat: import('three').Material }[] = [];

  private frame = 0;
  private visible = true;
  private destroyed = false;
  private targetProgress = 0;
  private shownProgress = 0;
  private pointer = { x: 0, y: 0 };
  private shownPointer = { x: 0, y: 0 };
  private cleanup: (() => void)[] = [];

  constructor() {
    effect(() => {
      this.targetProgress = this.progress();
      this.wake();
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const canvas = this.canvasRef().nativeElement;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) {
      this.fallback.set(true);
      return;
    }

    let THREE: Three;
    try {
      THREE = await import('three');
    } catch {
      this.fallback.set(true);
      return;
    }
    if (this.destroyed) return;
    this.three = THREE;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera = camera;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 8, 6);
    scene.add(key);

    this.build(THREE, scene);
    this.applyPalette();
    this.resize();

    const ro = new ResizeObserver(() => {
      this.resize();
      this.wake();
    });
    ro.observe(this.host.nativeElement);
    this.cleanup.push(() => ro.disconnect());

    const io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) this.wake();
    });
    io.observe(this.host.nativeElement);
    this.cleanup.push(() => io.disconnect());

    const onMove = (e: PointerEvent): void => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      this.wake();
    };
    if (!this.motion.reduced()) {
      window.addEventListener('pointermove', onMove, { passive: true });
      this.cleanup.push(() => window.removeEventListener('pointermove', onMove));
    }

    const onLost = (e: Event): void => {
      e.preventDefault();
      this.stop();
      this.fallback.set(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    this.cleanup.push(() => canvas.removeEventListener('webglcontextlost', onLost));

    // The theme writes `--color-*` inline on <body>; follow it.
    const mo = new MutationObserver(() => {
      this.applyPalette();
      this.wake();
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    this.cleanup.push(() => mo.disconnect());

    // Under reduced motion, show the exploded state once and stay still.
    if (this.motion.reduced()) {
      this.shownProgress = 0.85;
      this.targetProgress = 0.85;
      this.place(0.85);
      this.renderOnce();
      return;
    }
    this.wake();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stop();
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    if (this.scene) {
      this.scene.traverse((obj) => {
        const mesh = obj as import('three').Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as import('three').Material | import('three').Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose?.();
      });
    }
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }

  // ── Scene construction ─────────────────────────────────────────

  private build(THREE: Three, scene: import('three').Scene): void {
    const toX = (x: number): number => (x - CENTER.x) * SCALE;
    const toZ = (y: number): number => (y - CENTER.y) * SCALE;

    const layer = (): import('three').Group => {
      const g = new THREE.Group();
      scene.add(g);
      this.layers.push(g);
      return g;
    };

    const lineMat = (role: string, opacity = 1): import('three').LineBasicMaterial => {
      const mat = new THREE.LineBasicMaterial({ transparent: opacity < 1, opacity });
      this.materials.push({ role, mat });
      return mat;
    };
    const meshMat = (role: string, opacity = 1): import('three').MeshStandardMaterial => {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, transparent: opacity < 1, opacity });
      this.materials.push({ role, mat });
      return mat;
    };
    const segments = (list: readonly (readonly number[])[], mat: import('three').Material): import('three').LineSegments => {
      const pts: number[] = [];
      for (const [x1, y1, x2, y2] of list) pts.push(toX(x1), 0, toZ(y1), toX(x2), 0, toZ(y2));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return new THREE.LineSegments(geo, mat);
    };

    // 0 ─ Model space: the grid, with the origin axes.
    const model = layer();
    const grid = new THREE.GridHelper(9.6, 24);
    grid.material = lineMat('grid', 0.55);
    model.add(grid);
    const axes = segments([[490 - 480, 310, 490 + 480, 310], [490, 310 - 300, 490, 310 + 300]], lineMat('accent', 0.35));
    model.add(axes);

    // 1 ─ Walls: shallow boxes, so lineweight reads as weight and not as height.
    const walls = layer();
    const wallMat = meshMat('strong');
    const thick = 0.085;
    const height = 0.05;
    for (const [x1, y1, x2, y2] of WALLS) {
      const horizontal = y1 === y2;
      const len = (horizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1)) * SCALE + thick;
      const geo = new THREE.BoxGeometry(horizontal ? len : thick, height, horizontal ? thick : len);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set((toX(x1) + toX(x2)) / 2, height / 2, (toZ(y1) + toZ(y2)) / 2);
      walls.add(mesh);
    }

    // 2 ─ Doors and windows.
    const openings = layer();
    const thin = lineMat('muted', 0.95);
    openings.add(segments([...DOOR_LEAVES, ...WINDOWS], thin));
    const arcs: number[][] = [];
    for (const [cx, cy, r, a0, a1] of DOOR_SWINGS) {
      const steps = 20;
      for (let i = 0; i < steps; i++) {
        const t0 = a0 + ((a1 - a0) * i) / steps;
        const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
        arcs.push([cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1)]);
      }
    }
    openings.add(segments(arcs, thin));

    // 3 ─ Dimensions: lines, arrowheads and the two measurements.
    const dims = layer();
    const accent = lineMat('accent');
    dims.add(segments(DIMS, accent));
    const arrowMat = meshMat('accent');
    const arrow = (x: number, y: number, dir: number): void => {
      const geo = new THREE.ConeGeometry(0.045, 0.16, 3);
      const mesh = new THREE.Mesh(geo, arrowMat);
      mesh.position.set(toX(x), 0, toZ(y));
      mesh.rotation.z = dir;
      dims.add(mesh);
    };
    arrow(154, 92, Math.PI / 2);
    arrow(826, 92, -Math.PI / 2);
    const side = (x: number, y: number, dir: number): void => {
      const geo = new THREE.ConeGeometry(0.045, 0.16, 3);
      const mesh = new THREE.Mesh(geo, arrowMat);
      mesh.position.set(toX(x), 0, toZ(y));
      mesh.rotation.x = dir;
      dims.add(mesh);
    };
    side(92, 154, -Math.PI / 2);
    side(92, 466, Math.PI / 2);
    dims.add(this.label(THREE, '7000', toX(490), toZ(92), 0));
    dims.add(this.label(THREE, '3400', toX(92), toZ(310), Math.PI / 2));

    // 4 ─ Hatch: 45° lines clipped to the room.
    const hatch = layer();
    const hatchLines: number[][] = [];
    const { x, y, w, h } = HATCH_RECT;
    for (let c = -h; c < w; c += 14) {
      // Line x - y = c within the rect; clip to its edges.
      const x0 = Math.max(x, x + c);
      const y0 = x0 - c - x + y;
      const x1 = Math.min(x + w, x + c + h);
      const y1 = x1 - c - x + y;
      if (x1 > x0) hatchLines.push([x0, y0, x1, y1]);
    }
    hatch.add(segments(hatchLines, lineMat('accent', 0.45)));

    // 5 ─ Paper space: the sheet, a viewport frame and a title block.
    const paper = layer();
    const sheetW = 9.4;
    const sheetH = sheetW * (297 / 420);
    const sheetMat = meshMat('sheet', 0.94);
    sheetMat.depthWrite = false;
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(sheetW, sheetH), sheetMat);
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = -0.002;
    paper.add(sheet);
    this.sheetMaterial = sheetMat;
    const edge = lineMat('muted', 0.9);
    const rect = (cx: number, cz: number, rw: number, rh: number, mat: import('three').Material): import('three').LineSegments => {
      const geo = new THREE.BufferGeometry();
      const hw = rw / 2;
      const hh = rh / 2;
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            cx - hw, 0, cz - hh, cx + hw, 0, cz - hh,
            cx + hw, 0, cz - hh, cx + hw, 0, cz + hh,
            cx + hw, 0, cz + hh, cx - hw, 0, cz + hh,
            cx - hw, 0, cz + hh, cx - hw, 0, cz - hh,
          ],
          3,
        ),
      );
      return new THREE.LineSegments(geo, mat);
    };
    paper.add(rect(0, 0, sheetW, sheetH, edge));
    paper.add(rect(0, 0, sheetW - 0.4, sheetH - 0.4, lineMat('muted', 0.5)));
    // The viewport frames the plan: same extents as the drawing below it.
    const vpW = (840 - 140) * SCALE + 1.4;
    const vpH = (480 - 80) * SCALE + 1.0;
    paper.add(rect(0, -0.1, vpW, vpH, lineMat('accent', 0.95)));
    // Title block, bottom right.
    paper.add(rect(sheetW / 2 - 1.55, sheetH / 2 - 0.55, 2.7, 0.7, edge));
    paper.add(this.label(THREE, 'A3 · 1:50', sheetW / 2 - 1.55, sheetH / 2 - 0.55, 0, 0.42));

    // Projection lines from the viewport corners down to the plan corners.
    const projGeo = new THREE.BufferGeometry();
    projGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(24).fill(0), 3));
    this.projection = new THREE.LineSegments(projGeo, lineMat('accent', 0.3));
    scene.add(this.projection);
  }

  /** A small text label rendered to a canvas texture and laid flat on its layer. */
  private label(THREE: Three, text: string, x: number, z: number, rot: number, height = 0.28): import('three').Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * 4, height), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rot;
    mesh.position.set(x, 0.01, z);
    mesh.userData['labelText'] = text;
    mesh.userData['labelCanvas'] = canvas;
    this.materials.push({ role: 'label', mat });
    return mesh;
  }

  private paintLabels(accent: string, surface: string): void {
    if (!this.scene || !this.three) return;
    const THREE = this.three;
    this.scene.traverse((obj) => {
      const text = obj.userData['labelText'] as string | undefined;
      const canvas = obj.userData['labelCanvas'] as HTMLCanvasElement | undefined;
      if (!text || !canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = surface;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = accent;
      ctx.font = '600 34px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
      const mat = (obj as import('three').Mesh).material as import('three').MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = new THREE.CanvasTexture(canvas);
      mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.needsUpdate = true;
    });
  }

  // ── Palette ────────────────────────────────────────────────────

  private applyPalette(): void {
    const THREE = this.three;
    if (!THREE) return;
    const color = (token: string, fallback: string): import('three').Color => {
      const c = new THREE.Color();
      try {
        c.setStyle(this.motion.cssColor(token, fallback));
      } catch {
        c.setStyle(fallback);
      }
      return c;
    };
    const roles: Record<string, import('three').Color> = {
      grid: color('--ui-border', '#333333'),
      accent: color('--ui-accent', '#4c9aff'),
      strong: color('--ui-text-strong', '#ffffff'),
      muted: color('--ui-border-strong', '#6b6b6b'),
      sheet: color('--ui-surface', '#252526').lerp(color('--ui-text-strong', '#ffffff'), 0.08),
    };
    for (const { role, mat } of this.materials) {
      const c = roles[role];
      if (c && 'color' in mat) (mat as import('three').LineBasicMaterial).color.copy(c);
    }
    this.paintLabels(`#${roles['accent'].getHexString()}`, `#${roles['sheet'].getHexString()}`);
  }

  // ── Layout and rendering ───────────────────────────────────────

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const { clientWidth: w, clientHeight: h } = this.host.nativeElement;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Positions every layer for an explode amount `p` in [0, 1]. */
  private place(p: number): void {
    if (!this.camera) return;
    const spacing = SPACING_MIN + (SPACING_MAX - SPACING_MIN) * this.easeOut(p);
    this.layers.forEach((g, i) => {
      g.position.y = i * spacing;
      g.rotation.y = -0.62 + p * 0.28;
    });

    // Projection lines: viewport corners on the sheet to plan corners below.
    if (this.projection) {
      const top = this.layers[5];
      const bottom = this.layers[1];
      const vpW = (840 - 140) * SCALE + 1.4;
      const vpH = (480 - 80) * SCALE + 1.0;
      const corners = [
        [-vpW / 2, -0.1 - vpH / 2],
        [vpW / 2, -0.1 - vpH / 2],
        [vpW / 2, -0.1 + vpH / 2],
        [-vpW / 2, -0.1 + vpH / 2],
      ];
      const pos = this.projection.geometry.getAttribute('position') as import('three').BufferAttribute;
      const cos = Math.cos(top.rotation.y);
      const sin = Math.sin(top.rotation.y);
      corners.forEach(([x, z], i) => {
        const rx = x * cos + z * sin;
        const rz = -x * sin + z * cos;
        pos.setXYZ(i * 2, rx, top.position.y, rz);
        pos.setXYZ(i * 2 + 1, rx, bottom.position.y, rz);
      });
      pos.needsUpdate = true;
      (this.projection.material as import('three').Material).opacity = 0.3 * this.easeOut(p);
    }

    // The sheet is transparent while the stack is flat, so the drawing under it
    // stays visible; it turns opaque as it lifts away.
    if (this.sheetMaterial) this.sheetMaterial.opacity = 0.94 * this.easeOut(p);

    const px = this.shownPointer.x;
    const py = this.shownPointer.y;
    const camY = 6.4 - p * 0.6 + py * -0.4;
    const camZ = 11.2 + p * 1.8;
    this.camera.position.set(px * 1.1, camY, camZ);
    this.camera.lookAt(0, 0.3 + p * 1.2, 0);
  }

  private easeOut(t: number): number {
    return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  }

  private wake(): void {
    if (this.frame || !this.renderer || !this.visible || this.destroyed) return;
    if (this.motion.reduced()) {
      this.renderOnce();
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private readonly tick = (): void => {
    this.frame = 0;
    if (!this.renderer || !this.scene || !this.camera || this.destroyed) return;

    const k = 0.09;
    this.shownProgress += (this.targetProgress - this.shownProgress) * k;
    this.shownPointer.x += (this.pointer.x - this.shownPointer.x) * k;
    this.shownPointer.y += (this.pointer.y - this.shownPointer.y) * k;

    this.place(this.shownProgress);
    this.renderer.render(this.scene, this.camera);

    const settled =
      Math.abs(this.targetProgress - this.shownProgress) < 0.0008 &&
      Math.abs(this.pointer.x - this.shownPointer.x) < 0.001 &&
      Math.abs(this.pointer.y - this.shownPointer.y) < 0.001;
    if (!settled && this.visible) this.frame = requestAnimationFrame(this.tick);
  };

  private renderOnce(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.place(this.shownProgress);
    this.renderer.render(this.scene, this.camera);
  }
}
