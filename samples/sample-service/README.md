# sample-service

A small example of a program on the Pi that gets its settings from pi-configurator. It reads
them when it starts and applies each change made in pi-fig while it runs, without restarting.
Copy this folder as the starting point for your own service.

It drives a pretend device (a light, a speaker and a display) that only logs what it would do.
Its four settings are the **Sample Service** group in
[config-template/config.json](../../config-template/config.json), one of each kind:

| Setting in the app | Key | Type | Applied |
|---|---|---|---|
| Light color | `color` | `select` | at once |
| Volume | `volume` | `integer`, 0 to 100 % in steps of 5 | at once |
| Start playing at boot | `autostart` | `boolean` | at the next start |
| Artist name | `artistName` | `string`, up to 60 characters | at once |

## How it works

| File | What it shows |
|---|---|
| [`settings.py`](src/sample_service/settings.py) | All settings read into one typed, immutable `Settings` object with the client's typed getters. Built-in fallbacks for when the store has no value; a warning and the fallback (never a crash) if the config file and the code disagree |
| [`app.py`](src/sample_service/app.py) | The service. It listens with `store.on_change`, whose listener only queues a note; the main thread reloads `Settings`, compares it with the last one and applies only what changed. SIGHUP reloads everything; SIGTERM stops cleanly and closes the store |
| [`device.py`](src/sample_service/device.py) | The hardware stand-in. Your GPIO, audio or display code goes here, knowing nothing about pi-configurator |
| [`deploy/sample-service.service`](deploy/sample-service.service) | The systemd unit: membership of the `pi-configurator` group (needed to read the settings) and `ExecReload` for SIGHUP |
| [`deploy/install.sh`](deploy/install.sh) | Installs the sample on a Pi that already runs pi-configurator |

The pattern in short:

```python
from pi_configurator_client import Store

store = Store()  # /var/lib/pi-configurator/values.json
store.on_change(lambda keys: inbox.put(RELOAD))  # background thread: only queue a note
settings = Settings.load(store)  # saved value, else the config default
apply_all(settings)

while inbox.get() is not STOP:  # main thread: re-read, apply what changed
    previous, settings = settings, Settings.load(store)
    for name in settings.changes_from(previous):
        apply(name, settings)
store.close()
```

Two other ways a program can get changes, set in the config file instead of in code:
`"onChange": {"restart": ["myapp.service"]}` restarts the unit after a save, and
`"onChange": {"reload": ["myapp.service"]}` sends it SIGHUP. See
[deploy/README.md](../../deploy/README.md#reading-settings-from-another-program).

## Try it on a Mac

No Pi needed: point it at any `values.json` and edit the file while it runs.

```bash
cd samples/sample-service
```

```bash
printf '{"values": {}, "defaults": {"color": "warm-white", "volume": 40, "autostart": true, "artistName": ""}}' > /tmp/values.json
```

```bash
uv run sample-service --store /tmp/values.json
```

In another terminal, change a value and watch the log:

```bash
printf '{"values": {"volume": 75, "artistName": "Nina Simone"}, "defaults": {"color": "warm-white", "volume": 40, "autostart": true, "artistName": ""}}' > /tmp/values.json
```

## Install it on a Pi

On a Pi that runs pi-configurator, with this repo checked out:

1. Put the **Sample Service** group from `config-template/config.json` into the Pi's
   `/etc/pi-configurator/config.json`, then `sudo systemctl restart pi-configurator`. (A Pi set
   up with the template already has it.)
2. Install and start the sample:

   ```bash
   sudo samples/sample-service/deploy/install.sh
   ```

3. Follow its log, and change the settings in pi-fig under **Application Settings**:

   ```bash
   journalctl -u sample-service -f
   ```

## Outside this repo

Your own project depends on the client from GitHub:

```toml
dependencies = [
  "pi-configurator-client[dbus] @ git+https://github.com/AlexMaghen/pi-configurator#subdirectory=python/client",
]
```

The `dbus` extra hears the service's change signal, so changes arrive at once; without it the
client checks `values.json` every second.

## Development

```bash
uv run pytest
```

```bash
uv run pyright
```

```bash
uv run ruff check .
```

From the repo root, `pnpm test`, `pnpm typecheck` and `pnpm lint` include this sample. The tests
also check that the code's keys, types, options and defaults match `config-template/config.json`.
