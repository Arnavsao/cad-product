#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Provision Azure infrastructure for CADO.
#
#   Frontend  Azure Static Web Apps (Free)     — deployed by GitHub Actions
#   API       Azure Container Apps (Consumption, scale-to-zero)
#   Images    ghcr.io (free)                   — built by GitHub Actions
#   Database  Neon        (unchanged, external)
#   Storage   R2 / S3     (unchanged, external)
#
# This script creates the Azure resources and wires their configuration. It
# does NOT build images: those come from GitHub Actions and ghcr.io, so a
# Docker daemon is not required here.
#
# Idempotent — every step is create-if-absent, so re-running after a failure
# resumes rather than duplicating.
#
#   DRY_RUN=1 ./provision.sh    # show what it would do, create nothing
#   ./provision.sh              # provision
# ---------------------------------------------------------------------------
set -euo pipefail

# --- settings ---------------------------------------------------------------
LOCATION="${LOCATION:-koreacentral}"
# NOTE on regions: this subscription carries an "Allowed resource deployment
# regions" policy (uaenorth, centralindia, indiasouthcentral, malaysiawest,
# koreacentral). Azure Static Web Apps exists in none of them, which is why the
# frontend is an nginx Container App rather than a Static Web App. Container
# Apps environments are additionally quota-capped in centralindia on this
# subscription, so koreacentral is the working region.
RESOURCE_GROUP="${RESOURCE_GROUP:-cado-prod-rg}"
ENV_NAME="${ENV_NAME:-cado-env}"
API_APP="${API_APP:-cado-api}"
WEB_APP="${WEB_APP:-cado-web}"
DRY_RUN="${DRY_RUN:-0}"

# ghcr.io image to deploy. Defaults to this repo's origin, lowercased —
# container registries reject uppercase path segments.
GHCR_API_IMAGE="${GHCR_API_IMAGE:-}"
GHCR_WEB_IMAGE="${GHCR_WEB_IMAGE:-}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/server/.env}"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY_RUN" = "1" ]; then printf '   [dry-run] %s\n' "$*"; else "$@"; fi; }

# --- preflight --------------------------------------------------------------
command -v az >/dev/null || die "azure-cli not found. brew install azure-cli"
az account show >/dev/null 2>&1 || die "Not logged in. Run: az login"

SUB_NAME=$(az account show --query name -o tsv)
say "Subscription: $SUB_NAME"
say "Region:       $LOCATION"

[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE — needed for DATABASE_URL and S3 credentials."

if [ -z "$GHCR_API_IMAGE" ] || [ -z "$GHCR_WEB_IMAGE" ]; then
  origin=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)
  slug=$(printf '%s' "$origin" | sed -E 's#^.*github\.com[:/]##; s#\.git$##' | tr '[:upper:]' '[:lower:]')
  [ -n "$slug" ] || die "Set GHCR_API_IMAGE / GHCR_WEB_IMAGE (no git origin to infer them from)."
  [ -n "$GHCR_API_IMAGE" ] || GHCR_API_IMAGE="ghcr.io/${slug}-api"
  [ -n "$GHCR_WEB_IMAGE" ] || GHCR_WEB_IMAGE="ghcr.io/${slug}-web"
fi
say "API image:    ${GHCR_API_IMAGE}:${IMAGE_TAG}"
say "Web image:    ${GHCR_WEB_IMAGE}:${IMAGE_TAG}"

