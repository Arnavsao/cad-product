import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIconComponent, UiIconName } from '../../../shared/ui/icon.component';
import { RELEASE_NOTES } from '../../about/release-notes';
import { SiteClosingComponent } from '../components/closing.component';
import { SiteHeadingComponent } from '../components/heading.component';
import { Milestone, PRINCIPLES, TIMELINE } from '../data/site-content';
import { SiteRevealDirective } from '../motion/reveal.directive';

/** One block of the "how it is built" architecture strip. */
interface ArchBlock {
  id: string;
  icon: UiIconName;
  title: string;
  tech: string;
  does: readonly string[];
}

interface Candour {
  title: string;
  body: string;
}

interface FooterLink {
  icon: UiIconName;
  label: string;
  hint: string;
  link: string;
}

const ARCHITECTURE: readonly ArchBlock[] = [
  {
    id: 'browser',
    icon: 'grid',
    title: 'Your browser',
    tech: 'Angular, zoneless, signals',
    does: ['DXF parsing in a Web Worker', 'Rendering, snapping, hatching', 'Layouts and plotting to PDF, SVG, PNG', 'The AI assistant, talking to your model'],
  },
  {
    id: 'api',
    icon: 'cloud',
    title: 'The API',
    tech: 'NestJS, Postgres',
    does: ['Identity and organizations', 'Drawing metadata and folders', 'A version number for every save', 'Conflicts caught, never merged silently'],
  },
  {
    id: 'storage',
    icon: 'folder',
    title: 'Object storage',
    tech: 'S3-compatible',
    does: ['The DXF text of every version', 'Thumbnails', 'MinIO in development', 'R2 or S3 in production'],
  },
  {
    id: 'vendors',
    icon: 'shield',
    title: 'Two vendors',
    tech: 'Supabase Auth, Dodo Payments',
    does: ['Sign-in and sessions by Supabase', 'Subscriptions by Dodo, off until configured', 'Neither one ever sees a drawing'],
  },
];

const CANDOUR: readonly Candour[] = [
  {
    title: 'There is no 3D.',
    body: 'CADO is a 2D drafting editor. A phased plan for parametric 3D exists as a document; nothing from it is implemented, and nothing on this site should read as if it were.',
  },
  {
    title: 'Thirteen of the fourteen languages are drafts.',
    body: 'The non-English interface strings follow AutoCAD’s terminology per language but have not been reviewed by native-speaking drafters. English is the reference.',
  },
  {
    title: 'The Free tier’s limits are not enforced yet.',
    body: 'Three drawings and 50 MB are recorded against your account today and will be applied once billing goes live. Until then nothing stops you at the line.',
  },
  {
    title: 'The legal pages are drafts.',
    body: 'Terms of Service and the Privacy Policy carry a banner saying so. They will be replaced by reviewed versions before we take payment.',
  },
];

const LINKS: readonly FooterLink[] = [
  { icon: 'star', label: 'What’s new', hint: 'Release notes, newest first.', link: '/whats-new' },
  { icon: 'file', label: 'Documentation', hint: 'Getting started, the command reference, DXF notes.', link: '/docs' },
  { icon: 'mail', label: 'Contact', hint: 'Questions, team plans, bug reports.', link: '/contact' },
];

@Component({
  selector: 'app-about-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, UiIconComponent, SiteHeadingComponent, SiteClosingComponent, SiteRevealDirective],
  templateUrl: './about.page.html',
  styleUrl: './about.page.scss',
})
export class AboutPage {
  protected readonly principles = PRINCIPLES;
  protected readonly timeline = TIMELINE;
  protected readonly architecture = ARCHITECTURE;
  protected readonly candour = CANDOUR;
  protected readonly links = LINKS;
  protected readonly currentVersion = RELEASE_NOTES[0]?.version ?? '';

  /** `DatePipe` format for an ISO date, or `null` for a label such as "Next". */
  protected dateFormat(m: Milestone): string | null {
    if (/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return 'longDate';
    if (/^\d{4}-\d{2}$/.test(m.date)) return 'MMMM y';
    return null;
  }

  protected statusLabel(status: Milestone['status']): string {
    switch (status) {
      case 'shipped':
        return 'Shipped';
      case 'now':
        return 'Now';
      default:
        return 'Planned';
    }
  }
}
