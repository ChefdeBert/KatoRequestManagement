#!/usr/bin/env bash
# Check a deployed Kato from inside its network: health endpoint (app + database), Entra ID sign-in
# configured, dev login off. Runs the kato-smoke Container Apps job, because Kato has no public endpoint.
#   infra/scripts/smoke-test.sh prod
set -euo pipefail
# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh" "${1:-}"

log "Running kato-smoke in $RG"
exec_name="$(az containerapp job start -n kato-smoke -g "$RG" --query name -o tsv)"
for _ in $(seq 1 70); do
  status="$(az containerapp job execution show -n kato-smoke -g "$RG" --job-execution-name "$exec_name" --query properties.status -o tsv)"
  case "$status" in
    Succeeded) echo "  ✓ smoke test passed ($exec_name)"; exit 0 ;;
    Failed|Stopped|Degraded)
      echo "  ✖ smoke test $status ($exec_name). Output:" >&2
      az containerapp job logs show -n kato-smoke -g "$RG" --execution "$exec_name" --container smoke --format text 2>/dev/null >&2 \
        || echo "  (see Log Analytics: ContainerAppConsoleLogs_CL | where ContainerJobName_s == 'kato-smoke')" >&2
      exit 1 ;;
    *) sleep 10 ;;
  esac
done
die "Smoke test did not finish within ~12 minutes ($exec_name)"
