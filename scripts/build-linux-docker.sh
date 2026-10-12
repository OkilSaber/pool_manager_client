#!/usr/bin/env bash
# Build Linux depuis n'importe quel OS avec Docker : AppImage + .deb x86_64 dans dist/.
# Sur un Mac Apple Silicon, le conteneur amd64 tourne en émulation (premier build : 20 à 40 min,
# les suivants réutilisent le cache des volumes Docker).
# Usage : scripts/build-linux-docker.sh [amd64|arm64]   (défaut : amd64)
set -euo pipefail
cd "$(dirname "$0")/.."

PLATFORM=linux/${1:-amd64}
IMAGE=pool-manager-client-linux-build
command -v docker >/dev/null || { echo "Docker est requis." >&2; exit 1; }

docker build --platform "$PLATFORM" -t "$IMAGE" -f scripts/docker/linux.Dockerfile scripts/docker
mkdir -p dist
# Sources copiées dans le conteneur (pas de node_modules ni de target de l'hôte) ;
# cibles Rust et cache npm dans des volumes Docker (pas de fichiers root dans le dépôt).
docker run --rm --platform "$PLATFORM" \
  -v "$PWD":/src:ro \
  -v "$PWD/dist":/out \
  -v pool-manager-client-target:/target \
  -v pool-manager-client-npm:/root/.npm \
  "$IMAGE"
ls -lh dist
