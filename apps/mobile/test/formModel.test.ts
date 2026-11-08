/**
 * The settings form logic: tabs, parsing typed text, validation and change detection.
 * Real fields come from config-template/config.json; a few synthetic fields cover cases the
 * example doesn't have (thousands in limits, secrets).
 */
import { describe, expect, it } from "vitest";
import { validateValue, type FormField, type ValueState } from "@pi-configurator/protocol";
import {
  initialText,
  isSystemField,
  isChange,
  limitsText,
  pendingChanges,
  resolveDraft,
  sourceLabel,
} from "../src/lib/form/model";
import { detailsText } from "../src/lib/format/details";
import { formatNumber, parseNumber, percentBars, rssiBars } from "../src/lib/format/numbers";
import { deviceTabs } from "../src/lib/form/tabs";
import { DEMO_HOSTNAME, SECRET_FIELD, pick, testConfig, testFields } from "./support";

const fields = testFields();
const num = pick.number();
const url = pick.url();
const hostname = pick.hostname();
const timezone = pick.timezone();
/** Not in the example: an integer with limits in the thousands. */
const bigInt: FormField = {
  key: "BIG",
  label: "Big",
  type: "integer",
  min: 100,
  max: 5000,
  step: 50,
  unit: "ms",
  default: 800,
};

const plain = (value: unknown, source: "saved" | "default" | "system" | "none" = "saved") =>
  ({ secret: false, value, source }) as ValueState;

describe("numbers", () => {
  it("formats with thousands separators", () => {
    expect(formatNumber(800)).toBe("800");
    expect(formatNumber(5000)).toBe("5,000");
    expect(formatNumber(-1234567.25)).toBe("-1,234,567.25");
  });
  it("parses typed numbers with separators", () => {
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber(" 3 000 ")).toBe(3000);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("12a")).toBeUndefined();
    expect(parseNumber("")).toBeUndefined();
  });
  it("reads a decimal comma from the decimal pad", () => {
    expect(parseNumber("2,5")).toBe(2.5);
    expect(parseNumber("0,75")).toBe(0.75);
    expect(parseNumber(",5")).toBe(0.5);
    expect(parseNumber("1,2345")).toBe(1.2345);
    expect(parseNumber("1,250")).toBe(1250); // three digits: a thousands separator
    expect(parseNumber("1,250.5")).toBe(1250.5);
  });
  it("maps signal to bars", () => {
    expect(rssiBars(-50)).toBe(4);
    expect(rssiBars(-85)).toBe(1);
    expect(rssiBars(undefined)).toBe(0);
    expect(percentBars(82)).toBe(4);
    expect(percentBars(23)).toBe(1);
  });
});

describe("tabs", () => {
  it("puts the OS settings on Device & Network and the rest on Application Settings", () => {
    expect(fields.filter(isSystemField).map((f) => f.key)).toEqual(["wifi", "hostname", "timezone"]);
    expect(fields.filter((f) => !isSystemField(f)).every((f) => f.type !== "wifi")).toBe(true);
  });

  it("hides a tab the config gives nothing to", () => {
    const config = testConfig();
    expect(deviceTabs(config)).toEqual(["device-network", "app-settings"]);
    const off = { wifi: false, hostname: false, timezone: false, allowReboot: false, allowAccessChanges: false };
    expect(deviceTabs({ ...config, deviceSettings: off })).toEqual(["app-settings"]);
    expect(deviceTabs({ ...config, appSettings: [] })).toEqual(["device-network"]);
    // With neither, Application Settings stays to hold the device's info and actions.
    expect(deviceTabs({ deviceSettings: off, appSettings: [] })).toEqual(["app-settings"]);
  });
});

