import type { RenderedEmail } from '../mail.types';

/**
 * The five transactional emails, rendered by string interpolation.
 *
 * Design decisions:
 *
 * - **No template engine.** These are five small emails with a fixed shape.
 *   Handlebars or MJML would add a dependency, a build step for the templates
 *   and a second place to look for the wording, to replace about eighty lines
 *   of interpolation.
 *
 * - **Every interpolated value is escaped, at the point of interpolation.**
 *   Drawing names, folder names, organization names and people's names are all
 *   user-controlled and all land inside HTML. `esc` is applied in `layout` and
 *   in every template that builds its own markup, so the escaping cannot be
 *   forgotten by adding a template — there is no code path that concatenates a
 *   caller's string into HTML without going through it. URLs are escaped too:
 *   a token is ours, but an attribute value is an attribute value.
 *
 * - **Inline CSS, no `<style>` block and no images.** Gmail strips `<style>`
 *   in some clients and Outlook mangles others; every mail client honours
 *   inline styles on a `div`. A `max-width` container with system fonts renders
 *   correctly everywhere without the table scaffolding older HTML email needs.
 *
 * - **Text is written, not derived.** Stripping tags from the HTML produces a
 *   text part with the CTA's label but not its URL, which is exactly the part a
 *   text-only reader needs.
 */

/** Colours, inlined per element. Kept here so the five emails stay consistent. */
const INK = '#1a1a1a';
const INK_DIM = '#5c5c5c';
const INK_FAINT = '#8a8a8a';
const RULE = '#e4e4e7';
const ACCENT = '#2563eb';

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * Escapes a user-controlled value for interpolation into HTML.
 *
 * Both quote characters are escaped, not just `<` and `&`, because these values
 * also land in attributes (`href`, `alt`). `'` is escaped as `&#39;` rather
 * than `&apos;` — the latter is not in the HTML 4 entity set and a few older
 * mail clients render it literally.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** What every email shares: a heading, paragraphs, an optional CTA, a footer. */
interface LayoutParts {
  /** First line shown in an inbox preview, before the body is opened. */
  preheader: string;
  heading: string;
  /** One `<p>` each. Pre-escaped by the caller — see `layout`'s note. */
  body: string[];
  cta?: { label: string; url: string };
  /** Why this message arrived. The "Manage email preferences" link is appended. */
  footer: string;
  /** Absolute URL of the preferences page. */
  preferencesUrl: string;
}

/**
 * Wraps body paragraphs in the shared chrome.
 *
 * `body` entries arrive **already escaped**: a paragraph like `Alice shared
 * "Site Plan"` mixes safe markup (`<strong>`) with unsafe values (the name), so
 * escaping the whole string here would double-escape the tags. Every template
 * below therefore calls `esc` on each value as it interpolates, and this
 * function escapes only what it owns: the heading, the CTA label and its URL.
 */
function layout(parts: LayoutParts): string {
  const cta = parts.cta
    ? `<p style="margin:28px 0 4px">
        <a href="${esc(parts.cta.url)}" style="display:inline-block;padding:11px 20px;background:${ACCENT};color:#ffffff;font:600 15px/1 ${FONT};text-decoration:none;border-radius:6px">${esc(parts.cta.label)}</a>
      </p>
      <p style="margin:12px 0 0;font:400 13px/1.5 ${FONT};color:${INK_FAINT};word-break:break-all">${esc(parts.cta.url)}</p>`
    : '';

  return `<div style="margin:0;padding:24px 12px;background:#f6f6f7">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(parts.preheader)}</div>
  <div style="max-width:560px;margin:0 auto;padding:32px;background:#ffffff;border:1px solid ${RULE};border-radius:12px">
    <p style="margin:0 0 24px;font:700 15px/1 ${FONT};color:${INK};letter-spacing:-.01em">CADO</p>
    <h1 style="margin:0 0 16px;font:600 21px/1.3 ${FONT};color:${INK};letter-spacing:-.01em">${esc(parts.heading)}</h1>
    ${parts.body.map((p) => `<p style="margin:0 0 14px;font:400 15px/1.6 ${FONT};color:${INK_DIM}">${p}</p>`).join('\n    ')}
    ${cta}
    <p style="margin:32px 0 0;padding-top:20px;border-top:1px solid ${RULE};font:400 13px/1.6 ${FONT};color:${INK_FAINT}">
      ${esc(parts.footer)}
      &middot; <a href="${esc(parts.preferencesUrl)}" style="color:${INK_FAINT};text-decoration:underline">Manage email preferences</a>
    </p>
  </div>
</div>`;
}

/** The text counterpart of `layout`. Values need no escaping here. */
function textLayout(parts: {
  heading: string;
  body: string[];
  cta?: { label: string; url: string };
  footer: string;
  preferencesUrl: string;
}): string {
  return [
    parts.heading,
    '',
    ...parts.body.flatMap((line) => [line, '']),
    ...(parts.cta ? [`${parts.cta.label}: ${parts.cta.url}`, ''] : []),
    '—',
    parts.footer,
    `Manage email preferences: ${parts.preferencesUrl}`,
  ].join('\n');
}