# --- read secrets from server/.env -----------------------------------------
# Values are read but never echoed; every `az` call receiving one uses
# --output none so nothing reaches the terminal or a CI log.
get_env() {
  sed -n "s/^${1}=//p" "$ENV_FILE" | tail -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

DATABASE_URL=$(get_env DATABASE_URL)
DIRECT_DATABASE_URL=$(get_env DIRECT_DATABASE_URL)
SUPABASE_URL=$(get_env SUPABASE_URL)
SUPABASE_JWT_SECRET=$(get_env SUPABASE_JWT_SECRET)
S3_ENDPOINT=$(get_env S3_ENDPOINT)
S3_PUBLIC_ENDPOINT=$(get_env S3_PUBLIC_ENDPOINT)
S3_REGION=$(get_env S3_REGION)
S3_BUCKET=$(get_env S3_BUCKET)
S3_ACCESS_KEY=$(get_env S3_ACCESS_KEY)
S3_SECRET_KEY=$(get_env S3_SECRET_KEY)
S3_FORCE_PATH_STYLE=$(get_env S3_FORCE_PATH_STYLE)
RESEND_API_KEY=$(get_env RESEND_API_KEY)
MAIL_FROM=$(get_env MAIL_FROM)
MAIL_REPLY_TO=$(get_env MAIL_REPLY_TO)
DODO_API_KEY=$(get_env DODO_API_KEY)
DODO_WEBHOOK_KEY=$(get_env DODO_WEBHOOK_KEY)

# Fail before deploying a container that would crash-loop on Zod validation.
[ -n "$DATABASE_URL" ] || die "DATABASE_URL is empty in $ENV_FILE"
[ -n "$DIRECT_DATABASE_URL" ] || DIRECT_DATABASE_URL="$DATABASE_URL"
[ -n "$S3_ENDPOINT" ]  || die "S3_ENDPOINT is empty in $ENV_FILE (required by the env schema)"
[ -n "$S3_BUCKET" ]    || die "S3_BUCKET is empty in $ENV_FILE"
[ -n "$S3_ACCESS_KEY" ] || die "S3_ACCESS_KEY is empty in $ENV_FILE"
[ -n "$S3_SECRET_KEY" ] || die "S3_SECRET_KEY is empty in $ENV_FILE"

# Catch an unfilled template before it becomes a crash-looping revision: the
# placeholders are valid-looking strings, so nothing downstream would reject
# them until the container failed to connect.
for _var in DATABASE_URL DIRECT_DATABASE_URL S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY \
            SUPABASE_URL SUPABASE_JWT_SECRET RESEND_API_KEY DODO_API_KEY; do
  case "$(eval printf '%s' "\"\${$_var}\"")" in
    *CHANGEME*) die "$_var is still a CHANGEME placeholder in $ENV_FILE — fill it in first." ;;
  esac
done

case "$DATABASE_URL" in
  *localhost*|*127.0.0.1*)
    die "DATABASE_URL points at localhost — unreachable from Azure. Put your Neon
    connection string in $ENV_FILE, or use ENV_FILE=/path/to/prod.env" ;;
esac
case "$S3_ENDPOINT" in
  *localhost*|*127.0.0.1*)
    warn "S3_ENDPOINT points at localhost (MinIO) — uploads will fail from Azure." ;;
esac
[ -n "$SUPABASE_URL" ] || warn "SUPABASE_URL empty — authenticated routes will answer 503."

# --- resource group ---------------------------------------------------------
if [ "$(az group exists --name "$RESOURCE_GROUP")" = "true" ]; then
  say "Resource group $RESOURCE_GROUP exists — reusing."
else
  say "Creating resource group $RESOURCE_GROUP"
  run az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
fi

# --- providers + extension --------------------------------------------------
say "Ensuring containerapp extension and resource providers"
run az extension add --name containerapp --upgrade --only-show-errors --yes >/dev/null 2>&1 || true
run az provider register --namespace Microsoft.App --wait
run az provider register --namespace Microsoft.OperationalInsights --wait

# ---------------------------------------------------------------------------
# ORDER: the web app is created first only to learn its public FQDN, which is
# the API's CORS_ORIGIN. The env schema REQUIRES CORS_ORIGIN, so the API must be
# created already knowing it — otherwise its first revision exits at boot.
# API_ORIGIN on the web app is a placeholder until the API exists; it is
# rewritten immediately after, which rolls one new web revision.
# ---------------------------------------------------------------------------

# --- WEB app (nginx + Angular) ---------------------------------------------
# The explicit HTTP scale rule matters: with --min-replicas 0 and no rule, KEDA
# has no trigger to scale up on, so the app sits at zero replicas and ingress
# answers 404 ("stopped or does not exist") for every request.
say "Deploying $WEB_APP"
if az containerapp show -g "$RESOURCE_GROUP" -n "$WEB_APP" >/dev/null 2>&1; then
  run az containerapp update -g "$RESOURCE_GROUP" -n "$WEB_APP" \
      --image "${GHCR_WEB_IMAGE}:${IMAGE_TAG}" --output none
