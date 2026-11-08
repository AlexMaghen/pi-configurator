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

On the Mac that has this repo, step 2 is one command, from any folder:

```bash
~/AxDevProj/Robots/pi-configurator/scripts/pifig-sd.sh --config-file PATH
```

It rebuilds build-pifig-sd first when the code it carries has changed (the bundle with Docker
when the Pi side changed), then runs it. `--config-file` is optional and is its only option.

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
   `SampleDevice` and `1234`); a new password needs at least 8 characters.

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

Install **pi-fig** for iPhone and iPad from the App Store:
[apps.apple.com/us/app/pi-fig/id6829856521](https://apps.apple.com/us/app/pi-fig/id6829856521)
(Google Play to follow). Open it near the Pi, tap the device, and enter its access password. To
try the app without a Pi, turn on the demo device in its Preferences.

The app's source is in [`apps/mobile`](apps/mobile): one Expo (React Native) codebase for iOS
and Android. The screens are under `apps/mobile/src/app`, and the Bluetooth, encryption and
session code under `apps/mobile/src/lib`. You can use it in two ways:

- **As-is.** pi-fig is generic: it draws every device's settings from that device's
  `config.json`, so you can set up your own Pi product with no app changes. The settings, their
  labels, help text, groups and defaults, and which device screens appear (Wi-Fi, hostname, time
  zone, password changes) all come from the config file (see
  [config.json Structure and Options](#configjson-structure-and-options)).
- **As a starting point for your own product.** Fork the repo and adapt `apps/mobile` into an
  app built for one IoT product: your own name and branding, screens made for that device, or
  extra features beyond settings. The shared contract in `packages/protocol` and the service on
  the Pi keep working underneath.

## config.json Structure and Options

Each Pi has one config file, `/etc/pi-configurator/config.json`, owned by root and readable only
by root. It decides:
- the name the Pi advertises over Bluetooth;
- the password that unlocks it;
- which of the Pi's own settings and actions the phone offers (`deviceSettings`, the
  **Device & Network** tab);
- the device's own settings, in named groups (`appSettings`, the **Application Settings** tab).

The app has no settings of its own for a device: it draws both tabs from this file.
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
| `export.envFile` | no | An absolute path. After each save, the service writes every app setting into this file as `KEY=value` lines, inside a marked block, and leaves other lines alone. systemd units can read it with `EnvironmentFile=`. Keys must then be valid variable names (letters, digits, `_`) |
| `deviceSettings` | no | Device & Network (below). Left out, everything on it is off |
| `appSettings` | no | Application Settings: a list of groups (below). Left out or empty, the tab is hidden |
| `$schema` | no | For editors only. `packages/protocol/json-schema/config.schema.json` gives autocompletion and checking as you type |

### deviceSettings: Device & Network

The Pi's own settings, and what the phone may do to the device. Each is off unless the file
turns it on. The settings always appear in this order, under a "Network" heading, with fixed
labels and help:

| Property | Value | What it does |
|---|---|---|
| `wifi` | `true`, or `{ "label": "..." }` | The Wi-Fi screen: the networks the Pi sees, joining, hidden networks. Changes the Pi's connection through NetworkManager. The password is never sent back to the phone |
| `hostname` | `true`, or `{ "label": "...", "default": "..." }` | The Pi's hostname (its `name.local` address), keeping `/etc/hosts` in step. Letters, digits and hyphens, up to 63 |
| `timezone` | `true`, or `{ "label": "...", "default": "..." }` | The Pi's time zone, picked from every zone the Pi knows |
| `allowReboot` | `true` / `false` | A Reboot button |
| `allowAccessChanges` | `true` / `false` | Change password and Rename device: the access password and the Bluetooth name |

- `true` turns a setting on as it is. The object form also turns it on, and can replace the
  label (e.g. "Robot name" instead of "Hostname") or give a first-start `default` (below).
- `false`, or leaving it out, turns it off: it isn't shown, and the Pi refuses it.
- When all five are off, the app hides the Device & Network tab. The device's own section
  (Device Data, Activity, Disconnect) then moves to the bottom of Application Settings.
- `wifi`, `hostname` and `timezone` are reserved: no app setting may use them as its `key`.

### appSettings: Application Settings

A list of groups, shown in the file's order. Each group is a heading with its settings under it:

| Property | Required | Meaning |
|---|---|---|
| `groupName` | yes | The heading. Each group needs its own name |
| `help` | no | A line of explanation under the heading |
| `onChange.restart` | no | systemd units to restart after a save that changes any setting in the group, e.g. `["myapp.service"]` |
| `onChange.reload` | no | systemd units to reload (`systemctl reload`, usually a SIGHUP) instead. A unit listed under both is only restarted |
| `items` | yes | The group's settings, in order: at least one |

Each item is one field in the form, and one value your programs read. Properties every item can
have:

| Property | Required | Meaning |
|---|---|---|
| `key` | yes | A unique ID across all groups: letters, digits, `_`, `.` or `-`, starting with a letter or `_`, up to 64 characters. It's the name other programs read the value by |
| `label` | yes | The field's name in the form |
| `type` | yes | `string`, `integer`, `number`, `boolean` or `select` (below) |
| `default` | no | The value until someone changes it (below) |
| `help` | no | A line of explanation under the field |
| `readOnly` | no | `true` shows the value but doesn't allow changing it (e.g. a serial number) |
| `onChange` | no | The same as the group's `onChange`, for this item only. It replaces the group's: an item with its own `onChange` doesn't also use the group's |

Properties by type:

| `type` | Value | Extra properties | In the app |
|---|---|---|---|
| `string` | text | `secret` (`true`: never sent back to the phone, shown as "set" or "not set"), `pattern` (a regular expression the whole value must match), `format` (`url`, `email` or `multiline`), `minLength`, `maxLength` | A text box with the keyboard to match `format` |
| `integer` | whole number | `min`, `max`, `step`, `unit` (a label such as `ms` or `%` shown beside the box) | The number pad, or a keyboard with a minus sign if `min` is below 0 |
| `number` | decimal number | the same as `integer` | The decimal pad, or a keyboard with a minus sign if `min` is below 0 |
| `boolean` | `true` / `false` | none | A switch |
| `select` | one of a list | `options` (required): `[{ "value": "...", "label": "..." }]` | A drop-down menu for up to 10 options; a searchable page for longer lists |

### Defaults

- **App settings:** until the phone saves a value, programs read the `default`. Changing a
  default in the file affects every setting the phone hasn't changed. "Reset to default" in the
  app removes one saved value; "Reset All to Defaults" (above Reboot) removes every saved app
  setting after a confirmation. Neither touches Wi-Fi, hostname or time zone.
- **Hostname and time zone** (`deviceSettings`): a `default` is applied once, on the service's
  first start, and only if the Pi is still on its factory value (hostname `raspberrypi`, time
  zone UTC). After that the Pi's own value is shown. Raspberry Pi Imager and `build-pifig-sd`
  usually set both already, so these defaults matter mostly for cards written another way.

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
  "deviceSettings": {
    "wifi": true,
    "allowReboot": true
  },
  "appSettings": [
    {
      "groupName": "Door",
      "help": "Changes restart the door program.",
      "onChange": { "restart": ["garage.service"] },
      "items": [
        {
          "key": "DOOR_OPEN_SECONDS",
          "label": "Door open time",
          "help": "How long the motor runs to open the door.",
          "type": "number",
          "min": 1,
          "max": 30,
          "step": 0.5,
          "unit": "s",
          "default": 12
        },
        {
          "key": "LOG_LEVEL",
          "label": "Log level",
          "type": "select",
          "options": [
            { "value": "info", "label": "Info" },
            { "value": "debug", "label": "Debug" }
          ],
          "default": "info",
          "onChange": { "reload": ["garage.service"] }
        }
      ]
    }
  ]
}
```

The phone shows Wi-Fi and Reboot under Device & Network (no hostname or time zone: they're off),
and a "Door" group with "Door open time" and "Log level" under Application Settings.
`garage.service` reads `DOOR_OPEN_SECONDS` and `LOG_LEVEL` through `pi-configurator-client`,
and can also get them through `export.envFile`. It's restarted when the door time changes (the
group's `onChange`), and only reloaded when the log level changes (the item's own). How
programs read settings and hear about changes:
[deploy/README.md](deploy/README.md#reading-settings-from-another-program).

## Sample Service: Using the Settings in Your Own Program

[samples/sample-service](samples/sample-service) is a complete example of a program on the Pi
that gets its settings from pi-configurator. Use it to see the whole loop working, or copy it as
the starting point for your own service. It drives a pretend light, speaker and display (it only
logs what each would do), and reads the four settings in the **Sample Service** group of
[config-template/config.json](config-template/config.json), one of each kind:

| Setting in the app | Key | Type | Applied |
|---|---|---|---|
| Light color | `color` | `select` | at once |
| Volume | `volume` | `integer`, 0 to 100 % in steps of 5 | at once |
| Start playing at boot | `autostart` | `boolean` | at the next start |
| Artist name | `artistName` | `string`, up to 60 characters | at once |

What it shows:

- **Reading:** all settings go into one typed, immutable `Settings` object through
  `pi-configurator-client`'s typed getters. Each is the value saved from the phone, else the
  config file's `default`, else a built-in fallback, so the program always starts.
- **Hearing changes:** `store.on_change` runs on the client's background thread, so its listener
  only queues a note. The main thread re-reads the settings, compares them with the last ones and
  applies only what changed, so the device code never runs on two threads at once.
- **Live and at-start settings:** color, volume and artist name apply the moment they're saved;
  autostart only matters when the service starts, so it's used at the next start.
- **Running as a service:** a systemd unit whose user is in the `pi-configurator` group (needed
  to read the settings), SIGHUP to reload (`systemctl reload`), and a clean stop on SIGTERM.
- **Robustness:** a value the code doesn't expect falls back to its default with a warning; an
  unreadable store keeps the last good settings. Its tests check that the code's keys, types,
  options and defaults match the template.

Try it on a Mac by pointing it at any `values.json` and editing that file while it runs
(`uv run sample-service --store /tmp/values.json` in `samples/sample-service`). On a Pi that
runs pi-configurator, install it with:

```bash
sudo samples/sample-service/deploy/install.sh
```

Then change its settings in pi-fig and follow them with `journalctl -u sample-service -f`. The
steps, and how your own project depends on the client:
[samples/sample-service/README.md](samples/sample-service/README.md).

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
| `scripts/pifig-sd.sh` | On the Mac with this repo: rebuilds build-pifig-sd when needed and runs it on the inserted card (logic in `pifig-sd.ts`) |
| `config-template/config.json` | The config file template, for a sample device whose settings `samples/sample-service` reads; also the demo device in the app |
| `samples/sample-service` | Example Python program on the Pi that reads its settings from pi-configurator and applies changes live (its own uv project) |
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
