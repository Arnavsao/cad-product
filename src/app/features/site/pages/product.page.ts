import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent, type UiIconName } from '../../../shared/ui/icon.component';
import { SiteClosingComponent } from '../components/closing.component';
import { SiteCtaComponent } from '../components/cta.component';
import { SiteHeadingComponent } from '../components/heading.component';
import { ScreenHotspot, SiteScreenComponent } from '../components/screen.component';
import { MotionService } from '../motion/motion.service';
import { SiteRevealDirective } from '../motion/reveal.directive';

/** Parts of the editor, positioned on `/site/editor-model.webp` (percent of the image). */
interface Part extends ScreenHotspot {
  icon: UiIconName;
}

const PARTS: readonly Part[] = [
  { id: 'ribbon', x: 30, y: 8, icon: 'pencil', label: 'Draw, Annotate and Modify ribbons', detail: 'Every tool also has a command alias. Drop-downs hold the variants: Circle 2P/3P/TTR, Arc methods, Trim/Extend, Fillet radius.' },
  { id: 'header', x: 90, y: 2.4, icon: 'settings', label: 'File actions', detail: 'Back, My Drawings (Ctrl+O), Save (Ctrl+S), Import a local DXF or image, Plot (Ctrl+P), and the light/dark switch.' },
  { id: 'docs', x: 9, y: 17.4, icon: 'file', label: 'Document tabs', detail: 'Several drawings open at once, each with its own undo stack, layouts and unsaved marker.' },
  { id: 'rail', x: 2, y: 36, icon: 'list', label: 'Panels rail', detail: 'Properties, Layers, Blocks, Views, Library, the AI Agent and Settings open as a drawer beside the canvas.' },
  { id: 'view', x: 12, y: 20.4, icon: 'grid', label: 'View controls', detail: 'Undo, redo, zoom extents, zoom in and out, viewport arrangement and the current layer.' },
  { id: 'canvas', x: 46, y: 60, icon: 'move', label: 'The canvas', detail: 'Three layers of canvas (grid, content, overlay) sized in device pixels, so lines are crisp on HiDPI screens. Middle-drag pans, wheel zooms about the cursor.' },
  { id: 'cmd', x: 20, y: 95, icon: 'chevron-right', label: 'Command line', detail: 'Type an alias or a full name; answer prompts with points, distances or options. Esc cancels, Enter repeats.' },
  { id: 'tabs', x: 8.5, y: 98.4, icon: 'copy', label: 'Model and layout tabs', detail: 'Model space is where you draw at full size. Each layout is a paper sheet with its own page setup and viewports.' },
  { id: 'status', x: 86, y: 98.4, icon: 'check', label: 'Drafting toggles', detail: 'OSNAP with its mode picker, SNAP & GRID, ORTHO, OTRACK, POLAR and DYN (dynamic input) toggle from here or with function keys.' },
  { id: 'coords', x: 65, y: 98.4, icon: 'search', label: 'Coordinates', detail: 'The cursor position in drawing units, or through the active viewport in paper space.' },
];

interface SpaceStep {
  id: string;
  index: string;
  title: string;
  body: string;
  src: string;
  alt: string;
  frame: string;
}

const SPACES: readonly SpaceStep[] = [
  {
    id: 'model',
    index: '01',
    title: 'Model space: the drawing at full size',
    body: 'Everything is drawn in real units, one to one. Layers carry colour, lineweight and linetype; blocks carry attributes; dimensions measure the geometry they are attached to. This is the only place geometry lives, however many sheets end up printing it.',
    src: '/site/editor-detail.webp',
    alt: 'Zoomed into the model: half elevation and half section of a bridge slab, with dimensions, notes and a schedule.',
    frame: 'Model · 1:20',
  },
  {
    id: 'paper',
    index: '02',
    title: 'Paper space: what gets printed',
    body: 'A layout is a sheet of a chosen size with viewports that frame regions of the model at a real scale, 1:50 on an A3 say. Title blocks, notes and the revision table are drawn on the sheet itself. Double-click into a viewport and every tool works through it (MSPACE); step out (PSPACE) and you are editing the sheet.',
    src: '/site/editor-layout.webp',
    alt: 'A layout tab: the white A-series sheet with a viewport showing the model, and the PSPACE indicator in the status bar.',
    frame: 'Layout1 · PSPACE',
  },
  {
    id: 'plot',
    index: '03',
    title: 'Plot: the sheet becomes a file',
    body: 'Plot a window, the extents, the display or the layout to PDF with real lineweights, searchable text and embedded fonts, or to SVG, PNG or JPG. Publish writes every layout to one PDF. Export DXF writes the drawing back out with its own layers, blocks, linetypes and dimension styles.',
    src: '/site/editor-plot.webp',
    alt: 'The Plot dialog: printer, paper size, plot area, scale, plot style and options, with a live preview of the sheet.',
    frame: 'Plot — DWG To PDF',
  },
];