else
  run az containerapp create -g "$RESOURCE_GROUP" -n "$WEB_APP" \
      --environment "$ENV_NAME" \
      --image "${GHCR_WEB_IMAGE}:${IMAGE_TAG}" \
      --target-port 80 --ingress external \
      --min-replicas 0 --max-replicas 2 \
      --scale-rule-name http-requests --scale-rule-type http \
      --scale-rule-http-concurrency 40 \
      --cpu 0.25 --memory 0.5Gi \
      --env-vars "API_ORIGIN=https://placeholder.invalid" \
      --output none
fi

if [ "$DRY_RUN" = "1" ]; then
  WEB_FQDN="<web-fqdn>"
else
  WEB_FQDN=$(az containerapp show -g "$RESOURCE_GROUP" -n "$WEB_APP" \
      --query properties.configuration.ingress.fqdn -o tsv)
  [ -n "$WEB_FQDN" ] || die "Could not read web FQDN"
fi
WEB_ORIGIN="https://${WEB_FQDN}"
say "Web origin: $WEB_ORIGIN"

# --- API env & secrets ------------------------------------------------------
# Secrets are stored encrypted by the platform and referenced as `secretref:`.
# Optional keys are omitted entirely when blank rather than set to "": the API
# treats absent and empty differently in places, and an explicit "" would
# register the variable as present.
SECRET_ARGS=(
  "database-url=$DATABASE_URL"
  "direct-database-url=$DIRECT_DATABASE_URL"
  "s3-access-key=$S3_ACCESS_KEY"
  "s3-secret-key=$S3_SECRET_KEY"
)
ENV_ARGS=(
  "NODE_ENV=production"
  "PORT=3000"
  "LOG_LEVEL=info"
  "CORS_ORIGIN=$WEB_ORIGIN"
  "APP_BASE_URL=$WEB_ORIGIN"
  "DATABASE_URL=secretref:database-url"
  "DIRECT_DATABASE_URL=secretref:direct-database-url"
  "S3_ACCESS_KEY=secretref:s3-access-key"
  "S3_SECRET_KEY=secretref:s3-secret-key"
  "S3_ENDPOINT=$S3_ENDPOINT"
  "S3_BUCKET=$S3_BUCKET"
)

add_secret() { # secret-name ENV_KEY value — skipped when blank
  [ -n "$3" ] || return 0
  SECRET_ARGS+=("$1=$3")
  ENV_ARGS+=("$2=secretref:$1")
}
add_plain() { [ -n "$2" ] && ENV_ARGS+=("$1=$2") || true; }

add_secret supabase-jwt-secret SUPABASE_JWT_SECRET "$SUPABASE_JWT_SECRET"
add_secret resend-api-key      RESEND_API_KEY      "$RESEND_API_KEY"
add_secret dodo-api-key        DODO_API_KEY        "$DODO_API_KEY"
add_secret dodo-webhook-key    DODO_WEBHOOK_KEY    "$DODO_WEBHOOK_KEY"

add_plain SUPABASE_URL        "$SUPABASE_URL"
add_plain S3_PUBLIC_ENDPOINT  "$S3_PUBLIC_ENDPOINT"
add_plain S3_REGION           "$S3_REGION"
add_plain S3_FORCE_PATH_STYLE "$S3_FORCE_PATH_STYLE"
add_plain MAIL_FROM           "$MAIL_FROM"
add_plain MAIL_REPLY_TO       "$MAIL_REPLY_TO"
for p in PRO_MONTHLY PRO_ANNUAL TEAM_MONTHLY TEAM_ANNUAL; do
  add_plain "DODO_PRODUCT_$p" "$(get_env "DODO_PRODUCT_$p")"
done

