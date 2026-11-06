#!/usr/bin/env bash
# Build the app and worker images in Azure Container Registry (no local Docker needed).
#   infra/scripts/build-images.sh prod [tag]      # tag defaults to the current git commit
set -euo pipefail
source "$(dirname "$0")/_common.sh" "${1:-}"
TAG="${2:-$(git -C "$REPO_DIR" rev-parse --short HEAD)}"

ACR="$(acr_name)"
[[ -n "$ACR" ]] || die "No container registry in $RG yet: run infra/scripts/deploy.sh $KATO_ENV first."
[[ -z "$(git -C "$REPO_DIR" status --porcelain)" ]] || echo "⚠ Working tree has uncommitted changes; they will be included in the images."

for target in app worker; do
  log "Building kato-$target:$TAG in $ACR"
  az acr build -r "$ACR" -f "$REPO_DIR/Dockerfile" --target "$target" \
    -t "kato-$target:$TAG" -t "kato-$target:latest" "$REPO_DIR"
done
echo "$TAG"
