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
 * Sharing, cross-workspace moves, version history, the viewer role and
 * invitations — against REAL Postgres and MinIO.
 *
 * Same harness as `organizations.e2e-spec.ts`: self-minted HS256 tokens so the
 * real `SupabaseAuthGuard` runs, and the whole suite is skipped (not failed)
 * when Docker is down.
 *
 * Three users, because none of this is observable with one person in the room:
 * `alice` owns things and shares them, `bob` receives, and `carol` must never
 * see any of it. Every id ends in its distinguishing character — `testAuthId`
 * strips non-hex characters and keeps the last twelve, so a leading letter
 * would be dropped and all three would collide.
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

/** A DXF with one LINE — what a real editor save looks like. */
const DXF_V2 =
  '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n100.0\n21\n50.0\n0\nENDSEC\n0\nEOF\n';

/** A different payload, so a version restore can be told apart by its bytes. */
const DXF_V3 = '0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\n0\n10\n5.0\n20\n5.0\n40\n2.5\n0\nENDSEC\n0\nEOF\n';

describeIfServices('Sharing, moves, versions & invitations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;

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

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, bearer = aliceToken) => req.set('Authorization', `Bearer ${bearer}`);

  /** `POST /drawings` and return the created DTO. */
  async function createDrawing(
    body: Record<string, unknown>,
    bearer = aliceToken,
  ): Promise<{ id: string; name: string; organizationId: string | null }> {
    const res = await auth(http().post('/api/v1/drawings'), bearer).send(body).expect(201);
    return res.body.data;
  }

  /** `POST /folders` and return the created DTO. */
  async function createFolder(
    body: Record<string, unknown>,
    bearer = aliceToken,
  ): Promise<{ id: string; name: string }> {
    const res = await auth(http().post('/api/v1/folders'), bearer).send(body).expect(201);
    return res.body.data;
  }

  /** `PUT /drawings/:id/content` — a save that produces the next version. */
  function save(id: string, dxf: string, version: number, bearer = aliceToken): request.Test {
    return auth(http().put(`/api/v1/drawings/${id}/content`), bearer)
      .set('Content-Type', 'text/plain')
      .set('If-Match', String(version))
      .send(dxf);
  }

  /** Creates an organization and returns `{ id, joinCode }`. */
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

    // Lazy import: `ConfigModule` snapshots the environment as `app.module.ts`
    // is evaluated, so the assignments above have to happen first.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);

    aliceToken = await mintSessionToken({ sub: aliceAuthId, email: aliceEmail });
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
    for (const id of [aliceId, bobId, carolId]) {
      if (id) {
        await storage.deletePrefix(userPrefix(id)).catch(() => undefined);
      }
    }
    // Cascades memberships, invites, shares, folders and drawings.
    await prisma.user.deleteMany({ where: { authId: { in: [aliceAuthId, bobAuthId, carolAuthId] } } });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Sharing a drawing with a person
  // ---------------------------------------------------------------------------

  describe('sharing a drawing with a person', () => {
    let drawingId: string;

    beforeAll(async () => {
      drawingId = (await createDrawing({ name: `Shared Plan ${stamp}` })).id;
    });

    it('hides the drawing from everyone else before it is shared', async () => {
      await auth(http().get(`/api/v1/drawings/${drawingId}`), bobToken).expect(404);
    });

    it('reports manage access and no shares to the owner', async () => {
      const res = await auth(http().get(`/api/v1/drawings/${drawingId}`)).expect(200);
      expect(res.body.data).toMatchObject({ access: 'manage', viaShare: false, shareCount: 0 });
    });

    it('shares it read-only with Bob by email', async () => {
      const res = await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: bobEmail, permission: 'view' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        targetEmail: bobEmail,
        targetOrganization: null,
        permission: 'view',
      });
      // Resolved to a real account, so the dialog can show a person not an address.
      expect(res.body.data.targetUser).toMatchObject({ id: bobId });
    });

    it('lets Bob open it, marked as reached through a share', async () => {
      const res = await auth(http().get(`/api/v1/drawings/${drawingId}`), bobToken).expect(200);
      expect(res.body.data).toMatchObject({ access: 'view', viaShare: true });
      expect(res.body.data.downloadUrl).toContain('v1.dxf');
    });

    it('refuses Bob’s save with 403 FORBIDDEN, not 404', async () => {
      const res = await save(drawingId, DXF_V2, 1, bobToken).expect(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', required: 'edit', actual: 'view' });
    });

    it('refuses Bob’s rename and trash too', async () => {
      await auth(http().patch(`/api/v1/drawings/${drawingId}`), bobToken).send({ name: 'Mine now' }).expect(403);
      await auth(http().delete(`/api/v1/drawings/${drawingId}`), bobToken).expect(403);
    });

    it('does not let Bob re-share it — sharing needs manage', async () => {
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`), bobToken)
        .send({ email: carolEmail, permission: 'view' })
        .expect(403);
      await auth(http().get(`/api/v1/drawings/${drawingId}/shares`), bobToken).expect(403);
    });

    it('keeps it invisible to Carol', async () => {
      await auth(http().get(`/api/v1/drawings/${drawingId}`), carolToken).expect(404);
    });

    it('lists it for Bob under ?scope=shared, and not among his own drawings', async () => {
      const shared = await auth(http().get('/api/v1/drawings?scope=shared'), bobToken).expect(200);
      const row = shared.body.data.items.find((d: { id: string }) => d.id === drawingId);
      expect(row).toMatchObject({ access: 'view', viaShare: true });
      expect(row.owner).toMatchObject({ id: aliceId });

      const own = await auth(http().get('/api/v1/drawings'), bobToken).expect(200);
      expect(own.body.data.items.map((d: { id: string }) => d.id)).not.toContain(drawingId);
    });

    it('excludes Alice’s own drawing from HER shared list', async () => {
      // "Shared with me" is about other people's files; echoing your own back
      // would double every row you shared out.
      const res = await auth(http().get('/api/v1/drawings?scope=shared')).expect(200);
      expect(res.body.data.items.map((d: { id: string }) => d.id)).not.toContain(drawingId);
    });

    it('upgrades the same share to edit rather than adding a second row', async () => {
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: bobEmail, permission: 'edit' })
        .expect(200);

      const shares = await auth(http().get(`/api/v1/drawings/${drawingId}/shares`)).expect(200);
      expect(shares.body.data.shares).toHaveLength(1);
      expect(shares.body.data.shares[0].permission).toBe('edit');
      expect(shares.body.data.access).toBe('manage');
    });

    it('now lets Bob save, and the version lands under Alice’s prefix', async () => {
      await save(drawingId, DXF_V2, 1, bobToken).expect(200);
      const row = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
      expect(row.storageKey).toBe(`users/${aliceId}/drawings/${drawingId}/v2.dxf`);
    });

    it('still refuses Bob a permanent delete — a share never grants manage', async () => {
      await auth(http().delete(`/api/v1/drawings/${drawingId}/permanent`), bobToken).expect(403);
    });

    it('refuses to share with yourself (422 SHARE_SELF)', async () => {
      const res = await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: aliceEmail, permission: 'view' })
        .expect(422);
      expect(res.body.code).toBe('SHARE_SELF');
    });

    it('refuses a body with neither target and one with both (422 SHARE_TARGET_REQUIRED)', async () => {
      const neither = await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ permission: 'view' })
        .expect(422);
      expect(neither.body.code).toBe('SHARE_TARGET_REQUIRED');
    });

    it('counts the share on the row, then drops access when it is removed', async () => {
      const listed = await auth(http().get('/api/v1/drawings')).expect(200);
      expect(listed.body.data.items.find((d: { id: string }) => d.id === drawingId).shareCount).toBe(1);

      const shares = await auth(http().get(`/api/v1/drawings/${drawingId}/shares`)).expect(200);
      await auth(http().delete(`/api/v1/drawings/${drawingId}/shares/${shares.body.data.shares[0].id}`)).expect(200);

      await auth(http().get(`/api/v1/drawings/${drawingId}`), bobToken).expect(404);
    });

    it('treats an expired share as no share at all (404)', async () => {
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: bobEmail, permission: 'edit', expiresAt: new Date(Date.now() + 60_000).toISOString() })
        .expect(200);
      await auth(http().get(`/api/v1/drawings/${drawingId}`), bobToken).expect(200);

      // Backdate it: the alternative is sleeping through a real expiry.
      await prisma.share.updateMany({
        where: { drawingId, targetEmail: bobEmail },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await auth(http().get(`/api/v1/drawings/${drawingId}`), bobToken).expect(404);
      const shared = await auth(http().get('/api/v1/drawings?scope=shared'), bobToken).expect(200);
      expect(shared.body.data.items.map((d: { id: string }) => d.id)).not.toContain(drawingId);

      await prisma.share.deleteMany({ where: { drawingId } });
    });
  });

  // ---------------------------------------------------------------------------
  // Folder shares cover the subtree
  // ---------------------------------------------------------------------------

  describe('folder shares', () => {
    let parentId: string;
    let childId: string;
    let nestedDrawingId: string;

    beforeAll(async () => {
      parentId = (await createFolder({ name: `Project ${stamp}` })).id;
      childId = (await createFolder({ name: 'Drawings', parentId })).id;
      nestedDrawingId = (await createDrawing({ name: 'Nested Plan', folderId: childId })).id;
    });

    it('reaches a drawing two levels down through a share on the top folder', async () => {
      await auth(http().get(`/api/v1/drawings/${nestedDrawingId}`), bobToken).expect(404);

      await auth(http().put(`/api/v1/folders/${parentId}/shares`))
        .send({ email: bobEmail, permission: 'edit' })
        .expect(200);

      const res = await auth(http().get(`/api/v1/drawings/${nestedDrawingId}`), bobToken).expect(200);
      expect(res.body.data).toMatchObject({ access: 'edit', viaShare: true });
    });

    it('covers a drawing added to the subtree AFTER the share', async () => {
      const later = await createDrawing({ name: 'Added Later', folderId: childId });
      await auth(http().get(`/api/v1/drawings/${later.id}`), bobToken).expect(200);
    });

    it('lists the shared folder for Bob under ?scope=shared', async () => {
      const res = await auth(http().get('/api/v1/folders?scope=shared'), bobToken).expect(200);
      const row = res.body.data.find((f: { id: string }) => f.id === parentId);
      expect(row).toMatchObject({ id: parentId, access: 'edit', viaShare: true });
      // The nested one is reached by browsing in, not listed at the top level.
      expect(res.body.data.map((f: { id: string }) => f.id)).not.toContain(childId);
    });

    it('lets Bob browse into it and list its contents', async () => {
      const folders = await auth(http().get(`/api/v1/folders?parentId=${parentId}`), bobToken).expect(200);
      expect(folders.body.data.map((f: { id: string }) => f.id)).toContain(childId);

      const drawings = await auth(http().get(`/api/v1/drawings?folderId=${childId}`), bobToken).expect(200);
      expect(drawings.body.data.items.map((d: { id: string }) => d.id)).toContain(nestedDrawingId);
      expect(drawings.body.data.items[0]).toMatchObject({ access: 'edit', viaShare: true });
    });

    it('shows Bob a breadcrumb that stops at the shared folder', async () => {
      const res = await auth(http().get(`/api/v1/folders/${childId}`), bobToken).expect(200);
      expect(res.body.data.path.map((p: { id: string }) => p.id)).toEqual([parentId, childId]);
    });

    it('keeps the subtree invisible to Carol', async () => {
      await auth(http().get(`/api/v1/drawings/${nestedDrawingId}`), carolToken).expect(404);
      await auth(http().get(`/api/v1/folders/${parentId}`), carolToken).expect(404);
      const res = await auth(http().get('/api/v1/folders?scope=shared'), carolToken).expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('does not let a VIEW share delete the folder', async () => {
      // Deletion needs `edit` on both paths (see `FoldersService.remove`), so
      // the line that matters is the one between view and edit.
      await auth(http().put(`/api/v1/folders/${parentId}/shares`))
        .send({ email: carolEmail, permission: 'view' })
        .expect(200);

      const res = await auth(http().delete(`/api/v1/folders/${childId}?force=true`), carolToken).expect(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', required: 'edit', actual: 'view' });

      const shares = await auth(http().get(`/api/v1/folders/${parentId}/shares`)).expect(200);
      const carols = shares.body.data.shares.find((sh: { targetEmail: string }) => sh.targetEmail === carolEmail);
      await auth(http().delete(`/api/v1/folders/${parentId}/shares/${carols.id}`)).expect(200);
    });

    it('labels a shared folder tile with its real owner and workspace', async () => {
      const res = await auth(http().get('/api/v1/folders?scope=shared'), bobToken).expect(200);
      const row = res.body.data.find((f: { id: string }) => f.id === parentId);
      expect(row.owner).toMatchObject({ id: aliceId });
      expect(row.organizationName).toBeNull();
    });

    it('revokes the whole subtree when the folder share is removed', async () => {
      const shares = await auth(http().get(`/api/v1/folders/${parentId}/shares`)).expect(200);
      expect(shares.body.data.links).toEqual([]);
      expect(shares.body.data.shares).toHaveLength(1);
      await auth(http().delete(`/api/v1/folders/${parentId}/shares/${shares.body.data.shares[0].id}`)).expect(200);

      await auth(http().get(`/api/v1/drawings/${nestedDrawingId}`), bobToken).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Sharing with an organization
  // ---------------------------------------------------------------------------

  describe('sharing with an organization', () => {
    let orgId: string;
    let drawingId: string;

    beforeAll(async () => {
      // Bob's org, which Alice also belongs to (she has to, to share into it).
      const org = await createOrg(`Studio ${stamp}`, bobToken);
      orgId = org.id;
      await auth(http().post('/api/v1/organizations/join')).send({ code: org.joinCode }).expect(200);
      drawingId = (await createDrawing({ name: `Org Shared ${stamp}` })).id;
    });

    it('shares a personal drawing with the whole org', async () => {
      const res = await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ organizationId: orgId, permission: 'view' })
        .expect(200);
      expect(res.body.data).toMatchObject({ targetEmail: null, permission: 'view' });
      expect(res.body.data.targetOrganization).toMatchObject({ id: orgId });
    });

    it('makes it visible to every member of that org', async () => {
      const res = await auth(http().get(`/api/v1/drawings/${drawingId}`), bobToken).expect(200);
      expect(res.body.data).toMatchObject({ access: 'view', viaShare: true });

      const shared = await auth(http().get('/api/v1/drawings?scope=shared'), bobToken).expect(200);
      expect(shared.body.data.items.map((d: { id: string }) => d.id)).toContain(drawingId);
    });

    it('keeps it invisible to someone outside the org', async () => {
      await auth(http().get(`/api/v1/drawings/${drawingId}`), carolToken).expect(404);
    });

    it('counts it on the org detail as sharedInCount', async () => {
      const res = await auth(http().get(`/api/v1/organizations/${orgId}`), bobToken).expect(200);
      expect(res.body.data.sharedInCount).toBeGreaterThanOrEqual(1);
    });

    it('refuses to share into an org the caller does not belong to (404)', async () => {
      const carolOrg = await createOrg(`Carol Co ${stamp}`, carolToken);
      const res = await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ organizationId: carolOrg.id, permission: 'view' })
        .expect(404);
      expect(res.body.code).toBe('ORG_NOT_FOUND');
    });

    it('refuses to share a drawing with the org it already lives in (422 SHARE_SAME_ORG)', async () => {
      // Alice's own org, so she has the `manage` that share management needs.
      const own = await createOrg(`Same Org ${stamp}`);
      const orgDrawing = await createDrawing({ name: `In Org ${stamp}`, organizationId: own.id });

      const res = await auth(http().put(`/api/v1/drawings/${orgDrawing.id}/shares`))
        .send({ organizationId: own.id, permission: 'edit' })
        .expect(422);
      expect(res.body.code).toBe('SHARE_SAME_ORG');
    });

    it('refuses share management to a plain member of the org a drawing lives in', async () => {
      // `edit` on the contents is not `manage` over who else can see them.
      const orgDrawing = await createDrawing({ name: `Member Managed ${stamp}`, organizationId: orgId }, bobToken);
      const res = await auth(http().put(`/api/v1/drawings/${orgDrawing.id}/shares`))
        .send({ email: carolEmail, permission: 'view' })
        .expect(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', required: 'manage', actual: 'edit' });
    });
  });

  // ---------------------------------------------------------------------------
  // The viewer role
  // ---------------------------------------------------------------------------

  describe('the viewer role', () => {
    let orgId: string;
    let drawingId: string;

    beforeAll(async () => {
      const org = await createOrg(`Viewers ${stamp}`);
      orgId = org.id;
      await auth(http().post('/api/v1/organizations/join'), bobToken).send({ code: org.joinCode }).expect(200);
      await auth(http().patch(`/api/v1/organizations/${orgId}/members/${bobId}`)).send({ role: 'viewer' }).expect(200);
      drawingId = (await createDrawing({ name: `Viewer Plan ${stamp}`, organizationId: orgId })).id;
    });

    it('reports the role on the members list and on GET /me', async () => {
      const members = await auth(http().get(`/api/v1/organizations/${orgId}/members`)).expect(200);
      expect(members.body.data.map((m: { role: string }) => m.role)).toEqual(['owner', 'viewer']);

      const me = await auth(http().get('/api/v1/me'), bobToken).expect(200);
      expect(me.body.data.organizations.find((o: { id: string }) => o.id === orgId).role).toBe('viewer');
    });

    it('lets a viewer list and open org drawings', async () => {
      const list = await auth(http().get(`/api/v1/drawings?organizationId=${orgId}`), bobToken).expect(200);
      expect(list.body.data.items.map((d: { id: string }) => d.id)).toContain(drawingId);
      expect(list.body.data.items[0]).toMatchObject({ access: 'view', viaShare: false });

      const opened = await auth(http().get(`/api/v1/drawings/${drawingId}`), bobToken).expect(200);
      expect(opened.body.data.access).toBe('view');
    });

    it('refuses a viewer’s content save with 403', async () => {
      const res = await save(drawingId, DXF_V2, 1, bobToken).expect(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', required: 'edit', actual: 'view' });
    });

    it('refuses a viewer’s create in the org workspace', async () => {
      await auth(http().post('/api/v1/drawings'), bobToken)
        .send({ name: 'Viewer Attempt', organizationId: orgId })
        .expect(403);
      await auth(http().post('/api/v1/folders'), bobToken)
        .send({ name: 'Viewer Folder', organizationId: orgId })
        .expect(403);
    });

    it('still lets a viewer copy an org drawing into their own workspace', async () => {
      // Being allowed to read something is being allowed to keep a copy of it,
      // and the copy is theirs — which is what "Save a copy" needs.
      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/copy`), bobToken)
        .send({ organizationId: null, name: 'My Own Copy' })
        .expect(201);
      expect(res.body.data).toMatchObject({ organizationId: null, access: 'manage' });
      expect(res.body.data.owner.id).toBe(bobId);
    });

    it('lets a viewer leave the org', async () => {
      await auth(http().delete(`/api/v1/organizations/${orgId}/members/${bobId}`), bobToken).expect(200);
      await auth(http().get(`/api/v1/drawings/${drawingId}`), bobToken).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Share links
  // ---------------------------------------------------------------------------

  describe('share links', () => {
    let drawingId: string;
    let token: string;
    let linkId: string;

    beforeAll(async () => {
      drawingId = (await createDrawing({ name: `Linked Plan ${stamp}` })).id;
    });

    it('creates a view link', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/links`))
        .send({ permission: 'view', expiresInDays: 30 })
        .expect(201);
      token = res.body.data.token;
      linkId = res.body.data.id;
      expect(token).toMatch(/^[0-9a-f-]{36}[0-9a-f]{8}$/);
      expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('lets a signed-in stranger read what is behind it', async () => {
      const res = await auth(http().get(`/api/v1/shared/${token}`), carolToken).expect(200);
      expect(res.body.data).toMatchObject({ permission: 'view', expired: false });
      expect(res.body.data.drawing).toMatchObject({ id: drawingId, access: 'view' });
      expect(res.body.data.owner.id).toBe(aliceId);
    });

    it('does not grant access until it is accepted', async () => {
      await auth(http().get(`/api/v1/drawings/${drawingId}`), carolToken).expect(404);
    });

    it('converts the link into a durable share on accept', async () => {
      const res = await auth(http().post(`/api/v1/shared/${token}/accept`), carolToken).expect(200);
      expect(res.body.data).toEqual({ drawingId, access: 'view' });

      await auth(http().get(`/api/v1/drawings/${drawingId}`), carolToken).expect(200);
      const shared = await auth(http().get('/api/v1/drawings?scope=shared'), carolToken).expect(200);
      expect(shared.body.data.items.map((d: { id: string }) => d.id)).toContain(drawingId);

      const shares = await auth(http().get(`/api/v1/drawings/${drawingId}/shares`)).expect(200);
      expect(shares.body.data.shares).toEqual([
        expect.objectContaining({ targetEmail: carolEmail, permission: 'view' }),
      ]);
    });

    it('is idempotent — accepting twice leaves one share', async () => {
      await auth(http().post(`/api/v1/shared/${token}/accept`), carolToken).expect(200);
      const shares = await auth(http().get(`/api/v1/drawings/${drawingId}/shares`)).expect(200);
      expect(shares.body.data.shares).toHaveLength(1);
    });

    it('never lowers a grant the person already had', async () => {
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: carolEmail, permission: 'edit' })
        .expect(200);

      const res = await auth(http().post(`/api/v1/shared/${token}/accept`), carolToken).expect(200);
      expect(res.body.data.access).toBe('edit');
    });

    it('answers 404 LINK_INVALID once revoked, while the accepted share survives', async () => {
      await auth(http().delete(`/api/v1/drawings/${drawingId}/links/${linkId}`)).expect(200);

      const res = await auth(http().get(`/api/v1/shared/${token}`), carolToken).expect(404);
      expect(res.body.code).toBe('LINK_INVALID');
      await auth(http().post(`/api/v1/shared/${token}/accept`), carolToken).expect(404);

      // The point of converting a link into a share: revoking the link does not
      // take back what someone was already given.
      await auth(http().get(`/api/v1/drawings/${drawingId}`), carolToken).expect(200);
    });

    it('answers 404 for an unknown token, and reports an expired link as expired', async () => {
      await auth(http().get(`/api/v1/shared/${'0'.repeat(44)}`), carolToken).expect(404);

      const fresh = await auth(http().post(`/api/v1/drawings/${drawingId}/links`))
        .send({ permission: 'edit', expiresInDays: 7 })
        .expect(201);
      await prisma.shareLink.update({
        where: { id: fresh.body.data.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await auth(http().get(`/api/v1/shared/${fresh.body.data.token}`), bobToken).expect(200);
      expect(res.body.data.expired).toBe(true);
      // Readable so the page can explain itself, but not acceptable.
      const accept = await auth(http().post(`/api/v1/shared/${fresh.body.data.token}/accept`), bobToken).expect(404);
      expect(accept.body.code).toBe('LINK_INVALID');
    });

    it('counts links alongside shares in shareCount', async () => {
      const res = await auth(http().get('/api/v1/drawings')).expect(200);
      const row = res.body.data.items.find((d: { id: string }) => d.id === drawingId);
      // One live share (Carol) + one unrevoked-but-expired link.
      expect(row.shareCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Moving between workspaces
  // ---------------------------------------------------------------------------

  describe('moving between workspaces', () => {
    let orgId: string;
    let drawingId: string;
    let storageKey: string;

    beforeAll(async () => {
      const org = await createOrg(`Movers ${stamp}`);
      orgId = org.id;
      await auth(http().post('/api/v1/organizations/join'), bobToken).send({ code: org.joinCode }).expect(200);
      const created = await createDrawing({ name: `Movable ${stamp}` });
      drawingId = created.id;
      storageKey = (await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } })).storageKey;
    });

    it('still refuses a cross-workspace move through PATCH', async () => {
      const orgFolder = await createFolder({ name: `Org Folder ${stamp}`, organizationId: orgId });
      const res = await auth(http().patch(`/api/v1/drawings/${drawingId}`))
        .send({ folderId: orgFolder.id })
        .expect(422);
      expect(res.body.code).toBe('CROSS_WORKSPACE_MOVE');
    });

    it('moves the drawing into the org without touching its storage key', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/move`))
        .send({ organizationId: orgId, folderId: null })
        .expect(200);
      expect(res.body.data).toMatchObject({ organizationId: orgId, folderId: null, access: 'manage' });

      const row = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
      // A move is metadata only: objects stay under the creator's prefix, so
      // the version history follows the drawing intact.
      expect(row.storageKey).toBe(storageKey);
      expect(row.ownerId).toBe(aliceId);
    });

    it('makes it visible to the org’s other members and gone from the personal list', async () => {
      await auth(http().get(`/api/v1/drawings/${drawingId}`), bobToken).expect(200);
      const personal = await auth(http().get('/api/v1/drawings')).expect(200);
      expect(personal.body.data.items.map((d: { id: string }) => d.id)).not.toContain(drawingId);
    });

    it('answers 409 NAME_TAKEN when the destination already has that name', async () => {
      const blocker = await createDrawing({ name: `Clasher ${stamp}`, organizationId: orgId });
      const mine = await createDrawing({ name: `Clasher ${stamp}` });
      expect(mine.name).toBe(`Clasher ${stamp}`);

      const res = await auth(http().post(`/api/v1/drawings/${mine.id}/move`))
        .send({ organizationId: orgId })
        .expect(409);
      expect(res.body.code).toBe('NAME_TAKEN');
      expect(blocker.organizationId).toBe(orgId);
    });

    it('refuses a plain member’s move OUT of the org (that needs manage)', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/move`), bobToken)
        .send({ organizationId: null })
        .expect(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', required: 'manage' });
    });

    it('moves it back to the personal workspace', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/move`))
        .send({ organizationId: null })
        .expect(200);
      expect(res.body.data.organizationId).toBeNull();

      const row = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
      expect(row.storageKey).toBe(storageKey);
      await auth(http().get(`/api/v1/drawings/${drawingId}`), bobToken).expect(404);
    });

    it('re-tags a whole folder subtree when the folder moves', async () => {
      const parent = await createFolder({ name: `Subtree ${stamp}` });
      const child = await createFolder({ name: 'Level 2', parentId: parent.id });
      const inChild = await createDrawing({ name: 'Deep Plan', folderId: child.id });
      const trashed = await createDrawing({ name: 'Deep Trashed', folderId: child.id });
      await auth(http().delete(`/api/v1/drawings/${trashed.id}`)).expect(200);

      const res = await auth(http().post(`/api/v1/folders/${parent.id}/move`))
        .send({ organizationId: orgId })
        .expect(200);
      expect(res.body.data).toMatchObject({ organizationId: orgId, parentId: null });

      // Descendants, and the drawings inside them, follow — including the
      // trashed one, which would otherwise resurface in the old workspace.
      expect((await prisma.folder.findUniqueOrThrow({ where: { id: child.id } })).organizationId).toBe(orgId);
      expect((await prisma.drawing.findUniqueOrThrow({ where: { id: inChild.id } })).organizationId).toBe(orgId);
      expect((await prisma.drawing.findUniqueOrThrow({ where: { id: trashed.id } })).organizationId).toBe(orgId);

      // And a teammate can now see the whole thing.
      const listed = await auth(http().get(`/api/v1/drawings?folderId=${child.id}`), bobToken).expect(200);
      expect(listed.body.data.items.map((d: { id: string }) => d.id)).toContain(inChild.id);
    });

    it('refuses to move a folder into its own subtree (422 FOLDER_CYCLE)', async () => {
      const parent = await createFolder({ name: `Cycle ${stamp}` });
      const child = await createFolder({ name: 'Inner', parentId: parent.id });
      const res = await auth(http().post(`/api/v1/folders/${parent.id}/move`))
        .send({ parentId: child.id })
        .expect(422);
      expect(res.body.code).toBe('FOLDER_CYCLE');
    });
  });

  // ---------------------------------------------------------------------------
  // Copying across workspaces
  // ---------------------------------------------------------------------------

  describe('copying across workspaces', () => {
    let orgId: string;
    let sourceId: string;

    beforeAll(async () => {
      const org = await createOrg(`Copies ${stamp}`, bobToken);
      orgId = org.id;
      await auth(http().post('/api/v1/organizations/join')).send({ code: org.joinCode }).expect(200);
      sourceId = (await createDrawing({ name: `Copy Source ${stamp}` })).id;
      await save(sourceId, DXF_V2, 1).expect(200);
    });

    it('copies a personal drawing into an org, owned by the caller, with its own prefix', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${sourceId}/copy`))
        .send({ organizationId: orgId })
        .expect(201);

      const copyId = res.body.data.id;
      expect(copyId).not.toBe(sourceId);
      expect(res.body.data).toMatchObject({ organizationId: orgId, name: `Copy Source ${stamp}` });

      const row = await prisma.drawing.findUniqueOrThrow({ where: { id: copyId } });
      expect(row.ownerId).toBe(aliceId);
      expect(row.storageKey).toBe(`users/${aliceId}/drawings/${copyId}/v1.dxf`);
      expect(row.currentVersion).toBe(1);

      // The bytes are the SOURCE's current version, not its first.
      const opened = await auth(http().get(`/api/v1/drawings/${copyId}`)).expect(200);
      await expect(fetch(opened.body.data.downloadUrl).then((r) => r.text())).resolves.toBe(DXF_V2);
    });

    it('auto-suffixes rather than failing when the name is taken at the destination', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${sourceId}/copy`))
        .send({ organizationId: orgId })
        .expect(201);
      expect(res.body.data.name).toBe(`Copy Source ${stamp} (2)`);
    });

    it('refuses a copy into a workspace the caller cannot write to (404)', async () => {
      const carolOrg = await createOrg(`Carol Copies ${stamp}`, carolToken);
      const res = await auth(http().post(`/api/v1/drawings/${sourceId}/copy`))
        .send({ organizationId: carolOrg.id })
        .expect(404);
      expect(res.body.code).toBe('ORG_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // Version history
  // ---------------------------------------------------------------------------

  describe('version history', () => {
    let drawingId: string;

    beforeAll(async () => {
      drawingId = (await createDrawing({ name: `Versioned ${stamp}` })).id;
      await save(drawingId, DXF_V2, 1).expect(200);
      await save(drawingId, DXF_V3, 2).expect(200);
    });

    it('lists every version newest first, flagging the current one', async () => {
      const res = await auth(http().get(`/api/v1/drawings/${drawingId}/versions`)).expect(200);
      expect(res.body.data.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
      expect(res.body.data[0]).toMatchObject({ isCurrent: true, byteSize: Buffer.byteLength(DXF_V3) });
      expect(res.body.data[1].isCurrent).toBe(false);
    });

    it('hands out a presigned download for an old version', async () => {
      const res = await auth(http().get(`/api/v1/drawings/${drawingId}/versions/2`)).expect(200);
      const fetched = await fetch(res.body.data.downloadUrl);
      expect(fetched.headers.get('content-disposition')).toContain(`-v2.dxf`);
      await expect(fetched.text()).resolves.toBe(DXF_V2);
    });

    it('answers 404 VERSION_NOT_FOUND for a version that does not exist', async () => {
      const res = await auth(http().get(`/api/v1/drawings/${drawingId}/versions/99`)).expect(404);
      expect(res.body.code).toBe('VERSION_NOT_FOUND');
    });

    it('restores an old version as a NEW version, keeping history append-only', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/versions/2/restore`))
        .set('If-Match', '3')
        .expect(200);
      expect(res.body.data.version).toBe(4);

      const opened = await auth(http().get(`/api/v1/drawings/${drawingId}`)).expect(200);
      expect(opened.body.data.currentVersion).toBe(4);
      // v4 carries v2's bytes …
      await expect(fetch(opened.body.data.downloadUrl).then((r) => r.text())).resolves.toBe(DXF_V2);

      // … and v3 is still there, so an accidental restore is itself undoable.
      const versions = await auth(http().get(`/api/v1/drawings/${drawingId}/versions`)).expect(200);
      expect(versions.body.data.map((v: { version: number }) => v.version)).toEqual([4, 3, 2, 1]);
      const v3 = await auth(http().get(`/api/v1/drawings/${drawingId}/versions/3`)).expect(200);
      await expect(fetch(v3.body.data.downloadUrl).then((r) => r.text())).resolves.toBe(DXF_V3);
    });

    it('answers 409 VERSION_CONFLICT when the restore’s If-Match is stale', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${drawingId}/versions/2/restore`))
        .set('If-Match', '1')
        .expect(409);
      expect(res.body.code).toBe('VERSION_CONFLICT');
    });

    it('lets a view-only recipient list and download versions, but not restore one', async () => {
      await auth(http().put(`/api/v1/drawings/${drawingId}/shares`))
        .send({ email: bobEmail, permission: 'view' })
        .expect(200);

      await auth(http().get(`/api/v1/drawings/${drawingId}/versions`), bobToken).expect(200);
      await auth(http().get(`/api/v1/drawings/${drawingId}/versions/2`), bobToken).expect(200);
      await auth(http().post(`/api/v1/drawings/${drawingId}/versions/2/restore`), bobToken).expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Empty trash
  // ---------------------------------------------------------------------------

  describe('empty trash', () => {
    it('permanently deletes every trashed row in the personal workspace, and its objects', async () => {
      const first = await createDrawing({ name: `Trash A ${stamp}` });
      const second = await createDrawing({ name: `Trash B ${stamp}` });
      await auth(http().delete(`/api/v1/drawings/${first.id}`)).expect(200);
      await auth(http().delete(`/api/v1/drawings/${second.id}`)).expect(200);

      const res = await auth(http().delete('/api/v1/drawings/trash')).expect(200);
      expect(res.body.data.deleted).toBeGreaterThanOrEqual(2);

      expect(await prisma.drawing.findUnique({ where: { id: first.id } })).toBeNull();
      await expect(storage.headObject(`users/${aliceId}/drawings/${first.id}/v1.dxf`)).resolves.toBeNull();

      const trash = await auth(http().get('/api/v1/drawings/trash')).expect(200);
      expect(trash.body.data.items).toEqual([]);
    });

    it('reports 0 on an already-empty trash rather than failing', async () => {
      const res = await auth(http().delete('/api/v1/drawings/trash')).expect(200);
      expect(res.body.data.deleted).toBe(0);
    });

    it('refuses a plain member emptying an org trash, and allows an admin', async () => {
      const org = await createOrg(`Trashers ${stamp}`);
      await auth(http().post('/api/v1/organizations/join'), bobToken).send({ code: org.joinCode }).expect(200);
      const drawing = await createDrawing({ name: `Org Trash ${stamp}`, organizationId: org.id });
      await auth(http().delete(`/api/v1/drawings/${drawing.id}`)).expect(200);

      const refused = await auth(http().delete(`/api/v1/drawings/trash?organizationId=${org.id}`), bobToken).expect(403);
      expect(refused.body.code).toBe('ORG_FORBIDDEN');

      const res = await auth(http().delete(`/api/v1/drawings/trash?organizationId=${org.id}`)).expect(200);
      expect(res.body.data.deleted).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  describe('invitations', () => {
    let orgId: string;

    beforeAll(async () => {
      orgId = (await createOrg(`Invites ${stamp}`)).id;
    });

    it('lists an invitation to the person it is addressed to, with its token', async () => {
      await auth(http().post(`/api/v1/organizations/${orgId}/invites`))
        .send({ email: bobEmail, role: 'admin' })
        .expect(201);

      const res = await auth(http().get('/api/v1/organizations/invitations'), bobToken).expect(200);
      const invite = res.body.data.find((i: { organizationId: string }) => i.organizationId === orgId);
      expect(invite).toMatchObject({ role: 'admin', organizationName: `Invites ${stamp}` });
      expect(invite.invitedBy).toMatchObject({ email: aliceEmail });
      expect(invite.token).toBeTruthy();
    });

    it('notifies the invitee in-app, since no email is sent', async () => {
      const res = await auth(http().get('/api/v1/notifications'), bobToken).expect(200);
      expect(res.body.data.items[0]).toMatchObject({
        kind: 'account',
        title: `You've been invited to Invites ${stamp}`,
      });
    });

    it('shows nothing to anyone else', async () => {
      const res = await auth(http().get('/api/v1/organizations/invitations'), carolToken).expect(200);
      expect(res.body.data.map((i: { organizationId: string }) => i.organizationId)).not.toContain(orgId);
    });

    it('refuses to let the wrong person accept it', async () => {
      const invites = await auth(http().get('/api/v1/organizations/invitations'), bobToken).expect(200);
      const inviteId = invites.body.data.find((i: { organizationId: string }) => i.organizationId === orgId).id;

      const res = await auth(http().post(`/api/v1/organizations/invitations/${inviteId}/accept`), carolToken).expect(404);
      expect(res.body.code).toBe('INVITE_INVALID');
    });

    it('joins the org with the invited role on accept, and tells the admins', async () => {
      const invites = await auth(http().get('/api/v1/organizations/invitations'), bobToken).expect(200);
      const inviteId = invites.body.data.find((i: { organizationId: string }) => i.organizationId === orgId).id;

      const res = await auth(http().post(`/api/v1/organizations/invitations/${inviteId}/accept`), bobToken).expect(200);
      expect(res.body.data).toMatchObject({ id: orgId, role: 'admin' });

      // Gone from the pending list once redeemed.
      const after = await auth(http().get('/api/v1/organizations/invitations'), bobToken).expect(200);
      expect(after.body.data.map((i: { organizationId: string }) => i.organizationId)).not.toContain(orgId);

      const inbox = await auth(http().get('/api/v1/notifications')).expect(200);
      expect(inbox.body.data.items[0].title).toContain(`joined Invites ${stamp}`);
    });

    it('declines an invitation by deleting it, and only the addressee can', async () => {
      await auth(http().post(`/api/v1/organizations/${orgId}/invites`))
        .send({ email: carolEmail, role: 'viewer' })
        .expect(201);
      const invites = await auth(http().get('/api/v1/organizations/invitations'), carolToken).expect(200);
      const inviteId = invites.body.data.find((i: { organizationId: string }) => i.organizationId === orgId).id;

      await auth(http().delete(`/api/v1/organizations/invitations/${inviteId}`), bobToken).expect(404);
      await auth(http().delete(`/api/v1/organizations/invitations/${inviteId}`), carolToken).expect(200);

      const after = await auth(http().get('/api/v1/organizations/invitations'), carolToken).expect(200);
      expect(after.body.data.map((i: { id: string }) => i.id)).not.toContain(inviteId);
    });

    it('exposes the token on the admin invite list so a link can be copied', async () => {
      await auth(http().post(`/api/v1/organizations/${orgId}/invites`))
        .send({ email: `nobody-${stamp}@example.com` })
        .expect(201);
      const res = await auth(http().get(`/api/v1/organizations/${orgId}/invites`)).expect(200);
      expect(res.body.data[0]).toMatchObject({ organizationId: orgId, organizationName: `Invites ${stamp}` });
      expect(res.body.data[0].token).toBeTruthy();
    });

    it('refuses to invite anyone as owner', async () => {
      await auth(http().post(`/api/v1/organizations/${orgId}/invites`))
        .send({ email: `owner-${stamp}@example.com`, role: 'owner' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Ownership transfer
  // ---------------------------------------------------------------------------

  describe('ownership transfer', () => {
    let orgId: string;

    beforeAll(async () => {
      const org = await createOrg(`Handover ${stamp}`);
      orgId = org.id;
      await auth(http().post('/api/v1/organizations/join'), bobToken).send({ code: org.joinCode }).expect(200);
    });

    it('promotes a member to owner and notifies them', async () => {
      const res = await auth(http().patch(`/api/v1/organizations/${orgId}/members/${bobId}`))
        .send({ role: 'owner' })
        .expect(200);
      expect(res.body.data).toMatchObject({ userId: bobId, role: 'owner' });

      const inbox = await auth(http().get('/api/v1/notifications'), bobToken).expect(200);
      expect(inbox.body.data.items[0].title).toContain('is now owner');
    });

    it('then lets the original owner step down, since the org keeps an owner', async () => {
      await auth(http().patch(`/api/v1/organizations/${orgId}/members/${aliceId}`))
        .send({ role: 'member' })
        .expect(200);

      const members = await auth(http().get(`/api/v1/organizations/${orgId}/members`), bobToken).expect(200);
      expect(members.body.data).toEqual([
        expect.objectContaining({ userId: bobId, role: 'owner' }),
        expect.objectContaining({ userId: aliceId, role: 'member' }),
      ]);
    });

    it('refuses to demote the last owner (409 LAST_OWNER)', async () => {
      const res = await auth(http().patch(`/api/v1/organizations/${orgId}/members/${bobId}`), bobToken)
        .send({ role: 'admin' })
        .expect(409);
      expect(res.body.code).toBe('LAST_OWNER');
    });

    it('notifies someone who is removed by an admin', async () => {
      await auth(http().delete(`/api/v1/organizations/${orgId}/members/${aliceId}`), bobToken).expect(200);
      const inbox = await auth(http().get('/api/v1/notifications')).expect(200);
      expect(inbox.body.data.items[0].title).toBe(`You were removed from Handover ${stamp}`);
    });
  });

  // ---------------------------------------------------------------------------
  // Names on import and create
  // ---------------------------------------------------------------------------

  describe('drawing names', () => {
    it('strips a .dxf extension from a created drawing’s name', async () => {
      const created = await createDrawing({ name: `Header Plan ${stamp}.dxf` });
      expect(created.name).toBe(`Header Plan ${stamp}`);
    });

    it('strips the extension on import, and keeps a dot that is not one', async () => {
      const key = `users/${aliceId}/uploads/${stamp}-imp/site-plan.dxf`;
      await storage.putObject(key, DXF_V2, 'text/plain; charset=utf-8');
      const res = await auth(http().post('/api/v1/drawings/import'))
        .send({ key, name: `Bridge rev 2.1.DXF` })
        .expect(201);
      // Only the real extension goes; "rev 2.1" is part of the name.
      expect(res.body.data.name).toBe('Bridge rev 2.1');

      const key2 = `users/${aliceId}/uploads/${stamp}-imp2/roof.dxf`;
      await storage.putObject(key2, DXF_V2, 'text/plain; charset=utf-8');
      const fromFile = await auth(http().post('/api/v1/drawings/import')).send({ key: key2 }).expect(201);
      expect(fromFile.body.data.name).toBe('roof');
    });
  });
});
