import {
  esc,
  orgAccessRemoved,
  orgInvite,
  orgRoleChanged,
  shareLinkSent,
  shareReceived,
} from './email.templates';

/**
 * Unit spec for the five emails.
 *
 * The load-bearing case is the escaping one: drawing, folder, organization and
 * person names are all user-controlled and all land inside HTML, so a missing
 * `esc` is a stored-XSS-by-email bug. The hostile-name tests assert on the
 * ESCAPED form appearing and the RAW markup being absent, so they fail if any
 * template ever interpolates a value directly.
 */

const PREFS = 'https://cadonline.app/dashboard/settings/notifications';

/** A name that is markup, an attribute break-out and an entity all at once. */
const HOSTILE = `<img src=x onerror="alert('xss')">Roof & "Plan"`;

/**
 * The distinct tag names a rendered email may legitimately contain.
 *
 * Asserting on this set is what makes the escaping tests real: if any template
 * ever interpolated a name straight into HTML, the hostile fixture would add
 * `img` to it and the comparison would fail. Checking only for the absence of a
 * particular substring would not — an attacker picks a different tag.
 */
const EXPECTED_TAGS = ['a', 'div', 'h1', 'p', 'strong'];

/** Distinct, sorted names of tags that actually PARSE as tags in `html`. */
function liveTagNames(html: string): string[] {
  const names = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b/g)].map((m) => m[1].toLowerCase());
  return [...new Set(names)].sort();
}

const ALL = [
  shareReceived({
    actorName: 'Alice Novak',
    resourceKind: 'drawing',
    resourceName: 'Site Plan',
    permission: 'edit',
    url: 'https://cadonline.app/editor/abc',
    preferencesUrl: PREFS,
  }),
  shareLinkSent({
    actorName: 'Alice Novak',
    resourceName: 'Site Plan',
    permission: 'view',
    url: 'https://cadonline.app/shared/tok',
    message: 'Have a look at the north elevation.',
    expiresAt: '2026-10-01T00:00:00.000Z',
    preferencesUrl: PREFS,
  }),
  orgInvite({
    actorName: 'Alice Novak',
    orgName: 'Acme Design Studio',
    role: 'admin',
    url: 'https://cadonline.app/join/tok',
    recipientEmail: 'bob@example.com',
    expiresInDays: 14,
    preferencesUrl: PREFS,
  }),
  orgRoleChanged({
    orgName: 'Acme Design Studio',
    role: 'admin',
    actorName: 'Alice Novak',
    url: 'https://cadonline.app/dashboard/organization',
    preferencesUrl: PREFS,
  }),
  orgAccessRemoved({
    orgName: 'Acme Design Studio',
    actorName: 'Alice Novak',
    preferencesUrl: PREFS,
  }),
];

