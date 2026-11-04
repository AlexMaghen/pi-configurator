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

On a first install the script asks for the Bluetooth name and access password
(`pi-configurator set-access`); Enter keeps the values in the config (the template's password is
`1234`). With no terminal (an automated setup) it uses the config as it is. Then:

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
| config | `/etc/pi-configurator/` (0700), `config.json` (0600, root); copied from `--config-file-on-pi` only if missing |
| store and state | `/var/lib/pi-configurator/` (0750 root:pi-configurator): `values.json` (0640), `state.json` (0600) |
| unit | `/etc/systemd/system/pi-configurator.service`, enabled; started only if the config passes `check` |

Updating: run the `curl ... | sudo bash` line again (or `git pull && sudo ./deploy/install.sh` in a
checkout).

## The config is checked before it's installed

On a first install, `install.sh` checks the config it's about to install (the template, or the
file given with `--config-file-on-pi`) with `pi-configurator check`. If it has problems they're listed and
the installer stops there: nothing is copied to `/etc/pi-configurator` and the service isn't
started. An existing config is never replaced, and is checked before the service starts.
build-pifig-sd checks its config the same way on the Mac or PC, before the card is touched.

## Bluetooth setting the installer changes

`install.sh` sets `Client = false` under `[GATT]` in `/etc/bluetooth/main.conf` and restarts
Bluetooth. Without it, BlueZ reads a connected iPhone's own GATT services; the iPhone guards
some of them, so BlueZ starts a pairing that nobody on the Pi can confirm, iOS shows a pairing
prompt, and the link drops after the 30-second pairing timeout. pi-configurator only serves
data, so the Pi doesn't need the client role.

## D-Bus policy the installer adds

`install.sh` puts [org.piconfigurator.conf](org.piconfigurator.conf) in `/etc/dbus-1/system.d/`
and reloads D-Bus, so the service may own the name `org.piconfigurator`. After each save it
emits `org.piconfigurator.Settings1.Changed(as keys)` from `/org/piconfigurator/settings`.
Without the file the signal still goes out, just not under that name. Watch it with:

```bash
dbus-monitor --system "type='signal',interface='org.piconfigurator.Settings1'"
```

## Offline install

`install.sh --venv-archive FILE` installs without a network: it skips apt and pip, checks
that bluez, network-manager and python3 are already there (they are on Raspberry Pi OS), and
unpacks a prebuilt `/opt/pi-configurator/venv`. This is what a card set up with
[build-pifig-sd](../apps/build-pifig-sd/README.md) runs on its first boot.

## Reading settings from another program

```python
from pi_configurator_client import Store  # installed in the service venv; or pip install python/client

store = Store()
ms = store.get_int("BALLS_DISPENSE_MS")

store.on_change(lambda keys: print("changed:", keys))  # any change, with the changed keys

@store.on_setting("BALLS_DISPENSE_MS")                # one key, with its old and new value
def setting_updated(old, new): ...
```

Listeners run on a background thread. In a program's own virtual environment, install
`pi-configurator-client[dbus]` to hear the service's D-Bus signal and get changes at once;
without the extra (or without a system bus) the client polls `values.json` every second.

Programs that don't want any code for this have two config options per field:

- `"onChange": {"restart": ["app.service"]}` restarts the unit after a save that changes the
  field.
- `"onChange": {"reload": ["app.service"]}` runs `systemctl reload`, which is the unit's
  `ExecReload=`. Usually that is `ExecReload=/bin/kill -HUP $MAINPID`, and the program re-reads
  its settings on SIGHUP. A unit under both is only restarted.

Or set `"export": {"envFile": ".../.env.production"}` in the config: the service keeps a marked
block of `KEY=value` lines at the end of that file (other lines are left alone).

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
