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

### Installer options: where the config file comes from

Each way of installing takes its config file from a different machine, and the option names say
which:

| Option | Used with | The file is read from |
|---|---|---|
| `--config-file PATH` | `build-pifig-sd`, on your Mac or PC | **your computer** |
| `--config-file-on-pi PATH` | `get.sh` / `install.sh`, on the Pi | **the Pi** |

**`--config-file`** (new SD card). `build-pifig-sd` reads `PATH` on your computer and checks it
before touching the card. If the file has problems, it lists them and changes nothing. The Device
Name and pifig Access Password prompts start with the file's values: press Enter to keep them.
The checked file, with the name and password filled in, goes onto the card's boot drive. On first
boot the Pi installs it as `/etc/pi-configurator/config.json`, then deletes the copy on the boot
drive. Without the option, the built-in template is used.

```bash
./dist/build-pifig-sd-macos-arm64 --config-file ~/robots/garage.json
```

**`--config-file-on-pi`** (running Pi). The installer runs on the Pi, so `PATH` is a path on the
Pi's own disk. To use a file from your computer, copy it over first, then pass that path:

```bash
scp ~/robots/garage.json pi@garage.local:
```

```bash
curl -fsSL https://raw.githubusercontent.com/AlexMaghen/pi-configurator/main/deploy/get.sh | sudo bash -s -- --config-file-on-pi /home/pi/garage.json
```

The installer checks the file before installing it. If it has problems, they're listed and
nothing is installed. It's only used on a first install: an existing
`/etc/pi-configurator/config.json` is never replaced. To change a config that's already installed,
edit that file and restart the service (above). Without the option, the template is used.

