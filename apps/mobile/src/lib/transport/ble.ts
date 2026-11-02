/**
 * Bluetooth LE transport through react-native-ble-plx.
 *
 * - Scans for the pi-configurator service UUID. For each new device it briefly connects, reads
 *   the `info` characteristic (no session needed) and disconnects, so the list can show the
 *   device's name and model before unlocking. Results are cached per device id.
 * - `connect()` opens a GATT connection, asks for a 517-byte MTU on Android (iOS negotiates by
 *   itself; `device.mtu` reports the result) and subscribes to `rpc-out` before anything else is
 *   sent, so no notification is missed.
 * - ble-plx moves values as base64 strings; the protocol's `toBase64` / `fromBase64` convert,
 *   since Hermes has no Buffer.
 *
 * Needs a development build: the native module is not in Expo Go. Without it (or in the iOS
 * Simulator, which has no Bluetooth) the radio reports "unsupported".
 */
import { PermissionsAndroid, Platform } from "react-native";
import { BleError, BleManager, State, type Device, type Subscription } from "react-native-ble-plx";
import { DeviceInfo, GATT, fromBase64, fromUtf8, toBase64 } from "@pi-configurator/protocol";
import { BUSY_MESSAGE, LinkError } from "../link/errors";
import type { DeviceTransport, DiscoveredDevice, GattConnection, RadioState } from "./types";

const ANDROID_MTU = 517;
/** Don't retry a device whose `info` read failed for this long. */
const INFO_RETRY_MS = 30_000;

let sharedManager: BleManager | null | undefined;

/** One BleManager for the app. `null` when the native module is missing. */
function manager(): BleManager | null {
  if (sharedManager === undefined) {
    try {
      sharedManager = new BleManager();
    } catch {
      sharedManager = null;
    }
  }
  return sharedManager;
}

const RADIO_STATES: Partial<Record<State, RadioState>> = {
  [State.PoweredOn]: "on",
  [State.PoweredOff]: "off",
  [State.Unauthorized]: "unauthorized",
  [State.Unsupported]: "unsupported",
};

/** Android 12+ asks for "Nearby devices"; older Android needs location for BLE scans. */
async function ensureAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const P = PermissionsAndroid.PERMISSIONS;
  if (typeof Platform.Version === "number" && Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([P.BLUETOOTH_SCAN!, P.BLUETOOTH_CONNECT!]);
    return Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  }
  const result = await PermissionsAndroid.request(P.ACCESS_FINE_LOCATION!);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export class BleTransport implements DeviceTransport {
  private readonly info = new Map<string, DeviceInfo>();
  private readonly infoFailedAt = new Map<string, number>();
  private readonly radioListeners = new Set<(state: RadioState) => void>();
  private infoQueue: Promise<void> = Promise.resolve();
  private readonly infoQueued = new Set<string>();
  /** Devices with an open DeviceLink; the scanner leaves them alone. */
  private readonly inUse = new Set<string>();
  private permissionDenied = false;

  scan(onDevice: (device: DiscoveredDevice) => void): () => void {
    const m = manager();
    if (!m) return () => undefined;
    let stopped = false;

    void ensureAndroidPermissions().then((granted) => {
      if (!granted) {
        this.permissionDenied = true;
        for (const listener of this.radioListeners) listener("unauthorized");
        return;
      }
      if (stopped) return;
      void m.startDeviceScan([GATT.service], { allowDuplicates: true }, (error, device) => {
        if (error || !device || stopped) return;
        onDevice(this.describe(device));
        this.queueInfoRead(device.id, (updated) => !stopped && onDevice(updated(device)));
      });
    });

    return () => {
      stopped = true;
      void m.stopDeviceScan();
    };
  }

  watchRadio(listener: (state: RadioState) => void): () => void {
    const m = manager();
    if (!m) {
      listener("unsupported");
      return () => undefined;
    }
    this.radioListeners.add(listener);
    const sub = m.onStateChange((state) => {
      listener(this.permissionDenied ? "unauthorized" : (RADIO_STATES[state] ?? "unknown"));
    }, true);
    return () => {
      this.radioListeners.delete(listener);
      sub.remove();
    };
  }

  owns(id: string): boolean {
    return !id.startsWith("demo-");
  }

  async connect(id: string): Promise<GattConnection> {
    const m = manager();
    if (!m) throw new Error("Bluetooth isn't available on this phone");
    await this.infoQueue; // Don't race the scanner's own short connection.
    this.inUse.add(id);
    try {
      let device = await m.connectToDevice(id, Platform.OS === "android" ? { requestMTU: ANDROID_MTU } : undefined);
      device = await device.discoverAllServicesAndCharacteristics();
      if (Platform.OS === "android" && device.mtu < ANDROID_MTU) {
        device = await m.requestMTUForDevice(id, ANDROID_MTU).catch(() => device);
      }
      return new BleGattConnection(m, device.id, device.mtu, () => this.inUse.delete(id));
    } catch (err) {
      this.inUse.delete(id);
      throw err;
    }
  }

  // -------------------------------------------------------------------------------------------

  private describe(device: Device): DiscoveredDevice {
    const info = this.info.get(device.id);
    return {
      id: device.id,
      name: info?.name ?? device.localName ?? device.name ?? "Unnamed device",
      model: info?.model,
      rssi: device.rssi ?? undefined,
      protocol: info?.protocol,
      serviceVersion: info?.serviceVersion,
      demo: false,
      lastSeen: Date.now(),
    };
  }

  /** Reads `info` once per device, one device at a time. */
  private queueInfoRead(id: string, done: (updated: (device: Device) => DiscoveredDevice) => void): void {
    const failedAt = this.infoFailedAt.get(id);
    if (this.info.has(id) || this.infoQueued.has(id) || this.inUse.has(id)) return;
    if (failedAt !== undefined && Date.now() - failedAt < INFO_RETRY_MS) return;
    const m = manager();
    if (!m) return;
    this.infoQueued.add(id);
    this.infoQueue = this.infoQueue.then(async () => {
      try {
        if (this.inUse.has(id)) return;
        const device = await m.connectToDevice(id, { timeout: 8000 });
        await device.discoverAllServicesAndCharacteristics();
        const characteristic = await m.readCharacteristicForDevice(id, GATT.service, GATT.info);
        const info = DeviceInfo.parse(JSON.parse(fromUtf8(fromBase64(characteristic.value ?? ""))));
        this.info.set(id, info);
        done((d) => this.describe(d));
      } catch {
        this.infoFailedAt.set(id, Date.now());
      } finally {
        this.infoQueued.delete(id);
        if (!this.inUse.has(id)) await m.cancelDeviceConnection(id).catch(() => undefined);
      }
    });
  }
}

