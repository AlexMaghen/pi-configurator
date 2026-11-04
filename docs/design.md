# pi-configurator: design (Nov 2026)

Status: **agreed by the owner on 2026-11-01.** Implementation has started. The exact wire
formats (config schema, RPC messages, framing, SRP formulas, session keys) are defined in code in
`packages/protocol/src/` and are authoritative where this doc is less precise.
Background and research are in [background.md](background.md).

## 1. What it is

Two programs with the same name:

- **pi-configurator service**: a Python systemd service on the Pi. It advertises over Bluetooth LE
  whenever it runs, and lets an authenticated phone read and change the device's settings.
- **pi-configurator app**: an Expo app, iPhone first and Android-ready. It finds nearby devices,
  unlocks one with its password, and draws a settings form from the field list the device sends.

Everything the device offers is described by **one JSON config file** on the Pi. The app has no
device-specific code.

## 2. Decisions so far

| Topic | Decision |
|---|---|
| Repository | One monorepo for the service, the app and the shared protocol |
| Setup mode | None. The service always listens while it runs (may change later) |
| Config | One JSON file: Bluetooth name, access password, list of setting fields, with defaults |
| Pairing | Open BLE pairing ("Just Works"); not relied on for security |
| Access | The password from the config file, checked with a protocol that never sends it (section 6) |
| Where values go | Each field either changes a system setting (e.g. Wi-Fi) or is saved in a key/value store other apps on the Pi can read |
| Global rules | May be broken where the project calls for it (Python inside the monorepo, no web backend stack) |

## 3. The config file

Path: `/etc/pi-configurator/config.json`, owned by root, mode `0600` (it holds the password).
Edited by hand or by a device's install script, not by the phone (v1).

```json
{
  "$schema": "https://example.invalid/pi-configurator/config.schema.json",
  "version": 1,
  "bluetooth": {
    "name": "BallsPi"
  },
  "access": {
    "password": "1234"
  },
  "export": {
    "envFile": "/var/lib/pi-configurator/ballspi.env"
  },
  "deviceSettings": {
    "wifi": true,
    "hostname": { "label": "Device hostname", "default": "ballspi" },
    "timezone": true,
    "allowReboot": false,
    "allowAccessChanges": false
  },
  "appSettings": [
    {
      "groupName": "Balls",
      "onChange": { "restart": ["studfs-robots.service"] },
      "items": [
        {
          "key": "BALLS_DISPENSE_MS",
          "label": "Dispense time",
          "help": "How long the gate stays open per ball.",
          "type": "integer",
          "min": 100,
          "max": 5000,
          "unit": "ms",
          "default": 800
        }
      ]
    },
    {
      "groupName": "Stream",
      "items": [
        { "key": "PLAYSTREAM_URL", "label": "Stream URL", "type": "string", "format": "url", "default": "" },
        { "key": "HK_API_KEY", "label": "API key", "type": "string", "secret": true }
      ]
    }
  ]
}
```

The file has two settings sections, one per tab in the app:

- `deviceSettings` (**Device & Network**): which of the Pi's own settings (section 3.2) and
  actions (section 3.1a) the phone offers. Their labels and help are fixed in the app; a config
  can only replace a label.
- `appSettings` (**Application Settings**): the device's own settings, in named groups, saved in
  the key/value store for its programs (section 4).

A tab with nothing on it is hidden. When Device & Network is hidden, the device's own section
(Device Data, Activity, Disconnect) moves to the bottom of Application Settings.

### 3.1 Groups and items

A group:

| Property | Required | Meaning |
|---|---|---|
| `groupName` | yes | Section heading; unique. Groups appear in the file's order |
| `help` | no | One line under the heading |
| `onChange` | no | What a change to any item in the group does (`restart`, `reload` below), unless the item has its own |
| `items` | yes | At least one item, in order |

An item:

