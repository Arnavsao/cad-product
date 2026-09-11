import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { CURRENCY, TIERS } from '../../pricing/pricing.data';
import { SiteClosingComponent } from '../components/closing.component';
import { SiteHeadingComponent } from '../components/heading.component';
import { SiteScreenComponent } from '../components/screen.component';
import { SiteTab, SiteTabsComponent } from '../components/tabs.component';
import { AUDIENCES, Audience } from '../data/site-content';
import { SiteRevealDirective } from '../motion/reveal.directive';

/** A link into the features page or the docs, listed under "features that matter". */
interface FeatureLink {
  id: string;
  labelKey: string;
  link: '/features' | '/docs';
  fragment: string;
}

/** What the shared `Audience` record does not carry: the page-specific detail. */
interface AudienceDetail {
  /** One line under the tab label. */
  hintKey: string;
  /** Four or five concrete steps. Every one is a shipped capability. */
  weekKeys: readonly string[];
  features: readonly FeatureLink[];
  /** `src` and `title` are a path and a file name; neither is translated. */
  screen: { src: string; altKey: string; title: string; captionKey: string };
}

interface SwitchRow {
  id: string;
  autocadKey: string;
  cadoKey: string;
}

interface PlanRow {
  tierId: 'free' | 'pro' | 'team';
  whoKey: string;
  whyKey: string;
}

