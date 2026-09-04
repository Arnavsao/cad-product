/**
 * DTOs of the CADO API (`/api/v1`). These mirror the server's contract
 * name-for-name — see the "API contract" section of the project plan. Times
 * are ISO-8601 strings; ids are cuids.
 */

export type Units = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type UserRole = 'architect' | 'engineer' | 'student' | 'other';
export type DrawingFormat = 'dxf' | 'dwg';

/**
 * What the caller may do with one drawing or folder, highest wins.
 *
 * `view` opens and downloads, `edit` also saves / renames / trashes, `manage`
 * additionally owns the sharing and the workspace of the item. The server
 * resolves it per row (`common/access.ts`) and sends it on every summary; the
 * client only ever *hides* actions with it — the API is still the authority.
 */
export type AccessLevel = 'view' | 'edit' | 'manage';

/** What a share or a share link grants. A share never grants `manage`. */
export type SharePermission = 'view' | 'edit';

// ── Drawings ──────────────────────────────────────────────────────────────

/** Creator of a drawing — what the dashboard's "Owner" column renders. */
export interface DrawingOwnerDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

export interface DrawingSummaryDto {
  id: string;
  name: string;
  format: DrawingFormat;
  folderId: string | null;
  /** `null` for a personal drawing; an org id for a shared one. */
  organizationId: string | null;
  /** Display name of `organizationId` — the "Shared" column. */
  organizationName: string | null;
  /** `null` on responses built from a row fetched without its relations. */
  owner: DrawingOwnerDto | null;
  byteSize: number;
  currentVersion: number;
  /** Presigned, hour-stable GET URL of the PNG thumbnail; null until one is rendered. */
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  /** Only present on trash listings. */
  deletedAt?: string | null;
  /**
   * The caller's access to this row.
   *
   * Optional on purpose: every current server sends it, but a client that is
   * newer than the API it is talking to must not lose its menus — readers use
   * `accessOf()` in `features/dashboard/components/drawing-menu.ts`, which
   * falls back to `manage` (the pre-sharing behaviour, where anything you could
   * list you could also act on).
   */
  access?: AccessLevel;
  /** True when the row is reachable through a share rather than the workspace. */
  viaShare?: boolean;
  /** Live shares plus unrevoked links on this drawing — badges the Share action. */
  shareCount?: number;
}

export interface DrawingDto extends DrawingSummaryDto {
  /** Presigned GET URL for the DXF payload (valid ~10 minutes). */
  downloadUrl: string;
  downloadUrlExpiresAt: string;
}

export interface SaveResultDto {
  version: number;
  byteSize: number;
  updatedAt: string;
}

/** `DELETE /drawings/:id` (move to trash). */
export interface TrashedDto {
  id: string;
  deletedAt: string;
}

/** `DELETE /drawings/:id/permanent`. */
export interface DeletedDto {
  id: string;
}

/** `PUT /drawings/:id/thumbnail`. */
export interface ThumbnailDto {
  thumbnailUrl: string;
}

// ── Folders ───────────────────────────────────────────────────────────────

export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  /** `null` for a personal folder; an org id for a shared one. */
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
  /** See `DrawingSummaryDto.access` — same contract, same optionality. */
  access?: AccessLevel;
  /** True when the folder is reachable through a share rather than the workspace. */
  viaShare?: boolean;
  /** Display name of `organizationId`, when the server resolved it. */
  organizationName?: string | null;
  /** Creator — rendered by the "Owner" column of a shared listing. */
  owner?: DrawingOwnerDto | null;
}

export interface FolderPathEntry {
  id: string;
  name: string;
}

/** `GET /folders/:id` — the folder plus its ancestry (root first) for breadcrumbs. */
export interface FolderDetailDto extends FolderDto {
  path: FolderPathEntry[];
}

/** `DELETE /folders/:id`. */
export interface DeleteFolderResultDto {
  id: string;
  trashedDrawings: number;
}

// ── Sharing ───────────────────────────────────────────────────────────────

/** Organization a resource is shared *with*. */
export interface ShareTargetOrgDto {
  id: string;
  name: string;
}

/** The account behind `targetEmail`, when one exists — for an avatar and a name. */
export interface ShareTargetUserDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

