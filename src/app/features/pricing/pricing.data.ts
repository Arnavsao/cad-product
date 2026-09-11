/**
 * Pricing content.
 *
 * Presentational only — there is no payment provider wired up, so every CTA
 * routes to sign-up. Kept as data rather than markup so the tiers, the
 * comparison table and the FAQ cannot drift out of step with each other.
 *
 * The numbers here are placeholders for the product owner to set.
 *
 * Every prose field holds a translation KEY (`…Key`), resolved with
 * `t(item.nameKey)` in templates or `TranslocoService.translate()` in code.
 * The English text lives in `scripts/i18n/app-strings/site-pages.en.json`
 * under `site.pricing.*`. Prices, plan ids and the currency symbol stay literal.
 */

export interface PricingTier {
  id: 'free' | 'pro' | 'team';
  /** Plan name (translated; "Free", "Pro", "Team" in English). */
  nameKey: string;
  /** Monthly price in whole currency units; 0 = free. */
  monthly: number;
  /** Per-month price when billed annually. */
  annual: number;
  taglineKey: string;
  /** Highlighted as the recommended tier. Exactly one should set this. */
  featured?: boolean;
  ctaKey: string;
  highlightKeys: string[];
}

export const CURRENCY = '$';

export const TIERS: readonly PricingTier[] = [
  {
    id: 'free',
    nameKey: 'site.pricing.tier.free.name',
    monthly: 0,
    annual: 0,
    taglineKey: 'site.pricing.tier.free.tagline',
    ctaKey: 'site.pricing.tier.free.cta',
    highlightKeys: [
      'site.pricing.tier.free.highlight.toolset',
      'site.pricing.tier.free.highlight.drawings',
      'site.pricing.tier.free.highlight.storage',
      'site.pricing.tier.free.highlight.dxf',
      'site.pricing.tier.free.highlight.plot',
    ],
  },
  {
    id: 'pro',
    nameKey: 'site.pricing.tier.pro.name',
    monthly: 10,
    annual: 8,
    taglineKey: 'site.pricing.tier.pro.tagline',
    featured: true,
    ctaKey: 'site.pricing.tier.pro.cta',
    highlightKeys: [
      'site.pricing.tier.pro.highlight.everythingInFree',
      'site.pricing.tier.pro.highlight.drawings',
      'site.pricing.tier.pro.highlight.storage',
      'site.pricing.tier.pro.highlight.history',
      'site.pricing.tier.pro.highlight.layouts',
      'site.pricing.tier.pro.highlight.ai',
    ],
  },
  {
    id: 'team',
    nameKey: 'site.pricing.tier.team.name',
    monthly: 24,
    annual: 20,
    taglineKey: 'site.pricing.tier.team.tagline',
    ctaKey: 'site.pricing.tier.team.cta',
    highlightKeys: [
      'site.pricing.tier.team.highlight.everythingInPro',
      'site.pricing.tier.team.highlight.storage',
      'site.pricing.tier.team.highlight.sharing',
      'site.pricing.tier.team.highlight.history',
      'site.pricing.tier.team.highlight.billing',
      'site.pricing.tier.team.highlight.support',
    ],
  },
];

export interface ComparisonRow {
  id: string;
  labelKey: string;
  /** A string is a translation key rendered as text; a boolean renders as a tick or a dash. */
  free: string | boolean;
  pro: string | boolean;
  team: string | boolean;
}

export interface ComparisonGroup {
  id: string;
  titleKey: string;
  rows: ComparisonRow[];
}

export const COMPARISON: readonly ComparisonGroup[] = [
  {
    id: 'drawing',
    titleKey: 'site.pricing.compare.group.drawing',
    rows: [
      { id: 'tools', labelKey: 'site.pricing.compare.row.tools', free: true, pro: true, team: true },
      { id: 'snaps', labelKey: 'site.pricing.compare.row.snaps', free: true, pro: true, team: true },
      { id: 'layouts', labelKey: 'site.pricing.compare.row.layouts', free: 'site.pricing.compare.cell.basic', pro: true, team: true },
      { id: 'blocks', labelKey: 'site.pricing.compare.row.blocks', free: false, pro: true, team: true },
      { id: 'ai', labelKey: 'site.pricing.compare.row.ai', free: false, pro: true, team: true },
    ],
  },
  {
    id: 'storage',
    titleKey: 'site.pricing.compare.group.storage',
    rows: [
      {
        id: 'drawings',
        labelKey: 'site.pricing.compare.row.drawings',
        free: 'site.pricing.compare.cell.threeDrawings',
        pro: 'site.pricing.compare.cell.unlimited',
        team: 'site.pricing.compare.cell.unlimited',
      },
      {
        id: 'storage',
        labelKey: 'site.pricing.compare.row.storage',
        free: 'site.pricing.compare.cell.storageFree',
        pro: 'site.pricing.compare.cell.storagePro',
        team: 'site.pricing.compare.cell.storageTeam',
      },
      {
        id: 'history',
        labelKey: 'site.pricing.compare.row.history',
        free: false,
        pro: 'site.pricing.compare.cell.ninetyDays',
        team: 'site.pricing.compare.cell.unlimited',
      },
      { id: 'autosave', labelKey: 'site.pricing.compare.row.autosave', free: true, pro: true, team: true },
    ],
  },
  {
    id: 'files',
    titleKey: 'site.pricing.compare.group.files',
    rows: [
      { id: 'dxf', labelKey: 'site.pricing.compare.row.dxf', free: true, pro: true, team: true },
      { id: 'plot', labelKey: 'site.pricing.compare.row.plot', free: true, pro: true, team: true },
      { id: 'folders', labelKey: 'site.pricing.compare.row.folders', free: false, pro: false, team: true },
      {
        id: 'links',
        labelKey: 'site.pricing.compare.row.links',
        free: false,
        pro: 'site.pricing.compare.cell.viewOnly',
        team: 'site.pricing.compare.cell.viewAndEdit',
      },
    ],
  },
  {
    id: 'support',
    titleKey: 'site.pricing.compare.group.support',
    rows: [
      { id: 'community', labelKey: 'site.pricing.compare.row.community', free: true, pro: true, team: true },
      { id: 'email', labelKey: 'site.pricing.compare.row.emailSupport', free: false, pro: true, team: true },
      { id: 'priority', labelKey: 'site.pricing.compare.row.prioritySupport', free: false, pro: false, team: true },
    ],
  },
];

export interface Faq {
  /** Stable id: the contact page picks FAQs by it. */
  id: string;
  qKey: string;
  aKey: string;
}

export const FAQS: readonly Faq[] = [
  { id: 'install', qKey: 'site.pricing.faq.install.q', aKey: 'site.pricing.faq.install.a' },
  { id: 'stopPaying', qKey: 'site.pricing.faq.stopPaying.q', aKey: 'site.pricing.faq.stopPaying.a' },
  { id: 'dwg', qKey: 'site.pricing.faq.dwg.q', aKey: 'site.pricing.faq.dwg.a' },
  { id: 'student', qKey: 'site.pricing.faq.student.q', aKey: 'site.pricing.faq.student.a' },
  { id: 'switch', qKey: 'site.pricing.faq.switch.q', aKey: 'site.pricing.faq.switch.a' },
  { id: 'invoicing', qKey: 'site.pricing.faq.invoicing.q', aKey: 'site.pricing.faq.invoicing.a' },
];
