#!/usr/bin/env bash
# Builds the files build-pifig-sd copies onto a Pi's boot partition, into apps/build-pifig-sd/bundle/:
#
#   venv.tar.gz      /opt/pi-configurator/venv with pi-configurator and its dependencies,
#                    built for 64-bit Raspberry Pi OS Trixie (arm64, Debian's Python 3.13)
#   python-version   the Python version the venv was built with ("3.13")
#   deploy/          install.sh, the systemd unit and the D-Bus policy
#   firstboot.sh     what cloud-init runs on first boot
#   config-template  the config template (build-pifig-sd writes the name and password into a
#                    copy, config.json; no .json here so it is embedded as a plain file)
#
# Runs on the Mac: the venv is built inside a debian:trixie arm64 container (native on Apple
# Silicon, emulated elsewhere), at the same path it has on the Pi so it works unpacked as is.
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$APP/../.." && pwd)"
OUT="$APP/bundle"

if ! docker info >/dev/null 2>&1; then
  echo "starting Docker..."
  open -a Docker
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
fi

rm -rf "$OUT"
mkdir -p "$OUT/deploy"

# Only the Python packages go into the container.
src="$(mktemp -d)"
trap 'rm -rf "$src"' EXIT
cp -R "$ROOT/python/service" "$ROOT/python/client" "$src/"
find "$src" -name '__pycache__' -prune -exec rm -rf {} + -o -name '.venv' -prune -exec rm -rf {} +

docker run --rm --platform linux/arm64 -v "$src:/src:ro" -v "$OUT:/out" debian:trixie bash -euc '
  apt-get update -qq >/dev/null
  apt-get install -y -qq --no-install-recommends python3 python3-venv ca-certificates >/dev/null
  python3 -m venv /opt/pi-configurator/venv
  /opt/pi-configurator/venv/bin/pip install --quiet --no-cache-dir /src/service /src/client
  /opt/pi-configurator/venv/bin/pi-configurator --version
  find /opt/pi-configurator/venv -name "__pycache__" -prune -exec rm -rf {} +
  tar -czf /out/venv.tar.gz -C /opt/pi-configurator venv
  python3 -c "import sys; print(f\"{sys.version_info[0]}.{sys.version_info[1]}\")" > /out/python-version
'

cp "$ROOT/deploy/install.sh" "$ROOT/deploy/pi-configurator.service" \
  "$ROOT/deploy/org.piconfigurator.conf" "$OUT/deploy/"
cp "$APP/pi/firstboot.sh" "$OUT/"
cp "$ROOT/config-template/config.json" "$OUT/config-template"
echo "bundle: $OUT ($(du -sh "$OUT" | cut -f1), Python $(cat "$OUT/python-version"))"
