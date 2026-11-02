/**
 * The transport boundary: what `DeviceLink` needs from a connected device, and what the device
 * list needs from a scanner.
 *
 * Two implementations exist: Bluetooth LE through react-native-ble-plx (`ble.ts`) and the
 * in-memory demo Pi (`../demo`). Everything above this line (framing, SRP, encryption, RPC) is
 * shared, so the demo exercises the same client code a real device does.
 *
 * Values cross this boundary as raw bytes; base64 for ble-plx happens inside `ble.ts`.
 */

/** One open GATT connection to a pi-configurator service. */
export interface GattConnection {
  /** Negotiated ATT MTU in bytes. Frames are `mtu - 3` bytes, never smaller than 20. */
  readonly mtu: number;
  /** Reads the `info` characteristic (JSON `DeviceInfo`, readable without a session). */
  readInfo(): Promise<Uint8Array>;
  /** Writes one frame to `rpc-in` with response. Callers serialize writes. */
  writeFrame(frame: Uint8Array): Promise<void>;
  /** Subscribes to `rpc-out` notifications. Returns an unsubscribe function. */
  onFrame(listener: (frame: Uint8Array) => void): () => void;
  /** Called once when the connection drops for any reason (including `close()`). */
  onDisconnect(listener: (reason: string) => void): () => void;
  /** Closes the connection. Safe to call more than once. */
  close(): Promise<void>;
}

/** Radio state as the device list shows it. */
export type RadioState = "on" | "off" | "unauthorized" | "unsupported" | "unknown";

/** A device seen by a scan. `info` is filled in once its `info` characteristic was read. */
export interface DiscoveredDevice {
  /** Stable per phone: the ble-plx device id, or `demo-...` for the demo device. */
  id: string;
  /** Advertised name, or the name from `info` once known. */
  name: string;
  model?: string;
  /** Signal strength in dBm, when the scan reported one. */
  rssi?: number;
  protocol?: number;
  serviceVersion?: string;
  demo: boolean;
  /** `Date.now()` of the last advertisement. */
  lastSeen: number;
}

/** Finds devices and opens connections to them. */
export interface DeviceTransport {
  /** Starts scanning; `onDevice` is called for every advertisement. Returns a stop function. */
  scan(onDevice: (device: DiscoveredDevice) => void): () => void;
  /** Watches the radio state. Returns an unsubscribe function. */
  watchRadio(listener: (state: RadioState) => void): () => void;
  /** Whether this transport owns the given device id. */
  owns(id: string): boolean;
  /** Opens a GATT connection to a device found by `scan`. */
  connect(id: string): Promise<GattConnection>;
}
