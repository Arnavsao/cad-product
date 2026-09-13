import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import { environment } from '../../../environments/environment';
import {
  AdminAnnouncementDto,
  AdminCampaignDto,
  AdminDrawingQuery,
  AdminDrawingRowDto,
  AdminFeedbackDetailDto,
  AdminFeedbackQuery,
  AdminFeedbackRowDto,
  AdminFlagDto,
  AdminOrgDetailDto,
  AdminOrgRowDto,
  AdminSubscriptionRowDto,
  AdminWebhookRowDto,
  AudiencePreviewDto,
  BillingSummaryDto,
  JobRunDto,
  JobStatusDto,
  SuppressionDto,
  AdminOverviewDto,
  AdminUserDetailDto,
  AdminUserQuery,
  AdminUserRowDto,
  AuditEntryDto,
  AnnouncementKind,
  FeedbackStatus,
  StorageOrphansDto,
  SystemInfoDto,
  TimeseriesMetric,
  TimeseriesPointDto,
} from './admin.models';
import { Page, PlatformRole } from './api.models';

const enc = encodeURIComponent;

/**
 * Promise-returning client for `/admin`.
 *
 * Error codes worth branching on: 403 `FORBIDDEN` carries `{ required, actual }`
 * so the UI can say which tier is needed; 403 `CANNOT_TARGET_SELF` and
 * `CANNOT_CHANGE_OWN_ROLE`; 403 `TARGET_IS_STAFF` (manage staff accounts from
 * the Staff page); 409 `LAST_OWNER`, `ALREADY_SUSPENDED`, `ALREADY_DELETED`;
 * 404 `UNKNOWN_FLAG`.
 */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly api = inject(HttpManagerService);

  // --- Overview ------------------------------------------------------------

  /** `GET /admin/overview` — cached server-side for a minute. */
  overview(): Promise<AdminOverviewDto> {
    return firstValueFrom(this.api.get<AdminOverviewDto>('admin/overview'));
  }

  /** `GET /admin/timeseries` — daily buckets, zero-filled, oldest first. */
  timeseries(metric: TimeseriesMetric, days = 30): Promise<TimeseriesPointDto[]> {
    return firstValueFrom(
      this.api.get<TimeseriesPointDto[]>('admin/timeseries', { params: { metric, days } }),
    );
  }

  // --- Users ---------------------------------------------------------------

  /** `GET /admin/users` — offset-paged, so the UI can show "x–y of N". */
  listUsers(query: AdminUserQuery = {}): Promise<Page<AdminUserRowDto>> {
    return firstValueFrom(
      this.api.get<Page<AdminUserRowDto>>('admin/users', {
        params: {
          q: query.q,
          status: query.status,
          role: query.role,
          plan: query.plan,
          page: query.page,
          pageSize: query.pageSize,
        },
      }),
    );
  }

  getUser(id: string): Promise<AdminUserDetailDto> {
    return firstValueFrom(this.api.get<AdminUserDetailDto>(`admin/users/${enc(id)}`));
  }

  /** `POST /admin/users/:id/suspend` — ADMIN; the reason reaches the user. */
  suspendUser(id: string, reason: string): Promise<AdminUserDetailDto> {
    return firstValueFrom(this.api.post<AdminUserDetailDto>(`admin/users/${enc(id)}/suspend`, { reason }));
  }

  unsuspendUser(id: string): Promise<AdminUserDetailDto> {
    return firstValueFrom(this.api.post<AdminUserDetailDto>(`admin/users/${enc(id)}/unsuspend`, {}));
  }

  /** `POST /admin/users/:id/delete` — soft delete; drawings and storage survive. */
  deleteUser(id: string, reason: string): Promise<AdminUserDetailDto> {
    return firstValueFrom(this.api.post<AdminUserDetailDto>(`admin/users/${enc(id)}/delete`, { reason }));
  }

  /** `POST /admin/users/:id/notify` — one in-app message. */
  notifyUser(id: string, input: { title: string; body?: string; linkUrl?: string }): Promise<void> {
    return firstValueFrom(this.api.post<void>(`admin/users/${enc(id)}/notify`, input));
  }

  // --- Staff ---------------------------------------------------------------

  listStaff(): Promise<AdminUserRowDto[]> {
    return firstValueFrom(this.api.get<AdminUserRowDto[]>('admin/staff'));
  }

  /** `POST /admin/staff/:userId` — OWNER only. */
  setStaffRole(userId: string, role: PlatformRole): Promise<AdminUserRowDto> {
    return firstValueFrom(this.api.post<AdminUserRowDto>(`admin/staff/${enc(userId)}`, { role }));
  }

  /** `DELETE /admin/staff/:userId` — demotes to plain user. */
  removeStaff(userId: string): Promise<AdminUserRowDto> {
    return firstValueFrom(this.api.delete<AdminUserRowDto>(`admin/staff/${enc(userId)}`));
  }

  /** `POST /admin/users/:id/plan-override` — ADMIN. Omit `days` for no expiry. */
  grantPlan(id: string, input: { plan: string; days?: number; reason: string }): Promise<AdminUserDetailDto> {
    return firstValueFrom(this.api.post<AdminUserDetailDto>(`admin/users/${enc(id)}/plan-override`, input));
  }

  /** `DELETE /admin/users/:id/plan-override` — leaves any bought plan alone. */
  revokePlan(id: string): Promise<AdminUserDetailDto> {
    return firstValueFrom(this.api.delete<AdminUserDetailDto>(`admin/users/${enc(id)}/plan-override`));
  }

  // --- Feedback ------------------------------------------------------------

  /** `GET /admin/feedback` — SUPPORT and up. */
  listFeedback(query: AdminFeedbackQuery = {}): Promise<Page<AdminFeedbackRowDto>> {
    return firstValueFrom(this.api.get<Page<AdminFeedbackRowDto>>('admin/feedback', { params: { ...query } }));
  }

  getFeedback(id: string): Promise<AdminFeedbackDetailDto> {
    return firstValueFrom(this.api.get<AdminFeedbackDetailDto>(`admin/feedback/${enc(id)}`));
  }

  /** `PATCH /admin/feedback/:id` — every field independent; omit what you are not changing. */
  updateFeedback(
    id: string,
    patch: { status?: FeedbackStatus; assigneeId?: string | null; internalNote?: string },
  ): Promise<AdminFeedbackDetailDto> {
    return firstValueFrom(this.api.patch<AdminFeedbackDetailDto>(`admin/feedback/${enc(id)}`, patch));
  }

  /** `POST /admin/feedback/:id/reply` — 422 NO_REPLY_ADDRESS when sent anonymously. */
  replyToFeedback(id: string, body: string): Promise<AdminFeedbackDetailDto> {
    return firstValueFrom(this.api.post<AdminFeedbackDetailDto>(`admin/feedback/${enc(id)}/reply`, { body }));
  }

  /** Absolute URL of the CSV export, for a plain link. */
  feedbackExportUrl(query: AdminFeedbackQuery = {}): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return `${environment.apiUrl}/admin/feedback/export.csv${qs ? `?${qs}` : ''}`;
  }

  // --- Organizations -------------------------------------------------------

  listOrgs(query: { q?: string; page?: number; pageSize?: number } = {}): Promise<Page<AdminOrgRowDto>> {
    return firstValueFrom(this.api.get<Page<AdminOrgRowDto>>('admin/organizations', { params: { ...query } }));
  }

  getOrg(id: string): Promise<AdminOrgDetailDto> {
    return firstValueFrom(this.api.get<AdminOrgDetailDto>(`admin/organizations/${enc(id)}`));
  }

  /** `PATCH /admin/organizations/:id` — ADMIN. The slug is deliberately unchanged. */
  renameOrg(id: string, name: string, reason: string): Promise<AdminOrgDetailDto> {
    return firstValueFrom(this.api.patch<AdminOrgDetailDto>(`admin/organizations/${enc(id)}`, { name, reason }));
  }

  /** 422 NOT_A_MEMBER when the target has not joined; 409 ALREADY_OWNER. */
  transferOrgOwnership(id: string, userId: string, reason: string): Promise<AdminOrgDetailDto> {
    return firstValueFrom(
      this.api.post<AdminOrgDetailDto>(`admin/organizations/${enc(id)}/transfer-ownership`, { userId, reason }),
    );
  }

  regenerateOrgJoinCode(id: string): Promise<AdminOrgDetailDto> {
    return firstValueFrom(
      this.api.post<AdminOrgDetailDto>(`admin/organizations/${enc(id)}/regenerate-join-code`, {}),
    );
  }

  // --- Drawings and storage ------------------------------------------------

  listDrawings(query: AdminDrawingQuery = {}): Promise<Page<AdminDrawingRowDto>> {
    return firstValueFrom(this.api.get<Page<AdminDrawingRowDto>>('admin/drawings', { params: { ...query } }));
  }

  restoreDrawing(id: string): Promise<AdminDrawingRowDto> {
    return firstValueFrom(this.api.post<AdminDrawingRowDto>(`admin/drawings/${enc(id)}/restore`, {}));
  }

  /** Permanent: deletes the row and every object under the drawing's prefix. */
  purgeDrawing(id: string, reason: string): Promise<{ id: string; bytesFreed: number }> {
    return firstValueFrom(
      this.api.post<{ id: string; bytesFreed: number }>(`admin/drawings/${enc(id)}/purge`, { reason }),
    );
  }

  /** `GET /admin/storage/orphans` — OWNER only; walks the bucket, so it is slow. */
  storageOrphans(): Promise<StorageOrphansDto> {
    return firstValueFrom(this.api.get<StorageOrphansDto>('admin/storage/orphans'));
  }

  purgeStorageOrphans(): Promise<{ deleted: number; bytesFreed: number }> {
    return firstValueFrom(this.api.post<{ deleted: number; bytesFreed: number }>('admin/storage/orphans/purge', {}));
  }

  // --- Announcements -------------------------------------------------------

  listAnnouncements(): Promise<AdminAnnouncementDto[]> {
    return firstValueFrom(this.api.get<AdminAnnouncementDto[]>('admin/announcements'));
  }

  createAnnouncement(input: {
    title: string;
    body: string;
    kind?: AnnouncementKind;
    linkUrl?: string;
    startsAt?: string;
    endsAt?: string;
    pushToInbox?: boolean;
  }): Promise<AdminAnnouncementDto> {
    return firstValueFrom(this.api.post<AdminAnnouncementDto>('admin/announcements', input));
  }

  /** Publishing is irreversible when `pushToInbox` is on: 409 on a second call. */
  publishAnnouncement(id: string): Promise<AdminAnnouncementDto & { notified: number }> {
    return firstValueFrom(
      this.api.post<AdminAnnouncementDto & { notified: number }>(`admin/announcements/${enc(id)}/publish`, {}),
    );
  }

  deleteAnnouncement(id: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`admin/announcements/${enc(id)}`));
  }

  /** `GET /admin/users/:id/export` — ADMIN, and audited despite being a read. */
  exportUserData(id: string): Promise<Record<string, unknown>> {
    return firstValueFrom(this.api.get<Record<string, unknown>>(`admin/users/${enc(id)}/export`));
  }

  // --- Billing console -----------------------------------------------------

  billingSummary(): Promise<BillingSummaryDto> {
    return firstValueFrom(this.api.get<BillingSummaryDto>('admin/billing'));
  }

  subscriptions(query: { plan?: string; status?: string; page?: number } = {}): Promise<Page<AdminSubscriptionRowDto>> {
    return firstValueFrom(
      this.api.get<Page<AdminSubscriptionRowDto>>('admin/billing/subscriptions', { params: { ...query } }),
    );
  }

  /** ADMIN and up: a delivery's error text can name a customer. */
  webhooks(query: { status?: string; page?: number } = {}): Promise<Page<AdminWebhookRowDto>> {
    return firstValueFrom(this.api.get<Page<AdminWebhookRowDto>>('admin/billing/webhooks', { params: { ...query } }));
  }

  // --- Campaigns -----------------------------------------------------------

  listCampaigns(): Promise<AdminCampaignDto[]> {
    return firstValueFrom(this.api.get<AdminCampaignDto[]>('admin/campaigns'));
  }

  createCampaign(input: {
    subject: string;
    bodyText: string;
    plans?: string[];
    onlyActive?: boolean;
  }): Promise<AdminCampaignDto> {
    return firstValueFrom(this.api.post<AdminCampaignDto>('admin/campaigns', input));
  }

  /** How many people it would reach, before anything is sent. */
  previewCampaign(id: string): Promise<AudiencePreviewDto> {
    return firstValueFrom(this.api.get<AudiencePreviewDto>(`admin/campaigns/${enc(id)}/preview`));
  }

  testSendCampaign(id: string, to: string): Promise<{ sent: boolean }> {
    return firstValueFrom(this.api.post<{ sent: boolean }>(`admin/campaigns/${enc(id)}/test`, { to }));
  }

  /** OWNER only, and irreversible: the send starts in the background. */
  sendCampaign(id: string): Promise<AdminCampaignDto> {
    return firstValueFrom(this.api.post<AdminCampaignDto>(`admin/campaigns/${enc(id)}/send`, {}));
  }

  suppressions(): Promise<SuppressionDto[]> {
    return firstValueFrom(this.api.get<SuppressionDto[]>('admin/campaigns/suppressions'));
  }

  unsuppress(email: string): Promise<{ email: string }> {
    return firstValueFrom(this.api.delete<{ email: string }>(`admin/campaigns/suppressions/${enc(email)}`));
  }

  // --- Scheduled jobs ------------------------------------------------------

  jobs(): Promise<JobStatusDto[]> {
    return firstValueFrom(this.api.get<JobStatusDto[]>('admin/system/jobs'));
  }

  jobHistory(name?: string): Promise<JobRunDto[]> {
    return firstValueFrom(this.api.get<JobRunDto[]>('admin/system/jobs/history', { params: { name } }));
  }

  /** OWNER only from the portal; the scheduler uses a token instead. */
  runJob(name: string): Promise<JobRunDto> {
    return firstValueFrom(this.api.post<JobRunDto>(`admin/system/jobs/${enc(name)}/run`, {}));
  }

  // --- Flags ---------------------------------------------------------------

  listFlags(): Promise<AdminFlagDto[]> {
    return firstValueFrom(this.api.get<AdminFlagDto[]>('admin/flags'));
  }

  /** `PUT /admin/flags/:key` — ADMIN. Takes effect within a minute everywhere. */
  setFlag(key: string, enabled: boolean, payload?: Record<string, unknown> | null): Promise<AdminFlagDto> {
    return firstValueFrom(
      this.api.put<AdminFlagDto>(`admin/flags/${enc(key)}`, payload === undefined ? { enabled } : { enabled, payload }),
    );
  }

  /** `DELETE /admin/flags/:key` — drops the override, back to the shipped default. */
  resetFlag(key: string): Promise<AdminFlagDto> {
    return firstValueFrom(this.api.delete<AdminFlagDto>(`admin/flags/${enc(key)}`));
  }

  // --- Audit and system ----------------------------------------------------

  /** `GET /admin/audit` — ADMIN and up. */
  audit(query: {
    actorId?: string;
    targetType?: string;
    targetId?: string;
    action?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<Page<AuditEntryDto>> {
    return firstValueFrom(this.api.get<Page<AuditEntryDto>>('admin/audit', { params: { ...query } }));
  }

  system(): Promise<SystemInfoDto> {
    return firstValueFrom(this.api.get<SystemInfoDto>('admin/system'));
  }
}
