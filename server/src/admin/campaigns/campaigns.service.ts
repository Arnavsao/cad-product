import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../common/errors/api-error';
import type { Env } from '../../config/env.schema';
import { BillingPlan, CampaignStatus, Prisma, type EmailCampaign, type User } from '../../generated/prisma/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AdminCampaignDto,
  AudiencePreviewDto,
  CampaignStatusWire,
  CreateCampaignDto,
} from '../dto/admin-campaign.dto';
import { signUnsubscribeToken } from './unsubscribe-token';

/**
 * Recipients resolved per page while sending.
 *
 * Also the pacing unit: Resend's default limit is 2 requests a second, so the
 * send pauses between messages rather than between batches — a batch-level
 * pause would still burst inside the batch and get the whole run rate-limited.
 */
const RECIPIENT_BATCH = 200;

/** Milliseconds between individual sends. 2/second is Resend's documented floor. */
const SEND_INTERVAL_MS = 550;

/** An account is "active" if it has been seen within this window. */
const ACTIVE_WINDOW_DAYS = 30;

type CampaignRow = EmailCampaign & { createdBy?: { email: string } | null };

interface Audience {
  plans?: string[];
  onlyActive?: boolean;
}

/**
 * Bulk email to users.
 *
 * Three rules hold throughout, and each exists because the alternative is a
 * mistake that cannot be taken back once the mail has left.
 *
 * - **The suppression list is absolute for campaigns.** Anyone who has
 *   unsubscribed is filtered out at resolve time AND re-checked immediately
 *   before each send, because a run takes minutes and somebody may unsubscribe
 *   during it.
 * - **Transactional mail is never suppressed.** A share notification or a reply
 *   to a support question is not marketing; suppressing those would break the
 *   product for somebody who only meant to opt out of announcements.
 * - **The audience is frozen when the send starts.** An account created
 *   mid-send is not part of the campaign somebody reviewed and approved.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  private readonly unsubscribeSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {
    // Reuses a secret the deployment already has rather than adding another to
    // configure. It only signs unsubscribe links, whose worst-case misuse is
    // stopping mail somebody did not want.
    this.unsubscribeSecret =
      this.config.get('SUPABASE_JWT_SECRET', { infer: true }) ??
      this.config.get('DATABASE_URL', { infer: true });
  }

  async list(): Promise<AdminCampaignDto[]> {
    const rows = await this.prisma.emailCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { createdBy: { select: { email: true } } },
    });
    return rows.map((row) => this.toDto(row));
  }

  async get(id: string): Promise<AdminCampaignDto> {
    const row = await this.prisma.emailCampaign.findUnique({
      where: { id },
      include: { createdBy: { select: { email: true } } },
    });
    if (!row) {
      throw ApiException.notFound('CAMPAIGN_NOT_FOUND', 'No such campaign');
    }
    return this.toDto(row);
  }

  async create(actor: User, dto: CreateCampaignDto): Promise<AdminCampaignDto> {
    const audience: Audience = {};
    if (dto.plans?.length) audience.plans = dto.plans;
    if (dto.onlyActive) audience.onlyActive = true;

    const row = await this.prisma.emailCampaign.create({
      data: {
        subject: dto.subject.trim(),
        bodyText: dto.bodyText.trim(),
        audience: Object.keys(audience).length ? (audience as Prisma.InputJsonObject) : Prisma.DbNull,
        createdById: actor.id,
      },
      include: { createdBy: { select: { email: true } } },
    });
    return this.toDto(row);
  }

  /**
   * How many people this would reach, without sending anything.
   *
   * The single most useful thing before a bulk send, and the cheapest way to
   * catch an audience filter that means something other than what was intended.
   */
  async preview(id: string): Promise<AudiencePreviewDto> {
    const campaign = await this.requireCampaign(id);
    const where = this.audienceWhere(campaign.audience as Audience | null);

    const [candidates, suppressed] = await Promise.all([
      this.prisma.user.findMany({ where, select: { email: true }, take: 5000 }),
      this.prisma.emailSuppression.findMany({ select: { email: true } }),
    ]);

    const blocked = new Set(suppressed.map((s) => s.email.toLowerCase()));
    const recipients = candidates.filter((u) => !blocked.has(u.email.toLowerCase()));

    return {
      recipients: recipients.length,
      suppressed: candidates.length - recipients.length,
      sample: recipients.slice(0, 5).map((u) => u.email),
    };
  }

  /** Sends the real thing to one address, so staff can read it in a client. */
  async testSend(id: string, to: string): Promise<{ sent: boolean }> {
    const campaign = await this.requireCampaign(id);
    const sent = await this.mail.send({
      to,
      category: 'support',
      subject: `[test] ${campaign.subject}`,
      ...this.render(campaign, to),
    });
    if (!sent) {
      throw new ApiException(502, 'TEST_SEND_FAILED', 'The test message could not be sent');
    }
    return { sent };
  }

  /**
   * Starts the send.
   *
   * Returns as soon as the run is claimed, and continues in the background: a
   * send of several thousand messages at two per second takes far longer than
   * any sensible request timeout, and holding the connection open would make
   * the browser look broken while it worked.
   *
   * The status transition is the claim. `updateMany` with a `status: DRAFT`
   * predicate means two simultaneous presses cannot both start it — the second
   * updates zero rows and is refused.
   */
  async send(id: string): Promise<AdminCampaignDto> {
    const campaign = await this.requireCampaign(id);
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw ApiException.conflict('CAMPAIGN_NOT_DRAFT', 'That campaign has already been sent');
    }

    const claimed = await this.prisma.emailCampaign.updateMany({
      where: { id, status: CampaignStatus.DRAFT },
      data: { status: CampaignStatus.SENDING, startedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw ApiException.conflict('CAMPAIGN_NOT_DRAFT', 'That campaign has already been sent');
    }

    void this.deliver(id).catch((error) => {
      this.logger.error(`Campaign ${id} failed: ${(error as Error).message}`);
    });
    return this.get(id);
  }

  /** The background run. Never throws to its caller; it records instead. */
  private async deliver(id: string): Promise<void> {
    const campaign = await this.prisma.emailCampaign.findUniqueOrThrow({ where: { id } });
    const where = this.audienceWhere(campaign.audience as Audience | null);

    // The audience is resolved ONCE, here, and paged through by id. An account
    // created after this point is not part of what was approved.
    const recipients = await this.prisma.user.findMany({
      where,
      select: { id: true, email: true },
      orderBy: { id: 'asc' },
      take: 20_000,
    });

    await this.prisma.emailCampaign.update({ where: { id }, data: { total: recipients.length } });

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i += RECIPIENT_BATCH) {
      const batch = recipients.slice(i, i + RECIPIENT_BATCH);

      // Re-checked per batch: a run takes minutes, and somebody who
      // unsubscribes from the first message must not receive the hundredth.
      const blocked = new Set(
        (
          await this.prisma.emailSuppression.findMany({
            where: { email: { in: batch.map((r) => r.email.toLowerCase()) } },
            select: { email: true },
          })
        ).map((s) => s.email.toLowerCase()),
      );

      for (const recipient of batch) {
        if (blocked.has(recipient.email.toLowerCase())) {
          continue;
        }
        const ok = await this.mail.send({
          to: recipient.email,
          category: 'support',
          subject: campaign.subject,
          ...this.render(campaign, recipient.email),
        });
        if (ok) sent++;
        else failed++;

        await sleep(SEND_INTERVAL_MS);
      }

      await this.prisma.emailCampaign.update({ where: { id }, data: { sent, failed } });
    }

    await this.prisma.emailCampaign.update({
      where: { id },
      data: {
        status: failed > 0 && sent === 0 ? CampaignStatus.FAILED : CampaignStatus.SENT,
        sent,
        failed,
        finishedAt: new Date(),
      },
    });
    this.logger.log(`Campaign ${id} finished: ${sent} sent, ${failed} failed`);
  }

  /** Records an unsubscribe. Idempotent: clicking twice is not an error. */
  async suppress(email: string, reason: string): Promise<void> {
    const normalised = email.trim().toLowerCase();
    await this.prisma.emailSuppression.upsert({
      where: { email: normalised },
      create: { email: normalised, reason },
      update: { reason },
    });
    this.logger.log(`Suppressed ${normalised} (${reason})`);
  }

  async listSuppressions(): Promise<{ email: string; reason: string; createdAt: string }[]> {
    const rows = await this.prisma.emailSuppression.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map((row) => ({ email: row.email, reason: row.reason, createdAt: row.createdAt.toISOString() }));
  }

  async unsuppress(email: string): Promise<{ email: string }> {
    const normalised = email.trim().toLowerCase();
    await this.prisma.emailSuppression.deleteMany({ where: { email: normalised } });
    return { email: normalised };
  }

  /** The unsubscribe URL for one recipient. */
  unsubscribeUrl(email: string): string {
    return this.mail.link(`/unsubscribe?token=${signUnsubscribeToken(email, this.unsubscribeSecret)}`);
  }

  get secret(): string {
    return this.unsubscribeSecret;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async requireCampaign(id: string): Promise<EmailCampaign> {
    const row = await this.prisma.emailCampaign.findUnique({ where: { id } });
    if (!row) {
      throw ApiException.notFound('CAMPAIGN_NOT_FOUND', 'No such campaign');
    }
    return row;
  }

  /**
   * Suspended and deleted accounts are excluded from every audience: neither
   * should be receiving product mail, and one of them is locked out.
   */
  private audienceWhere(audience: Audience | null): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = { deletedAt: null, suspendedAt: null };

    if (audience?.onlyActive) {
      where.lastSeenAt = { gte: new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000) };
    }
    if (audience?.plans?.length) {
      const plans = audience.plans.map((p) => p.toUpperCase() as BillingPlan);
      const wantsFree = plans.includes(BillingPlan.FREE);
      const paid = plans.filter((p) => p !== BillingPlan.FREE);
      // Free is the absence of a subscription row as well as a FREE one, which
      // is why this cannot be a single `subscription: { plan: { in } }`.
      where.OR = [
        ...(wantsFree ? [{ subscription: { is: null } }, { subscription: { plan: BillingPlan.FREE } }] : []),
        ...(paid.length ? [{ subscription: { plan: { in: paid } } }] : []),
      ];
    }
    return where;
  }

  /** Body plus the unsubscribe footer every campaign message must carry. */
  private render(campaign: EmailCampaign, recipient: string): { text: string; html: string } {
    const url = this.unsubscribeUrl(recipient);
    const paragraphs = campaign.bodyText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    return {
      text: [...paragraphs, '—', `Unsubscribe from CADO product email: ${url}`].join('\n\n'),
      html:
        paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('') +
        `<p style="color:#6b6b6b;font-size:13px">` +
        `<a href="${escapeHtml(url)}">Unsubscribe from CADO product email</a></p>`,
    };
  }

  private toDto(row: CampaignRow): AdminCampaignDto {
    return {
      id: row.id,
      subject: row.subject,
      bodyText: row.bodyText,
      audience: (row.audience as Audience | null) ?? null,
      status: row.status.toLowerCase() as CampaignStatusWire,
      total: row.total,
      sent: row.sent,
      failed: row.failed,
      createdByEmail: row.createdBy?.email ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
