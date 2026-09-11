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
import { TranslocoDirective } from '@jsverse/transloco';
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

/** Builds a hotspot whose keys live under `site.product.parts.<id>`. */
function part(id: string, x: number, y: number, icon: UiIconName): Part {
  const base = `site.product.parts.${id}`;
  return { id, x, y, icon, labelKey: `${base}.label`, detailKey: `${base}.detail` };
}

const PARTS: readonly Part[] = [
  part('ribbon', 30, 8, 'pencil'),
  part('header', 90, 2.4, 'settings'),
  part('docs', 9, 17.4, 'file'),
  part('rail', 2, 36, 'list'),
  part('view', 12, 20.4, 'grid'),
  part('canvas', 46, 60, 'move'),
  part('cmd', 20, 95, 'chevron-right'),
  part('tabs', 8.5, 98.4, 'copy'),
  part('status', 86, 98.4, 'check'),
  part('coords', 65, 98.4, 'search'),
];

interface SpaceStep {
  id: string;
  index: string;
  titleKey: string;
  bodyKey: string;
  src: string;
  altKey: string;
  frameKey: string;
}

function space(id: string, index: string, src: string): SpaceStep {
  const base = `site.product.spaces.${id}`;
  return { id, index, src, titleKey: `${base}.title`, bodyKey: `${base}.body`, altKey: `${base}.alt`, frameKey: `${base}.frame` };
}

const SPACES: readonly SpaceStep[] = [
  space('model', '01', '/site/editor-detail.webp'),
  space('paper', '02', '/site/editor-layout.webp'),
  space('plot', '03', '/site/editor-plot.webp'),
];

interface SaveStep {
  id: string;
  titleKey: string;
  bodyKey: string;
  /** The wire-level chip (status codes, headers, field names). Not translated. */
  chip: string;
  kind: 'ok' | 'warn' | 'info';
}

function saveStep(id: string, chip: string, kind: SaveStep['kind']): SaveStep {
  const base = `site.product.save.${id}`;
  return { id, chip, kind, titleKey: `${base}.title`, bodyKey: `${base}.body` };
}

const SAVE_STEPS: readonly SaveStep[] = [
  saveStep('press', 'PUT drawing · If-Match: 13', 'info'),
  saveStep('reserve', '201 · version 14', 'ok'),
  saveStep('conflict', '409 · VERSION_CONFLICT', 'warn'),
  saveStep('snapshot', 'IndexedDB snapshot', 'info'),
  saveStep('offline', 'pendingSync: true', 'info'),
];

interface Fidelity {
  id: string;
  titleKey: string;
  bodyKey: string;
}

function fidelity(id: string): Fidelity {
  const base = `site.product.fidelity.${id}`;
  return { id, titleKey: `${base}.title`, bodyKey: `${base}.body` };
}

const FIDELITY: readonly Fidelity[] = [
  fidelity('dims'),
  fidelity('text'),
  fidelity('lineweights'),
  fidelity('linetypes'),
  fidelity('layouts'),
  fidelity('large'),
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
  imports: [RouterLink, TranslocoDirective, UiButtonDirective, UiIconComponent, SiteClosingComponent, SiteCtaComponent, SiteHeadingComponent, SiteRevealDirective, SiteScreenComponent],
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
