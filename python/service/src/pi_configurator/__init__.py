"""pi-configurator service: set up a Raspberry Pi over Bluetooth LE from a phone.

Layout:
  protocol/  the shared contract (mirrors packages/protocol/src): config models and rules, value
             checks, SRP-6a, session crypto, framing, RPC constants
  core/      transport-independent service logic: connections, RPC dispatch, store, state
  system/    system adapters (NetworkManager, hostname, timezone, systemd) behind interfaces
  ble/       the BlueZ GATT server (Linux only, imported lazily)
"""

__version__ = "0.2.0"