/**
 * One person-or-organization share on a drawing or folder. Exactly one of
 * `targetEmail` / `targetOrganization` is set; `targetUser` is the resolved
 * account for an email that has signed up.
 */
export interface ShareDto {
  id: string;
  targetEmail: string | null;
  targetOrganization: ShareTargetOrgDto | null;
  targetUser: ShareTargetUserDto | null;
  permission: SharePermission;
  expiresAt: string | null;
  createdAt: string;
}

/**
 * A revocable link (drawings only). The client builds the URL from its own
 * origin — `${location.origin}/shared/${token}` — so the DTO carries no host.
 */
export interface ShareLinkDto {
  id: string;
  token: string;
  permission: SharePermission;
  expiresAt: string | null;
  createdAt: string;
}

/** `GET /drawings/:id/shares` and `GET /folders/:id/shares`. */
export interface SharesDto {
  access: AccessLevel;
  shares: ShareDto[];
  /** Always empty for folders — links exist on drawings only. */
  links: ShareLinkDto[];
}

/** `PUT /drawings/:id/shares` — exactly one of `email` / `organizationId`. */
export interface UpsertShareRequest {
  email?: string;
  organizationId?: string;
  permission: SharePermission;
  /** ISO timestamp, or `null` for "never expires". */
  expiresAt?: string | null;
}

/** Expiries the link dialog offers; `null` is "never". */
export type ShareLinkExpiry = 7 | 30 | 90 | null;

/** `POST /drawings/:id/links`. */
export interface CreateShareLinkRequest {
  permission: SharePermission;
  expiresInDays?: ShareLinkExpiry;
}

/** Most addresses one `POST /drawings/:id/links/:linkId/email` call may name. */
export const MAX_LINK_EMAIL_RECIPIENTS = 10;

/** Longest note that may accompany an emailed link. */
export const MAX_LINK_EMAIL_MESSAGE = 500;

/** `POST /drawings/:id/links/:linkId/email` — mail an existing link out. */
export interface EmailShareLinkRequest {
  /** 1–10 addresses; the server validates each and refuses the whole call. */
  emails: string[];
  message?: string;
}

/** How many messages the server accepted for delivery. */
export interface EmailedShareLinkDto {
  sent: number;
}

/** `GET /shared/:token` — what a recipient sees before accepting. */
export interface SharedLinkDto {
  drawing: DrawingSummaryDto;
  permission: SharePermission;
  owner: DrawingOwnerDto | null;
  expired: boolean;
}

/** `POST /shared/:token/accept` — the link became a durable share. */
export interface AcceptSharedLinkDto {
  drawingId: string;
  access: AccessLevel;
}

// ── Versions ──────────────────────────────────────────────────────────────

/** `GET /drawings/:id/versions` — newest first. */
export interface VersionDto {
  version: number;
  byteSize: number;
  createdAt: string;
  isCurrent: boolean;
}

/** `GET /drawings/:id/versions/:version`. */
export interface VersionDownloadDto {
  downloadUrl: string;
  expiresAt: string;
}

// ── Billing ───────────────────────────────────────────────────────────────

/** Plans, lower-case on the wire like every other enum in this API. */
export type BillingPlan = 'free' | 'pro' | 'team';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled' | 'incomplete';

/** Intervals sold. Monthly and annual are separate products in Dodo Payments. */
export type BillingInterval = 'monthly' | 'annual';

/**
 * Current plan and subscription period.
 *
 * `plan` is the *effective* plan — what the account is entitled to right now.
 * A cancelled Pro subscription reports `free` here even though the server still
 * records that Pro was what was bought, so the UI never has to work that out.
 */
export interface BillingStateDto {
  plan: BillingPlan;
  /** Null when nothing has ever been purchased. */
  status: SubscriptionStatus | null;
  /** ISO 8601. Shown as "renews on", or "access until" when cancelling. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  /** True when this deployment can produce a customer-portal link. */
  manageable: boolean;
}

export interface CreateCheckoutRequest {
  plan: 'pro' | 'team';
  interval?: BillingInterval;
}

export interface CheckoutResponse {
  /** Absolute Dodo-hosted URL. Single-use, expires in 24 hours. */
  checkoutUrl: string;
}

export interface PortalResponse {
  portalUrl: string;
}

