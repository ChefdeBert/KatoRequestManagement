#!/usr/bin/env bash
# Build, migrate and roll out a release.
#   infra/scripts/release.sh prod [tag]
# Order: build images → run `prisma migrate deploy` with the new image → update app and worker.
# On the very first release the migration job doesn't exist yet, so it runs straight after the apps are created.
set -euo pipefail
# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh" "${1:-}"
SCRIPTS="$(dirname "$0")"
TAG="${2:-$(git -C "$REPO_DIR" rev-parse --short HEAD)}"

"$SCRIPTS/build-images.sh" "$KATO_ENV" "$TAG"
ACR_SERVER="$(az acr show -n "$(acr_name)" --query loginServer -o tsv)"

run_migration() {
  log "Running database migrations (kato-migrate, image tag $TAG)"
  local exec status
  # Update the job's image first: a start-time --image override would replace the container definition
  # and drop its command and DATABASE_URL.
  az containerapp job update -n kato-migrate -g "$RG" --container-name migrate --image "$ACR_SERVER/kato-worker:$TAG" -o none
  exec="$(az containerapp job start -n kato-migrate -g "$RG" --query name -o tsv)"
  while :; do
    status="$(az containerapp job execution show -n kato-migrate -g "$RG" --job-execution-name "$exec" --query properties.status -o tsv)"
    case "$status" in
      Succeeded) echo "  ✓ migrations applied"; return 0 ;;
      Failed|Stopped|Degraded) die "Migration $exec $status. Logs: az containerapp job logs show -n kato-migrate -g $RG --execution $exec --container migrate" ;;
      *) sleep 10 ;;
    esac
  done
}

FIRST_RELEASE=false
if az containerapp job show -n kato-migrate -g "$RG" -o none 2>/dev/null; then
  run_migration
else
  FIRST_RELEASE=true
fi

log "Rolling out kato-app and kato-worker ($TAG)"
KATO_DEPLOY_APPS=true KATO_IMAGE_TAG="$TAG" "$SCRIPTS/deploy.sh" "$KATO_ENV"

if [[ "$FIRST_RELEASE" == "true" ]]; then
  run_migration
  log "First release: restarting the worker now that the schema exists"
  az containerapp revision restart -n kato-worker -g "$RG" \
    --revision "$(az containerapp show -n kato-worker -g "$RG" --query properties.latestRevisionName -o tsv)" -o none
fi

log "Released $TAG → https://$(az containerapp show -n kato-app -g "$RG" --query properties.configuration.ingress.fqdn -o tsv) (corporate network only)"
