import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
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
  titleKey: string;
  /** The stack it is built on: product names, never translated. */
  tech: string;
  doesKeys: readonly string[];
}

interface Candour {
  id: string;
  titleKey: string;
  bodyKey: string;
}

interface FooterLink {
  id: string;
  icon: UiIconName;
  labelKey: string;
  hintKey: string;
  link: string;
}

const ARCHITECTURE: readonly ArchBlock[] = [
  {
    id: 'browser',
    icon: 'grid',
    titleKey: 'site.about.arch.browser.title',
    tech: 'Angular, zoneless, signals',
    doesKeys: ['site.about.arch.browser.does1', 'site.about.arch.browser.does2', 'site.about.arch.browser.does3', 'site.about.arch.browser.does4'],
  },
  {
    id: 'api',
    icon: 'cloud',
    titleKey: 'site.about.arch.api.title',
    tech: 'NestJS, Postgres',
    doesKeys: ['site.about.arch.api.does1', 'site.about.arch.api.does2', 'site.about.arch.api.does3', 'site.about.arch.api.does4'],
  },
  {
    id: 'storage',
    icon: 'folder',
    titleKey: 'site.about.arch.storage.title',
    tech: 'S3-compatible',
    doesKeys: ['site.about.arch.storage.does1', 'site.about.arch.storage.does2', 'site.about.arch.storage.does3', 'site.about.arch.storage.does4'],
  },
  {
    id: 'vendors',
    icon: 'shield',
    titleKey: 'site.about.arch.vendors.title',
    tech: 'Supabase Auth, Dodo Payments',
    doesKeys: ['site.about.arch.vendors.does1', 'site.about.arch.vendors.does2', 'site.about.arch.vendors.does3'],
  },
];

const CANDOUR: readonly Candour[] = [
  { id: 'threeD', titleKey: 'site.about.candour.threeD.title', bodyKey: 'site.about.candour.threeD.body' },
  { id: 'languages', titleKey: 'site.about.candour.languages.title', bodyKey: 'site.about.candour.languages.body' },
  { id: 'freeTier', titleKey: 'site.about.candour.freeTier.title', bodyKey: 'site.about.candour.freeTier.body' },
  { id: 'legal', titleKey: 'site.about.candour.legal.title', bodyKey: 'site.about.candour.legal.body' },
];

const LINKS: readonly FooterLink[] = [
  { id: 'whatsNew', icon: 'star', labelKey: 'site.about.link.whatsNew.label', hintKey: 'site.about.link.whatsNew.hint', link: '/whats-new' },
  { id: 'docs', icon: 'file', labelKey: 'site.about.link.docs.label', hintKey: 'site.about.link.docs.hint', link: '/docs' },
  { id: 'contact', icon: 'mail', labelKey: 'site.about.link.contact.label', hintKey: 'site.about.link.contact.hint', link: '/contact' },
];

@Component({
  selector: 'app-about-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, TranslocoDirective, UiIconComponent, SiteHeadingComponent, SiteClosingComponent, SiteRevealDirective],
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

  /** Translation key of the pill label for a milestone's status. */
  protected statusKey(status: Milestone['status']): string {
    switch (status) {
      case 'shipped':
        return 'site.about.status.shipped';
      case 'now':
        return 'site.about.status.now';
      default:
        return 'site.about.status.planned';
    }
  }
}
