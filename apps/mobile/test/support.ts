/** Shared test setup: a demo device with no delays and a controllable clock. */
import { randomBytes as nodeRandom } from "node:crypto";
import { DemoPi } from "../src/lib/demo/DemoPi";
import { demoConfig, DEMO_PASSWORD } from "../src/lib/demo/demoConfig";
import { DeviceLink } from "../src/lib/link/DeviceLink";
import type { Config, Field } from "@pi-configurator/protocol";

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
 * The example file has no secret field, so tests add one to cover "set / not set" and
 * replace-only behavior. Everything else comes from examples/ballspi/config.json.
 */
export const SECRET_FIELD: Field = {
  key: "TEST_API_KEY",
  label: "API key",
  group: "Test",
  type: "string",
  secret: true,
  default: "hidden-default",
  target: { store: true },
  onChange: { restart: ["test.service"] },
};

export function testConfig(permissions?: Partial<Config["permissions"]>): Config {
  const config = demoConfig(permissions);
  return { ...config, settings: [...config.settings, SECRET_FIELD] };
}

/** Fields of the example file, picked by what a test needs rather than by key. */
const fileFields = () => demoConfig().settings;
export const pick = {
  /** A store number field with min, max and step. */
  number: () => {
    const f = fileFields().find(
      (x) => (x.type === "number" || x.type === "integer") && "store" in x.target && x.min !== undefined && x.max !== undefined && x.step !== undefined,
    );
    if (!f || (f.type !== "number" && f.type !== "integer")) throw new Error("example has no bounded number field");
    return f;
  },
  url: () => {
    const f = fileFields().find((x) => x.type === "string" && x.format === "url" && "store" in x.target);
    if (!f || f.type !== "string") throw new Error("example has no URL field");
    return f;
  },
  hostname: () => fileFields().find((x) => "system" in x.target && x.target.system === "hostname")!,
  timezone: () => fileFields().find((x) => "system" in x.target && x.target.system === "timezone")!,
  wifi: () => fileFields().find((x) => x.type === "wifi")!,
};

export function makePi(opts: { mtu?: number; permissions?: Partial<Config["permissions"]>; clock?: Clock } = {}) {
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