| Property | Required | Meaning |
|---|---|---|
| `key` | yes | Unique across all groups; the key other apps read. `wifi`, `hostname` and `timezone` are reserved |
| `label` | yes | Shown in the form |
| `type` | yes | `string`, `integer`, `number`, `boolean`, `select` |
| `default` | no | Initial value (section 3.3) |
| `help` | no | One line under the field |
| `secret` | no | Never sent back to the phone; the form shows "set" / "not set" and allows replacing it |
| `min`, `max`, `step`, `unit` | no | Numbers. `unit` is a label shown beside the field ("s", "ms", "%"). With `min` of 0 or more the phone shows the number pad (`integer`) or the decimal pad (`number`); otherwise a keyboard with a minus sign |
| `pattern`, `format`, `minLength`, `maxLength` | no | Strings; `format` is `url`, `email` or `multiline` |
| `options` | for `select` | `[{ "value": "...", "label": "..." }]`. Up to 10 options show as a drop-down menu on the field; longer lists open a searchable page |
| `readOnly` | no | Shown but not editable (e.g. a serial number) |
| `onChange.restart` | no | systemd units to restart after this item changes (once per save, not per item). Replaces the group's `onChange` |
| `onChange.reload` | no | systemd units to `systemctl reload` (ExecReload=, usually SIGHUP) after this item changes; a unit also under `restart` is only restarted |

The service rejects a config file that breaks these rules at startup, with a clear log message.

`deviceDescription` (optional, up to 1,000 characters) is a few sentences about the device. The
app shows it under the device name at the top of the device screen, in the help-text style.

### 3.1a Permissions

Things the phone may do beyond editing settings, in `deviceSettings`. Both are off when left out.

| Property | When `true` |
|---|---|
| `deviceSettings.allowReboot` | The app shows a Reboot button; `system.reboot` asks for confirmation in the app, then reboots the Pi |
| `deviceSettings.allowAccessChanges` | The app can change the access password and the Bluetooth name. The service rewrites `config.json` atomically, re-advertises under the new name, and ends every other open session after a password change |

When a permission is off, the matching RPC method is refused and the app hides the control.
The phone can't change the permissions themselves; that is file-only.

### 3.2 The Pi's own settings (v1)

Each is `true`, an object (`label`, and `default` for hostname and time zone), or off. The
service applies them itself; their keys in `settings.get` / `settings.set` are their names, and
Device & Network shows them in this order:

| Setting | What it does |
|---|---|
| `wifi` | Scan, join, forget, through NetworkManager (D-Bus). Value is `{ ssid, password, hidden }`; the password is always secret |
| `hostname` | Sets the hostname (`hostnamectl`), keeps `/etc/hosts` in step |
| `timezone` | `timedatectl set-timezone`, from every zone the Pi knows |

More (Bluetooth name, SSH on/off, locale) can come later. Their current values are read live
from the system, not from the store.

### 3.3 Defaults

- **App settings:** the store starts empty. Reading a key with no saved value returns the config
  default. Changing a default in the config takes effect for every key the phone never changed.
  Clearing a value in the app returns it to the default.
- **Hostname and time zone:** a default is applied **once**, on the service's first start, and
  only if the Pi is still on its factory value (hostname `raspberrypi`, time zone UTC). After
  that the system's live value wins. The service records "first-start defaults applied" in its
  state file so this doesn't run again. Wi-Fi has no default: Raspberry Pi Imager sets it.

## 4. The key/value store

Other programs on the Pi read the values the phone saved.

- **File:** `/var/lib/pi-configurator/values.json`. Only the service writes it, atomically
  (write temp file, fsync, rename). Owned by root, group `pi-configurator`, mode `0640`. Add an
  app's service user to that group to let it read.
- **Python client package** `pi-configurator-client` (in the monorepo, pip-installable):

  ```python
  from pi_configurator_client import Store

  store = Store()                          # reads values.json + defaults from config
  ms = store.get_int("BALLS_DISPENSE_MS")  # saved value, else the config default
  store.on_change(lambda keys: reload())   # optional: changed keys

  @store.on_setting("BALLS_DISPENSE_MS")   # optional: one key, old and new value
  def setting_updated(old, new): ...
  ```

  Listeners wake on the service's D-Bus signal (below) when the `dbus` extra is installed, and
  otherwise poll the file every second.

  The client needs the defaults too, so the service also writes them into the store file next
  to the values (`{"values": {...}, "defaults": {...}}`). The client never opens the root-only
  config file.
- **Env-file export** (optional, in v1): `"export": { "envFile": "/var/lib/pi-configurator/ballspi.env" }`
  writes all store keys as `KEY=value` lines (in a marked block) on every save. For BallsPi, its
  systemd units add `EnvironmentFile=-/var/lib/pi-configurator/ballspi.env`; real environment
  variables beat `.env.production` in pydantic-settings, so its settings classes need no code
  changes, and the committed `.env.production` in studfs-robots is never touched.
