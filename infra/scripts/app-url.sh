#!/usr/bin/env bash
# Print the public URL of kato-app (custom domain if bound, else the Container Apps host name).
#   infra/scripts/app-url.sh prod
set -euo pipefail
# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh" "${1:-}"
host="$(az containerapp show -n kato-app -g "$RG" --query "properties.configuration.ingress.customDomains[0].name" -o tsv 2>/dev/null || true)"
[[ -n "$host" ]] || host="$(az containerapp show -n kato-app -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)"
echo "https://$host"
