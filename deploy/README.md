# Installing pi-configurator on a Pi

Target: Raspberry Pi OS Trixie (Pi 4B, Pi 5, Zero 2 W) with NetworkManager (the default).

```sh
curl -fsSL https://raw.githubusercontent.com/AlexMaghen/pi-configurator/main/deploy/get.sh | sudo bash -s -- --reader pi
```

`get.sh` downloads the repository into `/opt/pi-configurator/src` and runs `install.sh` from
there; options after `-s --` go to `install.sh`. `PI_CONFIGURATOR_REF=v1.0.0` (before `bash`)
installs a tag or branch instead of `main`.

From a checkout instead:

```sh
git clone https://github.com/AlexMaghen/pi-configurator.git ~/pi-configurator && cd ~/pi-configurator
sudo ./deploy/install.sh --reader pi
```

On a first install the script asks for the Bluetooth name and an access password
(`pi-configurator set-access`), and it doesn't start the service while the config still has the
template's placeholder password (`1234`). Then:

```sh
sudo nano /etc/pi-configurator/config.json        # the settings the phone may change
sudo pi-configurator check                         # lists problems with their codes
sudo systemctl restart pi-configurator
journalctl -u pi-configurator -f
```

What `install.sh` does (safe to run again; never deletes or overwrites a config):

| What | Where |
|---|---|
| apt packages | `bluez`, `network-manager`, `python3`, `python3-venv` |
| Python venv with the service and client | `/opt/pi-configurator/venv` (uses `uv` if installed), `pi-configurator` linked into `/usr/local/bin` |
| group `pi-configurator` | members can read the store; `--reader USER` adds one |
| config | `/etc/pi-configurator/` (0700), `config.json` (0600, root); copied from `--config` only if missing |
| store and state | `/var/lib/pi-configurator/` (0750 root:pi-configurator): `values.json` (0640), `state.json` (0600) |
| unit | `/etc/systemd/system/pi-configurator.service`, enabled; started only if the config passes `check` |

Updating: run the `curl ... | sudo bash` line again (or `git pull && sudo ./deploy/install.sh` in a
checkout).

## Reading settings from another program

```python
from pi_configurator_client import Store  # installed in the service venv; or pip install python/client

store = Store()
ms = store.get_int("BALLS_DISPENSE_MS")
```

Or set `"export": {"envFile": ".../.env.production"}` in the config: the service keeps a marked
block of `KEY=value` lines at the end of that file (other lines are left alone) and restarts the
units named in `onChange.restart` after a save.

## Files and environment

| Variable / flag | Default |
|---|---|
| `PI_CONFIGURATOR_CONFIG` / `--config` | `/etc/pi-configurator/config.json` |
| `PI_CONFIGURATOR_STATE_DIR` / `--state-dir` | `/var/lib/pi-configurator` |
| `PI_CONFIGURATOR_HOSTS_FILE` / `--hosts-file` | `/etc/hosts` |
| `PI_CONFIGURATOR_LOG_LEVEL` | `INFO` |
| `PI_CONFIGURATOR_NO_REBOOT=1` | (unset) log instead of rebooting, for testing |

## First-time checks on hardware

1. `journalctl -u pi-configurator` shows `advertising as 'BallsPi'` with no errors.
2. nRF Connect (iOS/Android) finds the device; the scan shows the full name and service
   `7f48fb74-88e3-4082-ad7b-3bc0e0665132`. Reading `info`
   (`2c983635-7bab-4db2-afa8-e98c4992b855`) returns the JSON device info.
3. The app (or a test client) unlocks, reads and saves settings; `values.json` and the env file
   change, and the restarted units show up in the journal.

## Testing the installer

`./deploy/test/run.sh` (on a Mac with Docker) installs the working tree in a clean Debian Trixie
container three ways: a first install with no terminal, a first install answering the name and
password prompts, and an update. Containers have no systemd or Bluetooth, so `systemctl` is a
stub there and the service itself still needs a real Pi.
