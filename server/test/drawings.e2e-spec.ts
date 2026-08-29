import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { blankDxf, insunitsForUnit } from '../src/drawings/templates/blank-dxf';
import { PrismaService } from '../src/prisma/prisma.service';
import { userPrefix } from '../src/storage/storage-keys';
import { StorageService } from '../src/storage/storage.service';
import { createDevKeypair, mintSessionToken, toEnvPem, type DevKeypair } from './support/jwt';

/**
 * Full drawings + folders happy path against REAL Postgres and MinIO.
 *
 * The harness mints its own RS256 tokens against `CLERK_JWT_KEY` (see
 * `support/jwt.ts`) so the real `ClerkAuthGuard` runs — no Clerk account and no
 * guard stubbing. Skipped (not failed) when either backing service is
 * unreachable, so `npm run test:e2e` stays green on a laptop without Docker.
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

/** Smallest body that passes the PNG magic-byte check. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(128, 7)]);

/** A DXF with one LINE — what a real editor save looks like. */
const DXF_WITH_LINE =
  '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n' +
  '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n100.0\n21\n50.0\n0\nENDSEC\n0\nEOF\n';

describeIfServices('Drawings & folders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let keys: DevKeypair;
  let token: string;
  let otherToken: string;
  let localUserId: string;
  let otherUserId: string;

  const clerkId = `user_e2e_draw_${Date.now()}`;
  const otherClerkId = `user_e2e_other_${Date.now()}`;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, bearer = token) => req.set('Authorization', `Bearer ${bearer}`);

  beforeAll(async () => {
    keys = await createDevKeypair();
    process.env.CLERK_JWT_KEY = toEnvPem(keys.publicPem);
    process.env.CLERK_SECRET_KEY = '';
    process.env.CLERK_WEBHOOK_SECRET = '';
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';

    // Lazy import: `ConfigModule.forRoot()` reads the environment while
    // `app.module.ts` is being evaluated, so importing it at the top of the file
    // would snapshot the real `.env` before the overrides above landed and every
    // self-minted token would be rejected.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);

    token = await mintSessionToken(keys.privateKey, { sub: clerkId, extra: { email: 'draw@example.com' } });
    otherToken = await mintSessionToken(keys.privateKey, { sub: otherClerkId, extra: { email: 'other@example.com' } });

    // First authenticated call lazily provisions each local user.
    await auth(http().get('/api/v1/me')).expect(200);
    await auth(http().get('/api/v1/me'), otherToken).expect(200);
    localUserId = (await prisma.user.findUniqueOrThrow({ where: { clerkId } })).id;
    otherUserId = (await prisma.user.findUniqueOrThrow({ where: { clerkId: otherClerkId } })).id;
  });

  afterAll(async () => {
    for (const id of [localUserId, otherUserId]) {
      if (id) {
        await storage.deletePrefix(userPrefix(id)).catch(() => undefined);
      }
    }
    await prisma.user.deleteMany({ where: { clerkId: { in: [clerkId, otherClerkId] } } });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // The full lifecycle of one drawing
  // ---------------------------------------------------------------------------

  describe('drawing lifecycle', () => {
    let id: string;

    it('POST /drawings creates a blank drawing (201) whose payload is the server template', async () => {
      await auth(http().patch('/api/v1/me/preferences')).send({ units: 'mm' }).expect(200);

      const res = await auth(http().post('/api/v1/drawings')).send({ name: 'E2E Plan' }).expect(201);
      const dto = res.body.data;
      id = dto.id;

      expect(dto).toMatchObject({
        name: 'E2E Plan',
        format: 'dxf',
        folderId: null,
        currentVersion: 1,
        thumbnailUrl: null,
        deletedAt: null,
      });
      expect(dto.byteSize).toBeGreaterThan(0);
      expect(dto.downloadUrl).toContain('/v1.dxf');
      expect(new Date(dto.downloadUrlExpiresAt).getTime()).toBeGreaterThan(Date.now());

      const stored = await fetch(dto.downloadUrl).then((r) => r.text());
      expect(stored).toBe(blankDxf(insunitsForUnit('mm')));
    });

    it('GET /drawings/:id returns a working presigned URL and touches lastOpenedAt', async () => {
      const res = await auth(http().get(`/api/v1/drawings/${id}`)).expect(200);
      expect(res.body.data.lastOpenedAt).not.toBeNull();

      const fetched = await fetch(res.body.data.downloadUrl);
      expect(fetched.status).toBe(200);
      expect(fetched.headers.get('content-type')).toMatch(/^text\/plain/);
      await expect(fetched.text()).resolves.toContain('$INSUNITS');
    });

    it('GET /drawings/:id?touch=0 leaves lastOpenedAt alone; ?download=1 sets a filename', async () => {
      const before = await prisma.drawing.findUniqueOrThrow({ where: { id } });
      const res = await auth(http().get(`/api/v1/drawings/${id}?touch=0&download=1`)).expect(200);
      const after = await prisma.drawing.findUniqueOrThrow({ where: { id } });
      expect(after.lastOpenedAt?.getTime()).toBe(before.lastOpenedAt?.getTime());

      const fetched = await fetch(res.body.data.downloadUrl);
      expect(fetched.headers.get('content-disposition')).toContain('E2E-Plan.dxf');
    });

    it('PUT /drawings/:id/content with If-Match saves version 2 and answers an ETag', async () => {
      const res = await auth(http().put(`/api/v1/drawings/${id}/content`))
        .set('Content-Type', 'text/plain')
        .set('If-Match', '"1"')
        .send(DXF_WITH_LINE)
        .expect(200);

      expect(res.headers.etag).toBe('"2"');
      expect(res.body.data).toMatchObject({ version: 2, byteSize: Buffer.byteLength(DXF_WITH_LINE) });

      const versions = await prisma.drawingVersion.findMany({ where: { drawingId: id }, orderBy: { version: 'asc' } });
      expect(versions.map((v) => v.version)).toEqual([1, 2]);

      const fresh = await auth(http().get(`/api/v1/drawings/${id}?touch=0`)).expect(200);
      await expect(fetch(fresh.body.data.downloadUrl).then((r) => r.text())).resolves.toContain('LINE');
    });

    it('a stale If-Match is 409 VERSION_CONFLICT carrying the live currentVersion', async () => {
      const res = await auth(http().put(`/api/v1/drawings/${id}/content`))
        .set('Content-Type', 'text/plain')
        .set('If-Match', '"1"')
        .send(DXF_WITH_LINE)
        .expect(409);

      expect(res.body).toMatchObject({ success: false, code: 'VERSION_CONFLICT', currentVersion: 2 });
      expect(await prisma.drawing.findUniqueOrThrow({ where: { id } })).toMatchObject({ currentVersion: 2 });
    });

    it('omitting If-Match force-saves over the conflict', async () => {
      const res = await auth(http().put(`/api/v1/drawings/${id}/content`))
        .set('Content-Type', 'text/plain')
        .send(DXF_WITH_LINE)
        .expect(200);
      expect(res.body.data.version).toBe(3);
      expect(res.headers.etag).toBe('"3"');
    });

    it('rejects a non-DXF body with 422 INVALID_DXF', async () => {
      const res = await auth(http().put(`/api/v1/drawings/${id}/content`))
        .set('Content-Type', 'text/plain')
        .send('<html>definitely not a drawing</html>')
        .expect(422);
      expect(res.body.code).toBe('INVALID_DXF');
    });

    it('presign → direct PUT → complete saves a version without the bytes touching the API', async () => {
      const body = DXF_WITH_LINE.replace('100.0', '250.0');
      const byteSize = Buffer.byteLength(body);

      const presigned = await auth(http().post(`/api/v1/drawings/${id}/content/presign`)).send({ byteSize }).expect(200);
      expect(presigned.body.data.key).toContain('/staging/');

      const put = await fetch(presigned.body.data.uploadUrl, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
      expect(put.status).toBe(200);

      const done = await auth(http().post(`/api/v1/drawings/${id}/content/complete`))
        .set('If-Match', '3')
        .send({ key: presigned.body.data.key, byteSize })
        .expect(200);
      expect(done.body.data.version).toBe(4);
      expect(done.headers.etag).toBe('"4"');
    });

    it('rejects a staging key belonging to another drawing with 404 UPLOAD_NOT_FOUND', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${id}/content/complete`))
        .send({ key: `users/${localUserId}/drawings/celsewhere0000000000000/staging/x.dxf`, byteSize: 10 })
        .expect(404);
      expect(res.body.code).toBe('UPLOAD_NOT_FOUND');
    });

    it('PUT /drawings/:id/thumbnail stores a PNG and returns a fetchable URL', async () => {
      const res = await auth(http().put(`/api/v1/drawings/${id}/thumbnail`))
        .set('Content-Type', 'image/png')
        .send(PNG)
        .expect(200);

      const url: string = res.body.data.thumbnailUrl;
      expect(url).toMatch(/thumb-\d+\.png/);
      const fetched = await fetch(url);
      expect(fetched.status).toBe(200);
      expect(fetched.headers.get('content-type')).toBe('image/png');

      // The listing now carries the same (hour-stable) URL.
      const list = await auth(http().get('/api/v1/drawings')).expect(200);
      const row = list.body.data.items.find((d: { id: string }) => d.id === id);
      expect(row.thumbnailUrl).toBe(url);
    });

    it('rejects a non-PNG thumbnail with 415 NOT_PNG', async () => {
      const res = await auth(http().put(`/api/v1/drawings/${id}/thumbnail`))
        .set('Content-Type', 'image/png')
        .send(Buffer.from('GIF89a not a png at all'))
        .expect(415);
      expect(res.body.code).toBe('NOT_PNG');
    });

    it('PATCH /drawings/:id renames', async () => {
      const res = await auth(http().patch(`/api/v1/drawings/${id}`)).send({ name: 'E2E Plan (renamed)' }).expect(200);
      expect(res.body.data.name).toBe('E2E Plan (renamed)');
    });

    it('POST /drawings/:id/duplicate copies payload and thumbnail into a new drawing (201)', async () => {
      const res = await auth(http().post(`/api/v1/drawings/${id}/duplicate`)).send({}).expect(201);
      const copy = res.body.data;
      expect(copy.id).not.toBe(id);
      expect(copy.name).toBe('E2E Plan (renamed) (copy)');
      expect(copy.currentVersion).toBe(1);
      expect(copy.thumbnailUrl).not.toBeNull();

      const opened = await auth(http().get(`/api/v1/drawings/${copy.id}`)).expect(200);
      await expect(fetch(opened.body.data.downloadUrl).then((r) => r.text())).resolves.toContain('LINE');

      await auth(http().delete(`/api/v1/drawings/${copy.id}/permanent`)).expect(200);
    });

    it('GET /drawings and /drawings/recent list the drawing', async () => {
      const list = await auth(http().get('/api/v1/drawings?sort=updated&limit=50')).expect(200);
      expect(list.body.data.items.map((d: { id: string }) => d.id)).toContain(id);
      expect(list.body.data.nextCursor).toBeNull();

      const search = await auth(http().get('/api/v1/drawings?q=RENAMED')).expect(200);
      expect(search.body.data.items.map((d: { id: string }) => d.id)).toContain(id);

      const recent = await auth(http().get('/api/v1/drawings/recent?limit=10')).expect(200);
      expect(recent.body.data.map((d: { id: string }) => d.id)).toContain(id);
    });

    it('DELETE → trash listing → restore → permanent', async () => {
      const trashed = await auth(http().delete(`/api/v1/drawings/${id}`)).expect(200);
      expect(trashed.body.data.id).toBe(id);
      expect(typeof trashed.body.data.deletedAt).toBe('string');

      // Gone from the live listing, present in trash.
      const live = await auth(http().get('/api/v1/drawings?limit=100')).expect(200);
      expect(live.body.data.items.map((d: { id: string }) => d.id)).not.toContain(id);
      const bin = await auth(http().get('/api/v1/drawings/trash')).expect(200);
      expect(bin.body.data.items.map((d: { id: string }) => d.id)).toContain(id);

      // A trashed drawing is 404 for the normal read path.
      await auth(http().get(`/api/v1/drawings/${id}`)).expect(404);

      const restored = await auth(http().post(`/api/v1/drawings/${id}/restore`)).expect(200);
      expect(restored.body.data.deletedAt).toBeNull();
      await auth(http().get(`/api/v1/drawings/${id}`)).expect(200);

      await auth(http().delete(`/api/v1/drawings/${id}`)).expect(200);
      const purged = await auth(http().delete(`/api/v1/drawings/${id}/permanent`)).expect(200);
      expect(purged.body.data).toEqual({ id });

      expect(await prisma.drawing.findUnique({ where: { id } })).toBeNull();
      await auth(http().get(`/api/v1/drawings/${id}`)).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Ownership
  // ---------------------------------------------------------------------------

  describe('ownership', () => {
    it("another user's drawing is 404 on every route, never 403", async () => {
      const created = await auth(http().post('/api/v1/drawings')).send({ name: 'Private' }).expect(201);
      const id: string = created.body.data.id;

      await auth(http().get(`/api/v1/drawings/${id}`), otherToken).expect(404);
      await auth(http().patch(`/api/v1/drawings/${id}`), otherToken).send({ name: 'Stolen' }).expect(404);
      await auth(http().delete(`/api/v1/drawings/${id}`), otherToken).expect(404);
      await auth(http().post(`/api/v1/drawings/${id}/duplicate`), otherToken).send({}).expect(404);
      await auth(http().put(`/api/v1/drawings/${id}/content`), otherToken)
        .set('Content-Type', 'text/plain')
        .send(DXF_WITH_LINE)
        .expect(404);

      // …and the owner still has it untouched.
      const mine = await auth(http().get(`/api/v1/drawings/${id}`)).expect(200);
      expect(mine.body.data.name).toBe('Private');
      await auth(http().delete(`/api/v1/drawings/${id}/permanent`)).expect(200);
    });

    it('an unknown or malformed id is 404', async () => {
      await auth(http().get('/api/v1/drawings/cnotarealdrawingid0000001')).expect(404);
      await auth(http().get('/api/v1/drawings/nope')).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Upload → import
  // ---------------------------------------------------------------------------

  describe('upload and import', () => {
    it('presign → browser PUT → import creates a drawing (201)', async () => {
      const byteSize = Buffer.byteLength(DXF_WITH_LINE);
      const presigned = await auth(http().post('/api/v1/uploads/presign'))
        .send({ fileName: 'Site Plan.dxf', contentType: 'application/octet-stream', byteSize })
        .expect(200);
      expect(presigned.body.data.key).toContain(`users/${localUserId}/uploads/`);

      const put = await fetch(presigned.body.data.uploadUrl, {
        method: 'PUT',
        body: DXF_WITH_LINE,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      expect(put.status).toBe(200);

      const imported = await auth(http().post('/api/v1/drawings/import'))
        .send({ key: presigned.body.data.key, byteSize })
        .expect(201);
      expect(imported.body.data).toMatchObject({ name: 'Site-Plan', format: 'dxf', byteSize, currentVersion: 1 });

      const opened = await auth(http().get(`/api/v1/drawings/${imported.body.data.id}`)).expect(200);
      await expect(fetch(opened.body.data.downloadUrl).then((r) => r.text())).resolves.toBe(DXF_WITH_LINE);

      await auth(http().delete(`/api/v1/drawings/${imported.body.data.id}/permanent`)).expect(200);
    });

    it('rejects a disallowed extension with 415 and a foreign key with 403', async () => {
      const bad = await auth(http().post('/api/v1/uploads/presign'))
        .send({ fileName: 'malware.exe', contentType: 'application/octet-stream', byteSize: 10 })
        .expect(415);
      expect(bad.body.code).toBe('UNSUPPORTED_FILE_TYPE');

      const foreign = await auth(http().post('/api/v1/drawings/import'))
        .send({ key: `users/${otherUserId}/uploads/abc/plan.dxf` })
        .expect(403);
      expect(foreign.body.code).toBe('FORBIDDEN_KEY');
    });

    it('rejects a missing upload with 404 UPLOAD_NOT_FOUND', async () => {
      const res = await auth(http().post('/api/v1/drawings/import'))
        .send({ key: `users/${localUserId}/uploads/does-not-exist/plan.dxf` })
        .expect(404);
      expect(res.body.code).toBe('UPLOAD_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------------

  describe('folders', () => {
    let rootId: string;
    let childId: string;

    it('creates a root folder and rejects a duplicate name with 409 NAME_TAKEN', async () => {
      const created = await auth(http().post('/api/v1/folders')).send({ name: 'Projects' }).expect(201);
      rootId = created.body.data.id;
      expect(created.body.data).toMatchObject({ name: 'Projects', parentId: null });

      const clash = await auth(http().post('/api/v1/folders')).send({ name: 'Projects' }).expect(409);
      expect(clash.body.code).toBe('NAME_TAKEN');
    });

    it('nests a folder and returns its breadcrumb path', async () => {
      const child = await auth(http().post('/api/v1/folders')).send({ name: '2026', parentId: rootId }).expect(201);
      childId = child.body.data.id;

      const listed = await auth(http().get(`/api/v1/folders?parentId=${rootId}`)).expect(200);
      expect(listed.body.data.map((f: { id: string }) => f.id)).toEqual([childId]);

      const detail = await auth(http().get(`/api/v1/folders/${childId}`)).expect(200);
      expect(detail.body.data.path).toEqual([
        { id: rootId, name: 'Projects' },
        { id: childId, name: '2026' },
      ]);
    });

    it('rejects a move that would create a cycle with 422 FOLDER_CYCLE', async () => {
      const res = await auth(http().patch(`/api/v1/folders/${rootId}`)).send({ parentId: childId }).expect(422);
      expect(res.body.code).toBe('FOLDER_CYCLE');
    });

    it('scopes drawings to a folder and filters the root listing correctly', async () => {
      const inFolder = await auth(http().post('/api/v1/drawings'))
        .send({ name: 'Inside', folderId: childId })
        .expect(201);
      expect(inFolder.body.data.folderId).toBe(childId);

      const scoped = await auth(http().get(`/api/v1/drawings?folderId=${childId}`)).expect(200);
      expect(scoped.body.data.items.map((d: { id: string }) => d.id)).toEqual([inFolder.body.data.id]);

      const root = await auth(http().get('/api/v1/drawings?folderId=root&limit=100')).expect(200);
      expect(root.body.data.items.map((d: { id: string }) => d.id)).not.toContain(inFolder.body.data.id);

      // Moving it back to the root.
      const moved = await auth(http().patch(`/api/v1/drawings/${inFolder.body.data.id}`))
        .send({ folderId: null })
        .expect(200);
      expect(moved.body.data.folderId).toBeNull();
      await auth(http().patch(`/api/v1/drawings/${inFolder.body.data.id}`)).send({ folderId: childId }).expect(200);
    });

    it('creating a drawing in an unknown folder is 404 FOLDER_NOT_FOUND', async () => {
      const res = await auth(http().post('/api/v1/drawings'))
        .send({ name: 'Nowhere', folderId: 'cnotarealfolderid00000001' })
        .expect(404);
      expect(res.body.code).toBe('FOLDER_NOT_FOUND');
    });

    it('DELETE is 409 FOLDER_NOT_EMPTY without force, and trashes the contents with it', async () => {
      const refused = await auth(http().delete(`/api/v1/folders/${rootId}`)).expect(409);
      expect(refused.body.code).toBe('FOLDER_NOT_EMPTY');

      const forced = await auth(http().delete(`/api/v1/folders/${rootId}?force=true`)).expect(200);
      expect(forced.body.data).toEqual({ id: rootId, trashedDrawings: 1 });

      // Both folders are gone (cascade) and the drawing is recoverable in trash.
      await auth(http().get(`/api/v1/folders/${rootId}`)).expect(404);
      await auth(http().get(`/api/v1/folders/${childId}`)).expect(404);
      const bin = await auth(http().get('/api/v1/drawings/trash')).expect(200);
      expect(bin.body.data.items.some((d: { name: string }) => d.name === 'Inside')).toBe(true);
    });

    it("another user's folder is 404", async () => {
      const created = await auth(http().post('/api/v1/folders')).send({ name: 'Solo' }).expect(201);
      await auth(http().get(`/api/v1/folders/${created.body.data.id}`), otherToken).expect(404);
      await auth(http().delete(`/api/v1/folders/${created.body.data.id}`)).expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  describe('cursor pagination', () => {
    it('walks a page boundary without skipping or repeating a row', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await auth(http().post('/api/v1/drawings'))
          .send({ name: `Page ${String(i).padStart(2, '0')}` })
          .expect(201);
        ids.push(res.body.data.id);
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const url: string = `/api/v1/drawings?sort=name&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res = await auth(http().get(url)).expect(200);
        seen.push(...res.body.data.items.map((d: { id: string }) => d.id));
        cursor = res.body.data.nextCursor;
        if (!cursor) {
          break;
        }
      }

      expect(new Set(seen).size).toBe(seen.length);
      for (const id of ids) {
        expect(seen).toContain(id);
      }

      const bad = await auth(http().get('/api/v1/drawings?cursor=not-a-cursor')).expect(400);
      expect(bad.body.code).toBe('INVALID_CURSOR');

      for (const id of ids) {
        await auth(http().delete(`/api/v1/drawings/${id}/permanent`)).expect(200);
      }
    });
  });
});