/** Bold, with the value escaped. Used for names inside body paragraphs. */
function strong(value: string): string {
  return `<strong style="color:${INK}">${esc(value)}</strong>`;
}

/** Plain escaped text inside a body paragraph. */
function plain(value: string): string {
  return esc(value);
}

// -----------------------------------------------------------------------------
// 1 — a person or an org was given access to a drawing or folder
// -----------------------------------------------------------------------------

export interface ShareReceivedInput {
  actorName: string;
  resourceKind: 'drawing' | 'folder';
  resourceName: string;
  permission: 'view' | 'edit';
  /** Absolute URL of the drawing/folder. */
  url: string;
  preferencesUrl: string;
}

/**
 * "Alice Novak shared "Site Plan" with you".
 *
 * States view-versus-edit explicitly: "shared with you" alone leaves the
 * recipient to discover by trying whether they may change anything, and finding
 * out by being refused a save is a worse way to learn it.
 */
export function shareReceived(input: ShareReceivedInput): RenderedEmail {
  const kind = input.resourceKind;
  const canEdit = input.permission === 'edit';
  const heading = `${input.actorName} shared a ${kind} with you`;
  const what = canEdit
    ? `You can open it and make changes.`
    : `You can open it and download it, but not change it.`;
  const cta = { label: kind === 'drawing' ? 'Open drawing' : 'Open folder', url: input.url };
  const extra =
    kind === 'folder'
      ? 'Everything inside the folder is shared with it, now and later.'
      : null;
  const footer = `You received this because ${input.actorName} shared a ${kind} with your address.`;

  return {
    subject: `${input.actorName} shared "${input.resourceName}" with you`,
    html: layout({
      preheader: `${input.permission === 'edit' ? 'You can edit' : 'You can view'} "${input.resourceName}".`,
      heading,
      body: [
        `${strong(input.actorName)} shared the ${kind} ${strong(input.resourceName)} with you.`,
        plain(what),
        ...(extra ? [plain(extra)] : []),
      ],
      cta,
      footer,
      preferencesUrl: input.preferencesUrl,
    }),
    text: textLayout({
      heading,
      body: [`${input.actorName} shared the ${kind} "${input.resourceName}" with you.`, what, ...(extra ? [extra] : [])],
      cta,
      footer,
      preferencesUrl: input.preferencesUrl,
    }),
  };
}

// -----------------------------------------------------------------------------
// 2 — someone emailed a share link
// -----------------------------------------------------------------------------

export interface ShareLinkSentInput {
  actorName: string;
  resourceName: string;
  permission: 'view' | 'edit';
  url: string;
  /** Optional note the sender typed. */
  message?: string | null;
  /** ISO date the link stops working, when it has one. */
  expiresAt?: string | null;
  preferencesUrl: string;
}

/**
 * A link someone chose to email, rather than copy and paste.
 *
 * Says out loud that the link works for anyone who holds it: the recipient may
 * forward it, and they should know that forwarding it hands over the same
 * access. Names the expiry when there is one, because "the link stopped
 * working" is otherwise indistinguishable from "the link was revoked".
 */
export function shareLinkSent(input: ShareLinkSentInput): RenderedEmail {
  const heading = `${input.actorName} shared a drawing with you`;
  const access = input.permission === 'edit' ? 'view and edit' : 'view';
  const lines = [
    `${input.actorName} sent you a link to the drawing "${input.resourceName}".`,
    `Anyone with this link can ${access} the drawing, so treat it as private.`,
    ...(input.expiresAt ? [`The link stops working on ${formatDate(input.expiresAt)}.`] : []),
  ];
  const htmlLines = [
    `${strong(input.actorName)} sent you a link to the drawing ${strong(input.resourceName)}.`,
    plain(`Anyone with this link can ${access} the drawing, so treat it as private.`),
    ...(input.expiresAt ? [plain(`The link stops working on ${formatDate(input.expiresAt)}.`)] : []),
  ];

  const note = input.message?.trim();
  if (note) {
    lines.splice(1, 0, `They added: “${note}”`);
    htmlLines.splice(1, 0, `They added: &ldquo;${esc(note)}&rdquo;`);
  }

  const cta = { label: 'Open drawing', url: input.url };
  const footer = `You received this because ${input.actorName} sent this link to your address.`;

  return {
    subject: `${input.actorName} shared "${input.resourceName}" with you`,
    html: layout({
      preheader: `A link to "${input.resourceName}".`,
      heading,
      body: htmlLines,
      cta,
      footer,
      preferencesUrl: input.preferencesUrl,
    }),
    text: textLayout({ heading, body: lines, cta, footer, preferencesUrl: input.preferencesUrl }),
  };
}

// -----------------------------------------------------------------------------
// 3 — an organization invitation
// -----------------------------------------------------------------------------

export interface OrgInviteInput {
  actorName: string;
  orgName: string;
  role: string;
  url: string;
  recipientEmail: string;
  /** Days until the invitation lapses (`INVITE_TTL_DAYS`). */
  expiresInDays: number;
  preferencesUrl: string;
}

