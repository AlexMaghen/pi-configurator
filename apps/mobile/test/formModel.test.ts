/**
 * The settings form logic: grouping, parsing typed text, validation and change detection.
 * Real fields come from examples/ballspi/config.json; a few synthetic fields cover cases the
 * example doesn't have (thousands in limits, secrets, ungrouped fields).
 */
import { describe, expect, it } from "vitest";
import { validateValue, type DescribedField, type ValueState } from "@pi-configurator/protocol";
import {
  groupFields,
  initialText,
  isChange,
  limitsText,
  pendingChanges,
  resolveDraft,
  sourceLabel,
} from "../src/lib/form/model";
import { formatNumber, parseNumber, percentBars, rssiBars } from "../src/lib/format/numbers";
import { SECRET_FIELD, pick, testConfig } from "./support";

const fields = testConfig().settings as DescribedField[];
const num = pick.number();
const url = pick.url();
const hostname = pick.hostname();
const timezone = pick.timezone();
/** Not in the example: an integer with limits in the thousands. */
const bigInt: DescribedField = {
  key: "BIG",
  label: "Big",
  type: "integer",
  min: 100,
  max: 5000,
  step: 50,
  unit: "ms",
  default: 800,
  target: { store: true },
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
  it("maps signal to bars", () => {
    expect(rssiBars(-50)).toBe(4);
    expect(rssiBars(-85)).toBe(1);
    expect(rssiBars(undefined)).toBe(0);
    expect(percentBars(82)).toBe(4);
    expect(percentBars(23)).toBe(1);
  });
});

describe("grouping", () => {
  it("keeps first-seen group order and puts ungrouped fields in their own group", () => {
    const extra = [...fields, { key: "loose", label: "Loose", type: "boolean", target: { store: true } } as DescribedField];
    const firstSeen = [...new Set(fields.map((f) => f.group))];
    const groups = groupFields(extra);
    expect(groups.map((g) => g.title)).toEqual([...firstSeen, undefined]);
    for (const g of groups.slice(0, -1)) {
      expect(g.fields.map((f) => f.key)).toEqual(fields.filter((f) => f.group === g.title).map((f) => f.key));
    }
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
    const secret = SECRET_FIELD as DescribedField;
    const secretState = { secret: true, set: true, source: "saved" } as ValueState;
    expect(isChange(secret, secretState, { kind: "text", text: "" })).toBe(false);
    expect(isChange(secret, secretState, { kind: "text", text: "new" })).toBe(true);
  });

  it("collects pending changes and errors", () => {
    const d = num.default!;
    const values: Record<string, ValueState> = {
      [num.key]: plain(d, "default"),
      [hostname.key]: plain("ballspi", "system"),
      [timezone.key]: plain("America/Los_Angeles", "system"),
      [url.key]: plain("", "default"),
    };
    const pending = pendingChanges(fields, values, {
      [num.key]: { kind: "text", text: String(d + num.step!) },
      [hostname.key]: { kind: "text", text: "ballspi" },
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
