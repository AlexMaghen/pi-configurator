# pi-configurator: background and research (Nov 2026)

Notes carried over from the conversation where this project started, so a new chat has the context.
Nothing is implemented yet.

## Goal

Set up a Raspberry Pi over Bluetooth (BLE) from a phone, at first boot or when the owner asks, before
it runs as an IoT device. Settings include:
- **Wi-Fi** (network and password)
- **app-specific settings** for whatever the Pi runs (e.g. actuator timings, stream URL, device name)

The plan is one generic iPhone app that works for every Pi project, not a separate app per device.

## What already exists (researched 2026-11-01)

| Option | Wi-Fi | Own settings | iPhone | Notes |
|---|---|---|---|---|
| nymea-networkmanager + BerryLan app | yes | no | BerryLan app (check it's still maintained) | Meshtastic's Pi image uses nymea-networkmanager |
| Remote.it BLE onboarding | yes | no | yes | Their image and app, tied to their remote-access service |
| Improv Wi-Fi (ESPHome / Home Assistant) | yes | limited | mostly Web Bluetooth, which iPhone Safari doesn't support | Nothing current found for the Pi |
| Generic iPhone BLE Wi-Fi apps (e.g. "BLE WiFi Setup – IoT Devices", 2026) | yes | no | yes | You write the matching Pi service yourself |
| Espressif ESP-IDF BLE provisioning | yes | partial (custom-data hook) | open-source iOS app | Made for ESP32; a good model for the protocol and security |
| Pi as its own Wi-Fi hotspot with a settings page (comitup, balena wifi-connect) | yes | yes | any phone, no app | No Bluetooth; the phone leaves home Wi-Fi during setup |
| nRF Connect / LightBlue | by hand | by hand | yes | Good for testing the Pi side before the app exists |
| provision-ble (gitee, 2026) | planned | ? | Web Bluetooth only | Early stage, Pi 4/CM4 on Trixie |

Conclusion: nothing generic covers app-specific settings with a good iPhone app, so build it, and make it generic.

Sources:
- https://meshtastic.org/docs/software/mpwrd-os/provisioning/
- https://remote.it/solutions/raspberry-pi-ble-wifi-onboarding
- https://gitee.com/mybluetooth/provision-ble
- https://mwm.ai/apps/ble-wifi-setup-iot-devices/6760410005
- https://github.com/oluckyman/esp-idf-ble_prov_and_custom_config
- https://components.espressif.com/components/embedblocks/wifi-manager/versions/0.2.0/examples/basic_provisioning

## Proposed design (draft, not agreed yet)

**On the Pi (Python, per the owner's rule for Pi projects):**
- A BLE service on BlueZ, using `bless` or `bluez-peripheral`. Its characteristics:
  - **Device info**
  - **Settings description**: JSON listing each setting's key, label, type, limits, default, and whether it's secret
  - **Settings values**: read/write JSON, split into chunks
  - **Wi-Fi scan / join**, through NetworkManager (`nmcli` or D-Bus); Pi OS Trixie uses NetworkManager by default
  - **Apply/status** notifications, e.g. "Wi-Fi connected", "service restarted"
- Values are saved to the app's settings file (e.g. `.env.production`), then the app's service restarts.

**Security (BLE "Just Works" pairing doesn't verify who connects, and the Wi-Fi password crosses it):**
- Setup is open only when there's no Wi-Fi yet, or after a long press of the device's button, and only for a limited time.
- A PIN printed on the device, plus an encrypted session derived from it (Espressif's "Security 1/2" is the model).
- Bluetooth off once setup is done.

**On the phone (Expo, iPhone first and Android-ready, per the owner's rules):**
- `react-native-ble-plx`. BLE needs an Expo development build; it won't run in Expo Go.
- The app scans for the setup service, reads the settings description, and draws the form from it, so adding a setting never needs an app update.
- The Wi-Fi list comes from the Pi's scan, because iOS doesn't let apps list Wi-Fi networks.

**Suggested order:** build the Pi side first and test it with nRF Connect, then the app.

## First target device

`BallsPi` runs the StuDfs HomeKit accessories:
- Code: `../StuDfs/studfs-robots` (GitHub `AlexMaghen/studfs-robots`)
- Hardware: Raspberry Pi 4B on Pi OS Trixie, Wi-Fi only, reached with `ssh studfs-pi` (pi@ballspi.local)

Its settings are environment variables (`HK_*`, `BALLS_*`, `PLAYSTREAM_*`) in `.env.production`, with typed pydantic-settings classes. Those classes are a natural source for the settings description.

It has a push button on GPIO 26: a quick press is an emergency stop, a 10 s hold reboots. A medium hold could open setup mode.

## Open questions

- One monorepo for the Pi package and the Expo app? (The owner's rules favour sharing types and schemas across them.)
- Where the settings description comes from: generated from pydantic models, or hand-written JSON Schema?
- How setup mode is triggered on a device with no button.
- How much the security needs: a PIN with an encrypted session, or BLE pairing alone.
