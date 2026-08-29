import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stubConfig } from '../../test/support/config';
import { StorageService } from './storage.service';
import { drawingVersionKey, sanitizeFileName, thumbnailKey, uploadKey } from './storage-keys';

/**
 * Integration spec against a real S3 endpoint (MinIO from docker-compose).
 * Skipped — not failed — when `S3_ENDPOINT` is unreachable, so `npm test`
 * stays green on a laptop without Docker.
 */
const endpoint = process.env.S3_ENDPOINT ?? '';

/** Synchronous reachability probe (Jest cannot decide `describe` vs `describe.skip` asynchronously). */
function isReachable(url: string): boolean {
  if (!url) {
    return false;
  }
  const probe = spawnSync(
    process.execPath,
    ['-e', `fetch(${JSON.stringify(url)}, { method: 'GET', signal: AbortSignal.timeout(1500) }).then(() => process.exit(0), () => process.exit(1))`],
    { timeout: 3000 },
  );
  return probe.status === 0;
}

const s3Available = isReachable(endpoint);
const describeIfS3 = s3Available ? describe : describe.skip;

describeIfS3('StorageService (integration against S3_ENDPOINT)', () => {
  const env = {
    S3_ENDPOINT: endpoint,
    S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT || undefined,
    S3_REGION: process.env.S3_REGION ?? 'us-east-1',
    S3_BUCKET: process.env.S3_BUCKET ?? 'drawings',
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? 'minioadmin',
    S3_FORCE_PATH_STYLE: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
  };
  const storage = new StorageService(stubConfig(env));
  const userId = `ctest${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const drawingId = `cdraw${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const DXF = '0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n';

  afterAll(async () => {
    await storage.deletePrefix(`users/${userId}/`);
  });

  it('put → head → getObjectText round-trips a DXF payload', async () => {
    const key = drawingVersionKey(userId, drawingId, 1);
    const { etag } = await storage.putObject(key, DXF, 'text/plain; charset=utf-8');
    expect(etag).toBeTruthy();

    const head = await storage.headObject(key);
    expect(head).not.toBeNull();
    expect(head!.size).toBe(Buffer.byteLength(DXF));
    expect(head!.contentType).toMatch(/^text\/plain/);

    await expect(storage.getObjectText(key)).resolves.toBe(DXF);
  });

  it('headObject returns null for a missing key; getObjectText throws 404 OBJECT_NOT_FOUND', async () => {
    await expect(storage.headObject(`users/${userId}/nope.dxf`)).resolves.toBeNull();
    await expect(storage.getObjectText(`users/${userId}/nope.dxf`)).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });

  it('getObjectRange reads head/tail slices', async () => {
    const key = drawingVersionKey(userId, drawingId, 1);
    const head = await storage.getObjectRange(key, 0, 8);
    expect(head.toString('utf8')).toBe(DXF.slice(0, 9));
    const tail = await storage.getObjectRange(key, Buffer.byteLength(DXF) - 4, Buffer.byteLength(DXF) - 1);
    expect(tail.toString('utf8')).toBe('EOF\n');
  });

  it('presignGet URL is fetchable and honours response header overrides', async () => {
    const key = drawingVersionKey(userId, drawingId, 1);
    const { url, expiresAt } = await storage.presignGet(key, 120, {
      responseContentType: 'application/dxf',
      responseContentDisposition: 'attachment; filename="plan.dxf"',
    });
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/dxf');
    expect(res.headers.get('content-disposition')).toContain('plan.dxf');
    await expect(res.text()).resolves.toBe(DXF);
  });

  it('presignGet with a pinned signingDate is byte-stable', async () => {
    const key = drawingVersionKey(userId, drawingId, 1);
    const signingDate = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    const a = await storage.presignGet(key, 7200, { signingDate });
    const b = await storage.presignGet(key, 7200, { signingDate });
    expect(a.url).toBe(b.url);
    expect(a.expiresAt).toBe(new Date(signingDate.getTime() + 7200 * 1000).toISOString());
  });

  it('presignPut accepts a browser-style PUT with matching Content-Type/Length and rejects a wrong length', async () => {
    const key = uploadKey(userId, randomUUID(), 'My Plan (v2).DXF');
    const body = Buffer.from(DXF, 'utf8');
    const { url } = await storage.presignPut(key, 'application/octet-stream', body.byteLength, 120);

    const ok = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': 'application/octet-stream' } });
    expect(ok.status).toBe(200);
    await expect(storage.headObject(key)).resolves.toMatchObject({ size: body.byteLength });

    const wrong = await fetch(url, {
      method: 'PUT',
      body: Buffer.concat([body, Buffer.from('extra')]),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(wrong.status).toBe(403);
  });

  it('copyObject replaces the content type when asked, then deleteObject removes the copy', async () => {
    const src = drawingVersionKey(userId, drawingId, 1);
    const dst = drawingVersionKey(userId, drawingId, 2);
    await storage.copyObject(src, dst, 'application/dxf');
    await expect(storage.headObject(dst)).resolves.toMatchObject({ contentType: 'application/dxf', size: Buffer.byteLength(DXF) });

    await storage.deleteObject(dst);
    await expect(storage.headObject(dst)).resolves.toBeNull();
    // deleting a missing key is not an error
    await expect(storage.deleteObject(dst)).resolves.toBeUndefined();
  });

  it('deletePrefix removes everything under a drawing and reports the count', async () => {
    const other = `cother${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await storage.putObject(drawingVersionKey(userId, other, 1), DXF, 'text/plain');
    await storage.putObject(drawingVersionKey(userId, other, 2), DXF, 'text/plain');
    await storage.putObject(thumbnailKey(userId, other, Date.now()), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png');

    const keys: string[] = [];
    for await (const k of storage.listKeys(`users/${userId}/drawings/${other}/`)) {
      keys.push(k);
    }
    expect(keys).toHaveLength(3);

    await expect(storage.deletePrefix(`users/${userId}/drawings/${other}/`)).resolves.toBe(3);
    await expect(storage.headObject(drawingVersionKey(userId, other, 1))).resolves.toBeNull();
  });
});

describe('storage-keys', () => {
  it('builds the documented key scheme', () => {
    expect(drawingVersionKey('u1', 'd1', 3)).toBe('users/u1/drawings/d1/v3.dxf');
    expect(thumbnailKey('u1', 'd1', 1700000000000)).toBe('users/u1/drawings/d1/thumb-1700000000000.png');
    expect(uploadKey('u1', 'abc', 'plan.dxf')).toBe('users/u1/uploads/abc/plan.dxf');
    expect(() => drawingVersionKey('u1', 'd1', 0)).toThrow(RangeError);
  });

  it.each([
    ['plan.dxf', 'plan.dxf'],
    ['My Plan (v2).DXF', 'My-Plan-v2.dxf'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\Desktop\\site plan.dwg', 'site-plan.dwg'],
    ['   ', 'file'],
    ['', 'file'],
    ['.hidden', 'hidden'],
    ['weird\u0000name\u200b.dxf', 'weirdname.dxf'],
    ['ünïcödé.dxf', 'unicode.dxf'],
    [`${'a'.repeat(200)}.dxf`, `${'a'.repeat(116)}.dxf`],
  ])('sanitizeFileName(%p) → %p', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });
});
