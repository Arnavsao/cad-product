import { PlatformRole } from './api.models';

/** Account lifecycle as the portal filters and shows it. */
export type AccountStatus = 'active' | 'suspended' | 'deleted';

/** One row of the admin user list. */
export interface AdminUserRowDto {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  platformRole: PlatformRole;
  status: AccountStatus;
  plan: string;
  onboarded: boolean;
  drawingCount: number;
  bytesUsed: number;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Everything the user detail page renders. */
export interface AdminUserDetailDto extends AdminUserRowDto {
  authId: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  deletedAt: string | null;
  updatedAt: string;
  preferences: { units: string; theme: string; locale: string; role: string | null } | null;
  organizations: { id: string; name: string; slug: string; role: string }[];
  billing: {
    plan: string;
    status: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    overridePlan: string | null;
    overrideUntil: string | null;
    overrideReason: string | null;
  } | null;
  feedbackCount: number;
}

/** `GET /admin/overview`. */
export interface AdminOverviewDto {
  users: { total: number; new7d: number; new30d: number; suspended: number; deleted: number; staff: number };
  active: { daily: number; weekly: number; monthly: number };
  drawings: { total: number; new7d: number; trashed: number; bytesUsed: number };
  feedback: { open: number; new7d: number; byStatus: Record<string, number> };
  billing: { byPlan: Record<string, number>; active: number; pastDue: number; webhookFailures7d: number };
  health: { dbLatencyMs: number };
  generatedAt: string;
}

export type TimeseriesMetric = 'signups' | 'active' | 'drawings' | 'feedback';

export interface TimeseriesPointDto {
  date: string;
  value: number;
}

/** Triage state of one report. */
export type FeedbackStatus = 'new' | 'triaged' | 'in_progress' | 'resolved' | 'wont_fix';
export type FeedbackKind = 'bug' | 'idea' | 'question' | 'other';

/** Statuses that still want attention. */
export const OPEN_FEEDBACK_STATUSES: readonly FeedbackStatus[] = ['new', 'triaged', 'in_progress'];

/** One submission as the triage list shows it. */
export interface AdminFeedbackRowDto {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  rating: number | null;
  excerpt: string;
  fromEmail: string | null;
  fromUserId: string | null;
  fromName: string | null;
  assigneeId: string | null;
  assigneeEmail: string | null;
  appVersion: string | null;
  repliedAt: string | null;
  createdAt: string;
}

export interface AdminFeedbackDetailDto extends AdminFeedbackRowDto {
  message: string;
  internalNote: string | null;
  resolvedAt: string | null;
  context: { route?: string; appVersion?: string; userAgent?: string } | null;
  /** False when the report was sent anonymously with no address. */
  replyable: boolean;
}

export interface AdminFeedbackQuery {
  q?: string;
  status?: FeedbackStatus;
  kind?: FeedbackKind;
  appVersion?: string;
  assignee?: string;
  page?: number;
  pageSize?: number;
}

/** One organization as the admin list shows it. */
export interface AdminOrgRowDto {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  memberCount: number;
  drawingCount: number;
  bytesUsed: number;
  ownerEmail: string | null;
  createdAt: string;
}

export interface AdminOrgDetailDto extends AdminOrgRowDto {
  joinCode: string;
  members: { userId: string; email: string; name: string | null; role: string; joinedAt: string }[];
  invites: { id: string; email: string; role: string; expiresAt: string; createdAt: string }[];
  updatedAt: string;
}

/** One drawing, metadata only — the portal never fetches content. */
export interface AdminDrawingRowDto {
  id: string;
  name: string;
  format: string;
  byteSize: number;
  currentVersion: number;
  ownerId: string;
  ownerEmail: string;
  organizationId: string | null;
  organizationName: string | null;
  deletedAt: string | null;
  lastOpenedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface AdminDrawingQuery {
  q?: string;
  ownerId?: string;
  organizationId?: string;
  /** 'true' for the trash, 'false' for live rows, omitted for both. */
  deleted?: string;
  page?: number;
  pageSize?: number;
}

/** What the storage scan found, both directions. */
export interface StorageOrphansDto {
  orphanedObjects: { key: string; bytes: number }[];
  brokenDrawings: { id: string; name: string; ownerEmail: string; storageKey: string }[];
  truncated: boolean;
  scannedObjects: number;
  reclaimableBytes: number;
}

export type AnnouncementKind = 'system' | 'drawing' | 'storage' | 'account';

export interface AdminAnnouncementDto {
  id: string;
  title: string;
  body: string;
  kind: AnnouncementKind;
  linkUrl: string | null;
  startsAt: string;
  endsAt: string | null;
  pushToInbox: boolean;
  publishedAt: string | null;
  /** Published, started, and not yet ended. */
  live: boolean;
  createdByEmail: string | null;
  createdAt: string;
}

/** What a signed-in user is shown. */
export interface PublicAnnouncementDto {
  id: string;
  title: string;
  body: string;
  kind: AnnouncementKind;
  linkUrl: string | null;
}

// --- Phase 3: billing console, campaigns, scheduled jobs ---------------------

export interface BillingSummaryDto {
  /** Approximate: computed from display prices, not from what Dodo charged. */
  approximateMrr: number;
  currency: string;
  byPlan: Record<string, number>;
  paying: number;
  trialing: number;
  pastDue: number;
  cancelled: number;
  grants: number;
  unprocessedWebhooks: number;
  catalog: { mode: 'off' | 'test' | 'live'; sellable: string[]; webhookConfigured: boolean };
}

export interface AdminSubscriptionRowDto {
  userId: string;
  email: string;
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  overridePlan: string | null;
  dodoSubscriptionId: string | null;
  createdAt: string;
}

export interface AdminWebhookRowDto {
  id: string;
  type: string;
  processedAt: string | null;
  error: string | null;
  receivedAt: string;
}

export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'failed';

export interface AdminCampaignDto {
  id: string;
  subject: string;
  bodyText: string;
  audience: { plans?: string[]; onlyActive?: boolean } | null;
  status: CampaignStatus;
  total: number;
  sent: number;
  failed: number;
  createdByEmail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AudiencePreviewDto {
  recipients: number;
  suppressed: number;
  sample: string[];
}

export interface SuppressionDto {
  email: string;
  reason: string;
  createdAt: string;
}

export interface JobStatusDto {
  name: string;
  description: string;
  suggestedCron: string;
  destructive: boolean;
  lastRun: {
    id: string;
    status: string;
    summary: unknown;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
    /** Still running past its timeout: the job died without finishing. */
    stuck: boolean;
  } | null;
}

export interface JobRunDto {
  id: string;
  name: string;
  status: string;
  summary: unknown;
  error: string | null;
  triggeredById: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** A flag as the public `GET /flags` reports it. */
export interface FlagDto {
  key: string;
  enabled: boolean;
  payload: Record<string, unknown> | null;
}

/** A flag with the staff-only metadata from `GET /admin/flags`. */
export interface AdminFlagDto extends FlagDto {
  description: string;
  group: string;
  /** False when the effective value is the shipped default (no override row). */
  overridden: boolean;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

/** One entry of the staff audit trail. */
export interface AuditEntryDto {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  createdAt: string;
}

/** `GET /admin/system` — deployment configuration, never secrets. */
export interface SystemInfoDto {
  version: string;
  nodeVersion: string;
  environment: string;
  uptimeSeconds: number;
  auth: { configured: boolean; mode: 'jwks' | 'hs256' | 'unconfigured' };
  mail: { transport: 'resend' | 'log'; from: string | null };
  billing: { configured: boolean; mode: 'test' | 'live' | 'off'; webhookConfigured: boolean };
  storage: { bucket: string; reachable: boolean; endpoint: string };
  database: { reachable: boolean; latencyMs: number; keepaliveSeconds: number };
  limits: {
    rateLimit: number;
    adminRateLimit: number;
    maxUploadBytes: number;
    maxInlineContentBytes: number;
    maxVersionsPerDrawing: number;
  };
}

/** Query of `GET /admin/users`. */
export interface AdminUserQuery {
  q?: string;
  status?: AccountStatus;
  role?: PlatformRole;
  plan?: string;
  page?: number;
  pageSize?: number;
}
