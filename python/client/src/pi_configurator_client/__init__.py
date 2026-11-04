"""Read settings saved by the pi-configurator service. No dependencies beyond the standard library
(add the `dbus` extra to hear about changes at once instead of within a second).

    from pi_configurator_client import Store

    store = Store()                          # /var/lib/pi-configurator/values.json
    lead = store.get_float("BALLS_OPEN_DOOR_LEAD_SECONDS")  # saved value, else the config default

    store.on_change(lambda keys: reload())   # optional: any change, with the changed keys

    @store.on_setting("BALLS_DISPENSE_MS")   # optional: one key, with its old and new value
    def setting_updated(old, new): ...

The reading program's user must be in the `pi-configurator` group (the file is mode 0640).
"""

from .store import DEFAULT_PATH, Listener, SettingListener, Store, StoreError

__all__ = ["DEFAULT_PATH", "Listener", "SettingListener", "Store", "StoreError"]
__version__ = "0.2.0"
