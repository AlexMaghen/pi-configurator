/**
 * The demo device's config: the real BallsPi example from `examples/ballspi/config.json`, so the
 * demo shows exactly the form the first real device will. Parsed with the shared `Config` schema,
 * which also checks the example stays valid.
 *
 * The demo turns `allowAccessChanges` on so the Change password and Rename screens can be tried;
 * everything else is as in the file.
 */
import { Config } from "@pi-configurator/protocol";
import ballspi from "../../../../../examples/ballspi/config.json";

export const DEMO_DEVICE_ID = "demo-ballspi";
export const DEMO_MODEL = "Raspberry Pi 4 Model B";

/** The example's password; the demo's unlock screen shows it as a hint. */
export const DEMO_PASSWORD = ballspi.access.password;

export function demoConfig(overrides: Partial<Config["permissions"]> = { allowAccessChanges: true }): Config {
  const config = Config.parse(ballspi);
  return { ...config, permissions: { ...config.permissions, ...overrides } };
}
