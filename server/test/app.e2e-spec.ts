import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { createDevKeypair, mintSessionToken, toEnvPem, type DevKeypair } from './support/jwt';

/**
 * Boots the real application (real guard, real Postgres from `.env`) and
 * exercises the foundation: /healthz, the 401 envelope, and the lazy-create
 * `/me` flow with a self-minted RS256 token verified against CLERK_JWT_KEY.
 *
 * Requires Postgres reachable at DATABASE_URL; skipped otherwise.
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

describeIfDb('API foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let keys: DevKeypair;
  const clerkId = `user_e2e_${Date.now()}`;

  beforeAll(async () => {
    keys = await createDevKeypair();
    // Configure the guard for networkless verification with our test key.
    process.env.CLERK_JWT_KEY = toEnvPem(keys.publicPem);
    process.env.CLERK_SECRET_KEY = '';
    process.env.CLERK_WEBHOOK_SECRET = '';
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';

    // `AppModule` is imported LAZILY: `ConfigModule.forRoot()` runs while the
    // module file is being evaluated, so a top-level import would snapshot the
    // real `.env` (including its production-shaped CLERK_JWT_KEY) before the
    // overrides above could take effect, and every token below would 401.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { clerkId } });
    await app.close();
  });

  it('GET /healthz → { status: ok, db: true } outside the prefix', async () => {
    const res = await request(app.getHttpServer()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok', db: true } });
  });

  it('GET /api/v1/me without a token → 401 envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, code: 'UNAUTHENTICATED', message: expect.any(String) });
  });

  it('GET /api/v1/me with a garbage token → 401 INVALID_TOKEN', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects a token for another authorized party', async () => {
    const token = await mintSessionToken(keys.privateKey, { sub: clerkId, azp: 'https://evil.example.com' });
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired token', async () => {
    const token = await mintSessionToken(keys.privateKey, { sub: clerkId, ttlSec: -120 });
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('valid token → lazily creates the user and returns MeDto with default preferences', async () => {
    const token = await mintSessionToken(keys.privateKey, {
      sub: clerkId,
      sid: 'sess_e2e',
      extra: { email: 'e2e@example.com', first_name: 'E2E' },
    });
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const me = res.body.data;
    expect(me.user).toMatchObject({ clerkId, email: 'e2e@example.com', firstName: 'E2E', lastName: null, imageUrl: null });
    expect(typeof me.user.id).toBe('string');
    expect(me.onboarded).toBe(false);
    expect(me.preferences).toEqual({
      units: 'mm',
      theme: 'dark',
      role: null,
      defaultTemplate: 'blank',
      autosaveIntervalSec: 30,
      uiState: null,
    });
    expect(me.usage).toEqual({ bytesUsed: 0, drawingCount: 0 });

    // Second call reuses the same local row.
    const again = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(again.body.data.user.id).toBe(me.user.id);
  });

  it('PATCH /me/preferences validates and persists; unknown keys are rejected', async () => {
    const token = await mintSessionToken(keys.privateKey, { sub: clerkId });
    const bad = await request(app.getHttpServer())
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ units: 'furlongs' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect(bad.body.details[0].field).toBe('units');

    const unknown = await request(app.getHttpServer())
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ hacker: true });
    expect(unknown.status).toBe(400);

    const ok = await request(app.getHttpServer())
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ units: 'in', theme: 'light', autosaveIntervalSec: 45, uiState: { sidebar: 'open' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ units: 'in', theme: 'light', autosaveIntervalSec: 45, uiState: { sidebar: 'open' } });
  });

  it('POST /me/onboarding sets onboardedAt once', async () => {
    const token = await mintSessionToken(keys.privateKey, { sub: clerkId });
    const first = await request(app.getHttpServer())
      .post('/api/v1/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'engineer', units: 'mm' });
    expect(first.status).toBe(200);
    expect(first.body.data.onboarded).toBe(true);
    expect(first.body.data.preferences).toMatchObject({ role: 'engineer', units: 'mm' });

    const row1 = await prisma.user.findUniqueOrThrow({ where: { clerkId } });
    await new Promise((r) => setTimeout(r, 20));
    const second = await request(app.getHttpServer())
      .post('/api/v1/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'student', units: 'ft' });
    expect(second.status).toBe(200);
    const row2 = await prisma.user.findUniqueOrThrow({ where: { clerkId } });
    expect(row2.onboardedAt?.getTime()).toBe(row1.onboardedAt?.getTime());
    expect(second.body.data.preferences.role).toBe('student');
  });

  it('malformed JSON → 400 MALFORMED_JSON', async () => {
    const token = await mintSessionToken(keys.privateKey, { sub: clerkId });
    const res = await request(app.getHttpServer())
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"units": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MALFORMED_JSON');
  });

  it('POST /webhooks/clerk without a signing secret → 503 WEBHOOKS_DISABLED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/webhooks/clerk')
      .set('Content-Type', 'application/json')
      .send('{"type":"user.created"}');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WEBHOOKS_DISABLED');
  });

  it('unknown route → 404 envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
