import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/errors/api-error';
import { clampPage, type Page } from '../../common/utils/pagination';
import { FeedbackStatus, Prisma, type Feedback, type User } from '../../generated/prisma/client';
import { feedbackKindFromWire, feedbackKindToWire } from '../../feedback/feedback.mapper';
import { MailService } from '../../mail/mail.service';
import { feedbackReply } from '../../mail/templates/email.templates';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AdminFeedbackDetailDto,
  AdminFeedbackRowDto,
  FeedbackStatusWire,
  ListFeedbackQueryDto,
  UpdateFeedbackDto,
} from '../dto/admin-feedback.dto';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
/** Characters of the message shown in the list; the detail view has all of it. */
const EXCERPT_LENGTH = 160;

/** Row shape the mappers below need. */
type FeedbackRow = Feedback & {
  user?: Pick<User, 'id' | 'email' | 'firstName' | 'lastName'> | null;
  assignee?: Pick<User, 'id' | 'email'> | null;
};

/**
 * Feedback triage.
 *
 * The beta's whole purpose is the reports that come back from it, so this is
 * the one admin surface that needs to be genuinely pleasant to use: a list that
 * can be filtered down to "bugs in the build I just shipped", a status that
 * says whether anyone has looked, and a reply that reaches the sender without
 * leaving the page.
 *
 * Two rules hold throughout. The submission itself is never edited — triage
 * fields sit beside it, so the report stays exactly as it was written. And the
 * internal note is never returned by any user-facing route; it exists here and
 * in the audit trail only.
 */
