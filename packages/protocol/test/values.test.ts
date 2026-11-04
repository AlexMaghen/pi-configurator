import { describe, expect, it } from "vitest";
import { SettingItem, type SettingGroup } from "../src/config";
import { deviceFields, hasAppTab, hasDeviceTab, type FormField } from "../src/device";
import { describeGroups, validateValue } from "../src/values";
import { vector } from "./helpers";

const { cases } = vector<{ cases: any[] }>("value-cases.json");

const asField = (raw: any): FormField => (raw.type === "wifi" ? raw : SettingItem.parse(raw));

describe("validateValue", () => {
  it.each(cases.map((c: any, i: number) => [i, JSON.stringify(c.value), c] as [number, string, any]))(
    "case %i (%s)",
    (_i, _v, c: any) => {
      expect(validateValue(asField(c.field), c.value) === undefined).toBe(c.ok);
    },
  );

  it("checks hostnames, and leaves a time zone without a list to the Pi", () => {
    const [hostname, timezone] = deviceFields({ hostname: true, timezone: true });
    expect(validateValue(hostname!, "garage-pi")).toBeUndefined();
    expect(validateValue(hostname!, "-bad")).toBeDefined();
    expect(validateValue(timezone!, "Europe/Paris")).toBeUndefined();
    const [listed] = deviceFields({ timezone: true }, ["UTC"]);
    expect(validateValue(listed!, "Europe/Paris")).toBeDefined();
  });
});

describe("describeGroups", () => {
  it("drops secret defaults", () => {
    const groups: SettingGroup[] = [
      { groupName: "G", items: [SettingItem.parse({ key: "k", label: "K", type: "string", secret: true, default: "x" })] },
    ];
    expect("default" in describeGroups(groups)[0]!.items[0]!).toBe(false);
  });
});

describe("deviceFields", () => {
  it("lists what is on, in the fixed order, with fixed or replaced labels", () => {
    const fields = deviceFields({ timezone: { default: "UTC" }, wifi: true, hostname: { label: "Robot name" } }, ["Europe/Paris"]);
    expect(fields.map((f) => [f.key, f.label])).toEqual([
      ["wifi", "Wi-Fi network"],
      ["hostname", "Robot name"],
      ["timezone", "Time zone"],
    ]);
    expect(fields[2]).toMatchObject({ type: "select", options: [{ value: "Europe/Paris", label: "Europe/Paris" }] });
    expect(deviceFields({ wifi: false })).toEqual([]);
  });

  it("hides a tab with nothing on it", () => {
    expect(hasDeviceTab(undefined)).toBe(false);
    expect(hasDeviceTab({ wifi: false, allowReboot: false })).toBe(false);
    expect(hasDeviceTab({ allowReboot: true })).toBe(true);
    expect(hasAppTab([])).toBe(false);
    expect(hasAppTab([{ groupName: "G", items: [SettingItem.parse({ key: "A", label: "A", type: "boolean" })] }])).toBe(true);
  });
});
