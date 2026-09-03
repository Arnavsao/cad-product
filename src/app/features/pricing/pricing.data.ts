/**
 * Pricing content.
 *
 * Presentational only — there is no payment provider wired up, so every CTA
 * routes to sign-up. Kept as data rather than markup so the tiers, the
 * comparison table and the FAQ cannot drift out of step with each other.
 *
 * The numbers here are placeholders for the product owner to set.
 */

export interface PricingTier {
  id: 'free' | 'pro' | 'team';
  name: string;
  /** Monthly price in whole currency units; 0 = free. */
  monthly: number;
  /** Per-month price when billed annually. */
  annual: number;
  tagline: string;
  /** Highlighted as the recommended tier. Exactly one should set this. */
  featured?: boolean;
  cta: string;
  highlights: string[];
}

export const CURRENCY = '$';

export const TIERS: readonly PricingTier[] = [
  {
    id: 'free',
    name: 'Free',
    monthly: 0,
    annual: 0,
    tagline: 'For occasional drawings and trying things out.',
    cta: 'Start free',
    highlights: [
      'Full 2D drafting toolset',
      '3 cloud drawings',
      '50 MB storage',
      'DXF import and export',
      'PDF and PNG plotting',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 10,
    annual: 8,
    tagline: 'For people who draw most weeks.',
    featured: true,
    cta: 'Start free trial',
    highlights: [
      'Everything in Free',
      'Unlimited cloud drawings',
      '25 GB storage',
      'Version history for 90 days',
      'Layouts, blocks and dimension styles',
      'AI drafting assistant',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    monthly: 24,
    annual: 20,
    tagline: 'For studios working on the same set of drawings.',
    cta: 'Start free trial',
    highlights: [
      'Everything in Pro',
      '250 GB shared storage',
      'Shared folders and drawing links',
      'Unlimited version history',
      'Centralised billing',
      'Priority support',
    ],
  },
];

export interface ComparisonRow {
  label: string;
  /** A string renders as text; a boolean renders as a tick or a dash. */
  free: string | boolean;
  pro: string | boolean;
  team: string | boolean;
}

export interface ComparisonGroup {
  title: string;
  rows: ComparisonRow[];
}

export const COMPARISON: readonly ComparisonGroup[] = [
  {
    title: 'Drawing',
    rows: [
      { label: '2D drafting tools', free: true, pro: true, team: true },
      { label: 'Object snaps and tracking', free: true, pro: true, team: true },
      { label: 'Layouts and plotting', free: 'Basic', pro: true, team: true },
      { label: 'Blocks and dimension styles', free: false, pro: true, team: true },
      { label: 'AI drafting assistant', free: false, pro: true, team: true },
    ],
  },
  {
    title: 'Storage',
    rows: [
      { label: 'Cloud drawings', free: '3', pro: 'Unlimited', team: 'Unlimited' },
      { label: 'Storage', free: '50 MB', pro: '25 GB', team: '250 GB' },
      { label: 'Version history', free: false, pro: '90 days', team: 'Unlimited' },
      { label: 'Autosave and recovery', free: true, pro: true, team: true },
    ],
  },
  {
    title: 'Files',
    rows: [
      { label: 'DXF import and export', free: true, pro: true, team: true },
      { label: 'PDF and PNG plot', free: true, pro: true, team: true },
      { label: 'Shared folders', free: false, pro: false, team: true },
      { label: 'Share links', free: false, pro: 'View only', team: 'View and edit' },
    ],
  },
  {
    title: 'Support',
    rows: [
      { label: 'Community and docs', free: true, pro: true, team: true },
      { label: 'Email support', free: false, pro: true, team: true },
      { label: 'Priority support', free: false, pro: false, team: true },
    ],
  },
];

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: readonly Faq[] = [
  {
    q: 'Do I need to install anything?',
    a: 'No. CADOnline runs entirely in a modern browser — there is nothing to download, and it works the same on Windows, macOS and Linux.',
  },
  {
    q: 'What happens to my drawings if I stop paying?',
    a: 'They stay yours. Your account drops to the Free tier and everything stays readable and exportable — we never hold your files hostage. You just cannot create new cloud drawings beyond the Free limit until you are under it again.',
  },
  {
    q: 'Can I use my existing DWG and DXF files?',
    a: 'DXF import and export are supported on every tier, including Free. DWG import is available and converts on upload.',
  },
  {
    q: 'Is there a student discount?',
    a: 'Yes. Tell us your institution when you sign up and we will apply it — set your role to Student in your personal info and get in touch.',
  },
  {
    q: 'Can I switch plans later?',
    a: 'Any time, in both directions. Upgrades take effect immediately; downgrades take effect at the end of the period you have already paid for.',
  },
  {
    q: 'Do you offer invoicing for teams?',
    a: 'Team plans can be invoiced annually. Get in touch through the feedback form and we will set it up.',
  },
];
