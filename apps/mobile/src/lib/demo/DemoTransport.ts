/**
 * The demo device as a `DeviceTransport`, so the device list and `DeviceLink` treat it like any
 * Bluetooth device. It "advertises" once a second with a slightly varying signal.
 */
import type { DeviceTransport, DiscoveredDevice, GattConnection, RadioState } from "../transport/types";
import { DemoPi } from "./DemoPi";
import { DEMO_DEVICE_ID, DEMO_MODEL, demoConfig } from "./demoConfig";

export class DemoTransport implements DeviceTransport {
  readonly pi: DemoPi;

  constructor(randomBytes: (length: number) => Uint8Array) {
    this.pi = new DemoPi({ config: demoConfig(), model: DEMO_MODEL, randomBytes });
  }

  scan(onDevice: (device: DiscoveredDevice) => void): () => void {
    const advertise = () => {
      if (!this.pi.advertising) return;
      onDevice({
        id: DEMO_DEVICE_ID,
        name: this.pi.advertisedName,
        model: this.pi.model,
        rssi: -52 - Math.round(Math.random() * 8),
        protocol: 1,
        serviceVersion: "demo",
        demo: true,
        lastSeen: Date.now(),
      });
    };
    advertise();
    const timer = setInterval(advertise, 1000);
    return () => clearInterval(timer);
  }

  watchRadio(listener: (state: RadioState) => void): () => void {
    listener("on");
    return () => undefined;
  }

  owns(id: string): boolean {
    return id === DEMO_DEVICE_ID;
  }

  async connect(id: string): Promise<GattConnection> {
    if (!this.owns(id)) throw new Error(`Unknown demo device ${id}`);
    // A real connection takes a moment; keeps the UI's "Connecting" state visible.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return this.pi.connect();
  }
}