/**
 * The one email that reaches someone with no account.
 *
 * It therefore names the address it was sent to: the recipient has nothing else
 * to connect it to, and an invitation is only redeemable by the address it was
 * issued for, so signing up with a different one silently fails to work.
 */
export function orgInvite(input: OrgInviteInput): RenderedEmail {
  const heading = `${input.actorName} invited you to ${input.orgName}`;
  const lines = [
    `${input.actorName} invited you to join ${input.orgName} on CADO as ${withArticle(input.role)}.`,
    `Members of an organization share its drawings and folders.`,
    `This invitation was sent to ${input.recipientEmail} and expires in ${input.expiresInDays} days. Accept it with that address — it will not work with another one.`,
  ];
  const htmlLines = [
    `${strong(input.actorName)} invited you to join ${strong(input.orgName)} on CADO as ${plain(withArticle(input.role))}.`,
    plain('Members of an organization share its drawings and folders.'),
    plain(
      `This invitation was sent to ${input.recipientEmail} and expires in ${input.expiresInDays} days. Accept it with that address — it will not work with another one.`,
    ),
  ];
  const cta = { label: 'Accept invitation', url: input.url };
  const footer = `You received this because ${input.actorName} invited ${input.recipientEmail} to ${input.orgName}.`;

  return {
    subject: `${input.actorName} invited you to ${input.orgName}`,
    html: layout({
      preheader: `Join ${input.orgName} as ${input.role}.`,
      heading,
      body: htmlLines,
      cta,
      footer,
      preferencesUrl: input.preferencesUrl,
    }),
    text: textLayout({ heading, body: lines, cta, footer, preferencesUrl: input.preferencesUrl }),
  };
}

// -----------------------------------------------------------------------------
// 4 — a role changed
// -----------------------------------------------------------------------------

export interface OrgRoleChangedInput {
  orgName: string;
  role: string;
  actorName: string;
  url: string;
  preferencesUrl: string;
}

/** "Your role in Acme Design Studio changed to admin". */
export function orgRoleChanged(input: OrgRoleChangedInput): RenderedEmail {
  const heading = `Your role in ${input.orgName} changed to ${input.role}`;
  const what =
    input.role === 'viewer'
      ? `You can open and download the organization’s drawings, but not change them.`
      : `Your access to the organization’s drawings and folders changed with it.`;
  const lines = [`${input.actorName} changed your role in ${input.orgName} to ${input.role}.`, what];
  const htmlLines = [
    `${strong(input.actorName)} changed your role in ${strong(input.orgName)} to ${strong(input.role)}.`,
    plain(what),
  ];
  const cta = { label: 'Open organization', url: input.url };
  const footer = `You received this because your role in ${input.orgName} changed.`;

  return {
    subject: `Your role in ${input.orgName} changed to ${input.role}`,
    html: layout({
      preheader: `You are now ${withArticle(input.role)} in ${input.orgName}.`,
      heading,
      body: htmlLines,
      cta,
      footer,
      preferencesUrl: input.preferencesUrl,
    }),
    text: textLayout({ heading, body: lines, cta, footer, preferencesUrl: input.preferencesUrl }),
  };
}

// -----------------------------------------------------------------------------
// 5 — access removed
// -----------------------------------------------------------------------------

export interface OrgAccessRemovedInput {
  orgName: string;
  actorName: string;
  preferencesUrl: string;
}

/**
 * "You were removed from Acme Design Studio".
 *
 * The only template with **no CTA**: there is nothing left to open, and a
 * button that lands on a 404 would read as a bug on top of the bad news. It
 * says where the drawings went, because losing sight of work you created is
 * the part a person actually asks about.
 */
export function orgAccessRemoved(input: OrgAccessRemovedInput): RenderedEmail {
  const heading = `You were removed from ${input.orgName}`;
  const lines = [
    `${input.actorName} removed you from ${input.orgName}.`,
    `Drawings and folders in that organization stay with it, so you can no longer open them. Anything in your personal workspace is untouched.`,
  ];
  const htmlLines = [
    `${strong(input.actorName)} removed you from ${strong(input.orgName)}.`,
    plain(
      'Drawings and folders in that organization stay with it, so you can no longer open them. Anything in your personal workspace is untouched.',
    ),
  ];
  const footer = `You received this because your access to ${input.orgName} changed.`;

  return {
    subject: `You were removed from ${input.orgName}`,
    html: layout({
      preheader: `Your access to ${input.orgName} ended.`,
      heading,
      body: htmlLines,
      footer,
      preferencesUrl: input.preferencesUrl,
    }),
    text: textLayout({ heading, body: lines, footer, preferencesUrl: input.preferencesUrl }),
  };
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** `admin` → `an admin`; `member` → `a member`. */
function withArticle(role: string): string {
  return /^[aeiou]/i.test(role) ? `an ${role}` : `a ${role}`;
}

/**
 * `2026-10-01T…` → `1 October 2026`, in UTC.
 *
 * Fixed locale and fixed zone: the server has no idea where the recipient is,
 * and a date that silently shifted by the server's own offset would be worse
 * than one that is unambiguous but not local.
 */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
