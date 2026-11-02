/**
 * DeviceDirectory: the Bluetooth transport plus, when enabled, the demo device, behind one
 * `DeviceTransport`. The device list scans through this and never knows which is which, other
 * than the `demo` flag it shows as a label.
 */
import type { DeviceTransport, DiscoveredDevice, GattConnection, RadioState } from "./types";

export class DeviceDirectory implements DeviceTransport {
  private demoEnabled = false;
  private activeScan?: { onDevice: (d: DiscoveredDevice) => void; stopDemo?: () => void };

  constructor(
    private readonly radio: DeviceTransport,
    private readonly demo?: DeviceTransport,
  ) {}

  /** Turns the demo device on or off, also during a running scan. */
  setDemoEnabled(on: boolean): void {
    if (this.demoEnabled === on) return;
    this.demoEnabled = on;
    if (!this.activeScan) return;
    if (on && this.demo) this.activeScan.stopDemo = this.demo.scan(this.activeScan.onDevice);
    else {
      this.activeScan.stopDemo?.();
      this.activeScan.stopDemo = undefined;
    }
  }

  scan(onDevice: (device: DiscoveredDevice) => void): () => void {
    const stopRadio = this.radio.scan(onDevice);
    const scan: { onDevice: typeof onDevice; stopDemo?: () => void } = { onDevice };
    if (this.demoEnabled && this.demo) scan.stopDemo = this.demo.scan(onDevice);
    this.activeScan = scan;
    return () => {
      stopRadio();
      scan.stopDemo?.();
      if (this.activeScan === scan) this.activeScan = undefined;
    };
  }

  /** The radio state is the phone's Bluetooth; the demo device doesn't need it. */
  watchRadio(listener: (state: RadioState) => void): () => void {
    return this.radio.watchRadio(listener);
  }

  owns(id: string): boolean {
    return this.radio.owns(id) || (this.demo?.owns(id) ?? false);
  }

  connect(id: string): Promise<GattConnection> {
    if (this.demo?.owns(id)) {
      if (!this.demoEnabled) return Promise.reject(new Error("The demo device is turned off"));
      return this.demo.connect(id);
    }
    return this.radio.connect(id);
  }
}
