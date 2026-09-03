import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { userPrefix } from '../src/storage/storage-keys';
import { StorageService } from '../src/storage/storage.service';
import { mintSessionToken, TEST_JWT_SECRET, TEST_SUPABASE_URL, testAuthId } from './support/jwt';

/**
 * Organizations, drawing-name uniqueness and numbered pagination against REAL
 * Postgres and MinIO.
 *
 * Same harness as `drawings.e2e-spec.ts`: self-minted HS256 tokens so the real
 * `SupabaseAuthGuard` runs, and the whole suite is skipped (not failed) when
 * Docker is not up.
 *
 * Three users, because most of what is being tested is only observable with
 * more than one person in the room: `owner` creates the org, `member` joins it,
 * and `stranger` must not be able to see any of it.
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

const servicesUp = tcpReachable(process.env.DATABASE_URL, 5432) && tcpReachable(process.env.S3_ENDPOINT, 9000);
const describeIfServices = servicesUp ? describe : describe.skip;

describeIfServices('Organizations, names & paging (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;

  let ownerToken: string;
  let memberToken: string;
  let strangerToken: string;
  let ownerId: string;
  let memberId: string;
  let strangerId: string;

  const stamp = Date.now().toString(16);
  // The distinguishing character goes at the END: `testAuthId` strips
  // non-hex characters and then keeps the last 12, so a leading `o`/`m`/`s`
  // would be dropped and all three users would share one auth id.
  const ownerAuthId = testAuthId(`${stamp}a`);
  const memberAuthId = testAuthId(`${stamp}b`);
  const strangerAuthId = testAuthId(`${stamp}c`);
  const memberEmail = `member-${stamp}@example.com`;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, bearer = ownerToken) => req.set('Authorization', `Bearer ${bearer}`);

  /** `POST /drawings` and return the created DTO. */
  async function createDrawing(
    body: Record<string, unknown>,
    bearer = ownerToken,
    expectStatus = 201,
  ): Promise<Record<string, never> & { id: string; name: string }> {
    const res = await auth(http().post('/api/v1/drawings'), bearer).send(body).expect(expectStatus);
    return res.body.data;
  }

  beforeAll(async () => {
    process.env.SUPABASE_URL = TEST_SUPABASE_URL;
    process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';

    // Lazy import for the same reason as the drawings suite: `ConfigModule`
    // snapshots the environment as `app.module.ts` is evaluated.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);

    ownerToken = await mintSessionToken({ sub: ownerAuthId, email: `owner-${stamp}@example.com` });
    memberToken = await mintSessionToken({ sub: memberAuthId, email: memberEmail });
    strangerToken = await mintSessionToken({ sub: strangerAuthId, email: `stranger-${stamp}@example.com` });

    for (const bearer of [ownerToken, memberToken, strangerToken]) {
      await auth(http().get('/api/v1/me'), bearer).expect(200);
    }
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { authId: ownerAuthId } })).id;
    memberId = (await prisma.user.findUniqueOrThrow({ where: { authId: memberAuthId } })).id;
    strangerId = (await prisma.user.findUniqueOrThrow({ where: { authId: strangerAuthId } })).id;
  });

  afterAll(async () => {
    for (const id of [ownerId, memberId, strangerId]) {
      if (id) {
        await storage.deletePrefix(userPrefix(id)).catch(() => undefined);
      }
    }
    // Cascades memberships, invites, folders and drawings in both workspaces.
    await prisma.user.deleteMany({
      where: { authId: { in: [ownerAuthId, memberAuthId, strangerAuthId] } },
    });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Name uniqueness — personal workspace
  // ---------------------------------------------------------------------------

  describe('drawing name uniqueness', () => {
    let folderId: string;

    beforeAll(async () => {
      const res = await auth(http().post('/api/v1/folders')).send({ name: `Names ${stamp}` }).expect(201);
      folderId = res.body.data.id;
    });

    it('auto-suffixes a second drawing with the same name in the same folder', async () => {
      const first = await createDrawing({ name: 'Site Plan', folderId });
      const second = await createDrawing({ name: 'Site Plan', folderId });
      const third = await createDrawing({ name: 'Site Plan', folderId });

      expect(first.name).toBe('Site Plan');
      expect(second.name).toBe('Site Plan (2)');
      expect(third.name).toBe('Site Plan (3)');
    });

    it('leaves the name alone in a different folder — uniqueness is per folder', async () => {
      const other = await auth(http().post('/api/v1/folders'))
        .send({ name: `Names alt ${stamp}` })
        .expect(201);
      const drawing = await createDrawing({ name: 'Site Plan', folderId: other.body.data.id });
      expect(drawing.name).toBe('Site Plan');
    });

    it('answers 409 NAME_TAKEN for an explicit rename onto a sibling’s name', async () => {
      const target = await createDrawing({ name: 'Rename Target', folderId });

      const res = await auth(http().patch(`/api/v1/drawings/${target.id}`))
        .send({ name: 'Site Plan' })
        .expect(409);

      expect(res.body).toMatchObject({ success: false, code: 'NAME_TAKEN' });
      expect(res.body.message).toContain('Site Plan');
    });

    it('allows a rename to the drawing’s own current name (no self-conflict)', async () => {
      const drawing = await createDrawing({ name: 'Self Rename', folderId });
      await auth(http().patch(`/api/v1/drawings/${drawing.id}`)).send({ name: 'Self Rename' }).expect(200);
    });

    it('escalates (copy) → (copy 2) when duplicating repeatedly', async () => {
      const source = await createDrawing({ name: 'Dup Me', folderId });

      const first = await auth(http().post(`/api/v1/drawings/${source.id}/duplicate`)).send({}).expect(201);
      const second = await auth(http().post(`/api/v1/drawings/${source.id}/duplicate`)).send({}).expect(201);

      expect(first.body.data.name).toBe('Dup Me (copy)');
      expect(second.body.data.name).toBe('Dup Me (copy 2)');
    });

    it('frees a name when the drawing is trashed, and re-suffixes on restore', async () => {
      const original = await createDrawing({ name: 'Recycled', folderId });

      // Trash it, then take the name with a new drawing …
      await auth(http().delete(`/api/v1/drawings/${original.id}`)).expect(200);
      const replacement = await createDrawing({ name: 'Recycled', folderId });
      expect(replacement.name).toBe('Recycled');

      // … so restoring the first one has to move out of the way rather than
      // fail and leave the user unable to recover their drawing.
      const restored = await auth(http().post(`/api/v1/drawings/${original.id}/restore`)).expect(200);
      expect(restored.body.data.name).toBe('Recycled (2)');
    });
  });

  // ---------------------------------------------------------------------------
  // Organizations
  // ---------------------------------------------------------------------------

  describe('organizations', () => {
    let orgId: string;
    let joinCode: string;

    it('POST /organizations makes the creator an owner', async () => {
      const res = await auth(http().post('/api/v1/organizations'))
        .send({ name: `Acme Design ${stamp}` })
        .expect(201);

      orgId = res.body.data.id;
      expect(res.body.data).toMatchObject({ role: 'owner', memberCount: 1 });
      expect(res.body.data.slug).toMatch(/^acme-design-/);
    });

    it('surfaces the org on GET /me so the switcher can render immediately', async () => {
      const res = await auth(http().get('/api/v1/me')).expect(200);
      expect(res.body.data.organizations).toEqual([expect.objectContaining({ id: orgId, role: 'owner' })]);
    });

    it('discloses the join code to an admin', async () => {
      const res = await auth(http().get(`/api/v1/organizations/${orgId}`)).expect(200);
      joinCode = res.body.data.joinCode;
      expect(joinCode).toMatch(/^[A-Z2-9]{8}$/);
    });

    it('hides the org from a non-member as 404, never 403', async () => {
      await auth(http().get(`/api/v1/organizations/${orgId}`), strangerToken).expect(404);
      const res = await auth(http().get('/api/v1/organizations'), strangerToken).expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('lets a second user join with the code, as a plain member', async () => {
      const res = await auth(http().post('/api/v1/organizations/join'), memberToken)
        .send({ code: joinCode })
        .expect(200);
      expect(res.body.data).toMatchObject({ id: orgId, role: 'member', memberCount: 2 });
    });

    it('answers 409 ALREADY_MEMBER when the same user joins twice', async () => {
      const res = await auth(http().post('/api/v1/organizations/join'), memberToken)
        .send({ code: joinCode })
        .expect(409);
      expect(res.body.code).toBe('ALREADY_MEMBER');
    });

    it('withholds the join code from a plain member', async () => {
      const res = await auth(http().get(`/api/v1/organizations/${orgId}`), memberToken).expect(200);
      expect(res.body.data.joinCode).toBeNull();
      expect(res.body.data.role).toBe('member');
    });

    it('refuses a member’s attempt to change roles with 403 ORG_FORBIDDEN', async () => {
      const res = await auth(http().patch(`/api/v1/organizations/${orgId}/members/${ownerId}`), memberToken)
        .send({ role: 'member' })
        .expect(403);
      expect(res.body.code).toBe('ORG_FORBIDDEN');
    });

    it('lets the owner promote the member to admin', async () => {
      const res = await auth(http().patch(`/api/v1/organizations/${orgId}/members/${memberId}`))
        .send({ role: 'admin' })
        .expect(200);
      expect(res.body.data).toMatchObject({ userId: memberId, role: 'admin' });
    });

    it('lists members owners-first', async () => {
      const res = await auth(http().get(`/api/v1/organizations/${orgId}/members`)).expect(200);
      expect(res.body.data.map((m: { role: string }) => m.role)).toEqual(['owner', 'admin']);
    });

    it('refuses to let the last owner leave with 409 LAST_OWNER', async () => {
      const res = await auth(http().delete(`/api/v1/organizations/${orgId}/members/${ownerId}`)).expect(409);
      expect(res.body.code).toBe('LAST_OWNER');
    });

    it('rotates the join code, invalidating the old one', async () => {
      const res = await auth(http().post(`/api/v1/organizations/${orgId}/regenerate-join-code`)).expect(200);
      expect(res.body.data.joinCode).not.toBe(joinCode);

      const stale = await auth(http().post('/api/v1/organizations/join'), strangerToken)
        .send({ code: joinCode })
        .expect(404);
      expect(stale.body.code).toBe('ORG_NOT_FOUND');
      joinCode = res.body.data.joinCode;
    });

    // ── invites ──────────────────────────────────────────────────────────────

    it('rejects inviting someone who is already a member', async () => {
      const res = await auth(http().post(`/api/v1/organizations/${orgId}/invites`))
        .send({ email: memberEmail })
        .expect(409);
      expect(res.body.code).toBe('ALREADY_MEMBER');
    });

    it('refuses an invite token redeemed by the wrong account', async () => {
      // Invite an address nobody in this suite owns …
      await auth(http().post(`/api/v1/organizations/${orgId}/invites`))
        .send({ email: `nobody-${stamp}@example.com`, role: 'admin' })
        .expect(201);
      const invite = await prisma.orgInvite.findFirstOrThrow({
        where: { organizationId: orgId, email: `nobody-${stamp}@example.com` },
      });

      // … so the stranger holding the link is not its addressee.
      const res = await auth(http().post('/api/v1/organizations/join'), strangerToken)
        .send({ token: invite.token })
        .expect(404);
      expect(res.body.code).toBe('INVITE_INVALID');
    });

    // ── org drawings ─────────────────────────────────────────────────────────

    describe('org drawings', () => {
      let orgDrawingId: string;

      it('creates a drawing in the org that every member can see', async () => {
        const created = await createDrawing({ name: 'Shared Bridge', organizationId: orgId });
        orgDrawingId = created.id;

        const asMember = await auth(http().get(`/api/v1/drawings/${orgDrawingId}`), memberToken).expect(200);
        expect(asMember.body.data).toMatchObject({ organizationId: orgId, name: 'Shared Bridge' });
        // The Owner / Shared columns are fed straight from the list payload.
        expect(asMember.body.data.owner).toMatchObject({ id: ownerId });
        expect(asMember.body.data.organizationName).toContain('Acme Design');
      });

      it('keeps org drawings out of a member’s personal list', async () => {
        const personal = await auth(http().get('/api/v1/drawings'), memberToken).expect(200);
        expect(personal.body.data.items.map((d: { id: string }) => d.id)).not.toContain(orgDrawingId);

        const shared = await auth(http().get(`/api/v1/drawings?organizationId=${orgId}`), memberToken).expect(200);
        expect(shared.body.data.items.map((d: { id: string }) => d.id)).toContain(orgDrawingId);
      });

      it('hides org drawings from a non-member as 404', async () => {
        await auth(http().get(`/api/v1/drawings/${orgDrawingId}`), strangerToken).expect(404);
        await auth(http().get(`/api/v1/drawings?organizationId=${orgId}`), strangerToken).expect(404);
      });

      it('stops two members from creating the same name in one org', async () => {
        const mine = await createDrawing({ name: 'Contested', organizationId: orgId });
        const theirs = await createDrawing({ name: 'Contested', organizationId: orgId }, memberToken);

        expect(mine.name).toBe('Contested');
        // The org-scoped index catches a collision between different owners,
        // which an `ownerId`-keyed constraint would have missed entirely.
        expect(theirs.name).toBe('Contested (2)');
      });

      it('lets the same name exist personally and in the org', async () => {
        const personal = await createDrawing({ name: 'Shared Bridge' });
        expect(personal.name).toBe('Shared Bridge');
      });

      it('writes a teammate’s save under the creator’s storage prefix', async () => {
        const dxf = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n';
        await auth(http().put(`/api/v1/drawings/${orgDrawingId}/content`), memberToken)
          .set('Content-Type', 'text/plain')
          .set('If-Match', '1')
          .send(dxf)
          .expect(200);

        const row = await prisma.drawing.findUniqueOrThrow({ where: { id: orgDrawingId } });
        // Keyed on the owner, not the caller: every version of one drawing has
        // to live under a single prefix or history and cleanup both break.
        expect(row.storageKey).toBe(`users/${ownerId}/drawings/${orgDrawingId}/v2.dxf`);
        expect(row.currentVersion).toBe(2);
      });

      it('refuses to move an org drawing into a personal folder', async () => {
        const personalFolder = await auth(http().post('/api/v1/folders'))
          .send({ name: `Personal ${stamp}` })
          .expect(201);

        const res = await auth(http().patch(`/api/v1/drawings/${orgDrawingId}`))
          .send({ folderId: personalFolder.body.data.id })
          .expect(422);
        expect(res.body.code).toBe('CROSS_WORKSPACE_MOVE');
      });

      it('lets a member trash an org drawing, and the owner restore it', async () => {
        await auth(http().delete(`/api/v1/drawings/${orgDrawingId}`), memberToken).expect(200);
        const trash = await auth(http().get(`/api/v1/drawings/trash?organizationId=${orgId}`)).expect(200);
        expect(trash.body.data.items.map((d: { id: string }) => d.id)).toContain(orgDrawingId);
        await auth(http().post(`/api/v1/drawings/${orgDrawingId}/restore`)).expect(200);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Numbered pagination
  // ---------------------------------------------------------------------------

  describe('numbered pagination', () => {
    let folderId: string;
    const total = 12;

    beforeAll(async () => {
      const res = await auth(http().post('/api/v1/folders')).send({ name: `Paging ${stamp}` }).expect(201);
      folderId = res.body.data.id;
      // Sequential, not Promise.all: `freeName` reads the taken names, so
      // concurrent creates would race and the assertion below is about paging.
      for (let i = 0; i < total; i++) {
        await createDrawing({ name: `Paged ${String(i).padStart(2, '0')}`, folderId });
      }
    });

    it('reports total/page/pageSize and returns disjoint pages', async () => {
      const first = await auth(http().get(`/api/v1/drawings?folderId=${folderId}&page=1&limit=5`)).expect(200);
      const second = await auth(http().get(`/api/v1/drawings?folderId=${folderId}&page=2&limit=5`)).expect(200);
      const third = await auth(http().get(`/api/v1/drawings?folderId=${folderId}&page=3&limit=5`)).expect(200);

      expect(first.body.data).toMatchObject({ total, page: 1, pageSize: 5, nextCursor: null });
      expect(first.body.data.items).toHaveLength(5);
      expect(second.body.data.items).toHaveLength(5);
      expect(third.body.data.items).toHaveLength(2);

      const ids = [first, second, third].flatMap((r) => r.body.data.items.map((d: { id: string }) => d.id));
      expect(new Set(ids).size).toBe(total);
    });

    it('clamps a page past the end to the last page', async () => {
      const res = await auth(http().get(`/api/v1/drawings?folderId=${folderId}&page=99&limit=5`)).expect(200);
      expect(res.body.data.page).toBe(3);
      expect(res.body.data.items).toHaveLength(2);
    });

    it('still supports cursor paging, with no total, when ?page= is absent', async () => {
      const res = await auth(http().get(`/api/v1/drawings?folderId=${folderId}&limit=5`)).expect(200);
      expect(res.body.data.nextCursor).toBeTruthy();
      expect(res.body.data.total).toBeUndefined();
    });

    it('orders by name when asked, consistently across pages', async () => {
      const first = await auth(
        http().get(`/api/v1/drawings?folderId=${folderId}&page=1&limit=5&sort=name`),
      ).expect(200);
      const names = first.body.data.items.map((d: { name: string }) => d.name);
      expect(names).toEqual([...names].sort());
      expect(names[0]).toBe('Paged 00');
    });
  });
});
