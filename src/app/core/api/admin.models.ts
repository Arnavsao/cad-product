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
