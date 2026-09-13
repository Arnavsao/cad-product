import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../../prisma/prisma.service';
import { FLAG_CACHE_TTL_MS, FlagsService } from './flags.service';

describe('FlagsService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let flags: FlagsService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    flags = new FlagsService(prisma);
  });

  it('serves the registry defaults when nothing is overridden', async () => {
    prisma.featureFlag.findMany.mockResolvedValue([]);
    expect(await flags.enabled('signups.enabled')).toBe(true);
    expect(await flags.enabled('drawings.adminDownload')).toBe(false);
  });

  it('applies a stored override over the default', async () => {
    prisma.featureFlag.findMany.mockResolvedValue([
      { key: 'signups.enabled', enabled: false, payload: null, updatedById: 'u1', updatedAt: new Date() },
    ] as never);
    expect(await flags.enabled('signups.enabled')).toBe(false);
  });

  it('ignores a row whose key has left the registry', async () => {
    prisma.featureFlag.findMany.mockResolvedValue([
      { key: 'retired.flag', enabled: true, payload: null, updatedById: 'u1', updatedAt: new Date() },
    ] as never);
    const all = await flags.all();
    expect(Object.keys(all)).not.toContain('retired.flag');
  });

  it('reads the database once per cache window', async () => {
    prisma.featureFlag.findMany.mockResolvedValue([]);
    await flags.all();
    await flags.all();
    expect(prisma.featureFlag.findMany).toHaveBeenCalledTimes(1);
  });

  it('re-reads after the cache is invalidated', async () => {
    prisma.featureFlag.findMany.mockResolvedValue([]);
    await flags.all();
    flags.invalidate();
    await flags.all();
    expect(prisma.featureFlag.findMany).toHaveBeenCalledTimes(2);
  });

  it('re-reads once the window has elapsed', async () => {
    jest.useFakeTimers();
    try {
      prisma.featureFlag.findMany.mockResolvedValue([]);
      await flags.all();
      jest.advanceTimersByTime(FLAG_CACHE_TTL_MS + 1);
      await flags.all();
      expect(prisma.featureFlag.findMany).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to the shipped defaults when the database is unreachable', async () => {
    prisma.featureFlag.findMany.mockRejectedValue(new Error('connection refused'));
    // The alternative — throwing — would take down sign-in and the editor
    // because a switch could not be read.
    expect(await flags.enabled('signups.enabled')).toBe(true);
  });

  it('drops the cache when a flag is written', async () => {
    prisma.featureFlag.findMany.mockResolvedValue([]);
    await flags.all();
    prisma.featureFlag.upsert.mockResolvedValue({
      key: 'ai.enabled',
      enabled: false,
      payload: null,
      updatedById: 'u1',
      updatedAt: new Date(),
    } as never);
    await flags.set('ai.enabled', 'u1', { enabled: false });
    await flags.all();
    expect(prisma.featureFlag.findMany).toHaveBeenCalledTimes(2);
  });

  it('reset removes the override and returns the default', async () => {
    prisma.featureFlag.deleteMany.mockResolvedValue({ count: 1 });
    const state = await flags.reset('signups.enabled');
    expect(state).toEqual({ key: 'signups.enabled', enabled: true, payload: null });
  });
});
