#!/usr/bin/env bash
# One-time setup: let GitHub Actions deploy Kato to Azure with OpenID Connect (no stored passwords or keys).
# Creates one Entra app registration per environment, trusted only for that GitHub environment:
#   kato-github-dev   ← repo:<repo>:environment:dev         → ct-hq-kato-ai-dev
#   kato-github-prod  ← repo:<repo>:environment:production  → ct-hq-kato-ai
# Run as someone who can create app registrations and is Owner on both resource groups.
#   infra/scripts/setup-github-oidc.sh [owner/repo]
set -euo pipefail

REPO="${1:-ChefdeBert/KatoRequestManagement}"
SUBSCRIPTION_ID="${KATO_SUBSCRIPTION_ID:-2398a4bc-4430-4c40-8d53-1339ee04ca2c}"
LOCATION="${KATO_LOCATION:-southafricanorth}"
az account set --subscription "$SUBSCRIPTION_ID"
TENANT_ID="$(az account show --query tenantId -o tsv)"

log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

rg_id() { echo "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$1"; }

assign() { # assign <principal-object-id> <role name> <scope>
  if [[ -z "$(az role assignment list --assignee "$1" --role "$2" --scope "$3" --query "[0].id" -o tsv)" ]]; then
    az role assignment create --assignee-object-id "$1" --assignee-principal-type ServicePrincipal \
      --role "$2" --scope "$3" -o none
  fi
  echo "  ✓ $2 on ${3##*/}"
}

LAST_APP_ID=""
LAST_SP_ID=""

setup() { # setup <env> <github-environment> <resource-group>
  local env="$1" gh_env="$2" rg="$3" name="kato-github-$1" app_id sp_id subject
  log "$name → GitHub environment '$gh_env' → $rg"

  if [[ "$(az group exists -n "$rg")" != "true" ]]; then
    az group create -n "$rg" -l "$LOCATION" --tags application=kato environment="$env" managed-by=bicep -o none
    echo "  ✓ created resource group $rg"
  fi

  app_id="$(az ad app list --display-name "$name" --query "[0].appId" -o tsv)"
  [[ -n "$app_id" ]] || app_id="$(az ad app create --display-name "$name" --sign-in-audience AzureADMyOrg --query appId -o tsv)"
  sp_id="$(az ad sp list --filter "appId eq '$app_id'" --query "[0].id" -o tsv)"
  [[ -n "$sp_id" ]] || sp_id="$(az ad sp create --id "$app_id" --query id -o tsv)"

  subject="repo:$REPO:environment:$gh_env"
  if [[ -z "$(az ad app federated-credential list --id "$app_id" --query "[?subject=='$subject'].id" -o tsv)" ]]; then
    az ad app federated-credential create --id "$app_id" -o none --parameters "{
      \"name\": \"github-$gh_env\",
      \"issuer\": \"https://token.actions.githubusercontent.com\",
      \"subject\": \"$subject\",
      \"audiences\": [\"api://AzureADTokenExchange\"]
    }"
  fi
  echo "  ✓ trusts $subject"

  # Contributor: create and update resources. RBAC Administrator: the templates create role assignments
  # (image pull, Key Vault access). Secrets Officer: read the Postgres password, check app secrets exist.
  assign "$sp_id" "Contributor" "$(rg_id "$rg")"
  assign "$sp_id" "Role Based Access Control Administrator" "$(rg_id "$rg")"
  assign "$sp_id" "Key Vault Secrets Officer" "$(rg_id "$rg")"

  LAST_APP_ID="$app_id"
  LAST_SP_ID="$sp_id"
}

setup dev dev ct-hq-kato-ai-dev
CLIENT_ID_DEV="$LAST_APP_ID"
setup prod production ct-hq-kato-ai
CLIENT_ID_PROD="$LAST_APP_ID"
SP_ID_PROD="$LAST_SP_ID"

# Production copies the tested images from the dev registry instead of rebuilding them.
log "Allow production to import images from the dev registry"
assign "$SP_ID_PROD" "Reader" "$(rg_id ct-hq-kato-ai-dev)"
assign "$SP_ID_PROD" "AcrPull" "$(rg_id ct-hq-kato-ai-dev)"

cat <<EOF

────────────────────────────────────────────────────────────────────
Now set these in GitHub → $REPO → Settings:

Secrets and variables → Actions → Variables (repository):
  AZURE_TENANT_ID        = $TENANT_ID
  AZURE_SUBSCRIPTION_ID  = $SUBSCRIPTION_ID
  KATO_KV_ADMIN_GROUP_ID = <object ID of the Entra group that manages Kato secrets> (optional)

Environments → dev → Environment variables:
  AZURE_CLIENT_ID = $CLIENT_ID_DEV
  Deployment branches: main only

Environments → production → Environment variables:
  AZURE_CLIENT_ID = $CLIENT_ID_PROD
  Deployment branches: main only
  Required reviewers: the people who approve production releases
────────────────────────────────────────────────────────────────────
EOF
