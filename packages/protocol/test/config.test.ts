import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Config, ConfigShape, checkConfig } from "../src/config";
import { readJson, repoRoot, vector } from "./helpers";

const { base, cases } = vector<{ base: any; cases: any[] }>("config-cases.json");

describe("config cases", () => {
  it.each(cases.map((c: any) => [c.name, c] as [string, any]))("%s", (_name, c: any) => {
    const input = { ...base, ...c.config };
    for (const [k, v] of Object.entries(input)) if (v === null) delete input[k];
    const shape = ConfigShape.safeParse(input);
    if (c.outcome === "shape") {
      expect(shape.success).toBe(false);
      return;
    }
    expect(shape.success, JSON.stringify(shape.error?.issues)).toBe(true);
    const codes = checkConfig(shape.data!).map((i) => i.code);
    expect(codes).toEqual(c.outcome === "valid" ? [] : c.codes);
    expect(Config.safeParse(input).success).toBe(c.outcome === "valid");
  });
});

describe("example configs", () => {
  it("BallsPi example is valid", () => {
    const parsed = Config.safeParse(readJson(join(repoRoot, "examples/ballspi/config.json")));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("fills permission defaults", () => {
    const parsed = Config.parse({ ...base });
    expect(parsed.permissions).toEqual({ allowReboot: false, allowAccessChanges: false });
  });
});
