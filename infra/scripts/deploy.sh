#!/usr/bin/env bash
# Deploy main.bicep to one environment.
#   infra/scripts/deploy.sh prod            # phase 1: network, data, registry, Key Vault, environment
#   KATO_DEPLOY_APPS=true KATO_IMAGE_TAG=abc123 infra/scripts/deploy.sh prod   # phase 2 (release.sh does this)
# Add --what-if to preview changes without applying them.
set -euo pipefail
source "$(dirname "$0")/_common.sh" "${1:-}"
shift
EXTRA_ARGS=("$@")

# The dev resource group doesn't exist yet: create it. Production's is pre-created.
if [[ "$(az group exists -n "$RG")" != "true" ]]; then
  [[ "$KATO_ENV" == "dev" ]] || die "Resource group $RG not found in subscription $SUBSCRIPTION_ID"
  log "Creating resource group $RG in $LOCATION"
  az group create -n "$RG" -l "$LOCATION" --tags application=kato environment=dev managed-by=bicep -o none
fi

# Postgres admin password: reuse the one in Key Vault, else generate one and store it after deploy.
KV="$(kv_name || true)"
if [[ -z "${KATO_PG_ADMIN_PASSWORD:-}" && -n "$KV" ]]; then
  KATO_PG_ADMIN_PASSWORD="$(az keyvault secret show --vault-name "$KV" -n postgres-admin-password --query value -o tsv 2>/dev/null || true)"
fi
NEW_PG_PASSWORD=false
if [[ -z "${KATO_PG_ADMIN_PASSWORD:-}" ]]; then
  log "Generating a new PostgreSQL admin password (will be stored in Key Vault as postgres-admin-password)"
  KATO_PG_ADMIN_PASSWORD="$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-32)Aa1!"
  NEW_PG_PASSWORD=true
fi
export KATO_PG_ADMIN_PASSWORD

# Grant the person deploying "Key Vault Secrets Officer" so they can run set-secrets.sh.
export KATO_SECRETS_OFFICER_ID="${KATO_SECRETS_OFFICER_ID:-$(az ad signed-in-user show --query id -o tsv)}"

if [[ "${KATO_DEPLOY_APPS:-false}" == "true" ]]; then
  if grep -n "'TODO" "$INFRA_DIR/$KATO_ENV.bicepparam"; then
    die "Replace the TODO values in infra/$KATO_ENV.bicepparam before deploying the apps."
  fi
  [[ -n "$KV" ]] || die "Key Vault not found: run phase 1 first."
  for s in nextauth-secret azure-ad-client-secret anthropic-api-key jira-api-token; do
    az keyvault secret show --vault-name "$KV" -n "$s" --query id -o tsv >/dev/null 2>&1 \
      || die "Secret '$s' missing from $KV: run infra/scripts/set-secrets.sh $KATO_ENV"
  done
fi

log "Deploying Kato ($KATO_ENV) to $RG (apps: ${KATO_DEPLOY_APPS:-false}, tag: ${KATO_IMAGE_TAG:-latest})"
DEPLOY_STATUS=0
az deployment group create \
  -g "$RG" \
  -n "kato-$KATO_ENV-$(date +%Y%m%d-%H%M%S)" \
  --template-file "$INFRA_DIR/main.bicep" \
  --parameters "$INFRA_DIR/$KATO_ENV.bicepparam" \
  --query "properties.outputs" -o jsonc \
  "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}" || DEPLOY_STATUS=$?

# Save a newly generated password even if the deployment failed part-way: the server may already use it.
if [[ "$NEW_PG_PASSWORD" == "true" && ! " ${EXTRA_ARGS[*]-} " =~ " --what-if " ]]; then
  KV="$(kv_name || true)"
  if [[ -n "$KV" ]]; then
    # The Secrets Officer role granted by this deployment can take a few minutes to apply.
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
      az keyvault secret set --vault-name "$KV" -n postgres-admin-password --value "$KATO_PG_ADMIN_PASSWORD" -o none 2>/dev/null && break
      [[ $attempt == 10 ]] && die "Could not store the Postgres password. Save it now: $KATO_PG_ADMIN_PASSWORD"
      echo "  waiting for Key Vault permissions ($attempt/10)…"; sleep 30
    done
    log "Stored the PostgreSQL admin password in $KV/postgres-admin-password"
  fi
fi
exit "$DEPLOY_STATUS"
