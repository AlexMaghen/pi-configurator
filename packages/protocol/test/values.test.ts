import { describe, expect, it } from "vitest";
import { Field } from "../src/config";
import { describeField, validateValue } from "../src/values";
import { vector } from "./helpers";

const { cases } = vector<{ cases: any[] }>("value-cases.json");

describe("validateValue", () => {
  it.each(cases.map((c: any, i: number) => [i, JSON.stringify(c.value), c] as [number, string, any]))(
    "case %i (%s)",
    (_i, _v, c: any) => {
      const field = Field.parse(c.field);
      expect(validateValue(field, c.value) === undefined).toBe(c.ok);
    },
  );
});

describe("describeField", () => {
  it("drops secret defaults and Wi-Fi passwords", () => {
    const secret = Field.parse({ key: "k", label: "K", type: "string", secret: true, default: "x", target: { store: true } });
    expect("default" in describeField(secret)).toBe(false);
    const wifi = Field.parse({ key: "w", label: "W", type: "wifi", default: { ssid: "a", password: "12345678" }, target: { system: "wifi" } });
    expect(describeField(wifi)).toMatchObject({ default: { ssid: "a" } });
    expect((describeField(wifi) as any).default.password).toBeUndefined();
  });
});
