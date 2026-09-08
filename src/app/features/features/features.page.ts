import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../environments/environment';
import { UiRevealDirective } from '../../shared/ui/reveal.directive';
import { SiteAccordionComponent, type SiteAccordionItem } from '../site/components/accordion.component';
import { SiteClosingComponent } from '../site/components/closing.component';
import { SiteCtaComponent } from '../site/components/cta.component';
import { SiteExplorerComponent } from '../site/components/explorer.component';
import { SiteHeadingComponent } from '../site/components/heading.component';
import { COMPARE, FORMATS, OBJECT_SNAPS } from '../site/data/site-content';
import { SiteRevealDirective } from '../site/motion/reveal.directive';

/** AutoCAD's snap marker glyphs on a 24×24 grid, in `OBJECT_SNAPS` order. */
const SNAP_GLYPHS: readonly string[] = [
  'M5 5h14v14H5z', // endpoint: square
  'M12 4l9 16H3z', // midpoint: triangle
  'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', // center: circle
  'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 12h.01', // geometric center: circle with dot
  'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M6 6l12 12M18 6L6 18', // node: circle with X
  'M12 3l9 9-9 9-9-9z', // quadrant: diamond
  'M4 4l16 16M20 4L4 20', // intersection: X
  'M4 4l16 16M20 4L4 20 M14 14h6v6', // apparent intersection: X with box
  'M3 12h4M10 12h4M17 12h4', // extension: dashed line
  'M4 20h16 M4 4h16 M12 4v16', // insertion: I-beam
  'M4 20h16 M4 4v16 M4 12h8v8', // perpendicular
  'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M3 5h18', // tangent: circle with tangent line
  'M4 20L20 4 M10 10l4 4', // nearest: hourglass-ish
  'M6 20L14 4 M10 20L18 4', // parallel: two slanted lines
];

const DETAILS: readonly SiteAccordionItem[] = [
  {
    id: 'lineweights',
    title: 'Do lineweights and colours plot the way AutoCAD plots them?',
    body: 'Yes. Entities carry ACI colours and true lineweights, lineweights are honoured on screen and in the PDF, and a drawing whose default colour is white on a dark theme plots black on the white sheet, the same swap AutoCAD makes. Plot styles offer colour, monochrome and grayscale.',
  },
  {
    id: 'dimstyles',
    title: 'Are dimensions really associative, and do dimension styles survive import?',
    body: 'A dimension is attached to the geometry it measures; stretch the wall and the value updates. DXF dimension styles import with their arrowheads, text height and precision, and per-dimension overrides in XDATA (including the plot-scale factor DIMLFAC) are honoured, so an imported drawing shows the values AutoCAD shows.',
  },
  {
    id: 'text',
    title: 'What happens to text, fonts and MText formatting?',
    body: 'Single-line text and MText import with their styles; fonts are resolved per style, control codes and encodings are decoded, and MText is edited in place with an on-canvas editor. Find and replace works across text, attributes and table cells.',
  },
  {
    id: 'layouts',
    title: 'Can I have more than one layout, each with its own paper?',
    body: 'Yes. Each layout tab has its own page setup (paper, orientation, margins, scale, plot style) and any number of viewports at their own scales. Viewports defined in an imported DXF are adopted and written back on export.',
  },
  {
    id: 'themes',
    title: 'Can I work on a light canvas?',
    body: 'Twelve themes, eight dark and four light, recolour the chrome, canvas, grid and accents together. Monokai is the default; the choice follows your account across devices.',
  },
  {
    id: 'languages',
    title: 'Which languages does the interface speak?',
    body: 'Fourteen: the same set AutoCAD ships, command prompts included. English, Čeština, Deutsch, Español, Français, Magyar, Italiano, 日本語, 한국어, Polski, Português (Brasil), Русский, 简体中文 and 繁體中文. Translations other than English are drafted from established AutoCAD terminology and not yet professionally reviewed.',
    tag: 'Drafted',
  },
  {
    id: 'offline',
    title: 'What if my connection drops mid-drawing?',
    body: 'Drafting never needed the network: parsing, rendering, snapping and plotting all run in the tab. A save made offline is kept in the browser flagged for sync and sent when the connection returns; a recovery snapshot protects against a closed tab.',
  },
  {
    id: 'three-d',
    title: 'Is there 3D?',
    body: 'Not yet. CADO is a 2D drafting editor. A phased plan for parametric 3D exists for after the 2D product is complete; nothing from it ships today.',
    tag: 'Roadmap',
  },
];

/**
 * Public features page (`/features`), rendered inside the site shell.
 *
 * The four scroll-drawn figures keep the landing hero's visual language (each
 * is a `.ui-sheet` with its own view timeline, see `blueprint.scss`); the rest
 * of the page is reference material: the command explorer, snaps, formats, a
 * comparison and the questions drafters ask.
 */
@Component({
  selector: 'app-features',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UiRevealDirective,
    SiteAccordionComponent,
    SiteClosingComponent,
    SiteCtaComponent,
    SiteExplorerComponent,
    SiteHeadingComponent,
    SiteRevealDirective,
  ],
  templateUrl: './features.page.html',
  styleUrl: './features.page.scss',
})
export class FeaturesPage {
  protected readonly appName = environment.appName;
  /** `/features#blocks` opens the explorer on that group. */
  protected readonly initialGroup = inject(ActivatedRoute).snapshot.fragment ?? 'draw';
  protected readonly snaps = OBJECT_SNAPS;
  protected readonly formats = FORMATS;
  protected readonly compare = COMPARE;
  protected readonly details = DETAILS;

  protected glyph(i: number): string {
    return SNAP_GLYPHS[i] ?? SNAP_GLYPHS[0];
  }
}
