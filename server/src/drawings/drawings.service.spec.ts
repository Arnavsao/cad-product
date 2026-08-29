import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { stubConfig } from '../../test/support/config';
import { ApiException } from '../common/errors/api-error';
import { looksLikeDxf } from '../common/utils/dxf-sniff';
import { FoldersService } from '../folders/folders.service';
import type { Drawing } from '../generated/prisma/client';
import { DrawingFormat } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { DrawingsService } from './drawings.service';
import { blankDxf, insunitsForUnit } from './templates/blank-dxf';

/**
 * Unit spec for the parts of `DrawingsService` that are hard to observe from
 * the outside: the version reservation, its compensation, and pruning. Prisma
 * is a deep mock so we can drive `updateMany` to report a lost race, and
 * storage is a tiny in-memory fake so a "write failure" is one line.
 */

const USER = 'cuser00000000000000000001';
const DRAWING = 'cdraw00000000000000000001';
const MAX_VERSIONS = 3;

/** Minimal valid DXF for the `looksLikeDxf` gate. */
const DXF = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n';

function drawingRow(overrides: Partial<Drawing> = {}): Drawing {
  const now = new Date('2026-08-29T10:00:00.000Z');
  return {
    id: DRAWING,
    ownerId: USER,
    folderId: null,
    name: 'Plan',
    format: DrawingFormat.DXF,
    storageKey: `users/${USER}/drawings/${DRAWING}/v3.dxf`,
    byteSize: 100,
    thumbnailKey: null,
    currentVersion: 3,
    lastOpenedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** In-memory stand-in for `StorageService`; `failWrites` flips every write to a throw. */
function storageFake(): StorageService & { objects: Map<string, Buffer>; failWrites: boolean; deleted: string[] } {
  const objects = new Map<string, Buffer>();
  const deleted: string[] = [];
  const fake = {
    objects,
    deleted,
    failWrites: false,
    bucket: 'drawings',
    async putObject(key: string, body: string | Buffer) {
      if (fake.failWrites) {
        throw new Error('minio down');
      }
      objects.set(key, typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body));
      return { etag: '"x"' };
    },
    async copyObject(from: string, to: string) {
      if (fake.failWrites) {
        throw new Error('minio down');
      }
      objects.set(to, objects.get(from) ?? Buffer.alloc(0));
    },
    async deleteObject(key: string) {
      deleted.push(key);
      objects.delete(key);
    },
    async deleteObjects(keys: string[]) {
      keys.forEach((k) => {
        deleted.push(k);
        objects.delete(k);
      });
      return keys.length;
    },
    async deletePrefix(prefix: string) {
      let n = 0;
      for (const key of [...objects.keys()]) {
        if (key.startsWith(prefix)) {
          deleted.push(key);
          objects.delete(key);
          n++;
        }
      }
      return n;
    },
    async headObject(key: string) {
      const buf = objects.get(key);
      return buf ? { size: buf.byteLength, contentType: 'text/plain', etag: '"x"', lastModified: new Date() } : null;
    },
    async getObjectText(key: string) {
      return (objects.get(key) ?? Buffer.alloc(0)).toString('utf8');
    },
    async getObjectRange(key: string, start: number, end: number) {
      return (objects.get(key) ?? Buffer.alloc(0)).subarray(start, end + 1);
    },
    async presignGet(key: string) {
      return { url: `https://s3.test/${key}?sig=1`, expiresAt: new Date(Date.now() + 600_000).toISOString() };
    },
    async presignPut(key: string) {
      return { url: `https://s3.test/${key}?put=1`, expiresAt: new Date(Date.now() + 900_000).toISOString() };
    },
  };
  return fake as unknown as StorageService & { objects: Map<string, Buffer>; failWrites: boolean; deleted: string[] };
}

/** Prisma error object shaped the way `isPrismaKnownError` duck-types it. */
function prismaError(code: string): Error & { code: string; clientVersion: string } {
  return Object.assign(new Error(code), { code, clientVersion: '7.10.0' });
}

async function rejection(promise: Promise<unknown>): Promise<ApiException> {
  try {
    await promise;
  } catch (error) {
    return error as ApiException;
  }
  throw new Error('expected the promise to reject');
}

describe('DrawingsService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let storage: ReturnType<typeof storageFake>;
  let folders: DeepMockProxy<FoldersService>;
  let service: DrawingsService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    storage = storageFake();
    folders = mockDeep<FoldersService>();

    // Support both `$transaction(cb)` and `$transaction([...])`.
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]),
    );

    service = new DrawingsService(
      prisma,
      storage,
      folders as unknown as FoldersService,
      stubConfig({ MAX_VERSIONS_PER_DRAWING: MAX_VERSIONS }),
    );
  });

  // ---------------------------------------------------------------------------
  // Ownership
  // ---------------------------------------------------------------------------

  describe('ownership', () => {
    it("answers 404 (not 403) for another user's drawing", async () => {
      // `findFirst` is scoped by ownerId, so someone else's row simply misses.
      prisma.drawing.findFirst.mockResolvedValue(null);

      const error = await rejection(service.get('cothr00000000000000000001', DRAWING));
      expect(error.getStatus()).toBe(404);
      expect(error.code).toBe('DRAWING_NOT_FOUND');
      expect(prisma.drawing.findFirst).toHaveBeenCalledWith({
        where: { id: DRAWING, ownerId: 'cothr00000000000000000001', deletedAt: null },
      });
    });

    it('answers 404 for a malformed id without querying the database', async () => {
      const error = await rejection(service.get(USER, 'not-a-cuid'));
      expect(error.getStatus()).toBe(404);
      expect(prisma.drawing.findFirst).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // commitVersion
  // ---------------------------------------------------------------------------

  describe('commitVersion', () => {
    it('reserves the next version, then writes the object under the reserved key', async () => {
      const row = drawingRow();
      prisma.drawing.findFirst.mockResolvedValue(row);
      prisma.drawing.updateMany.mockResolvedValue({ count: 1 });
      prisma.drawing.findUniqueOrThrow.mockResolvedValue(drawingRow({ currentVersion: 4 }));
      prisma.drawingVersion.findMany.mockResolvedValue([]);

      const result = await service.saveContent(USER, DRAWING, DXF, 3);

      expect(result).toEqual({
        version: 4,
        byteSize: Buffer.byteLength(DXF),
        updatedAt: '2026-08-29T10:00:00.000Z',
      });
      const key = `users/${USER}/drawings/${DRAWING}/v4.dxf`;
      expect(storage.objects.get(key)?.toString('utf8')).toBe(DXF);
      // The guard on the update is what makes the reservation atomic.
      expect(prisma.drawing.updateMany).toHaveBeenCalledWith({
        where: { id: DRAWING, ownerId: USER, deletedAt: null, currentVersion: 3 },
        data: { currentVersion: 4, storageKey: key, byteSize: Buffer.byteLength(DXF) },
      });
      expect(prisma.drawingVersion.create).toHaveBeenCalledWith({
        data: { drawingId: DRAWING, version: 4, storageKey: key, byteSize: Buffer.byteLength(DXF) },
      });
    });

    it('answers 409 VERSION_CONFLICT when the reservation updateMany matches no row', async () => {
      prisma.drawing.findFirst
        .mockResolvedValueOnce(drawingRow())
        // the re-read that fills `currentVersion` in the 409 body
        .mockResolvedValueOnce({ currentVersion: 9 } as unknown as Drawing);
      prisma.drawing.updateMany.mockResolvedValue({ count: 0 });

      const error = await rejection(service.saveContent(USER, DRAWING, DXF, null));

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('VERSION_CONFLICT');
      expect(error.extra).toEqual({ currentVersion: 9 });
      expect(prisma.drawingVersion.create).not.toHaveBeenCalled();
      expect(storage.objects.size).toBe(0);
    });

    it('answers 409 VERSION_CONFLICT when the version insert hits P2002 (the unique index is the lock)', async () => {
      prisma.drawing.findFirst
        .mockResolvedValueOnce(drawingRow())
        .mockResolvedValueOnce({ currentVersion: 4 } as unknown as Drawing);
      prisma.drawing.updateMany.mockResolvedValue({ count: 1 });
      prisma.drawingVersion.create.mockRejectedValue(prismaError('P2002'));

      const error = await rejection(service.saveContent(USER, DRAWING, DXF, null));

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('VERSION_CONFLICT');
      expect(error.extra).toEqual({ currentVersion: 4 });
      // No bytes were written: the reservation is what gates the object write.
      expect(storage.objects.size).toBe(0);
    });

    it('answers 409 before touching the database when If-Match is stale', async () => {
      prisma.drawing.findFirst.mockResolvedValue(drawingRow({ currentVersion: 5 }));

      const error = await rejection(service.saveContent(USER, DRAWING, DXF, 2));

      expect(error.getStatus()).toBe(409);
      expect(error.extra).toEqual({ currentVersion: 5 });
      expect(prisma.drawing.updateMany).not.toHaveBeenCalled();
    });

    it('runs the compensating transaction and answers 502 when the object write fails', async () => {
      const row = drawingRow();
      prisma.drawing.findFirst.mockResolvedValue(row);
      prisma.drawing.updateMany.mockResolvedValue({ count: 1 });
      prisma.drawing.findUniqueOrThrow.mockResolvedValue(drawingRow({ currentVersion: 4 }));
      storage.failWrites = true;

      const error = await rejection(service.saveContent(USER, DRAWING, DXF, 3));

      expect(error.getStatus()).toBe(502);
      expect(error.code).toBe('STORAGE_WRITE_FAILED');
      // The row is put back exactly as it was …
      expect(prisma.drawing.updateMany).toHaveBeenCalledWith({
        where: { id: DRAWING, currentVersion: 4 },
        data: { currentVersion: 3, storageKey: row.storageKey, byteSize: row.byteSize },
      });
      // … and the reserved version row is withdrawn.
      expect(prisma.drawingVersion.deleteMany).toHaveBeenCalledWith({
        where: { drawingId: DRAWING, version: 4 },
      });
    });

    it('rejects an oversized payload with 413 and a non-DXF payload with 422', async () => {
      prisma.drawing.findFirst.mockResolvedValue(drawingRow());

      const tooBig = await rejection(service.saveContent(USER, DRAWING, 'x'.repeat(6 * 1024 * 1024), null));
      expect(tooBig.getStatus()).toBe(413);

      const notDxf = await rejection(service.saveContent(USER, DRAWING, '<html>nope</html>', null));
      expect(notDxf.getStatus()).toBe(422);
      expect(notDxf.code).toBe('INVALID_DXF');
    });
  });

  // ---------------------------------------------------------------------------
  // pruneVersions
  // ---------------------------------------------------------------------------

  describe('pruneVersions', () => {
    it('keeps exactly MAX_VERSIONS_PER_DRAWING rows and deletes the rest plus their objects', async () => {
      const stale = [
        { id: 'v1', storageKey: `users/${USER}/drawings/${DRAWING}/v1.dxf` },
        { id: 'v2', storageKey: `users/${USER}/drawings/${DRAWING}/v2.dxf` },
      ];
      prisma.drawingVersion.findMany.mockResolvedValue(stale as never);

      await expect(service.pruneVersions(DRAWING)).resolves.toBe(2);

      expect(prisma.drawingVersion.findMany).toHaveBeenCalledWith({
        where: { drawingId: DRAWING },
        orderBy: { version: 'desc' },
        skip: MAX_VERSIONS,
        select: { id: true, storageKey: true },
      });
      expect(prisma.drawingVersion.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['v1', 'v2'] } } });
      expect(storage.deleted).toEqual(stale.map((v) => v.storageKey));
    });

    it('is a no-op when the history is within the cap', async () => {
      prisma.drawingVersion.findMany.mockResolvedValue([]);
      await expect(service.pruneVersions(DRAWING)).resolves.toBe(0);
      expect(prisma.drawingVersion.deleteMany).not.toHaveBeenCalled();
      expect(storage.deleted).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // create / thumbnails / uploads
  // ---------------------------------------------------------------------------

  describe('create', () => {
    it('stores the blank template seeded with the user preference when no initialDxf is given', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({ units: 'IN' } as never);
      const created = drawingRow({ currentVersion: 1, storageKey: '' });
      prisma.drawing.create.mockResolvedValue(created);
      prisma.drawing.update.mockResolvedValue(
        drawingRow({ currentVersion: 1, storageKey: `users/${USER}/drawings/${DRAWING}/v1.dxf` }),
      );

      const dto = await service.create(USER, { name: 'Untitled' });

      const stored = storage.objects.get(`users/${USER}/drawings/${DRAWING}/v1.dxf`)!.toString('utf8');
      expect(stored).toBe(blankDxf(insunitsForUnit('in')));
      expect(stored).toContain('$INSUNITS\n70\n1\n');
      expect(dto.downloadUrl).toContain('v1.dxf');
      expect(prisma.drawingVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ drawingId: DRAWING, version: 1 }),
      });
    });

    it('deletes the row again and answers 502 when the initial write fails', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({ units: 'MM' } as never);
      prisma.drawing.create.mockResolvedValue(drawingRow({ currentVersion: 1, storageKey: '' }));
      prisma.drawing.update.mockResolvedValue(
        drawingRow({ currentVersion: 1, storageKey: `users/${USER}/drawings/${DRAWING}/v1.dxf` }),
      );
      prisma.drawing.delete.mockResolvedValue(drawingRow());
      storage.failWrites = true;

      const error = await rejection(service.create(USER, { name: 'Untitled' }));
      expect(error.getStatus()).toBe(502);
      expect(prisma.drawing.delete).toHaveBeenCalledWith({ where: { id: DRAWING } });
    });

    it('rejects an initialDxf that is not a DXF', async () => {
      const error = await rejection(service.create(USER, { name: 'X', initialDxf: '{"json":true}' }));
      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('INVALID_DXF');
    });
  });

  describe('setThumbnail', () => {
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

    it('stores a new key per render and reaps the previous one', async () => {
      const previous = `users/${USER}/drawings/${DRAWING}/thumb-1.png`;
      prisma.drawing.findFirst.mockResolvedValue(drawingRow({ thumbnailKey: previous }));

      const { thumbnailUrl } = await service.setThumbnail(USER, DRAWING, PNG);

      expect(thumbnailUrl).toMatch(/thumb-\d+\.png/);
      expect(thumbnailUrl).not.toContain('thumb-1.png');
      expect(prisma.drawing.update).toHaveBeenCalledWith({
        where: { id: DRAWING },
        data: { thumbnailKey: expect.stringMatching(/thumb-\d+\.png$/) as unknown as string },
      });
      await Promise.resolve();
      expect(storage.deleted).toContain(previous);
    });

    it('rejects a body without the PNG magic bytes with 415 NOT_PNG', async () => {
      const error = await rejection(service.setThumbnail(USER, DRAWING, Buffer.from('GIF89a-not-a-png')));
      expect(error.getStatus()).toBe(415);
      expect(error.code).toBe('NOT_PNG');
    });

    it('rejects an oversized thumbnail with 413', async () => {
      const error = await rejection(
        service.setThumbnail(USER, DRAWING, Buffer.concat([PNG, Buffer.alloc(600 * 1024)])),
      );
      expect(error.getStatus()).toBe(413);
    });
  });

  describe('uploads', () => {
    it('presigns .dxf and rejects anything else with 415', async () => {
      const ok = await service.presignUpload(USER, { fileName: 'Site Plan.DXF', contentType: '', byteSize: 1024 });
      expect(ok.key).toMatch(new RegExp(`^users/${USER}/uploads/[0-9a-f-]+/Site-Plan\\.dxf$`));
      expect(ok.uploadUrl).toContain('put=1');

      const bad = await rejection(
        service.presignUpload(USER, { fileName: 'payload.exe', contentType: '', byteSize: 10 }),
      );
      expect(bad.getStatus()).toBe(415);
      expect(bad.code).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('refuses to import a key outside the caller’s upload prefix with 403', async () => {
      const error = await rejection(
        service.importUpload(USER, { key: 'users/cothr00000000000000000001/uploads/x/plan.dxf' }),
      );
      expect(error.getStatus()).toBe(403);
      expect(error.code).toBe('FORBIDDEN_KEY');
    });

    it('answers 404 UPLOAD_NOT_FOUND when the object is gone and 422 when it is not a DXF', async () => {
      const key = `users/${USER}/uploads/abc/plan.dxf`;
      const missing = await rejection(service.importUpload(USER, { key }));
      expect(missing.getStatus()).toBe(404);
      expect(missing.code).toBe('UPLOAD_NOT_FOUND');

      storage.objects.set(key, Buffer.from('<html>not a dxf</html>'));
      const invalid = await rejection(service.importUpload(USER, { key }));
      expect(invalid.getStatus()).toBe(422);
      expect(invalid.code).toBe('INVALID_DXF');
    });

    it('reports 422 SIZE_MISMATCH when the declared size differs from the stored object', async () => {
      const key = `users/${USER}/uploads/abc/plan.dxf`;
      storage.objects.set(key, Buffer.from(DXF));
      const error = await rejection(service.importUpload(USER, { key, byteSize: 999 }));
      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('SIZE_MISMATCH');
    });
  });
});

describe('blankDxf', () => {
  it('passes the DXF sniff and carries the requested $INSUNITS', () => {
    for (const [unit, code] of Object.entries({ mm: 4, cm: 5, m: 6, in: 1, ft: 2 })) {
      const dxf = blankDxf(insunitsForUnit(unit));
      expect(looksLikeDxf(dxf)).toBe(true);
      expect(dxf).toContain(`9\n$INSUNITS\n70\n${code}\n`);
    }
  });

  it('emits the same section sequence the editor writer produces for an empty file', () => {
    const dxf = blankDxf(4);
    expect(dxf.startsWith('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n')).toBe(true);
    expect(dxf).toContain('0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nContinuous\n');
    expect(dxf).toContain('0\nLTYPE\n2\nCONTINUOUS\n');
    expect(dxf).toContain('0\nBLOCK_RECORD\n2\n*Model_Space\n0\nBLOCK_RECORD\n2\n*Paper_Space\n');
    expect(dxf).toContain('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n');
    expect(dxf.endsWith('0\nEOF\n')).toBe(true);
  });

  it('falls back to millimetres for an unknown unit', () => {
    expect(insunitsForUnit('parsecs')).toBe(4);
    expect(insunitsForUnit(null)).toBe(4);
  });
});
