#!/usr/bin/env bash
# Tests the Pi installer (get.sh + install.sh) in a clean Debian Trixie container, on the Mac:
#
#   ./deploy/test/run.sh
#
# Packs the working tree (including uncommitted changes) as GitHub would serve it, then runs
# in-container.sh: a first install with no terminal, a first install answering the prompts, and
# an update. Prints a summary; the full log is in deploy/test/out/install.log.
#
# Needs Docker. On Apple Silicon the container is arm64, like a 64-bit Pi. It can't run systemd
# or Bluetooth, so it checks the install steps, not the service on hardware.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/deploy/test/out"
mkdir -p "$OUT"
rm -f "$OUT"/*

# The working tree as a tarball shaped like GitHub's archive (top folder pi-configurator-main/).
index="$(mktemp)"
trap 'rm -f "$index"' EXIT
GIT_INDEX_FILE="$index" git -C "$ROOT" read-tree HEAD
GIT_INDEX_FILE="$index" git -C "$ROOT" add -A
tree="$(GIT_INDEX_FILE="$index" git -C "$ROOT" write-tree)"
git -C "$ROOT" archive --format=tar.gz --prefix=pi-configurator-main/ "$tree" >"$OUT/main.tar.gz"
cp "$ROOT/deploy/test/in-container.sh" "$OUT/"

docker run --rm -v "$OUT:/test" debian:trixie bash /test/in-container.sh >"$OUT/install.log" 2>&1

# Summary: the test's own lines, without apt's progress output.
tr '\r' '\n' <"$OUT/install.log" | sed -n '/################ RUN 1/,$p' |
  grep -E '^(####|==>|exit=|--- |systemctl |[A-Za-z].* \| |installed |keeping |not starting|started|no terminal|Too short|/etc/|pi-configurator|client ok)'