Both ways, the file must pass the same checks as `pi-configurator check`. The format is described
in [config.json Structure and Options](#configjson-structure-and-options).

### On the phone

Install **pi-fig** from the App Store (Google Play to follow). Open it near the Pi, tap the
device, and enter its access password. To try the app without a Pi, turn on the demo device in
its Preferences.

## config.json Structure and Options

Each Pi has one config file, `/etc/pi-configurator/config.json`, owned by root and readable only
by root. It decides:
- the name the Pi advertises over Bluetooth;
- the password that unlocks it;
- what the phone may do;
- the list of settings the phone shows.

The app has no settings of its own for a device: it draws its form from this list.
[config-template/config.json](config-template/config.json) is a complete example (it's also what
the demo device uses). Check a file with `pi-configurator check FILE`, which lists every problem
with its location.

### Top level

| Property | Required | Meaning |
|---|---|---|
| `version` | yes | Always `1` |
| `bluetooth.name` | yes | The name the phone sees when scanning, at most 29 bytes (29 plain letters, fewer with accents or emoji) |
| `access.password` | yes | The pifig Access Password, 1 to 128 characters. It never travels over Bluetooth: the app proves it knows it (SRP). The service warns in its log if it's under 8 characters or still the template's `1234` |
| `deviceDescription` | no | A few sentences, up to 1,000 characters, shown under the device name at the top of the device screen |
| `permissions.allowReboot` | no | `true` shows a Reboot button in the app. Default `false` |
| `permissions.allowAccessChanges` | no | `true` lets the app change the access password and the Bluetooth name. Default `false` |
| `export.envFile` | no | An absolute path. After each save, the service writes every stored setting into this file as `KEY=value` lines, inside a marked block, and leaves other lines alone. systemd units can read it with `EnvironmentFile=`. Keys must then be valid variable names (letters, digits, `_`) |
| `settings` | yes | The list of settings the phone shows, in order (below) |
| `$schema` | no | For editors only. `packages/protocol/json-schema/config.schema.json` gives autocompletion and checking as you type |

### Settings

Each entry in `settings` is one field in the app's form. The app puts fields that change the
Pi's own system (Wi-Fi, hostname, time zone) under **Device & Network**, and all others under
**Application Settings**. Within a tab, fields are grouped under their `group` headings, in the
order the groups first appear.

Properties every field can have:

| Property | Required | Meaning |
|---|---|---|
| `key` | yes | A unique ID: letters, digits, `_`, `.` or `-`, starting with a letter or `_`, up to 64 characters. For stored settings it's also the name other programs read it by |
| `label` | yes | The field's name in the form |
| `type` | yes | `string`, `integer`, `number`, `boolean`, `select` or `wifi` (below) |
| `target` | yes | Where the value goes: `{ "store": true }` saves it for your programs; `{ "system": "wifi" }`, `"hostname"` or `"timezone"` changes the Pi itself |
| `default` | no | The value until someone changes it (below) |
| `group` | no | Section heading in the form |
| `help` | no | A line of explanation under the field |
| `readOnly` | no | `true` shows the value but doesn't allow changing it (e.g. a serial number) |
| `onChange.restart` | no | systemd units to restart after a save that changes this field, e.g. `["myapp.service"]` |
| `onChange.reload` | no | systemd units to reload (`systemctl reload`, usually a SIGHUP) instead. A unit listed under both is only restarted |

Properties by type:

| `type` | Value | Extra properties | In the app |
|---|---|---|---|
| `string` | text | `secret` (`true`: never sent back to the phone, shown as "set" or "not set"), `pattern` (a regular expression the whole value must match), `format` (`url`, `email` or `multiline`), `minLength`, `maxLength` | A text box with the keyboard to match `format` |
| `integer` | whole number | `min`, `max`, `step`, `unit` (a label such as `ms` or `%` shown beside the box) | The number pad, or a keyboard with a minus sign if `min` is below 0 |
| `number` | decimal number | the same as `integer` | The decimal pad, or a keyboard with a minus sign if `min` is below 0 |
| `boolean` | `true` / `false` | none | A switch |
| `select` | one of a list | `options`: `[{ "value": "...", "label": "..." }]` | A drop-down menu for up to 10 options; a searchable page for longer lists |
| `wifi` | `{ "ssid", "password", "hidden" }` | none | The Wi-Fi screen: the networks the Pi sees, joining, hidden networks |

The system targets need a matching type, and each can be used once:

| `target.system` | Field type | What it changes |
|---|---|---|
| `wifi` | `wifi` | The Pi's Wi-Fi connection, through NetworkManager. The password is always secret |
| `hostname` | `string` | The Pi's hostname (its `name.local` address), keeping `/etc/hosts` in step |
| `timezone` | `select` | The Pi's time zone. Leave out `options` to offer every time zone the Pi knows |

### Defaults

- **Stored settings** (`"store": true`): until the phone saves a value, programs read the
  `default`. Changing a default in the file affects every setting the phone hasn't changed.
  "Reset to default" in the app removes the saved value.
- **System settings:** a `default` is applied once, on the service's first start, and only if
  the Pi has nothing set yet (for example no Wi-Fi network). After that the Pi's own value is
  shown.

A default must be valid for its field: within `min`/`max` and on a `step`, matching `pattern`
and the length limits, or one of the `options`.

### Example

A Pi running one program, `garage.service`, with its Wi-Fi and two settings of its own:

```json
{
  "version": 1,
  "bluetooth": { "name": "Garage Pi" },
  "access": { "password": "choose-a-long-password" },
  "deviceDescription": "Opens the garage door and reports whether it's open.",
  "permissions": { "allowReboot": true, "allowAccessChanges": false },
  "settings": [
    {
      "key": "wifi",
      "label": "Wi-Fi network",
      "type": "wifi",
      "target": { "system": "wifi" }
    },
    {
      "key": "DOOR_OPEN_SECONDS",
      "label": "Door open time",
      "help": "How long the motor runs to open the door.",
      "group": "Door",
      "type": "number",
      "min": 1,
      "max": 30,
      "step": 0.5,
      "unit": "s",
      "default": 12,
      "target": { "store": true },
      "onChange": { "restart": ["garage.service"] }
    },
    {
      "key": "LOG_LEVEL",
      "label": "Log level",
      "group": "Advanced",
      "type": "select",
      "options": [
        { "value": "info", "label": "Info" },
        { "value": "debug", "label": "Debug" }
      ],
      "default": "info",
      "target": { "store": true },
      "onChange": { "reload": ["garage.service"] }
    }
  ]
}
```

The phone shows Wi-Fi under Device & Network, and "Door open time" and "Log level" under
Application Settings. `garage.service` reads `DOOR_OPEN_SECONDS` and `LOG_LEVEL` through
`pi-configurator-client`, and can also get them through `export.envFile`. It's restarted when
the door time changes, and reloaded when the log level changes. How programs read settings and
hear about changes: [deploy/README.md](deploy/README.md#reading-settings-from-another-program).

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
