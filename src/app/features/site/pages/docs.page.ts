import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { SiteClosingComponent } from '../components/closing.component';
import { SiteHeadingComponent } from '../components/heading.component';
import { SiteScreenComponent } from '../components/screen.component';
import { COMMAND_GROUPS, FACTS, OBJECT_SNAPS } from '../data/site-content';
import { MotionService } from '../motion/motion.service';
import { SiteRevealDirective } from '../motion/reveal.directive';
import {
  AI_BACKENDS,
  AI_CAPABILITIES,
  AI_EXAMPLES,
  AI_RISK,
  CONFLICT_ANSWERS,
  DOC_SECTIONS,
  DRAFTING_AIDS,
  DXF_LIMITS,
  DXF_ROUNDTRIP,
  EMBED_SNIPPETS,
  LANGUAGES,
  LAYER_STATES,
  ORG_ROLES,
  PAPER_FAMILIES,
  PLOT_OUTPUTS,
  PLOT_SCALES,
  PLOT_STYLES,
  SHORTCUT_GROUPS,
  START_STEPS,
} from './docs.data';

/** Pixels below the viewport top where a section counts as "being read". */
const SPY_TOP_PX = 96;

/**
 * `/docs` — the reference manual, on one page.
 *
 * Design decisions:
 *  - **One long page, not a tree of routes.** The footer links to anchors
 *    (`/docs#commands`), a reader searches with the browser's own Find, and the
 *    sidebar makes the length navigable. Section ids are therefore part of the
 *    site's URL surface and must not change.
 *  - **Scrollspy through IntersectionObserver, not a scroll listener.** Each
 *    section is observed against a band just under the fixed header; the first
 *    section in document order that intersects the band is the active one.
 *    Clicking a link scrolls through `MotionService` (so Lenis and native
 *    scrolling agree) and rewrites the fragment with `replaceUrl`, so Back still
 *    leaves the page rather than stepping through every heading visited.
 *  - **The command table is the shared `COMMAND_GROUPS`,** filtered client-side
 *    across name, aliases and description, so the docs cannot disagree with the
 *    feature pages about what the editor does.
 */
@Component({
  selector: 'app-docs-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiIconComponent,
    UiInputDirective,
    SiteHeadingComponent,
    SiteScreenComponent,
    SiteClosingComponent,
    SiteRevealDirective,
  ],
  templateUrl: './docs.page.html',
  styleUrl: './docs.page.scss',
})
export class DocsPage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly motion = inject(MotionService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly sectionEls = viewChildren<ElementRef<HTMLElement>>('docSection');
  private readonly navEl = viewChild<ElementRef<HTMLElement>>('nav');

  /* ── Data ─────────────────────────────────────────────────────── */
  protected readonly sections = DOC_SECTIONS;
  protected readonly startSteps = START_STEPS;
  protected readonly shortcutGroups = SHORTCUT_GROUPS;
  protected readonly objectSnaps = OBJECT_SNAPS;
  protected readonly aids = DRAFTING_AIDS;
  protected readonly layerStates = LAYER_STATES;
  protected readonly paperFamilies = PAPER_FAMILIES;
  protected readonly scales = PLOT_SCALES;
  protected readonly plotStyles = PLOT_STYLES;
  protected readonly plotOutputs = PLOT_OUTPUTS;
  protected readonly dxfRoundtrip = DXF_ROUNDTRIP;
  protected readonly dxfLimits = DXF_LIMITS;
  protected readonly aiBackends = AI_BACKENDS;
  protected readonly aiCapabilities = AI_CAPABILITIES;
  protected readonly aiRisk = AI_RISK;
  protected readonly aiExamples = AI_EXAMPLES;
  protected readonly conflictAnswers = CONFLICT_ANSWERS;
  protected readonly orgRoles = ORG_ROLES;
  protected readonly languages = LANGUAGES;
  protected readonly snippets = EMBED_SNIPPETS;
  protected readonly autosaveSeconds = FACTS.find((f) => f.label === 'autosave cadence')?.value ?? 30;

  /* ── Scrollspy ────────────────────────────────────────────────── */
  protected readonly active = signal<string>(DOC_SECTIONS[0].id);
  private observer: IntersectionObserver | null = null;
  private readonly inBand = new Set<string>();

  /* ── Command filter ───────────────────────────────────────────── */
  protected readonly query = signal('');
  protected readonly totalCommands = COMMAND_GROUPS.reduce((n, g) => n + g.commands.length, 0);
  protected readonly groupCount = COMMAND_GROUPS.length;

  protected readonly filteredGroups = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return COMMAND_GROUPS;
    return COMMAND_GROUPS.map((group) => ({
      ...group,
      commands: group.commands.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.what.toLowerCase().includes(q) ||
          c.aliases.some((a) => a.toLowerCase().includes(q)),
      ),
    })).filter((group) => group.commands.length > 0);
  });

  protected readonly matchCount = computed(() => this.filteredGroups().reduce((n, g) => n + g.commands.length, 0));

  constructor() {
    afterNextRender(() => {
      this.observeSections();
      this.landOnFragment();
    });
    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected clearQuery(): void {
    this.query.set('');
  }

  /** Sidebar click: scroll, highlight, and rewrite the fragment without a history entry. */
  protected go(event: Event, id: string): void {
    event.preventDefault();
    const target = this.document.getElementById(id);
    if (!target) return;
    this.setActive(id);
    this.motion.scrollToElement(target);
    void this.router.navigate([], { relativeTo: this.route, fragment: id, replaceUrl: true });
  }

  private observeSections(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          if (entry.isIntersecting) this.inBand.add(id);
          else this.inBand.delete(id);
        }
        // First section in document order that crosses the reading band wins.
        const current = this.sections.find((s) => this.inBand.has(s.id));
        if (current) this.setActive(current.id);
      },
      // A band from just under the header to a little above the middle of the
      // viewport: a heading becomes "current" as it approaches the top.
      { rootMargin: `-${SPY_TOP_PX}px 0px -55% 0px`, threshold: 0 },
    );
    for (const ref of this.sectionEls()) this.observer.observe(ref.nativeElement);
  }

  /** Deep link on load (`/docs#dxf`): land on the section once it exists. */
  private landOnFragment(): void {
    const fragment = this.route.snapshot.fragment;
    if (!fragment) return;
    const target = this.document.getElementById(fragment);
    if (!target) return;
    this.setActive(fragment);
    this.motion.scrollToElement(target);
  }

  private setActive(id: string): void {
    if (this.active() === id) return;
    this.active.set(id);
    this.revealChip(id);
  }

  /** On narrow screens the sidebar is a scrollable chip row; keep the current chip visible. */
  private revealChip(id: string): void {
    const nav = this.navEl()?.nativeElement;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    const chip = nav.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!chip) return;
    const left = chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: this.motion.reduced() ? 'auto' : 'smooth' });
  }
}