interface SaveStep {
  title: string;
  body: string;
  chip: string;
  kind: 'ok' | 'warn' | 'info';
}

const SAVE_STEPS: readonly SaveStep[] = [
  { title: 'You press Ctrl+S', body: 'The editor serialises the drawing to DXF and sends it with the version it loaded.', chip: 'PUT drawing · If-Match: 13', kind: 'info' },
  { title: 'The API reserves the next version', body: 'A conditional update claims version 14 only if 13 is still current; then the payload is written to object storage under that version.', chip: '201 · version 14', kind: 'ok' },
  { title: 'Someone else saved first', body: 'The condition fails, nothing is overwritten, and you are asked what to do: overwrite, save as a copy, or reload their version.', chip: '409 · VERSION_CONFLICT', kind: 'warn' },
  { title: 'Meanwhile, every 30 seconds', body: 'A recovery snapshot of unsaved work is written to the browser, so a closed tab or a crashed machine loses at most half a minute.', chip: 'IndexedDB snapshot', kind: 'info' },
  { title: 'No network', body: 'The save is kept in the browser flagged as pending and you are told so; press Save again once you are online and it goes through.', chip: 'pendingSync: true', kind: 'info' },
];

interface Fidelity {
  title: string;
  body: string;
}

const FIDELITY: readonly Fidelity[] = [
  { title: 'Dimension values', body: 'Per-dimension overrides in XDATA, including the plot-scale factor DIMLFAC, are read, so a span reads 10280 where AutoCAD says 10280, not the raw 68.53.' },
  { title: 'Text and fonts', body: 'Control codes and encodings are decoded; each text style resolves to its own font. Notes read as written.' },
  { title: 'Lineweights and colours', body: 'True lineweights on screen and on paper; ACI colours; white-on-dark defaults become black on the white sheet when plotting.' },
  { title: 'Linetypes', body: 'The drawing’s own LTYPE table and $LTSCALE are written on export, so dashed centrelines come back dashed.' },
  { title: 'Layouts and viewports', body: 'Viewports defined in the DXF are adopted with their camera and written back, so a sheet set survives the round trip.' },
  { title: 'Large files', body: 'Parsing runs in a Web Worker; a 36 MB general arrangement opens without freezing the tab.' },
];

/**
 * `/product` — how the editor works.
 *
 * The page is a guided tour: the parts of the screen (hotspots on a real
 * screenshot), model space against paper space (a sticky picture that changes
 * as the reader scrolls), what runs in the browser versus on the server, what
 * a save does step by step, and what DXF fidelity means in practice.
 */
@Component({
  selector: 'app-product-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButtonDirective, UiIconComponent, SiteClosingComponent, SiteCtaComponent, SiteHeadingComponent, SiteRevealDirective, SiteScreenComponent],
  templateUrl: './product.page.html',
  styleUrl: './product.page.scss',
})
export class ProductPage implements AfterViewInit {
  protected readonly appName = environment.appName;
  protected readonly parts = PARTS;
  protected readonly spaces = SPACES;
  protected readonly saveSteps = SAVE_STEPS;
  protected readonly fidelity = FIDELITY;

  protected readonly activePart = signal<string | null>('canvas');
  protected readonly activeSpace = signal(0);
  protected readonly space = computed(() => this.spaces[this.activeSpace()]);

  private readonly motion = inject(MotionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly spaceEls = viewChildren<ElementRef<HTMLElement>>('spaceEl');

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = Number((entry.target as HTMLElement).dataset['index']);
          if (i !== this.activeSpace()) this.activeSpace.set(i);
        }
      },
      { rootMargin: '-35% 0px -45% 0px', threshold: 0 },
    );
    for (const el of this.spaceEls()) observer.observe(el.nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  protected selectPart(id: string): void {
    this.activePart.set(this.activePart() === id ? null : id);
  }

  protected goToSpace(i: number): void {
    const el = this.spaceEls()[i]?.nativeElement;
    if (el) this.motion.scrollToElement(el, -Math.round(window.innerHeight * 0.38));
  }
}
