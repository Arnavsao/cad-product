import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
  label: string;
  link: '/features' | '/docs';
  fragment: string;
}

/** What the shared `Audience` record does not carry: the page-specific detail. */
interface AudienceDetail {
  /** One line under the tab label. */
  hint: string;
  /** Four or five concrete steps. Every one is a shipped capability. */
  week: readonly string[];
  features: readonly FeatureLink[];
  screen: { src: string; alt: string; title: string; caption: string };
}

interface SwitchRow {
  autocad: string;
  cado: string;
}

interface PlanRow {
  tierId: 'free' | 'pro' | 'team';
  who: string;
  why: string;
}

const DETAILS: Readonly<Record<string, AudienceDetail>> = {
  architects: {
    hint: 'Plans, sheets and schedules',
    week: [
      'Drop the consultant’s DXF on the dashboard. It parses in a background worker and opens with its layers, blocks, linetypes and dimension styles intact.',
      'Draw the new work on your own layers: LA to create them, PL and O for walls at an offset, TR and F to clean the junctions, H to hatch the new build.',
      'Make a door once with B, give it attributes, place it with I. Change the definition in BEDIT and every instance follows.',
      'Add a layout, choose A1, place viewports with MV at 1:100 for the plan and 1:20 for the detail, then set the sheet up with PAGESETUP.',
      'PLOT the sheet to PDF with lineweights, DXFOUT the model back to the consultant, and send the client a view-only link.',
    ],
    features: [
      { label: 'Layouts, viewports and plotting', link: '/features', fragment: 'layouts' },
      { label: 'Blocks, attributes and the block editor', link: '/features', fragment: 'blocks' },
      { label: 'Hatch, dimension styles and MText', link: '/features', fragment: 'annotate' },
      { label: 'DXF compatibility notes', link: '/docs', fragment: 'dxf' },
    ],
    screen: {
      src: '/site/editor-layout.webp',
      alt: 'The CADO editor on a paper-space layout tab: a sheet with a viewport framing a bridge general-arrangement drawing.',
      title: 'Bridge_GAD.dxf — Layout1',
      caption: 'A layout tab: the sheet, one viewport at scale, and the model behind it.',
    },
  },
  engineers: {
    hint: 'GA drawings as issued',
    week: [
      'Open the bridge GA. Dimension values, plot-scale overrides, per-style fonts and layer lineweights import as AutoCAD wrote them, so the sheet reads as issued.',
      'Check a span with DI, then open the properties panel with PR to read the layer, linetype and dimension style of anything you select.',
      'Isolate the reinforcement layer from the Layers panel, freeze what is in the way, and mark the changed member with a DIMLINEAR and an MLD note.',
      'Set the precision and units of the dimension style once with DIMSTYLE rather than editing each value.',
      'PLOT to PDF with lineweights honoured, or PUBLISH every layout to one file. Each Ctrl+S keeps a version you can restore from the dashboard.',
    ],
    features: [
      { label: 'Annotation: dimensions, leaders, styles', link: '/features', fragment: 'annotate' },
      { label: 'Layers and properties', link: '/features', fragment: 'blocks' },
      { label: 'Plotting and publishing', link: '/features', fragment: 'layouts' },
      { label: 'What imports faithfully from DXF', link: '/docs', fragment: 'dxf' },
    ],
    screen: {
      src: '/site/editor-model.webp',
      alt: 'The CADO editor with a bridge general-arrangement DXF open in model space, toolbar above, command line and status bar below, layers and properties on the right.',
      title: 'Bridge_GAD.dxf — Model',
      caption: 'The model tab. Dimensions, text and lineweights are the file’s own.',
    },
  },
  students: {
    hint: 'Free, nothing to install',
    week: [
      'Create a free account and open the editor on whatever the room has: a Chromebook, a shared lab machine, a laptop at home. There is nothing to install.',
      'Follow the tutor’s commands as typed: L, C, TR, F answer the same prompts as AutoCAD. F3 toggles object snaps, F8 ortho, F12 dynamic input.',
      'Dimension the exercise with DIM and set the style with DIMSTYLE. Move a wall and watch the dimension follow it.',
      'Draw a door once, make it a block with B, place it forty times with I. Fix the definition in BEDIT and every one updates.',
      'Hand in a PDF plotted at a real scale and the DXF itself, which opens in the department’s AutoCAD with the same layers.',
    ],
    features: [
      { label: 'Getting started', link: '/docs', fragment: 'getting-started' },
      { label: 'Command reference with AutoCAD aliases', link: '/docs', fragment: 'commands' },
      { label: 'Draw and modify commands', link: '/features', fragment: 'draw' },
      { label: 'Blocks and layers', link: '/features', fragment: 'blocks' },
    ],
    screen: {
      src: '/site/editor-blocks.webp',
      alt: 'The CADO Blocks palette open beside the drawing, listing the blocks defined in the file.',
      title: 'Bridge_GAD.dxf — Blocks',
      caption: 'The Blocks palette: every definition in the drawing, ready to drag in.',
    },
  },
  teams: {
    hint: 'Shared drawings, roles, versions',
    week: [
      'Create an organization and add the studio with owner, admin, member and viewer roles. Share a folder with it and the project’s drawings are in one place.',
      'Two people press Ctrl+S on the same drawing. The second gets Overwrite, Save as copy or Reload instead of a silent overwrite.',
      'Something went wrong on Wednesday. Open version history on the dashboard, pick Tuesday’s save, restore it.',
      'Ask the assistant to “isolate WALLS” or “change every red line on DIM to blue”. It shows the action, labels it safe, review or destructive, and every result is undoable.',
      'Send the client a view-only link and the consultant an edit link. Both open in a browser; nobody installs a viewer.',
    ],
    features: [
      { label: 'Files, versions and sharing', link: '/features', fragment: 'files' },
      { label: 'The AI assistant', link: '/features', fragment: 'ai' },
      { label: 'Setting up a model for the assistant', link: '/docs', fragment: 'ai' },
      { label: 'Getting a team started', link: '/docs', fragment: 'getting-started' },
    ],
    screen: {
      src: '/site/editor-ai.webp',
      alt: 'The CADO AI assistant panel open beside the drawing, with a plain-English request and the proposed editor actions listed for review.',
      title: 'Bridge_GAD.dxf — Assistant',
      caption: 'The assistant proposes editor commands; you review before anything changes.',
    },
  },
  builders: {
    hint: 'Embed the editor',
    week: [
      'Deploy CADO on its own origin and link to /editor, or mount <app-cad-editor> inside your Angular application.',
      'Leave the Supabase keys empty. The editor runs in embedded mode: no sign-in, guards pass through, a 401 never redirects to our pages.',
      'Provide AUTH_TOKEN_PROVIDER from your own session service so the API calls carry your token, minted on demand if you like.',
      'Hand a drawing over with initialDxf, or through DrawingTransferService when it comes from another page of yours.',
      'Receive the DXF back on (save) and store it wherever you keep files. Nothing about the format is ours.',
    ],
    features: [
      { label: 'DXF round-trip', link: '/features', fragment: 'files' },
      { label: 'Embedding guide', link: '/docs', fragment: 'embedding' },
      { label: 'DXF compatibility', link: '/docs', fragment: 'dxf' },
    ],
    screen: {
      src: '/site/editor-model.webp',
      alt: 'The CADO editor with a bridge general-arrangement DXF open in model space, dark theme, toolbar above and command line below.',
      title: 'app-cad-editor',
      caption: 'The same surface, as a component. Twelve themes, fourteen languages, your identity system.',
    },
  },
};

