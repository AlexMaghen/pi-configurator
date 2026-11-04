#!/usr/bin/env bash
# Runs once on the Pi's first boot, from cloud-init (the runcmd line build-pifig-sd adds to
# /boot/firmware/user-data). Installs pi-configurator from the files build-pifig-sd copied onto
# the boot partition, with no network: the Python environment comes prebuilt.
#
# Leaves result.txt next to itself, so the outcome can be read by putting the card back in a
# Mac or PC. Deletes config.json (it holds the access password in plain text) either way, and
# the large venv archive once the install worked. The full log is in
# /var/log/cloud-init-output.log on the Pi.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULT="$DIR/result.txt"

finish() {
  rm -f "$DIR/config.json"
  echo "$1" >"$RESULT"
  date -u '+%Y-%m-%d %H:%M UTC' >>"$RESULT"
  [[ -n "${2:-}" ]] && printf '\n%s\n' "$2" >>"$RESULT"
  echo "pi-configurator first boot: $1"
}

arch="$(uname -m)"
if [[ "$arch" != "aarch64" ]]; then
  finish "FAILED: this Pi runs a $arch system; the bundle is for 64-bit Raspberry Pi OS" && exit 1
fi
want="$(cat "$DIR/python-version" 2>/dev/null)"
have="$(python3 -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")' 2>/dev/null)"
if [[ -z "$have" || "$have" != "$want" ]]; then
  finish "FAILED: the bundle needs Python $want, this system has ${have:-no python3}" && exit 1
fi

# The first regular user (made by cloud-init from Raspberry Pi Imager's settings) may read the
# store, like `--reader pi` in the README's install command.
readers=()
first_user="$(getent passwd 1000 | cut -d: -f1)"
[[ -n "$first_user" ]] && readers=(--reader "$first_user")

log="$(mktemp)"
if bash "$DIR/deploy/install.sh" --venv-archive "$DIR/venv.tar.gz" --config-file-on-pi "$DIR/config.json" \
  "${readers[@]}" 2>&1 | tee "$log"; then
  rm -f "$DIR/venv.tar.gz"
  finish "OK: pi-configurator is installed and running"
else
  finish "FAILED: the install stopped; the last lines of its output follow" "$(tail -n 30 "$log")"
  exit 1
fi