@Injectable()
export class AdminFeedbackService {
  private readonly logger = new Logger(AdminFeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async list(query: ListFeedbackQueryDto, actorId: string): Promise<Page<AdminFeedbackRowDto>> {
    const page = clampPage(query.page);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const where = this.whereFor(query, actorId);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.findMany({
        where,
        // Oldest-first within the open statuses would be the queue order, but
        // staff overwhelmingly want "what just came in"; the status filter is
        // how you get a work queue.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          assignee: { select: { id: true, email: true } },
        },
      }),
    ]);

    return { items: rows.map((row) => this.toRow(row)), nextCursor: null, total, page, pageSize };
  }

  async get(id: string): Promise<AdminFeedbackDetailDto> {
    const row = await this.prisma.feedback.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        assignee: { select: { id: true, email: true } },
      },
    });
    if (!row) {
      throw ApiException.notFound('FEEDBACK_NOT_FOUND', 'No such feedback');
    }
    return this.toDetail(row);
  }

  /** The triage fields as the audit trail should remember them, before a change. */
  async snapshot(id: string): Promise<Record<string, unknown> | undefined> {
    const row = await this.prisma.feedback.findUnique({
      where: { id },
      select: { id: true, status: true, assigneeId: true, internalNote: true, repliedAt: true },
    });
    return row ? { ...row, status: row.status.toLowerCase() } : undefined;
  }

  /**
   * Updates status, assignee and note independently — see `UpdateFeedbackDto`
   * for why all three are optional.
   *
   * `resolvedAt` is derived rather than accepted from the client: it is set the
   * first time a report reaches a terminal status and cleared if it is reopened,
   * so "when was this closed" cannot drift from "is this closed".
   */
  async update(id: string, dto: UpdateFeedbackDto, actorId: string): Promise<AdminFeedbackDetailDto> {
    const existing = await this.prisma.feedback.findUnique({ where: { id }, select: { status: true } });
    if (!existing) {
      throw ApiException.notFound('FEEDBACK_NOT_FOUND', 'No such feedback');
    }

    const data: Prisma.FeedbackUpdateInput = {};

    if (dto.status !== undefined) {
      const status = statusFromWire(dto.status);
      data.status = status;
      const wasClosed = isClosed(existing.status);
      const nowClosed = isClosed(status);
      if (nowClosed && !wasClosed) {
        data.resolvedAt = new Date();
      } else if (!nowClosed && wasClosed) {
        data.resolvedAt = null;
      }
    }

    if (dto.assigneeId !== undefined) {
      if (dto.assigneeId === null || dto.assigneeId === '') {
        data.assignee = { disconnect: true };
      } else {
        const assigneeId = dto.assigneeId === 'me' ? actorId : dto.assigneeId;
        const exists = await this.prisma.user.findUnique({ where: { id: assigneeId }, select: { id: true } });
        if (!exists) {
          throw ApiException.unprocessable('ASSIGNEE_NOT_FOUND', 'No such user to assign this to');
        }
        data.assignee = { connect: { id: assigneeId } };
      }
    }

    if (dto.internalNote !== undefined) {
      data.internalNote = dto.internalNote.trim() || null;
    }

    await this.prisma.feedback.update({ where: { id }, data });
    return this.get(id);
  }

  /**
   * Emails the sender.
   *
   * The address is whatever we have: the account's, or the one typed on a
   * signed-out submission. A report with neither cannot be answered, and saying
   * so up front is better than a silent no-op that looks like a sent reply —
   * which is exactly what would happen if this used `MailService`'s
   * never-throws path without checking first.
   *
   * `repliedAt` is only written when the send actually succeeded, so the list's
   * "replied" marker means a message left the building.
   */
  async reply(id: string, body: string, actor: User): Promise<AdminFeedbackDetailDto> {
    const row = await this.prisma.feedback.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });
    if (!row) {
      throw ApiException.notFound('FEEDBACK_NOT_FOUND', 'No such feedback');
    }

    const to = recipientOf(row);
    if (!to) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'NO_REPLY_ADDRESS',
        'This report was sent anonymously with no email address',
      );
    }

    const rendered = feedbackReply({
      body: body.trim(),
      originalMessage: row.message,
      submittedOn: row.createdAt.toISOString().slice(0, 10),
      preferencesUrl: this.mail.preferencesUrl,
    });

    const sent = await this.mail.send({
      ...this.mail.compose(to, 'support', rendered),
      // Replies come back to the person who wrote them, not to a no-reply void.
      replyTo: actor.email,
    });
    if (!sent) {
      throw new ApiException(
        HttpStatus.BAD_GATEWAY,
        'REPLY_NOT_SENT',
        'The reply could not be sent. Nothing was recorded, so it is safe to try again.',
      );
    }

    await this.prisma.feedback.update({
      where: { id },
      data: {
        repliedAt: new Date(),
        // A reply is work: a report still sitting in NEW has plainly been
        // looked at now, so move it along rather than leaving the queue lying.
        ...(row.status === FeedbackStatus.NEW ? { status: FeedbackStatus.TRIAGED } : {}),
      },
    });
    this.logger.log(`${actor.email} replied to feedback ${id} (${to})`);
    return this.get(id);
  }

  /**
   * CSV of everything matching the filter, for the spreadsheet work that no
   * admin UI should try to replace.
   *
   * Deliberately omits the internal note: an export is the most likely thing to
   * be forwarded outside the team, and a staff-only remark should not travel
   * that easily.
   */
  async exportCsv(query: ListFeedbackQueryDto, actorId: string): Promise<string> {
    const rows = await this.prisma.feedback.findMany({
      where: this.whereFor(query, actorId),
      orderBy: [{ createdAt: 'desc' }],
      take: 5000,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        assignee: { select: { id: true, email: true } },
      },
    });

    const header = ['id', 'created', 'kind', 'status', 'rating', 'from', 'app_version', 'replied', 'message'];
    const lines = rows.map((row) => {
      const detail = this.toDetail(row);
      return [
        detail.id,
        detail.createdAt,
        detail.kind,
        detail.status,
        detail.rating ?? '',
        detail.fromEmail ?? 'anonymous',
        detail.appVersion ?? '',
        detail.repliedAt ?? '',
        detail.message,
      ]
        .map(csvCell)
        .join(',');
    });
    return [header.join(','), ...lines].join('\r\n');
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private whereFor(query: ListFeedbackQueryDto, actorId: string): Prisma.FeedbackWhereInput {
    const where: Prisma.FeedbackWhereInput = {};

    if (query.q) {
      const contains = query.q.trim();
      where.OR = [
        { message: { contains, mode: 'insensitive' } },
        { email: { contains, mode: 'insensitive' } },
        { user: { email: { contains, mode: 'insensitive' } } },
      ];
    }
    if (query.status) {
      where.status = statusFromWire(query.status);
    }
    if (query.kind) {
      where.kind = feedbackKindFromWire(query.kind);
    }
    if (query.assignee) {
      where.assigneeId = query.assignee === 'me' ? actorId : query.assignee;
    }
    if (query.appVersion) {
      // `context` is a JSON column; this is the one field of it worth indexing a
      // query on, because "what broke in the build I just shipped" is the
      // question a beta actually generates.
      where.context = { path: ['appVersion'], equals: query.appVersion };
    }
    return where;
  }

  private toRow(row: FeedbackRow): AdminFeedbackRowDto {
    const context = contextOf(row);
    const name = [row.user?.firstName, row.user?.lastName].filter(Boolean).join(' ');
    return {
      id: row.id,
      kind: feedbackKindToWire(row.kind),
      status: row.status.toLowerCase() as FeedbackStatusWire,
      rating: row.rating,
      excerpt: excerpt(row.message),
      fromEmail: recipientOf(row),
      fromUserId: row.user?.id ?? null,
      fromName: name || null,
      assigneeId: row.assignee?.id ?? null,
      assigneeEmail: row.assignee?.email ?? null,
      appVersion: context?.appVersion ?? null,
      repliedAt: row.repliedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDetail(row: FeedbackRow): AdminFeedbackDetailDto {
    return {
      ...this.toRow(row),
      message: row.message,
      internalNote: row.internalNote,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      context: contextOf(row),
      replyable: recipientOf(row) !== null,
    };
  }
}

/** Terminal statuses; reaching one stamps `resolvedAt`. */
function isClosed(status: FeedbackStatus): boolean {
  return status === FeedbackStatus.RESOLVED || status === FeedbackStatus.WONT_FIX;
}

function statusFromWire(status: FeedbackStatusWire): FeedbackStatus {
  return status.toUpperCase() as FeedbackStatus;
}

/**
 * Where a reply would go. The account's address wins over the typed one: it is
 * the verified of the two, and a signed-in user typing a different address in
 * the form is likelier a typo than a redirection request.
 */
function recipientOf(row: FeedbackRow): string | null {
  return row.user?.email ?? row.email ?? null;
}

function contextOf(row: FeedbackRow): { route?: string; appVersion?: string; userAgent?: string } | null {
  const context = row.context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null;
  }
  return context as { route?: string; appVersion?: string; userAgent?: string };
}

function excerpt(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length <= EXCERPT_LENGTH ? clean : `${clean.slice(0, EXCERPT_LENGTH)}…`;
}

/**
 * One CSV cell.
 *
 * The leading-punctuation guard is the important half: Excel and Sheets treat a
 * cell starting `=`, `+`, `-` or `@` as a formula, so an unquoted bug report
 * beginning "=SUM(" becomes executable content in whoever opens the export.
 */
function csvCell(value: string | number): string {
  const text = String(value);
  const escaped = text.replace(/"/g, '""');
  return /^[=+\-@\t\r]/.test(text) ? `"'${escaped}"` : `"${escaped}"`;
}
