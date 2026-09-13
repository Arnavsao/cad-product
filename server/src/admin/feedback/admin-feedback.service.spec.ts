import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { FeedbackKind, FeedbackStatus, PlatformRole, type Feedback, type User } from '../../generated/prisma/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminFeedbackService } from './admin-feedback.service';

const ACTOR = {
  id: 'cstaff00000000000000000001',
  email: 'support@example.com',
  platformRole: PlatformRole.SUPPORT,
} as User;

function feedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: 'cfb0000000000000000000001',
    userId: null,
    kind: FeedbackKind.BUG,
    rating: null,
    message: 'The trim tool leaves a stray segment behind.',
    email: 'reporter@example.com',
    context: { route: '/editor', appVersion: '1.1.0', userAgent: 'Firefox' },
    createdAt: new Date('2026-09-01T10:00:00Z'),
    status: FeedbackStatus.NEW,
    assigneeId: null,
    internalNote: null,
    resolvedAt: null,
    repliedAt: null,
    ...overrides,
  } as Feedback;
}

describe('AdminFeedbackService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let mail: DeepMockProxy<MailService>;
  let service: AdminFeedbackService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    mail = mockDeep<MailService>();
    Object.defineProperty(mail, 'preferencesUrl', { get: () => 'https://cado.website/prefs' });
    mail.compose.mockImplementation((to, category, rendered) => ({ to, category, ...rendered }));
    service = new AdminFeedbackService(prisma, mail);
  });

  describe('reply', () => {
    it('refuses a report with no address rather than pretending to send', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback({ email: null, user: null } as never));
      await expect(service.reply('cfb0000000000000000000001', 'Thanks, fixed.', ACTOR)).rejects.toMatchObject({
        code: 'NO_REPLY_ADDRESS',
      });
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('prefers the account address over the typed one', async () => {
      prisma.feedback.findUnique.mockResolvedValue(
        feedback({ email: 'typo@exmaple.com', user: { id: 'u1', email: 'real@example.com' } } as never),
      );
      mail.send.mockResolvedValue(true);
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.reply('cfb0000000000000000000001', 'Thanks for the report.', ACTOR);
      expect(mail.send.mock.calls[0][0].to).toBe('real@example.com');
    });

    it('sets Reply-To to the staff member, so the answer comes back to a person', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback());
      mail.send.mockResolvedValue(true);
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.reply('cfb0000000000000000000001', 'Thanks for the report.', ACTOR);
      expect(mail.send.mock.calls[0][0].replyTo).toBe('support@example.com');
      expect(mail.send.mock.calls[0][0].category).toBe('support');
    });

    it('does NOT record a reply when the send failed', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback());
      mail.send.mockResolvedValue(false);

      await expect(service.reply('cfb0000000000000000000001', 'Thanks.', ACTOR)).rejects.toMatchObject({
        code: 'REPLY_NOT_SENT',
      });
      // The "replied" marker has to mean a message actually left the building.
      expect(prisma.feedback.update).not.toHaveBeenCalled();
    });

    it('moves a NEW report to TRIAGED once answered', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback({ status: FeedbackStatus.NEW }));
      mail.send.mockResolvedValue(true);
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.reply('cfb0000000000000000000001', 'Looking into it.', ACTOR);
      const data = prisma.feedback.update.mock.calls[0][0].data as { status?: FeedbackStatus; repliedAt: Date };
      expect(data.status).toBe(FeedbackStatus.TRIAGED);
      expect(data.repliedAt).toBeInstanceOf(Date);
    });

    it('leaves a status staff already chose alone', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback({ status: FeedbackStatus.IN_PROGRESS }));
      mail.send.mockResolvedValue(true);
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.reply('cfb0000000000000000000001', 'Still on it.', ACTOR);
      const data = prisma.feedback.update.mock.calls[0][0].data as { status?: FeedbackStatus };
      expect(data.status).toBeUndefined();
    });
  });

  describe('update', () => {
    it('stamps resolvedAt when a report first closes', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback({ status: FeedbackStatus.NEW }));
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.update('cfb0000000000000000000001', { status: 'resolved' }, ACTOR.id);
      const data = prisma.feedback.update.mock.calls[0][0].data as { resolvedAt?: Date };
      expect(data.resolvedAt).toBeInstanceOf(Date);
    });

    it('clears resolvedAt when a closed report is reopened', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback({ status: FeedbackStatus.RESOLVED }));
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.update('cfb0000000000000000000001', { status: 'in_progress' }, ACTOR.id);
      const data = prisma.feedback.update.mock.calls[0][0].data as { resolvedAt?: Date | null };
      expect(data.resolvedAt).toBeNull();
    });

    it('leaves resolvedAt alone when a closed report moves between closed statuses', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback({ status: FeedbackStatus.RESOLVED }));
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.update('cfb0000000000000000000001', { status: 'wont_fix' }, ACTOR.id);
      const data = prisma.feedback.update.mock.calls[0][0].data as Record<string, unknown>;
      expect('resolvedAt' in data).toBe(false);
    });

    it('resolves `me` to the caller', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback());
      prisma.user.findUnique.mockResolvedValue({ id: ACTOR.id } as never);
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.update('cfb0000000000000000000001', { assigneeId: 'me' }, ACTOR.id);
      const data = prisma.feedback.update.mock.calls[0][0].data as { assignee?: { connect?: { id: string } } };
      expect(data.assignee?.connect?.id).toBe(ACTOR.id);
    });

    it('rejects an assignee that does not exist', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback());
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.update('cfb0000000000000000000001', { assigneeId: 'cnope00000000000000000001' }, ACTOR.id),
      ).rejects.toMatchObject({ code: 'ASSIGNEE_NOT_FOUND' });
    });

    it('unassigns on an explicit null', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback());
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.update('cfb0000000000000000000001', { assigneeId: null }, ACTOR.id);
      const data = prisma.feedback.update.mock.calls[0][0].data as { assignee?: { disconnect?: boolean } };
      expect(data.assignee?.disconnect).toBe(true);
    });

    it('changes nothing it was not asked to change', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback({ status: FeedbackStatus.TRIAGED }));
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.update('cfb0000000000000000000001', { internalNote: 'reproduced on 1.1.0' }, ACTOR.id);
      const data = prisma.feedback.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(Object.keys(data)).toEqual(['internalNote']);
    });

    it('stores a blank note as null rather than an empty string', async () => {
      prisma.feedback.findUnique.mockResolvedValue(feedback());
      prisma.feedback.update.mockResolvedValue(feedback());
      jest.spyOn(service, 'get').mockResolvedValue({} as never);

      await service.update('cfb0000000000000000000001', { internalNote: '   ' }, ACTOR.id);
      const data = prisma.feedback.update.mock.calls[0][0].data as { internalNote: string | null };
      expect(data.internalNote).toBeNull();
    });
  });

  describe('exportCsv', () => {
    it('neutralises a message that would otherwise be a spreadsheet formula', async () => {
      prisma.feedback.findMany.mockResolvedValue([feedback({ message: '=cmd|calc' })] as never);
      const csv = await service.exportCsv({}, ACTOR.id);
      // Excel executes a cell beginning `=`; the quote prefix defuses it.
      expect(csv).toContain(`"'=cmd|calc"`);
    });

    it('omits the internal note, which should not travel in a forwarded file', async () => {
      prisma.feedback.findMany.mockResolvedValue([feedback({ internalNote: 'suspect this user' })] as never);
      const csv = await service.exportCsv({}, ACTOR.id);
      expect(csv).not.toContain('suspect this user');
    });

    it('escapes embedded quotes', async () => {
      prisma.feedback.findMany.mockResolvedValue([feedback({ message: 'it said "nope"' })] as never);
      const csv = await service.exportCsv({}, ACTOR.id);
      expect(csv).toContain('"it said ""nope"""');
    });
  });
});
