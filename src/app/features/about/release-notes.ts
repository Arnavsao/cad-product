/**
 * Release notes shown on `/whats-new`.
 *
 * A typed const rather than markdown parsed at runtime: it keeps the page a
 * plain data render (no parser, no sanitiser, no CHANGELOG.md shipped to the
 * browser), and it lets the user-facing wording differ from the engineering
 * changelog — a changelog entry like "extracted cad-core" means nothing to
 * someone drawing a floor plan.
 *
 * Keep newest first, and keep it in step with `CHANGELOG.md` when you cut a release.
 */

export type ReleaseChangeKind = 'added' | 'improved' | 'fixed';

export interface ReleaseChange {
  kind: ReleaseChangeKind;
  title: string;
  detail: string;
}

export interface Release {
  version: string;
  /** ISO date; rendered with the user's locale. */
  date: string;
  /** One line on why this release matters. Optional for small ones. */
  summary?: string;
  changes: ReleaseChange[];
}

export const RELEASE_NOTES: readonly Release[] = [
  {
    version: '1.2.0',
    date: '2026-09-01',
    summary: 'Somewhere to tell us things, and somewhere for us to tell you things.',
    changes: [
      {
        kind: 'added',
        title: 'Feedback',
        detail:
          'Send a bug report, idea or question straight from the dashboard — pinned to the bottom of the sidebar. Your current page and app version ride along so we can reproduce what you saw.',
      },
      {
        kind: 'added',
        title: 'Notifications',
        detail:
          'An inbox in the header, with an unread badge. Imports, storage warnings and account updates land here instead of vanishing with a toast you blinked past.',
      },
      {
        kind: 'added',
        title: 'Personal info',
        detail: 'Your name, email and role in one place, separate from app preferences.',
      },
      {
        kind: 'added',
        title: 'Plans & pricing',
        detail: 'A straight answer to what CADOnline costs, and what each tier includes.',
      },
      {
        kind: 'improved',
        title: 'Settings moved to the header',
        detail:
          'Settings is now a gear in the top bar next to help and notifications, freeing the sidebar bottom for feedback.',
      },
      {
        kind: 'fixed',
        title: 'The editor no longer overflows its window',
        detail:
          'The tool ribbon could force the whole editor wider than the browser window, pushing the command bar buttons and the right-hand status toggles off screen.',
      },
      {
        kind: 'fixed',
        title: 'Zoom Extents centres properly',
        detail:
          'Focusing an empty drawing now centres the origin, and focusing a drawing centres the drawing — both previously landed off in the corner.',
      },
      {
        kind: 'fixed',
        title: 'Loading a drawing no longer shifts the layout',
        detail: 'The loading overlay was displacing the header and toolbar for as long as a drawing took to open.',
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-08-29',
    summary: 'CADOnline becomes a product rather than a standalone editor: accounts, cloud storage and a dashboard.',
    changes: [
      {
        kind: 'added',
        title: 'Accounts and cloud drawings',
        detail:
          'Sign in, and your drawings save to your account with Ctrl+S. Recent, My Drawings with folders, and Trash.',
      },
      {
        kind: 'added',
        title: 'Safe concurrent saves',
        detail:
          'Saving from two places at once no longer silently overwrites: you get Overwrite / Save as copy / Reload instead of losing work.',
      },
      {
        kind: 'added',
        title: 'Drag-and-drop upload',
        detail: 'Drop DXF files anywhere on the dashboard to import them.',
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-08-29',
    summary: 'The first standalone release of the browser CAD editor.',
    changes: [
      {
        kind: 'added',
        title: '2D drafting toolset',
        detail: 'Lines, polylines, arcs, circles, hatch, dimensions, blocks and layouts — all in the browser.',
      },
      {
        kind: 'added',
        title: 'Colour themes',
        detail:
          'Twelve built-in schemes, eight dark and four light, colouring the chrome, canvas, grid and accents together.',
      },
      {
        kind: 'added',
        title: 'DXF in and out',
        detail: 'Import and export DXF, plus PDF and PNG plotting.',
      },
    ],
  },
];

/** The version shown in the About dialog. */
export const CURRENT_VERSION = RELEASE_NOTES[0]?.version ?? '0.0.0';
