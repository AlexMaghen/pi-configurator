/**
 * The demo device's config: the config template `config-template/config.json` (set up for
 * BallsPi), so the demo shows exactly the form the first real device will. Parsed with the
 * shared `Config` schema, which also checks the template stays valid.
 *
 * The demo turns `allowAccessChanges` on so the Change password and Rename screens can be tried;
 * everything else is as in the file.
 */
import { Config, type DeviceSettings } from "@pi-configurator/protocol";
import ballspi from "../../../../../config-template/config.json";

export const DEMO_DEVICE_ID = "demo-ballspi";
export const DEMO_MODEL = "Raspberry Pi 4 Model B Rev 1.5";

/** The template's password; the demo's unlock screen shows it as a hint. */
export const DEMO_PASSWORD = ballspi.access.password;

/** `overrides` replace `deviceSettings` entries (tests turn settings and permissions on and off). */
export function demoConfig(overrides: Partial<DeviceSettings> = { allowAccessChanges: true }): Config {
  const config = Config.parse(ballspi);
  return { ...config, deviceSettings: { ...config.deviceSettings, ...overrides } };
}
