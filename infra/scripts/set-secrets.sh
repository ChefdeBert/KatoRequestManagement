#!/usr/bin/env bash
# Put the secrets Bicep can't create into Key Vault. Values are typed at hidden prompts, never echoed or
# passed on the command line. Press Enter at a prompt to keep the existing value.
#   infra/scripts/set-secrets.sh prod
set -euo pipefail
# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh" "${1:-}"

KV="$(kv_name)"
[[ -n "$KV" ]] || die "No Key Vault in $RG yet: run infra/scripts/deploy.sh $KATO_ENV first."
log "Setting secrets in $KV"

exists() { az keyvault secret show --vault-name "$KV" -n "$1" --query id -o tsv >/dev/null 2>&1; }

put() { # put <secret-name> <value>
  local f; f="$(mktemp)"; chmod 600 "$f"
  printf '%s' "$2" > "$f"
  az keyvault secret set --vault-name "$KV" -n "$1" --file "$f" --encoding utf-8 -o none
  rm -f "$f"
  echo "  ✓ $1"
}

prompt() { # prompt <secret-name> <description>
  local v
  if exists "$1"; then printf '%s (%s) [set — Enter to keep]: ' "$1" "$2"; else printf '%s (%s): ' "$1" "$2"; fi
  read -rs v; echo
  if [[ -n "$v" ]]; then put "$1" "$v"; elif ! exists "$1"; then echo "  ! $1 left empty"; fi
}

# NEXTAUTH_SECRET is generated, and kept across runs so sessions survive redeploys.
if exists nextauth-secret; then echo "  ✓ nextauth-secret (kept)"; else put nextauth-secret "$(openssl rand -base64 32)"; fi

prompt azure-ad-client-secret "Entra app registration client secret"
prompt anthropic-api-key      "Anthropic API key"
prompt jira-api-token         "Atlassian API token for the Kato service account"
if [[ "${2:-}" == "--smtp" ]]; then
  prompt smtp-password "SMTP password (also set useSmtpPassword = true in $KATO_ENV.bicepparam)"
fi
log "Done"
