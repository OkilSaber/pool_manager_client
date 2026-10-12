#!/usr/bin/env bash
# Build Linux sur une machine Linux : AppImage + .deb dans dist/.
# Prérequis (Debian/Ubuntu) :
#   sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev \
#                    libgtk-3-dev patchelf build-essential file curl
#   + Rust (rustup) et Node.js >= 20.
set -euo pipefail
cd "$(dirname "$0")/.."

[[ "$(uname -s)" == Linux ]] || { echo "À lancer sur Linux (sinon : scripts/build-linux-docker.sh)." >&2; exit 1; }
VERSION=$(node -p "require('./package.json').version")
# linuxdeploy est lui-même une AppImage : sans FUSE, on l'extrait à l'exécution.
export APPIMAGE_EXTRACT_AND_RUN=1

mkdir -p dist
npm ci --no-audit --no-fund
npm run tauri build -- --bundles appimage,deb
TARGET_DIR=${CARGO_TARGET_DIR:-src-tauri/target}
cp "$TARGET_DIR"/release/bundle/appimage/*.AppImage "$TARGET_DIR"/release/bundle/deb/*.deb dist/
(cd dist && sha256sum *"$VERSION"*.AppImage *"$VERSION"*.deb > "SHA256SUMS-linux-$VERSION")
ls -lh dist
