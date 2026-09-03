import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { ApiException } from '../common/errors/api-error';
import type { Feedback } from '../generated/prisma/client';
import { FeedbackKind, Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { CONTEXT_MAX_BYTES } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

/**
 * Unit spec for the rules the schema cannot express: a blank-but-long-enough
 * message is still blank, an oversized diagnostics blob must not cost the user
 * their report, and anonymous submissions must stay anonymous.
 */

const USER = 'cuser00000000000000000001';
const NOW = new Date('2026-09-01T10:00:00.000Z');

function feedbackRow(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: 'cfdbk0000000000000000001',
    userId: USER,
    kind: FeedbackKind.BUG,
    rating: null,
    message: 'Trim leaves a stray vertex',
    email: null,
    context: null,
    createdAt: NOW,
    ...overrides,
  } as Feedback;
}

async function rejection(promise: Promise<unknown>): Promise<ApiException> {
  try {
    await promise;
  } catch (error) {
    return error as ApiException;
  }
  throw new Error('expected the promise to reject');
}

/** The `data` object handed to `prisma.feedback.create`. */
function createdData(prisma: DeepMockProxy<PrismaService>): Record<string, unknown> {
  const call = (prisma.feedback.create as unknown as jest.Mock).mock.calls[0][0] as { data: Record<string, unknown> };
  return call.data;
}

describe('FeedbackService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let service: FeedbackService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    prisma.feedback.create.mockResolvedValue(feedbackRow());
    service = new FeedbackService(prisma);
  });

  // ── attribution ────────────────────────────────────────────────────────────

  it('attaches the user when the request was authenticated', async () => {
    await service.create(USER, { message: 'Trim leaves a stray vertex' });
    expect(createdData(prisma).userId).toBe(USER);
  });

  it('records a null user for an anonymous submission', async () => {
    await service.create(null, { message: 'Cannot sign in at all' });
    expect(createdData(prisma).userId).toBeNull();
  });

  // ── message ────────────────────────────────────────────────────────────────

  it('rejects a message that is only whitespace', async () => {
    const error = await rejection(service.create(USER, { message: '        ' }));
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });

  it('stores the message trimmed', async () => {
    await service.create(USER, { message: '  padded report  ' });
    expect(createdData(prisma).message).toBe('padded report');
  });

  // ── optional fields ────────────────────────────────────────────────────────

  it('defaults the kind to OTHER when none is given', async () => {
    await service.create(USER, { message: 'Just a thought' });
    expect(createdData(prisma).kind).toBe(FeedbackKind.OTHER);
  });

  it('maps the lowercase wire kind onto the Prisma enum', async () => {
    await service.create(USER, { kind: 'bug', message: 'Trim leaves a stray vertex' });
    expect(createdData(prisma).kind).toBe(FeedbackKind.BUG);
  });

  it('normalises a blank email to null rather than storing an empty string', async () => {
    await service.create(null, { message: 'Anonymous report', email: '   ' });
    expect(createdData(prisma).email).toBeNull();
  });

  // ── context ────────────────────────────────────────────────────────────────

  it('keeps context that is within the size cap', async () => {
    const context = { route: '/dashboard', appVersion: '1.1.0', userAgent: 'jest' };
    await service.create(USER, { message: 'With diagnostics', context });
    expect(createdData(prisma).context).toEqual(context);
  });

  it('drops oversized context instead of failing the whole submission', async () => {
    const context = { userAgent: 'x'.repeat(CONTEXT_MAX_BYTES + 1) };
    await service.create(USER, { message: 'Report with a huge UA string', context });

    expect(prisma.feedback.create).toHaveBeenCalled();
    expect(createdData(prisma).context).toBe(Prisma.DbNull);
    expect(createdData(prisma).message).toBe('Report with a huge UA string');
  });

  // ── listing ────────────────────────────────────────────────────────────────

  it('scopes the history to the caller', async () => {
    prisma.feedback.findMany.mockResolvedValue([feedbackRow()]);
    await service.listMine(USER);
    const where = (prisma.feedback.findMany as unknown as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({ userId: USER });
  });

  it('does not echo the diagnostics context back to the sender', async () => {
    prisma.feedback.findMany.mockResolvedValue([feedbackRow({ context: { route: '/dashboard' } as never })]);
    const [dto] = await service.listMine(USER);
    expect(dto).not.toHaveProperty('context');
    expect(dto.kind).toBe('bug');
    expect(dto.createdAt).toBe(NOW.toISOString());
  });
});
