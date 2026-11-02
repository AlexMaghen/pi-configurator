# pi-configurator

Set up Raspberry Pi devices over Bluetooth LE from a phone: Wi-Fi, hostname, time zone, and any
settings the device's own software needs, from one generic app.

Two parts work together:

- **pi-configurator**, a service that runs on each Raspberry Pi. Its config file lists the
  settings the phone may change.
- **pi-fig**, the phone app (iPhone, iPad and Android). It finds nearby Pis running the service
  and draws a settings form from what each one describes.

## Installation

There are two ways to put pi-configurator on a Pi: set up the SD card from your Mac or PC
before the Pi's first boot (no internet needed on the Pi), or run one command on a Pi that's
already running.

### From your Mac or PC, on a new SD card

1. Write **64-bit Raspberry Pi OS** (from 24 November 2025 or later) to the card with
   [Raspberry Pi Imager](https://www.raspberrypi.com/software/). Its OS customisation (user,
   Wi-Fi, SSH) is optional.
2. Leave the card in your computer and run **build-pifig-sd** (see
   [apps/build-pifig-sd](apps/build-pifig-sd/README.md)). It finds the card's boot drive, shows
   it and asks before changing anything, then asks for the **Device Name** the phone will show
   and the **pifig Access Password** that unlocks it.
3. Put the card in the Pi and switch it on. On its first boot the Pi installs pi-configurator by
   itself, with no internet, and starts advertising over Bluetooth under that name.

The card must not have been started in a Pi before: the install runs on the very first boot.

### On a running Raspberry Pi

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
4. asks for the **Bluetooth name** the phone will show and the **access password** the app
   unlocks it with. Press Enter to keep each as it is in the config (the template's are
   `BallsPi` and `1234`); a new password needs at least 8 characters.

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
| `apps/build-pifig-sd` | Command-line tool for Mac and Windows that sets up a Raspberry Pi OS SD card so the Pi installs pi-configurator on first boot, offline |
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