// ── Me ────────────────────────────────────────────────────────────────────

export interface PreferencesDto {
  units: Units;
  /** Theme id from the editor's theme registry (e.g. `cad-dark`). */
  theme: string;
  /** BCP 47 UI language tag from `src/app/core/i18n/locales.ts` (e.g. `pt-BR`). */
  locale: string;
  role: UserRole | null;
  defaultTemplate: string;
  autosaveIntervalSec: number;
  /** Free-form UI state persisted for the user (view mode, collapsed panels …). */
  uiState: Record<string, unknown> | null;
  /** Email me when a drawing or folder is shared with me. */
  emailOnShare: boolean;
  /**
   * Email me when my role or access in an organization changes. Organization
   * *invitations* are not covered by either flag and are always delivered —
   * an invitation is the only way an address with no account learns of one.
   */
  emailOnOrgActivity: boolean;
}

export interface MeUserDto {
  id: string;
  authId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  createdAt: string;
}

export interface MeDto {
  user: MeUserDto;
  preferences: PreferencesDto;
  onboarded: boolean;
  usage: { bytesUsed: number; drawingCount: number };
  /** Workspaces the user belongs to; drives the dashboard switcher. */
  organizations: OrgSummaryDto[];
  /**
   * Current plan. Always present — an account that has never bought anything
   * reports the Free state, so the UI never has to handle a missing value.
   */
  billing: BillingStateDto;
}

// ── Organizations ─────────────────────────────────────────────────────────

/**
 * Ranked `VIEWER < MEMBER < ADMIN < OWNER`. A viewer opens and downloads the
 * organization's drawings but never saves, renames or trashes one.
 */
export type OrgRole = 'viewer' | 'member' | 'admin' | 'owner';

/** Roles an admin may hand out — ownership transfer is an owner-only action. */
export type AssignableOrgRole = Exclude<OrgRole, 'owner'>;

export interface OrgSummaryDto {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  /** The signed-in user's role in this organization. */
  role: OrgRole;
  memberCount: number;
  createdAt: string;
}

/** `GET /organizations/:id` — members only. */
export interface OrgDetailDto extends OrgSummaryDto {
  /** Only sent to admins and owners; `null` for a plain member. */
  joinCode: string | null;
  drawingCount: number;
}

export interface OrgMemberDto {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  role: OrgRole;
  joinedAt: string;
}

export interface OrgInviteDto {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  createdAt: string;
  /**
   * Join token, so an admin can copy `${origin}/join/${token}` and send it
   * themselves — there is no email delivery. The invites list is admin-only, so
   * this never reaches a plain member.
   */
  token?: string;
  /** Set on the invitations *addressed to you* listing; absent on an org's own list. */
  organizationName?: string;
}

/**
 * `GET /organizations/invitations` — invites addressed to the signed-in user's
 * email address, which is how someone learns about an invite with no mail
 * server in the picture.
 */
export interface OrgInvitationDto {
  id: string;
  organizationId: string;
  organizationName: string;
  role: OrgRole;
  invitedBy: { firstName: string | null; lastName: string | null; email: string } | null;
  expiresAt: string;
  token: string;
}

// ── Generic ───────────────────────────────────────────────────────────────

/**
 * A page of results in either paging mode.
 *
 * `nextCursor` is the keyset mode (walk forward through a feed). `total`,
 * `page` and `pageSize` arrive only when the request asked for a numbered page,
 * which is what the dashboard's pager needs to render "1–25 of 137".
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface PresignDto {
  uploadUrl: string;
  key: string;
  expiresAt: string;
}

// ── Requests ──────────────────────────────────────────────────────────────

export interface CreateDrawingRequest {
  name: string;
  folderId?: string | null;
  /** Workspace to create in; ignored by the server when `folderId` is given. */
  organizationId?: string | null;
  /** Omit to let the server create a blank template (units from preferences). Max 5 MB. */
  initialDxf?: string;
}

export type DrawingSort = 'updated' | 'name' | 'opened';

/**
 * Which set of rows a listing asks for: the active workspace's own files, or
 * everything other people shared with the caller (personally or with one of
 * their organizations).
 */
export type ListScope = 'workspace' | 'shared';

