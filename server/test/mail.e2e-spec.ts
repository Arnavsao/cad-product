import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { MAIL_TRANSPORT } from '../src/mail/mail.constants';
import type { MailTransport } from '../src/mail/mail.transport';
import type { OutboundEmail } from '../src/mail/mail.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { mintSessionToken, TEST_JWT_SECRET, TEST_SUPABASE_URL, testAuthId } from './support/jwt';

/**
 * Transactional email, against REAL Postgres — with a recording transport in
 * place of Resend.
 *
 * Why a transport override rather than mocking `MailService`: everything worth
 * asserting lives *above* the transport — which of the six call sites fire, how
 * many messages a fan-out produces, whether a preference was honoured, and what
 * the rendered subject and body actually say. Overriding the one provider-shaped
 * seam (`MAIL_TRANSPORT`) exercises all of that through the real controllers,
 * services, templates and preference lookups, and sends nothing.
 *
 * Same harness as `sharing.e2e-spec.ts`: self-minted HS256 tokens so the real
 * `SupabaseAuthGuard` runs, and the suite is skipped (not failed) when Docker is
 * down.
 */

function tcpReachable(url: string | undefined, defaultPort: number): boolean {
  if (!url) {
    return false;
  }
  const { hostname, port } = new URL(url);
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      `const s=require('net').connect(${Number(port || defaultPort)},${JSON.stringify(hostname)});s.setTimeout(1500);s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1));`,
    ],
    { timeout: 3000 },
  );
  return probe.status === 0;
}

const servicesUp = tcpReachable(process.env.DATABASE_URL, 5432);
const describeIfServices = servicesUp ? describe : describe.skip;

/**
 * `EMAIL_LINK_THROTTLE.default.limit` (10) plus one, so the loop below reaches
 * the limiter from a clean slate. Restated here rather than exported from the
 * controller: a private budget is not part of the module's contract, and a test
 * that forces a widened export is a worse trade than one duplicated number.
 */
const EMAIL_LINK_LIMIT_PLUS_ONE = 11;

/** Records what would have been sent, so a spec can assert on it. */
class RecordingMailTransport implements MailTransport {
  readonly name = 'recording';
  readonly sent: OutboundEmail[] = [];
  /** Set to make the next sends reject, proving a failure cannot break a share. */
  fail = false;

  send(email: OutboundEmail): Promise<void> {
    if (this.fail) {
      return Promise.reject(new Error('provider refused'));
    }
    this.sent.push(email);
    return Promise.resolve();
  }
}

