"""Bluetooth LE identifiers and session limits (packages/protocol/src/gatt.ts).

These never change once devices ship; a new protocol version gets a new service UUID.
"""

from typing import Final

#: Advertised; the app scans for it.
SERVICE_UUID: Final = "7f48fb74-88e3-4082-ad7b-3bc0e0665132"
#: Read, no session: JSON DeviceInfo.
INFO_UUID: Final = "2c983635-7bab-4db2-afa8-e98c4992b855"
#: Write with response: framed messages phone to Pi.
RPC_IN_UUID: Final = "488a2218-87bd-4e72-9721-bea73a6ddf90"
#: Notify: framed messages Pi to phone.
RPC_OUT_UUID: Final = "53e44350-1b30-4eb6-924a-7fee9b902440"

#: How long an unlocked session may sit idle before the Pi closes it.
SESSION_IDLE_TIMEOUT_S: Final = 600

#: How long a phone may stay connected without an unlocked session (from connecting, or from its
#: session ending) before the Pi disconnects it. The Pi serves one phone at a time, so this stops
#: a device that never unlocks from keeping everyone else out.
UNLOCK_TIMEOUT_S: Final = 120

#: Wrong-password backoff: free attempts, then a wait that doubles up to the cap.
AUTH_FREE_ATTEMPTS: Final = 5
AUTH_FIRST_WAIT_S: Final = 30
AUTH_MAX_WAIT_S: Final = 900