export interface ListDrawingsQuery {
  /** A folder id, or `'root'` for drawings outside any folder. Omit for all. */
  folderId?: string | 'root';
  /** Omit for the personal workspace; an org id for that org's drawings. */
  organizationId?: string | null;
  q?: string;
  sort?: DrawingSort;
  /** Keyset paging. Mutually exclusive with `page`. */
  cursor?: string;
  /** 1-based numbered paging; makes the response carry `total`. */
  page?: number;
  /** 1..100 */
  limit?: number;
  /** Omit (or `'workspace'`) for the active workspace; `'shared'` for "Shared with me". */
  scope?: ListScope;
}

export interface UpdateDrawingRequest {
  name?: string;
  /** `null` moves the drawing to the root. */
  folderId?: string | null;
}

/**
 * `POST /drawings/:id/move` — the explicit, cross-workspace move. `PATCH` still
 * handles a move *within* one workspace (and refuses to leave it with 422
 * `CROSS_WORKSPACE_MOVE`), so callers only reach for this when the workspace
 * itself changes.
 */
export interface MoveDrawingRequest {
  /** `null` = the caller's personal workspace. */
  organizationId: string | null;
  /** `null` = the root of that workspace. */
  folderId: string | null;
}

/** `POST /drawings/:id/copy` — the caller owns the copy, wherever it lands. */
export interface CopyDrawingRequest {
  organizationId: string | null;
  folderId: string | null;
  /** Omit to let the server auto-suffix ("Plan (copy)"). */
  name?: string;
}

/** `POST /folders/:id/move` — re-tags the whole subtree. */
export interface MoveFolderRequest {
  organizationId: string | null;
  /** `null` = the root of the destination workspace. */
  parentId: string | null;
}

/** `DELETE /drawings/trash`. */
export interface EmptyTrashDto {
  deleted: number;
}

export interface PresignUploadRequest {
  fileName: string;
  contentType: string;
  /** ≤ 50 MB */
  byteSize: number;
}

export interface ImportDrawingRequest {
  /** Staging key returned by `POST /uploads/presign`. */
  key: string;
  name?: string;
  folderId?: string | null;
  /** Workspace to import into; ignored by the server when `folderId` is given. */
  organizationId?: string | null;
}

export interface CompleteOnboardingRequest {
  role: UserRole;
  units: Units;
  defaultTemplate?: string;
}

export interface CreateFolderRequest {
  name: string;
  parentId?: string | null;
  /** Workspace to create in; ignored by the server when `parentId` is given. */
  organizationId?: string | null;
}

export interface UpdateFolderRequest {
  name?: string;
  /** `null` moves the folder to the root. */
  parentId?: string | null;
}

// -----------------------------------------------------------------------------
// Feedback — `/feedback`
// -----------------------------------------------------------------------------

export type FeedbackKind = 'bug' | 'idea' | 'question' | 'other';

/** Diagnostics attached client-side so a report can be reproduced. */
export interface FeedbackContext {
  route?: string;
  appVersion?: string;
  userAgent?: string;
}

export interface FeedbackDto {
  id: string;
  kind: FeedbackKind;
  rating: number | null;
  message: string;
  email: string | null;
  createdAt: string;
}

export interface CreateFeedbackRequest {
  kind?: FeedbackKind;
  /** 1–5. Omitted when the user did not rate. */
  rating?: number;
  message: string;
  /** Only useful for signed-out submissions. */
  email?: string;
  context?: FeedbackContext;
}

// -----------------------------------------------------------------------------
// Notification inbox — `/notifications`
//
// Named `InboxItemDto`, not `NotificationDto`: `Notification` is already taken
// app-side by the toast queue in `core/services/notification.service.ts`.
// -----------------------------------------------------------------------------

export type InboxItemKind = 'system' | 'drawing' | 'storage' | 'account';

export interface InboxItemDto {
  id: string;
  kind: InboxItemKind;
  title: string;
  body: string | null;
  /** In-app route to open, or null when there is nothing to open. */
  linkUrl: string | null;
  /** ISO timestamp, or null while unread. */
  readAt: string | null;
  createdAt: string;
}

/** `GET /notifications` — a page plus the unread total for the header badge. */
export interface InboxPageDto {
  items: InboxItemDto[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface MarkAllReadDto {
  updated: number;
}
