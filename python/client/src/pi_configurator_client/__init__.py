"""Read settings saved by the pi-configurator service. No dependencies beyond the standard library.

    from pi_configurator_client import Store

    store = Store()                          # /var/lib/pi-configurator/values.json
    lead = store.get_float("BALLS_OPEN_DOOR_LEAD_SECONDS")  # saved value, else the config default
    store.on_change(lambda keys: reload())   # optional; polls the file in a background thread

The reading program's user must be in the `pi-configurator` group (the file is mode 0640).
"""

from .store import DEFAULT_PATH, Store, StoreError

__all__ = ["DEFAULT_PATH", "Store", "StoreError"]
__version__ = "0.1.0"
