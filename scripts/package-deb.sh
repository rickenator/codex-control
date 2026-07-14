#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_dir="$root_dir/dist/linux-unpacked"
package_json="$root_dir/package.json"

if [[ ! -x "$app_dir/consiglio" ]]; then
  echo "Expected packaged app at $app_dir/consiglio. Run npm run package:appimage first." >&2
  exit 1
fi

version="$(node -p "require('$package_json').version")"
architecture="$(dpkg --print-architecture)"
output="$root_dir/dist/Consiglio-$version-linux-$architecture.deb"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

mkdir -p \
  "$stage/DEBIAN" \
  "$stage/opt/Consiglio" \
  "$stage/usr/share/applications" \
  "$stage/usr/share/icons/hicolor/512x512/apps"

cp -a "$app_dir/." "$stage/opt/Consiglio/"
install -m 0644 "$root_dir/build/icons/icon.png" "$stage/usr/share/icons/hicolor/512x512/apps/consiglio.png"

cat > "$stage/DEBIAN/control" <<EOF
Package: consiglio
Version: $version
Section: devel
Priority: optional
Architecture: $architecture
Maintainer: Rick Goldberg and Aniviza LLC
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0
Recommends: libappindicator3-1
Description: Desktop control plane for Codex CLI
 Consiglio provides session tracking, review tooling, provider health checks,
 and remote llama.cpp support for Codex-compatible agents.
EOF

cat > "$stage/usr/share/applications/consiglio.desktop" <<'EOF'
[Desktop Entry]
Name=Consiglio
Comment=Desktop control plane for Codex CLI
Exec=/opt/Consiglio/consiglio %U
Terminal=false
Type=Application
Icon=consiglio
Categories=Development;
StartupWMClass=Consiglio
EOF

dpkg-deb --build --root-owner-group -Zxz -z6 "$stage" "$output"
echo "$output"
