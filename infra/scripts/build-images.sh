#!/usr/bin/env bash
# Build the app and worker images in Azure Container Registry (no local Docker needed).
#   infra/scripts/build-images.sh prod [tag]      # tag defaults to the current git commit
#   KATO_PROMOTE_FROM=dev infra/scripts/build-images.sh prod <tag>   # copy dev's images instead of rebuilding
# An image tag that already exists in the registry is not rebuilt, so re-running a release is cheap.
set -euo pipefail
# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh" "${1:-}"
TAG="${2:-$(git -C "$REPO_DIR" rev-parse --short HEAD)}"

ACR="$(acr_name)"
[[ -n "$ACR" ]] || die "No container registry in $RG yet: run infra/scripts/deploy.sh $KATO_ENV first."
[[ -z "$(git -C "$REPO_DIR" status --porcelain)" ]] || echo "⚠ Working tree has uncommitted changes; they will be included in the images."

tag_exists() { az acr repository show -n "$ACR" --image "$1" -o none 2>/dev/null; }

for target in app worker; do
  image="kato-$target:$TAG"
  if tag_exists "$image"; then
    log "$image already in $ACR, skipping"
  elif [[ -n "${KATO_PROMOTE_FROM:-}" ]]; then
    case "$KATO_PROMOTE_FROM" in prod) SRC_RG="ct-hq-kato-ai" ;; dev) SRC_RG="ct-hq-kato-ai-dev" ;; *) die "KATO_PROMOTE_FROM must be dev or prod" ;; esac
    SRC_ACR_ID="$(az acr list -g "$SRC_RG" --query "[0].id" -o tsv)"
    [[ -n "$SRC_ACR_ID" ]] || die "No container registry in $SRC_RG to promote from"
    log "Promoting $image from $KATO_PROMOTE_FROM ($SRC_RG) to $ACR"
    az acr import -n "$ACR" --registry "$SRC_ACR_ID" --source "$image" -t "$image" -t "kato-$target:latest" --force -o none
  else
    log "Building $image in $ACR"
    az acr build -r "$ACR" -f "$REPO_DIR/Dockerfile" --target "$target" \
      -t "$image" -t "kato-$target:latest" "$REPO_DIR"
  fi
done
