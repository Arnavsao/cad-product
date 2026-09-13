# CADO Admin Portal — Implementation Plan

Status: proposal, 2026-09-14. Owner: TBD. Target: Phase 1 live before the beta invitation email goes out; Phases 2–3 carry the same portal through to the main launch.

## 1. Why now, and what it has to do

The beta is open and free (`docs/marketing/beta-invite-email.md`). Everything that comes back from it — sign-ups, bug reports, broken drawings, storage growth, the odd abusive account — currently has to be handled with `prisma studio`, the Supabase dashboard and the Dodo dashboard. None of those leave a trail, none of them know about the others, and none of them can be handed to a second person safely.

The portal is one place where a small team can:

* see who is signing up and whether they come back;
* read, triage and answer feedback (the beta's whole point);
* switch things off without a deploy (AI assistant, sign-ups, uploads, a maintenance banner);
* look after accounts (suspend, delete, grant a plan, fix a stuck subscription);
* look after data (restore from trash, purge, find orphaned storage);
* prove afterwards who did what (audit log).

For the main launch the same portal grows a billing console, plan enforcement, staff roles with MFA, email campaigns and scheduled housekeeping. Nothing built for the beta is thrown away.

## 2. What exists today (verified against the code)

| Area | State | Consequence for the portal |
|---|---|---|
| Identity | Supabase Auth in the browser; API only verifies the JWT (`server/src/auth/supabase-auth.guard.ts`) and lazily creates the `users` row (`UsersService.ensureLocalUser`). | We cannot block sign-up at Supabase from our code; we *can* refuse to create the local row, which is what "sign-ups closed" will mean. |
| Authorization | Per-row `view / edit / manage` from ownership, org role and shares (`server/src/common/access.ts`). `OrgRole.ADMIN` is org-scoped. `UserRole` is a profession. | **There is no platform-level role.** A new `platformRole` column and an `AdminGuard` are the first thing to build. |
| Users | `users` has `deletedAt` (soft delete) but no suspension, no last-seen. `MeDto.user` has no role. | Add `suspendedAt`, `lastSeenAt`, `platformRole`; expose the role in `MeDto`. |
| Feedback | `feedback` table with kind, rating, message, email, `context {route, appVersion, userAgent}`. Only `GET /feedback/mine`. | Add status / assignee / internal note; add an admin listing and a reply path. |
| Billing | Dodo Payments; `subscriptions` is a projection, `webhook_events` is the audit trail. `effectivePlan()` exists, **nothing calls it**. | Beta needs "grant Pro to a tester" without Dodo (plan override). Launch needs a webhook/subscription console and enforcement. |
| Mail | `MailModule` (Resend or log transport), 5 templates, one recipient per send, never throws. | Feedback reply and staff invitations are cheap. Bulk email needs chunking and a progress record. |
| Notifications | In-app inbox exists (`notifications` table, `NotificationsService` exported). | Announcements can fan out into it without new UI on the user side. |
| Flags | None. `environment.model.ts` has six keys, no flags. | New `feature_flags` table + public `GET /flags`. |
| Audit | None except billing webhooks. | New `audit_log` table written by every admin mutation. |
| Metrics | `getUsage()` per user only; no counts, no time series, no `/metrics`. | Overview page computes from existing tables; `lastSeenAt` gives DAU/WAU/MAU. |
| Frontend shell | `dashboard-shell.component.ts` (grid, left rail, top bar, inbox, account button) and `shared/ui` primitives (button, input, card, dialog, menu, paginator, icon, empty state, skeleton, pipes). No table, tabs, badge, stat tile or chart primitive. | Admin shell copies the dashboard shell's structure. Four small primitives need adding. |
| Routing / deploy | One SPA, one nginx `try_files … /index.html`, one Container App per tier. Lazy `loadComponent` everywhere. | An `/admin` route costs nothing in infra. A separate app would need a second Angular project, image, Container App and domain. |

## 3. Decisions

1. **Same SPA, route `/admin`, lazy chunk.** Reuses auth, interceptor, design system, i18n and deployment. All admin API lives under `/api/v1/admin/*` so moving the UI to its own host later is a routing change, not a rewrite.
2. **Enforcement is server-side only.** The client-side `adminGuard` hides the UI; `AdminGuard` on the API is the security boundary. A regular user calling `/api/v1/admin/users` gets `403 FORBIDDEN`, never a 404.
3. **Three staff tiers, one column.** `PlatformRole { USER, SUPPORT, ADMIN, OWNER }` on `users`. SUPPORT reads everything and triages feedback; ADMIN mutates users, flags, plans and data; OWNER manages staff and billing configuration. Kept separate from `OrgRole` and from the profession `UserRole`.
4. **Bootstrap through env, then through the UI.** `ADMIN_BOOTSTRAP_EMAILS` (comma list) promotes matching accounts to OWNER on their next authenticated request. After that, staff are promoted from the Staff page. Nobody can change their own role, and the last OWNER cannot be demoted.
5. **No access to drawing contents by default.** Admin drawing views are metadata only (name, owner, size, versions, storage key). A `drawings.adminDownload` flag, OWNER-only and audited, exists for support cases but ships off. This is the privacy line the marketing copy implies.
6. **Every mutation is audited** with actor, action, target, before/after JSON, IP and user agent, via one interceptor on the admin module. Reads are not audited (too noisy), except downloads.
7. **Flags have a typed registry in code.** Unknown keys cannot be created; the table stores overrides of code defaults. Client reads the effective set once at boot from `GET /flags` (public, cached 60 s server-side).
8. **English-first UI.** Admin strings live in their own i18n fragment (`admin.en.json`) so the en.json drift gate stays green; other locales fall back to English through Transloco's `useFallbackTranslation` until someone chooses to translate them.

## 4. Data model changes (one Prisma migration per phase)

### Phase 1 migration `admin_foundation`

```prisma
enum PlatformRole { USER SUPPORT ADMIN OWNER }
enum FeedbackStatus { NEW TRIAGED IN_PROGRESS RESOLVED WONT_FIX }

model User {
  // …existing fields…
  platformRole     PlatformRole @default(USER)
  suspendedAt      DateTime?
  suspendedReason  String?
  lastSeenAt       DateTime?      // touched at most once per hour by the guard
  @@index([platformRole])
  @@index([lastSeenAt])
}

model Feedback {
  // …existing fields…
  status        FeedbackStatus @default(NEW)
  assigneeId    String?
  assignee      User?     @relation("feedbackAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  internalNote  String?
  resolvedAt    DateTime?
  repliedAt     DateTime?
  @@index([status, createdAt])
}

model AuditLog {
  id          String   @id @default(cuid())
  actorId     String
  actorEmail  String
  action      String            // "user.suspend", "flag.set", "feedback.reply" …
  targetType  String            // "user" | "org" | "drawing" | "feedback" | "flag" | …
  targetId    String?
  before      Json?
  after       Json?
  reason      String?
  ip          String?
  userAgent   String?
  createdAt   DateTime @default(now())
  @@index([targetType, targetId, createdAt])
  @@index([actorId, createdAt])
  @@index([createdAt])
  @@map("audit_log")
}

model FeatureFlag {
  key          String   @id                 // must exist in FLAG_REGISTRY
  enabled      Boolean
  payload      Json?                        // e.g. { "text": "Maintenance 22:00 UTC" }
  updatedById  String
  updatedAt    DateTime @updatedAt
  @@map("feature_flags")
}

model Announcement {
  id           String   @id @default(cuid())
  title        String
  body         String
  kind         NotificationKind @default(SYSTEM)
  linkUrl      String?
  startsAt     DateTime @default(now())
  endsAt       DateTime?
  audience     Json?                        // { plans?: [...], orgIds?: [...] } — null = everyone
  pushToInbox  Boolean  @default(false)
  publishedAt  DateTime?
  createdById  String
  createdAt    DateTime @default(now())
  @@index([startsAt, endsAt])
  @@map("announcements")
}
```

### Phase 2 migration `admin_operations`

```prisma
model Subscription {
  // …existing…
  overridePlan   BillingPlan?               // admin grant, wins over Dodo when set
  overrideUntil  DateTime?
  overrideReason String?
}
```
`BillingService.effectivePlan()` becomes `max(overridePlan if not expired, dodo-derived plan)`. This is the single place quota enforcement will read.

### Phase 3 migration `admin_launch`

```prisma
model EmailCampaign { id, subject, bodyText, bodyHtml, audience Json?, status (DRAFT|SENDING|SENT|FAILED),
                      total Int, sent Int, failed Int, createdById, startedAt?, finishedAt? }
model EmailSuppression { email @id, reason, createdAt }     // unsubscribes + bounces
model JobRun { id, name, status, startedAt, finishedAt?, summary Json?, error? }
```

## 5. Server: the `admin` module

```
server/src/admin/
  admin.module.ts
  admin.guard.ts                  // reads req.user.record.platformRole; 403 FORBIDDEN below the required tier
  admin.decorators.ts             // @AdminOnly(min: PlatformRole = 'SUPPORT')
  audit/audit.interceptor.ts      // wraps every non-GET admin handler; writes audit_log
  audit/audit.service.ts          // record(actor, action, target, before, after, reason, req)
  audit/audit.controller.ts       // GET /admin/audit
  overview/overview.controller.ts // GET /admin/overview, GET /admin/timeseries
  overview/overview.service.ts    // raw SQL date_trunc buckets; 60 s in-memory cache
  users/admin-users.controller.ts
  users/admin-users.service.ts
  organizations/admin-orgs.controller.ts
  drawings/admin-drawings.controller.ts
  feedback/admin-feedback.controller.ts
  feedback/admin-feedback.service.ts
  billing/admin-billing.controller.ts
  flags/flag-registry.ts          // typed FLAGS const with defaults
  flags/flags.service.ts          // effective flags, cache, invalidate on write
  flags/flags.controller.ts       // GET /flags (public) + admin PUT
  announcements/…
  staff/staff.controller.ts       // list/promote/demote; OWNER only
  system/system.controller.ts     // build sha, uptime, db latency, storage HEAD, mail/billing/auth mode
  dto/*.dto.ts
```

Also touched outside the module:

* `server/src/auth/supabase-auth.guard.ts` — after `ensureLocalUser`: 403 `USER_SUSPENDED` when `suspendedAt` is set (same pattern as `USER_DELETED`); touch `lastSeenAt` if older than an hour.
* `server/src/users/users.service.ts` — `ensureLocalUser` refuses to **create** a row when `signups.enabled` is false (403 `SIGNUPS_CLOSED`, existing users unaffected); applies `ADMIN_BOOTSTRAP_EMAILS`.
* `server/src/users/dto/me.dto.ts`, `users.mapper.ts` — add `platformRole` to `MeUserDto`.
* `server/src/billing/billing.service.ts` — `effectivePlan()` honours the override (Phase 2).
* `server/src/mail/templates/email.templates.ts` — `feedbackReply`, `staffInvited`, `accountSuspended`.
* `server/src/config/env.schema.ts` — `ADMIN_BOOTSTRAP_EMAILS?`, `ADMIN_RATE_LIMIT_LIMIT` (default 120), `APP_VERSION?` (commit SHA, set by the Docker build arg in `deploy/azure/Dockerfile.*`).
* `server/src/app.module.ts` — register `AdminModule`; the throttler gets a named `admin` limiter.

### Endpoint inventory

All under `/api/v1/admin`, all behind `AdminGuard`; minimum tier in brackets. Every non-GET writes `audit_log`.

**Overview** `GET /overview` [SUPPORT] — users total / new 7d / new 30d; DAU, WAU, MAU from `lastSeenAt`; drawings total / created 7d; versions saved 7d; storage bytes; feedback open by status; subscriptions by plan and status; webhook failures 7d; db ping ms; storage reachable. `GET /timeseries?metric=signups|active|drawings|feedback&days=30` [SUPPORT].

**Users** `GET /users?q=&plan=&role=&status=active|suspended|deleted&sort=&cursor=` [SUPPORT] · `GET /users/:id` [SUPPORT] (profile, preferences, usage, orgs, subscription, last 20 drawings metadata, feedback, audit trail) · `PATCH /users/:id` [ADMIN] (name fix, email correction) · `POST /users/:id/suspend {reason}` / `POST /users/:id/unsuspend` [ADMIN] · `POST /users/:id/delete {reason}` [ADMIN] (soft delete now, storage purge job later) · `POST /users/:id/plan-override {plan, until?, reason}` and `DELETE` [ADMIN] (Phase 2) · `POST /users/:id/notify {title, body, linkUrl?, email?: boolean}` [SUPPORT] · `GET /users/:id/export` [ADMIN] (Phase 2, JSON of everything we hold, for data-subject requests) · `POST /users/:id/billing/refresh` [ADMIN] (reuses `BillingService.reconcile`).

**Staff** `GET /staff` [ADMIN] · `PUT /staff/:userId {role}` [OWNER] (cannot target self; cannot demote the last OWNER).

**Organizations** `GET /organizations?q=&cursor=` · `GET /organizations/:id` (members, invites, drawing count, storage) [SUPPORT] · `PATCH /organizations/:id {name, slug}` · `POST /organizations/:id/transfer-ownership {userId}` · `POST /organizations/:id/regenerate-join-code` [ADMIN] (Phase 2).

**Drawings** `GET /drawings?ownerId=&orgId=&deleted=&minBytes=&cursor=` · `GET /drawings/:id` (metadata + versions) [SUPPORT] · `POST /drawings/:id/restore` · `POST /drawings/:id/purge` [ADMIN] · `GET /storage/orphans` (keys in the bucket with no row, and rows with no object) · `POST /storage/orphans/purge` [OWNER] (Phase 2). `GET /drawings/:id/download` [OWNER, flag `drawings.adminDownload`, audited] exists for support and is off by default.

**Feedback** `GET /feedback?status=&kind=&q=&appVersion=&cursor=` · `GET /feedback/:id` [SUPPORT] · `PATCH /feedback/:id {status, assigneeId, internalNote}` [SUPPORT] · `POST /feedback/:id/reply {subject, body}` [SUPPORT] (sends through `MailService` to `feedback.email ?? user.email`, sets `repliedAt`) · `GET /feedback/export.csv` [SUPPORT].

**Flags & settings** `GET /flags` — **public**, `@OptionalAuth`, returns the effective map for the client · `GET /admin/flags` [SUPPORT] · `PUT /admin/flags/:key {enabled, payload?}` [ADMIN].

Initial registry:

| Key | Default | Effect |
|---|---|---|
| `signups.enabled` | true | `ensureLocalUser` refuses new rows; sign-up page shows "beta is full" |
| `ai.enabled` | true | AI panel hidden / disabled in the editor |
| `uploads.enabled` | true | presign/import return 503 `FEATURE_DISABLED`; upload buttons hidden |
| `uploads.maxBytes` | env value | overrides `MAX_UPLOAD_BYTES` downward only |
| `dwg.storage.enabled` | true | DWG upload/store toggle |
| `maintenance.banner` | off, payload `{text, level}` | banner across site, dashboard and editor |
| `billing.checkout.enabled` | true | pricing CTAs fall back to "contact us" |
| `drawings.adminDownload` | false | see Drawings |

**Announcements** `GET /announcements/active` — for signed-in users (non-admin route, in `AnnouncementsController`) · admin CRUD `GET/POST/PATCH/DELETE /admin/announcements` [ADMIN] · `POST /admin/announcements/:id/publish` [ADMIN] — sets `publishedAt`; when `pushToInbox`, inserts `notifications` rows in batches of 500 (Phase 2).

**Billing** (Phase 3, OWNER unless noted) `GET /billing/subscriptions?plan=&status=&cursor=` [SUPPORT read] · `GET /billing/webhooks?status=failed|unprocessed&cursor=` · `POST /billing/webhooks/:id/replay` · `GET /billing/catalog` (mode test/live, sellable tiers) · `GET /billing/mrr` (computed from active subs × display price, marked approximate).

**Audit** `GET /audit?actorId=&targetType=&targetId=&action=&from=&to=&cursor=` [ADMIN].

**System** `GET /system` [SUPPORT] — `APP_VERSION`, node version, uptime, `NODE_ENV`, auth mode (JWKS / HS256), mail transport (resend / log), billing mode (off / test / live), sellable tiers, rate-limit config, db ping ms, storage HEAD ok, keepalive interval. `GET /system/jobs` and `POST /system/jobs/:name/run` (Phase 3).

### Guard and interceptor behaviour

* `AdminGuard` runs after `SupabaseAuthGuard` (route-level `@UseGuards`), reads `req.user.record.platformRole`, compares against the `@AdminOnly(min)` metadata using a rank table, throws `ApiException(403, 'FORBIDDEN', …, { required, actual })` — the same shape `access.ts` already uses.
* `AuditInterceptor` is applied at controller level in the admin module. It captures `before` from a per-handler `@Audited({ action, target: (req) => … , snapshot: (svc, id) => … })` descriptor and `after` from the handler result, then writes one row. A failed handler writes nothing.
* Admin routes get `@Throttle({ admin: { limit: ADMIN_RATE_LIMIT_LIMIT, ttl: 60_000 } })`.
* Pino gets `admin: true` on these requests so they can be filtered in Azure logs.

## 6. Frontend: `src/app/features/admin/`

```
admin-shell.component.ts/.html/.scss      // grid layout copied from dashboard-shell; rail + top bar
admin.guards.ts                           // adminGuard: me.user.platformRole !== 'user' else /dashboard
pages/overview.page.ts                    // stat tiles + 30-day sparklines
pages/users.page.ts, user-detail.page.ts
pages/feedback.page.ts, feedback-detail.page.ts
pages/flags.page.ts
pages/announcements.page.ts
pages/audit.page.ts
pages/system.page.ts
pages/staff.page.ts
pages/organizations.page.ts, organization-detail.page.ts   // Phase 2
pages/drawings.page.ts, storage.page.ts                    // Phase 2
pages/billing.page.ts, webhooks.page.ts, campaigns.page.ts // Phase 3
components/filter-bar.component.ts        // search + selects, state in query params
components/suspend-dialog.component.ts    // reason required
components/reply-dialog.component.ts
components/plan-override-dialog.component.ts
components/announcement-editor.component.ts
```

Routes (in `app.routes.ts`, one lazy `loadComponent` per page, under a `admin` parent with `canActivate: [authGuard, onboardingGuard, adminGuard]`, `data: { preload: false }`). Titles are translation keys under `admin.title.*`.

Shared additions in `src/app/shared/ui/` (each with a spec, each exported from the barrel):

* `UiTableComponent` — column defs, sortable headers, sticky header, row template outlet, skeleton and empty states, `PAGE_SIZES` paginator hook. Built from the CSS-grid approach `drawings.page.ts` already uses.
* `UiBadgeComponent` — tone `neutral | info | success | warning | danger`, used for status, plan and role chips.
* `UiTabsComponent` — promote `features/site/components/tabs.component.ts` to shared.
* `UiStatTileComponent` — label, value, delta, optional inline SVG sparkline. No chart library (CSP is `script-src 'self'`).
* `UiBannerComponent` — for the maintenance banner and announcements; mounted in `App` so it shows on every route.

App-wide additions:

* `src/app/core/api/admin-api.service.ts` — one promise method per endpoint, JSDoc naming the route (same shape as `organizations-api.service.ts`).
* `src/app/core/api/api.models.ts` — `PlatformRole`, `MeUserDto.platformRole`, admin DTOs.
* `src/app/core/flags/flags.service.ts` — loads `GET /flags` once after auth resolves, exposes `flag(key)` signals; `ai.enabled` consumed by the AI panel, `uploads.enabled` by the upload menu, `signups.enabled` by the sign-up page, `maintenance.banner` by `UiBannerComponent`.
* Account menu (`account-button.component.ts`) — "Admin portal" item when `platformRole !== 'user'`.
* Suspended and sign-ups-closed states — the interceptor maps `USER_SUSPENDED` and `SIGNUPS_CLOSED` to a full-page notice instead of the generic 401 redirect loop.

i18n: new fragment `scripts/i18n/app-strings/admin.en.json` (namespace `admin`), run `npm run i18n`, commit the regenerated `public/i18n/en.json`. Other locales fall back to English.

## 7. Phases, deliverables, exit criteria

### Phase 0 — Foundation (2–3 days)

* Migration `admin_foundation` (section 4).
* `PlatformRole` in `MeDto`; `ADMIN_BOOTSTRAP_EMAILS`; `AdminGuard`, `@AdminOnly`, `AuditInterceptor`, empty `AdminModule`.
* `USER_SUSPENDED` and `lastSeenAt` in the auth guard.
* `/admin` route, `adminGuard`, shell with rail and an Overview stub; account menu link.
* Tests: guard spec (no token 401, USER 403 with `{required, actual}`, SUPPORT ok, suspended 403), `admin.e2e-spec.ts` skeleton minting an OWNER token with `test/support/jwt.ts`, `adminGuard` Karma spec.

Exit: a bootstrap owner can open `/admin`, everyone else gets bounced to `/dashboard` and receives 403 on the API.

### Phase 1 — Beta essentials (1.5–2 weeks). Ship before the invite email.

* Overview: stat tiles + signups/active/drawings/feedback sparklines.
* Users: list with search and filters, detail page, suspend/unsuspend with reason, soft delete, in-app notify.
* Feedback: list with status/kind/version filters, detail with context, status + assignee + internal note, email reply, CSV export. Dashboard feedback page shows "replied" to the user.
* Flags & settings: registry, table, `GET /flags`, `FlagsService`, consumers for `ai.enabled`, `uploads.enabled`, `signups.enabled`, `maintenance.banner`.
* Announcements: create, schedule, banner display (inbox push comes in Phase 2).
* Audit log page with filters.
* System page.
* Staff page (list + promote/demote, OWNER only).
* `UiTable`, `UiBadge`, `UiTabs`, `UiStatTile`, `UiBanner` with specs.
* Docs: `docs/ADMIN.md` (bootstrap, roles, flags, runbooks for "suspend an account", "close sign-ups", "answer feedback"), CHANGELOG entry.

Exit: all CI gates green (`verify` skill); a SUPPORT user can triage and reply to feedback without touching Prisma Studio; an ADMIN can suspend an account and the API rejects that account within one request.

### Phase 2 — Beta operations (1–2 weeks, during the beta)

* Migration `admin_operations` (plan override).
* Plan override on the user page; `effectivePlan()` honours it; dashboard billing pane shows "Complimentary Pro until …".
* Organizations: list, detail, rename, transfer ownership, regenerate join code.
* Drawings: metadata list, restore, purge; storage orphan report and purge.
* Announcements push to inbox in batches.
* Timeseries with range selector; user export JSON.
* Sentry: link from the user detail page to Sentry search by `userId` (Sentry DSN is wired but empty today; set `sentryDsn` in `environment.prod.ts` as part of this phase).

Exit: every account, org and drawing question from beta users can be answered and acted on from the portal.

### Phase 3 — Main launch (2–3 weeks)

* Migration `admin_launch` (campaigns, suppression, job runs).
* Billing console: subscriptions, failed/unprocessed webhooks with replay, catalog and mode, approximate MRR. Owner-only plan enforcement switch `billing.enforceQuotas` and the quota hooks in drawings/uploads reading `effectivePlan()` (Free: 3 drawings / 50 MB as advertised).
* Email campaigns: audience preview, test send, chunked sending (Resend rate limits), suppression list honoured, unsubscribe link and `EmailSuppression` write on the public endpoint.
* Staff hardening: require Supabase MFA (`aal2` claim) for ADMIN and OWNER routes; optional IP allowlist env; session listing.
* Scheduled jobs page: trash purge after 30 days, staging-upload purge, version cap enforcement, orphan sweep, webhook replay; a `JobRunner` triggered by a Container Apps cron job hitting `POST /admin/system/jobs/:name/run` with a job token, with `JobRun` history.
* Alerts: email to OWNERs when webhook failures exceed a threshold, storage crosses a threshold, or sign-ups spike (abuse signal).
* Rate-limit and abuse view: top IPs / users by request count over the last hour (from pino → Azure Log Analytics query, or an in-memory ring buffer for the current replica).

Exit: the team can run billing, support and housekeeping for paying customers without shell access to production.

## 8. Testing and quality gates

* Server unit (`jest-mock-extended`): `admin.guard.spec.ts`, `audit.interceptor.spec.ts`, `flags.service.spec.ts` (defaults, override, cache invalidation), `admin-users.service.spec.ts` (self-target refusal, last-owner refusal), `overview.service.spec.ts` (bucket math), `billing.service.spec.ts` additions for overrides.
* Server e2e (`server/test/admin.e2e-spec.ts`): real guard with minted USER / SUPPORT / ADMIN / OWNER tokens; 403 shapes; suspend then request as the suspended user; flag write invalidates `GET /flags`; audit row written per mutation; sign-ups closed refuses a brand-new `authId` and admits an existing one.
* Karma: `adminGuard`, `admin-shell` nav rendering per role, `users.page` with a stubbed `AdminApiService`, `flags.page`, `UiTable`/`UiBadge`/`UiStatTile` specs. Use `provideI18nTesting()` so assertions read the English text.
* Gates: `npm run typecheck`, `npm run i18n` + en.json drift check, `npm run build` zero warnings, `npm run test:ci`, server `npm run typecheck && npm test && npm run test:e2e` — the `verify` skill runs them the CI way.

## 9. Security checklist

* Authorization is enforced only in `AdminGuard`; the client guard is UX.
* Tier ranks: SUPPORT < ADMIN < OWNER; every endpoint declares its minimum.
* Actors cannot change their own role or suspend themselves; the last OWNER cannot be demoted or deleted.
* Destructive actions require a typed reason; the reason is stored in `audit_log` and, for suspension, sent to the user.
* No user drawing content is readable by staff unless `drawings.adminDownload` is on, the actor is OWNER, and the download is audited.
* Admin requests are rate-limited separately and tagged in logs.
* Suspension and sign-up closure are enforced in the API guard, so they take effect on the next request regardless of the Supabase session.
* `GET /flags` never returns `payload` for flags marked `internal` in the registry.
* Phase 3: MFA (`aal2`) required for ADMIN/OWNER; consider an IP allowlist via env.
* Stale Clerk hosts in `nginx.security-headers.conf` CSP should be removed while touching headers (no functional impact on the portal, but it is the right time).

## 10. Effort and sequencing

| Phase | Calendar | Depends on |
|---|---|---|
| 0 Foundation | 2–3 days | nothing |
| 1 Beta essentials | 1.5–2 weeks | Phase 0 |
| 2 Beta operations | 1–2 weeks | Phase 1; can overlap with the live beta |
| 3 Main launch | 2–3 weeks | Phase 2; Dodo live keys; Resend domain verified |

Single engineer, roughly six to eight weeks end to end; Phases 0 and 1 are the beta-blocking part.

## 11. Assumptions and open points

* **Same-SPA `/admin` route.** If a separate host (e.g. `admin.cado.website`) is preferred for optics or IP-allowlisting, the API design stays identical; the UI would move to a second Angular project and Container App in Phase 3.
* **Staff download of drawings is off by default.** If the team wants support staff to open user drawings routinely, that changes the privacy story and should be decided before the invite email.
* **Admin UI is English-only** until someone assigns translation work; the fallback handler makes this safe.
* **AI usage is invisible to the server** because keys are the user's own and calls go browser → provider. If usage numbers matter for the launch, add an opt-in beacon (`POST /telemetry/ai {provider, model, tokens}`) behind a flag in Phase 3; nothing about prompts or drawings is sent.
* **Bulk email** waits for Phase 3; the beta announcement is sent by hand from a personal address, as `beta-invite-email.md` already says.
