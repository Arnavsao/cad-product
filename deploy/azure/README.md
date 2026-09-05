# Azure deployment (Container Apps)

Both halves of CADO run as Container Apps in one environment; Postgres (Neon)
and object storage (Cloudflare R2) stay where they are.

| Component | Choice | Monthly |
|---|---|---|
| Angular frontend | Container App (nginx), scale-to-zero | $0–2 |
| API | Container App (NestJS), scale-to-zero | $0–2 |
| Images | ghcr.io | $0 |
| Database | Neon (unchanged) | free tier |
| File storage | Cloudflare R2 (unchanged) | free tier |
| Monitoring | Container Apps logs disabled | $0 |

Roughly **$0–3/month** at low traffic: Container Apps' monthly free grant
(180k vCPU-s, 360k GiB-s, 2M requests) covers a small workload, and apps idling
at zero replicas consume none of it.

## Why not Static Web Apps

The original plan used Azure Static Web Apps Free for the frontend. It cannot
work on this subscription:

- `Azure for Students` carries an **"Allowed resource deployment regions"**
  policy limiting deployments to `uaenorth, centralindia, indiasouthcentral,
  malaysiawest, koreacentral`.
- Static Web Apps exists only in `centralus, eastus2, westus2, westeurope,
  eastasia`.

Zero overlap, in any tier. Container Apps environments are *also* quota-capped
in `centralindia` on this subscription, which is why the region is
**koreacentral**.

The upside: nginx fronts the API, so `/api/` is same-origin and CORS never
enters the picture — the arrangement `docker-compose.prod.yml` already uses.

## Topology

```
   Browser
     │  https (TLS terminated by Container Apps ingress)
     ▼
  ┌──────────────────────┐  external ingress :80
  │ cado-web             │  nginx + Angular build
  │ nginx:1.27-alpine    │
  └──────────┬───────────┘
             │  location ^~ /api/  →  proxy_pass ${API_ORIGIN}
             ▼
  ┌──────────────────────┐  INTERNAL ingress :3000
  │ cado-api             │  NestJS + Prisma
  └──────────┬───────────┘
             │
     ┌───────┴────────┐
     ▼                ▼
  Neon Postgres    Cloudflare R2
```

Only `cado-web` is publicly reachable. The API has internal ingress: routable
only from inside the environment, i.e. through nginx.

## Why the nginx config is templated

In compose the API is the service `api`, so `proxy_pass http://api:3000` is a
constant. Container Apps assigns each app an FQDN at creation time, unknowable
at image build time — baking it in would mean rebuilding to move environments.
`${API_ORIGIN}` is substituted at container start by `docker-entrypoint.sh`.

The root `nginx.conf` / `nginx.common.conf` are **untouched**; compose still
works. The Azure variants live here, differing in three forced ways:

| | compose | Azure |
|---|---|---|
| upstream | `http://api:3000` | `${API_ORIGIN}` — https, runtime-resolved via Azure DNS |
| `X-Forwarded-Proto` | `$scheme` | `$forwarded_proto` — ingress already terminated TLS, so `$scheme` is always `http` |
| ACME challenge | present | removed — ingress provides the certificate |

## First-time setup

### 1. Provision Azure resources

```bash
az login
DRY_RUN=1 ENV_FILE=~/cado-prod.env ./deploy/azure/provision.sh   # preview
ENV_FILE=~/cado-prod.env ./deploy/azure/provision.sh             # create
```

Idempotent — every step is create-if-absent, safe to re-run.

`ENV_FILE` must hold **production** values; the script refuses a localhost
`DATABASE_URL` and warns on a localhost `S3_ENDPOINT`. Keeping it outside the
repo (e.g. `~/cado-prod.env`, chmod 600) keeps credentials uncommitted.

**Chicken-and-egg:** Container Apps validates the image at creation and rejects
a tag that does not exist, so the first `provision.sh` run fails at the app
creation step until the images are pushed (step 3). Run it again afterwards.

### 2. Azure OIDC for GitHub Actions

Lets the workflow authenticate with no stored password:

```bash
SUB=$(az account show --query id -o tsv)
APP_ID=$(az ad app create --display-name cado-github-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID"
az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope "/subscriptions/$SUB/resourceGroups/cado-prod-rg"

az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:Arnavsao/cad-product:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'

echo "AZURE_CLIENT_ID=$APP_ID"
echo "AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID=$SUB"
```

Add those three as repo secrets (Settings → Secrets and variables → Actions).
The `subject` must match the branch exactly — a mismatch fails login with a
generic error. To deploy from another branch, add a second credential with that
branch in `subject`.

### 3. First build

Actions → **Deploy** → Run workflow. It builds both images to ghcr.io and
updates the Container Apps.

The first run's *deploy* job fails if the apps do not exist yet — that is the
chicken-and-egg above. Once the images are pushed, re-run `provision.sh` to
create the apps, and every later deploy works in one pass.

### 4. Make the ghcr.io packages readable

The first push creates both packages as **private**, and the apps are
configured with no registry credentials, so pulls fail until either:

- **Make them public** (simplest): github.com/users/Arnavsao/packages →
  `cad-product-api` and `cad-product-web` → Package settings → Change
  visibility → Public. The images hold no secrets; all configuration is
  injected at runtime.
- **Or keep them private** and give each app a pull credential:
  ```bash
  for app in cado-api cado-web; do
    az containerapp registry set -g cado-prod-rg -n $app \
      --server ghcr.io --username Arnavsao \
      --password <PAT with read:packages>
  done
  ```

## Deploying

Actions → **Deploy** → Run workflow. (Or uncomment the `push` trigger in
`.github/workflows/deploy.yml` for deploy-on-merge.)

The workflow builds both images, updates both apps, then polls `/healthz` and
`/api/v1/healthz` until they answer. It only ever changes the image — env vars
and secrets belong to `provision.sh`, so a deploy cannot rewrite configuration.

## Cold starts

`--min-replicas 0` is what makes this nearly free; the cost is latency. The
first request after idle waits for a container start **plus**
`prisma migrate deploy`, which `start:prod` runs before listening. Budget
15–30s.

Options, increasing in cost:

- **Accept it** — fine for internal or low-traffic use.
- **Warm it** — ping `/healthz` every 5 min during business hours.
- **`--min-replicas 1`** on `cado-api` (~$15/mo): no cold start.
  ```bash
  az containerapp update -g cado-prod-rg -n cado-api --min-replicas 1
  ```

Moving migrations out of `start:prod` into a release step would remove most of
the penalty, but it changes how migrations are applied — deliberately not done.

## Monitoring

Created with `--logs-destination none`: no Log Analytics workspace, no
ingestion cost. Live logs still stream on demand:

```bash
az containerapp logs show -g cado-prod-rg -n cado-api --follow
```

Nothing is retained. To add persistent logs later (this starts billing):

```bash
az containerapp env update -g cado-prod-rg -n cado-env \
  --logs-destination log-analytics \
  --logs-workspace-id <id> --logs-workspace-key <key>
```

## Secrets

Read from `ENV_FILE` by `provision.sh`, stored as Container App secrets
(encrypted at rest), referenced as `secretref:`. Never printed — every `az`
call receiving one uses `--output none`.

Blank optional keys are **omitted**, not set to `""`, so the API's "billing
off" and "log mail instead of sending" defaults stay intact.

Rotate without a redeploy:

```bash
az containerapp secret set -g cado-prod-rg -n cado-api \
  --secrets database-url="postgresql://…" --output none
az containerapp revision restart -g cado-prod-rg -n cado-api \
  --revision "$(az containerapp revision list -g cado-prod-rg -n cado-api --query '[-1].name' -o tsv)"
```

## Custom domain

```bash
az containerapp hostname add -g cado-prod-rg -n cado-web --hostname app.example.com
az containerapp hostname bind -g cado-prod-rg -n cado-web --hostname app.example.com \
  --environment cado-env --validation-method CNAME
```

Container Apps issues and renews a managed certificate, so `DEPLOYMENT_TLS.md`
(certbot, `nginx.ssl.conf`) does **not** apply — that covers the bare-VM path.

After binding, update what depends on the origin:

```bash
az containerapp update -g cado-prod-rg -n cado-api \
  --set-env-vars CORS_ORIGIN=https://app.example.com APP_BASE_URL=https://app.example.com
```

## Manual follow-ups

Third-party dashboards this script cannot reach:

- **Supabase** → Auth → URL Configuration: add the web origin to Site URL and
  the redirect allowlist, or logins bounce to localhost.
- **Dodo** → Webhooks: `https://<web-fqdn>/api/v1/billing/webhook`.
- **R2 bucket CORS**: allow the web origin, or presigned uploads fail in the
  browser.
- **CSP**: `nginx.common.azure.conf.template` allows only Clerk's default
  `*.clerk.accounts.dev`. A custom Clerk domain must be added to `script-src`
  and `frame-src` or sign-in silently fails to load.

## Troubleshooting

**`DENIED: requested access to the resource is denied` on create/update** —
the ghcr.io package is private or not pushed yet. See step 4.

**502 from the web app** — nginx cannot reach the API. Check `API_ORIGIN`:
```bash
az containerapp show -g cado-prod-rg -n cado-web \
  --query "properties.template.containers[0].env[?name=='API_ORIGIN']"
```
It must be the API's **internal** FQDN with `https://` and no trailing slash.

**API exits at boot** — usually a missing required env var. The Zod schema
refuses to start on a bad value; the reason is in the logs:
```bash
az containerapp logs show -g cado-prod-rg -n cado-api --tail 100
```

**API 503 on authenticated routes** — `SUPABASE_URL` unset; the API answers
`AUTH_NOT_CONFIGURED` by design.

**First request times out** — cold start. Retry; see *Cold starts*.

**`RequestDisallowedByAzure`** — the region policy. Allowed:
`uaenorth, centralindia, indiasouthcentral, malaysiawest, koreacentral`.

## Teardown

```bash
az group delete --name cado-prod-rg --yes --no-wait
```

Removes both apps and the environment. Neon, R2 and the ghcr.io packages are
untouched.
