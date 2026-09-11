import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { environment } from '../../../environments/environment';
import { UiRevealDirective } from '../../shared/ui/reveal.directive';
import { SiteAccordionComponent, type SiteAccordionItem } from '../site/components/accordion.component';
import { SiteClosingComponent } from '../site/components/closing.component';
import { SiteCtaComponent } from '../site/components/cta.component';
import { SiteExplorerComponent } from '../site/components/explorer.component';
import { SiteHeadingComponent } from '../site/components/heading.component';
import { COMPARE, FORMATS, FORMAT_NONE, OBJECT_SNAPS } from '../site/data/site-content';
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

/** The FAQ-style details. `tagKey` marks answers about drafted or roadmap work. */
const DETAILS: readonly SiteAccordionItem[] = (
  [
    ['lineweights'],
    ['dimstyles'],
    ['text'],
    ['layouts'],
    ['themes'],
    ['languages', 'site.features.details.tags.drafted'],
    ['offline'],
    ['three-d', 'site.features.details.tags.roadmap'],
  ] as const
).map(([id, tagKey]) => ({
  id,
  titleKey: `site.features.details.${id}.title`,
  bodyKey: `site.features.details.${id}.body`,
  tagKey,
}));

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
    TranslocoDirective,
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
  /** The read/write cell value that renders as a dash and is styled as "not supported". */
  protected readonly formatNone = FORMAT_NONE;

  protected glyph(i: number): string {
    return SNAP_GLYPHS[i] ?? SNAP_GLYPHS[0];
  }
}
