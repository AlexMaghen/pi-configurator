/**
 * Bluetooth LE identifiers. These never change once devices ship; a new protocol version gets a
 * new service UUID.
 */
export const GATT = {
  /** Advertised; the app scans for it. */
  service: "7f48fb74-88e3-4082-ad7b-3bc0e0665132",
  /** Read, no session: JSON `DeviceInfo`. */
  info: "2c983635-7bab-4db2-afa8-e98c4992b855",
  /** Write with response: framed messages phone to Pi. */
  rpcIn: "488a2218-87bd-4e72-9721-bea73a6ddf90",
  /** Notify: framed messages Pi to phone. */
  rpcOut: "53e44350-1b30-4eb6-924a-7fee9b902440",
} as const;

/** How long an unlocked session may sit idle before the Pi closes it. */
export const SESSION_IDLE_TIMEOUT_S = 600;

/** Wrong-password backoff: free attempts, then a wait that doubles up to the cap. */
export const AUTH_BACKOFF = { freeAttempts: 5, firstWaitS: 30, maxWaitS: 900 } as const;
