import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/errors/api-error';
import { NotificationKind, type Announcement, type User } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AdminAnnouncementDto,
  AnnouncementKindWire,
  CreateAnnouncementDto,
  PublicAnnouncementDto,
  UpdateAnnouncementDto,
} from '../dto/admin-announcement.dto';

/**
 * Users per insert when fanning an announcement into the inbox.
 *
 * A `createMany` of every user in one statement is a single enormous write that
 * holds locks for as long as it takes; batching keeps each statement short so
 * ordinary traffic is not stuck behind a broadcast.
 */
const INBOX_BATCH = 500;

type AnnouncementRow = Announcement & { createdBy?: { email: string } | null };

/**
 * Product messages: a banner across the app, optionally a row in everyone's
 * inbox.
 *
 * `publishedAt` is separate from `startsAt` so a draft can be written and
 * scheduled without going live by accident — nothing is shown until somebody
 * publishes it, and only then does the window decide. That also makes the
 * inbox fan-out a deliberate, one-time act rather than something a date field
 * triggers while nobody is watching.
 */
@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AdminAnnouncementDto[]> {
    const rows = await this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { createdBy: { select: { email: true } } },
    });
    return rows.map((row) => this.toDto(row));
  }

  async get(id: string): Promise<AdminAnnouncementDto> {
    const row = await this.prisma.announcement.findUnique({
      where: { id },
      include: { createdBy: { select: { email: true } } },
    });
    if (!row) {
      throw ApiException.notFound('ANNOUNCEMENT_NOT_FOUND', 'No such announcement');
    }
    return this.toDto(row);
  }

  /** What a signed-in user should see right now: published, started, not ended. */
  async active(): Promise<PublicAnnouncementDto[]> {
    const now = new Date();
    const rows = await this.prisma.announcement.findMany({
      where: {
        publishedAt: { not: null },
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: { startsAt: 'desc' },
      take: 5,
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      kind: row.kind.toLowerCase() as AnnouncementKindWire,
      linkUrl: row.linkUrl,
    }));
  }

  async create(actor: User, dto: CreateAnnouncementDto): Promise<AdminAnnouncementDto> {
    const row = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        kind: kindFromWire(dto.kind),
        linkUrl: dto.linkUrl?.trim() || null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        pushToInbox: dto.pushToInbox ?? false,
        createdById: actor.id,
      },
      include: { createdBy: { select: { email: true } } },
    });
    return this.toDto(row);
  }

  /**
   * Edits a draft, or a published announcement's wording.
   *
   * Editing after publishing is allowed on purpose — fixing a typo in a live
   * banner should not require taking it down — but it does NOT re-fan into the
   * inbox: those rows were already delivered, and rewriting what somebody was
   * told after the fact is worse than a typo.
   */
  async update(id: string, dto: UpdateAnnouncementDto): Promise<AdminAnnouncementDto> {
    await this.get(id);
    const row = await this.prisma.announcement.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.body !== undefined ? { body: dto.body.trim() } : {}),
        ...(dto.kind !== undefined ? { kind: kindFromWire(dto.kind) } : {}),
        ...(dto.linkUrl !== undefined ? { linkUrl: dto.linkUrl.trim() || null } : {}),
        ...(dto.startsAt !== undefined ? { startsAt: new Date(dto.startsAt) } : {}),
        ...(dto.endsAt !== undefined ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null } : {}),
        ...(dto.pushToInbox !== undefined ? { pushToInbox: dto.pushToInbox } : {}),
      },
      include: { createdBy: { select: { email: true } } },
    });
    return this.toDto(row);
  }

  /**
   * Makes an announcement live, and fans it into the inbox if it was created
   * that way.
   *
   * Publishing twice is refused rather than being a no-op: with `pushToInbox`
   * on, a second publish would put the same message in everybody's inbox a
   * second time, and "it said nothing happened" is a poor explanation for that.
   */
  async publish(actor: User, id: string): Promise<AdminAnnouncementDto & { notified: number }> {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) {
      throw ApiException.notFound('ANNOUNCEMENT_NOT_FOUND', 'No such announcement');
    }
    if (existing.publishedAt) {
      throw ApiException.conflict('ALREADY_PUBLISHED', 'That announcement is already published');
    }

    const row = await this.prisma.announcement.update({
      where: { id },
      data: { publishedAt: new Date() },
      include: { createdBy: { select: { email: true } } },
    });

    const notified = existing.pushToInbox ? await this.fanOut(existing) : 0;
    this.logger.log(
      `${actor.email} published announcement ${id}` + (notified ? ` and notified ${notified} users` : ''),
    );
    return { ...this.toDto(row), notified };
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.get(id);
    await this.prisma.announcement.delete({ where: { id } });
    return { id };
  }

  /**
   * One notification per active user, in batches.
   *
   * Deleted and suspended accounts are skipped: neither can read it, and a
   * suspended user receiving product news while locked out reads as a system
   * that does not know what it is doing.
   */
  private async fanOut(announcement: Announcement): Promise<number> {
    let created = 0;
    let cursor: string | undefined;

    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { deletedAt: null, suspendedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: INBOX_BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (users.length === 0) {
        break;
      }
      const result = await this.prisma.notification.createMany({
        data: users.map((user) => ({
          userId: user.id,
          kind: announcement.kind,
          title: announcement.title,
          body: announcement.body,
          linkUrl: announcement.linkUrl,
        })),
      });
      created += result.count;
      cursor = users[users.length - 1].id;
      if (users.length < INBOX_BATCH) {
        break;
      }
    }
    return created;
  }

  private toDto(row: AnnouncementRow): AdminAnnouncementDto {
    const now = Date.now();
    const live =
      row.publishedAt !== null &&
      row.startsAt.getTime() <= now &&
      (row.endsAt === null || row.endsAt.getTime() > now);

    return {
      id: row.id,
      title: row.title,
      body: row.body,
      kind: row.kind.toLowerCase() as AnnouncementKindWire,
      linkUrl: row.linkUrl,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
      pushToInbox: row.pushToInbox,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      live,
      createdByEmail: row.createdBy?.email ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function kindFromWire(kind: AnnouncementKindWire | undefined): NotificationKind {
  return (kind ?? 'system').toUpperCase() as NotificationKind;
}
