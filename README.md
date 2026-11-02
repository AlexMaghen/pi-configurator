# pi-configurator

Set up Raspberry Pi devices over Bluetooth LE from a phone: Wi-Fi, hostname, time zone, and any
settings the device's own software needs, from one generic app.

Two parts work together:

- **pi-configurator**, a service that runs on each Raspberry Pi. Its config file lists the
  settings the phone may change.
- **pi-fig**, the phone app (iPhone, iPad and Android). It finds nearby Pis running the service
  and draws a settings form from what each one describes.

## Installation

### On the Raspberry Pi

Needs Raspberry Pi OS Trixie (Pi 4B, Pi 5, Zero 2 W) with Bluetooth. On the Pi's command line,
run:

```bash
curl -fsSL https://raw.githubusercontent.com/AlexMaghen/pi-configurator/main/deploy/get.sh | sudo bash
```

The installer:

1. installs the system packages it needs (BlueZ, NetworkManager, Python);
2. downloads pi-configurator to `/opt/pi-configurator` and sets it up as the
   `pi-configurator` service, started now and at every boot;
3. copies the config template to `/etc/pi-configurator/config.json`;
4. asks for the **Bluetooth name** the phone will show and an **access password** (at least 8
   characters). The template's password, `1234`, is only a placeholder: the service won't start
   until a real password is set.

When it finishes, the Pi is advertising over Bluetooth and pi-fig can find it.

To let your own programs on the Pi read the saved settings, add their user to the
`pi-configurator` group as part of the install (here, user `pi`):

```bash
curl -fsSL https://raw.githubusercontent.com/AlexMaghen/pi-configurator/main/deploy/get.sh | sudo bash -s -- --reader pi
```

**Choosing what the phone can change:** edit `/etc/pi-configurator/config.json` (the settings
list, defaults and permissions), check it, and restart the service:

```bash
sudo nano /etc/pi-configurator/config.json
```

```bash
sudo pi-configurator check
```

```bash
sudo systemctl restart pi-configurator
```

**Changing the Bluetooth name or password later:**

```bash
sudo pi-configurator set-access && sudo systemctl restart pi-configurator
```

**Updating:** run the same install command again. Your config and saved settings are kept.

**Checking it's running:**

```bash
journalctl -u pi-configurator -f
```

More detail (files, permissions, environment variables, reading settings from your own
programs): [deploy/README.md](deploy/README.md).

### On the phone

Install **pi-fig** from the App Store (Google Play to follow). Open it near the Pi, tap the
device, and enter its access password. To try the app without a Pi, turn on the demo device in
its Preferences.

## Documentation

- **Design:** [docs/design.md](docs/design.md). Background research: [docs/background.md](docs/background.md).
- **Store listing assets:** [store/README.md](store/README.md).
- **Waiting on the owner:** [docs/owner-todo.md](docs/owner-todo.md).

## Development

### Layout

| Path | What |
|---|---|
| `packages/protocol` | The shared contract, in TypeScript: config file schema, RPC messages, BLE framing, SRP-6a and session encryption. Generates JSON Schema and test vectors |
| `python/` | uv workspace: the `pi-configurator` service and the `pi-configurator-client` package other Pi apps use to read values |
| `apps/mobile` | Expo app "pi-fig" (iPhone and iPad first, Android-ready) |
| `deploy/` | One-line installer (`get.sh`), install script and systemd unit for the Pi |
| `config-template/config.json` | The config file template (set up for BallsPi, the first target device); also the demo device in the app |
| `store/` | App Store and Google Play icons, screenshots and listing text |

### Commands

```bash
pnpm install
```

```bash
pnpm generate
```

```bash
pnpm test
```

```bash
pnpm typecheck
```

`pnpm generate` rewrites `packages/protocol/json-schema/` and the generated test vectors. The
protocol tests fail if those files are stale. Both the app and the Python service are tested
against `packages/protocol/test-vectors/`, which is how the two sides are kept in agreement.