# --- API Container App ------------------------------------------------------
# EXTERNAL ingress, deliberately, despite nginx being the only intended caller.
#
# Internal ingress requires a custom VNet. In a Consumption-only environment
# (vnetConfiguration: null) the *.internal.* FQDN still gets issued but resolves
# to the environment's PUBLIC static IP, so nginx's request arrives at public
# ingress, which sees a Host for an internal-only app and answers its own 404.
# Nothing can reach it — the address exists but routes nowhere.
#
# So the API is external and nginx proxies to it server-side. The browser still
# only ever talks to the web origin, so requests stay same-origin and CORS is
# not involved. The API is reachable directly by anyone who knows the URL, but
# every route except GET /healthz requires a valid Supabase bearer token.
#
# To make it genuinely private, recreate the environment with
# --infrastructure-subnet-resource-id and set --ingress internal here.
#
# --min-replicas 0 is the scale-to-zero the Consumption plan is for: an idle
# API costs nothing. The trade-off is a cold start on the first request after
# idle, made worse here because `start:prod` runs `prisma migrate deploy`
# before listening. See README "Cold starts" for how to avoid that.
say "Deploying $API_APP"
if az containerapp show -g "$RESOURCE_GROUP" -n "$API_APP" >/dev/null 2>&1; then
  run az containerapp secret set -g "$RESOURCE_GROUP" -n "$API_APP" \
      --secrets "${SECRET_ARGS[@]}" --output none
  run az containerapp update -g "$RESOURCE_GROUP" -n "$API_APP" \
      --image "${GHCR_API_IMAGE}:${IMAGE_TAG}" \
      --set-env-vars "${ENV_ARGS[@]}" --output none
else
  # Public ghcr.io images need no registry credentials. For a PRIVATE package,
  # add: --registry-server ghcr.io --registry-username <user>
  #      --registry-password <PAT with read:packages>
  run az containerapp create -g "$RESOURCE_GROUP" -n "$API_APP" \
      --environment "$ENV_NAME" \
      --image "${GHCR_API_IMAGE}:${IMAGE_TAG}" \
      --target-port 3000 --ingress external \
      --min-replicas 0 --max-replicas 2 \
      --scale-rule-name http-requests --scale-rule-type http \
      --scale-rule-http-concurrency 20 \
      --cpu 0.5 --memory 1.0Gi \
      --secrets "${SECRET_ARGS[@]}" \
      --env-vars "${ENV_ARGS[@]}" \
      --output none
fi

if [ "$DRY_RUN" = "1" ]; then
  API_FQDN="<api-fqdn>"
else
  API_FQDN=$(az containerapp show -g "$RESOURCE_GROUP" -n "$API_APP" \
      --query properties.configuration.ingress.fqdn -o tsv)
  [ -n "$API_FQDN" ] || die "Could not read API FQDN"
fi
API_ORIGIN="https://${API_FQDN}"

# --- point web at the real API ---------------------------------------------
# Internal ingress still serves HTTPS (on the environment's private DNS zone),
# so the upstream is https:// even though it is not publicly routable.
say "Wiring $WEB_APP -> $API_ORIGIN"
run az containerapp update -g "$RESOURCE_GROUP" -n "$WEB_APP" \
    --set-env-vars "API_ORIGIN=${API_ORIGIN}" --output none

# --- summary ----------------------------------------------------------------
cat <<SUMMARY

  ────────────────────────────────────────────────────────────────
   Azure resources ready

   Web (public)     ${WEB_ORIGIN}
   API (public)     ${API_ORIGIN}
   Resource group   ${RESOURCE_GROUP}    Region ${LOCATION}

   NEXT — add these GitHub repo secrets (Settings -> Secrets -> Actions):

     AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_SUBSCRIPTION_ID
       see deploy/azure/README.md section 3 (OIDC federated credential)

   Then run the "Deploy" workflow (Actions -> Deploy -> Run workflow). It builds
   both images to ghcr.io and updates the two Container Apps.

   The apps will not serve traffic until that first build exists: they were
   created pointing at image tags that have not been pushed yet.

   Verify once deployed:
     curl -fsS ${WEB_ORIGIN}/healthz          # nginx itself
     curl -fsS ${WEB_ORIGIN}/api-healthz      # API through the nginx proxy

   Logs:
     az containerapp logs show -g ${RESOURCE_GROUP} -n ${WEB_APP} --follow
     az containerapp logs show -g ${RESOURCE_GROUP} -n ${API_APP} --follow

   Manual follow-ups (third-party dashboards):
     - Supabase -> Auth -> URL Configuration: add ${WEB_ORIGIN}
     - Dodo webhook -> ${WEB_ORIGIN}/api/v1/billing/webhook
     - R2 bucket CORS: allow origin ${WEB_ORIGIN}

   Tear down:
     az group delete --name ${RESOURCE_GROUP} --yes --no-wait
  ────────────────────────────────────────────────────────────────

SUMMARY
[ "$DRY_RUN" = "1" ] && say "DRY RUN — nothing was created."
exit 0
