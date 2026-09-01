# Backups & Restore

CADOnline's durable state lives in two places: **Postgres** (drawing metadata,
versions, folders, users) and **object storage** (the actual drawing content —
DXF/JSON blobs above the inline-content threshold, thumbnails, uploads). Both
need a backup story; losing either loses user work.

## Postgres

### If you're on Neon (the documented production target)

Neon takes continuous backups automatically and supports **point-in-time
restore (PITR)** — no setup needed, but the retention window depends on your
plan:

- Check your plan's PITR window in the Neon console (Project → Settings →
  Backups). The free tier has a short window; paid tiers extend it.
- To restore: Neon console → Branches → "Restore" (or create a new branch at
  a point in time, verify it, then point `DATABASE_URL`/`DIRECT_DATABASE_URL`
  at it). This does not require taking the app down first — restore to a new
  branch, verify, then cut over.
- **Action item:** confirm your plan's PITR window actually covers your
  acceptable data-loss window (RPO). If it doesn't, either upgrade the plan or
  add the pg_dump cron below as a second line of defense.

### Self-hosted Postgres (docker-compose.yml, not the Neon path)

Neon's automatic backups don't apply here — you need your own. A simple daily
`pg_dump` cron, kept off the same host as the database:

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$DIRECT_DATABASE_URL" --format=custom --file="/backups/cad-${STAMP}.dump"
# Prune anything older than 30 days
find /backups -name 'cad-*.dump' -mtime +30 -delete
```

Run it via host cron or a sidecar container on a schedule (e.g. daily at a low-traffic hour), and ship `/backups` to
S3/R2/another host — a backup that lives next to the database it backs up doesn't survive the failure it's meant for.

Restore: `pg_restore --clean --if-exists -d "$DIRECT_DATABASE_URL" cad-<stamp>.dump`.

## Object storage (S3 / R2 / MinIO)

Drawing files and thumbnails live here (`S3_BUCKET`). Options, cheapest first:

1. **Bucket versioning** (AWS S3, Cloudflare R2, and MinIO all support it):
   protects against accidental overwrite/delete without a separate backup
   job. Enable it on the bucket and set a lifecycle rule to expire old
   versions after some window (e.g. 90 days) so storage cost doesn't grow
   unbounded.
2. **Cross-region/cross-bucket replication**, if the provider supports it, for
   protection against a regional outage or full bucket loss.
3. For self-hosted MinIO specifically: `mc mirror` on a schedule to a second
   MinIO instance or an S3-compatible target is the equivalent of (2).

## What's NOT covered by either of the above

`server/.env` itself (secrets, keys) is not backed up by design — it's
recreated from your secrets manager / deployment config, not restored from a
snapshot. Losing the database or bucket without also losing the ability to
reach them is the scenario this doc protects against; losing the secrets
needed to reach them is a secrets-management problem, not a backups one.

## Recommended minimum before launch

- [ ] Confirm Neon's PITR window meets your RPO (or set up the pg_dump cron if self-hosting Postgres).
- [ ] Enable bucket versioning on whatever S3/R2/MinIO bucket `S3_BUCKET` points at.
- [ ] Do one test restore of each (a Neon branch restore; a `pg_restore` from a dump) before you need it for real.
