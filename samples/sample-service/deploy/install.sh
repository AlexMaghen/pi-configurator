#!/usr/bin/env bash
# Installs (or updates) sample-service on a Raspberry Pi that already runs pi-configurator.
# From a checkout of this repo on the Pi:
#
#   sudo samples/sample-service/deploy/install.sh
#
# Makes a virtual environment in /opt/sample-service/venv with the sample and
# pi-configurator-client[dbus], installs the systemd unit and (re)starts it. The Pi's
# /etc/pi-configurator/config.json needs the "Sample Service" items from
# config-template/config.json for the phone to show them; without them the service still runs,
# on its built-in defaults.
set -euo pipefail

HERE=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PREFIX=/opt/sample-service
UNIT=sample-service.service

if [[ $EUID -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi
if ! getent group pi-configurator >/dev/null; then
  echo "pi-configurator isn't installed (no pi-configurator group): run deploy/install.sh first" >&2
  exit 1
fi

echo "== Python packages in $PREFIX/venv"
install -d -m 0755 "$PREFIX"
[[ -x "$PREFIX/venv/bin/python" ]] || python3 -m venv "$PREFIX/venv"
"$PREFIX/venv/bin/pip" install --quiet --upgrade "$REPO/python/client[dbus]" "$HERE"

echo "== systemd unit $UNIT"
install -m 0644 "$HERE/deploy/$UNIT" "/etc/systemd/system/$UNIT"
systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null
systemctl restart "$UNIT"
echo "started; follow it with: journalctl -u sample-service -f"