const CARRIES_OVER: readonly SwitchRow[] = [
  { autocad: 'L, C, A, TR, F, O, MI, RO, DIMSTYLE at the command line', cado: 'The same aliases and the same prompts. Over seventy commands answer to their AutoCAD names.' },
  { autocad: 'F3 osnap, F7 grid, F8 ortho, F10 polar, F11 tracking, F12 dynamic input', cado: 'The same keys toggle the same things; the status bar shows their state.' },
  { autocad: 'Object snaps from Endpoint to Parallel', cado: 'Fourteen of them, plus ortho and polar tracking.' },
  { autocad: 'Layers, blocks, attributes, linetypes, dimension styles, hatches, MText, tables', cado: 'Read from the DXF and written back with the drawing’s own tables, not a template.' },
  { autocad: 'Model space, layout tabs, MVIEW, PAGESETUP, PLOT, PUBLISH', cado: 'Paper-space layouts with viewports at a real scale, plotted to PDF, SVG or an image.' },
  { autocad: 'Ctrl+C, Ctrl+V, COPYBASE, PASTEBLOCK', cado: 'Copy with a base point, paste to original coordinates or as a block.' },
];

const DIFFERENT: readonly SwitchRow[] = [
  { autocad: 'An installer per machine, a licence per seat', cado: 'A browser tab. Chrome, Edge, Safari or Firefox on Windows, macOS, Linux or ChromeOS. Updates arrive with the page.' },
  { autocad: 'DWG on a network share', cado: 'Drawings in your account, versioned on every save, or on disk as DXF. A .dwg can be stored in your account but not opened; the editor works on DXF, and there is no DWG export.' },
  { autocad: '3D modelling, visual styles, a ViewCube', cado: 'Not yet. CADO is 2D drafting. A phased plan for parametric 3D exists; nothing from it has shipped.' },
  { autocad: 'Scripts and macros for repetitive edits', cado: 'An optional assistant that compiles plain English into ordinary commands, previews them and keeps them undoable. Bring your own model: Ollama locally or an OpenRouter key.' },
  { autocad: 'Emailing a PDF, or asking the client to install a viewer', cado: 'A link. View-only or edit, opened in a browser.' },
];

const PLAN_ROWS: readonly PlanRow[] = [
  { tierId: 'free', who: 'Students and occasional drawings', why: 'The full drafting toolset, DXF in and out, PDF and PNG plotting. Enough for coursework and the drawing you open twice a year.' },
  { tierId: 'pro', who: 'Architects and engineers who draw most weeks', why: 'Unlimited cloud drawings, ninety days of version history, layouts, blocks and dimension styles, and the AI assistant.' },
  { tierId: 'team', who: 'Studios working on the same set of drawings', why: 'Shared folders, view and edit links, unlimited version history and one bill for everyone.' },
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
    label: a.label,
    icon: a.icon,
    hint: DETAILS[a.id]?.hint,
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
