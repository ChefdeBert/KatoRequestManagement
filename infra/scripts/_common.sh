# Shared settings for the Kato infra scripts. Sourced, not executed.
# Usage in a script:  source "$(dirname "$0")/_common.sh" "$1"

KATO_ENV="${1:-}"
case "$KATO_ENV" in
  prod) RG="ct-hq-kato-ai" ;;
  dev)  RG="ct-hq-kato-ai-dev" ;;
  *) echo "Usage: $(basename "$0") prod|dev ..." >&2; exit 2 ;;
esac

SUBSCRIPTION_ID="${KATO_SUBSCRIPTION_ID:-2398a4bc-4430-4c40-8d53-1339ee04ca2c}"   # ct-hq-serviceshub
LOCATION="${KATO_LOCATION:-southafricanorth}"
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$INFRA_DIR/.." && pwd)"

az account set --subscription "$SUBSCRIPTION_ID"

# Resolve resources created by main.bicep (empty until the first deployment)
kv_name()  { az keyvault list -g "$RG" --query "[0].name" -o tsv 2>/dev/null; }
acr_name() { az acr list -g "$RG" --query "[0].name" -o tsv 2>/dev/null; }

log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