- **Change signal:** after a save that changes store values, the service emits
  `org.piconfigurator.Settings1.Changed(as keys)` on the system D-Bus, from
  `/org/piconfigurator/settings`, under the name `org.piconfigurator`. The signal carries key
  names only, so it can go to everyone; values stay behind the store file's permissions. A
  forged signal only makes a listener re-read the file.
- **Restarts and reloads:** after a save, the service restarts each unit named in
  `onChange.restart` of a changed field, then reloads each unit in `onChange.reload`. Both happen
  after the store file and env file are written and the signal has gone out. The phone sees
  `service.reloading` / `service.reloaded` status events and a `reloaded` list in the result.

## 5. Bluetooth layout

One GATT service with a fixed 128-bit UUID that the app scans for. Advertised name is
`bluetooth.name`.

| Characteristic | Access | Content |
|---|---|---|
| `info` | read, no auth | `{ protocol, name, model, serviceVersion }`. Lets the app list and label devices before unlocking |
| `rpc-in` | write | Phone to Pi messages |
| `rpc-out` | notify | Pi to phone messages |

All messages after `info` go through `rpc-in` / `rpc-out` as small RPC calls rather than one
characteristic per feature. Messages are JSON, split into frames to fit the BLE MTU (iOS
typically allows about 180 bytes): each frame has first/last/encrypted flags, a frame index, and
the first frame carries the total length. The exact byte layout is in
`packages/protocol/src/framing.ts`.

RPC methods (all except the handshake require an unlocked session):

| Method | Purpose |
|---|---|
| `auth.start`, `auth.finish` | Password handshake (section 6) |
| `settings.describe` | The config's `deviceSettings` and `appSettings` as written (secret items lose their default), `deviceDescription`, and the Pi's time zones when time zone is on |
| `settings.get` | Current values; secret fields come back as `{ "set": true }` |
| `settings.set` | Change some fields; validated, applied, returns per-field results |
| `wifi.scan` | Nearby networks (SSID, signal, security) from the Pi's radio; iOS can't list them |
| `system.details` | Read-only report for support (Device Data in the app): hardware, OS, network, Bluetooth, the service, as titled sections of label / value lines; lines the Pi can't read are left out |
| `system.reboot` | Reboot the Pi; only if `deviceSettings.allowReboot` |
| `access.setPassword`, `access.setName` | Change the password or Bluetooth name; only if `deviceSettings.allowAccessChanges` |
| `status` | Notifications: "Wi-Fi connecting", "connected, IP 192.168.1.40", "restarted studfs-robots" |

## 6. Security: password check without sending the password

**Problem.** Open pairing gives no link encryption that we can trust, so anything on the radio can
be overheard by someone nearby. Both the access password and the Wi-Fi password must not cross
as plain text.

**Approach: SRP-6a, then an encrypted session.** This is what Espressif's "Security 2" uses for
ESP32 provisioning.

1. The phone and Pi run the SRP-6a handshake (RFC 5054, 3072-bit group, SHA-512). The password
   itself is never sent. A listener learns nothing that lets them test passwords offline.
2. Both sides end up with the same session key only if the password was right; each side proves it
   to the other, so the phone also knows it's talking to the real device.
3. Every later message is encrypted with AES-256-GCM using that key, with a counter as the nonce.
4. Sessions end on disconnect or after 10 minutes idle. The Pi serves one phone at a time, so a
   phone connected without an unlocked session for 2 minutes (`UNLOCK_TIMEOUT_S`) is
   disconnected; a device that never unlocks can't keep everyone else out.
5. Wrong passwords are rate-limited: after 5 failures, wait 30 s, doubling to a 15-minute cap.

