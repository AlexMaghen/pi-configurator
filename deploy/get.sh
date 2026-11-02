#!/usr/bin/env bash
# One-line installer for pi-configurator, run on the Raspberry Pi:
#
#   curl -fsSL https://raw.githubusercontent.com/AlexMaghen/pi-configurator/main/deploy/get.sh | sudo bash
#
# Downloads the project into /opt/pi-configurator/src and runs deploy/install.sh from there.
# Running it again updates an existing install; the config in /etc/pi-configurator is kept.
#
# Options for install.sh go after `-s --`, e.g. to let user pi's programs read the settings:
#
#   curl -fsSL .../deploy/get.sh | sudo bash -s -- --reader pi
#
# PI_CONFIGURATOR_REF picks a branch or tag (default main); PI_CONFIGURATOR_URL replaces the
# whole download URL (a .tar.gz of the repository), e.g. for a mirror.
set -euo pipefail

REPO_URL="https://github.com/AlexMaghen/pi-configurator"
REF="${PI_CONFIGURATOR_REF:-main}"
URL="${PI_CONFIGURATOR_URL:-$REPO_URL/archive/$REF.tar.gz}"
SRC=/opt/pi-configurator/src

# Everything runs inside main, called on the last line, so bash has read the whole script before
# any of it runs (it arrives through a pipe).
main() {
  if [[ $EUID -ne 0 ]]; then
    echo "run as root: curl -fsSL .../deploy/get.sh | sudo bash" >&2
    exit 1
  fi
  if ! grep -qiE '^(ID|ID_LIKE)=.*debian' /etc/os-release 2>/dev/null; then
    echo "pi-configurator needs Raspberry Pi OS (or another Debian-based system)" >&2
    exit 1
  fi
  for tool in curl tar; do
    command -v "$tool" >/dev/null || { echo "missing $tool: sudo apt-get install $tool" >&2; exit 1; }
  done

  printf '==> Downloading pi-configurator (%s)\n' "$REF"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$URL" | tar -xz -C "$tmp" --strip-components=1
  if [[ ! -x "$tmp/deploy/install.sh" ]]; then
    echo "the download from $URL doesn't look like pi-configurator" >&2
    exit 1
  fi

  install -d -m 0755 "$(dirname "$SRC")"
  rm -rf "$SRC"
  mv "$tmp" "$SRC"
  trap - EXIT
  chmod 0755 "$SRC"

  exec bash "$SRC/deploy/install.sh" "$@"
}

main "$@"
