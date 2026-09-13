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

### Triage the beta's feedback

Feedback → the queue opens on **Open**, which is everything not yet resolved.
Filter by kind, by build (click a version on any row to see everything else
broken in that build), or search the message and sender.

On a report: set a status, take it with **Take it**, and leave an internal note.
Each saves on its own, so two people working the queue cannot overwrite each
other's field. The note is staff-only — it is never returned by any user-facing
route and never appears in the CSV export.

**Replying** emails the sender from the address on their account, or the one
they typed if they were signed out. Replies come back to *you*, not a no-reply
address, because Reply-To is set to the staff member who wrote. A report sent
anonymously with no address says so instead of offering a form that cannot send.
A reply moves a `new` report to `triaged`, and `repliedAt` is only recorded when
the send actually succeeded — "replied" on the list means a message left the
building.

The submitter sees only that it was answered and whether it is closed. The
triage vocabulary stays internal: `wont_fix` is a fine thing for staff to record
and a poor thing to show the person who reported it.

### Grant someone a plan

Users → open the account → **Grant a plan**. Pick pro or team, a number of days
(or blank for no expiry), and a reason. The grant is stored in its own columns,
never by writing the plan Dodo projects, so the next webhook cannot silently
revoke it — and revoking the grant leaves any real subscription untouched.

`BillingService.effectivePlan()` takes the better of the bought plan and an
unexpired grant, so a complimentary Pro never downgrades a paying Team customer.
The user's billing pane says "Complimentary Pro until …"; the reason staff typed
is internal and is not sent to them.

### Fix an organization nobody inside it can fix

Organizations → expand a row. Two operations exist, because they are the two
its own members cannot perform: **Rename**, and **Transfer ownership** when the
only owner has left and nobody remaining can promote anyone (promoting to owner
is itself owner-only). The transfer demotes the previous owner to admin rather
than removing them, and both writes go in one transaction so the organization is
never momentarily ownerless. The slug is deliberately left alone on a rename —
it is in the join links members already hold.

Staff are never added as members. Putting ourselves inside somebody's workspace
to "have a look" would put us inside their drawings.

### Announce something

Announcements → write it, save the draft, read it back, then **Publish**. Two
steps on purpose: nothing is shown to anyone until the publish, which is the
single deliberate act. Published announcements show as a banner to every
signed-in user; dismissals are per browser.

Ticking **also put it in everyone's inbox** fans a notification out to every
active account in batches when you publish. That cannot be recalled, which is
why a second publish is refused rather than being a quiet no-op. Suspended and
deleted accounts are skipped.

### Find a drawing, or work out where storage went

Drawings lists every drawing as metadata: name, owner, workspace, size, version
and whether it is in the trash. There is no way to open one — what is inside a
customer's drawing is theirs. **Restore** lifts a drawing out of the trash;
**Purge** deletes the row and its files permanently and needs a reason.

**Scan storage** (owner only) compares the bucket with the database both ways.
An object with no row is garbage costing money, and can be swept. A row with no
object is the more serious direction: that drawing will fail to open for its
owner, and no sweep fixes it. The scan is capped and says so when it hits the
cap, so a partial answer is never mistaken for a clean bill of health.

### Answer a data-subject request

Users → open the account → **Export data**. Downloads JSON of everything we hold:
profile, preferences, subscription, organizations, drawing and folder metadata,
their own feedback, and their notifications. Drawing *content* is excluded — it
is their file and they already have it, and streaming it through a support
endpoint would turn a records request into an exfiltration path. Staff notes
(the internal note on a report, the staff tier) are excluded too: those are our
records about them, not their data.

The export is audited despite being a read, which is the one exception the
module makes to "reads are not recorded".

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

The billing console (subscriptions, webhook replay, MRR), email campaigns,
staff MFA, and scheduled housekeeping jobs — all Phase 3. See
[ADMIN-PORTAL-PLAN.md](ADMIN-PORTAL-PLAN.md).
