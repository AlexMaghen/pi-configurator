#!/usr/bin/env bash
# Compiles build-pifig-sd into single programs, with the bundle inside, into dist/:
#
#   build-pifig-sd-macos-arm64     Macs with Apple silicon
#   build-pifig-sd-macos-x64       Intel Macs
#   build-pifig-sd-windows-x64.exe Windows PCs
#
# Run ./scripts/build-bundle.sh first (it needs Docker). Nothing needs installing to run the
# programs, not even Bun.
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="$APP/../../node_modules/.bin/bun"
[[ -f "$APP/bundle/venv.tar.gz" ]] || { echo "build the bundle first: pnpm bundle" >&2; exit 1; }

rm -rf "$APP/dist"
for target in darwin-arm64:macos-arm64 darwin-x64:macos-x64 windows-x64:windows-x64.exe; do
  "$BUN" build "$APP/src/main.ts" --compile --minify --target="bun-${target%%:*}" \
    --outfile "$APP/dist/build-pifig-sd-${target#*:}" >/dev/null
done
ls -lh "$APP/dist" | awk 'NR>1 {print $5, $9}'
