import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { mintSessionToken, TEST_JWT_SECRET, TEST_SUPABASE_URL, testAuthId } from './support/jwt';

/**
 * Boots the real application (real guard, real Postgres from `.env`) and
 * exercises the foundation: /healthz, the 401 envelope, and the lazy-create
 * `/me` flow with a self-minted HS256 token verified against SUPABASE_JWT_SECRET.
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
  const authId = testAuthId(Date.now().toString(16));

  beforeAll(async () => {
    // Configure the guard for HS256 verification against our test secret, so the
    // real guard runs with no Supabase project and no network.
    process.env.SUPABASE_URL = TEST_SUPABASE_URL;
    process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';

    // `AppModule` is imported LAZILY: `ConfigModule.forRoot()` runs while the
    // module file is being evaluated, so a top-level import would snapshot the
    // real `.env` (including its real SUPABASE_* values) before the overrides
    // above could take effect, and every token below would 401.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { authId } });
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

  it('rejects a validly-signed token from a DIFFERENT Supabase project (wrong iss)', async () => {
    const token = await mintSessionToken({ sub: authId, issuer: 'https://someone-else.supabase.co/auth/v1' });
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects a token whose audience is not `authenticated`', async () => {
    const token = await mintSessionToken({ sub: authId, audience: 'anon' });
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = await mintSessionToken({ sub: authId }, 'not-the-configured-secret-value-32chars');
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired token', async () => {
    const token = await mintSessionToken({ sub: authId, ttlSec: -120 });
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('valid token → lazily creates the user and returns MeDto with default preferences', async () => {
    const token = await mintSessionToken({
      sub: authId,
      email: 'e2e@example.com',
      userMetadata: { first_name: 'E2E' },
    });
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const me = res.body.data;
    expect(me.user).toMatchObject({ authId, email: 'e2e@example.com', firstName: 'E2E', lastName: null, imageUrl: null });
    expect(typeof me.user.id).toBe('string');
    expect(me.onboarded).toBe(false);
    expect(me.preferences).toEqual({
      units: 'mm',
      theme: 'dark',
      role: null,
      defaultTemplate: 'blank',
      autosaveIntervalSec: 30,
      uiState: null,
      // Email is opt-OUT: a brand-new account is subscribed to both, so the
      // first share it receives actually reaches the person.
      emailOnShare: true,
      emailOnOrgActivity: true,
      // UI language; schema default, validated against LOCALES on update.
      locale: 'en',
    });
    expect(me.usage).toEqual({ bytesUsed: 0, drawingCount: 0 });

    // Second call reuses the same local row.
    const again = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(again.body.data.user.id).toBe(me.user.id);
  });

  // This is what replaces the old Clerk webhook: with no `user.updated` event to
  // listen for, a newer access token is the ONLY way a renamed profile reaches
  // this database. If `ensureLocalUser` stopped diffing, this would silently keep
  // returning the stale name.
  it('refreshes the mirrored profile when a newer token carries new metadata', async () => {
    const first = await mintSessionToken({
      sub: authId,
      email: 'e2e@example.com',
      userMetadata: { first_name: 'E2E' },
    });
    const before = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${first}`);
    expect(before.status).toBe(200);

    const renamed = await mintSessionToken({
      sub: authId,
      email: 'e2e@example.com',
      userMetadata: { first_name: 'Renamed', last_name: 'Person', avatar_url: 'https://example.com/a.png' },
    });
    const after = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${renamed}`);

    expect(after.status).toBe(200);
    expect(after.body.data.user).toMatchObject({
      id: before.body.data.user.id, // same row, updated in place
      firstName: 'Renamed',
      lastName: 'Person',
      imageUrl: 'https://example.com/a.png',
    });
  });

  // A token with no email must not overwrite a known address with the synthetic
  // `<uuid>@local.invalid` placeholder.
  it('does not clobber a known email when a token omits the claim', async () => {
    const withEmail = await mintSessionToken({ sub: authId, email: 'e2e@example.com' });
    await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${withEmail}`);

    const withoutEmail = await mintSessionToken({ sub: authId });
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${withoutEmail}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('e2e@example.com');
  });

  // Derives first/last from an OAuth-style display name (no first/last fields).
  it('splits a full_name from an OAuth provider into first and last name', async () => {
    const oauthId = testAuthId('0a11ce');
    const token = await mintSessionToken({
      sub: oauthId,
      email: 'ada@example.com',
      userMetadata: { full_name: 'Ada Lovelace King' },
    });
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace King' });
    await prisma.user.deleteMany({ where: { authId: oauthId } });
  });

  it('PATCH /me/preferences validates and persists; unknown keys are rejected', async () => {
    const token = await mintSessionToken({ sub: authId });
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
    const token = await mintSessionToken({ sub: authId });
    const first = await request(app.getHttpServer())
      .post('/api/v1/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'engineer', units: 'mm' });
    expect(first.status).toBe(200);
    expect(first.body.data.onboarded).toBe(true);
    expect(first.body.data.preferences).toMatchObject({ role: 'engineer', units: 'mm' });

    const row1 = await prisma.user.findUniqueOrThrow({ where: { authId } });
    await new Promise((r) => setTimeout(r, 20));
    const second = await request(app.getHttpServer())
      .post('/api/v1/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'student', units: 'ft' });
    expect(second.status).toBe(200);
    const row2 = await prisma.user.findUniqueOrThrow({ where: { authId } });
    expect(row2.onboardedAt?.getTime()).toBe(row1.onboardedAt?.getTime());
    expect(second.body.data.preferences.role).toBe('student');
  });

  it('malformed JSON → 400 MALFORMED_JSON', async () => {
    const token = await mintSessionToken({ sub: authId });
    const res = await request(app.getHttpServer())
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"units": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MALFORMED_JSON');
  });

  it('unknown route → 404 envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
