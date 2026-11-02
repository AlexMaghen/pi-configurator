#!/usr/bin/env bash
# Installs (or updates) the pi-configurator service on a Raspberry Pi running Pi OS Trixie.
#
#   sudo ./deploy/install.sh [--config path/to/config.json] [--reader USER]...
#
#   --config FILE   copy FILE to /etc/pi-configurator/config.json, ONLY if that file doesn't
#                   exist yet (an existing config is never replaced). Defaults to the template,
#                   config-template/config.json
#   --reader USER   add USER to the pi-configurator group so its programs can read the store
#                   (/var/lib/pi-configurator/values.json); repeatable
#   --venv-archive FILE
#                   offline install: unpack this prebuilt Python environment (a .tar.gz of
#                   /opt/pi-configurator/venv, made by apps/build-pifig-sd) instead of
#                   installing packages with apt and pip. bluez, network-manager and python3
#                   must already be there, as they are on Raspberry Pi OS
#
# Safe to run again: it only creates what is missing, reinstalls the Python packages from this
# checkout, and restarts the service when the config is valid. It never deletes anything.
#
# On a first install it asks for the Bluetooth name and access password (from the terminal, so it
# also works under `curl ... | sudo bash`); Enter keeps the values in the config as they are.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX=/opt/pi-configurator
VENV="$PREFIX/venv"
ETC=/etc/pi-configurator
CONFIG="$ETC/config.json"
STATE=/var/lib/pi-configurator
GROUP=pi-configurator
UNIT=pi-configurator.service

config_src="$REPO/config-template/config.json"
venv_archive=""
readers=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) config_src="$2"; shift 2 ;;
    --reader) readers+=("$2"); shift 2 ;;
    --venv-archive) venv_archive="$2"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "run as root (sudo $0 ...)" >&2
  exit 1
fi

step() { printf '\n==> %s\n' "$*"; }

step "System packages"
# bluez: the Bluetooth stack (GATT server, advertising). network-manager: Wi-Fi (default on
# Trixie). python3-venv: the service's virtual environment.
if [[ -n "$venv_archive" ]]; then
  # Offline: nothing can be downloaded, so only check what Raspberry Pi OS already has.
  missing=()
  command -v bluetoothctl >/dev/null || missing+=(bluez)
  command -v nmcli >/dev/null || missing+=(network-manager)
  command -v python3 >/dev/null || missing+=(python3)
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "missing on this system: ${missing[*]} (an offline install can't download them)" >&2
    exit 1
  fi
  echo "offline: using the installed bluez, network-manager and python3"
else
  apt-get update -qq
  apt-get install -y --no-install-recommends bluez network-manager python3 python3-venv
fi

step "Group $GROUP"
if ! getent group "$GROUP" >/dev/null; then
  groupadd --system "$GROUP"
fi
for user in "${readers[@]}"; do
  usermod -aG "$GROUP" "$user"
  echo "added $user to $GROUP (takes effect at its next login / service restart)"
done

step "Python packages in $VENV"
install -d -m 0755 "$PREFIX"
if [[ -n "$venv_archive" ]]; then
  # The archive holds venv/ built for /opt/pi-configurator, so its paths are already right.
  rm -rf "$VENV"
  tar -xzf "$venv_archive" -C "$PREFIX"
  "$VENV/bin/python" -c 'import pi_configurator' # fails here if the Python version doesn't match
elif command -v uv >/dev/null 2>&1; then
  [[ -x "$VENV/bin/python" ]] || uv venv --python python3 "$VENV"
  uv pip install --python "$VENV/bin/python" --reinstall-package pi-configurator \
    --reinstall-package pi-configurator-client "$REPO/python/service" "$REPO/python/client"
else
  [[ -x "$VENV/bin/python" ]] || python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet --force-reinstall --no-deps "$REPO/python/service" "$REPO/python/client"
  "$VENV/bin/pip" install --quiet "$REPO/python/service" "$REPO/python/client"
fi
ln -sf "$VENV/bin/pi-configurator" /usr/local/bin/pi-configurator

step "Directories"
install -d -m 0700 -o root -g root "$ETC"
# Group members need to reach values.json (0640) inside.
install -d -m 0750 -o root -g "$GROUP" "$STATE"

new_config=0
if [[ -e "$CONFIG" ]]; then
  echo "keeping existing $CONFIG"
elif [[ -f "$config_src" ]]; then
  install -m 0600 -o root -g root "$config_src" "$CONFIG"
  echo "installed $CONFIG from $config_src"
  new_config=1
else
  echo "no $CONFIG yet and $config_src not found: write one, then run this script again" >&2
fi
if [[ -e "$CONFIG" ]]; then
  chown root:root "$CONFIG"
  chmod 0600 "$CONFIG"
fi

if [[ $new_config == 1 ]]; then
  step "Bluetooth name and password"
  # Ask only when someone is watching: the output goes to a terminal (stdin is the script itself
  # under `curl | bash`) and that terminal can be opened for the answers.
  if [[ -t 1 || -t 2 ]] && (: </dev/tty) 2>/dev/null; then
    echo "The phone app shows this device by its Bluetooth name and unlocks it with this password."
    "$VENV/bin/pi-configurator" set-access "$CONFIG" </dev/tty >/dev/tty || true
  else
    echo "using the name and password in $CONFIG; change them with: sudo pi-configurator set-access"
  fi
fi

step "systemd unit"
install -m 0644 "$REPO/deploy/$UNIT" "/etc/systemd/system/$UNIT"
systemctl daemon-reload
systemctl enable bluetooth.service NetworkManager.service >/dev/null 2>&1 || true
systemctl enable "$UNIT"

if [[ -e "$CONFIG" ]] && "$VENV/bin/pi-configurator" check "$CONFIG"; then
  systemctl restart "$UNIT"
  echo "started; follow it with: journalctl -u pi-configurator -f"
else
  echo "not starting: fix $CONFIG (pi-configurator check $CONFIG), then: systemctl restart $UNIT" >&2
fi