/** ATT error 0x03 "Write Not Permitted": the Pi's answer while another phone holds it. */
const ATT_WRITE_NOT_PERMITTED = 3;

function isBusyError(err: unknown): boolean {
  if (!(err instanceof BleError)) return false;
  return err.attErrorCode === ATT_WRITE_NOT_PERMITTED || /not permitted|busy/i.test(err.reason ?? err.message);
}

/** One open connection. Notifications are subscribed in the constructor, before any request. */
class BleGattConnection implements GattConnection {
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<(reason: string) => void>();
  private readonly subscriptions: Subscription[] = [];
  private closed = false;

  constructor(
    private readonly m: BleManager,
    private readonly id: string,
    readonly mtu: number,
    private readonly onClosed: () => void,
  ) {
    this.subscriptions.push(
      m.monitorCharacteristicForDevice(id, GATT.service, GATT.rpcOut, (error, characteristic) => {
        if (error || !characteristic?.value) return; // Errors surface through onDeviceDisconnected.
        const frame = fromBase64(characteristic.value);
        for (const listener of this.frameListeners) listener(frame);
      }),
      m.onDeviceDisconnected(id, (error) => this.finish(error?.message ?? "The device disconnected")),
    );
  }

  async readInfo(): Promise<Uint8Array> {
    const characteristic = await this.m.readCharacteristicForDevice(this.id, GATT.service, GATT.info);
    return fromBase64(characteristic.value ?? "");
  }

  async writeFrame(frame: Uint8Array): Promise<void> {
    try {
      await this.m.writeCharacteristicWithResponseForDevice(this.id, GATT.service, GATT.rpcIn, toBase64(frame));
    } catch (err) {
      throw isBusyError(err) ? new LinkError("busy", BUSY_MESSAGE) : err;
    }
  }

  onFrame(listener: (frame: Uint8Array) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onDisconnect(listener: (reason: string) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.m.cancelDeviceConnection(this.id).catch(() => undefined);
    this.finish("Disconnected");
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const sub of this.subscriptions.splice(0)) sub.remove();
    for (const listener of this.disconnectListeners) listener(reason);
    this.disconnectListeners.clear();
    this.frameListeners.clear();
    this.onClosed();
  }
}
