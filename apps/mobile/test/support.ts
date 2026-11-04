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
 * The example file has no secret field, so tests add a group with one to cover "set / not set"
 * and replace-only behavior. Everything else comes from config-template/config.json.
 */
export const SECRET_FIELD: SettingItem = {
  key: "TEST_API_KEY",
  label: "API key",
  type: "string",
  secret: true,
  default: "hidden-default",
};
export const SECRET_GROUP: SettingGroup = {
  groupName: "Test",
  help: "Only in the tests.",
  onChange: { restart: ["test.service"] },
  items: [SECRET_FIELD],
};

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
const fileItems = () => appItems(demoConfig().appSettings);
const fileFields = () => deviceFields(demoConfig().deviceSettings);
export const pick = {
  /** A number item with min, max and step. */
  number: () => {
    const f = fileItems().find(
      (x) => (x.type === "number" || x.type === "integer") && x.min !== undefined && x.max !== undefined && x.step !== undefined,
    );
    if (!f || (f.type !== "number" && f.type !== "integer")) throw new Error("example has no bounded number field");
    return f;
  },
  url: () => {
    const f = fileItems().find((x) => x.type === "string" && x.format === "url");
    if (!f || f.type !== "string") throw new Error("example has no URL field");
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
