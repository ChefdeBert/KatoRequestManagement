#!/usr/bin/env bash
# Check a deployed Kato: health endpoint (app + database), Entra ID sign-in configured, dev login off.
#   infra/scripts/smoke-test.sh https://kato-app.<domain>
set -euo pipefail
URL="${1:?Usage: smoke-test.sh <base-url>}"
URL="${URL%/}"

echo "Waiting for $URL/api/health …"
for attempt in $(seq 1 30); do
  body="$(curl -fsS --max-time 10 "$URL/api/health" 2>/dev/null || true)"
  if [[ "$body" == *'"ok"'* ]]; then echo "✓ health: $body"; break; fi
  [[ $attempt == 30 ]] && { echo "✖ health check failed after 5 minutes (last response: ${body:-none})" >&2; exit 1; }
  sleep 10
done

providers="$(curl -fsS --max-time 15 "$URL/api/auth/providers")" || { echo "✖ /api/auth/providers failed" >&2; exit 1; }
[[ "$providers" == *'"azure-ad"'* ]] || { echo "✖ Entra ID sign-in is not configured (providers: $providers)" >&2; exit 1; }
[[ "$providers" != *'"kato-dev"'* ]] || { echo "✖ The email-only dev login is enabled on a deployed environment" >&2; exit 1; }
echo "✓ sign-in: Entra ID enabled, dev login disabled"