**Where the password lives.** The config holds it as plain text (owner's decision), protected by
mode `0600`. There is no hashed form. The service computes the SRP verifier from it in memory at
startup.

**What it doesn't protect against:** someone with root on the Pi, or a guessable password.
The service logs a warning at startup if the password is shorter than 8 characters or still the
example value.

**Libraries.** Pi: `cryptography` for AES-GCM, SRP implemented to RFC 5054 (small, tested
against the RFC's test vectors) or the `srp` package if it matches. Phone: `@noble/hashes` and
`@noble/ciphers` (pure TypeScript, run on Hermes) with the same SRP code. Shared test vectors in
the monorepo make sure both sides agree.

## 7. The app

- Expo with a development build (BLE doesn't run in Expo Go). BLE through `react-native-ble-plx`.
- Screens, each its own route (expo-router):
  - **Devices**: nearby pi-configurator devices from scan + `info`.
  - **Unlock**: password entry. Once it works, it's saved per device in the iOS Keychain /
    Android Keystore and used automatically next time; "Forget password" removes it. A saved
    password that stops working is dropped and the app asks again.
  - **Settings**: Device & Network and Application Settings, built from `settings.describe`;
    a tab with nothing on it is hidden. Save sends only changed fields.
  - **Wi-Fi**: scan list from the Pi, join, current connection.
  - **Status**: live notifications while applying.
- Form controls by type: text, number with limits and unit, switch, picker, secret
  (replace-only), Wi-Fi picker.
- Validation runs in the app (from the shared rules) and again on the Pi, which is the authority.
- Styling with plain stylesheets in a shared theme module; icons from a shared SVG set (no symbol
  characters as icons).

## 8. Monorepo layout

```
pi-configurator/
  apps/
    mobile/                 Expo app "pi-configurator"
  packages/
    protocol/               Shared contract (TypeScript source of truth)
      src/config.ts           zod schema for config.json and fields
      src/rpc.ts              zod schemas for RPC messages
      json-schema/            config.schema.json, rpc.schema.json (generated from zod)
      test-vectors/           SRP + AES-GCM + framing vectors used by both sides
  python/                   uv workspace
    service/                pi-configurator service (bless or bluez-peripheral, dbus-fast)
      pi_configurator/protocol/  pydantic models generated from json-schema/
    client/                 pi-configurator-client (store reader for other apps)
  deploy/
    pi-configurator.service systemd unit
    install.sh              apt deps, user/group, dirs, unit
  config-template/
    config.json             config template (BallsPi); install.sh default, app demo device
  docs/
  turbo.json, package.json  JS workspaces; Python tasks wrapped as turbo tasks
```

**One source of truth for the contract:** zod schemas in `packages/protocol` produce JSON Schema,
and `datamodel-code-generator` turns that into pydantic models for the service. A CI check fails
if the generated Python is out of date.

**The pydantic helper from the earlier discussion** becomes optional: a small command,
`pi-configurator fields-from-pydantic module:Class`, prints an `appSettings` group for the config
file from a device's existing settings class. Useful for BallsPi; not required.

## 9. Running on the Pi

- systemd unit `pi-configurator.service`, starts after `bluetooth.service` and
  `NetworkManager.service`, restarts on failure.
- Runs as root in v1 (needs BlueZ, NetworkManager, hostnamectl, unit restarts). Later: a dedicated
  user with polkit rules.
- Logs to the journal. `pi-configurator check` validates the config file without starting.
- Target: Pi OS Trixie (BlueZ 5.7x+, NetworkManager by default), Pi 4B / Pi 5 / Zero 2 W.

## 10. Build order

1. `packages/protocol`: zod schemas, JSON Schema export, test vectors.
2. Python service: config loading and validation, store, client package. Unit tests without BLE.
3. BLE layer: GATT service, framing, `info`. Test with nRF Connect.
4. SRP handshake and encryption, tested against the shared vectors.
5. Handlers: Wi-Fi, hostname, timezone. Test on BallsPi.
6. Expo app: devices, unlock, settings form, Wi-Fi, status.
7. BallsPi rollout: its `config.json`, env-file export, restart of `studfs-robots.service`.

## 11. Answered questions (2026-11-01)

1. **System-setting defaults:** applied once on first start if the system has nothing set.
2. **Changing the password or Bluetooth name from the phone:** controlled by
   `deviceSettings.allowAccessChanges`, default off.
3. **Env-file export:** in v1.
4. **Password in the config:** plain text only, no hashed form.
5. **Saved passwords in the app:** remembered per device in the Keychain / Keystore, with
   "Forget password".
6. **Git:** replace the leftover `.git` folder with a fresh repository (`main`) when coding starts.
7. **Reboot:** controlled by `deviceSettings.allowReboot`, default off.

## 12. Still open

Nothing. Ready for the owner's sign-off.
