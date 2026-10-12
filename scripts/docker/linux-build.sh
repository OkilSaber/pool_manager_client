#!/usr/bin/env bash
# Exécuté dans le conteneur : copie les sources, construit l'AppImage et le .deb, les dépose dans /out.
set -euo pipefail
rsync -a --exclude node_modules --exclude dist --exclude 'src-tauri/target' --exclude .svelte-kit /src/ /build/
cd /build
VERSION=$(node -p "require('./package.json').version")
npm ci --no-audit --no-fund

# Premier passage : Tauri télécharge linuxdeploy et ses plugins dans ~/.cache/tauri.
C=/root/.cache/tauri
P=linuxdeploy-plugin-appimage.AppImage
npm run tauri build -- --bundles appimage >/dev/null 2>&1 || true

# Sous émulation (conteneur amd64 sur Mac ARM), le plugin AppImage ne démarre pas : les octets magiques
# « AI\x02 » de son en-tête ELF gênent l'émulateur. On neutralise ces octets sur une copie, on l'extrait,
# et on remplace le plugin par un script qui lance la version extraite. Sans effet néfaste en natif.
if [[ -f "$C/$P" ]] && ! "$C/$P" --plugin-api-version >/dev/null 2>&1; then
  X=$(mktemp -d)
  cp "$C/$P" "$X/plugin"
  printf '\x00\x00\x00' | dd of="$X/plugin" bs=1 seek=8 conv=notrunc 2>/dev/null
  chmod +x "$X/plugin"
  (cd "$X" && ./plugin --appimage-extract >/dev/null)
  # La copie d'origine doit quitter ce dossier : linuxdeploy y essaie tous les « linuxdeploy-plugin-* ».
  mv "$C/$P" "$X/plugin.orig"
  printf '#!/bin/sh\nexec %s/squashfs-root/AppRun "$@"\n' "$X" > "$C/$P"
  chmod +x "$C/$P"
fi

npm run tauri build -- --bundles appimage,deb
cp /target/release/bundle/appimage/*.AppImage /target/release/bundle/deb/*.deb /out/
cd /out && sha256sum *"$VERSION"*.AppImage *"$VERSION"*.deb > "SHA256SUMS-linux-$VERSION"
echo "✓ Linux $(uname -m) : $(ls /out | tr '\n' ' ')"