const DETAILS: Readonly<Record<string, AudienceDetail>> = {
  architects: {
    hintKey: 'site.useCases.detail.architects.hint',
    weekKeys: ['site.useCases.detail.architects.week1', 'site.useCases.detail.architects.week2', 'site.useCases.detail.architects.week3', 'site.useCases.detail.architects.week4', 'site.useCases.detail.architects.week5'],
    features: [
      { id: 'layouts', labelKey: 'site.useCases.detail.architects.feature.layouts', link: '/features', fragment: 'layouts' },
      { id: 'blocks', labelKey: 'site.useCases.detail.architects.feature.blocks', link: '/features', fragment: 'blocks' },
      { id: 'annotate', labelKey: 'site.useCases.detail.architects.feature.annotate', link: '/features', fragment: 'annotate' },
      { id: 'dxf', labelKey: 'site.useCases.detail.architects.feature.dxf', link: '/docs', fragment: 'dxf' },
    ],
    screen: {
      src: '/site/editor-layout.webp',
      altKey: 'site.useCases.detail.architects.screen.alt',
      title: 'Bridge_GAD.dxf — Layout1',
      captionKey: 'site.useCases.detail.architects.screen.caption',
    },
  },
  engineers: {
    hintKey: 'site.useCases.detail.engineers.hint',
    weekKeys: ['site.useCases.detail.engineers.week1', 'site.useCases.detail.engineers.week2', 'site.useCases.detail.engineers.week3', 'site.useCases.detail.engineers.week4', 'site.useCases.detail.engineers.week5'],
    features: [
      { id: 'annotate', labelKey: 'site.useCases.detail.engineers.feature.annotate', link: '/features', fragment: 'annotate' },
      { id: 'layers', labelKey: 'site.useCases.detail.engineers.feature.layers', link: '/features', fragment: 'blocks' },
      { id: 'plotting', labelKey: 'site.useCases.detail.engineers.feature.plotting', link: '/features', fragment: 'layouts' },
      { id: 'dxf', labelKey: 'site.useCases.detail.engineers.feature.dxf', link: '/docs', fragment: 'dxf' },
    ],
    screen: {
      src: '/site/editor-model.webp',
      altKey: 'site.useCases.detail.engineers.screen.alt',
      title: 'Bridge_GAD.dxf — Model',
      captionKey: 'site.useCases.detail.engineers.screen.caption',
    },
  },
  students: {
    hintKey: 'site.useCases.detail.students.hint',
    weekKeys: ['site.useCases.detail.students.week1', 'site.useCases.detail.students.week2', 'site.useCases.detail.students.week3', 'site.useCases.detail.students.week4', 'site.useCases.detail.students.week5'],
    features: [
      { id: 'gettingStarted', labelKey: 'site.useCases.detail.students.feature.gettingStarted', link: '/docs', fragment: 'getting-started' },
      { id: 'commands', labelKey: 'site.useCases.detail.students.feature.commands', link: '/docs', fragment: 'commands' },
      { id: 'draw', labelKey: 'site.useCases.detail.students.feature.draw', link: '/features', fragment: 'draw' },
      { id: 'blocks', labelKey: 'site.useCases.detail.students.feature.blocks', link: '/features', fragment: 'blocks' },
    ],
    screen: {
      src: '/site/editor-blocks.webp',
      altKey: 'site.useCases.detail.students.screen.alt',
      title: 'Bridge_GAD.dxf — Blocks',
      captionKey: 'site.useCases.detail.students.screen.caption',
    },
  },
  teams: {
    hintKey: 'site.useCases.detail.teams.hint',
    weekKeys: ['site.useCases.detail.teams.week1', 'site.useCases.detail.teams.week2', 'site.useCases.detail.teams.week3', 'site.useCases.detail.teams.week4', 'site.useCases.detail.teams.week5'],
    features: [
      { id: 'files', labelKey: 'site.useCases.detail.teams.feature.files', link: '/features', fragment: 'files' },
      { id: 'ai', labelKey: 'site.useCases.detail.teams.feature.ai', link: '/features', fragment: 'ai' },
      { id: 'aiSetup', labelKey: 'site.useCases.detail.teams.feature.aiSetup', link: '/docs', fragment: 'ai' },
      { id: 'teamStart', labelKey: 'site.useCases.detail.teams.feature.teamStart', link: '/docs', fragment: 'getting-started' },
    ],
    screen: {
      src: '/site/editor-ai.webp',
      altKey: 'site.useCases.detail.teams.screen.alt',
      title: 'Bridge_GAD.dxf — Assistant',
      captionKey: 'site.useCases.detail.teams.screen.caption',
    },
  },
  builders: {
    hintKey: 'site.useCases.detail.builders.hint',
    weekKeys: ['site.useCases.detail.builders.week1', 'site.useCases.detail.builders.week2', 'site.useCases.detail.builders.week3', 'site.useCases.detail.builders.week4', 'site.useCases.detail.builders.week5'],
    features: [
      { id: 'roundtrip', labelKey: 'site.useCases.detail.builders.feature.roundtrip', link: '/features', fragment: 'files' },
      { id: 'embedding', labelKey: 'site.useCases.detail.builders.feature.embedding', link: '/docs', fragment: 'embedding' },
      { id: 'dxf', labelKey: 'site.useCases.detail.builders.feature.dxf', link: '/docs', fragment: 'dxf' },
    ],
    screen: {
      src: '/site/editor-model.webp',
      altKey: 'site.useCases.detail.builders.screen.alt',
      title: 'app-cad-editor',
      captionKey: 'site.useCases.detail.builders.screen.caption',
    },
  },
};

const CARRIES_OVER: readonly SwitchRow[] = [
  { id: 'aliases', autocadKey: 'site.useCases.carries.aliases.autocad', cadoKey: 'site.useCases.carries.aliases.cado' },
  { id: 'fnKeys', autocadKey: 'site.useCases.carries.fnKeys.autocad', cadoKey: 'site.useCases.carries.fnKeys.cado' },
  { id: 'snaps', autocadKey: 'site.useCases.carries.snaps.autocad', cadoKey: 'site.useCases.carries.snaps.cado' },
  { id: 'tables', autocadKey: 'site.useCases.carries.tables.autocad', cadoKey: 'site.useCases.carries.tables.cado' },
  { id: 'layouts', autocadKey: 'site.useCases.carries.layouts.autocad', cadoKey: 'site.useCases.carries.layouts.cado' },
  { id: 'clipboard', autocadKey: 'site.useCases.carries.clipboard.autocad', cadoKey: 'site.useCases.carries.clipboard.cado' },
];

