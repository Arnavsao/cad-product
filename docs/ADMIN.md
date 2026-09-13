# Admin portal

Staff-only operations console at `/admin`, backed by `/api/v1/admin/*`.
Phase 1 of [ADMIN-PORTAL-PLAN.md](ADMIN-PORTAL-PLAN.md).

## Creating the first staff account

There is no way to grant a staff tier through the portal until somebody can
already open it, so the first owner comes from the environment:

```bash
# server/.env
ADMIN_BOOTSTRAP_EMAILS=you@yourdomain.com,cofounder@yourdomain.com
```

Those accounts are promoted to `OWNER` on their **next authenticated request** —
they must already have signed up normally. After that, promote everyone else
from the Staff page and the variable can be emptied; it only ever raises a tier,
never lowers one, so a stale entry cannot claw back a decision an owner made.

## Tiers

| Tier | Can do |
|---|---|
| `USER` | Nothing. No admin surface at all. |
| `SUPPORT` | Read the portal: overview, users, flags, system. Triage feedback. Send a user an in-app message. |
| `ADMIN` | The above, plus suspend/unsuspend/delete accounts, flip flags, read the audit log. |
| `OWNER` | The above, plus manage staff tiers. |

`PlatformRole` is separate from `OrgRole` (which scopes one organization) and
from the profession captured at onboarding. It lives on `users.platform_role`.

**Two rules the server enforces and the UI only explains:** nobody can change
their own tier, and the last owner cannot be demoted. Without the second, an
install can end up with no way back in short of the environment variable.

## Feature flags

`GET /flags` is public and unauthenticated — the sign-up page has to know
whether registration is open before anyone has a session. The registry in
`server/src/admin/flags/flag-registry.ts` is the source of truth for which flags
exist and what they default to; the `feature_flags` table only records
deviations. An unknown key is a 404, not a create.

| Flag | Default | Effect when off |
|---|---|---|
| `signups.enabled` | on | A Supabase user with no local row is refused `403 SIGNUPS_CLOSED`. **Existing users are unaffected.** |
| `ai.enabled` | on | The editor refuses to open the AI panel. |
| `uploads.enabled` | on | Reserved for Phase 2 enforcement. |
| `dwg.storage.enabled` | on | Reserved for Phase 2 enforcement. |
| `uploads.maxBytes` | off | When on, its payload lowers the upload limit. |
| `maintenance.banner` | off | When on, its payload text becomes a site banner (Phase 2). |
| `billing.checkout.enabled` | on | Reserved for Phase 2 enforcement. |
| `drawings.adminDownload` | **off** | Staff cannot download user drawings. Leave it off. |

Changes reach every replica within a minute (60 s server-side cache; the writing
replica invalidates immediately).

## Runbooks

### Suspend an abusive account

Users → search → open → **Suspend**. A reason is required: it is stored in the
audit log and shown to the user on their next request, which returns
`403 USER_SUSPENDED`. No session revocation is needed — the check is in the auth
guard, so it bites regardless of how long their token has left.

Staff accounts cannot be suspended from the Users page (`403 TARGET_IS_STAFF`).
Demote them on the Staff page first.

### Close sign-ups

Feature flags → `signups.enabled` → **Turn off**. The sign-up page switches to an
explanation and the API refuses to provision new local users. Anyone who already
has an account keeps working normally. Reverse it with **Turn on**, or **Reset**
to drop the override entirely.

### Turn off the AI assistant

Feature flags → `ai.enabled` → **Turn off**. The editor's panel stops opening and
explains itself. Useful when a provider is down or a prompt bug is doing damage,
without a deploy.

### Answer "what happened to this account?"

Audit log → filter by action (`user.suspend`, `staff.setRole`, `flag.set`) and
expand a row for the before/after snapshot, the actor and their reason. Every
state-changing admin request writes exactly one row; a refused request writes
none.

### Check what production is actually configured to do

System page: build version, auth mode, whether mail is really sending or only
logging, whether billing is off/test/live, whether the webhook key is present,
storage reachability and database latency. It reports modes and booleans only —
no secret is ever returned.

## Privacy

Admin drawing views (Phase 2) are metadata only. Reading a user's drawing needs
`drawings.adminDownload` on, the actor to be an OWNER, and the download is
audited. It ships off, and should stay off unless there is a specific support
case and the user has asked for help.

## Environment

| Key | Default | Meaning |
|---|---|---|
| `ADMIN_BOOTSTRAP_EMAILS` | empty | Comma-separated emails promoted to OWNER on next request. |
| `ADMIN_RATE_LIMIT_LIMIT` | 120 | Per-IP requests/minute for `/admin`, in its own bucket. |
| `APP_VERSION` | `dev` | Shown on the System page. CI sets it to the commit SHA. |

## What is not built yet

Feedback triage, announcements, organizations, drawing/storage management, plan
overrides, the billing console, email campaigns and scheduled jobs are Phases 2
and 3 of the plan. The feedback triage columns exist in the schema
(`status`, `assignee_id`, `internal_note`, `replied_at`) but no endpoint writes
them yet.
