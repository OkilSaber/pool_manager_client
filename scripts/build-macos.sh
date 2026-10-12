#!/usr/bin/env bash
# Build macOS (Apple Silicon + Intel) : .app signée ad hoc, .dmg et archive .app.tar.gz dans dist/.
# Usage : scripts/build-macos.sh [aarch64|x64|all]   (défaut : all)
set -euo pipefail
cd "$(dirname "$0")/.."

[[ "$(uname -s)" == Darwin ]] || { echo "À lancer sur macOS." >&2; exit 1; }
VERSION=$(node -p "require('./package.json').version")
WHICH=${1:-all}
ARCHS=(aarch64 x64); [[ $WHICH != all ]] && ARCHS=("$WHICH")

mkdir -p dist
npm ci --no-audit --no-fund
for arch in "${ARCHS[@]}"; do
  case $arch in
    aarch64) target=aarch64-apple-darwin ;;
    x64) target=x86_64-apple-darwin ;;
    *) echo "architecture inconnue : $arch (aarch64 | x64 | all)" >&2; exit 1 ;;
  esac
  rustup target add "$target" >/dev/null
  # Le script DMG de Tauri pilote le Finder (AppleScript) : on ne construit que la .app et on fait le .dmg avec hdiutil.
  npm run tauri build -- --target "$target" --bundles app
  app="src-tauri/target/$target/release/bundle/macos/Pool Manager.app"
  codesign --verify --deep --strict "$app"

  stage=$(mktemp -d)
  cp -R "$app" "$stage/" && ln -s /Applications "$stage/Applications"
  hdiutil create -quiet -volname "Pool Manager" -srcfolder "$stage" -ov -format UDZO "dist/Pool.Manager_${VERSION}_${arch}.dmg"
  hdiutil verify -quiet "dist/Pool.Manager_${VERSION}_${arch}.dmg"
  tar -czf "dist/Pool.Manager_${VERSION}_${arch}.app.tar.gz" -C "$(dirname "$app")" "Pool Manager.app"
  echo "✓ macOS $arch"
done
(cd dist && shasum -a 256 Pool.Manager_"$VERSION"_* > "SHA256SUMS-macos-$VERSION")
ls -lh dist