describe("drafts", () => {
  it("shows numbers with separators and accepts them back", () => {
    expect(initialText(bigInt, plain(1200))).toBe("1,200");
    expect(resolveDraft(bigInt, { kind: "text", text: "1,250" })).toEqual({ ok: true, value: 1250 });
    expect(initialText(num, plain(num.default))).toBe(formatNumber(num.default!));
  });

  it("validates with the shared rules", () => {
    const below = num.min! - 1;
    expect(resolveDraft(num, { kind: "text", text: String(below) })).toEqual({ ok: false, error: validateValue(num, below) });
    const offStep = num.min! + num.step! / 2;
    expect(resolveDraft(num, { kind: "text", text: String(offStep) })).toEqual({
      ok: false,
      error: `Must be in steps of ${num.step}`,
    });
    expect(resolveDraft(num, { kind: "text", text: "" })).toEqual({ ok: false, error: "Enter a number" });
    expect(resolveDraft(hostname, { kind: "text", text: "Bad Name" }).ok).toBe(false);
    expect(resolveDraft(url, { kind: "text", text: "rtsp://cam/1" }).ok).toBe(true);
    expect(resolveDraft(url, { kind: "text", text: "not a url" })).toEqual({ ok: false, error: "Must be a URL" });
  });

  it("only allows reset on store fields", () => {
    expect(resolveDraft(num, { kind: "reset" })).toEqual({ ok: true, value: null });
    expect(resolveDraft(hostname, { kind: "reset" }).ok).toBe(false);
  });

  it("detects real changes only", () => {
    const d = num.default!;
    expect(isChange(num, plain(d, "default"), { kind: "text", text: String(d) })).toBe(false);
    expect(isChange(bigInt, plain(800, "default"), { kind: "text", text: "0,800" })).toBe(false);
    expect(isChange(num, plain(d, "default"), { kind: "text", text: String(d + num.step!) })).toBe(true);
    expect(isChange(num, plain(d, "default"), { kind: "reset" })).toBe(false);
    expect(isChange(num, plain(d + num.step!, "saved"), { kind: "reset" })).toBe(true);
    const secret = SECRET_FIELD;
    const secretState = { secret: true, set: true, source: "saved" } as ValueState;
    expect(isChange(secret, secretState, { kind: "text", text: "" })).toBe(false);
    expect(isChange(secret, secretState, { kind: "text", text: "new" })).toBe(true);
  });

  it("collects pending changes and errors", () => {
    const d = num.default!;
    const values: Record<string, ValueState> = {
      [num.key]: plain(d, "default"),
      [hostname.key]: plain(DEMO_HOSTNAME, "system"),
      [timezone.key]: plain("America/Los_Angeles", "system"),
      [url.key]: plain("", "default"),
    };
    const pending = pendingChanges(fields, values, {
      [num.key]: { kind: "text", text: String(d + num.step!) },
      [hostname.key]: { kind: "text", text: DEMO_HOSTNAME },
      [timezone.key]: { kind: "value", value: "Europe/Paris" },
      [url.key]: { kind: "text", text: "not a url" },
    });
    expect(pending.values).toEqual({ [num.key]: d + num.step!, [timezone.key]: "Europe/Paris" });
    expect(pending.errors).toEqual({ [url.key]: "Must be a URL" });
    expect(pending.count).toBe(3);
  });

  it("describes limits and sources", () => {
    expect(limitsText(bigInt)).toBe("100 – 5,000 ms · steps of 50");
    expect(limitsText(num)).toBe(`${formatNumber(num.min!)} – ${formatNumber(num.max!)} ${num.unit} · steps of ${num.step}`);
    expect(limitsText(hostname)).toBeUndefined();
    expect(sourceLabel(plain(1, "default"))).toBe("Default");
  });
});

describe("device data text", () => {
  it("lays the report out as plain text for the clipboard", () => {
    const text = detailsText("Crapula", [
      { title: "Hardware", items: [{ label: "Model", value: "Raspberry Pi 4 Model B Rev 1.5" }] },
      { title: "Network", items: [{ label: "Signal", value: "86%" }, { label: "DNS", value: "192.168.4.1" }] },
    ]);
    expect(text).toBe(
      "Device data: Crapula\n\nHARDWARE\nModel: Raspberry Pi 4 Model B Rev 1.5\n\nNETWORK\nSignal: 86%\nDNS: 192.168.4.1\n",
    );
  });
});
