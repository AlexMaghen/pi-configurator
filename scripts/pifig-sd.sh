#!/usr/bin/env bash
# Sets up pi-configurator on the freshly written SD card in this Mac. Run it from any folder:
#
#   ~/AxDevProj/Robots/pi-configurator/scripts/pifig-sd.sh [--config-file PATH]
#
# Only starts pifig-sd.ts (next to this file) with the repo's Bun; see that file for what it does.
set -euo pipefail

src="${BASH_SOURCE[0]}"
while [[ -L "$src" ]]; do
  target="$(readlink "$src")"
  [[ "$target" == /* ]] && src="$target" || src="$(dirname "$src")/$target"
done
dir="$(cd "$(dirname "$src")" && pwd)"
bun="$dir/../node_modules/.bin/bun"
[[ -x "$bun" ]] || { echo "pifig-sd: Bun isn't installed in the repo; run pnpm install in $(cd "$dir/.." && pwd)" >&2; exit 1; }

exec "$bun" "$dir/pifig-sd.ts" "$@"
