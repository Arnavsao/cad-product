---
name: deploy-azure
description: Deploy, inspect, or troubleshoot CADO's production on Azure Container Apps (cado-prod-rg, koreacentral, cado-web + cado-api, cado.website) — the CI→Deploy workflow, ghcr.io images, provision.sh and out-of-repo secrets, nginx/CSP differences from ng serve, cold starts, custom domains, and the student-subscription region policy. Use when asked to deploy, roll back, read prod logs, rotate a secret, fix a 404/502/503 in production, or change nginx or the deploy pipeline.
---

# Production on Azure Container Apps

Runbook: `deploy/azure/README.md`. This skill is the short version plus the decisions already made. Read the runbook section before running any `az` command that mutates.

## Topology

| Piece | Name | Notes |
| --- | --- | --- |
| Resource group / env | `cado-prod-rg` / `cado-env` | region **koreacentral** |
| Web | `cado-web` | nginx + Angular build, public ingress, proxies `/api/` to the API |
| API | `cado-api` | NestJS, **public** ingress (see below), `prisma migrate deploy` on boot |
| Images | `ghcr.io/arnavsao/cad-product-web`, `-api` | public packages |
| Domain | https://cado.website, www | GoDaddy DNS, Azure-managed DigiCert certs |
| DB / files | Neon Postgres, Cloudflare R2 | external, unchanged |

Both apps scale to zero. First request after idle costs 15–30 s (container start + migrations).

## Decisions not to reopen

- **No Static Web Apps.** The `Azure for Students` subscription restricts regions to `uaenorth, centralindia, indiasouthcentral, malaysiawest, koreacentral`; SWA exists in none. Container Apps quota is capped in centralindia, hence koreacentral.
- **No internal ingress for the API** without a VNet. In a Consumption-only environment the `*.internal.*` FQDN resolves to the public IP and returns a 404. Making the API private means recreating the environment with `--infrastructure-subnet-resource-id`.
- **Every app needs an explicit HTTP scale rule** or it sits at zero replicas and ingress 404s.
- **Migrations stay in `start:prod`.** Moving them to a release step was considered and deliberately not done.

## How a deploy happens

Push to `main` → CI (`ci.yml`) → on success, `deploy.yml` builds both images (linux/amd64) to ghcr.io and runs `az containerapp update --image` on each app, then probes `/healthz` and `/api-healthz`. About 10 minutes. Manual redeploy: Actions → Deploy → Run workflow. The workflow **only changes the image**; env vars and secrets belong to `provision.sh`.

`/api-healthz` is an nginx location proxying to the API's bare `/healthz`, which is excluded from the `api/v1` prefix in `app.setup.ts`. `/api/v1/healthz` is a genuine 404.

## Secrets

Production values live **outside the repo** in `~/cado-prod.env` (chmod 600). `server/.env` is local development only. Provision or re-sync with:

```bash
DRY_RUN=1 ENV_FILE=~/cado-prod.env ./deploy/azure/provision.sh   # preview first
ENV_FILE=~/cado-prod.env ./deploy/azure/provision.sh
```

Rotate one secret without a redeploy: `az containerapp secret set … --output none` then restart the latest revision. Any credential that has appeared in a chat transcript, log, or commit must be rotated; check with the user whether a pending rotation is still outstanding before touching Neon or R2 settings.

Never echo secret values. Every `az` call that receives one uses `--output none`.

## CSP: production differs from `ng serve`

nginx sends a `Content-Security-Policy` with no `'unsafe-inline'`; `ng serve` sends none. Inline scripts and `onload` handlers work locally and are silently dropped in prod. Already bitten twice:

- `inlineCritical` **must stay `false`** in `angular.json`, or the main stylesheet is emitted with an `onload` swap that CSP blocks and the page renders half-styled.
- No inline `<script>` in `index.html`; boot code goes in `public/theme-init.js` / `public/theme-apply.js` style files.
- Allow-list any new external origin (Supabase project URL in `connect-src`) in `nginx.common.conf` **and** `deploy/azure/nginx.common.azure.conf.template`.

Reproduce prod locally with the real image (see the run-app skill) and look for `Refused to …` in the console.

## Reading production

```bash
az containerapp logs show -g cado-prod-rg -n cado-api --tail 100      # or --follow
az containerapp show -g cado-prod-rg -n cado-web --query "properties.template.containers[0].env[?name=='API_ORIGIN']"
az containerapp revision list -g cado-prod-rg -n cado-api -o table
```

Logs are not retained (`--logs-destination none`), so capture what you need while it streams.

## Symptom → cause

- **404 "Container App is stopped or does not exist"**: missing HTTP scale rule, or an `*.internal.*` FQDN.
- **502 from web**: `API_ORIGIN` wrong. Must be `https://<api-fqdn>` with no trailing slash.
- **API exits at boot**: Zod env validation; the log names the key.
- **503 AUTH_NOT_CONFIGURED**: `SUPABASE_URL` unset.
- **DENIED on image pull**: ghcr.io package private.
- **RequestDisallowedByAzure**: region policy.
- **Custom domain validation fails silently**: trailing whitespace in the `asuid` TXT record; confirm with `dig +short TXT asuid.<domain>`.

## Rolling back

Redeploy a previous SHA: `az containerapp update -g cado-prod-rg -n cado-<app> --image ghcr.io/arnavsao/cad-product-<app>:<sha> --output none`. Confirm with the user before running it; it is outward-facing.