const DIFFERENT: readonly SwitchRow[] = [
  { id: 'install', autocadKey: 'site.useCases.different.install.autocad', cadoKey: 'site.useCases.different.install.cado' },
  { id: 'files', autocadKey: 'site.useCases.different.files.autocad', cadoKey: 'site.useCases.different.files.cado' },
  { id: 'threeD', autocadKey: 'site.useCases.different.threeD.autocad', cadoKey: 'site.useCases.different.threeD.cado' },
  { id: 'scripts', autocadKey: 'site.useCases.different.scripts.autocad', cadoKey: 'site.useCases.different.scripts.cado' },
  { id: 'sharing', autocadKey: 'site.useCases.different.sharing.autocad', cadoKey: 'site.useCases.different.sharing.cado' },
];

const PLAN_ROWS: readonly PlanRow[] = [
  { tierId: 'free', whoKey: 'site.useCases.plan.free.who', whyKey: 'site.useCases.plan.free.why' },
  { tierId: 'pro', whoKey: 'site.useCases.plan.pro.who', whyKey: 'site.useCases.plan.pro.why' },
  { tierId: 'team', whoKey: 'site.useCases.plan.team.who', whyKey: 'site.useCases.plan.team.why' },
];

const API_SNIPPET = `readonly id         = input<string>();          // open this stored drawing on init
readonly initialDxf = input<string>();          // …or hand it DXF text / a JSON entity payload directly
readonly exitUrl    = input<string | null>('/dashboard'); // pass null to keep the browser-history Back behaviour
readonly save       = output<string>();         // emitted with the DXF from Plot → Export
readonly close      = output<void>();           // emitted when the user presses Back`;

const USAGE_SNIPPET = `<app-cad-editor
  [initialDxf]="dxf"
  [exitUrl]="null"
  (save)="onSave($event)"
  (close)="onClose()"
></app-cad-editor>`;

const TOKEN_SNIPPET = `{ provide: AUTH_TOKEN_PROVIDER, useExisting: MySessionService } // implements AuthTokenProvider`;

@Component({
  selector: 'app-use-cases-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoDirective,
    UiButtonDirective,
    UiIconComponent,
    SiteHeadingComponent,
    SiteTabsComponent,
    SiteScreenComponent,
    SiteClosingComponent,
    SiteRevealDirective,
  ],
  templateUrl: './use-cases.page.html',
  styleUrl: './use-cases.page.scss',
})
export class UseCasesPage {
  protected readonly audiences = AUDIENCES;
  protected readonly tabs: readonly SiteTab[] = AUDIENCES.map((a) => ({
    id: a.id,
    labelKey: a.labelKey,
    icon: a.icon,
    hintKey: DETAILS[a.id]?.hintKey,
  }));

  /** `/use-cases#engineers` opens that audience directly (the home page links this way). */
  private readonly fragment = inject(ActivatedRoute).snapshot.fragment;
  protected readonly active = signal<string>(AUDIENCES.some((a) => a.id === this.fragment) ? this.fragment! : AUDIENCES[0].id);
  protected readonly current = computed<Audience>(() => AUDIENCES.find((a) => a.id === this.active()) ?? AUDIENCES[0]);
  protected readonly detail = computed<AudienceDetail>(() => DETAILS[this.current().id]);

  protected readonly carriesOver = CARRIES_OVER;
  protected readonly different = DIFFERENT;

  protected readonly apiSnippet = API_SNIPPET;
  protected readonly usageSnippet = USAGE_SNIPPET;
  protected readonly tokenSnippet = TOKEN_SNIPPET;

  protected readonly currency = CURRENCY;
  protected readonly plans = PLAN_ROWS.map((row) => ({
    ...row,
    tier: TIERS.find((t) => t.id === row.tierId) ?? TIERS[0],
  }));
}
