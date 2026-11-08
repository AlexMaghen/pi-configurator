/** Shared test setup: a demo device with no delays and a controllable clock. */
import { randomBytes as nodeRandom } from "node:crypto";
import { DemoPi } from "../src/lib/demo/DemoPi";
import { demoConfig, DEMO_PASSWORD } from "../src/lib/demo/demoConfig";
import { DeviceLink } from "../src/lib/link/DeviceLink";
import {
  appItems,
  deviceFields,
  itemOnChange,
  type Config,
  type DeviceSettings,
  type FormField,
  type SettingGroup,
  type SettingItem,
} from "@pi-configurator/protocol";

export const randomBytes = (n: number) => new Uint8Array(nodeRandom(n));

export class Clock {
  t = 1_000_000;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export const NO_DELAYS = { frame: 0, wifiScan: 0, wifiJoin: 0, restart: 0, rebootDrop: 20, rebootDown: 1000 };

/**
 * Tests add a group of fields the example file may not have: a secret one, to cover "set / not
 * set" and replace-only behavior, a URL one for format checks, and a decimal number with bounds
 * and a step whose group restarts a unit. Everything else comes from
 * config-template/config.json, so the tests don't depend on which sample settings it holds.
 */
export const SECRET_FIELD: SettingItem = {
  key: "TEST_API_KEY",
  label: "API key",
  type: "string",
  secret: true,
  default: "hidden-default",
};
export const URL_FIELD: SettingItem = {
  key: "TEST_WEBHOOK_URL",
  label: "Webhook URL",
  type: "string",
  format: "url",
  default: "",
};
export const NUMBER_FIELD: SettingItem = {
  key: "TEST_DELAY_SECONDS",
  label: "Delay",
  type: "number",
  min: 0,
  max: 60,
  step: 0.5,
  unit: "s",
  default: 5,
};
export const SECRET_GROUP: SettingGroup = {
  groupName: "Test",
  help: "Only in the tests.",
  onChange: { restart: ["test.service"] },
  items: [NUMBER_FIELD, SECRET_FIELD, URL_FIELD],
};

/** The example file's Bluetooth name, and the hostname the demo Pi starts with. */
export const DEMO_NAME = demoConfig().bluetooth.name;
const hostnameSetting = demoConfig().deviceSettings?.hostname;
export const DEMO_HOSTNAME =
  (typeof hostnameSetting === "object" ? hostnameSetting.default : undefined) ?? "raspberrypi";

export function testConfig(deviceSettings?: Partial<DeviceSettings>): Config {
  const config = demoConfig(deviceSettings);
  return { ...config, appSettings: [...(config.appSettings ?? []), SECRET_GROUP] };
}

/** Every field the test device shows, in order: the Pi's own settings, then the app items. */
export const testFields = (deviceSettings?: Partial<DeviceSettings>): FormField[] => {
  const config = testConfig(deviceSettings);
  return [...deviceFields(config.deviceSettings), ...appItems(config.appSettings)];
};

/** The units a change to `key` restarts: the item's own onChange, else its group's. */
export function restartsOf(key: string): string[] {
  for (const group of testConfig().appSettings ?? []) {
    const item = group.items.find((i) => i.key === key);
    if (item) return itemOnChange(group, item)?.restart ?? [];
  }
  return [];
}

/** Fields of the example file, picked by what a test needs rather than by key. */
const fileFields = () => deviceFields(demoConfig().deviceSettings);
export const pick = {
  /** A decimal number item with min, max and step, whose change restarts a unit. */
  number: () => {
    const f = appItems(testConfig().appSettings).find(
      (x) => x.type === "number" && x.min !== undefined && x.max !== undefined && x.step !== undefined,
    );
    if (!f || f.type !== "number") throw new Error("no bounded number field");
    return f;
  },
  /** A string item with `format: "url"` (the tests' own, if the example file has none). */
  url: () => {
    const f = appItems(testConfig().appSettings).find((x) => x.type === "string" && x.format === "url");
    if (!f || f.type !== "string") throw new Error("no URL field");
    return f;
  },
  hostname: () => fileFields().find((x) => x.key === "hostname")!,
  timezone: () => fileFields().find((x) => x.key === "timezone")!,
  wifi: () => fileFields().find((x) => x.type === "wifi")!,
};

export function makePi(opts: { mtu?: number; permissions?: Partial<DeviceSettings>; clock?: Clock } = {}) {
  const clock = opts.clock ?? new Clock();
  const pi = new DemoPi({
    config: testConfig(opts.permissions),
    model: "Test Pi",
    randomBytes,
    mtu: opts.mtu ?? 185,
    delays: NO_DELAYS,
    now: clock.now,
  });
  return { pi, clock };
}

export async function openLink(pi: DemoPi, clock: Clock) {
  return DeviceLink.open(pi.connect(), { randomBytes, now: clock.now, yieldToUi: async () => undefined });
}

export async function unlockedLink(opts: Parameters<typeof makePi>[0] = {}) {
  const { pi, clock } = makePi(opts);
  const link = await openLink(pi, clock);
  await link.unlock(DEMO_PASSWORD);
  return { pi, clock, link };
}

export { DEMO_PASSWORD };
