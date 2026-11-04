#!/usr/bin/env bash
# Tests the first boot the way a Pi runs it, but in Docker on the Mac:
#
#   ./scripts/test-firstboot.sh      (after ./scripts/build-bundle.sh)
#
# Makes a debian:trixie arm64 image with what Raspberry Pi OS already has (python3, bluez,
# network-manager), then runs firstboot.sh from a copy of the bundle at /boot/firmware with the
# network switched off. systemd can't run in a container, so systemctl is a stub that logs.
# Checks: the service is installed with the given name and password, BlueZ's GATT client is
# off (main.conf [GATT] Client = false), result.txt says OK, and
# config.json (the plain-text password) and venv.tar.gz are gone from the boot partition.
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$APP/bundle/venv.tar.gz" ]] || { echo "build the bundle first: ./scripts/build-bundle.sh" >&2; exit 1; }

IMAGE=pi-configurator-test-rpios
docker build -q --platform linux/arm64 -t "$IMAGE" - >/dev/null <<'X'
FROM debian:trixie
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      python3 bluez network-manager >/dev/null && useradd -m -u 1000 pi
RUN printf '#!/bin/sh\necho "systemctl $*" >> /var/log/systemctl.log\n' > /usr/local/bin/systemctl \
 && chmod +x /usr/local/bin/systemctl
X

boot="$(mktemp -d)"
trap 'rm -rf "$boot"' EXIT
cp -R "$APP/bundle" "$boot/pi-configurator"
# What build-pifig-sd writes: the template, with the chosen name and password, as config.json.
mv "$boot/pi-configurator/config-template" "$boot/pi-configurator/config.json"
python3 - "$boot/pi-configurator/config.json" <<'X'
import json, sys
p = sys.argv[1]; c = json.load(open(p))
c["bluetooth"]["name"] = "Garage Pi"; c["access"]["password"] = "x"
json.dump(c, open(p, "w"), indent=2)
X

docker run --rm --platform linux/arm64 --network none -v "$boot:/boot/firmware" "$IMAGE" bash -c '
  bash /boot/firmware/pi-configurator/firstboot.sh >/tmp/out.log 2>&1; echo "exit=$?"
  echo "--- result.txt"; cat /boot/firmware/pi-configurator/result.txt
  echo "--- left on the boot partition"; ls /boot/firmware/pi-configurator
  echo "--- installed config"; python3 -c "import json;d=json.load(open(\"/etc/pi-configurator/config.json\"));print(d[\"bluetooth\"][\"name\"], \"|\", d[\"access\"][\"password\"])"
  echo "--- pi in group"; id -nG pi
  echo "--- bluez GATT client"; awk "/^\[/{s=\$0} /^Client/{print s, \$0}" /etc/bluetooth/main.conf
  echo "--- dbus policy"; ls /etc/dbus-1/system.d/org.piconfigurator.conf
  echo "--- systemctl"; cat /var/log/systemctl.log
  echo "--- check"; pi-configurator check
'
