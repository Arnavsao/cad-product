import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { PlatformRole } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { mintSessionToken, TEST_JWT_SECRET, TEST_SUPABASE_URL, testAuthId } from './support/jwt';

/**
 * The admin portal's authorization, end to end: the REAL guard chain, real
 * Postgres, tokens minted the same way a Supabase session would be.
 *
 * What this is here to prove is the part that unit tests cannot: that the tier
 * comes from the database row rather than from anything the caller sends, that
 * a suspension bites on the next request, and that each mutation leaves exactly
 * one audit row behind.
 */
function postgresReachable(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return false;
  }
  const { hostname, port } = new URL(url);
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      `const s=require('net').connect(${Number(port || 5432)},${JSON.stringify(hostname)});s.setTimeout(1500);s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1));`,
    ],
    { timeout: 3000 },
  );
  return probe.status === 0;
}

const describeIfDb = postgresReachable() ? describe : describe.skip;

describeIfDb('Admin portal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // `testAuthId` keeps only hex characters, so the discriminator has to BE hex:
  // a prefix like "own" is stripped to nothing and every account would collapse
  // onto one auth id — and then the roles set below would all land on one row.
  const stamp = Date.now().toString(16).slice(-9);
  const ids = {
    owner: testAuthId(`a${stamp}`),
    admin: testAuthId(`b${stamp}`),
    support: testAuthId(`c${stamp}`),
    plain: testAuthId(`d${stamp}`),
    victim: testAuthId(`e${stamp}`),
  };
  const tokens: Record<keyof typeof ids, string> = {} as never;
  const localIds: Record<keyof typeof ids, string> = {} as never;

  beforeAll(async () => {
    process.env.SUPABASE_URL = TEST_SUPABASE_URL;
    process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);

    // Provision each account through the real `/me` path, so the rows are
    // created exactly as they would be for a real sign-in, then raise the tiers
    // directly — which is the only way in, since granting a role needs an owner.
    for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
      tokens[key] = await mintSessionToken({ sub: ids[key], email: `${key}-${stamp}@example.com` });
      await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${tokens[key]}`);
      const row = await prisma.user.findUniqueOrThrow({ where: { authId: ids[key] } });
      localIds[key] = row.id;
    }
    await prisma.user.update({ where: { authId: ids.owner }, data: { platformRole: PlatformRole.OWNER } });
    await prisma.user.update({ where: { authId: ids.admin }, data: { platformRole: PlatformRole.ADMIN } });
    await prisma.user.update({ where: { authId: ids.support }, data: { platformRole: PlatformRole.SUPPORT } });
  });

  afterAll(async () => {
    const authIds = Object.values(ids);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: Object.values(localIds) } } });
    // Safety net: every flag row this suite could have written is removed, so a
    // test that died mid-way can never leave `signups.enabled` off and break
    // whatever suite runs next.
    await prisma.featureFlag.deleteMany({});
    await prisma.user.deleteMany({ where: { authId: { in: authIds } } });
    await app.close();
  });

  const auth = (key: keyof typeof ids) => ({ Authorization: `Bearer ${tokens[key]}` });

  describe('tier enforcement', () => {
    it('refuses an unauthenticated request with 401, not 403', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/overview');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('refuses a plain user with 403 naming both tiers', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/overview').set(auth('plain'));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN', required: 'support', actual: 'user' });
    });

    it('admits SUPPORT to the overview', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/overview').set(auth('support'));
      expect(res.status).toBe(200);
      expect(res.body.data.users.total).toBeGreaterThan(0);
    });

    it('refuses SUPPORT on an ADMIN route', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${localIds.victim}/suspend`)
        .set(auth('support'))
        .send({ reason: 'testing the boundary' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ required: 'admin', actual: 'support' });
    });

    it('refuses ADMIN on an OWNER route', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/staff/${localIds.plain}`)
        .set(auth('admin'))
        .send({ role: 'support' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ required: 'owner', actual: 'admin' });
    });

    it('refuses SUPPORT on the audit log', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/audit').set(auth('support'));
      expect(res.status).toBe(403);
    });
  });

  describe('suspension', () => {
    it('suspends, then blocks that user on their very next request', async () => {
      const suspend = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${localIds.victim}/suspend`)
        .set(auth('admin'))
        .send({ reason: 'e2e: abusive uploads' });
      expect(suspend.status).toBe(201);
      expect(suspend.body.data.status).toBe('suspended');

      // The token is still perfectly valid; the account is not.
      const blocked = await request(app.getHttpServer()).get('/api/v1/me').set(auth('victim'));
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('USER_SUSPENDED');
      expect(blocked.body.reason).toBe('e2e: abusive uploads');
    });

    it('lifts the suspension and lets the user back in', async () => {
      const lift = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${localIds.victim}/unsuspend`)
        .set(auth('admin'));
      expect(lift.status).toBe(201);

      const ok = await request(app.getHttpServer()).get('/api/v1/me').set(auth('victim'));
      expect(ok.status).toBe(200);
    });

    it('requires a reason', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${localIds.victim}/suspend`)
        .set(auth('admin'))
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('refuses to suspend a staff account from the users list', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${localIds.support}/suspend`)
        .set(auth('admin'))
        .send({ reason: 'should not work' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TARGET_IS_STAFF');
    });
  });

  describe('audit trail', () => {
    it('records the suspension with actor, reason and before/after', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/audit')
        .query({ targetType: 'user', targetId: localIds.victim, action: 'user.suspend' })
        .set(auth('owner'));
      expect(res.status).toBe(200);

      const entry = res.body.data.items[0];
      expect(entry).toMatchObject({
        action: 'user.suspend',
        targetType: 'user',
        targetId: localIds.victim,
        actorEmail: `admin-${stamp}@example.com`,
        reason: 'e2e: abusive uploads',
      });
      // The trail has to show the transition, not just the end state.
      expect(entry.before.suspendedAt).toBeNull();
      expect(entry.after.status).toBe('suspended');
    });

    it('writes nothing for a refused action', async () => {
      const before = await prisma.auditLog.count({ where: { action: 'user.suspend' } });
      await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${localIds.support}/suspend`)
        .set(auth('admin'))
        .send({ reason: 'will be refused' });
      const after = await prisma.auditLog.count({ where: { action: 'user.suspend' } });
      expect(after).toBe(before);
    });
  });

  describe('feature flags', () => {
    it('publishes defaults on the public endpoint without a session', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/flags');
      expect(res.status).toBe(200);
      const signups = res.body.data.find((f: { key: string }) => f.key === 'signups.enabled');
      expect(signups.enabled).toBe(true);
    });

    it('never publishes an internal flag’s payload', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/flags');
      const internal = res.body.data.find((f: { key: string }) => f.key === 'drawings.adminDownload');
      expect(internal.payload).toBeNull();
    });

    it('an ADMIN write is visible on the public endpoint immediately', async () => {
      const write = await request(app.getHttpServer())
        .put('/api/v1/admin/flags/ai.enabled')
        .set(auth('admin'))
        .send({ enabled: false });
      expect(write.status).toBe(200);
      expect(write.body.data.overridden).toBe(true);

      const publicRes = await request(app.getHttpServer()).get('/api/v1/flags');
      const ai = publicRes.body.data.find((f: { key: string }) => f.key === 'ai.enabled');
      expect(ai.enabled).toBe(false);

      // Reset so the rest of the suite (and a re-run) sees the shipped default.
      await request(app.getHttpServer()).delete('/api/v1/admin/flags/ai.enabled').set(auth('admin'));
    });

    it('rejects a key that is not in the registry', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/admin/flags/not.a.real.flag')
        .set(auth('admin'))
        .send({ enabled: true });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('UNKNOWN_FLAG');
    });

    it('refuses a SUPPORT write but allows the read', async () => {
      expect((await request(app.getHttpServer()).get('/api/v1/admin/flags').set(auth('support'))).status).toBe(200);
      const write = await request(app.getHttpServer())
        .put('/api/v1/admin/flags/ai.enabled')
        .set(auth('support'))
        .send({ enabled: false });
      expect(write.status).toBe(403);
    });
  });

  describe('sign-ups switch', () => {
    /**
     * This is the one test that changes GLOBAL state: `signups.enabled` is not
     * scoped to a user, so while it is off *any* suite provisioning a new
     * account fails. `--runInBand` keeps the suites sequential, and the
     * `finally` below plus the safety net in `afterAll` make sure the flag is
     * never left off — including when an assertion throws.
     */
    it('refuses a brand-new account while admitting an existing one', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/admin/flags/signups.enabled')
        .set(auth('admin'))
        .send({ enabled: false });

      try {
        const newcomer = await mintSessionToken({ sub: testAuthId(`f${stamp}`), email: `new-${stamp}@example.com` });
        const refused = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${newcomer}`);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('SIGNUPS_CLOSED');

        // The switch must not lock out the people already using the product.
        const existing = await request(app.getHttpServer()).get('/api/v1/me').set(auth('plain'));
        expect(existing.status).toBe(200);
      } finally {
        await request(app.getHttpServer()).delete('/api/v1/admin/flags/signups.enabled').set(auth('admin'));
        await prisma.user.deleteMany({ where: { authId: testAuthId(`f${stamp}`) } });
      }
    });
  });

  describe('staff management', () => {
    it('an OWNER promotes and demotes', async () => {
      const promote = await request(app.getHttpServer())
        .post(`/api/v1/admin/staff/${localIds.plain}`)
        .set(auth('owner'))
        .send({ role: 'support' });
      expect(promote.status).toBe(201);
      expect(promote.body.data.platformRole).toBe('support');

      // The promotion is effective immediately, from the database row.
      expect((await request(app.getHttpServer()).get('/api/v1/admin/overview').set(auth('plain'))).status).toBe(200);

      const demote = await request(app.getHttpServer())
        .delete(`/api/v1/admin/staff/${localIds.plain}`)
        .set(auth('owner'));
      expect(demote.status).toBe(200);
      expect((await request(app.getHttpServer()).get('/api/v1/admin/overview').set(auth('plain'))).status).toBe(403);
    });

    it('refuses to change your own role', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/staff/${localIds.owner}`)
        .set(auth('owner'))
        .send({ role: 'support' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CANNOT_CHANGE_OWN_ROLE');
    });
  });

  describe('feedback triage', () => {
    let feedbackId: string;

    beforeAll(async () => {
      // Submitted through the real public endpoint, so the row looks exactly
      // like a beta tester's would.
      const res = await request(app.getHttpServer())
        .post('/api/v1/feedback')
        .set(auth('plain'))
        .send({
          kind: 'bug',
          message: 'e2e: the trim tool leaves a stray segment behind',
          context: { route: '/editor', appVersion: `e2e-${stamp}`, userAgent: 'jest' },
        });
      expect(res.status).toBe(201);
      feedbackId = res.body.data.id;
    });

    afterAll(async () => {
      await prisma.feedback.deleteMany({ where: { id: feedbackId } });
    });

    it('lists a submission for SUPPORT with its diagnostics', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/feedback')
        .query({ appVersion: `e2e-${stamp}` })
        .set(auth('support'));
      expect(res.status).toBe(200);
      expect(res.body.data.items[0]).toMatchObject({
        id: feedbackId,
        kind: 'bug',
        status: 'new',
        appVersion: `e2e-${stamp}`,
      });
    });

    it('refuses a plain user', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/feedback').set(auth('plain'));
      expect(res.status).toBe(403);
    });

    it('assigns, notes and closes in independent calls', async () => {
      const assigned = await request(app.getHttpServer())
        .patch(`/api/v1/admin/feedback/${feedbackId}`)
        .set(auth('support'))
        .send({ assigneeId: 'me' });
      expect(assigned.status).toBe(200);
      expect(assigned.body.data.assigneeEmail).toBe(`support-${stamp}@example.com`);

      const noted = await request(app.getHttpServer())
        .patch(`/api/v1/admin/feedback/${feedbackId}`)
        .set(auth('support'))
        .send({ internalNote: 'reproduced' });
      // The note must not have cleared the assignee set a moment ago.
      expect(noted.body.data.assigneeEmail).toBe(`support-${stamp}@example.com`);
      expect(noted.body.data.internalNote).toBe('reproduced');

      const closed = await request(app.getHttpServer())
        .patch(`/api/v1/admin/feedback/${feedbackId}`)
        .set(auth('support'))
        .send({ status: 'resolved' });
      expect(closed.body.data.status).toBe('resolved');
      expect(closed.body.data.resolvedAt).not.toBeNull();
    });

    it('shows the submitter that it was closed, without the staff vocabulary', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/feedback/mine').set(auth('plain'));
      const mine = res.body.data.find((f: { id: string }) => f.id === feedbackId);
      expect(mine.closed).toBe(true);
      // The internal note and the assignee are staff's business only.
      expect(mine.internalNote).toBeUndefined();
      expect(mine.assigneeId).toBeUndefined();
      expect(mine.status).toBeUndefined();
    });

    it('exports CSV without the internal note', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/feedback/export.csv')
        .query({ appVersion: `e2e-${stamp}` })
        .set(auth('support'));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('stray segment');
      expect(res.text).not.toContain('reproduced');
    });

    it('records the triage in the audit trail', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/audit')
        .query({ targetType: 'feedback', targetId: feedbackId })
        .set(auth('owner'));
      expect(res.body.data.items.length).toBeGreaterThan(0);
      expect(res.body.data.items[0].action).toBe('feedback.update');
    });
  });

  describe('plan grants', () => {
    afterAll(async () => {
      await prisma.subscription.deleteMany({ where: { userId: localIds.victim } });
    });

    it('grants a plan the account never bought, and /me reflects it', async () => {
      const granted = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${localIds.victim}/plan-override`)
        .set(auth('admin'))
        .send({ plan: 'pro', days: 30, reason: 'e2e: beta tester' });
      expect(granted.status).toBe(201);
      expect(granted.body.data.billing.overridePlan).toBe('pro');

      const me = await request(app.getHttpServer()).get('/api/v1/me').set(auth('victim'));
      expect(me.body.data.billing.plan).toBe('pro');
      expect(me.body.data.billing.grantedPlan).toBe('pro');
      // The reason staff typed is internal and must not reach the user.
      expect(JSON.stringify(me.body)).not.toContain('beta tester');
    });

    it('revoking it returns the account to Free', async () => {
      const revoked = await request(app.getHttpServer())
        .delete(`/api/v1/admin/users/${localIds.victim}/plan-override`)
        .set(auth('admin'));
      expect(revoked.status).toBe(200);

      const me = await request(app.getHttpServer()).get('/api/v1/me').set(auth('victim'));
      expect(me.body.data.billing.plan).toBe('free');
      expect(me.body.data.billing.grantedPlan).toBeNull();
    });

    it('refuses SUPPORT', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${localIds.victim}/plan-override`)
        .set(auth('support'))
        .send({ plan: 'pro', reason: 'should be refused' });
      expect(res.status).toBe(403);
    });

    it('requires a reason', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${localIds.victim}/plan-override`)
        .set(auth('admin'))
        .send({ plan: 'pro' });
      expect(res.status).toBe(400);
    });
  });

  describe('user list', () => {
    it('paginates and filters by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .query({ status: 'active', pageSize: 5 })
        .set(auth('support'));
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeLessThanOrEqual(5);
      expect(res.body.data.total).toBeGreaterThan(0);
      for (const row of res.body.data.items) {
        expect(row.status).toBe('active');
      }
    });

    it('finds an account by email fragment', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .query({ q: `support-${stamp}` })
        .set(auth('support'));
      expect(res.body.data.items[0].email).toBe(`support-${stamp}@example.com`);
    });
  });

  describe('system page', () => {
    it('reports modes without leaking any secret', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/system').set(auth('support'));
      expect(res.status).toBe(200);
      expect(res.body.data.database.reachable).toBe(true);
      expect(res.body.data.auth.mode).toBe('hs256');
      // Nothing in the payload may echo a credential.
      expect(JSON.stringify(res.body)).not.toContain(TEST_JWT_SECRET);
    });
  });
});
