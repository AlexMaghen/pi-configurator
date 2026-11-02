"""Bluetooth LE transport. `bridge` is plain Python (tested on macOS); `bluez` talks to BlueZ
over D-Bus and is Linux-only, so nothing imports it until `pi-configurator run` does."""