describeIfServices('Transactional email (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: RecordingMailTransport;

  let aliceToken: string;
  let bobToken: string;
  let carolToken: string;
  let aliceId: string;
  let bobId: string;
  let carolId: string;

  const stamp = Date.now().toString(16);
  const aliceAuthId = testAuthId(`${stamp}a`);
  const bobAuthId = testAuthId(`${stamp}b`);
  const carolAuthId = testAuthId(`${stamp}c`);
  const aliceEmail = `alice-${stamp}@example.com`;
  const bobEmail = `bob-${stamp}@example.com`;
  const carolEmail = `carol-${stamp}@example.com`;
  /** Nobody holds this — the whole point of invitation mail. */
  const strangerEmail = `stranger-${stamp}@example.com`;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, bearer = aliceToken) => req.set('Authorization', `Bearer ${bearer}`);

  /** Clears the recorder, so each `it` asserts only on what IT caused. */
  const reset = () => {
    mail.sent.length = 0;
    mail.fail = false;
  };

  const to = (address: string) => mail.sent.filter((m) => m.to === address);

  async function createDrawing(name: string, bearer = aliceToken): Promise<string> {
    const res = await auth(http().post('/api/v1/drawings'), bearer).send({ name }).expect(201);
    return res.body.data.id;
  }

  async function createFolder(name: string, bearer = aliceToken): Promise<string> {
    const res = await auth(http().post('/api/v1/folders'), bearer).send({ name }).expect(201);
    return res.body.data.id;
  }

  async function createOrg(name: string, bearer = aliceToken): Promise<{ id: string; joinCode: string }> {
    const created = await auth(http().post('/api/v1/organizations'), bearer).send({ name }).expect(201);
    const detail = await auth(http().get(`/api/v1/organizations/${created.body.data.id}`), bearer).expect(200);
    return { id: created.body.data.id, joinCode: detail.body.data.joinCode };
  }

  beforeAll(async () => {
    process.env.SUPABASE_URL = TEST_SUPABASE_URL;
    process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    // Fixed, so the URLs inside emails are predictable regardless of `.env`.
    process.env.APP_BASE_URL = 'https://cad.test';

    const { AppModule } = await import('../src/app.module');
    mail = new RecordingMailTransport();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);

    aliceToken = await mintSessionToken({
      sub: aliceAuthId,
      email: aliceEmail,
      userMetadata: { first_name: 'Alice', last_name: 'Novak' },
    });
    bobToken = await mintSessionToken({ sub: bobAuthId, email: bobEmail });
    carolToken = await mintSessionToken({ sub: carolAuthId, email: carolEmail });

    for (const bearer of [aliceToken, bobToken, carolToken]) {
      await auth(http().get('/api/v1/me'), bearer).expect(200);
    }
    aliceId = (await prisma.user.findUniqueOrThrow({ where: { authId: aliceAuthId } })).id;
    bobId = (await prisma.user.findUniqueOrThrow({ where: { authId: bobAuthId } })).id;
    carolId = (await prisma.user.findUniqueOrThrow({ where: { authId: carolAuthId } })).id;
  });

  afterAll(async () => {
    // Cascades preferences, memberships, invites, shares, folders and drawings.
    await prisma.user.deleteMany({ where: { authId: { in: [aliceAuthId, bobAuthId, carolAuthId] } } });
    await prisma.orgInvite.deleteMany({ where: { email: strangerEmail } });
    await app?.close();
    delete process.env.APP_BASE_URL;
  });

  beforeEach(reset);

  // ---------------------------------------------------------------------------
  // Sharing with a person
  // ---------------------------------------------------------------------------

  describe('sharing a drawing with a person', () => {
    let drawingId: string;

    beforeAll(async () => {
      drawingId = await createDrawing(`Mailed Plan ${stamp}`);
    });

    it('queues exactly one share email to the person shared with', async () => {
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: bobEmail, permission: 'view' })
        .expect(200);

      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]).toMatchObject({ to: bobEmail, category: 'share' });
      expect(mail.sent[0].subject).toBe(`Alice Novak shared "Mailed Plan ${stamp}" with you`);
    });

    it('puts a working /editor/:id link in both the html and the text', async () => {
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: carolEmail, permission: 'view' })
        .expect(200);

      const sent = to(carolEmail)[0];
      expect(sent.text).toContain(`https://cad.test/editor/${drawingId}`);
      expect(sent.html).toContain(`https://cad.test/editor/${drawingId}`);
      // And the unsubscribe footer points at a route the client resolves.
      expect(sent.text).toContain('https://cad.test/dashboard/settings/notifications');
    });

    it('queues NOTHING when the same permission is re-PUT', async () => {
      // The dialog saves an unchanged row this way; mailing on it would make an
      // inbox reflect UI activity rather than access changes.
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: bobEmail, permission: 'view' })
        .expect(200);
      expect(mail.sent).toHaveLength(0);
    });

    it('queues one when view is upgraded to edit', async () => {
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: bobEmail, permission: 'edit' })
        .expect(200);
      expect(to(bobEmail)).toHaveLength(1);
      expect(to(bobEmail)[0].text).toContain('make changes');
    });

    it('queues nothing when edit is downgraded to view', async () => {
      // Losing access is not news worth an email; the in-app row still updates.
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: bobEmail, permission: 'view' })
        .expect(200);
      expect(mail.sent).toHaveLength(0);
    });

    it('honours emailOnShare: false while still publishing in-app', async () => {
      await auth(http().patch('/api/v1/me/preferences'), bobToken).send({ emailOnShare: false }).expect(200);
      const before = await auth(http().get('/api/v1/notifications'), bobToken).expect(200);

      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: bobEmail, permission: 'edit' })
        .expect(200);

      expect(to(bobEmail)).toHaveLength(0);
      const after = await auth(http().get('/api/v1/notifications'), bobToken).expect(200);
      expect(after.body.data.items.length).toBe(before.body.data.items.length + 1);

      await auth(http().patch('/api/v1/me/preferences'), bobToken).send({ emailOnShare: true }).expect(200);
    });

    it('mails a folder share with a folder link and a subtree note', async () => {
      const folderId = await createFolder(`Mailed Folder ${stamp}`);
      await auth(http().put(`/api/v1/folders/${folderId}/shares`))
        .send({ email: bobEmail, permission: 'view' })
        .expect(200);

      const sent = to(bobEmail)[0];
      expect(sent.subject).toBe(`Alice Novak shared "Mailed Folder ${stamp}" with you`);
      expect(sent.text).toContain(`https://cad.test/dashboard/folders/${folderId}`);
      expect(sent.text).toContain('Everything inside the folder');
    });

    it('mails nobody for an address with no account', async () => {
      // A share is not an invitation to sign up: mailing a stranger a link they
      // cannot open until they create an account would be worse than silence.
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: strangerEmail, permission: 'view' })
        .expect(200);
      expect(mail.sent).toHaveLength(0);
    });

    it('does not fail the share when the transport rejects', async () => {
      mail.fail = true;
      const fresh = await createDrawing(`Failing Mail ${stamp}`);
      await auth(http().put(`/api/v1/drawings/${fresh}/shares`))
        .send({ email: carolEmail, permission: 'edit' })
        .expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Sharing with an organization
  // ---------------------------------------------------------------------------

  describe('sharing with an organization', () => {
    it('mails every member but the sharer, one message each', async () => {
      const org = await createOrg(`Mail Studio ${stamp}`, bobToken);
      await auth(http().post('/api/v1/organizations/join')).send({ code: org.joinCode }).expect(200);
      await auth(http().post('/api/v1/organizations/join'), carolToken).send({ code: org.joinCode }).expect(200);
      const drawingId = await createDrawing(`Org Mailed ${stamp}`);
      reset();

      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ organizationId: org.id, permission: 'view' })
        .expect(200);

      // Bob and Carol, not Alice — and no BCC: one message per address.
      expect(mail.sent.map((m) => m.to).sort()).toEqual([bobEmail, carolEmail].sort());
      expect(to(aliceEmail)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Emailing a share link
  // ---------------------------------------------------------------------------

  describe('POST /drawings/:id/links/:linkId/email', () => {
    let drawingId: string;
    let linkId: string;
    let token: string;

    beforeAll(async () => {
      drawingId = await createDrawing(`Emailed Link ${stamp}`);
      const link = await auth(http().post(`/api/v1/drawings/${drawingId}/links`))
        .send({ permission: 'view', expiresInDays: 30 })
        .expect(201);
      linkId = link.body.data.id;
      token = link.body.data.token;
    });

    it('reports { sent: 3 } and queues three messages for three addresses', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/links/${linkId}/email`))
        .send({ emails: [`a-${stamp}@example.com`, `b-${stamp}@example.com`, `c-${stamp}@example.com`] })
        .expect(200);

      expect(res.body.data).toEqual({ sent: 3 });
      expect(mail.sent).toHaveLength(3);
      expect(mail.sent.map((m) => m.to)).toEqual([
        `a-${stamp}@example.com`,
        `b-${stamp}@example.com`,
        `c-${stamp}@example.com`,
      ]);
    });

    it('puts the /shared/:token URL and the sender’s name in the body', async () => {
      await auth(http().post(`/api/v1/drawings/${drawingId}/links/${linkId}/email`))
        .send({ emails: [`d-${stamp}@example.com`], message: 'Check the north elevation.' })
        .expect(200);

      const sent = mail.sent[0];
      expect(sent.subject).toBe(`Alice Novak shared "Emailed Link ${stamp}" with you`);
      expect(sent.text).toContain(`https://cad.test/shared/${token}`);
      // The sender is named so a recipient can see who caused the message.
      expect(sent.text).toContain('Alice Novak');
      expect(sent.text).toContain('Check the north elevation.');
      expect(sent.text).toContain('Anyone with this link');
      // The link was created with a 30-day expiry, and the body says so — "the
      // link stopped working" is otherwise indistinguishable from "revoked".
      expect(sent.text).toContain('The link stops working on');
    });

    it('collapses duplicate addresses into one message', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/links/${linkId}/email`))
        .send({ emails: [`dup-${stamp}@example.com`, `DUP-${stamp}@example.com`] })
        .expect(200);
      expect(res.body.data).toEqual({ sent: 1 });
      expect(mail.sent).toHaveLength(1);
    });

    it('refuses 11 addresses with 400 and sends nothing', async () => {
      const emails = Array.from({ length: 11 }, (_, i) => `many${i}-${stamp}@example.com`);
      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/links/${linkId}/email`))
        .send({ emails })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(mail.sent).toHaveLength(0);
    });

    it('refuses an empty list and a malformed address', async () => {
      await auth(http().post(`/api/v1/drawings/${drawingId}/links/${linkId}/email`)).send({ emails: [] }).expect(400);
      await auth(http().post(`/api/v1/drawings/${drawingId}/links/${linkId}/email`))
        .send({ emails: ['not-an-address'] })
        .expect(400);
      expect(mail.sent).toHaveLength(0);
    });

    it('refuses a message over 500 characters', async () => {
      await auth(http().post(`/api/v1/drawings/${drawingId}/links/${linkId}/email`))
        .send({ emails: [`long-${stamp}@example.com`], message: 'x'.repeat(501) })
        .expect(400);
      expect(mail.sent).toHaveLength(0);
    });

    it('needs manage — a view recipient cannot use it as a relay', async () => {
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: bobEmail, permission: 'edit' })
        .expect(200);
      reset();

      // `edit` on the contents is not `manage` over who else can see them.
      await auth(http().post(`/api/v1/drawings/${drawingId}/links/${linkId}/email`), bobToken)
        .send({ emails: [`relay-${stamp}@example.com`] })
        .expect(403);
      expect(mail.sent).toHaveLength(0);
    });

    it('answers 404 LINK_INVALID once the link is revoked', async () => {
      const fresh = await auth(http().post(`/api/v1/drawings/${drawingId}/links`))
        .send({ permission: 'view' })
        .expect(201);
      await auth(http().delete(`/api/v1/drawings/${drawingId}/links/${fresh.body.data.id}`)).expect(200);
      reset();

      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/links/${fresh.body.data.id}/email`))
        .send({ emails: [`dead-${stamp}@example.com`] })
        .expect(404);
      expect(res.body.code).toBe('LINK_INVALID');
      expect(mail.sent).toHaveLength(0);
    });

    it('answers 404 LINK_INVALID for an expired link', async () => {
      const fresh = await auth(http().post(`/api/v1/drawings/${drawingId}/links`))
        .send({ permission: 'view', expiresInDays: 7 })
        .expect(201);
      await prisma.shareLink.update({
        where: { id: fresh.body.data.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      reset();

      await auth(http().post(`/api/v1/drawings/${drawingId}/links/${fresh.body.data.id}/email`))
        .send({ emails: [`stale-${stamp}@example.com`] })
        .expect(404);
      expect(mail.sent).toHaveLength(0);
    });

    /**
     * The route's own budget is ten calls a minute (`EMAIL_LINK_THROTTLE`).
     *
     * This drives it to 429 itself rather than relying on the earlier tests in
     * this block having spent the budget already: that made the assertion
     * depend on execution order, so running this test alone (`-t`) passed for
     * the wrong reason — the limiter was never reached at all. The app-wide
     * budget no longer constrains the loop, because `test/support/e2e-env.ts`
     * raises `RATE_LIMIT_LIMIT` for the harness; the per-route budget asserted
     * here is untouched and is the one that matters.
     */
    it('rate-limits the route so it cannot become an open relay', async () => {
      const url = `/api/v1/drawings/${drawingId}/links/${linkId}/email`;
      let limited = false;
      // One more than the budget, so the limiter is reached from a clean slate
      // as well as from a partly-spent one.
      for (let attempt = 0; attempt < EMAIL_LINK_LIMIT_PLUS_ONE && !limited; attempt++) {
        reset();
        const res = await auth(http().post(url)).send({ emails: [`flood-${stamp}-${attempt}@example.com`] });
        limited = res.status === 429;
      }
      expect(limited).toBe(true);
      // A throttled request must not have sent anything.
      expect(mail.sent).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Organization invitations
  // ---------------------------------------------------------------------------

  describe('inviting to an organization', () => {
    let orgId: string;

    beforeAll(async () => {
      orgId = (await createOrg(`Mail Invites ${stamp}`)).id;
    });

    it('mails an address with NO account, with the /join/:token URL', async () => {
      const res = await auth(http().post(`/api/v1/organizations/${orgId}/invites`))
        .send({ email: strangerEmail, role: 'admin' })
        .expect(201);

      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]).toMatchObject({ to: strangerEmail, category: 'invite' });
      expect(mail.sent[0].subject).toBe(`Alice Novak invited you to Mail Invites ${stamp}`);
      expect(mail.sent[0].text).toContain(`https://cad.test/join/${res.body.data.token}`);
      expect(mail.sent[0].text).toContain('Accept invitation');
      // Names the address, because the invitation only works for that one.
      expect(mail.sent[0].text).toContain(strangerEmail);
    });

    it('mails an existing account too, alongside the in-app notification', async () => {
      await auth(http().post(`/api/v1/organizations/${orgId}/invites`))
        .send({ email: carolEmail, role: 'member' })
        .expect(201);

      expect(to(carolEmail)).toHaveLength(1);
      const inbox = await auth(http().get('/api/v1/notifications'), carolToken).expect(200);
      expect(inbox.body.data.items[0].title).toContain(`invited to Mail Invites ${stamp}`);
    });

    it('mails an invitation even when both toggles are OFF', async () => {
      // An invitation is the only way someone learns they were added to an
      // organization, so it is deliberately not gated. See MailService.
      await auth(http().patch('/api/v1/me/preferences'), carolToken)
        .send({ emailOnShare: false, emailOnOrgActivity: false })
        .expect(200);
      reset();

      await auth(http().post(`/api/v1/organizations/${orgId}/invites`))
        .send({ email: carolEmail, role: 'viewer' })
        .expect(201);
      expect(to(carolEmail)).toHaveLength(1);

      await auth(http().patch('/api/v1/me/preferences'), carolToken)
        .send({ emailOnShare: true, emailOnOrgActivity: true })
        .expect(200);
    });

    it('states the role and the expiry window', async () => {
      await auth(http().post(`/api/v1/organizations/${orgId}/invites`))
        .send({ email: `role-${stamp}@example.com`, role: 'admin' })
        .expect(201);
      expect(mail.sent[0].text).toContain('an admin');
      expect(mail.sent[0].text).toContain('14 days');
    });
  });

  // ---------------------------------------------------------------------------
  // Role changes and removals
  // ---------------------------------------------------------------------------

  describe('role changes and removals', () => {
    let orgId: string;

    beforeAll(async () => {
      const org = await createOrg(`Mail Roles ${stamp}`);
      orgId = org.id;
      await auth(http().post('/api/v1/organizations/join'), bobToken).send({ code: org.joinCode }).expect(200);
      await auth(http().post('/api/v1/organizations/join'), carolToken).send({ code: org.joinCode }).expect(200);
    });

    it('sends no email when someone JOINS — that stays in-app', async () => {
      // A shared join code can produce a stream of arrivals; filling admin
      // inboxes with them is how all of this mail ends up marked as spam.
      const org = await createOrg(`Mail Joins ${stamp}`);
      reset();
      await auth(http().post('/api/v1/organizations/join'), bobToken).send({ code: org.joinCode }).expect(200);

      expect(mail.sent).toHaveLength(0);
      const inbox = await auth(http().get('/api/v1/notifications')).expect(200);
      expect(inbox.body.data.items[0].title).toContain(`joined Mail Joins ${stamp}`);
    });

    it('mails one org email on a role change', async () => {
      await auth(http().patch(`/api/v1/organizations/${orgId}/members/${bobId}`))
        .send({ role: 'admin' })
        .expect(200);

      expect(to(bobEmail)).toHaveLength(1);
      expect(to(bobEmail)[0]).toMatchObject({ category: 'org' });
      expect(to(bobEmail)[0].subject).toBe(`Your role in Mail Roles ${stamp} changed to admin`);
      expect(to(bobEmail)[0].text).toContain('Alice Novak');
    });

    it('queues nothing when the role is re-saved unchanged', async () => {
      await auth(http().patch(`/api/v1/organizations/${orgId}/members/${bobId}`))
        .send({ role: 'admin' })
        .expect(200);
      expect(mail.sent).toHaveLength(0);
    });

    it('honours emailOnOrgActivity: false on a role change', async () => {
      await auth(http().patch('/api/v1/me/preferences'), bobToken).send({ emailOnOrgActivity: false }).expect(200);
      reset();

      await auth(http().patch(`/api/v1/organizations/${orgId}/members/${bobId}`))
        .send({ role: 'member' })
        .expect(200);
      expect(to(bobEmail)).toHaveLength(0);
      // The in-app notification still arrives.
      const inbox = await auth(http().get('/api/v1/notifications'), bobToken).expect(200);
      expect(inbox.body.data.items[0].title).toContain('is now member');

      await auth(http().patch('/api/v1/me/preferences'), bobToken).send({ emailOnOrgActivity: true }).expect(200);
    });

    it('mails one org email when someone else removes you, with no CTA', async () => {
      await auth(http().delete(`/api/v1/organizations/${orgId}/members/${bobId}`)).expect(200);

      expect(to(bobEmail)).toHaveLength(1);
      expect(to(bobEmail)[0].subject).toBe(`You were removed from Mail Roles ${stamp}`);
      // Nothing left to open, so the only anchor is the unsubscribe footer.
      expect(to(bobEmail)[0].html.match(/<a href=/g)).toHaveLength(1);
    });

    it('queues nothing when someone leaves voluntarily', async () => {
      await auth(http().delete(`/api/v1/organizations/${orgId}/members/${carolId}`), carolToken).expect(200);
      expect(mail.sent).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Preferences on the wire
  // ---------------------------------------------------------------------------

  describe('GET /me and PATCH /me/preferences', () => {
    it('reports both flags, defaulting to true', async () => {
      const res = await auth(http().get('/api/v1/me'), carolToken).expect(200);
      expect(res.body.data.preferences).toMatchObject({ emailOnShare: true, emailOnOrgActivity: true });
    });

    it('round-trips a change and leaves the other fields alone', async () => {
      const res = await auth(http().patch('/api/v1/me/preferences'), carolToken)
        .send({ emailOnShare: false })
        .expect(200);
      expect(res.body.data).toMatchObject({ emailOnShare: false, emailOnOrgActivity: true, units: 'mm' });

      const me = await auth(http().get('/api/v1/me'), carolToken).expect(200);
      expect(me.body.data.preferences.emailOnShare).toBe(false);

      await auth(http().patch('/api/v1/me/preferences'), carolToken).send({ emailOnShare: true }).expect(200);
    });

    it('round-trips a real boolean', async () => {
      const off = await auth(http().patch('/api/v1/me/preferences'), carolToken)
        .send({ emailOnShare: false })
        .expect(200);
      expect(off.body.data.emailOnShare).toBe(false);

      const on = await auth(http().patch('/api/v1/me/preferences'), carolToken)
        .send({ emailOnShare: true })
        .expect(200);
      expect(on.body.data.emailOnShare).toBe(true);
    });

    it('coerces a non-boolean through the global pipe — clients must send a real one', async () => {
      // Recorded here because it is a trap, not a feature, and it is app-wide
      // rather than something this feature introduced: the shared
      // `ValidationPipe` runs with `enableImplicitConversion`, and
      // class-transformer's boolean conversion is JS truthiness, so `@IsBoolean`
      // never actually rejects — `"false"`, `"true"` and `7` all arrive as
      // `true`. Sending the string `"false"` and getting "on" back would be a
      // miserable bug to chase from the UI, which is why the settings page
      // sends `input.checked` (a real boolean) and never a string.
      for (const value of ['false', 'true', 7]) {
        const res = await auth(http().patch('/api/v1/me/preferences'), carolToken)
          .send({ emailOnShare: value })
          .expect(200);
        expect(res.body.data.emailOnShare).toBe(true);
      }

      await auth(http().patch('/api/v1/me/preferences'), carolToken).send({ emailOnShare: true }).expect(200);
    });

    it('keeps the user id it was told about, never someone else’s', async () => {
      await auth(http().patch('/api/v1/me/preferences'), bobToken).send({ emailOnShare: false }).expect(200);
      const carol = await auth(http().get('/api/v1/me'), carolToken).expect(200);
      expect(carol.body.data.preferences.emailOnShare).toBe(true);
      expect(aliceId).toBeTruthy();

      await auth(http().patch('/api/v1/me/preferences'), bobToken).send({ emailOnShare: true }).expect(200);
    });
  });
});