describe('email templates', () => {
  // ── every template ─────────────────────────────────────────────────────────

  it('all five produce a non-empty subject, html and text', () => {
    for (const mail of ALL) {
      expect(mail.subject.length).toBeGreaterThan(0);
      expect(mail.html.length).toBeGreaterThan(0);
      expect(mail.text.length).toBeGreaterThan(0);
    }
  });

  it('all five carry the unsubscribe link in both parts', () => {
    for (const mail of ALL) {
      expect(mail.html).toContain(PREFS);
      expect(mail.text).toContain(PREFS);
      expect(mail.html).toContain('Manage email preferences');
      expect(mail.text).toContain('Manage email preferences');
    }
  });

  it('all five say why the message arrived', () => {
    for (const mail of ALL) {
      expect(mail.text).toContain('You received this because');
    }
  });

  it('never emits a style block or an external image, which mail clients strip', () => {
    for (const mail of ALL) {
      expect(mail.html).not.toContain('<style');
      expect(mail.html).not.toContain('<img');
      expect(mail.html).not.toContain('<link');
    }
  });

  // ── CTA ────────────────────────────────────────────────────────────────────

  it('puts the CTA URL in the html AND in the text', () => {
    // A text-only reader gets the label but not a clickable button, so the raw
    // URL has to be present in both parts.
    const share = ALL[0];
    expect(share.html).toContain('https://cadonline.app/editor/abc');
    expect(share.text).toContain('https://cadonline.app/editor/abc');
    expect(share.html).toContain('Open drawing');
    expect(share.text).toContain('Open drawing');
  });

  it('gives a folder share a folder CTA', () => {
    const mail = shareReceived({
      actorName: 'Alice',
      resourceKind: 'folder',
      resourceName: 'Projects',
      permission: 'view',
      url: 'https://cadonline.app/dashboard/folders/f1',
      preferencesUrl: PREFS,
    });
    expect(mail.text).toContain('Open folder');
    expect(mail.text).toContain('Everything inside the folder is shared with it');
  });

  it('omits the CTA from the removal email — there is nothing left to open', () => {
    const removed = ALL[4];
    expect(removed.text).not.toContain('Open organization');
    // The only anchor left is the unsubscribe footer's.
    expect(removed.html.match(/<a href=/g)).toHaveLength(1);
    expect(removed.html).not.toContain('border-radius:6px');
  });

  // ── escaping ───────────────────────────────────────────────────────────────

  describe('esc', () => {
    it('escapes the five characters that matter in HTML and in attributes', () => {
      expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('escapes the ampersand first, so an escape is not double-escaped', () => {
      expect(esc('&lt;')).toBe('&amp;lt;');
    });
  });

  it('escapes a hostile drawing name in a share email', () => {
    const mail = shareReceived({
      actorName: 'Alice',
      resourceKind: 'drawing',
      resourceName: HOSTILE,
      permission: 'view',
      url: 'https://cadonline.app/editor/abc',
      preferencesUrl: PREFS,
    });
    // The raw tag must not survive anywhere in the markup …
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('onerror="alert');
    // … and the escaped form must be what the reader sees.
    expect(mail.html).toContain('&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;');
    expect(mail.html).toContain('Roof &amp; &quot;Plan&quot;');
    // Nothing user-supplied left a live tag or a live attribute behind: the
    // only tags in the document are the ones the layout itself opens.
    expect(liveTagNames(mail.html)).toEqual(EXPECTED_TAGS);
  });

  it('escapes a hostile name in the preheader as well as the body', () => {
    // The preheader is a hidden div, which is still HTML.
    const mail = shareReceived({
      actorName: 'Alice',
      resourceKind: 'drawing',
      resourceName: HOSTILE,
      permission: 'edit',
      url: 'https://cadonline.app/editor/abc',
      preferencesUrl: PREFS,
    });
    const preheader = /opacity:0">([^<]*)</.exec(mail.html)?.[1] ?? '';
    expect(preheader).not.toContain('<img');
    expect(preheader).toContain('&lt;img');
  });

  it('escapes a hostile actor name', () => {
    const mail = shareReceived({
      actorName: HOSTILE,
      resourceKind: 'drawing',
      resourceName: 'Site Plan',
      permission: 'view',
      url: 'https://cadonline.app/editor/abc',
      preferencesUrl: PREFS,
    });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;img src=x');
    // Including in the footer, which repeats the name.
    expect(mail.html.match(/&lt;img src=x/g)?.length).toBeGreaterThan(1);
  });

  it('escapes a hostile organization name in all three org emails', () => {
    const invite = orgInvite({
      actorName: 'Alice',
      orgName: HOSTILE,
      role: 'member',
      url: 'https://cadonline.app/join/tok',
      recipientEmail: 'bob@example.com',
      expiresInDays: 14,
      preferencesUrl: PREFS,
    });
    const changed = orgRoleChanged({
      orgName: HOSTILE,
      role: 'viewer',
      actorName: 'Alice',
      url: 'https://cadonline.app/dashboard/organization',
      preferencesUrl: PREFS,
    });
    const removed = orgAccessRemoved({ orgName: HOSTILE, actorName: 'Alice', preferencesUrl: PREFS });

    for (const mail of [invite, changed, removed]) {
      expect(mail.html).not.toContain('<img src=x');
      expect(mail.html).not.toContain('onerror="alert');
      expect(mail.html).toContain('&lt;img src=x');
      expect(liveTagNames(mail.html)).toEqual(EXPECTED_TAGS);
    }
  });

  it('escapes the sender’s note on an emailed link', () => {
    const mail = shareLinkSent({
      actorName: 'Alice',
      resourceName: 'Site Plan',
      permission: 'view',
      url: 'https://cadonline.app/shared/tok',
      message: HOSTILE,
      preferencesUrl: PREFS,
    });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;img src=x');
  });

  it('escapes a hostile URL, because an attribute value is an attribute value', () => {
    const mail = shareReceived({
      actorName: 'Alice',
      resourceKind: 'drawing',
      resourceName: 'Site Plan',
      permission: 'view',
      url: 'https://cadonline.app/editor/a"onmouseover="x',
      preferencesUrl: PREFS,
    });
    expect(mail.html).not.toContain('onmouseover="x"');
    expect(mail.html).toContain('&quot;onmouseover=&quot;x');
  });

  it('leaves the TEXT part unescaped — it is not HTML', () => {
    const mail = shareReceived({
      actorName: 'Alice',
      resourceKind: 'drawing',
      resourceName: 'Roof & Plan',
      permission: 'view',
      url: 'https://cadonline.app/editor/abc',
      preferencesUrl: PREFS,
    });
    expect(mail.text).toContain('Roof & Plan');
    expect(mail.text).not.toContain('&amp;');
  });

  // ── wording that carries information ───────────────────────────────────────

  it('names the resource in the subject', () => {
    expect(ALL[0].subject).toBe('Alice Novak shared "Site Plan" with you');
    expect(ALL[1].subject).toBe('Alice Novak shared "Site Plan" with you');
    expect(ALL[2].subject).toBe('Alice Novak invited you to Acme Design Studio');
    expect(ALL[3].subject).toBe('Your role in Acme Design Studio changed to admin');
    expect(ALL[4].subject).toBe('You were removed from Acme Design Studio');
  });

  it('states view versus edit rather than leaving it to be discovered', () => {
    const view = shareReceived({
      actorName: 'Alice',
      resourceKind: 'drawing',
      resourceName: 'Site Plan',
      permission: 'view',
      url: 'https://x/editor/1',
      preferencesUrl: PREFS,
    });
    expect(view.text).toContain('not change it');
    expect(ALL[0].text).toContain('make changes');
  });

  it('names the expiry on an emailed link, and omits the sentence when there is none', () => {
    expect(ALL[1].text).toContain('1 October 2026');
    const forever = shareLinkSent({
      actorName: 'Alice',
      resourceName: 'Site Plan',
      permission: 'view',
      url: 'https://x/shared/tok',
      preferencesUrl: PREFS,
    });
    expect(forever.text).not.toContain('stops working');
  });

  it('warns that a link works for anyone holding it', () => {
    expect(ALL[1].text).toContain('Anyone with this link');
  });

  it('names the invited address and the expiry window on an invitation', () => {
    expect(ALL[2].text).toContain('bob@example.com');
    expect(ALL[2].text).toContain('14 days');
    expect(ALL[2].text).toContain('Accept invitation');
  });

  it('explains what a viewer may do when that is the new role', () => {
    const viewer = orgRoleChanged({
      orgName: 'Acme',
      role: 'viewer',
      actorName: 'Alice',
      url: 'https://x/dashboard/organization',
      preferencesUrl: PREFS,
    });
    expect(viewer.text).toContain('not change them');
  });

  it('says where the drawings went when access is removed', () => {
    expect(ALL[4].text).toContain('stay with it');
  });

  it('says who did it on a role change and a removal', () => {
    expect(ALL[3].text).toContain('Alice Novak');
    expect(ALL[4].text).toContain('Alice Novak');
  });
});
